#!/usr/bin/env python3

import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

OPS_ROOT = Path(__file__).resolve().parents[1]
if str(OPS_ROOT) not in sys.path:
    sys.path.insert(0, str(OPS_ROOT))

from build_figure_catalog import (
    apply_catalog_blocked,
    apply_catalog_verification,
    build_catalog,
)

TEST_DIR = Path(__file__).resolve().parent


class BuildFigureCatalogTest(unittest.TestCase):
    def _make_package(self, root):
        package = root / "package"
        images = package / "images"
        images.mkdir(parents=True)
        Image.new("RGB", (640, 480), "white").save(
            images / "Python__single-chart__0.png"
        )
        Image.new("RGB", (640, 480), "white").save(
            images / "R__multi-chart__0.png"
        )
        db = package / "chart_code_library.db"
        con = sqlite3.connect(db)
        con.execute(
            """
            CREATE TABLE charts (
              id INTEGER PRIMARY KEY, site TEXT, lang TEXT, title TEXT,
              chart_type TEXT, family TEXT, bio_tags TEXT, bio_level TEXT,
              score REAL, peer_count INTEGER, n_code_blocks INTEGER,
              code_lines INTEGER, has_code INT, img_ok INT, n_img INT,
              syntax_ok INT, ext_data INT, deps TEXT, page_url TEXT,
              img_urls TEXT, desc TEXT, code TEXT
            )
            """
        )
        rows = [
            (
                1,
                "Python Graph Gallery",
                "Python",
                "Single chart",
                "scatter",
                "correlation",
                "分组表达/分布",
                "强生信",
                9.0,
                5,
                1,
                4,
                1,
                1,
                1,
                1,
                0,
                "matplotlib.pyplot",
                "https://python-graph-gallery.com/single-chart/",
                "https://raw.githubusercontent.com/holtzy/The-Python-Graph-Gallery/master/content/posts/single-chart/output-1.png",
                "",
                "import matplotlib.pyplot as plt\nplt.plot([1, 2], [3, 4])\n",
            ),
            (
                2,
                "R Graph Gallery",
                "R",
                "Multi chart",
                "Scatter section",
                "Scatter section",
                "分组表达/分布",
                "中生信",
                8.0,
                4,
                2,
                10,
                1,
                1,
                2,
                1,
                0,
                "ggplot2",
                "https://r-graph-gallery.com/multi-chart.html",
                "https://raw.githubusercontent.com/holtzy/R-graph-gallery/master/multi-chart_files/figure-html/unnamed-chunk-1-1.png;https://raw.githubusercontent.com/holtzy/R-graph-gallery/master/multi-chart_files/figure-html/unnamed-chunk-2-1.png",
                "",
                "plot(1:3)\nplot(3:1)\n",
            ),
            (
                3,
                "R Graph Gallery",
                "R",
                "No image",
                "Boxplot Section",
                "Boxplot Section",
                "分组表达/分布",
                "中生信",
                7.0,
                3,
                1,
                3,
                1,
                0,
                0,
                1,
                0,
                "ggplot2",
                "https://r-graph-gallery.com/no-image.html",
                "",
                "",
                "boxplot(1:3)\n",
            ),
        ]
        con.executemany(
            "INSERT INTO charts VALUES (" + ",".join(["?"] * 22) + ")",
            rows,
        )
        con.commit()
        con.close()
        return package

    def test_catalog_materializes_only_single_figure_with_local_image(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            root = Path(tmp)
            package = self._make_package(root)
            output = root / "library"
            report = build_catalog(package, output)
            self.assertEqual(report["summary"]["selected"], 3)
            self.assertEqual(report["summary"]["materialized"], 1)
            self.assertEqual(report["summary"]["needs_split"], 1)
            self.assertEqual(report["summary"]["image_missing"], 1)
            entries = {item["page_id"]: item for item in report["entries"]}
            self.assertEqual(entries[1]["status"], "materialized")
            self.assertEqual(entries[2]["status"], "needs_split")
            self.assertEqual(entries[3]["status"], "image_missing")
            self.assertTrue((output / entries[1]["code_path"]).is_file())
            self.assertTrue((output / entries[1]["preview_path"]).is_file())
            code = (output / entries[1]["code_path"]).read_text(encoding="utf-8")
            self.assertIn("BIOANALYS_SEED", code)
            self.assertIn("BIO_FIGURE_OUTPUT", code)
            self.assertIn("plt.savefig", code)
            self.assertNotIn(
                b"\r\n",
                (output / "manifest.csv").read_bytes(),
            )

    def test_verified_catalog_entry_records_evidence_and_updates_manifest(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            root = Path(tmp)
            package = self._make_package(root)
            output = root / "library"
            report = build_catalog(package, output)
            entry = next(item for item in report["entries"] if item["page_id"] == 1)
            evidence = output / "evidence" / entry["catalog_id"]
            evidence.mkdir(parents=True)
            (evidence / "verification.json").write_text(
                '{"status":"k40_verified","exit_code":0,"validation_exit":0}\n',
                encoding="utf-8",
            )
            updated = apply_catalog_verification(output, entry["catalog_id"], evidence)
            updated_entry = next(
                item
                for item in updated["entries"]
                if item["catalog_id"] == entry["catalog_id"]
            )
            self.assertEqual(updated_entry["status"], "k40_verified")
            self.assertEqual(updated["summary"]["k40_verified"], 1)
            manifest = (output / "manifest.csv").read_text(encoding="utf-8")
            self.assertIn("k40_verified", manifest)

    def test_rebuild_preserves_verification_when_source_hash_is_unchanged(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            root = Path(tmp)
            package = self._make_package(root)
            output = root / "library"
            report = build_catalog(package, output)
            entry = next(item for item in report["entries"] if item["page_id"] == 1)
            evidence = output / "evidence" / entry["catalog_id"]
            evidence.mkdir(parents=True)
            (evidence / "verification.json").write_text(
                '{"status":"k40_verified","exit_code":0,"validation_exit":0}\n',
                encoding="utf-8",
            )
            apply_catalog_verification(output, entry["catalog_id"], evidence)
            rebuilt = build_catalog(package, output)
            rebuilt_entry = next(
                item
                for item in rebuilt["entries"]
                if item["catalog_id"] == entry["catalog_id"]
            )
            self.assertEqual(rebuilt_entry["status"], "k40_verified")
            self.assertEqual(
                rebuilt_entry["verification_path"],
                f"evidence/{entry['catalog_id']}/verification.json",
            )

    def test_blocked_outcome_is_recorded_without_claiming_verification(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            root = Path(tmp)
            package = self._make_package(root)
            output = root / "library"
            report = build_catalog(package, output)
            entry = next(item for item in report["entries"] if item["page_id"] == 1)
            evidence = output / "evidence" / entry["catalog_id"]
            evidence.mkdir(parents=True)
            (evidence / "verification.json").write_text(
                '{"status":"failed","failure_kind":"dependency_failure",'
                '"exit_code":1,"validation_exit":1}\n',
                encoding="utf-8",
            )
            updated = apply_catalog_blocked(
                output,
                entry["catalog_id"],
                "dependency_failure",
                evidence,
            )
            updated_entry = next(
                item
                for item in updated["entries"]
                if item["catalog_id"] == entry["catalog_id"]
            )
            self.assertEqual(updated_entry["status"], "blocked_dependency")
            self.assertEqual(updated["summary"]["blocked_dependency"], 1)
            self.assertEqual(updated["summary"]["k40_verified"], 0)
            rebuilt = build_catalog(package, output)
            rebuilt_entry = next(
                item
                for item in rebuilt["entries"]
                if item["catalog_id"] == entry["catalog_id"]
            )
            self.assertEqual(rebuilt_entry["status"], "blocked_dependency")


if __name__ == "__main__":
    unittest.main()
