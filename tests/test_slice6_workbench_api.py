import glob
import json
import os
import sys
import tempfile
import threading
import time
import urllib.request
import zipfile
import pytest

sys.path.insert(0, os.path.abspath("03_server_orchestrator/core"))
from workbench_api_server import create_app_server


TEST_HOST = "127.0.0.1"
TEST_PORT = 18799
BASE_URL = f"http://{TEST_HOST}:{TEST_PORT}"


@pytest.fixture(scope="module")
def api_server():
    tmp_dir = tempfile.mkdtemp()
    server = create_app_server(host=TEST_HOST, port=TEST_PORT, repo_root=tmp_dir)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.3)
    yield server, tmp_dir
    server.shutdown()
    server.server_close()


def test_slice6_health_endpoint(api_server):
    req = urllib.request.Request(f"{BASE_URL}/health")
    with urllib.request.urlopen(req) as resp:
        assert resp.status == 200
        data = json.loads(resp.read().decode("utf-8"))
        assert data["ok"] is True
        assert data["status"] == "UP"


def test_slice6_requirements_endpoint(api_server):
    valid_req = {
        "req_id": "REQ-20261031-API001",
        "created_at": "2026-10-31T16:00:00Z",
        "mode": "MODE_B_CUSTOM_MATRIX",
        "isolation_line": "line1_bulk",
        "species": "Homo_sapiens",
        "project_metadata": {
            "disease_or_trait": "Lung_Adenocarcinoma",
            "target_genes": ["TP53", "1-Mar", "EGFR"],
            "sample_groups": {
                "control_samples": ["CTRL_1", "CTRL_2", "CTRL_3"],
                "treatment_samples": ["TREAT_1", "TREAT_2", "TREAT_3"],
            },
        },
        "_attribution": {
            "utm_source": "academic_outreach",
            "partner_id": "lab_alpha",
            "tier": "PRO_URGENT",
        },
    }

    # 1. Valid request -> 200
    req = urllib.request.Request(
        f"{BASE_URL}/api/v1/requirements",
        data=json.dumps(valid_req).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        assert resp.status == 200
        data = json.loads(resp.read().decode("utf-8"))
        assert data["ok"] is True
        assert data["status"] == "MANIFEST_PLANNED"

    # 2. Invalid request: n < 3 -> 400
    bad_req = json.loads(json.dumps(valid_req))
    bad_req["project_metadata"]["sample_groups"]["control_samples"] = ["CTRL_1", "CTRL_2"]
    bad_req_call = urllib.request.Request(
        f"{BASE_URL}/api/v1/requirements",
        data=json.dumps(bad_req).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(bad_req_call)
        assert False, "Should have returned 400 for n < 3"
    except urllib.error.HTTPError as e:
        assert e.code == 400


def test_slice6_heartbeat_endpoint(api_server):
    payload = {
        "node_id": "k40-ubuntu-node01",
        "battery_temp_c": 38.6,
        "mem_available_mb": 4200.0,
        "thermal_state": "NORMAL",
        "throttle_count": 0,
        "active_jobs_count": 1,
        "completed_triads": [
            {
                "task_id": "TASK-API-01",
                "step_id": "step_01_qc_norm",
                "exit_code": 0,
            }
        ],
    }

    req = urllib.request.Request(
        f"{BASE_URL}/api/v1/a2a/heartbeat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        assert resp.status == 200
        data = json.loads(resp.read().decode("utf-8"))
        assert data["ok"] is True
        assert "step_01_qc_norm" in data["acked_step_ids"]


def test_slice6_ledger_query_endpoint(api_server):
    req = urllib.request.Request(f"{BASE_URL}/api/v1/ledger?category=tasks")
    with urllib.request.urlopen(req) as resp:
        assert resp.status == 200
        data = json.loads(resp.read().decode("utf-8"))
        assert data["ok"] is True
        assert isinstance(data["entries"], list)


def test_slice6_deliverables_download(api_server):
    server, tmp_dir = api_server
    proj_id = "REQ-20261031-API001"
    deliv_dir = os.path.join(tmp_dir, "deliverables", proj_id)
    os.makedirs(deliv_dir, exist_ok=True)
    capsule_path = os.path.join(deliv_dir, "04_Reproducibility_Capsule.zip")

    # Create dummy zip capsule
    with zipfile.ZipFile(capsule_path, "w") as zf:
        zf.writestr("test.txt", "hello capsule")

    req = urllib.request.Request(f"{BASE_URL}/api/v1/deliverables/{proj_id}/download")
    with urllib.request.urlopen(req) as resp:
        assert resp.status == 200
        assert resp.headers.get("Content-Type") == "application/zip"
        content = resp.read()
        assert content.startswith(b"PK\x03\x04")


def test_slice6_zero_em_dash_audit():
    # Audit all core proposals, schemas, prompts, and 4 sector directories
    targets = [
        "schemas",
        ".agents/prompts",
        "01_mobile_compute",
        "02_client_ui",
        "03_server_orchestrator",
        "04_ai_automation",
        "docs/proposals",
    ]
    violations = []
    for target in targets:
        if not os.path.exists(target):
            continue
        for root, _, files in os.walk(target):
            for fn in files:
                if fn.endswith((".py", ".sh", ".json", ".md", ".tsx", ".ts", ".js")):
                    fp = os.path.join(root, fn)
                    with open(fp, "r", encoding="utf-8", errors="ignore") as f:
                        text = f.read()
                    dashes = [c for c in text if c in ["\u2014", "\u2013", chr(8212)]]
                    if dashes:
                        violations.append((fp, len(dashes)))

    assert len(violations) == 0, f"Found em dashes in: {violations}"
