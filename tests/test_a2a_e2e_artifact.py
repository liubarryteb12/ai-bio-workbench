#!/usr/bin/env python3
"""Tests for PC-side extraction and validation of Pi A2A text artifacts."""

from __future__ import annotations

import base64
import importlib.util
import json
import os
import re
import subprocess
import time
import unittest
import urllib.request
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Any


REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VALIDATOR_PATH = os.path.join(
    REPO_ROOT,
    "src",
    "engines",
    "artifact-sync-engine",
    "artifact_validator.py",
)
VALIDATOR_SPEC = importlib.util.spec_from_file_location(
    "artifact_validator_for_a2a_e2e", VALIDATOR_PATH
)
assert VALIDATOR_SPEC is not None and VALIDATOR_SPEC.loader is not None
artifact_validator = importlib.util.module_from_spec(VALIDATOR_SPEC)
VALIDATOR_SPEC.loader.exec_module(artifact_validator)

EXTRACTOR_PATH = os.path.join(
    REPO_ROOT,
    "src",
    "engines",
    "artifact-sync-engine",
    "artifact_extractor.py",
)
EXTRACTOR_SPEC = importlib.util.spec_from_file_location(
    "artifact_extractor_for_a2a_e2e", EXTRACTOR_PATH
)
assert EXTRACTOR_SPEC is not None and EXTRACTOR_SPEC.loader is not None
artifact_extractor = importlib.util.module_from_spec(EXTRACTOR_SPEC)
EXTRACTOR_SPEC.loader.exec_module(artifact_extractor)
extract_artifact_from_rpc = artifact_extractor.extract_artifact_from_rpc


def _metadata_lines(step_id: str = "step_multi") -> list[str]:
    workspace = "/data/data/com.termux/files/home/workspace/projects/a2a_multi"
    return [
        "- Step ID: `{0}`".format(step_id),
        "- Idempotent status: `fresh_run`",
        "- Script path: `{0}/run.sh`".format(workspace),
        "- Script SHA256: `b6a98d9ce9a2d9149288fa3df42d377c3e42737afdcdaf714e33c0a100b51060`",
        "- Inputs SHA256: `no_inputs_declared`",
        "- Duration sec: `0.25`",
        "- Log file: `{0}/system_logs/{1}.log`".format(workspace, step_id),
    ]


def _pi_reply() -> dict:
    path = "/data/data/com.termux/files/home/workspace/projects/a2a_e2e/probe.txt"
    content = "pong_from_pi_20261028\n"
    text = "\n".join(
        [
            "- Step ID: `step_probe`",
            "- Idempotent status: `fresh_run`",
            "- Script path: `/data/data/com.termux/files/home/workspace/projects/a2a_e2e/run.sh`",
            "- Script SHA256: `b6a98d9ce9a2d9149288fa3df42d377c3e42737afdcdaf714e33c0a100b51060`",
            "- Inputs SHA256: `no_inputs_declared`",
            "- Duration sec: `0.8`",
            "- Log file: `/data/data/com.termux/files/home/workspace/projects/a2a_e2e/system_logs/step_probe.log`",
            "- File: `{0}`".format(path),
            "- Content: `{0}` + trailing newline ({1} bytes)".format(
                content.rstrip("\n"),
                len(content.encode("utf-8")),
            ),
            "- SHA256: `2f76f94f886c744b01826e4cd78f0e51b83a377418d63a4bb87836b2ab9a1a97`",
            "- Exit code: `0`",
        ]
    )
    return {
        "task": {
            "id": "task-a2a-e2e-001",
            "status": {
                "state": "TASK_STATE_COMPLETED",
                "timestamp": "2026-10-28T09:00:00+08:00",
            },
            "artifacts": [
                {
                    "artifactId": "reply",
                    "name": "reply",
                    "parts": [
                        {
                            "text": text,
                            "mediaType": "text/plain",
                        }
                    ],
                }
            ],
        }
    }


