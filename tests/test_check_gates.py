#!/usr/bin/env python3
"""Behavior tests for ops/check-gates.mjs."""

from __future__ import annotations

import copy
import hashlib
import json
import subprocess
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "ops" / "check-gates.mjs"


def run_gate(*args: str) -> tuple[int, dict]:
    result = subprocess.run(
        ["node", str(SCRIPT), *args],
        cwd=REPO,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=30,
    )
    return result.returncode, json.loads(result.stdout)


def run_g5_with_deps(deps_source: str) -> tuple[int, dict]:
    expression = f"""
const {{ checkG5Result }} = await import(process.argv[1]);
const result = checkG5Result({deps_source});
console.log(JSON.stringify(result));
"""
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", expression, SCRIPT.as_uri()],
        cwd=REPO,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=30,
    )
    return proc.returncode, json.loads(proc.stdout)


def run_g3_with_deps(deps_source: str) -> tuple[int, dict]:
    expression = f"""
const {{ checkG3Result }} = await import(process.argv[1]);
const result = checkG3Result({deps_source});
console.log(JSON.stringify(result));
"""
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", expression, SCRIPT.as_uri()],
        cwd=REPO,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=30,
    )
    return proc.returncode, json.loads(proc.stdout)


class CheckGatesTestCase(unittest.TestCase):
    def test_default_mode_fails_only_on_hard_violations(self) -> None:
        code, payload = run_gate()
        self.assertFalse(payload["strict"])
        summary = payload["summary"]
        self.assertEqual(payload["ok"], summary["fail"] == 0)
        self.assertEqual(code, 0 if payload["ok"] else 1)
        by_id = {item["id"]: item for item in payload["checks"]}
        self.assertEqual(by_id["G1"]["status"], "PASS")
        self.assertEqual(by_id["G3"]["status"], "PASS")
        self.assertIn("15 ready templates", by_id["G3"]["detail"])
        self.assertEqual(by_id["G4"]["status"], "PASS")
        self.assertEqual(by_id["G6"]["status"], "PASS")
        if summary["fail"] > 0:
            self.assertEqual(code, 1)
            self.assertFalse(payload["ok"])

    def test_all_a2a_modules_are_declared_and_verified(self) -> None:
        _, payload = run_gate()
        by_id = {item["id"]: item for item in payload["checks"]}
        self.assertIn("A2A-ENGINES", by_id)
        self.assertEqual(by_id["A2A-ENGINES"]["status"], "PASS")
        engine_detail = by_id["A2A-ENGINES"]["detail"]
        for engine in [
            "a2a-rpc",
            "transport-keepalive",
            "artifact-sync",
            "security-audit",
        ]:
            self.assertIn(engine, engine_detail)
        self.assertIn("A2A-MODULES", by_id)
        self.assertEqual(by_id["A2A-MODULES"]["status"], "PASS")
        detail = by_id["A2A-MODULES"]["detail"]
        for module in [
            "mod-core-engines",
            "mod-a2a-pi-server",
            "mod-a2a-codex-client",
            "mod-a2a-network-keepalive",
            "mod-a2a-artifact-audit",
            "mod-pi-observability",
        ]:
            self.assertIn(module, detail)
        for asset in [
            "BioanalysDesktop/server/pi_agent.js",
            "BioanalysDesktop/server/pi_agent_routes.js",
            "BioanalysDesktop/server/runtime_slots.js",
            "BioanalysDesktop/tests/pi_agent.test.js",
            "BioanalysDesktop/tests/pi_agent_routes.test.js",
            "BioanalysDesktop/tests/runtime_slots.test.js",
            "BioanalysDesktop/tests/runtime_slots_http.test.js",
            "tests/test_a2a_poller_state.py",
            "tests/test_pi_telemetry_sidecar.py",
            "BioanalysDesktop/src/App.tsx",
            "ops/build_runtime_core.mjs",
            "ops/pi_telemetry_sidecar.py",
        ]:
            self.assertIn(asset, detail)

    def test_strict_mode_promotes_unfinished_scope_to_failure(self) -> None:
        code, payload = run_gate("--strict")
        self.assertTrue(payload["strict"])
        expected_ok = (
            payload["summary"]["fail"] == 0
            and payload["summary"]["warn"] == 0
        )
        self.assertEqual(code, 0 if expected_ok else 1)
        self.assertEqual(payload["ok"], expected_ok)


