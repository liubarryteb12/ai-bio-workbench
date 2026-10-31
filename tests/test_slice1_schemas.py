import glob
import json
import os
import pytest
import jsonschema


SCHEMAS_DIR = os.path.abspath("schemas")
PROMPTS_DIR = os.path.abspath(".agents/prompts")


def test_slice1_schemas_and_prompts_exist():
    expected_schemas = [
        "requirement.schema.json",
        "execution_manifest.schema.json",
        "artifact_triad.schema.json",
        "acceptance_card.schema.json",
    ]
    for name in expected_schemas:
        p = os.path.join(SCHEMAS_DIR, name)
        assert os.path.exists(p), f"Missing schema: {name}"
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
            assert "$schema" in data
            assert "title" in data

    expected_prompts = [
        "role0_intake_gatekeeper.md",
        "role1_bio_planner.md",
        "role2_hub_guard.md",
        "role3_edge_sre.md",
        "role4_qa_auditor.md",
        "role5_ledger_chaos_auditor.md",
    ]
    for name in expected_prompts:
        p = os.path.join(PROMPTS_DIR, name)
        assert os.path.exists(p), f"Missing prompt: {name}"
        assert os.path.getsize(p) > 100


def test_slice1_requirement_valid_sample():
    with open(os.path.join(SCHEMAS_DIR, "requirement.schema.json"), "r", encoding="utf-8") as f:
        schema = json.load(f)

    valid_req = {
        "req_id": "REQ-20261031-A1B2C3",
        "created_at": "2026-10-31T16:00:00Z",
        "mode": "MODE_B_CUSTOM_MATRIX",
        "isolation_line": "line1_bulk",
        "species": "Homo_sapiens",
        "project_metadata": {
            "disease_or_trait": "Lung_Adenocarcinoma",
            "target_genes": ["TP53", "EGFR", "KRAS"],
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
    jsonschema.validate(valid_req, schema)


def test_slice1_requirement_invalid_cases():
    with open(os.path.join(SCHEMAS_DIR, "requirement.schema.json"), "r", encoding="utf-8") as f:
        req_schema = json.load(f)

    with open(os.path.join(SCHEMAS_DIR, "execution_manifest.schema.json"), "r", encoding="utf-8") as f:
        man_schema = json.load(f)

    base_req = {
        "req_id": "REQ-20261031-A1B2C3",
        "created_at": "2026-10-31T16:00:00Z",
        "mode": "MODE_B_CUSTOM_MATRIX",
        "isolation_line": "line1_bulk",
        "species": "Homo_sapiens",
        "project_metadata": {
            "disease_or_trait": "Lung_Adenocarcinoma",
            "target_genes": ["TP53", "EGFR"],
            "sample_groups": {
                "control_samples": ["CTRL_1", "CTRL_2", "CTRL_3"],
                "treatment_samples": ["TREAT_1", "TREAT_2", "TREAT_3"],
            },
        },
        "_attribution": {
            "utm_source": "direct",
            "partner_id": "p1",
            "tier": "STANDARD",
        },
    }

    # 1. Biological replicates n < 3 (control has 2)
    bad_req_n2 = json.loads(json.dumps(base_req))
    bad_req_n2["project_metadata"]["sample_groups"]["control_samples"] = ["CTRL_1", "CTRL_2"]
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(bad_req_n2, req_schema)

    # 2. Sample name with special characters (violating regex pattern)
    bad_req_spec_char = json.loads(json.dumps(base_req))
    bad_req_spec_char["project_metadata"]["sample_groups"]["control_samples"] = ["CTRL 1; rm -rf", "CTRL_2", "CTRL_3"]
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(bad_req_spec_char, req_schema)

    # 3. Execution manifest with seed != 20261013
    bad_manifest = {
        "manifest_id": "MAN-20261031-A1B2C3",
        "req_id": "REQ-20261031-A1B2C3",
        "isolation_line": "line1_bulk",
        "global_constraints": {
            "seed": 42,
            "max_threads": 3,
            "max_memory_mb": 5500,
            "forbid_sdcard": True,
        },
        "compute_sieve_report": {
            "estimated_peak_mb": 450.0,
            "downsampling_applied": False,
            "sieve_passed": True,
        },
        "dag_steps": [
            {
                "step_id": "step_01_qc",
                "depends_on": [],
                "runtime_env": "R_4_3",
                "script_relpath": "src/line1_bulk/scripts/qc.R",
                "script_sha256": "0" * 64,
                "args": {},
                "expected_artifacts": [
                    {"relpath": "results/qc.png", "format": "PNG", "critical": True}
                ],
            }
        ],
    }
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(bad_manifest, man_schema)

    # 4. Missing _attribution in requirement
    bad_req_no_attr = json.loads(json.dumps(base_req))
    del bad_req_no_attr["_attribution"]
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(bad_req_no_attr, req_schema)


def test_slice1_zero_em_dash_in_schemas_and_prompts():
    for root in [SCHEMAS_DIR, PROMPTS_DIR]:
        for filepath in glob.glob(os.path.join(root, "*.*")):
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            em_dashes = [c for c in content if c in ["\u2014", "\u2013", chr(8212)]]
            assert len(em_dashes) == 0, f"Found em dash in {filepath}"