def _structured_pi_reply() -> dict:
    artifact = {
        "task_id": "task-a2a-e2e-json-001",
        "step_id": "step_json",
        "idempotent_status": "fresh_run",
        "executed_at": "2026-10-28T09:00:00+08:00",
        "workspace_dir": "/data/data/com.termux/files/home/workspace/projects/a2a_e2e",
        "script_path": "/data/data/com.termux/files/home/workspace/projects/a2a_e2e/run.sh",
        "script_sha256": "b6a98d9ce9a2d9149288fa3df42d377c3e42737afdcdaf714e33c0a100b51060",
        "inputs_sha256": "no_inputs_declared",
        "exit_code": 0,
        "duration_sec": 0,
        "log_file": "/data/data/com.termux/files/home/workspace/projects/a2a_e2e/system_logs/step_json.log",
        "changed_files": [
            {
                "path": "probe_json.txt",
                "sha256": "2f76f94f886c744b01826e4cd78f0e51b83a377418d63a4bb87836b2ab9a1a97",
                "action": "verified",
            }
        ],
        "stdout_summary": "structured runner output",
    }
    return {
        "task": {
            "id": "task-a2a-e2e-json-001",
            "status": {"timestamp": "2026-10-28T09:00:00+08:00"},
            "artifacts": [
                {
                    "parts": [
                        {
                            "text": "Runner stdout:\n```json\n{0}\n```".format(
                                json.dumps(artifact, ensure_ascii=False)
                            ),
                            "mediaType": "text/plain",
                        }
                    ]
                }
            ],
        }
    }


def _run_remote_bash(script: str, timeout: float = 20.0) -> subprocess.CompletedProcess[str]:
    encoded = base64.b64encode(script.encode("utf-8")).decode("ascii")
    return subprocess.run(
        ["ssh", "k40", "printf '%s' '{0}' | base64 -d | bash -s".format(encoded)],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
    )


