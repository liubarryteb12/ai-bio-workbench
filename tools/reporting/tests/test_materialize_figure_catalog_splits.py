#!/usr/bin/env python3

import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


OPS_ROOT = Path(__file__).resolve().parents[1]
if str(OPS_ROOT) not in sys.path:
    sys.path.insert(0, str(OPS_ROOT))

from materialize_figure_catalog_splits import (
    EXIT_OK,
    EXIT_USAGE,
    EXIT_VALIDATION,
    materialize_plan,
    main,
    validate_result,
)


TEST_DIR = Path(__file__).resolve().parent


def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def make_code(candidate_count):
    cells = [
        (
            "import matplotlib.pyplot as plt\n"
            f"plt.figure({index})\n"
            "plt.show()\n"
        )
        for index in range(candidate_count)
    ]
    return "\n# ---- cell ----\n".join(cells)


def make_plan(
    catalog_id="pgg_0001",
    candidate_count=2,
    catalog_sha="a" * 64,
    primary_sha="b" * 64,
):
    return {
        "schema_version": 1,
        "source_catalog": "library/catalog.json",
        "source_catalog_sha256": catalog_sha,
        "summary": {
            "needs_split_total": 1,
            "coverage_complete": True,
            "counts": {"split_ready": 1},
        },
        "records": [
            {
                "catalog_id": catalog_id,
                "page_id": 1,
                "lang": "Python",
                "title": "Example figure",
                "classification": "split_ready",
                "confidence": 0.9,
                "blockers": [],
                "candidate_figures": candidate_count,
                "code_cells": candidate_count,
                "source_images": candidate_count,
                "page_url": "https://example.com/page/",
                "primary_image_url": "https://example.com/output-1.png",
                "primary_image": {
                    "local_path": "Python__page__0.png",
                    "width": 320,
                    "height": 240,
                    "sha256": primary_sha,
                },
            }
        ],
    }


