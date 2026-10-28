#!/usr/bin/env python3
"""8-dimension A2A regression suite covering G1..G9 (v1.1.0 charter).

Contract mode (default, offline-safe):
  python3 tests/test_e2e_a2a_pipeline.py
Live mode (real phone + adb forwards on 9910/9911):
  A2A_LIVE=1 python3 tests/test_e2e_a2a_pipeline.py
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "src" / "engines" / "security-audit-engine"))
sys.path.insert(0, str(REPO / "src" / "engines" / "a2a-rpc-engine"))

import security_audit  # noqa: E402
from a2a_client_poller import A2AClientPoller  # noqa: E402

PI_SSH = "k40"
PHONE_WS = "/data/data/com.termux/files/home/workspace"


def ssh_k40(command: str, timeout: int = 30) -> str:
    result = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", PI_SSH, command],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError("ssh failed: {0}".format(result.stderr[-300:]))
    return result.stdout.strip()


def read_phone_token() -> str:
    return ssh_k40('cat "$HOME/.pi/agent/.peer_token"')


class ContractTests(unittest.TestCase):
    """CASE-01 + CASE-02: path isolation and zero-trust bind lock."""

    def test_01_path_guard_isolation(self):
        script = (
            "import { PathGuard } from './PathGuard.mjs';"
            "const g = new PathGuard('/data/data/com.termux/files/home');"
            "const ok = g.isAllowed('/data/data/com.termux/files/home/workspace/projects/p');"
            "const bad = ['/sdcard/x','/storage/emulated/0/x','projects/../../etc'].map(p => g.isAllowed(p));"
            "console.log(JSON.stringify({ok, bad}));"
        )
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=REPO / "tests" / ".build",
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        verdict = json.loads(result.stdout)
        self.assertTrue(verdict["ok"])
        self.assertEqual(verdict["bad"], [False, False, False])

    def test_02_zero_trust_bind_lock(self):
        good = {
            "a2a": {"server": {
                "enabled": True, "host": "0.0.0.0",
                "peerTokens": {"codex": "a2a_sec_" + "a" * 48},
                "trustedPeers": ["codex"], "allowAllUsers": False, "maxConcurrent": 2,
            }}
        }
        self.assertEqual(security_audit.validate_settings(good), [])
        bad = json.loads(json.dumps(good))
        bad["a2a"]["server"]["peerTokens"] = {}
        self.assertTrue(security_audit.validate_settings(bad))
        bad = json.loads(json.dumps(good))
        bad["a2a"]["server"]["trustedPeers"] = []
        self.assertTrue(security_audit.validate_settings(bad))


class IdempotentRunnerTests(unittest.TestCase):
    """CASE-03 + CASE-04: rerun skip and readonly master (needs the phone)."""

    def setUp(self):
        try:
            ssh_k40("true", timeout=10)
        except (OSError, RuntimeError) as exc:
            self.skipTest("k40 unreachable: {0}".format(exc))

    def test_03_idempotent_done_skip(self):
        out1 = ssh_k40(
            'bash "$HOME/bin/pi_idempotent_runner.sh" --project a2a_idem_probe '
            '--step e2e --script ./build.sh --outputs out.txt',
            timeout=60,
        )
        first = json.loads(out1.splitlines()[-1] if out1.startswith("{") and out1.count("\n") == 0 else out1)
        self.assertIn(first.get("idempotent_status"), ("fresh_run", "reused_done_checkpoint"))
        out2 = ssh_k40(
            'bash "$HOME/bin/pi_idempotent_runner.sh" --project a2a_idem_probe '
            '--step e2e --script ./build.sh --outputs out.txt',
            timeout=60,
        )
        second = json.loads(out2)
        self.assertEqual(second["idempotent_status"], "reused_done_checkpoint")
        elapsed = ssh_k40(
            'start=$(date +%s%N); bash "$HOME/bin/pi_idempotent_runner.sh" '
            '--project a2a_idem_probe --step e2e --script ./build.sh --outputs out.txt >/dev/null; '
            'end=$(date +%s%N); echo $(( (end - start) / 1000000 ))',
            timeout=60,
        )
        self.assertLess(int(elapsed), 500, "reuse took {0}ms".format(elapsed))

    def test_04_readonly_script_guard(self):
        sha = ssh_k40('sha256sum "$HOME/workspace/projects/a2a_idem_probe/build.sh" | awk "{print \\$1}"')
        writable = ssh_k40(
            'test -w "$HOME/workspace/projects/a2a_idem_probe/build.sh" && echo writable || echo readonly'
        )
        self.assertEqual(writable, "readonly")
        self.assertEqual(len(sha), 64)


@unittest.skipUnless(os.environ.get("A2A_LIVE") == "1", "set A2A_LIVE=1 for live phone checks")
class LivePhoneTests(unittest.TestCase):
    """CASE-05/06/07/08 against the real 9910/9911 over adb forwards."""

    @classmethod
    def setUpClass(cls):
        cls.token = read_phone_token()
        cls.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def _get(self, url: str, token: str | None = None, timeout: int = 8):
        headers = {"Authorization": "Bearer {0}".format(token)} if token else {}
        request = urllib.request.Request(url, headers=headers)
        try:
            with self.opener.open(request, timeout=timeout) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            return exc.code, {}

    def _post(self, url: str, payload: dict, token: str | None = None, timeout: int = 15):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer {0}".format(token)
        request = urllib.request.Request(
            url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST"
        )
        try:
            with self.opener.open(request, timeout=timeout) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            return exc.code, {}

    def test_05_telemetry_auth_and_model_whitelist(self):
        status, _ = self._get("http://127.0.0.1:9911/api/telemetry/overview")
        self.assertEqual(status, 401)
        status, data = self._get(
            "http://127.0.0.1:9911/api/telemetry/overview", token=self.token
        )
        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])
        status, _ = self._post(
            "http://127.0.0.1:9911/api/telemetry/model",
            {"provider": "openai", "model": "gpt-4.1"},
            token=self.token,
        )
        self.assertEqual(status, 400)

    def test_06_agent_card_discovery(self):
        status, card = self._get("http://127.0.0.1:9910/.well-known/agent-card.json")
        self.assertEqual(status, 200)
        self.assertIn("name", card)

    def test_07_a2a_auth_rejection(self):
        payload = {"jsonrpc": "2.0", "id": 1, "method": "SendMessage", "params": {}}
        status, _ = self._post("http://127.0.0.1:9910/", payload, token="wrong-token")
        self.assertIn(status, (401, 403))

    def test_08_resume_on_reconnect(self):
        poller = A2AClientPoller(
            endpoint="http://127.0.0.1:9910",
            bearer_token=self.token,
            backoff_schedule_sec=(0.2,),
            state_file=str(REPO / ".active_a2a_task.json"),
        )
        task = poller.send_message("Reply with exactly: resume_probe_ok", return_immediately=True)
        task_id = poller._extract_task_id(task)
        self.assertIsNotNone(task_id)
        resumed = poller.poll_existing_task(str(task_id), max_wait_sec=60)
        state = poller._extract_state(resumed)
        self.assertEqual(state, "completed")
        artifacts = resumed.get("artifacts") or []
        texts = [part.get("text", "") for artifact in artifacts for part in artifact.get("parts", [])]
        self.assertTrue(any("resume_probe_ok" in text for text in texts), texts)


if __name__ == "__main__":
    unittest.main(verbosity=2)