class CheckG5DiagnosticsTestCase(unittest.TestCase):
    def test_git_status_failure_reports_git_reason(self) -> None:
        code, result = run_g5_with_deps(
            "{ gitStatus() { throw new Error('exit status 128: not a git repository'); } }"
        )
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "WARN")
        self.assertIn("git status failed: exit status 128", result["detail"])
        self.assertNotIn("git repository unavailable", result["detail"])

    def test_release_plan_failure_reports_command_reason(self) -> None:
        code, result = run_g5_with_deps(
            "{ gitStatus() { return ''; }, releasePlanJson() { throw new Error('spawn ENOENT'); } }"
        )
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("release-plan failed: spawn ENOENT", result["detail"])
        self.assertNotIn("git repository unavailable", result["detail"])

    def test_release_plan_not_ok_reports_unassigned_files(self) -> None:
        plan = json.dumps(
            {
                "ok": False,
                "unassigned": ["pass"],
                "summary": {"total": 1, "assigned": 0, "unassigned": 1},
            }
        )
        code, result = run_g5_with_deps(
            f"{{ gitStatus() {{ return ''; }}, releasePlanJson() {{ return {json.dumps(plan)}; }} }}"
        )
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("unclassified release files: pass", result["detail"])
        self.assertNotIn("git repository unavailable", result["detail"])


