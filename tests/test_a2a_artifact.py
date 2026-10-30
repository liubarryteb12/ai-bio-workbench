#!/usr/bin/env python3
"""A2A structured artifact validator tests. Run from the repo root."""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import tempfile
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
        "step_id": "step_01",
        "idempotent_status": "fresh_run",
        "executed_at": "2026-10-28T09:00:00+08:00",
        "workspace_dir": "/data/data/com.termux/files/home/workspace/projects/demo",
        "script_path": "./calc.py",
        "script_sha256": "b6a98d9ce9a2d9149288fa3df42d377c3e42737afdcdaf714e33c0a100b51060",
        "inputs_sha256": "no_inputs_declared",
        "exit_code": 0,
        "duration_sec": 0.14,
        "log_file": "/data/data/com.termux/files/home/workspace/projects/demo/system_logs/step_01.log",
        "changed_files": [
            {
                "path": "projects/demo/calc.py",
                "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                "action": "verified",
            }
        ],
        "stdout_summary": "1 test passed",
        "stderr_summary": "",
    }


def acceptance_record(artifact: dict, passed: bool = True) -> dict:
    return {
        "passed": passed,
        "exit_code": artifact["exit_code"],
        "script_sha256": artifact["script_sha256"],
        "inputs_sha256": artifact["inputs_sha256"],
        "changed_files": copy.deepcopy(artifact["changed_files"]),
        "log_file": artifact["log_file"],
        "checks": [
            {"name": "exit_code", "passed": passed, "detail": str(artifact["exit_code"])},
            {"name": "artifact_hashes", "passed": passed, "detail": "verified"},
        ],
    }


