#!/usr/bin/env python3

import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

OPS_ROOT = Path(__file__).resolve().parents[1]
if str(OPS_ROOT) not in sys.path:
    sys.path.insert(0, str(OPS_ROOT))

from analyze_figure_catalog_splits import (
    BLOCKED_EXTERNAL_DATA,
    NEEDS_MANUAL_MAPPING,
    NEEDS_PRIMARY_IMAGE,
    SPLIT_READY,
    analyze_catalog,
    main,
    validate_plan,
)


TEST_DIR = Path(__file__).resolve().parent


class AnalyzeFigureCatalogSplitsTest(unittest.TestCase):
    def _make_catalog(self, root):
        library = root / "library"
        library.mkdir()
        images = root / "images"
        images.mkdir()
        Image.new("RGB", (300, 200), "white").save(
            images / "Python__587-how-to-use-colormap__0.png"
        )
        Image.new("RGB", (400, 220), "white").save(
            images / "R__circular-plot__0.png"
        )

        def entry(
            catalog_id,
            lang,
            title,
            page_url,
            image_url,
            n_code_blocks,
            n_img,
            ext_data,
            code,
            status="needs_split",
        ):
            return {
                "catalog_id": catalog_id,
                "status": status,
                "lang": lang,
                "title": title,
                "chart_type": "scatter",
                "family": "correlation",
                "bio_level": "强生信",
                "bio_tags": "热图/表达矩阵",
                "score": 9,
                "page_url": page_url,
                "image_url": image_url,
                "n_code_blocks": n_code_blocks,
                "n_img": n_img,
                "ext_data": ext_data,
                "code": code,
            }

        entries = [
            entry(
                "pgg_0551",
                "Python",
                "Colormap examples",
                "https://python-graph-gallery.com/587-how-to-use-colormap/",
                "https://example.com/output-1.png",
                2,
                2,
                0,
                "# ---- cell ----\nfig, ax = plt.subplots()\nplt.show()\n"
                "# ---- cell ----\nfig, ax = plt.subplots()\nplt.show()\n",
            ),
            entry(
                "rgg_0003",
                "R",
                "Circular plot examples",
                "https://r-graph-gallery.com/circular-plot/",
                "https://example.com/r-1.png",
                2,
                1,
                0,
                "library(circlize)\nchordDiagram(matrix(1:4, 2))\n"
                "# ---- chunk ----\ncircos.points(1, 1)\n",
            ),
            entry(
                "pgg_0645",
                "Python",
                "Heatmap and radial barchart",
                "https://python-graph-gallery.com/web-heatmap-and-radial-barchart-plastics/",
                "https://example.com/py-1.png",
                4,
                3,
                1,
                "# ---- cell ----\nfig, ax = plt.subplots()\nplt.show()\n",
            ),
            entry(
                "pgg_0002",
                "Python",
                "No image",
                "https://python-graph-gallery.com/no-image/",
                "",
                1,
                0,
                0,
                "plt.show()\n",
            ),
            entry(
                "pgg_0001",
                "Python",
                "Existing",
                "https://python-graph-gallery.com/existing/",
                "https://example.com/old-1.png",
                1,
                1,
                0,
                "plt.show()\n",
                status="materialized",
            ),
        ]
        catalog_path = library / "catalog.json"
        catalog_path.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "generated_at": "2026-10-27T00:00:00Z",
                    "entries": entries,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
            newline="\n",
        )
        return catalog_path

    def test_analyze_catalog_covers_all_needs_split_records(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            root = Path(tmp)
            catalog_path = self._make_catalog(root)
            result = analyze_catalog(catalog_path, root / "images")
            by_id = {item["catalog_id"]: item for item in result["records"]}

            self.assertEqual(4, len(result["records"]))
            self.assertEqual(SPLIT_READY, by_id["pgg_0551"]["classification"])
            self.assertEqual(
                NEEDS_MANUAL_MAPPING, by_id["rgg_0003"]["classification"]
            )
            self.assertEqual(
                BLOCKED_EXTERNAL_DATA, by_id["pgg_0645"]["classification"]
            )
            self.assertEqual(
                NEEDS_PRIMARY_IMAGE, by_id["pgg_0002"]["classification"]
            )
            self.assertTrue(result["summary"]["coverage_complete"])

    def test_split_ready_uses_local_primary_image(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            root = Path(tmp)
            catalog_path = self._make_catalog(root)
            result = analyze_catalog(catalog_path, root / "images")
            by_id = {item["catalog_id"]: item for item in result["records"]}
            item = by_id["pgg_0551"]

            self.assertEqual(300, item["primary_image"]["width"])
            self.assertEqual(200, item["primary_image"]["height"])
            self.assertEqual(2, item["candidate_figures"])
            self.assertGreaterEqual(item["confidence"], 0.8)

    def test_validate_plan_rejects_incomplete_or_malformed_plan(self):
        with self.assertRaises(ValueError):
            validate_plan({"schema_version": 1, "records": []})

    def test_validate_plan_rejects_path_escape(self):
        plan = {
            "schema_version": 1,
            "records": [
                {
                    "catalog_id": "pgg_0551",
                    "classification": SPLIT_READY,
                    "confidence": 0.9,
                    "blockers": [],
                    "candidate_figures": 1,
                    "primary_image": {"local_path": "../outside.png"},
                }
            ],
        }
        with self.assertRaises(ValueError):
            validate_plan(plan)

    def test_main_writes_outputs_and_exits_zero(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            root = Path(tmp)
            catalog_path = self._make_catalog(root)
            output = root / "split_plan"
            code = main(
                [
                    "--catalog",
                    str(catalog_path),
                    "--images",
                    str(root / "images"),
                    "--output",
                    str(output),
                ]
            )

            self.assertEqual(0, code)
            self.assertTrue((output / "split_plan.json").exists())
            self.assertTrue((output / "summary.md").exists())
            plan = json.loads(
                (output / "split_plan.json").read_text(encoding="utf-8")
            )
            self.assertEqual(4, len(plan["records"]))

    def test_main_rejects_output_outside_workspace(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            root = Path(tmp)
            catalog_path = self._make_catalog(root)
            output = TEST_DIR.parents[2]
            code = main(
                [
                    "--catalog",
                    str(catalog_path),
                    "--images",
                    str(root / "images"),
                    "--output",
                    str(output),
                ]
            )

            self.assertEqual(2, code)
            self.assertFalse((output / "split_plan.json").exists())


if __name__ == "__main__":
    unittest.main()
