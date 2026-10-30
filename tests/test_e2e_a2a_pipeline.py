#!/usr/bin/env python3
"""8-dimension A2A regression suite covering G1..G9 (v1.1.0 charter).

Contract mode (default, offline-safe):
  python3 tests/test_e2e_a2a_pipeline.py
Live mode (real phone + adb forwards on 9910/9911):
  A2A_LIVE=1 python3 tests/test_e2e_a2a_pipeline.py
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "src" / "engines" / "security-audit-engine"))
sys.path.insert(0, str(REPO / "src" / "engines" / "a2a-rpc-engine"))
sys.path.insert(0, str(REPO / "src" / "engines" / "artifact-sync-engine"))

import security_audit  # noqa: E402
from a2a_client_poller import A2AClientPoller  # noqa: E402
import artifact_validator  # noqa: E402

validate_artifact = artifact_validator.validate_artifact

PI_SSH = "k40"
PHONE_WS = "/data/data/com.termux/files/home/workspace"
IDEMPOTENT_PROJECT = "a2a_e2e_probe"


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

    def test_09_structured_artifact_contract(self):
        artifact = {
            "task_id": "task-contract-001",
            "step_id": "step_01",
            "idempotent_status": "fresh_run",
            "executed_at": "2026-10-28T09:00:00+08:00",
            "workspace_dir": f"{PHONE_WS}/projects/contract",
            "script_path": "./run.sh",
            "script_sha256": "a" * 64,
            "inputs_sha256": "no_inputs_declared",
            "exit_code": 0,
            "duration_sec": 1.2,
            "log_file": f"{PHONE_WS}/projects/contract/system_logs/step_01.log",
            "changed_files": [
                {"path": "result.tsv", "sha256": "b" * 64, "action": "verified"}
            ],
            "stdout_summary": "ok",
        }
        self.assertEqual(validate_artifact(artifact), [])
        artifact["exit_code"] = 1
        self.assertIn("ERR_ARTIFACT_EXIT_CODE_NONZERO", validate_artifact(artifact))
        del artifact["script_sha256"]
        self.assertIn(
            "ERR_ARTIFACT_FIELD_MISSING:script_sha256",
            validate_artifact(artifact),
        )

    def test_10_concurrent_lock_contract(self):
        text = (REPO / "ops" / "pi_idempotent_runner.sh").read_text(encoding="utf-8")
        self.assertIn('mkdir "$LOCK_DIR"', text)
        self.assertIn("attached_running_lock", text)
        self.assertIn("cleanup_lock", text)

    def test_12_runner_rejects_path_escape_contract(self):
        text = (REPO / "ops" / "pi_idempotent_runner.sh").read_text(encoding="utf-8")
        for marker in (
            "validate_slug",
            "resolve_inside_project",
            "ERR_PATH_GUARD_PROJECT",
            "ERR_PATH_GUARD_STEP",
            "ERR_PATH_GUARD_SCRIPT",
            "ERR_PATH_GUARD_INPUT",
            "ERR_PATH_GUARD_OUTPUT",
        ):
            self.assertIn(marker, text)

    def test_11_artifact_hash_reconciliation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = root / "result.tsv"
            output.write_text("gene\tlogFC\nTP53\t1.2\n", encoding="utf-8")
            artifact = {
                "task_id": "task-contract-002",
                "step_id": "step_02",
                "idempotent_status": "reused_done_checkpoint",
                "executed_at": "2026-10-28T09:00:00+08:00",
                "workspace_dir": f"{PHONE_WS}/projects/contract",
                "script_path": "./run.sh",
                "script_sha256": "a" * 64,
                "inputs_sha256": "no_inputs_declared",
                "exit_code": 0,
                "duration_sec": 0.1,
                "log_file": f"{PHONE_WS}/projects/contract/system_logs/step_02.log",
                "changed_files": [
                    {
                        "path": "result.tsv",
                        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                        "action": "verified",
                    }
                ],
                "stdout_summary": "cached",
            }
            self.assertEqual(validate_artifact(artifact), [])

    def test_13_double_layer_acceptance_rejects_pi_false_positive(self):
        artifact = {
            "task_id": "task-contract-003",
            "step_id": "step_03",
            "idempotent_status": "fresh_run",
            "executed_at": "2026-10-28T09:00:00+08:00",
            "workspace_dir": f"{PHONE_WS}/projects/contract",
            "script_path": "./run.sh",
            "script_sha256": "a" * 64,
            "inputs_sha256": "no_inputs_declared",
            "exit_code": 0,
            "duration_sec": 0.1,
            "log_file": f"{PHONE_WS}/projects/contract/system_logs/step_03.log",
            "changed_files": [
                {"path": "result.tsv", "sha256": "b" * 64, "action": "created"}
            ],
            "stdout_summary": "ok",
        }
        preliminary = {
            "passed": True,
            "exit_code": 0,
            "script_sha256": artifact["script_sha256"],
            "inputs_sha256": artifact["inputs_sha256"],
            "changed_files": artifact["changed_files"],
            "log_file": artifact["log_file"],
            "checks": [{"name": "self_check", "passed": True, "detail": "ok"}],
        }
        artifact["preliminary_acceptance"] = preliminary
        final = {
            **preliminary,
            "verifier": "codex",
            "verified_at": "2026-10-28T09:01:00+08:00",
            "modification_scope": "within_workspace",
        }
        final["changed_files"] = [
            {"path": "result.tsv", "sha256": "c" * 64, "action": "created"}
        ]
        artifact["final_acceptance"] = final
        errors = artifact_validator.validate_completion_artifact(artifact)
        self.assertIn("ERR_ACCEPTANCE_MISMATCH:final_acceptance.changed_files", errors)
        self.assertEqual(
            artifact_validator.evaluate_task_completion(artifact)["state"],
            "working",
        )

    def test_14_missing_acceptance_fields_are_rejected(self):
        artifact = {
            "task_id": "task-contract-004",
            "step_id": "step_04",
            "idempotent_status": "fresh_run",
            "executed_at": "2026-10-28T09:00:00+08:00",
            "workspace_dir": f"{PHONE_WS}/projects/contract",
            "script_path": "./run.sh",
            "script_sha256": "a" * 64,
            "inputs_sha256": "no_inputs_declared",
            "exit_code": 0,
            "duration_sec": 0.1,
            "log_file": f"{PHONE_WS}/projects/contract/system_logs/step_04.log",
            "changed_files": [],
            "stdout_summary": "ok",
            "preliminary_acceptance": {"passed": True},
        }
        errors = artifact_validator.validate_completion_artifact(artifact)
        self.assertIn(
            "ERR_ACCEPTANCE_FIELD_MISSING:preliminary_acceptance.checks",
            errors,
        )
        self.assertIn("ERR_ACCEPTANCE_FIELD_MISSING:final_acceptance", errors)

    def test_15_runtime_path_visibility_guard(self):
        task = {
            "workspace_dir": "/mnt/ssd/bio_data/projects/contract",
            "script_path": "scripts/run.py",
            "inputs": ["data/input.tsv"],
            "outputs": ["results/result.tsv"],
        }
        self.assertIn(
            "ERR_TASK_PATH_NOT_VISIBLE:workspace_dir",
            artifact_validator.validate_dispatch_paths(task, runtime="termux"),
        )
        task["workspace_dir"] = "$HOME/workspace/projects/contract"
        self.assertEqual(
            artifact_validator.validate_dispatch_paths(task, runtime="termux"),
            [],
        )


class IdempotentRunnerTests(unittest.TestCase):
    """CASE-03 + CASE-04: rerun skip and readonly master (needs the phone)."""

    def setUp(self):
        try:
            ssh_k40("true", timeout=10)
        except (OSError, RuntimeError) as exc:
            self.skipTest("k40 unreachable: {0}".format(exc))
        self._reset_project()

    def _reset_project(self):
        ssh_k40(
            "\n".join(
                (
                    "set -e",
                    'project="$HOME/workspace/projects/{0}"'.format(IDEMPOTENT_PROJECT),
                    'rm -rf "$project"',
                    'mkdir -p "$project"',
                    'printf \'#!/data/data/com.termux/files/usr/bin/bash\\n'
                    'echo step_output\\n'
                    'echo data > out.txt\\n\' > "$project/build.sh"',
                )
            )
        )

    def _runner_command(self):
        return (
            'bash "$HOME/bin/pi_idempotent_runner.sh" --project {0} '
            '--step e2e --script ./build.sh --outputs out.txt'
        ).format(IDEMPOTENT_PROJECT)

    def test_03_idempotent_done_skip(self):
        out1 = ssh_k40(
            self._runner_command(),
            timeout=60,
        )
        first = json.loads(out1.splitlines()[-1] if out1.startswith("{") and out1.count("\n") == 0 else out1)
        self.assertEqual(first.get("idempotent_status"), "fresh_run")
        out2 = ssh_k40(
            self._runner_command(),
            timeout=60,
        )
        second = json.loads(out2)
        self.assertEqual(second["idempotent_status"], "reused_done_checkpoint")
        self.assertEqual(validate_artifact(second), [])
        elapsed = ssh_k40(
            'start=$(date +%s%N); bash "$HOME/bin/pi_idempotent_runner.sh" '
            '--project {0} --step e2e --script ./build.sh --outputs out.txt >/dev/null; '
            'end=$(date +%s%N); echo $(( (end - start) / 1000000 ))'.format(
                IDEMPOTENT_PROJECT
            ),
            timeout=60,
        )
        self.assertLess(int(elapsed), 500, "reuse took {0}ms".format(elapsed))

    def test_04_readonly_script_guard(self):
        ssh_k40(
            self._runner_command(),
            timeout=60,
        )
        sha = ssh_k40(
            'sha256sum "$HOME/workspace/projects/{0}/build.sh" | awk "{{print \\$1}}"'.format(
                IDEMPOTENT_PROJECT
            )
        )
        writable = ssh_k40(
            'test -w "$HOME/workspace/projects/{0}/build.sh" && echo writable || echo readonly'.format(
                IDEMPOTENT_PROJECT
            )
        )
        self.assertEqual(writable, "readonly")
        self.assertEqual(len(sha), 64)


class LivePhoneTests(unittest.TestCase):
    """CASE-05/06/07/08 against the real 9910/9911 over adb forwards."""

    @classmethod
    def setUpClass(cls):
        if os.environ.get("A2A_LIVE") != "1":
            raise unittest.SkipTest("set A2A_LIVE=1 for live phone checks")
        cls.token = read_phone_token()
        cls.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def _get(self, url: str, token: str | None = None, timeout: int = 8):
        headers = {"Authorization": "Bearer {0}".format(token)} if token else {}
        request = urllib.request.Request(url, headers=headers)
        try:
            with self.opener.open(request, timeout=timeout) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            try:
                return exc.code, {}
            finally:
                exc.close()

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
            try:
                return exc.code, {}
            finally:
                exc.close()

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
            backoff_schedule_sec=(1.0, 2.0),
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
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--mode", choices=("contract", "live"), default=None)
    args, remaining = parser.parse_known_args()
    if args.mode == "live":
        os.environ["A2A_LIVE"] = "1"
    elif args.mode == "contract":
        os.environ.pop("A2A_LIVE", None)
    unittest.main(argv=[sys.argv[0], *remaining], verbosity=2)