class ExtractArtifactFromRpcTestCase(unittest.TestCase):
    def test_valid_pi_reply_round_trips_through_validator(self) -> None:
        artifact = extract_artifact_from_rpc(_pi_reply())
        self.assertEqual(artifact_validator.validate_artifact(artifact), [])
        self.assertEqual(artifact["task_id"], "task-a2a-e2e-001")
        self.assertEqual(artifact["executed_at"], "2026-10-28T09:00:00+08:00")
        self.assertEqual(
            artifact["workspace_dir"],
            "/data/data/com.termux/files/home/workspace/projects/a2a_e2e",
        )
        self.assertEqual(artifact["changed_files"][0]["path"], "probe.txt")
        self.assertEqual(artifact["exit_code"], 0)
        self.assertEqual(artifact["duration_sec"], 0.8)
        self.assertEqual(artifact["step_id"], "step_probe")
        self.assertEqual(artifact["idempotent_status"], "fresh_run")
        self.assertEqual(artifact["script_path"], "/data/data/com.termux/files/home/workspace/projects/a2a_e2e/run.sh")
        self.assertEqual(
            artifact["script_sha256"],
            "b6a98d9ce9a2d9149288fa3df42d377c3e42737afdcdaf714e33c0a100b51060",
        )
        self.assertEqual(
            artifact["log_file"],
            "/data/data/com.termux/files/home/workspace/projects/a2a_e2e/system_logs/step_probe.log",
        )
        self.assertEqual(artifact["stderr_summary"], "")
        self.assertIn("- File: `", artifact["stdout_summary"])

    def test_structured_runner_json_round_trips_through_validator(self) -> None:
        artifact = extract_artifact_from_rpc(_structured_pi_reply())
        self.assertEqual(artifact_validator.validate_artifact(artifact), [])
        self.assertEqual(artifact["task_id"], "task-a2a-e2e-json-001")
        self.assertEqual(artifact["idempotent_status"], "fresh_run")
        self.assertEqual(artifact["changed_files"][0]["path"], "probe_json.txt")

    def test_missing_task_raises_err_no_task(self) -> None:
        with self.assertRaisesRegex(ValueError, "ERR_NO_TASK"):
            extract_artifact_from_rpc({})

    def test_missing_artifacts_raises_err_no_artifact(self) -> None:
        with self.assertRaisesRegex(ValueError, "ERR_NO_ARTIFACT"):
            extract_artifact_from_rpc({"task": {"id": "task-001"}})

    def test_empty_artifact_list_raises_err_no_artifact(self) -> None:
        with self.assertRaisesRegex(ValueError, "ERR_NO_ARTIFACT"):
            extract_artifact_from_rpc({"task": {"id": "task-001", "artifacts": []}})

    def test_no_text_part_raises_err_no_text_part(self) -> None:
        result = {
            "task": {
                "id": "task-001",
                "artifacts": [{"parts": [{"mediaType": "text/plain"}]}],
            }
        }
        with self.assertRaisesRegex(ValueError, "ERR_NO_TEXT_PART"):
            extract_artifact_from_rpc(result)

    def test_multiple_text_parts_are_joined(self) -> None:
        result = _pi_reply()
        parts = result["task"]["artifacts"][0]["parts"]
        parts.append({"text": "END_OF_REPORT"})
        artifact = extract_artifact_from_rpc(result)
        self.assertIn("END_OF_REPORT", artifact["stdout_summary"])
        self.assertEqual(artifact["workspace_dir"], "/data/data/com.termux/files/home/workspace/projects/a2a_e2e")

    def test_malformed_sha256_is_reported_by_validator(self) -> None:
        result = _pi_reply()
        result["task"]["artifacts"][0]["parts"][0]["text"] = (
            "- File: `/data/data/com.termux/files/home/workspace/projects/a2a_e2e/probe.txt`\n"
            "- Content: `pong`\n"
            "- SHA256: `Z9Z`\n"
            "- Exit code: `0`"
        )
        # The extractor's hash regex only accepts 64 lowercase hex characters,
        # so simulating downstream corruption requires replacing the extracted value.
        artifact = extract_artifact_from_rpc(_pi_reply())
        artifact["changed_files"][0]["sha256"] = "Z9Z"
        errors = artifact_validator.validate_artifact(artifact)
        self.assertIn("ERR_ARTIFACT_SHA256_MALFORMED", errors)

    def test_file_outside_workspace_is_reported_by_validator(self) -> None:
        result = _pi_reply()
        result["task"]["artifacts"][0]["parts"][0]["text"] = result["task"]["artifacts"][0]["parts"][0]["text"].replace(
            "/data/data/com.termux/files/home/workspace/projects/a2a_e2e/probe.txt",
            "/tmp/probe.txt",
        )
        artifact = extract_artifact_from_rpc(result)
        errors = artifact_validator.validate_artifact(artifact)
        self.assertIn("ERR_ARTIFACT_WORKSPACE_OUTSIDE_ROOT", errors)

    def test_single_line_comma_records_create_two_entries(self) -> None:
        result = {
            "task": {
                "id": "task-a2a-e2e-002",
                "artifacts": [
                    {
                        "parts": [
                            {
                                "text": "\n".join(
                                    _metadata_lines("step_multi")
                                    + [
                                        "File: /data/data/com.termux/files/home/workspace/projects/a2a_multi/one.txt, "
                                        "Content: alpha, "
                                        "SHA256: b6a98d9ce9a2d9149288fa3df42d377c3e42737afdcdaf714e33c0a100b51060, "
                                        "Exit code: 0",
                                        "File: /data/data/com.termux/files/home/workspace/projects/a2a_multi/two.txt, "
                                        "Content: beta, "
                                        "SHA256: f2c82decdd7181cf98945929a62598db7e6b477e11f6e0eb0ae97020eff151ad, "
                                        "Exit code: 0",
                                    ]
                                )
                            }
                        ]
                    }
                ],
                "status": {"timestamp": "2026-10-28T09:00:00+08:00"},
            }
        }
        artifact = extract_artifact_from_rpc(result)
        errors = artifact_validator.validate_artifact(artifact)
        self.assertEqual(errors, [])
        self.assertEqual(
            artifact["workspace_dir"],
            "/data/data/com.termux/files/home/workspace/projects/a2a_multi",
        )
        self.assertEqual(
            [item["path"] for item in artifact["changed_files"]],
            ["one.txt", "two.txt"],
        )
        self.assertEqual(
            [item["sha256"] for item in artifact["changed_files"]],
            [
                "b6a98d9ce9a2d9149288fa3df42d377c3e42737afdcdaf714e33c0a100b51060",
                "f2c82decdd7181cf98945929a62598db7e6b477e11f6e0eb0ae97020eff151ad",
            ],
        )
        self.assertEqual(
            [item["action"] for item in artifact["changed_files"]],
            ["created", "created"],
        )
        self.assertEqual(artifact["exit_code"], 0)

    def test_plain_multiline_records_are_split_and_hashed(self) -> None:
        result = {
            "task": {
                "id": "task-a2a-e2e-003",
                "artifacts": [
                    {
                        "parts": [
                            {
                                "text": "\n".join(
                                    _metadata_lines("step_plain")
                                    + [
                                        "File: /data/data/com.termux/files/home/workspace/projects/a2a_multi/one.txt",
                                        "Content: alpha",
                                        "SHA256: b6a98d9ce9a2d9149288fa3df42d377c3e42737afdcdaf714e33c0a100b51060",
                                        "Exit code: 0",
                                        "File: /data/data/com.termux/files/home/workspace/projects/a2a_multi/two.txt",
                                        "Content: beta",
                                        "SHA256: f2c82decdd7181cf98945929a62598db7e6b477e11f6e0eb0ae97020eff151ad",
                                        "Exit code: 0",
                                    ]
                                )
                            }
                        ]
                    }
                ],
                "status": {"timestamp": "2026-10-28T09:00:00+08:00"},
            }
        }
        artifact = extract_artifact_from_rpc(result)
        errors = artifact_validator.validate_artifact(artifact)
        self.assertEqual(errors, [])
        self.assertEqual(len(artifact["changed_files"]), 2)
        self.assertEqual(
            artifact["workspace_dir"],
            "/data/data/com.termux/files/home/workspace/projects/a2a_multi",
        )

    def test_nested_paths_use_deepest_common_workspace_prefix(self) -> None:
        result = {
            "task": {
                "id": "task-a2a-e2e-004",
                "artifacts": [
                    {
                        "parts": [
                            {
                                "text": "\n".join(
                                    _metadata_lines("step_nested")
                                    + [
                                        "File: /data/data/com.termux/files/home/workspace/projects/a2a_multi/src/one.txt",
                                        "SHA256: b6a98d9ce9a2d9149288fa3df42d377c3e42737afdcdaf714e33c0a100b51060",
                                        "Exit code: 0",
                                        "File: /data/data/com.termux/files/home/workspace/projects/a2a_multi/docs/two.txt",
                                        "SHA256: f2c82decdd7181cf98945929a62598db7e6b477e11f6e0eb0ae97020eff151ad",
                                    ]
                                )
                            }
                        ]
                    }
                ],
                "status": {"timestamp": "2026-10-28T09:00:00+08:00"},
            }
        }
        artifact = extract_artifact_from_rpc(result)
        self.assertEqual(
            artifact["workspace_dir"],
            "/data/data/com.termux/files/home/workspace/projects/a2a_multi",
        )
        self.assertEqual(
            [item["path"] for item in artifact["changed_files"]],
            ["src/one.txt", "docs/two.txt"],
        )
        self.assertEqual(
            [item["action"] for item in artifact["changed_files"]],
            ["modified", "modified"],
        )
        self.assertEqual(artifact["exit_code"], 0)

    def test_record_missing_sha256_raises_field_missing(self) -> None:
        result = {
            "task": {
                "id": "task-a2a-e2e-005",
                "artifacts": [
                    {
                        "parts": [
                            {
                                "text": "\n".join(
                                    _metadata_lines("step_missing_hash")
                                    + [
                                        "File: /data/data/com.termux/files/home/workspace/projects/a2a_multi/one.txt",
                                        "Content: alpha",
                                        "Exit code: 0",
                                    ]
                                )
                            }
                        ]
                    }
                ],
                "status": {"timestamp": "2026-10-28T09:00:00+08:00"},
            }
        }
        with self.assertRaisesRegex(ValueError, "ERR_ARTIFACT_TEXT_FIELD_MISSING"):
            extract_artifact_from_rpc(result)

    def test_missing_metadata_is_rejected_instead_of_synthesized(self) -> None:
        for field in [
            "Step ID",
            "Idempotent status",
            "Script path",
            "Script SHA256",
            "Inputs SHA256",
            "Duration sec",
            "Log file",
        ]:
            with self.subTest(field=field):
                result = _pi_reply()
                text = result["task"]["artifacts"][0]["parts"][0]["text"]
                result["task"]["artifacts"][0]["parts"][0]["text"] = "\n".join(
                    line for line in text.splitlines() if not line.startswith("- {0}:".format(field))
                )
                with self.assertRaisesRegex(ValueError, "ERR_ARTIFACT_TEXT_FIELD_MISSING"):
                    extract_artifact_from_rpc(result)

    def test_missing_task_id_or_timestamp_is_rejected(self) -> None:
        result = _pi_reply()
        del result["task"]["id"]
        with self.assertRaisesRegex(ValueError, "ERR_ARTIFACT_TEXT_FIELD_MISSING"):
            extract_artifact_from_rpc(result)

        result = _pi_reply()
        del result["task"]["status"]["timestamp"]
        with self.assertRaisesRegex(ValueError, "ERR_ARTIFACT_TEXT_FIELD_MISSING"):
            extract_artifact_from_rpc(result)


