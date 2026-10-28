#!/usr/bin/env python3
"""A2A structured artifact validator tests. Run from the repo root."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MODULE_PATH = REPO_ROOT / "src" / "engines" / "artifact-sync-engine" / "artifact_validator.py"

spec = importlib.util.spec_from_file_location("artifact_validator", MODULE_PATH)
assert spec is not None and spec.loader is not None
artifact_validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(artifact_validator)


def valid_artifact() -> dict:
    return {
        "task_id": "task-001",
        "executed_at": "2026-10-28T09:00:00+08:00",
        "workspace_dir": "/data/data/com.termux/files/home/workspace/projects/demo",
        "command_or_action": "python3 -m unittest tests/test_a2a_artifact.py",
        "exit_code": 0,
        "duration_sec": 0.14,
        "changed_files": [
            {
                "path": "projects/demo/calc.py",
                "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                "action": "created",
            }
        ],
        "stdout_summary": "1 test passed",
        "stderr_summary": "",
    }


class ValidateArtifactTestCase(unittest.TestCase):
    def test_valid_artifact_has_no_errors(self) -> None:
        self.assertEqual(artifact_validator.validate_artifact(valid_artifact()), [])

    def test_each_missing_required_field_is_reported(self) -> None:
        required = (
            "task_id",
            "executed_at",
            "workspace_dir",
            "command_or_action",
            "exit_code",
            "duration_sec",
            "changed_files",
            "stdout_summary",
            "stderr_summary",
        )
        for field in required:
            with self.subTest(field=field):
                payload = valid_artifact()
                del payload[field]
                self.assertIn(
                    f"ERR_ARTIFACT_FIELD_MISSING:{field}",
                    artifact_validator.validate_artifact(payload),
                )

    def test_malformed_sha256_is_reported(self) -> None:
        payload = valid_artifact()
        payload["changed_files"][0]["sha256"] = "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855"
        self.assertIn(
            "ERR_ARTIFACT_SHA256_MALFORMED",
            artifact_validator.validate_artifact(payload),
        )

    def test_path_traversal_is_reported(self) -> None:
        payload = valid_artifact()
        payload["changed_files"][0]["path"] = "projects/demo/../../etc/passwd"
        self.assertIn(
            "ERR_ARTIFACT_CHANGED_FILE:0:ERR_ARTIFACT_CHANGED_PATH_UNSAFE",
            artifact_validator.validate_artifact(payload),
        )

    def test_sdcard_path_is_reported(self) -> None:
        payload = valid_artifact()
        payload["changed_files"][0]["path"] = "/sdcard/workspace/demo.py"
        self.assertIn(
            "ERR_ARTIFACT_CHANGED_FILE:0:ERR_ARTIFACT_CHANGED_PATH_UNSAFE",
            artifact_validator.validate_artifact(payload),
        )

    def test_oversize_payload_is_reported(self) -> None:
        payload = valid_artifact()
        payload["stdout_summary"] = "x" * (4 * 1024 * 1024 + 1024)
        self.assertIn("ERR_ARTIFACT_OVERSIZE", artifact_validator.validate_artifact(payload))

    def test_exit_code_must_be_integer(self) -> None:
        payload = valid_artifact()
        payload["exit_code"] = "0"
        self.assertIn(
            "ERR_ARTIFACT_FIELD_TYPE:exit_code",
            artifact_validator.validate_artifact(payload),
        )


if __name__ == "__main__":
    unittest.main()

