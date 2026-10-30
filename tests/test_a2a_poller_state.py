#!/usr/bin/env python3
"""Regression tests for per-project A2A task state persistence."""

from __future__ import annotations

import importlib.util
import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
POLLER = REPO / "src" / "engines" / "a2a-rpc-engine" / "a2a_client_poller.py"


def load_poller():
    spec = importlib.util.spec_from_file_location("a2a_client_poller_state", POLLER)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class A2APollerStateTestCase(unittest.TestCase):
    @staticmethod
    def _completed_task_with_preliminary() -> dict:
        artifact = {
            "task_id": "task-acceptance-1",
            "step_id": "step-1",
            "idempotent_status": "fresh_run",
            "executed_at": "2026-10-29T10:00:00+08:00",
            "workspace_dir": (
                "/data/data/com.termux/files/home/workspace/projects/PRJ_AIMS"
            ),
            "script_path": "./run.sh",
            "script_sha256": "a" * 64,
            "inputs_sha256": "no_inputs_declared",
            "exit_code": 0,
            "duration_sec": 0.1,
            "log_file": (
                "/data/data/com.termux/files/home/workspace/projects/"
                "PRJ_AIMS/system_logs/step-1.log"
            ),
            "changed_files": [],
            "stdout_summary": "ok",
        }
        artifact["preliminary_acceptance"] = {
            "passed": True,
            "exit_code": 0,
            "script_sha256": artifact["script_sha256"],
            "inputs_sha256": artifact["inputs_sha256"],
            "changed_files": [],
            "log_file": artifact["log_file"],
            "checks": [{"name": "self_check", "passed": True, "detail": "ok"}],
        }
        return {
            "id": "task-acceptance-1",
            "status": {"state": "completed"},
            "artifacts": [
                {
                    "parts": [
                        {
                            "text": json.dumps(artifact, ensure_ascii=False),
                            "mediaType": "text/plain",
                        }
                    ]
                }
            ],
        }

    def test_default_state_file_is_per_project_and_resumes_after_restart(self) -> None:
        module = load_poller()
        previous_root = os.environ.get("CODEX_WORKSPACE_ROOT")
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["CODEX_WORKSPACE_ROOT"] = tmp
            try:
                client = module.A2AClientPoller(
                    endpoint="http://127.0.0.1:1",
                    bearer_token="x" * 48,
                    backoff_schedule_sec=(0.01,),
                )
                sent = []
                client.send_message = lambda prompt, return_immediately=False: (
                    sent.append(prompt)
                    or {"id": "task-1", "status": {"state": "working"}}
                )
                client.poll_existing_task = lambda task_id, max_wait_sec=3600.0, state_file=None: {
                    "id": task_id,
                    "status": {"state": "completed"},
                }

                client.dispatch_idempotent_step("PRJ_AIMS", "step-1", "./run.sh", "out.tsv")
                state_path = (
                    Path(tmp)
                    / "local_projects"
                    / "PRJ_AIMS"
                    / "debug"
                    / "active_a2a_task.json"
                )
                self.assertTrue(state_path.exists())
                self.assertEqual(json.loads(state_path.read_text(encoding="utf-8")), {
                    "project_id": "PRJ_AIMS",
                    "step_id": "step-1",
                    "task_id": "task-1",
                })
                self.assertEqual(len(sent), 1)

                restarted = module.A2AClientPoller(
                    endpoint="http://127.0.0.1:1",
                    bearer_token="x" * 48,
                    backoff_schedule_sec=(0.01,),
                )
                resent = []
                resumed = []
                restarted.send_message = lambda prompt, return_immediately=False: (
                    resent.append(prompt)
                    or {"id": "task-2", "status": {"state": "working"}}
                )
                restarted.poll_existing_task = lambda task_id, max_wait_sec=3600.0, state_file=None: (
                    resumed.append(task_id)
                    or {"id": task_id, "status": {"state": "completed"}}
                )
                restarted.dispatch_idempotent_step(
                    "PRJ_AIMS", "step-1", "./run.sh", "out.tsv"
                )
                self.assertEqual(resent, [])
                self.assertEqual(resumed, ["task-1"])
            finally:
                if previous_root is None:
                    os.environ.pop("CODEX_WORKSPACE_ROOT", None)
                else:
                    os.environ["CODEX_WORKSPACE_ROOT"] = previous_root

    def test_completed_task_with_only_preliminary_awaits_codex_final_acceptance(self) -> None:
        module = load_poller()
        client = module.A2AClientPoller(
            endpoint="http://127.0.0.1:1",
            bearer_token="x" * 48,
            backoff_schedule_sec=(0.01,),
        )
        task = self._completed_task_with_preliminary()

        evaluation = client.evaluate_task(task)

        self.assertEqual(evaluation["state"], "awaiting_final_acceptance")
        self.assertFalse(evaluation["passed"])
        self.assertEqual(task["status"]["state"], "awaiting_final_acceptance")
        self.assertIn(
            "ERR_ACCEPTANCE_FIELD_MISSING:final_acceptance",
            evaluation["errors"],
        )

    def test_invalid_base_artifact_is_not_misclassified_as_awaiting_final(self) -> None:
        module = load_poller()
        client = module.A2AClientPoller(
            endpoint="http://127.0.0.1:1",
            bearer_token="x" * 48,
            backoff_schedule_sec=(0.01,),
        )
        task = self._completed_task_with_preliminary()
        artifact = json.loads(task["artifacts"][0]["parts"][0]["text"])
        artifact["script_sha256"] = "bad"
        artifact["preliminary_acceptance"]["script_sha256"] = "bad"
        task["artifacts"][0]["parts"][0]["text"] = json.dumps(artifact)

        evaluation = client.evaluate_task(task)

        self.assertEqual(evaluation["state"], "acceptance_failed")
        self.assertIn(
            "ERR_ARTIFACT_SHA256_MALFORMED:script_sha256",
            evaluation["errors"],
        )

    def test_dispatch_idempotent_step_does_not_return_remote_completed_as_final(self) -> None:
        module = load_poller()
        client = module.A2AClientPoller(
            endpoint="http://127.0.0.1:1",
            bearer_token="x" * 48,
            backoff_schedule_sec=(0.01,),
            state_file=str(Path(tempfile.gettempdir()) / "unused-a2a-state.json"),
        )
        completed = self._completed_task_with_preliminary()
        client.send_message = lambda prompt, return_immediately=False: {
            "id": "task-acceptance-1",
            "status": {"state": "working"},
        }
        client.poll_existing_task = (
            lambda task_id, max_wait_sec=3600.0, state_file=None: completed
        )

        result = client.dispatch_idempotent_step(
            "PRJ_AIMS",
            "step-1",
            "./run.sh",
        )

        self.assertEqual(result["status"]["state"], "awaiting_final_acceptance")
        self.assertEqual(result["status"]["remote_state"], "completed")

    def test_evaluate_task_builds_independent_codex_final_acceptance(self) -> None:
        module = load_poller()
        client = module.A2AClientPoller(
            endpoint="http://127.0.0.1:1",
            bearer_token="x" * 48,
            backoff_schedule_sec=(0.01,),
        )
        task = self._completed_task_with_preliminary()
        artifact = json.loads(task["artifacts"][0]["parts"][0]["text"])

        with tempfile.TemporaryDirectory() as tmp:
            script = Path(tmp) / "run.sh"
            script.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            output = Path(tmp) / "result.tsv"
            output.write_text("gene\tvalue\nTP53\t1\n", encoding="utf-8")
            digest = hashlib.sha256(output.read_bytes()).hexdigest()
            artifact["script_sha256"] = hashlib.sha256(
                script.read_bytes()
            ).hexdigest()
            artifact["changed_files"] = [
                {"path": "result.tsv", "sha256": digest, "action": "created"}
            ]
            artifact["preliminary_acceptance"]["script_sha256"] = artifact[
                "script_sha256"
            ]
            artifact["preliminary_acceptance"]["changed_files"] = artifact[
                "changed_files"
            ]
            task["artifacts"][0]["parts"][0]["text"] = json.dumps(
                artifact,
                ensure_ascii=False,
            )

            evaluation = client.evaluate_task(
                task,
                workspace_root=tmp,
                command_results=[
                    {"command": "test -s result.tsv", "exit_code": 0}
                ],
            )

        self.assertEqual(evaluation["state"], "completed")
        self.assertTrue(evaluation["passed"])
        self.assertEqual(
            evaluation["artifact"]["final_acceptance"]["verifier"],
            "codex",
        )

    def test_second_evaluation_uses_remote_state_after_local_mirror_mutation(self) -> None:
        module = load_poller()
        client = module.A2AClientPoller(
            endpoint="http://127.0.0.1:1",
            bearer_token="x" * 48,
            backoff_schedule_sec=(0.01,),
        )
        task = self._completed_task_with_preliminary()
        artifact = json.loads(task["artifacts"][0]["parts"][0]["text"])

        with tempfile.TemporaryDirectory() as tmp:
            script = Path(tmp) / "run.sh"
            script.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            artifact["script_sha256"] = hashlib.sha256(
                script.read_bytes()
            ).hexdigest()
            artifact["preliminary_acceptance"]["script_sha256"] = artifact[
                "script_sha256"
            ]
            task["artifacts"][0]["parts"][0]["text"] = json.dumps(
                artifact,
                ensure_ascii=False,
            )

            first = client.evaluate_task(task)
            self.assertEqual(first["state"], "awaiting_final_acceptance")

            second = client.evaluate_task(
                task,
                workspace_root=tmp,
                command_results=[
                    {"command": "test -s run.sh", "exit_code": 0}
                ],
            )

        self.assertEqual(second["state"], "completed")
        self.assertTrue(second["passed"])
        self.assertEqual(second["artifact"]["final_acceptance"]["verifier"], "codex")

    def test_dispatch_rejects_container_only_path_before_send(self) -> None:
        module = load_poller()
        client = module.A2AClientPoller(
            endpoint="http://127.0.0.1:1",
            bearer_token="x" * 48,
            backoff_schedule_sec=(0.01,),
        )
        sent = []
        client.send_message = lambda prompt, return_immediately=False: (
            sent.append(prompt)
            or {"id": "must-not-send", "status": {"state": "working"}}
        )

        with self.assertRaises(module.A2AProtocolError) as raised:
            client.dispatch_idempotent_step(
                "PRJ_AIMS",
                "step-1",
                "./run.sh",
                workspace_dir="/mnt/ssd/bio_data/projects/PRJ_AIMS",
            )

        self.assertEqual(raised.exception.code, "A2A_TASK_PATH_NOT_VISIBLE")
        self.assertEqual(sent, [])


if __name__ == "__main__":
    unittest.main()