class MaterializeFigureCatalogSplitsTest(unittest.TestCase):
    def _make_library(
        self, root, catalog_id="pgg_0001", candidate_count=2, primary_sha=None
    ):
        library = root / "library"
        figures = library / "figures"
        figures.mkdir(parents=True)
        (library / "code").mkdir(parents=True)
        image_path = figures / "Python__page__0.png"
        Image.new("RGB", (320, 240), "white").save(image_path)

        code_path = library / "code" / f"{catalog_id}.py"
        code = make_code(candidate_count)
        code_path.write_text(code, encoding="utf-8", newline="\n")
        catalog = {
            "schema_version": 1,
            "entries": [
                {
                    "catalog_id": catalog_id,
                    "lang": "Python",
                    "code": code,
                    "img_urls": ";".join(
                        f"https://example.com/output-{index}.png"
                        for index in range(1, candidate_count + 1)
                    ),
                }
            ],
        }
        catalog_path = library / "catalog.json"
        catalog_path.write_text(
            json.dumps(catalog), encoding="utf-8", newline="\n"
        )
        plan = make_plan(
            catalog_id,
            candidate_count=candidate_count,
            catalog_sha=sha256_file(catalog_path),
            primary_sha=primary_sha or sha256_file(image_path),
        )
        return library, plan

    def test_materialize_plan_writes_candidate_code_and_manifest(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            root = Path(tmp)
            library, plan = self._make_library(root)
            plan_path = root / "split_plan.json"
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            output = root / "split_materialized"
            code = main(
                [
                    "--plan",
                    str(plan_path),
                    "--catalog",
                    str(library / "catalog.json"),
                    "--images",
                    str(library / "figures"),
                    "--output",
                    str(output),
                ]
            )

            self.assertEqual(EXIT_OK, code)
            result_path = output / "split_candidates.json"
            self.assertTrue(result_path.exists())
            result = json.loads(result_path.read_text(encoding="utf-8"))
            record = result["records"][0]
            self.assertEqual("split_materialized", record["status"])
            self.assertEqual(2, record["candidate_count"])
            self.assertEqual(2, len(record["candidates"]))
            candidate = record["candidates"][0]
            self.assertEqual(1, candidate["figure_index"])
            self.assertTrue((output / candidate["code_path"]).is_file())
            self.assertEqual("previews/pgg_0001__01.png", candidate["preview_path"])
            self.assertTrue((output / candidate["preview_path"]).is_file())
            self.assertIsNone(record["candidates"][1]["preview_path"])
            self.assertEqual(
                "source_image_unavailable",
                record["candidates"][1]["preview_source"],
            )

    def test_preview_uses_primary_image_and_records_sha256(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            root = Path(tmp)
            library, plan = self._make_library(root)
            output = root / "split_materialized"
            materialize_plan(
                plan, library / "catalog.json", library / "figures", output
            )
            result = json.loads(
                (output / "split_candidates.json").read_text(encoding="utf-8")
            )
            candidate = result["records"][0]["candidates"][0]
            self.assertEqual(
                sha256_file(library / "figures" / "Python__page__0.png"),
                candidate["preview_sha256"],
            )
            self.assertEqual(320, candidate["width"])
            self.assertEqual(240, candidate["height"])

    def test_candidate_code_comes_from_ordered_source_cells(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            root = Path(tmp)
            library, plan = self._make_library(root, candidate_count=3)
            output = root / "split_materialized"
            result = materialize_plan(
                plan, library / "catalog.json", library / "figures", output
            )
            record = result["records"][0]
            for index, candidate in enumerate(record["candidates"], 1):
                text = (output / candidate["code_path"]).read_text(encoding="utf-8")
                self.assertIn(f"plt.figure({index - 1})", text)
                self.assertEqual(
                    hashlib.sha256(text.encode("utf-8")).hexdigest(),
                    candidate["code_sha256"],
                )

    def test_missing_primary_image_returns_validation_error(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            root = Path(tmp)
            library, plan = self._make_library(root)
            (library / "figures" / "Python__page__0.png").unlink()
            with self.assertRaises(FileNotFoundError):
                materialize_plan(
                    plan, library / "catalog.json", library / "figures", root / "out"
                )

    def test_primary_hash_mismatch_returns_validation_error(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            root = Path(tmp)
            library, plan = self._make_library(root, primary_sha="c" * 64)
            with self.assertRaises(ValueError):
                materialize_plan(
                    plan, library / "catalog.json", library / "figures", root / "out"
                )

    def test_validate_result_requires_complete_fields(self):
        record = {
            "catalog_id": "pgg_0001",
            "status": "split_materialized",
            "candidate_count": 1,
            "candidates": [
                {
                    "figure_index": 1,
                    "code_path": "code/pgg_0001__01.py",
                    "code_sha256": "a" * 64,
                    "preview_path": "previews/pgg_0001__01.png",
                    "preview_sha256": "b" * 64,
                    "width": 320,
                    "height": 240,
                    "source_image_url": "https://example.com/output-1.png",
                    "source_page": "https://example.com/page/",
                    "verification": "not_verified",
                }
            ],
        }
        self.assertTrue(validate_result({"records": [record]}))

        record["candidates"][0]["code_sha256"] = "short"
        with self.assertRaises(ValueError):
            validate_result({"records": [record]})

    def test_main_rejects_output_outside_workspace(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            root = Path(tmp)
            library, plan = self._make_library(root)
            plan_path = root / "split_plan.json"
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            outside = TEST_DIR.parents[2]
            code = main(
                [
                    "--plan",
                    str(plan_path),
                    "--catalog",
                    str(library / "catalog.json"),
                    "--images",
                    str(library / "figures"),
                    "--output",
                    str(outside),
                ]
            )

            self.assertEqual(EXIT_USAGE, code)
            self.assertFalse((outside / "split_candidates.json").exists())

    def test_main_rejects_malformed_plan_as_validation_error(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            root = Path(tmp)
            library, plan = self._make_library(root)
            plan["records"][0]["classification"] = "wrong"
            plan_path = root / "split_plan.json"
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            code = main(
                [
                    "--plan",
                    str(plan_path),
                    "--catalog",
                    str(library / "catalog.json"),
                    "--images",
                    str(library / "figures"),
                    "--output",
                    str(root / "out"),
                ]
            )

            self.assertEqual(EXIT_VALIDATION, code)
            self.assertFalse((root / "out" / "split_candidates.json").exists())

    def test_materialize_ignores_non_split_ready_records(self):
        with tempfile.TemporaryDirectory(dir=TEST_DIR) as tmp:
            root = Path(tmp)
            library, plan = self._make_library(root)
            plan["records"].append(
                {
                    "catalog_id": "pgg_0002",
                    "classification": "needs_manual_mapping",
                    "confidence": 0.5,
                    "blockers": ["more_code_cells_than_images"],
                    "candidate_figures": 2,
                    "primary_image": None,
                }
            )
            output = root / "split_materialized"
            result = materialize_plan(
                plan, library / "catalog.json", library / "figures", output
            )

            self.assertEqual(1, len(result["records"]))
            self.assertEqual("pgg_0001", result["records"][0]["catalog_id"])
