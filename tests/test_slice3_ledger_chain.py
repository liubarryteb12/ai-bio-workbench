import json
import os
import sys
import tempfile
import pytest

sys.path.insert(0, os.path.abspath("03_server_orchestrator/core"))
from ledger_engine import AppendOnlyLedger, LEDGER_CATEGORIES


def test_slice3_ledger_chain_integrity():
    with tempfile.TemporaryDirectory() as tmp_dir:
        ledger = AppendOnlyLedger(ledger_dir=tmp_dir)

        # 1. Test all 5 categories
        for cat in LEDGER_CATEGORIES.keys():
            h = ledger.append(cat, "INIT_EVENT", {"category": cat, "step": 0})
            assert len(h) == 64

        # 2. Append 10 sequential records in 'tasks'
        for i in range(1, 10):
            ledger.append("tasks", "TASK_UPDATE", {"step": i, "val": i * 100})

        # 3. Verify intact chain
        is_valid, msg = ledger.verify_ledger_chain("tasks")
        assert is_valid is True
        assert msg == "OK"

        # 4. Simulate tampering in line 5
        tasks_file = os.path.join(tmp_dir, "tasks.jsonl")
        with open(tasks_file, "r", encoding="utf-8") as f:
            lines = [json.loads(line) for line in f if line.strip()]

        assert len(lines) == 10
        # Tamper payload
        lines[4]["payload"]["val"] = 999999

        with open(tasks_file, "w", encoding="utf-8") as f:
            for item in lines:
                f.write(json.dumps(item, ensure_ascii=False) + "\n")

        # 5. Verify tampered chain is detected
        is_valid, msg = ledger.verify_ledger_chain("tasks")
        assert is_valid is False
        assert "line 4" in msg.lower() or "broken" in msg.lower() or "tamper" in msg.lower()
