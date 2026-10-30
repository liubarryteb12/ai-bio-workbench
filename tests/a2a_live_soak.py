#!/usr/bin/env python3
"""Live A2A long-task, screen-off, and GetTask resume soak test.

The task is executed on the phone through pi_idempotent_runner.sh. The PC
client loses the 9910 ADB forward during the run, then resumes only through
GetTask. The phone script increments a counter so duplicate execution is
observable.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "src" / "engines" / "a2a-rpc-engine"))
sys.path.insert(0, str(REPO / "src" / "engines" / "artifact-sync-engine"))

from a2a_client_poller import A2AClientPoller  # noqa: E402
from artifact_extractor import extract_artifact_from_rpc  # noqa: E402
from artifact_validator import validate_artifact  # noqa: E402


PI_SSH = "k40"
ADB_SERIAL = "3a3e1f52"
PHONE_WORKSPACE = "/data/data/com.termux/files/home/workspace/projects/a2a_soak"


def iso_now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def run_remote_bash(script: str, timeout: float = 30.0) -> str:
    encoded = base64.b64encode(script.encode("utf-8")).decode("ascii")
    result = subprocess.run(
        ["ssh", PI_SSH, "printf '%s' '{0}' | base64 -d | bash".format(encoded)],
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError("remote bash failed: {0}".format(result.stderr[-500:]))
    return result.stdout.strip()


def read_phone_token() -> str:
    result = subprocess.run(
        ["ssh", PI_SSH, 'cat "$HOME/.pi/agent/.peer_token"'],
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=15,
    )
    token = result.stdout.strip()
    if result.returncode != 0 or len(token) < 48:
        raise RuntimeError("phone peer token unavailable")
    return token


def adb(*args: str, timeout: float = 20.0) -> str:
    result = subprocess.run(
        ["adb", "-s", ADB_SERIAL, *args],
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError("adb failed: {0}".format(result.stderr[-500:]))
    return result.stdout.strip()


def screen_state() -> str:
    output = adb("shell", "dumpsys", "power")
    for line in output.splitlines():
        if "mWakefulness=" in line:
            return line.split("mWakefulness=", 1)[1].split()[0]
    return "unknown"


def ensure_screen_off() -> str:
    state = screen_state()
    if state == "Awake":
        adb("shell", "input", "keyevent", "26")
        time.sleep(2)
        state = screen_state()
    return state


def ensure_forward(port: int) -> None:
    adb("forward", "tcp:{0}".format(port), "tcp:{0}".format(port))


def remove_forward(port: int) -> None:
    result = subprocess.run(
        ["adb", "-s", ADB_SERIAL, "forward", "--remove", "tcp:{0}".format(port)],
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=15,
    )
    if result.returncode != 0:
        raise RuntimeError("adb forward remove failed: {0}".format(result.stderr[-300:]))


def probe_json(url: str, token: str | None = None, timeout: float = 8.0) -> dict[str, Any]:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer {0}".format(token)
    request = urllib.request.Request(url, headers=headers)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def probe_services(token: str) -> dict[str, Any]:
    card = probe_json("http://127.0.0.1:9910/.well-known/agent-card.json")
    telemetry = probe_json("http://127.0.0.1:9911/api/telemetry/overview", token)
    return {
        "agent_card": bool(card.get("name")),
        "telemetry": bool(telemetry.get("ok")),
        "model": telemetry.get("current_model", {}).get("model"),
    }


def prepare_remote_fixture(task_seconds: int, stamp: str) -> tuple[str, str, str]:
    script_name = "run_soak_{0}.sh".format(stamp)
    step_id = "soak_{0}".format(stamp)
    task_id = "task-soak-{0}".format(stamp)
    fixture = "\n".join(
        [
            "set -euo pipefail",
            "project='{0}'".format(PHONE_WORKSPACE),
            "mkdir -p \"$project/system_logs\"",
            "cat > \"$project/{0}\" <<'SH'".format(script_name),
            "#!/data/data/com.termux/files/usr/bin/bash",
            "set -euo pipefail",
            "count=0",
            "[ ! -f run_count.txt ] || count=$(cat run_count.txt)",
            "printf '%s\\n' \"$((count + 1))\" > run_count.txt",
            "sleep {0}".format(task_seconds),
            "printf '%s\\n' '{0}' > result.txt".format(task_id),
            "SH",
            "chmod 755 \"$project/{0}\"".format(script_name),
            "rm -f \"$project/.step_{0}.done\"".format(step_id),
            "rm -rf \"$project/.step_{0}.lock.d\"".format(step_id),
            "rm -f \"$project/run_count.txt\" \"$project/result.txt\"",
        ]
    )
    run_remote_bash(fixture)
    return script_name, step_id, task_id


def read_remote_run_count() -> int:
    value = run_remote_bash(
        'cat "{0}/run_count.txt"'.format(PHONE_WORKSPACE),
        timeout=15,
    )
    return int(value)


def read_remote_hash() -> str:
    value = run_remote_bash(
        'sha256sum "{0}/result.txt" | awk \'{{print $1}}\''.format(PHONE_WORKSPACE),
        timeout=15,
    )
    return value


def write_report(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-seconds", type=int, default=12)
    parser.add_argument("--screen-off-seconds", type=int, default=0)
    parser.add_argument("--disconnect-seconds", type=int, default=0)
    parser.add_argument("--poll-max-seconds", type=int, default=600)
    parser.add_argument(
        "--report",
        default=str(REPO / "con_hf" / "runs" / "2026-10-28_a2a_v1_2" / "LIVE_SOAK.json"),
    )
    args = parser.parse_args()
    if args.task_seconds < 1:
        raise SystemExit("--task-seconds must be >= 1")
    if args.screen_off_seconds < 0 or args.disconnect_seconds < 0:
        raise SystemExit("duration arguments must be >= 0")

    report: dict[str, Any] = {
        "ok": False,
        "started_at": iso_now(),
        "task_seconds": args.task_seconds,
        "screen_off_seconds": args.screen_off_seconds,
        "disconnect_seconds": args.disconnect_seconds,
        "get_task_used": False,
        "disconnect_used": False,
        "service_probes": [],
    }
    report_path = Path(args.report)
    try:
        token = read_phone_token()
        ensure_forward(9910)
        ensure_forward(9911)
        initial_state = screen_state()
        report["initial_screen_state"] = initial_state
        if args.screen_off_seconds > 0:
            report["screen_state_after_request"] = ensure_screen_off()

        stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
        script_name, step_id, task_id = prepare_remote_fixture(args.task_seconds, stamp)
        report.update(
            {
                "task_id": task_id,
                "step_id": step_id,
                "script": script_name,
                "workspace": PHONE_WORKSPACE,
            }
        )

        poller = A2AClientPoller(
            endpoint=os.environ.get("PI_A2A_ENDPOINT", "http://127.0.0.1:9910"),
            bearer_token=token,
            backoff_schedule_sec=(2.0, 5.0, 10.0, 20.0, 30.0),
        )
        prompt = (
            "Use exactly one shell command and no other tool calls: "
            "$HOME/bin/pi_idempotent_runner.sh --project a2a_soak "
            "--task-id {0} --step {1} --script ./{2} --outputs result.txt. "
            "Return the command stdout verbatim and nothing else. "
            "The stdout is the structured AIMS Artifact JSON."
        ).format(task_id, step_id, script_name)
        sent = poller.send_message(prompt, return_immediately=True)
        a2a_task_id = poller._extract_task_id(sent)
        if not a2a_task_id:
            raise RuntimeError("SendMessage returned no task id")
        report["a2a_task_id"] = a2a_task_id
        report["send_state"] = poller._extract_state(sent)

        if args.disconnect_seconds > 0:
            remove_forward(9910)
            report["disconnect_used"] = True
            report["disconnect_started_at"] = iso_now()
            time.sleep(args.disconnect_seconds)
            ensure_forward(9910)
            report["disconnect_restored_at"] = iso_now()

        resumed = poller.poll_existing_task(
            a2a_task_id,
            max_wait_sec=args.poll_max_seconds,
        )
        report["get_task_used"] = True
        report["final_state"] = poller._extract_state(resumed)
        artifact = extract_artifact_from_rpc({"task": resumed})
        errors = validate_artifact(artifact)
        report["artifact"] = artifact
        report["artifact_validation_errors"] = errors
        if errors:
            raise RuntimeError("artifact validation failed: {0}".format(", ".join(errors)))
        if artifact["task_id"] != task_id:
            raise RuntimeError("artifact task_id mismatch")
        if artifact["exit_code"] != 0:
            raise RuntimeError("artifact exit_code is nonzero")

        run_count = read_remote_run_count()
        remote_hash = read_remote_hash()
        report["run_count"] = run_count
        report["remote_result_sha256"] = remote_hash
        if run_count != 1:
            raise RuntimeError("phone script ran {0} times".format(run_count))
        if artifact["changed_files"][0]["sha256"] != remote_hash:
            raise RuntimeError("artifact SHA256 does not match phone output")

        soak_start = time.monotonic()
        next_probe = 0.0
        while time.monotonic() - soak_start < args.screen_off_seconds:
            elapsed = time.monotonic() - soak_start
            if elapsed >= next_probe:
                report["service_probes"].append(
                    {
                        "at": iso_now(),
                        "elapsed_sec": round(elapsed, 1),
                        "screen_state": screen_state(),
                        **probe_services(token),
                    }
                )
                next_probe += 60.0
            time.sleep(min(5.0, max(0.5, args.screen_off_seconds - elapsed)))

        if args.screen_off_seconds > 0:
            report["final_screen_state"] = screen_state()
            report["final_services"] = probe_services(token)
            if report["final_screen_state"] != "Asleep":
                raise RuntimeError("phone screen did not remain asleep")
            if not report["final_services"]["agent_card"] or not report["final_services"]["telemetry"]:
                raise RuntimeError("phone services failed during screen-off soak")

        report["ok"] = True
        report["finished_at"] = iso_now()
        write_report(report_path, report)
        print(
            json.dumps(
                {
                    "ok": True,
                    "task_id": task_id,
                    "run_count": run_count,
                    "final_state": report["final_state"],
                    "screen_off_seconds": args.screen_off_seconds,
                    "disconnect_seconds": args.disconnect_seconds,
                    "report": str(report_path),
                },
                ensure_ascii=False,
            )
        )
        return 0
    except Exception as exc:
        report["error"] = str(exc)
        report["finished_at"] = iso_now()
        write_report(report_path, report)
        print(json.dumps({"ok": False, "error": str(exc), "report": str(report_path)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
