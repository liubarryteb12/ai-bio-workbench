#!/usr/bin/env python3
"""A2A v1.0 JSON-RPC 2.0 client with task polling and orphan cancellation.

Standard library only. Builds an opener with ProxyHandler({}) so local
system proxies cannot intercept Tailscale traffic.
"""

import json
import os
import secrets
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

ENGINE_ROOT = Path(__file__).resolve().parent.parent
ARTIFACT_ENGINE_ROOT = ENGINE_ROOT / "artifact-sync-engine"
if str(ARTIFACT_ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ARTIFACT_ENGINE_ROOT))

import artifact_validator  # noqa: E402
from artifact_extractor import extract_artifact_from_rpc  # noqa: E402

TERMINAL_STATES = frozenset({"completed", "failed", "canceled", "rejected"})
BACKOFF_SCHEDULE_SEC: Tuple[float, ...] = (5.0, 10.0, 20.0, 30.0)
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
GET_TASK_TIMEOUT_SEC = 30
CANCEL_TASK_TIMEOUT_SEC = 15


class A2AProtocolError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__("[{0}] {1}".format(code, message))
        self.code = code


class A2AClientPoller:
    """Send, poll, and cancel A2A v1.0 tasks over JSON-RPC 2.0 HTTP."""

    def __init__(
        self,
        endpoint: str,
        bearer_token: str,
        blocking_timeout_sec: float = 330.0,
        backoff_schedule_sec: Sequence[float] = BACKOFF_SCHEDULE_SEC,
        state_file: Optional[str] = None,
    ):
        if not endpoint:
            raise ValueError("endpoint must not be empty")
        if not bearer_token:
            raise ValueError("bearer_token must not be empty")
        self.endpoint = endpoint.rstrip("/")
        self.bearer_token = bearer_token
        self.blocking_timeout_sec = blocking_timeout_sec
        self.backoff_schedule_sec = tuple(backoff_schedule_sec)
        self.state_file = state_file
        if not self.backoff_schedule_sec:
            raise ValueError("backoff_schedule_sec must not be empty")
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def _rpc_post(
        self, method: str, params: Dict[str, Any], timeout_sec: float
    ) -> Dict[str, Any]:
        payload = {
            "jsonrpc": "2.0",
            "id": "rpc-{0}".format(uuid.uuid4().hex[:12]),
            "method": method,
            "params": params,
        }
        data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        req = urllib.request.Request(
            "{0}/".format(self.endpoint),
            data=data,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": "Bearer {0}".format(self.bearer_token),
            },
            method="POST",
        )
        try:
            with self.opener.open(req, timeout=timeout_sec) as resp:
                raw = resp.read(MAX_RESPONSE_BYTES + 1)
        except urllib.error.HTTPError as exc:
            detail = ""
            try:
                detail = exc.read(4096).decode("utf-8", errors="replace")
            except Exception:
                pass
            raise A2AProtocolError(
                "A2A_HTTP_ERROR",
                "{0} returned HTTP {1}: {2}".format(method, exc.code, detail),
            ) from exc
        except urllib.error.URLError as exc:
            raise A2AProtocolError(
                "A2A_NETWORK_ERROR", "{0} failed: {1}".format(method, exc.reason)
            ) from exc

        if len(raw) > MAX_RESPONSE_BYTES:
            raise A2AProtocolError(
                "ERR_ARTIFACT_OVERSIZE",
                "response exceeds {0} bytes".format(MAX_RESPONSE_BYTES),
            )

        try:
            body = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise A2AProtocolError(
                "A2A_BAD_RESPONSE", "{0} returned invalid JSON".format(method)
            ) from exc

        if not isinstance(body, dict):
            raise A2AProtocolError(
                "A2A_BAD_RESPONSE", "{0} returned non-object JSON".format(method)
            )

        if body.get("error") is not None:
            raise A2AProtocolError(
                "A2A_RPC_ERROR",
                "{0} JSON-RPC error: {1}".format(
                    method, json.dumps(body["error"], ensure_ascii=True)
                ),
            )

        result = body.get("result")
        if result is None:
            return {}
        return result

    @staticmethod
    def _extract_task(result: Any) -> Dict[str, Any]:
        if isinstance(result, dict) and isinstance(result.get("task"), dict):
            return result["task"]
        if isinstance(result, dict):
            return result
        raise A2AProtocolError(
            "A2A_BAD_RESPONSE",
            "expected a Task object or wrapper, got {0}".format(type(result).__name__),
        )

    @staticmethod
    def _extract_state(task: Dict[str, Any]) -> str:
        status = task.get("status")
        if isinstance(status, dict):
            # evaluate_task() keeps the remote terminal state beside the
            # local acceptance mirror, so a second evaluation must not mistake
            # awaiting_final_acceptance for the phone's actual state.
            state = status.get("remote_state") or status.get("state", "unknown")
        elif isinstance(status, str):
            state = status
        else:
            state = "unknown"
        if isinstance(state, dict):
            state = state.get("name") or state.get("state") or "unknown"
        if not isinstance(state, str):
            state = "unknown"
        state = state.strip().lower()
        if state.startswith("task_state_"):
            state = state[len("task_state_"):]
        return state

    @staticmethod
    def _extract_task_id(task: Dict[str, Any]) -> Optional[str]:
        task_id = task.get("id") or task.get("taskId")
        return str(task_id) if task_id is not None else None

    def send_message(self, prompt: str, return_immediately: bool = False) -> Dict[str, Any]:
        params = {
            "message": {
                "messageId": "msg-{0}".format(uuid.uuid4().hex),
                "role": "ROLE_USER",
                "parts": [{"text": prompt}],
            },
            "configuration": {"returnImmediately": bool(return_immediately)},
        }
        result = self._rpc_post("SendMessage", params, timeout_sec=self.blocking_timeout_sec)
        return self._extract_task(result)

    def get_task(self, task_id: str) -> Dict[str, Any]:
        result = self._rpc_post("GetTask", {"id": task_id}, timeout_sec=GET_TASK_TIMEOUT_SEC)
        return self._extract_task(result)

    def cancel_task(self, task_id: str) -> Dict[str, Any]:
        result = self._rpc_post("CancelTask", {"id": task_id}, timeout_sec=CANCEL_TASK_TIMEOUT_SEC)
        return self._extract_task(result)

    def evaluate_task(
        self,
        task: Dict[str, Any],
        workspace_root: Optional[str] = None,
        command_results: Optional[List[Dict[str, Any]]] = None,
        input_paths: Optional[List[str]] = None,
        verifier: str = "codex",
    ) -> Dict[str, Any]:
        """Require Codex final acceptance before treating a task as complete."""
        if not isinstance(task, dict):
            return {
                "state": "acceptance_failed",
                "passed": False,
                "errors": ["ERR_TASK_NOT_OBJECT"],
                "artifact": None,
                "task": task,
            }

        remote_state = self._extract_state(task)
        if remote_state != "completed":
            return {
                "state": remote_state,
                "passed": False,
                "errors": [],
                "artifact": None,
                "task": task,
            }

        try:
            artifact = extract_artifact_from_rpc({"task": task})
        except ValueError as exc:
            return self._annotate_evaluation(
                task,
                remote_state,
                "acceptance_failed",
                False,
                [str(exc)],
                None,
            )

        base_errors = artifact_validator.validate_artifact(artifact)
        preliminary_errors = artifact_validator.validate_preliminary_acceptance(
            artifact
        )
        if (
            not preliminary_errors
            and "final_acceptance" not in artifact
            and workspace_root is not None
            and command_results is not None
        ):
            artifact["final_acceptance"] = artifact_validator.build_final_acceptance(
                artifact,
                workspace_root=workspace_root,
                command_results=command_results,
                input_paths=input_paths,
                verifier=verifier,
            )
        final_errors = artifact_validator.validate_final_acceptance(artifact)
        completion_errors = list(
            dict.fromkeys(base_errors + preliminary_errors + final_errors)
        )
        if not base_errors and not preliminary_errors and not final_errors:
            state = "completed"
            passed = True
        elif (
            not base_errors
            and not preliminary_errors
            and final_errors == ["ERR_ACCEPTANCE_FIELD_MISSING:final_acceptance"]
        ):
            state = "awaiting_final_acceptance"
            passed = False
        else:
            state = "acceptance_failed"
            passed = False
        return self._annotate_evaluation(
            task,
            remote_state,
            state,
            passed,
            completion_errors,
            artifact,
        )

    @staticmethod
    def _annotate_evaluation(
        task: Dict[str, Any],
        remote_state: str,
        state: str,
        passed: bool,
        errors: List[str],
        artifact: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        status = task.get("status")
        if not isinstance(status, dict):
            status = {}
            task["status"] = status
        status["remote_state"] = remote_state
        status["state"] = state
        return {
            "state": state,
            "passed": passed,
            "errors": list(errors),
            "artifact": artifact,
            "task": task,
        }

    def dispatch_and_wait(
        self,
        prompt: str,
        return_immediately: bool = False,
        max_wait_sec: float = 1800.0,
    ) -> Dict[str, Any]:
        start = time.monotonic()
        task = self.send_message(prompt, return_immediately=return_immediately)
        task_id = self._extract_task_id(task)
        state = self._extract_state(task)

        if state in TERMINAL_STATES or task_id is None:
            return task

        poll_idx = 0
        schedule = self.backoff_schedule_sec
        while (time.monotonic() - start) < max_wait_sec:
            sleep_sec = schedule[min(poll_idx, len(schedule) - 1)]
            elapsed = time.monotonic() - start
            if elapsed + sleep_sec > max_wait_sec:
                break
            time.sleep(sleep_sec)
            poll_idx += 1
            task = self.get_task(task_id)
            state = self._extract_state(task)
            if state in TERMINAL_STATES:
                return task

        if task_id is not None:
            try:
                self.cancel_task(task_id)
            except A2AProtocolError:
                pass
        raise TimeoutError(
            "[ERR_TASK_TIMEOUT] task {0} exceeded {1}s and was sent CancelTask".format(
                task_id, max_wait_sec
            )
        )

    def poll_existing_task(
        self,
        task_id: str,
        max_wait_sec: float = 3600.0,
        tolerate_network: bool = True,
        state_file: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Resume polling a known task id without re-sending SendMessage.

        Used after a client restart or network blip: the phone keeps running
        the task, so the only correct action is GetTask until a terminal state.
        With tolerate_network=True transient connection errors are absorbed and
        polling continues, matching the D-11 resume-on-reconnect contract.
        """
        start = time.monotonic()
        poll_idx = 0
        while (time.monotonic() - start) < max_wait_sec:
            try:
                task = self.get_task(task_id)
                state = self._extract_state(task)
                if state in TERMINAL_STATES:
                    self._clear_state_file(state_file)
                    return task
            except A2AProtocolError:
                if not tolerate_network:
                    raise
            sleep_sec = self.backoff_schedule_sec[min(poll_idx, len(self.backoff_schedule_sec) - 1)]
            elapsed = time.monotonic() - start
            if elapsed + sleep_sec > max_wait_sec:
                break
            time.sleep(sleep_sec)
            poll_idx += 1
        try:
            self.cancel_task(task_id)
        except A2AProtocolError:
            pass
        raise TimeoutError(
            "[ERR_TASK_TIMEOUT] task {0} exceeded {1}s during resume".format(task_id, max_wait_sec)
        )

    def _state_file_for(self, project_id: str) -> str:
        if self.state_file:
            return self.state_file
        if not project_id or project_id in {".", ".."}:
            raise ValueError("project_id must be a non-empty project directory name")
        if os.path.basename(project_id) != project_id or "/" in project_id or "\\" in project_id:
            raise ValueError("project_id must not contain path separators")
        workspace_root = os.environ.get("CODEX_WORKSPACE_ROOT") or os.getcwd()
        return os.path.join(
            workspace_root,
            "local_projects",
            project_id,
            "debug",
            "active_a2a_task.json",
        )

    def _save_state(
        self,
        project_id: str,
        step_id: str,
        task_id: str,
        state_file: Optional[str] = None,
    ) -> None:
        path = state_file or self._state_file_for(project_id)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp_path = path + ".tmp"
        with open(tmp_path, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(
                {"project_id": project_id, "step_id": step_id, "task_id": task_id},
                handle,
            )
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp_path, 0o600)
        os.replace(tmp_path, path)

    def _load_state(
        self, project_id: str, state_file: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        path = state_file or self._state_file_for(project_id)
        try:
            with open(path, encoding="utf-8") as handle:
                return json.load(handle)
        except (OSError, json.JSONDecodeError):
            return None

    def _clear_state_file(self, state_file: Optional[str] = None) -> None:
        path = state_file or self.state_file
        if path:
            try:
                os.remove(path)
            except FileNotFoundError:
                pass

    def dispatch_idempotent_step(
        self,
        project_id: str,
        step_id: str,
        script_path: str,
        expected_outputs: str = "",
        inputs: Optional[Sequence[str]] = None,
        outputs: Optional[Sequence[str]] = None,
        workspace_dir: Optional[str] = None,
        runtime: str = "termux",
        max_wait_sec: float = 3600.0,
    ) -> Dict[str, Any]:
        """Resume an in-flight task for the same step, else dispatch a new one.

        The prompt tells Pi to run the pre-built script through the D-11
        idempotent wrapper, so a repeat dispatch after reconnect can never
        spawn a duplicate process on the phone.
        """
        output_values = (
            list(outputs)
            if outputs is not None
            else [
                item.strip()
                for item in str(expected_outputs).split(",")
                if item.strip()
            ]
        )
        task_paths = {
            "workspace_dir": (
                workspace_dir
                if workspace_dir is not None
                else "$HOME/workspace/projects/{0}".format(project_id)
            ),
            "script_path": script_path,
            "inputs": list(inputs or []),
            "outputs": output_values,
        }
        path_errors = artifact_validator.validate_dispatch_paths(
            task_paths,
            runtime=runtime,
        )
        if path_errors:
            code = (
                "A2A_TASK_PATH_NOT_VISIBLE"
                if any(error.startswith("ERR_TASK_PATH_") for error in path_errors)
                else "A2A_TASK_INVALID"
            )
            raise A2AProtocolError(code, ";".join(path_errors))

        state_file = self._state_file_for(project_id)
        saved = self._load_state(project_id, state_file)
        if (
            saved
            and saved.get("project_id") == project_id
            and saved.get("step_id") == step_id
            and saved.get("task_id")
        ):
            resumed = self.poll_existing_task(
                saved["task_id"], max_wait_sec=max_wait_sec, state_file=state_file
            )
            return self.evaluate_task(resumed)["task"]

        prompt = (
            "Execute pre-built step via the idempotent wrapper. Run exactly:\n"
            "$HOME/bin/pi_idempotent_runner.sh --project {0} --step {1} "
            "--script {2} --outputs '{3}'\n"
            "Do NOT modify the script. Return the JSON output verbatim.".format(
                project_id, step_id, script_path, expected_outputs
            )
        )
        task = self.send_message(prompt, return_immediately=True)
        task_id = self._extract_task_id(task)
        state = self._extract_state(task)
        if state in TERMINAL_STATES or task_id is None:
            return self.evaluate_task(task)["task"]
        self._save_state(project_id, step_id, task_id, state_file)
        completed = self.poll_existing_task(
            task_id, max_wait_sec=max_wait_sec, state_file=state_file
        )
        return self.evaluate_task(completed)["task"]


def _run_self_test() -> int:
    bearer_token = "a2a-selftest-{0}".format(secrets.token_hex(16))
    tasks: Dict[str, Dict[str, Any]] = {}
    canceled_task_ids: List[str] = []

    class _StubA2AHandler(BaseHTTPRequestHandler):
        server_version = "A2AStub/1.0"

        def do_POST(self) -> None:
            auth = self.headers.get("Authorization", "")
            if auth != "Bearer {0}".format(bearer_token):
                self._send_json(401, {"error": {"code": -32001, "message": "unauthorized"}})
                return
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            method = body.get("method", "")
            params = body.get("params", {})

            if method == "SendMessage":
                message = params.get("message", {})
                parts = message.get("parts", [])
                text = parts[0].get("text", "") if parts else ""
                task_id = "task-{0}".format(uuid.uuid4().hex[:8])
                if text == "oversize-test":
                    huge = "x" * (MAX_RESPONSE_BYTES + 1024)
                    result = {
                        "task": {
                            "id": task_id,
                            "status": {"state": "completed"},
                            "artifacts": [{"description": huge}],
                        }
                    }
                    self._send_json(
                        200, {"jsonrpc": "2.0", "id": body.get("id"), "result": result}
                    )
                    return
                if text == "never-complete":
                    tasks[task_id] = {"poll_count": 0, "terminal_after_polls": 999999}
                else:
                    tasks[task_id] = {"poll_count": 0, "terminal_after_polls": 2}
                task = {"id": task_id, "status": {"state": "working"}}
                self._send_json(
                    200,
                    {"jsonrpc": "2.0", "id": body.get("id"), "result": {"task": task}},
                )
            elif method == "GetTask":
                task_id = params.get("id", "")
                entry = tasks.get(task_id)
                if entry is None:
                    self._send_json(
                        200,
                        {
                            "jsonrpc": "2.0",
                            "id": body.get("id"),
                            "error": {"code": -32602, "message": "task not found"},
                        },
                    )
                    return
                entry["poll_count"] += 1
                if entry["poll_count"] >= entry["terminal_after_polls"]:
                    state = "completed"
                else:
                    state = "working"
                self._send_json(
                    200,
                    {
                        "jsonrpc": "2.0",
                        "id": body.get("id"),
                        "result": {"id": task_id, "status": {"state": state}},
                    },
                )
            elif method == "CancelTask":
                task_id = params.get("id", "")
                canceled_task_ids.append(task_id)
                self._send_json(
                    200,
                    {
                        "jsonrpc": "2.0",
                        "id": body.get("id"),
                        "result": {"id": task_id, "status": {"state": "canceled"}},
                    },
                )
            else:
                self._send_json(
                    200,
                    {
                        "jsonrpc": "2.0",
                        "id": body.get("id"),
                        "error": {"code": -32601, "message": "method not found"},
                    },
                )

        def _send_json(self, status_code: int, obj: Dict[str, Any]) -> None:
            data = json.dumps(obj, ensure_ascii=True).encode("utf-8")
            self.send_response(status_code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, format: str, *args: Any) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), _StubA2AHandler)
    server.daemon_threads = True
    port = server.server_address[1]
    endpoint = "http://127.0.0.1:{0}".format(port)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    try:
        client = A2AClientPoller(
            endpoint=endpoint,
            bearer_token=bearer_token,
            blocking_timeout_sec=5,
            backoff_schedule_sec=(0.01,),
        )

        send_task = client.send_message("hello")
        assert send_task.get("id"), "send_message must return a task with an id"
        assert A2AClientPoller._extract_state(send_task) == "working"
        task_id = send_task["id"]

        first_poll = client.get_task(task_id)
        assert A2AClientPoller._extract_state(first_poll) == "working"
        second_poll = client.get_task(task_id)
        assert A2AClientPoller._extract_state(second_poll) == "completed"

        done_task = client.dispatch_and_wait("run-a-job")
        assert A2AClientPoller._extract_state(done_task) == "completed"

        try:
            client.dispatch_and_wait("never-complete", max_wait_sec=1.0)
            raise AssertionError("dispatch_and_wait should raise TimeoutError")
        except TimeoutError as exc:
            assert "ERR_TASK_TIMEOUT" in str(exc), "timeout message must contain ERR_TASK_TIMEOUT"
        assert len(canceled_task_ids) == 1, "CancelTask must be sent on timeout"

        try:
            client.send_message("oversize-test")
            raise AssertionError("send_message should reject oversize response")
        except A2AProtocolError as exc:
            assert exc.code == "ERR_ARTIFACT_OVERSIZE", "expected ERR_ARTIFACT_OVERSIZE"

        print("A2A_POLLER_SELF_TEST_OK")
        return 0
    except Exception as exc:
        print("A2A_POLLER_SELF_TEST_FAIL: {0}".format(exc), file=sys.stderr)
        return 1
    finally:
        server.shutdown()
        server.server_close()


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if "--self-test" in args:
        return _run_self_test()
    print("usage: a2a_client_poller.py --self-test", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