class ValidateArtifactTestCase(unittest.TestCase):
    def test_valid_artifact_has_no_errors(self) -> None:
        self.assertEqual(artifact_validator.validate_artifact(valid_artifact()), [])

    def test_container_root_artifact_has_no_errors(self) -> None:
        payload = valid_artifact()
        payload["workspace_dir"] = "/mnt/ssd/bio_data/projects/demo"
        payload["script_path"] = "/mnt/ssd/bio_data/projects/demo/run.sh"
        payload["log_file"] = "/mnt/ssd/bio_data/projects/demo/system_logs/step_01.log"
        payload["changed_files"][0]["path"] = "calc.py"
        self.assertEqual(artifact_validator.validate_artifact(payload), [])

    def test_termux_absolute_script_and_log_paths_are_accepted(self) -> None:
        payload = valid_artifact()
        payload["script_path"] = (
            "/data/data/com.termux/files/home/workspace/projects/demo/run.sh"
        )
        self.assertEqual(artifact_validator.validate_artifact(payload), [])

    def test_each_missing_required_field_is_reported(self) -> None:
        required = (
            "task_id",
            "step_id",
            "idempotent_status",
            "executed_at",
            "workspace_dir",
            "script_path",
            "script_sha256",
            "inputs_sha256",
            "exit_code",
            "duration_sec",
            "log_file",
            "changed_files",
            "stdout_summary",
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

    def test_workspace_traversal_is_reported(self) -> None:
        payload = valid_artifact()
        payload["workspace_dir"] = (
            "/data/data/com.termux/files/home/workspace/../../outside"
        )
        self.assertIn(
            "ERR_ARTIFACT_WORKSPACE_OUTSIDE_ROOT",
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

    def test_oversize_ascii_wire_payload_is_reported(self) -> None:
        payload = valid_artifact()
        payload["stdout_summary"] = "\U0001f600" * 360_000
        self.assertIn("ERR_ARTIFACT_OVERSIZE", artifact_validator.validate_artifact(payload))

    def test_exit_code_must_be_integer(self) -> None:
        payload = valid_artifact()
        payload["exit_code"] = "0"
        self.assertIn(
            "ERR_ARTIFACT_FIELD_TYPE:exit_code",
            artifact_validator.validate_artifact(payload),
        )

    def test_nonzero_exit_code_is_rejected(self) -> None:
        payload = valid_artifact()
        payload["exit_code"] = 1
        self.assertIn(
            "ERR_ARTIFACT_EXIT_CODE_NONZERO",
            artifact_validator.validate_artifact(payload),
        )

    def test_script_sha256_must_be_lowercase_64_hex(self) -> None:
        payload = valid_artifact()
        payload["script_sha256"] = "ABC"
        self.assertIn(
            "ERR_ARTIFACT_SHA256_MALFORMED:script_sha256",
            artifact_validator.validate_artifact(payload),
        )

    def test_inputs_sha256_accepts_sentinel_or_lowercase_64_hex(self) -> None:
        payload = valid_artifact()
        payload["inputs_sha256"] = "no_inputs_declared"
        self.assertEqual(artifact_validator.validate_artifact(payload), [])
        payload["inputs_sha256"] = "a" * 64
        self.assertEqual(artifact_validator.validate_artifact(payload), [])

    def test_inputs_sha256_rejects_other_values(self) -> None:
        for value in ("", "A" * 64, "missing_input:expr.tsv", "a" * 63):
            with self.subTest(value=value):
                payload = valid_artifact()
                payload["inputs_sha256"] = value
                self.assertIn(
                    "ERR_ARTIFACT_INPUTS_SHA256_MALFORMED",
                    artifact_validator.validate_artifact(payload),
                )

    def test_idempotent_status_is_whitelisted(self) -> None:
        payload = valid_artifact()
        payload["idempotent_status"] = "unknown"
        self.assertIn(
            "ERR_ARTIFACT_IDEMPOTENT_STATUS_INVALID",
            artifact_validator.validate_artifact(payload),
        )

    def test_script_and_log_paths_reject_traversal(self) -> None:
        payload = valid_artifact()
        payload["script_path"] = "../outside.py"
        payload["log_file"] = "/tmp/step.log"
        errors = artifact_validator.validate_artifact(payload)
        self.assertIn("ERR_ARTIFACT_PATH_UNSAFE:script_path", errors)
        self.assertIn("ERR_ARTIFACT_PATH_UNSAFE:log_file", errors)

    def test_artifact_paths_reject_prefix_leakage_fuse_and_nul(self) -> None:
        unsafe = (
            "/mnt/ssd/bio_data_evil/projects/demo/run.sh",
            "/sdcard/projects/demo/run.sh",
            "/storage/self/primary/projects/demo/run.sh",
            "/mnt/ssd/bio_data/projects/demo/run.tsv\0.txt",
        )
        for value in unsafe:
            with self.subTest(field="workspace_dir", value=value):
                payload = valid_artifact()
                payload["workspace_dir"] = value
                self.assertIn(
                    "ERR_ARTIFACT_WORKSPACE_OUTSIDE_ROOT",
                    artifact_validator.validate_artifact(payload),
                )
            for field in ("script_path", "log_file"):
                with self.subTest(field=field, value=value):
                    payload = valid_artifact()
                    payload[field] = value
                    self.assertIn(
                        f"ERR_ARTIFACT_PATH_UNSAFE:{field}",
                        artifact_validator.validate_artifact(payload),
                    )


class AcceptanceStateMachineTestCase(unittest.TestCase):
    def test_completed_task_requires_both_acceptance_layers(self) -> None:
        payload = valid_artifact()
        payload["preliminary_acceptance"] = acceptance_record(payload)
        payload["final_acceptance"] = {
            **acceptance_record(payload),
            "verifier": "codex",
            "verified_at": "2026-10-28T09:01:00+08:00",
            "modification_scope": "within_workspace",
        }
        self.assertEqual(
            artifact_validator.validate_completion_artifact(payload),
            [],
        )
        self.assertEqual(
            artifact_validator.evaluate_task_completion(payload)["state"],
            "completed",
        )

    def test_missing_final_acceptance_keeps_task_incomplete(self) -> None:
        payload = valid_artifact()
        payload["preliminary_acceptance"] = acceptance_record(payload)
        errors = artifact_validator.validate_completion_artifact(payload)
        self.assertIn("ERR_ACCEPTANCE_FIELD_MISSING:final_acceptance", errors)
        self.assertEqual(
            artifact_validator.evaluate_task_completion(payload)["state"],
            "working",
        )

    def test_preliminary_false_positive_cannot_complete(self) -> None:
        payload = valid_artifact()
        payload["preliminary_acceptance"] = acceptance_record(payload, passed=False)
        payload["final_acceptance"] = {
            **acceptance_record(payload),
            "verifier": "codex",
            "verified_at": "2026-10-28T09:01:00+08:00",
            "modification_scope": "within_workspace",
        }
        errors = artifact_validator.validate_completion_artifact(payload)
        self.assertIn("ERR_ACCEPTANCE_PASSED_FALSE:preliminary_acceptance", errors)

    def test_final_acceptance_hash_mismatch_is_rejected(self) -> None:
        payload = valid_artifact()
        payload["preliminary_acceptance"] = acceptance_record(payload)
        final = {
            **acceptance_record(payload),
            "verifier": "codex",
            "verified_at": "2026-10-28T09:01:00+08:00",
            "modification_scope": "within_workspace",
        }
        final["changed_files"] = copy.deepcopy(final["changed_files"])
        final["changed_files"][0]["sha256"] = "f" * 64
        payload["final_acceptance"] = final
        errors = artifact_validator.validate_completion_artifact(payload)
        self.assertIn("ERR_ACCEPTANCE_MISMATCH:final_acceptance.changed_files", errors)

    def test_final_acceptance_must_be_independent_codex_verification(self) -> None:
        payload = valid_artifact()
        payload["preliminary_acceptance"] = acceptance_record(payload)
        payload["final_acceptance"] = {
            **acceptance_record(payload),
            "verifier": "pi",
            "verified_at": "2026-10-28T09:01:00+08:00",
            "modification_scope": "within_workspace",
        }
        errors = artifact_validator.validate_completion_artifact(payload)
        self.assertIn("ERR_ACCEPTANCE_VERIFIER_INVALID:final_acceptance", errors)

    def test_codex_builder_rejects_pi_hash_false_positive(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = root / "result.tsv"
            output.write_text("actual content\n", encoding="utf-8")

            payload = valid_artifact()
            payload["changed_files"] = [
                {
                    "path": "result.tsv",
                    "sha256": "0" * 64,
                    "action": "created",
                }
            ]
            payload["preliminary_acceptance"] = acceptance_record(payload)
            final = artifact_validator.build_final_acceptance(
                payload,
                workspace_root=root,
                command_results=[
                    {"command": "test -s result.tsv", "exit_code": 0}
                ],
            )
        self.assertFalse(final["passed"])
        self.assertIn(
            "ERR_FINAL_ACCEPTANCE_FILE_HASH_MISMATCH:result.tsv",
            final["errors"],
        )

    def test_codex_builder_independently_verifies_script_hash(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            script = root / "run.sh"
            script.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")

            payload = valid_artifact()
            payload["workspace_dir"] = (
                "/data/data/com.termux/files/home/workspace/projects/demo"
            )
            payload["script_path"] = "./run.sh"
            payload["script_sha256"] = "0" * 64
            payload["inputs_sha256"] = "no_inputs_declared"
            payload["changed_files"] = []
            payload["preliminary_acceptance"] = acceptance_record(payload)

            final = artifact_validator.build_final_acceptance(
                payload,
                workspace_root=root,
                command_results=[
                    {"command": "test -s run.sh", "exit_code": 0}
                ],
            )

        self.assertFalse(final["passed"])
        self.assertIn(
            "ERR_FINAL_ACCEPTANCE_SCRIPT_HASH_MISMATCH",
            final["errors"],
        )

    def test_codex_builder_independently_verifies_input_hash(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            script = root / "run.sh"
            script.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            input_path = root / "data" / "input.tsv"
            input_path.parent.mkdir()
            input_path.write_text("abc\n", encoding="utf-8")

            payload = valid_artifact()
            payload["workspace_dir"] = (
                "/data/data/com.termux/files/home/workspace/projects/demo"
            )
            payload["script_path"] = "./run.sh"
            payload["script_sha256"] = hashlib.sha256(script.read_bytes()).hexdigest()
            payload["inputs_sha256"] = "0" * 64
            payload["changed_files"] = []
            payload["preliminary_acceptance"] = acceptance_record(payload)

            final = artifact_validator.build_final_acceptance(
                payload,
                workspace_root=root,
                command_results=[
                    {"command": "test -s data/input.tsv", "exit_code": 0}
                ],
                input_paths=["data/input.tsv"],
            )

        self.assertFalse(final["passed"])
        self.assertIn(
            "ERR_FINAL_ACCEPTANCE_INPUTS_HASH_MISMATCH",
            final["errors"],
        )

    def test_dispatch_path_guard_rejects_container_only_path_for_termux(self) -> None:
        task = {
            "workspace_dir": "/mnt/ssd/bio_data/projects/demo",
            "script_path": "scripts/run.py",
            "inputs": ["data/input.tsv"],
            "outputs": ["results/result.tsv"],
        }
        errors = artifact_validator.validate_dispatch_paths(task, runtime="termux")
        self.assertIn("ERR_TASK_PATH_NOT_VISIBLE:workspace_dir", errors)

        task["workspace_dir"] = "$HOME/workspace/projects/demo"
        self.assertEqual(
            artifact_validator.validate_dispatch_paths(task, runtime="termux"),
            [],
        )

    def test_dispatch_path_guard_keeps_k40_runtime_isolated(self) -> None:
        task = {
            "workspace_dir": "/mnt/ssd/bio_data/projects/demo",
            "script_path": "/mnt/ssd/bio_data/projects/demo/scripts/run.py",
            "inputs": ["data/input.tsv"],
            "outputs": ["results/result.tsv"],
        }
        self.assertEqual(
            artifact_validator.validate_dispatch_paths(task, runtime="k40"),
            [],
        )

        task["workspace_dir"] = "$HOME/workspace/projects/demo"
        task["script_path"] = "scripts/run.py"
        errors = artifact_validator.validate_dispatch_paths(task, runtime="k40")
        self.assertIn("ERR_TASK_PATH_NOT_VISIBLE:workspace_dir", errors)


if __name__ == "__main__":
    unittest.main()

