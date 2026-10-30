#!/usr/bin/env python3
"""Read-only release batching plan tests."""

from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "ops" / "release-plan.mjs"


class ReleasePlanTestCase(unittest.TestCase):
    def test_a2a_config_is_classified_with_module_implementation(self) -> None:
        result = subprocess.run(
            [
                "node",
                "--input-type=module",
                "-e",
                (
                    "import { classifyFile } from './ops/release-plan.mjs';"
                    "console.log(classifyFile('configs/a2a/pi-settings.example.json'));"
                ),
            ],
            cwd=REPO,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout.strip(), "mods")

    def test_desktop_source_is_classified_with_module_implementation(self) -> None:
        result = subprocess.run(
            [
                "node",
                "--input-type=module",
                "-e",
                (
                    "import { classifyFile } from './ops/release-plan.mjs';"
                    "console.log(classifyFile('BioanalysDesktop/src/App.tsx'));"
                ),
            ],
            cwd=REPO,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout.strip(), "mods")

    def test_line1_scripts_and_workflow_config_are_mods(self) -> None:
        result = subprocess.run(
            [
                "node",
                "--input-type=module",
                "-e",
                (
                    "import { classifyFile } from './ops/release-plan.mjs';"
                    "console.log(["
                    "classifyFile('src/line1_bulk/scripts/prep_matrix'),"
                    "classifyFile('src/workflows.json')"
                    "].join(','));"
                ),
            ],
            cwd=REPO,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout.strip(), "mods,mods")

    def test_figure_registry_sources_and_previews_are_mods(self) -> None:
        result = subprocess.run(
            [
                "node",
                "--input-type=module",
                "-e",
                (
                    "import { classifyFile } from './ops/release-plan.mjs';"
                    "console.log(["
                    "classifyFile('src/figure_templates.json'),"
                    "classifyFile('src/figure_sources/fig_l1_boxplot.R'),"
                    "classifyFile('src/figure_previews/fig_l2_pca.png')"
                    "].join(','));"
                ),
            ],
            cwd=REPO,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout.strip(), "mods,mods,mods")

    def test_reference_deletions_and_bin_modifications_are_batched(self) -> None:
        result = subprocess.run(
            [
                "node",
                "--input-type=module",
                "-e",
                (
                    "import { classifyFile } from './ops/release-plan.mjs';"
                    "console.log(["
                    "classifyFile('reference/05.可参考出图代码/_meta/script_plot_matrix.json'),"
                    "classifyFile('reference/05.可参考出图代码/library/catalog.json'),"
                    "classifyFile('bin/layout_helper.R')"
                    "].join(','));"
                ),
            ],
            cwd=REPO,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout.strip(), "docs-release,docs-release,mods")

    def test_portal_runtime_is_classified_with_module_implementation(self) -> None:
        result = subprocess.run(
            [
                "node",
                "--input-type=module",
                "-e",
                (
                    "import { classifyFile } from './ops/release-plan.mjs';"
                    "console.log(classifyFile('portal/serve.mjs'));"
                ),
            ],
            cwd=REPO,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout.strip(), "mods")

    def test_desktop_test_build_output_is_ignored(self) -> None:
        result = subprocess.run(
            ["git", "check-ignore", "-q", "BioanalysDesktop/tests/.build/node-tests.tap"],
            cwd=REPO,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_current_worktree_is_fully_classified_into_four_batches(self) -> None:
        result = subprocess.run(
            ["node", str(SCRIPT), "--json"],
            cwd=REPO,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["unassigned"], [])
        self.assertEqual(
            [batch["id"] for batch in payload["batches"]],
            ["core-engines", "mods", "tests-ledger", "docs-release"],
        )
        self.assertGreater(payload["summary"]["total"], 0)


if __name__ == "__main__":
    unittest.main()
