import json
import os
import shutil
import sys
import tempfile
import zipfile
import pytest

sys.path.insert(0, os.path.abspath("04_ai_automation/agents"))
sys.path.insert(0, os.path.abspath("03_server_orchestrator/core"))

from pipeline_middlewares import (
    Role0IntakeMiddleware,
    Role1PlannerMiddleware,
    Role3SREMiddleware,
    Role4AuditorMiddleware,
    fix_excel_corrupted_gene_symbols,
    standardize_species_gene_symbol,
)
from a2a_dispatcher import A2ADispatcher, PriorityQueueManager
from deliverables_packager import DeliverablesPackager


def test_slice5_excel_gene_and_species_fixing():
    # 1. Excel date gene fixing
    raw_genes = ["TP53", "1-Mar", "2-Sep", "EGFR", "MARCH1", "SEPT2"]
    fixed = fix_excel_corrupted_gene_symbols(raw_genes)
    assert fixed == ["TP53", "MARCHF1", "SEPTIN2", "EGFR", "MARCHF1", "SEPTIN2"]

    # 2. Species gene symbol normalization
    assert standardize_species_gene_symbol("tp53", "Homo_sapiens") == "TP53"
    assert standardize_species_gene_symbol("TP53", "Mus_musculus") == "Tp53"
    assert standardize_species_gene_symbol("egfr", "Mus_musculus") == "Egfr"


def test_slice5_priority_queue_and_dispatcher():
    pq = PriorityQueueManager()
    pq.enqueue("REQ-001", "TRIAL", {"id": 1})
    pq.enqueue("REQ-002", "PRO_URGENT", {"id": 2})
    pq.enqueue("REQ-003", "STANDARD", {"id": 3})

    first = pq.dequeue()
    assert first["req_id"] == "REQ-002"  # PRO_URGENT first
    second = pq.dequeue()
    assert second["req_id"] == "REQ-003"  # STANDARD second
    third = pq.dequeue()
    assert third["req_id"] == "REQ-001"  # TRIAL third


def test_slice5_auto_heal_oom_then_succeed_and_circuit_breaker():
    sre = Role3SREMiddleware()
    step_def = {
        "step_id": "step_02_clustering",
        "args": {"threads": 3, "hvg_count": 3000, "seed": 20261013},
    }
    oom_triad = {
        "step_id": "step_02_clustering",
        "exit_code": 137,
        "log_digest": {"stderr_tail": "Killed\ncannot allocate vector", "stdout_tail": ""},
    }

    # First fail -> retry 1 auto-heal patch generated
    heal1 = sre.diagnose_and_heal(step_def, oom_triad, retry_count=0)
    assert heal1["status"] == "AUTO_HEAL_APPLIED"
    assert heal1["adjustments"]["threads"] == 1
    assert heal1["adjustments"]["hvg_count"] == 1500
    assert heal1["adjustments"]["backed"] is True

    # Second fail -> retry 2 auto-heal patch generated
    heal2 = sre.diagnose_and_heal(step_def, oom_triad, retry_count=1)
    assert heal2["status"] == "AUTO_HEAL_APPLIED"

    # Third fail -> retry 2 reached -> CIRCUIT BREAKER to human
    heal3 = sre.diagnose_and_heal(step_def, oom_triad, retry_count=2)
    assert heal3["status"] == "ESCALATED_TO_HUMAN"
    assert "熔断" in heal3["reason"]


def test_slice5_e2e_pipeline_and_deliverables():
    with tempfile.TemporaryDirectory() as tmp_dir:
        packager = DeliverablesPackager(deliverables_root=os.path.join(tmp_dir, "deliverables"))

        manifest_data = {
            "manifest_id": "MAN-20261031-E2E001",
            "req_id": "REQ-20261031-E2E001",
            "isolation_line": "line1_bulk",
            "global_constraints": {
                "seed": 20261013,
                "max_threads": 3,
                "max_memory_mb": 5500,
                "forbid_sdcard": True,
            },
        }

        scorecard_data = {
            "manifest_id": "MAN-20261031-E2E001",
            "stage1_mechanical_passed": True,
            "stage2_biological_score": 92.5,
            "final_decision": "APPROVED_FOR_DELIVERY",
            "metrics_summary": {"deg_count": 450},
        }

        # Create mock figure & table
        work_dir = os.path.join(tmp_dir, "mock_work")
        os.makedirs(work_dir, exist_ok=True)
        fig_path = os.path.join(work_dir, "volcano.png")
        with open(fig_path, "wb") as f:
            f.write(b"\x89PNG\r\n\x1a\n" + (b"\x00" * 4500) + b"IEND\xaeB`\x82")

        table_path = os.path.join(work_dir, "deg.tsv")
        with open(table_path, "w", encoding="utf-8") as f:
            f.write("gene\tlog2fc\tpadj\nTP53\t2.5\t0.001\n")

        # Package deliverables
        proj_dir = packager.package(
            project_id="REQ-20261031-E2E001",
            manifest_data=manifest_data,
            acceptance_data=scorecard_data,
            figure_paths=[fig_path],
            table_paths=[table_path],
        )

        assert os.path.exists(os.path.join(proj_dir, "01_Executive_Bio_Report.md"))
        assert os.path.exists(os.path.join(proj_dir, "02_Publication_Ready_Figures", "volcano.png"))
        assert os.path.exists(os.path.join(proj_dir, "03_Processed_Tables", "deg.tsv"))

        capsule_path = os.path.join(proj_dir, "04_Reproducibility_Capsule.zip")
        assert os.path.exists(capsule_path)

        with zipfile.ZipFile(capsule_path, "r") as zf:
            names = set(zf.namelist())
            assert "execution_manifest.locked.json" in names
            assert "acceptance_scorecard.json" in names
            assert "sha256_manifest.txt" in names
            assert "runtime_session_info.txt" in names
