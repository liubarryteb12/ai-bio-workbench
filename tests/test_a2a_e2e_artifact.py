#!/usr/bin/env python3
"""Tests for PC-side extraction and validation of Pi A2A text artifacts."""

from __future__ import annotations

import importlib.util
import json
import os
import re
import subprocess
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


def _require_text_match(text: str, pattern: str) -> str:
    match = re.search(pattern, text, flags=re.MULTILINE)
    if match is None:
        raise ValueError("ERR_ARTIFACT_TEXT_FIELD_MISSING")
    return match.group(1)


def _match_optional_text(text: str, pattern: str) -> str | None:
    match = re.search(pattern, text)
    if match is None:
        return None
    return match.group(1)


def _common_posix_parent(file_paths: list[PurePosixPath]) -> PurePosixPath:
    parents = [file_path.parent for file_path in file_paths]
    if all(parent == parents[0] for parent in parents[1:]):
        return parents[0]

    common_parts: list[str] = []
    for parts in zip(*(parent.parts for parent in parents)):
        if any(part != parts[0] for part in parts[1:]):
            break
        common_parts.append(parts[0])
    return PurePosixPath(*common_parts)


def _relative_to_workspace(file_path: PurePosixPath, workspace_dir: PurePosixPath) -> str:
    return file_path.relative_to(workspace_dir).as_posix()


def extract_artifact_from_rpc(result: dict) -> dict:
    """Convert text artifacts in an A2A result into a validator artifact."""
    task = result.get("task") if isinstance(result, dict) else None
    if not isinstance(task, dict):
        raise ValueError("ERR_NO_TASK")

    artifacts = task.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        raise ValueError("ERR_NO_ARTIFACT")

    texts = []
    for artifact in artifacts[0].get("parts", []):
        text = artifact.get("text")
        if isinstance(text, str):
            texts.append(text)
    if not texts:
        raise ValueError("ERR_NO_TEXT_PART")
    text = "\n".join(texts)

    file_anchors = list(re.finditer(r"^-?\s*File:", text, flags=re.MULTILINE))
    if not file_anchors:
        raise ValueError("ERR_ARTIFACT_TEXT_FIELD_MISSING")

    records = []
    for index, anchor in enumerate(file_anchors):
        record_end = file_anchors[index + 1].start() if index + 1 < len(file_anchors) else len(text)
        records.append(text[anchor.start():record_end])
    parsed_records = []
    for record in records:
        file_text = _require_text_match(record, r"File:\s*`?([^,`\n]+?)`?\s*(?=$|,)")
        content = _match_optional_text(
            record,
            r"Content:\s*`?([^\n`]*?)`?\s*(?:\+\s*trailing newline[^\n]*)?\s*(?=$|,)",
        )
        sha256 = _require_text_match(record, r"SHA256:\s*`?([0-9a-f]{64})`?")
        exit_code_text = _match_optional_text(record, r"Exit code:\s*`?(\d+)`?")
        parsed_records.append(
            {
                "file_path": PurePosixPath(file_text),
                "content": content,
                "sha256": sha256,
                "exit_code": exit_code_text,
            }
        )

    exit_code_text = next(
        (parsed["exit_code"] for parsed in parsed_records if parsed["exit_code"] is not None),
        None,
    )
    if exit_code_text is None:
        raise ValueError("ERR_ARTIFACT_TEXT_FIELD_MISSING")
    try:
        exit_code = int(exit_code_text)
    except ValueError as exc:
        raise ValueError("ERR_ARTIFACT_EXIT_CODE_MALFORMED") from exc

    timestamp = task.get("status", {}).get("timestamp")
    if not isinstance(timestamp, str):
        timestamp = datetime.now(timezone.utc).isoformat()

    file_paths = [parsed["file_path"] for parsed in parsed_records]
    workspace_path = _common_posix_parent(file_paths)
    changed_files = [
        {
            "path": _relative_to_workspace(parsed["file_path"], workspace_path),
            "sha256": parsed["sha256"],
            "action": "created" if parsed["content"] is not None else "modified",
        }
        for parsed in parsed_records
    ]

    return {
        "task_id": task.get("id"),
        "executed_at": timestamp,
        "workspace_dir": workspace_path.as_posix(),
        "command_or_action": "pi_task",
        "exit_code": exit_code,
        "duration_sec": 0,
        "changed_files": changed_files,
        "stdout_summary": text,
        "stderr_summary": "",
    }


def _pi_reply() -> dict:
    path = "/data/data/com.termux/files/home/workspace/projects/a2a_e2e/probe.txt"
    content = "pong_from_pi_20261028\n"
    text = "\n".join(
        [
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
        self.assertEqual(artifact["duration_sec"], 0)
        self.assertEqual(artifact["command_or_action"], "pi_task")
        self.assertEqual(artifact["stderr_summary"], "")
        self.assertIn("- File: `", artifact["stdout_summary"])

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
        result["task"]["artifacts"][0]["parts"][0]["text"] = (
            "- File: `/tmp/probe.txt`\n"
            "- Content: `pong`\n"
            "- SHA256: `2f76f94f886c744b01826e4cd78f0e51b83a377418d63a4bb87836b2ab9a1a97`\n"
            "- Exit code: `0`"
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
                                    [
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
                                    [
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
                                    [
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
                                    [
                                        "File: /data/data/com.termux/files/home/workspace/projects/a2a_multi/one.txt",
                                        "Content: alpha",
                                        "Exit code: 0",
                                    ]
                                )
                            }
                        ]
                    }
                ],
            }
        }
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

    def _rpc_post(self, payload: dict, timeout: float = 15.0) -> dict:
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

    def test_live_send_message_creates_and_hashes_file(self) -> None:
        filename = "a2a_e2e_{0}.txt".format(datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S"))
        prompt = (
            "Create exactly one file at /data/data/com.termux/files/home/workspace/projects/a2a_e2e/{0}. "
            "Content must be the single line pong_from_live_e2e followed by one trailing newline. "
            "Reply with the same human-readable lines as the previous probe: File, Content, SHA256, Exit code."
        ).format(filename)
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
            response = self._rpc_post(payload, timeout=30.0)
        except (OSError, urllib.error.URLError) as exc:
            raise unittest.SkipTest("A2A server is unreachable: {0}".format(exc))

        self.assertNotIn("error", response)
        artifact = extract_artifact_from_rpc(response["result"])
        errors = artifact_validator.validate_artifact(artifact)
        self.assertEqual(errors, [])
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