class CheckG3DiagnosticsTestCase(unittest.TestCase):
    @staticmethod
    def _fixture() -> dict:
        templates = []
        sources = []
        audit_figures = []
        source_evidence = {}
        png_evidence = {}
        png_root = "artifacts/figure-render-20261029/outputs/figures"

        for index in range(15):
            template_id = f"fig_test_{index:02d}"
            source_path = f"src/figure_sources/{template_id}.R"
            png_relative = f"line1_bulk/{template_id}.png"
            png_path = f"{png_root}/{png_relative}"
            source_sha = hashlib.sha256(f"source:{template_id}".encode()).hexdigest()
            png_sha = hashlib.sha256(f"png:{template_id}".encode()).hexdigest()
            templates.append(
                {
                    "id": template_id,
                    "name": f"Template {index:02d}",
                    "deps_status": "ready",
                    "language": "r",
                }
            )
            sources.append(
                {
                    "template_id": template_id,
                    "source": source_path,
                    "source_sha256": source_sha,
                }
            )
            audit_figures.append(
                {
                    "template_id": template_id,
                    "output_png": png_relative,
                    "canonical_output": f"{template_id}.png",
                    "status": "PASS",
                    "metrics": {
                        "width_px": 1039,
                        "height_px": 708,
                        "dpi": 299.9994,
                    },
                }
            )
            source_evidence[source_path] = {
                "exists": True,
                "sizeBytes": 128,
                "sha256": source_sha,
            }
            png_evidence[png_path] = {
                "exists": True,
                "sizeBytes": 2048,
                "sha256": png_sha,
                "magic": "89504e470d0a1a0a",
                "width": 1039,
                "height": 708,
                "dpi": [299.9994, 299.9994],
            }

        return {
            "templates": {"templates": templates},
            "manifest": {"sources": sources},
            "audit": {"figures": audit_figures},
            "source_evidence": source_evidence,
            "png_evidence": png_evidence,
        }

    @staticmethod
    def _matrix(fixture: dict) -> dict:
        png_root = "artifacts/figure-render-20261029/outputs/figures"
        entries = []
        for template, source, audit_figure in zip(
            fixture["templates"]["templates"],
            fixture["manifest"]["sources"],
            fixture["audit"]["figures"],
        ):
            png_relative = audit_figure["output_png"]
            png_path = f"{png_root}/{png_relative}"
            entries.append(
                {
                    "entry_id": template["id"],
                    "template_id": template["id"],
                    "name": template["name"],
                    "template_name": template["name"],
                    "status": "pass",
                    "source_path": source["source"],
                    "source_sha256": source["source_sha256"],
                    "png_path": png_path,
                    "png_sha256": fixture["png_evidence"][png_path]["sha256"],
                    "size_bytes": 2048,
                    "png_magic": "89504e470d0a1a0a",
                    "width": 1039,
                    "height": 708,
                    "dpi": [299.9994, 299.9994],
                    "pixel_variance": 120.0,
                    "canonical_output": audit_figure["canonical_output"],
                    "line_id": "line1_bulk",
                    "audit_status": "PASS",
                }
            )
        return {
            "schema_version": 1,
            "generated_from": {
                "template_registry": "src/figure_templates.json",
                "source_manifest": "src/figure_sources/manifest.json",
                "artifact_audit": (
                    "artifacts/figure-render-20261029/evidence/artifact_audit.json"
                ),
                "png_root": png_root,
            },
            "summary": {
                "ready_templates": 15,
                "entries": 15,
                "pngs": 15,
                "invalid": 0,
            },
            "entries": entries,
        }

    def _deps(self, matrix: dict, fixture: dict | None = None) -> str:
        fixture = fixture or self._fixture()
        templates_raw = json.dumps(fixture["templates"], separators=(",", ":"))
        manifest_raw = json.dumps(fixture["manifest"], separators=(",", ":"))
        audit_raw = json.dumps(fixture["audit"], separators=(",", ":"))
        matrix = copy.deepcopy(matrix)
        matrix["input_sha256"] = {
            "template_registry": hashlib.sha256(templates_raw.encode()).hexdigest(),
            "source_manifest": hashlib.sha256(manifest_raw.encode()).hexdigest(),
            "artifact_audit": hashlib.sha256(audit_raw.encode()).hexdigest(),
        }
        report = "## Plot Matrix\n\n## Execution Matrix\n"
        source_evidence = json.dumps(fixture["source_evidence"])
        png_evidence = json.dumps(fixture["png_evidence"])
        return (
            "{ "
            "reportExists() { return true; }, "
            f"readReport() {{ return {json.dumps(report)}; }}, "
            "matrixExists() { return true; }, "
            f"readMatrix() {{ return {json.dumps(json.dumps(matrix))}; }}, "
            f"readTemplateRegistry() {{ return {json.dumps(templates_raw)}; }}, "
            f"readSourceManifest() {{ return {json.dumps(manifest_raw)}; }}, "
            f"readArtifactAudit() {{ return {json.dumps(audit_raw)}; }}, "
            f"inspectSource(relative) {{ return ({source_evidence})[relative] || {{ exists:false }}; }}, "
            f"inspectPng(relative) {{ return ({png_evidence})[relative] || {{ exists:false }}; }} "
            "}"
        )

    def test_matrix_entry_count_must_be_15(self) -> None:
        fixture = self._fixture()
        matrix = self._matrix(fixture)
        matrix["entries"].pop()
        code, result = run_g3_with_deps(self._deps(matrix, fixture))
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("expected 15 entries", result["detail"])

    def test_ready_template_count_must_be_15(self) -> None:
        fixture = self._fixture()
        fixture["templates"]["templates"].pop()
        matrix = self._matrix(self._fixture())
        code, result = run_g3_with_deps(self._deps(matrix, fixture))
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("expected 15 ready templates, got 14", result["detail"])

    def test_source_hash_mismatch_fails(self) -> None:
        fixture = self._fixture()
        matrix = self._matrix(fixture)
        matrix["entries"][3]["source_sha256"] = "f" * 64
        code, result = run_g3_with_deps(self._deps(matrix, fixture))
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("source SHA256 mismatch", result["detail"])

    def test_png_evidence_magic_and_variance_must_be_valid(self) -> None:
        fixture = self._fixture()
        matrix = self._matrix(fixture)
        matrix["entries"][5]["png_magic"] = "0000000000000000"
        matrix["entries"][6]["pixel_variance"] = 0
        code, result = run_g3_with_deps(self._deps(matrix, fixture))
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("PNG magic invalid", result["detail"])
        self.assertIn("PNG pixel variance invalid", result["detail"])

    def test_missing_matrix_reports_new_path(self) -> None:
        deps = (
            "{ "
            "reportExists() { return true; }, "
            "readReport() { return '## Plot Matrix\\n\\n## Execution Matrix\\n'; }, "
            "matrixExists() { return false; } "
            "}"
        )
        code, result = run_g3_with_deps(deps)
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "FAIL")
        self.assertEqual(
            result["detail"],
            "src/figure_sources/script_plot_matrix.json missing",
        )

    def test_valid_matrix_passes(self) -> None:
        fixture = self._fixture()
        matrix = self._matrix(fixture)
        code, result = run_g3_with_deps(self._deps(matrix, fixture))
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "PASS")
        self.assertIn("15 ready templates", result["detail"])
        self.assertIn("15 entries", result["detail"])
        self.assertIn("invalid=0", result["detail"])


class CheckG5DirtyWorktreeTestCase(unittest.TestCase):
    def test_fully_classified_dirty_worktree_warns_awaiting_commits(self) -> None:
        plan = json.dumps(
            {
                "ok": True,
                "unassigned": [],
                "summary": {"total": 347, "assigned": 347, "unassigned": 0},
            }
        )
        code, result = run_g5_with_deps(
            f"{{ gitStatus() {{ return ' M ops/release-plan.mjs'; }}, releasePlanJson() {{ return {json.dumps(plan)}; }} }}"
        )
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "WARN")
        self.assertIn("worktree dirty", result["detail"])
        self.assertIn("awaiting authorized commits", result["detail"])


if __name__ == "__main__":
    unittest.main()
