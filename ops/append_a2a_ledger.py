#!/usr/bin/env python3
"""Append A2A gate results to the append-only action ledger."""

from __future__ import annotations

from pathlib import Path

import datetime
import io
import json
import sys

LEDGER = "con_hf/ledger/actions.jsonl"

ENTRIES = [
    {
        "id": "ACT-20261028-124500-a2a-core",
        "kind": "a2a_k40_test",
        "step": "core_unit_tests",
        "status": "ok",
        "detail": {
            "tests": 8,
            "failures": 0,
            "exit_code": 0,
            "command": "ssh k40-ubuntu 'cd /mnt/ssd/bio_data/a2a-gate && python3 -m unittest -v tests/test_a2a_core.py'",
        },
    },
    {
        "id": "ACT-20261028-124500-a2a-artifact",
        "kind": "a2a_k40_test",
        "step": "artifact_validator_tests",
        "status": "ok",
        "detail": {
            "tests": 7,
            "failures": 0,
            "exit_code": 0,
            "command": "ssh k40-ubuntu 'cd /mnt/ssd/bio_data/a2a-gate && python3 -m unittest -v tests/test_a2a_artifact.py'",
        },
    },
    {
        "id": "ACT-20261028-124500-a2a-poller",
        "kind": "a2a_k40_test",
        "step": "client_poller_self_test",
        "status": "ok",
        "detail": {
            "exit_code": 0,
            "marker": "A2A_POLLER_SELF_TEST_OK",
            "command": "ssh k40-ubuntu 'cd /mnt/ssd/bio_data/a2a-gate && python3 src/engines/a2a-rpc-engine/a2a_client_poller.py --self-test'",
        },
    },
    {
        "id": "ACT-20261028-124500-a2a-guard",
        "kind": "a2a_termux_probe",
        "step": "daemon_security_guards",
        "status": "ok",
        "detail": {
            "probes": 3,
            "failures": 0,
            "marker": "A2A_GUARD_PROBE_OK",
            "exit_codes": {"allow_all_users": 2, "weak_token_bind": 2, "disabled_server": 1},
            "command": "ssh k40 'bash $HOME/bin/a2a_guard_probe.sh'",
        },
    },
    {
        "id": "ACT-20261028-124500-a2a-codex-serve",
        "kind": "a2a_k40_serve",
        "step": "codex_a2a_agent_card_and_auth",
        "status": "ok",
        "detail": {
            "name": "Codex A2A",
            "version": "1.4.0",
            "card_http": 200,
            "unauthorized_http": 401,
            "wrong_token_http": 401,
            "command": "curl http://127.0.0.1:8000/.well-known/agent-card.json; curl -X POST http://127.0.0.1:8000/",
        },
    },
]

E2E_ENTRY = {
    "id": "ACT-20261028-140400-a2a-e2e",
    "kind": "a2a_e2e",
    "step": "pc_to_pi_send_message",
    "status": "ok",
    "detail": {
        "task_state": "TASK_STATE_COMPLETED",
        "file": "/data/data/com.termux/files/home/workspace/projects/a2a_e2e/probe.txt",
        "sha256": "25a45384e5a3fc8aa9a8360f3f0a6368f549ce8333170d7710313141801d809a",
        "exit_code": 0,
        "child_transcript": True,
        "model": "deepseek-v4.1-flash",
        "thinking": "high",
    },
}

ASYNC_ENTRY = {
    "id": "ACT-20261028-140700-a2a-async",
    "kind": "a2a_async",
    "step": "async_send_poll_cancel",
    "status": "ok",
    "detail": {
        "return_immediately": True,
        "poll_state": "TASK_STATE_WORKING->TASK_STATE_COMPLETED",
        "cancel_state": "TASK_STATE_CANCELED",
        "cancel_http": 200,
        "audit_log": True,
        "child_transcripts": 3,
    },
}

LIVE_ARTIFACT_ENTRY = {
    "id": "ACT-20261028-141500-a2a-live-artifact",
    "kind": "a2a_live_test",
    "step": "extract_and_validate_artifact",
    "status": "ok",
    "detail": {
        "unit_tests": "9/9 (1 skipped by design)",
        "live_e2e": "ok",
        "sha256_match": True,
        "plane": "PC -> adb forward -> Pi on K40",
    },
}

KEEPALIVE_ENTRY = {
    "id": "ACT-20261028-142800-a2a-keepalive",
    "kind": "a2a_keepalive",
    "step": "screen_off_and_session_survival",
    "status": "ok",
    "detail": {
        "screen_state": "mWakefulness=Asleep",
        "wait_minutes": 3,
        "agent_card_after_wait": "ok",
        "task_after_wait": "TASK_STATE_COMPLETED",
        "sha256_match": True,
        "sha256": "2b53fdaf5efb2bd3e61232eea57bf38f0b1c9569eb49babe0007c579d1476c2a",
        "battery_whitelist": ["com.termux", "com.termux.boot"],
        "tmux_session": "pi-a2a",
        "model": "deepseek-v4.1-flash",
        "thinking": "high",
    },
}

IDEM_ENTRY = {
    "id": "ACT-20261028-153000-a2a-idem",
    "kind": "a2a_idempotent",
    "step": "idempotent_runner_g8",
    "status": "ok",
    "detail": {
        "fresh_run": "ok",
        "reuse_status": "reused_done_checkpoint",
        "reuse_latency_ms_under_500": True,
        "lock_present_with_live_pid": True,
        "script_readonly": True,
        "log_redirect": "system_logs/<step>.log",
    },
}

TELEMETRY_ENTRY = {
    "id": "ACT-20261028-153500-a2a-telemetry",
    "kind": "a2a_telemetry",
    "step": "sidecar_9911_g9",
    "status": "ok",
    "detail": {
        "bind": "127.0.0.1:9911",
        "auth": "peerTokens.codex bearer",
        "no_token_http": 401,
        "overview": "ok, calls=11, by_model parsed",
        "daemon_windows": ["a2a-server(:9910)", "telemetry(:9911)"],
    },
}


def main() -> int:
    ledger_path = Path(LEDGER)
    existing_ids = set()
    if ledger_path.exists():
        for line in ledger_path.read_text(encoding="utf-8").splitlines():
            try:
                existing_ids.add(json.loads(line).get("id"))
            except json.JSONDecodeError:
                continue

    entries = ENTRIES + [E2E_ENTRY, ASYNC_ENTRY, LIVE_ARTIFACT_ENTRY, KEEPALIVE_ENTRY, IDEM_ENTRY, TELEMETRY_ENTRY]
    stamp = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    with io.open(LEDGER, "a", encoding="utf-8", newline="\n") as handle:
        for entry in entries:
            if entry["id"] in existing_ids:
                continue
            entry["ts"] = stamp
            entry["type"] = "action"
            entry["ticket"] = "A2A-v1"
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    appended = len(entries) - len(existing_ids & {e["id"] for e in entries})
    print("A2A_LEDGER_APPENDED count={0}".format(appended))
    return 0


if __name__ == "__main__":
    sys.exit(main())
