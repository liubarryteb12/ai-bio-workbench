#!/usr/bin/env python3

import sys
import tempfile
import unittest
from pathlib import Path

OPS_ROOT = Path(__file__).resolve().parents[1]
if str(OPS_ROOT) not in sys.path:
    sys.path.insert(0, str(OPS_ROOT))

from verify_r453_figures import FIGURES, validate_artifact


class VerifyR453FiguresTest(unittest.TestCase):
    def test_matrix_has_17_unique_figures(self):
        self.assertEqual(len(FIGURES), 17)
        self.assertEqual(len({item["id"] for item in FIGURES}), 17)

    def test_scanpy_artifacts_follow_save_path_contract(self):
        figures = {item["id"]: item["artifacts"] for item in FIGURES}
        self.assertEqual(
            figures["fig_l2p_dotplot"],
            "py_l2p_more:figures/dotplot__L2p_dotplot_verified.png",
        )
        self.assertEqual(
            figures["fig_l2p_violin"],
            "py_l2p_more:figures/violin_L2p_violin_verified.png",
        )

    def test_kegg_without_pathview_source_is_explicitly_blocked(self):
        figures = {item["id"]: item for item in FIGURES}
        self.assertNotIn("fig_l2_enrichment", figures)
        blocked = figures["fig_kegg_pathway"]
        self.assertEqual(blocked["artifacts"], [])
        self.assertIn("pathview", blocked["blocked_reason"])

    def test_png_and_pdf_signatures_are_enforced(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            png = root / "ok.png"
            png.write_bytes(b"\x89PNG\r\n\x1a\n" + b"x" * 6000)
            pdf = root / "ok.pdf"
            pdf.write_bytes(b"%PDF-1.7\n" + b"x" * 1200)
            self.assertEqual(validate_artifact(png), (True, "ok"))
            self.assertEqual(validate_artifact(pdf), (True, "ok"))
            bad = root / "bad.png"
            bad.write_bytes(b"not-a-png" + b"x" * 6000)
            ok, reason = validate_artifact(bad)
            self.assertFalse(ok)
            self.assertIn("PNG", reason)


if __name__ == "__main__":
    unittest.main()
