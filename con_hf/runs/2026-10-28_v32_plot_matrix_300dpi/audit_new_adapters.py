#!/usr/bin/env python3
import glob
import hashlib
import json
import os

PROJECT = "PRJ_AIMS_V3_20261027"
LOG_ROOT = "/mnt/ssd/bio_data/system_logs"
CASES = [
    ("fig_l1_groupedbar", "line1_bulk"),
    ("fig_l1_scatter", "line1_bulk"),
    ("fig_l1_boxplot", "line1_bulk"),
    ("fig_l1_density", "line1_bulk"),
    ("fig_l1_histogram", "line1_bulk"),
    ("fig_l1_violin", "line1_bulk"),
    ("fig_l2_umap", "line2_scrna"),
    ("fig_l3_multipanel", "line1_bulk"),
    ("fig_l2p_violin", "line2_scrna"),
    ("fig_l3_sankey", "line1_bulk"),
]


def sha256(path):
    digest = hashlib.sha256()
    try:
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError:
        return None
    return digest.hexdigest()


rows = []
for template_id, line_id in CASES:
    pattern = os.path.join(
        LOG_ROOT,
        f"*_{PROJECT}_{line_id}_adapt_{template_id}_*.json",
    )
    files = sorted(glob.glob(pattern), key=os.path.getmtime, reverse=True)
    if not files:
        rows.append({"template_id": template_id, "error": "ledger_missing"})
        continue
    ledger_path = files[0]
    with open(ledger_path, encoding="utf-8") as handle:
        ledger = json.load(handle)
    outputs = ledger.get("io_files", {}).get("output", [])
    output = outputs[0] if outputs else None
    rows.append(
        {
            "template_id": template_id,
            "line_id": line_id,
            "ledger": ledger_path,
            "task_id": ledger.get("task_id"),
            "status": ledger.get("status"),
            "exit_code": ledger.get("exit_code"),
            "checkpoint_status": ledger.get("checkpoint_status"),
            "random_seed": ledger.get("environment", {}).get("random_seed"),
            "output": output,
            "output_exists": bool(output and os.path.isfile(output)),
            "output_sha256": sha256(output) if output else None,
            "error_log": ledger.get("error_log"),
        }
    )

print(json.dumps(rows, ensure_ascii=False, indent=2))
