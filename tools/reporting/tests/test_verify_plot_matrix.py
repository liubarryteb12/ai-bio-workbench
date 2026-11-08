#!/usr/bin/env python3

import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

OPS_ROOT = Path(__file__).resolve().parents[1]
if str(OPS_ROOT) not in sys.path:
    sys.path.insert(0, str(OPS_ROOT))

from verify_plot_matrix import (
    ENTRY_SPECS,
    child_environment,
    ensure_within,
    inspect_png,
    marker_present,
    markdown_report,
    redact_text,
    rewrite_boxplot_output_root,
    safe_target_name,
    safe_sha256,
    summarize_artifacts,
    validate_payload_entries,
    version_text,
)

TEST_DIR = Path(__file__).resolve().parent


class VerifyPlotMatrixTest(unittest.TestCase):
    def test_inventory_has_28_sources_and_one_quarantine(self):
        self.assertEqual(len(ENTRY_SPECS), 28)
        self.assertEqual(
            sum(not item.get("quarantined", False) for item in ENTRY_SPECS),
            27,
        )
        self.assertEqual(
            sum(item.get("quarantined", False) for item in ENTRY_SPECS),
            1,
        )

    def test_boxplot_copy_rewrites_only_output_root(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            source = Path(tmp) / "boxplot.R"
            source.write_text(
                'dir.create("/tmp/figlib")\n'
                'ggsave("/tmp/figlib/plot.png")\n'
                'cat("RENDER_OK\\n")\n',
                encoding="utf-8",
            )
            target = Path(tmp) / "run" / "boxplot.R"
            changed = rewrite_boxplot_output_root(source, target)
            text = target.read_text(encoding="utf-8")
            self.assertTrue(changed)
            self.assertNotIn("/tmp/figlib", text)
            self.assertIn(str(target.parent).replace("\\", "/"), text)
            self.assertIn('cat("RENDER_OK\\n")', text)

    def test_blank_png_is_rejected(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            path = Path(tmp) / "blank.png"
            Image.new("RGB", (240, 180), "white").save(path)
            ok, meta = inspect_png(path)
            self.assertFalse(ok)
            self.assertIn("blank", meta["detail"].lower())

    def test_nonblank_png_records_dpi_and_pixel_variance(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            path = Path(tmp) / "plot.png"
            image = Image.new("RGB", (240, 180), "white")
            draw = ImageDraw.Draw(image)
            draw.rectangle((20, 20, 220, 160), fill="navy")
            image.save(path, dpi=(300, 300))
            ok, meta = inspect_png(path)
            self.assertTrue(ok)
            self.assertGreater(meta["pixel_variance"], 1.0)
            self.assertAlmostEqual(meta["dpi"][0], 300, delta=2)
            self.assertAlmostEqual(meta["dpi"][1], 300, delta=2)

    def test_low_or_missing_dpi_png_is_rejected(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            for filename, save_kwargs in (
                ("low.png", {"dpi": (150.012, 150.012)}),
                ("missing.png", {}),
            ):
                path = Path(tmp) / filename
                image = Image.new("RGB", (240, 180), "white")
                draw = ImageDraw.Draw(image)
                draw.rectangle((20, 20, 220, 160), fill="navy")
                image.save(path, **save_kwargs)
                ok, meta = inspect_png(path)
                self.assertFalse(ok, filename)
                self.assertIn("300 dpi", meta["detail"].lower())

    def test_child_environment_caps_threads_at_three(self):
        env = child_environment()
        for name in (
            "OMP_NUM_THREADS",
            "OPENBLAS_NUM_THREADS",
            "MKL_NUM_THREADS",
            "NUMEXPR_NUM_THREADS",
            "NUMBA_NUM_THREADS",
            "VECLIB_MAXIMUM_THREADS",
        ):
            self.assertEqual(env[name], "3")

    def test_render_marker_can_come_from_report_file(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            report = Path(tmp) / "render_report.txt"
            report.write_text("RENDER_OK=multipanel\n", encoding="utf-8")
            self.assertTrue(marker_present("", [report]))
            self.assertFalse(marker_present("", []))

    def test_artifact_summary_counts_unique_png_hashes(self):
        entries = [
            {
                "artifacts": [
                    {"path": "a.png", "sha256": "same"},
                    {"path": "b.png", "sha256": "same"},
                    {"path": "c.pdf", "sha256": "pdf"},
                    {"path": "d.txt", "sha256": "txt"},
                ]
            }
        ]
        summary = summarize_artifacts(entries)
        self.assertEqual(summary["total"], 4)
        self.assertEqual(summary["png"], 2)
        self.assertEqual(summary["png_unique_sha256"], 1)
        self.assertEqual(summary["pdf"], 1)
        self.assertEqual(summary["txt"], 1)

    def test_workspace_boundary_rejects_parent_escape(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            root = Path(tmp)
            with self.assertRaises(ValueError):
                ensure_within(root / ".." / "escape", root)

    def test_secret_values_are_redacted(self):
        text = "API_KEY=abc123\nstatus=ok"
        self.assertEqual(
            redact_text(text, {"API_KEY": "abc123"}),
            "API_KEY=<REDACTED>\nstatus=ok",
        )

    def test_missing_source_hash_returns_none(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            self.assertIsNone(safe_sha256(Path(tmp) / "missing.R"))

    def test_dot_target_names_are_rejected(self):
        with self.assertRaises(ValueError):
            safe_target_name(".")
        with self.assertRaises(ValueError):
            safe_target_name("..")
        with self.assertRaises(ValueError):
            safe_target_name("source.R")

    def test_missing_version_binary_is_a_reportable_error(self):
        with self.assertRaises(RuntimeError):
            version_text(["/definitely/missing-binary", "--version"], {})

    def test_payload_manifest_rejects_duplicate_ids(self):
        expected = {item["id"] for item in ENTRY_SPECS}
        item = {
            "id": "l1_boxplot",
            "source": "L1_boxplot_code.R",
            "source_suffix": ".R",
            "source_sha256": "a" * 64,
            "inputs": [],
        }
        with self.assertRaises(ValueError):
            validate_payload_entries([item, dict(item)], expected)

    def test_payload_manifest_rejects_bad_hash_and_target(self):
        expected = {item["id"] for item in ENTRY_SPECS}
        bad_hash = {
            "id": "l1_boxplot",
            "source": "L1_boxplot_code.R",
            "source_suffix": ".R",
            "source_sha256": "not-a-hash",
            "inputs": [],
        }
        with self.assertRaises(ValueError):
            validate_payload_entries([bad_hash], expected)
        bad_target = dict(bad_hash)
        bad_target["source_sha256"] = "a" * 64
        bad_target["inputs"] = [{"source": "input.csv", "target": ".."}]
        with self.assertRaises(ValueError):
            validate_payload_entries([bad_target], expected)

    def test_markdown_declares_single_png_usage(self):
        report = {
            "run_id": "demo",
            "entries": [],
            "summary": {
                "total": 0,
                "executed": 0,
                "available": 0,
                "failed": 0,
                "quarantined": 0,
                "artifacts": {
                    "total": 0,
                    "png": 0,
                    "png_unique_sha256": 0,
                    "pdf": 0,
                    "txt": 0,
                    "invalid": 0,
                },
            },
        }
        text = markdown_report(report)
        self.assertIn("usage unit is each individual", text)
        self.assertIn("QA-only and is not a deliverable", text)


if __name__ == "__main__":
    unittest.main()
