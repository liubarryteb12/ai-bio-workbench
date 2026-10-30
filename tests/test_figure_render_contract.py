#!/usr/bin/env python3
"""Canonical output and artifact-path contracts for figure render manifests."""

from __future__ import annotations

import json
import posixpath
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
LINES = {"line1_bulk", "line2_scrna", "line3_spatial"}
LEGEND_POSITIONS = {
    "fig_l1_boxplot": "none",
    "fig_l1_density": "none",
    "fig_l1_groupedbar": "right",
    "fig_l1_histogram": "none",
    "fig_l1_scatter": "right",
    "fig_l1_violin": "none",
    "fig_l2_heatmap": "right",
    "fig_l2_pca": "right",
    "fig_l2_umap": "right",
    "fig_l2_volcano": "right",
    "fig_l2p_dotplot": "right",
    "fig_l2p_umap": "right",
    "fig_l2p_violin": "none",
    "fig_l2p_volcano": "right",
    "fig_l3_sankey": "none",
}


class FigureRenderContractTest(unittest.TestCase):
    def test_ready_templates_use_unique_line_relative_basenames(self) -> None:
        registry = json.loads((REPO / "src/figure_templates.json").read_text("utf-8"))
        outputs = set()
        for template in registry["templates"]:
            if template["deps_status"] != "ready":
                continue
            self.assertTrue(template["lines"], f"{template['id']}: line missing")
            self.assertTrue(set(template["lines"]) <= LINES, f"{template['id']}: line outside registry")
            output = template["canonical_output"]
            self.assertEqual(output, posixpath.basename(output), f"{template['id']}: output must be a basename")
            self.assertRegex(output, r"^[A-Za-z0-9._-]+\.png$")
            self.assertNotIn(output, outputs, f"{output}: duplicate canonical output")
            outputs.add(output)
            self.assertEqual(
                template["figure_layout"]["legend_position"],
                LEGEND_POSITIONS[template["id"]],
                f"{template['id']}: legend position drift",
            )

    def test_render_manifest_paths_are_derived_once_per_line(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            contract_dir = Path(tmp)
            subprocess.run(
                [
                    "node",
                    str(REPO / "ops/render_figure_layout_contracts.mjs"),
                    "--output",
                    str(contract_dir),
                ],
                cwd=REPO,
                check=True,
                capture_output=True,
                text=True,
                timeout=30,
            )
            manifest = json.loads((contract_dir / "manifest.json").read_text("utf-8"))
            self.assertEqual(len(manifest["figures"]), 15)
            paths = set()
            for figure in manifest["figures"]:
                line_id = figure["line_id"]
                expected_prefix = f"figures/{line_id}/"
                self.assertEqual(figure["output_dir"], f"figures/{line_id}")
                self.assertEqual(figure["output_png"], expected_prefix + figure["canonical_output"])
                self.assertEqual(figure["legend_position"], LEGEND_POSITIONS[figure["template_id"]])
                for field in ("output_png", "output_pdf", "output_object", "output_report"):
                    path = figure[field]
                    self.assertTrue(path.startswith(expected_prefix), f"{figure['template_id']}: {field} outside line")
                    self.assertNotIn(path, paths, f"{path}: duplicate artifact path")
                    paths.add(path)

                script = (contract_dir / figure["filename"]).read_text("utf-8")
                declaration = f'output_file = "{figure["output_png"]}"'
                if figure["language"] == "r":
                    declaration = f'output_file <- "{figure["output_png"]}"'
                self.assertEqual(script.count("\n" + declaration), 1, figure["template_id"])
                self.assertNotIn("legend_position=outside", script)

    def test_shell_runner_uses_manifest_quadruplets_and_rejects_missing_report(self) -> None:
        bash = shutil.which("bash")
        if not bash:
            for candidate in (Path("D:/Git/bin/bash.exe"), Path("C:/Program Files/Git/bin/bash.exe")):
                if candidate.is_file():
                    bash = str(candidate)
                    break
        if not bash:
            self.skipTest("bash unavailable")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            contract_dir = root / "contract"
            subprocess.run(
                [
                    "node",
                    str(REPO / "ops/render_figure_layout_contracts.mjs"),
                    "--output",
                    str(contract_dir),
                ],
                cwd=REPO,
                check=True,
                capture_output=True,
                text=True,
                timeout=30,
            )
            manifest = json.loads((contract_dir / "manifest.json").read_text("utf-8"))
            for figure in manifest["figures"]:
                for field in ("output_png", "output_pdf", "output_object", "output_report"):
                    path = contract_dir / figure[field]
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(b"contract\n")

            project_json = root / "project.json"
            project_json.write_text("{}\n", encoding="utf-8")
            command = [
                bash,
                str(REPO / "ops/run_figure_layout_contracts.sh"),
                "--contract-dir",
                contract_dir.as_posix(),
                "--project-json",
                project_json.as_posix(),
                "--seed",
                "42",
                "--manifest-python",
                sys.executable,
                "--verify-only",
            ]
            result = subprocess.run(
                command,
                cwd=REPO,
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            summary = (contract_dir / "run_summary.tsv").read_text("utf-8").splitlines()
            self.assertEqual(len(summary), 16)
            self.assertIn("quadruplet", summary[0])
            self.assertIn("report", summary[0])
            for index, row in enumerate(summary[1:]):
                fields = row.split("\t")
                figure = manifest["figures"][index]
                prefix = f"figures/{figure['line_id']}/"
                self.assertEqual(fields[3], "PASS", row)
                self.assertEqual(fields[4], figure["output_png"])
                self.assertEqual(fields[5], figure["output_pdf"])
                self.assertEqual(fields[6], figure["output_object"])
                self.assertEqual(fields[7], figure["output_report"])
                self.assertNotIn("figures/figures", row)
                self.assertNotIn(f"{prefix}figures", row)
                self.assertEqual(row.count(prefix), 4)

            missing = manifest["figures"][0]
            (contract_dir / missing["output_report"]).unlink()
            failed = subprocess.run(
                command,
                cwd=REPO,
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual(failed.returncode, 1, failed.stdout + failed.stderr)
            failed_rows = (contract_dir / "run_summary.tsv").read_text("utf-8").splitlines()[1:]
            self.assertEqual(failed_rows[0].split("\t")[3], "FAIL")


if __name__ == "__main__":
    unittest.main()
