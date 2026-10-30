#!/usr/bin/env python3
"""Live proof for Pi preliminary acceptance and Codex final acceptance."""

from __future__ import annotations

import base64
import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


REPO = Path(__file__).resolve().parent.parent
POLLER_PATH = REPO / "src" / "engines" / "a2a-rpc-engine" / "a2a_client_poller.py"
POLLER_SPEC = importlib.util.spec_from_file_location(
    "a2a_client_poller_for_live_acceptance",
    POLLER_PATH,
)
assert POLLER_SPEC is not None and POLLER_SPEC.loader is not None
poller_module = importlib.util.module_from_spec(POLLER_SPEC)
POLLER_SPEC.loader.exec_module(poller_module)

PROJECT_ID = "a2a_art04_live"
REMOTE_PROJECT = (
    "/data/data/com.termux/files/home/workspace/projects/{0}".format(PROJECT_ID)
)


def _remote_bash(script: str, timeout: float = 30.0) -> subprocess.CompletedProcess[str]:
    encoded = base64.b64encode(script.encode("utf-8")).decode("ascii")
    return subprocess.run(
        [
            "ssh",
            "-o",
            "BatchMode=yes",
            "k40",
            "printf '%s' '{0}' | base64 -d | bash".format(encoded),
        ],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
    )


@unittest.skipUnless(
    os.environ.get("A2A_LIVE_E2E") == "1",
    "set A2A_LIVE_E2E=1 to run the live acceptance test",
)
class LiveAcceptanceTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        token_result = _remote_bash('cat "$HOME/.pi/agent/.peer_token"')
        cls.token = token_result.stdout.strip()
        if len(cls.token) < 48:
            raise unittest.SkipTest("Pi peer token is unavailable")
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        request = urllib.request.Request(
            "http://127.0.0.1:9910/.well-known/agent-card.json",
            method="GET",
        )
        try:
            with opener.open(request, timeout=5):
                pass
        except OSError as exc:
            raise unittest.SkipTest("A2A endpoint is unreachable: {0}".format(exc))

    def test_live_pi_preliminary_awaits_codex_final(self) -> None:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
        step_id = "art04_{0}".format(stamp)
        script_name = "run_{0}.sh".format(stamp)
        remote_script = "{0}/{1}".format(REMOTE_PROJECT, script_name)
        fixture = "\n".join(
            [
                "set -euo pipefail",
                "mkdir -p '{0}/system_logs'".format(REMOTE_PROJECT),
                "cat > '{0}' <<'SH'".format(remote_script),
                "#!/usr/bin/env bash",
                "set -euo pipefail",
                "printf 'art04_live_ok\\n' > result.txt",
                "SH",
                "chmod 755 '{0}'".format(remote_script),
                "rm -f '{0}/.step_{1}.done'".format(REMOTE_PROJECT, step_id),
                "rm -rf '{0}/.step_{1}.lock.d'".format(REMOTE_PROJECT, step_id),
            ]
        )
        _remote_bash(fixture)

        with tempfile.TemporaryDirectory() as tmp:
            state_file = Path(tmp) / "active_a2a_task.json"
            client = poller_module.A2AClientPoller(
                endpoint="http://127.0.0.1:9910",
                bearer_token=self.token,
                state_file=str(state_file),
                backoff_schedule_sec=(5.0, 10.0, 20.0, 30.0),
            )
            task = client.dispatch_idempotent_step(
                PROJECT_ID,
                step_id,
                remote_script,
                inputs=[],
                outputs=["result.txt"],
                workspace_dir=REMOTE_PROJECT,
                max_wait_sec=300.0,
            )

            self.assertEqual(task["status"]["state"], "awaiting_final_acceptance")
            artifact = client.evaluate_task(task)["artifact"]
            self.assertTrue(artifact["preliminary_acceptance"]["passed"])

            local_root = Path(tmp) / "mirror"
            local_root.mkdir()
            subprocess.run(
                [
                    "scp",
                    "-q",
                    "k40:{0}".format(remote_script),
                    str(local_root / script_name),
                ],
                check=True,
                timeout=30,
            )
            subprocess.run(
                [
                    "scp",
                    "-q",
                    "k40:{0}/result.txt".format(REMOTE_PROJECT),
                    str(local_root / "result.txt"),
                ],
                check=True,
                timeout=30,
            )
            command = "python -c \"from pathlib import Path; assert Path('{0}').stat().st_size > 0\"".format(
                script_name
            )
            command_result = subprocess.run(
                [
                    sys.executable,
                    "-c",
                    "from pathlib import Path; assert Path('{0}').stat().st_size > 0".format(
                        script_name
                    ),
                ],
                cwd=local_root,
                check=False,
                timeout=10,
            )
            final = client.evaluate_task(
                task,
                workspace_root=str(local_root),
                command_results=[
                    {"command": command, "exit_code": command_result.returncode}
                ],
            )

        self.assertEqual(final["state"], "completed")
        self.assertTrue(final["artifact"]["final_acceptance"]["passed"])
        self.assertEqual(final["artifact"]["final_acceptance"]["verifier"], "codex")


if __name__ == "__main__":
    unittest.main()
