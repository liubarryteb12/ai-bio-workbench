#!/usr/bin/env python3
"""Append A2A gate results to the append-only action ledger."""

from __future__ import annotations

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
]


def main() -> int:
    stamp = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    with io.open(LEDGER, "a", encoding="utf-8", newline="\n") as handle:
        for entry in ENTRIES:
            entry["ts"] = stamp
            entry["type"] = "action"
            entry["ticket"] = "A2A-v1"
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    print("A2A_LEDGER_APPENDED count={0}".format(len(ENTRIES)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