@unittest.skipUnless(
    os.environ.get("A2A_LIVE_E2E") == "1",
    "set A2A_LIVE_E2E=1 to run the live A2A integration test",
)
class LiveA2AIntegrationTestCase(unittest.TestCase):
    ENDPOINT = "http://127.0.0.1:9910/"

    @classmethod
    def setUpClass(cls) -> None:
        try:
            token = subprocess.run(
                ["ssh", "k40", "cat", "$HOME/.pi/agent/.peer_token"],
                check=True,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=15,
            ).stdout.strip()
        except (OSError, subprocess.SubprocessError) as exc:
            raise unittest.SkipTest("unable to read Pi peer token over ssh: {0}".format(exc))
        if not token:
            raise unittest.SkipTest("Pi peer token is empty")
        cls.token = token
        cls.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def _rpc_post(self, payload: dict, timeout: float = 180.0) -> dict:
        request = urllib.request.Request(
            self.ENDPOINT,
            data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": "Bearer {0}".format(self.token),
            },
            method="POST",
        )
        with self.opener.open(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))

    def _run_live_attempt(self, stamp: str) -> tuple[dict, str, str]:
        project_dir = "/data/data/com.termux/files/home/workspace/projects/a2a_e2e"
        filename = "probe_live_{0}.txt".format(stamp)
        script_name = "run_live_{0}.sh".format(stamp)
        script_path = "{0}/{1}".format(project_dir, script_name)
        step_id = "live_{0}".format(stamp)
        task_id = "task-live-{0}".format(stamp)
        fixture = "\n".join(
            [
                "set -euo pipefail",
                "mkdir -p '{0}/system_logs'".format(project_dir),
                "cat > '{0}' <<'SH'".format(script_path),
                "#!/usr/bin/env bash",
                "set -euo pipefail",
                "printf 'pong_from_live_e2e\\n' > '{0}'".format(filename),
                "SH",
                "chmod 755 '{0}'".format(script_path),
                "rm -f '{0}/.step_{1}.done'".format(project_dir, step_id),
                "rm -rf '{0}/.step_{1}.lock.d'".format(project_dir, step_id),
            ]
        )
        _run_remote_bash(fixture)
        command = (
            "$HOME/bin/pi_idempotent_runner.sh --project a2a_e2e "
            "--task-id {0} --step {1} --script {2} --outputs {3}"
        ).format(task_id, step_id, script_path, filename)
        prompt = (
            "Use exactly one shell command and no other tool calls: {0}. "
            "Return the command stdout verbatim and nothing else. "
            "The stdout is the structured AIMS Artifact JSON."
        ).format(command)
        payload = {
            "jsonrpc": "2.0",
            "id": "rpc-a2a-e2e-live-001",
            "method": "SendMessage",
            "params": {
                "message": {
                    "messageId": "msg-a2a-e2e-live-001",
                    "role": "ROLE_USER",
                    "parts": [{"text": prompt}],
                },
                "configuration": {
                    "acceptedOutputModes": ["text/plain", "application/json"],
                    "returnImmediately": False,
                },
            },
        }
        try:
            response = self._rpc_post(payload, timeout=180.0)
        except (OSError, urllib.error.URLError) as exc:
            raise unittest.SkipTest("A2A server is unreachable: {0}".format(exc))

        self.assertNotIn("error", response)
        return extract_artifact_from_rpc(response["result"]), task_id, step_id

    def test_live_send_message_creates_and_hashes_file(self) -> None:
        artifact = None
        task_id = ""
        step_id = ""
        for attempt in range(2):
            stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
            try:
                artifact, task_id, step_id = self._run_live_attempt(stamp)
                break
            except (OSError, urllib.error.URLError, ValueError, AssertionError) as exc:
                if attempt == 0:
                    time.sleep(2)
                    continue
                raise
        if artifact is None:
            self.fail("live A2A did not return an Artifact after two attempts")

        errors = artifact_validator.validate_artifact(artifact)
        self.assertEqual(errors, [])
        self.assertEqual(artifact["task_id"], task_id)
        self.assertEqual(artifact["step_id"], step_id)
        self.assertEqual(artifact["exit_code"], 0)
        remote_path = "{0}/{1}".format(
            artifact["workspace_dir"].rstrip("/"),
            artifact["changed_files"][0]["path"],
        )
        remote_hash = subprocess.run(
            ["ssh", "k40", "sha256sum", remote_path],
            check=True,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=15,
        ).stdout.split()[0]
        self.assertEqual(artifact["changed_files"][0]["sha256"], remote_hash)


if __name__ == "__main__":
    unittest.main()
