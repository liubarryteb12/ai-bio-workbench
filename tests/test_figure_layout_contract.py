#!/usr/bin/env python3
"""Single-figure physical-size and fixed-canvas contracts."""

from __future__ import annotations

import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile
import unittest
from pathlib import Path
from textwrap import dedent

HERE = Path(__file__).resolve().parent
REPO = HERE.parent

OPS = REPO / "ops"


def png_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise AssertionError("not a PNG")
    return struct.unpack(">II", data[16:24])


class FigureLayoutContractTest(unittest.TestCase):
    def test_static_visual_rules_have_failing_samples(self) -> None:
        sys.path.insert(0, str(OPS))
        try:
            import audit_figure_visual
        finally:
            sys.path.pop(0)
        samples = {
            "tight_bbox": "fig.savefig('x.png', bbox_inches='tight')\n",
            "tick_rotation_45": "ax.tick_params(axis='x', rotation=45)\n",
            "thin_line": "ax.plot(x, y, linewidth=0.2)\n",
            "rainbow_colormap": "ax.scatter(x, y, cmap='rainbow')\n",
            "red_green_colors": "colors = ['#FF0000', '#00FF00']\n",
            "legend_frame": "ax.legend(frameon=True)\n",
            "legend_position": "ax.legend(frameon=False, loc='lower right')\n",
            "scrna_rasterization": "ax.scatter(x, y, rasterized=False)\n",
        }
        for rule, source in samples.items():
            with self.subTest(rule=rule):
                with tempfile.TemporaryDirectory() as tmp:
                    marker = "umap" if rule == "scrna_rasterization" else "plot"
                    path = Path(tmp) / f"{marker}.py"
                    path.write_text(source, encoding="utf-8")
                    grouped = audit_figure_visual.static_findings(Path(tmp))
                self.assertIn(rule, grouped, f"missing red sample for {rule}")
                self.assertTrue(grouped[rule])
                self.assertEqual(grouped[rule][0]["evidence_type"], "source")

    def test_pdf_width_height_font_and_title_contract(self) -> None:
        sys.path.insert(0, str(OPS))
        try:
            import audit_figure_artifacts
            from pdf_font_audit import audit_pdf
        finally:
            sys.path.pop(0)
        try:
            import matplotlib
            matplotlib.use("Agg")
            matplotlib.rcParams.update({"pdf.fonttype": 42, "ps.fonttype": 42})
            import matplotlib.pyplot as plt
        except ImportError:
            self.skipTest("matplotlib unavailable")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            png = root / "good.png"
            pdf = root / "good.pdf"
            fig, ax = plt.subplots(figsize=(88 / 25.4, 60 / 25.4))
            ax.plot([0, 1], [0, 1], label="series")
            ax.set_title("")
            ax.legend(frameon=False, loc="upper left", bbox_to_anchor=(1.02, 1.0))
            fig.subplots_adjust(right=0.70)
            fig.savefig(png, dpi=300, bbox_inches=None)
            fig.savefig(pdf, dpi=300, bbox_inches=None)
            plt.close(fig)

            report = audit_pdf(pdf)
            self.assertEqual(report["status"], "PASS")
            self.assertEqual(report["metadata_title_empty"], True)
            self.assertLess(abs(report["page_size_mm"][0] - 88), 0.6)
            self.assertLess(abs(report["page_size_mm"][1] - 60), 0.6)

            figure = {
                "template_id": "test",
                "canonical_output": "good.png",
                "width_mm": 88,
                "height_mm": 60,
                "object_kind": "pkl",
            }
            audit = audit_figure_artifacts.audit_one(root, figure)
            self.assertNotIn(
                "visible ink touches canvas edge",
                " ".join(audit["issues"]),
            )

    def test_invalid_pdf_is_unavailable(self) -> None:
        sys.path.insert(0, str(OPS))
        try:
            from pdf_font_audit import audit_pdf
        finally:
            sys.path.pop(0)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pdf_path = root / "bad.pdf"
            with zipfile.ZipFile(pdf_path, "w") as archive:
                archive.writestr("mimetype", "application/pdf")
                archive.writestr("catalog", "")
            report = audit_pdf(pdf_path)
        self.assertEqual(report["status"], "UNAVAILABLE")
        self.assertTrue(report["detail"])

    def test_mixed_type0_and_type1_font_is_rejected(self) -> None:
        sys.path.insert(0, str(OPS))
        try:
            from pdf_font_audit import audit_pdf
        finally:
            sys.path.pop(0)
        try:
            import matplotlib
            matplotlib.use("Agg")
            matplotlib.rcParams.update({"pdf.fonttype": 42})
            import matplotlib.pyplot as plt
            from pypdf import PdfWriter
            from pypdf.generic import DictionaryObject, NameObject
        except ImportError:
            self.skipTest("matplotlib/pypdf unavailable")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pdf_path = root / "mixed.pdf"
            fig, ax = plt.subplots(figsize=(88 / 25.4, 60 / 25.4))
            ax.plot([0, 1], [0, 1])
            ax.set_xlabel("x")
            ax.set_ylabel("y")
            fig.savefig(pdf_path, dpi=300)
            plt.close(fig)

            writer = PdfWriter(clone_from=str(pdf_path))
            fonts = writer.pages[0]["/Resources"]["/Font"].get_object()
            bad_font = DictionaryObject(
                {
                    NameObject("/Type"): NameObject("/Font"),
                    NameObject("/Subtype"): NameObject("/Type1"),
                    NameObject("/BaseFont"): NameObject("/Helvetica"),
                }
            )
            fonts[NameObject("/FBad")] = writer._add_object(bad_font)
            with pdf_path.open("wb") as handle:
                writer.write(handle)
            report = audit_pdf(pdf_path)
        self.assertEqual(report["status"], "FAIL")
        self.assertIn("non-compliant", " ".join(report["detail"]))

    def test_embedded_truetype_without_type0_is_accepted(self) -> None:
        sys.path.insert(0, str(OPS))
        try:
            from pdf_font_audit import audit_pdf
        finally:
            sys.path.pop(0)
        source_pdf = Path(__file__).parent.parent / (
            "artifacts/figure-render-20261029/evidence/probe_dejavu.pdf"
        )
        if not source_pdf.is_file():
            self.skipTest("embedded TrueType PDF fixture unavailable")
        report = audit_pdf(source_pdf)
        self.assertEqual(report["status"], "PASS")
        truetype = [font for font in report["fonts"] if font["subtype"] == "/truetype"]
        self.assertTrue(truetype)
        self.assertTrue(all(font["embedded"] and font["compliant"] for font in truetype))

    def test_pdf_type0_requires_embedded_cidfontfile2(self) -> None:
        sys.path.insert(0, str(OPS))
        try:
            from pdf_font_audit import audit_pdf
        finally:
            sys.path.pop(0)
        try:
            import matplotlib
            matplotlib.use("Agg")
            matplotlib.rcParams.update({"pdf.fonttype": 42})
            import matplotlib.pyplot as plt
        except ImportError:
            self.skipTest("matplotlib unavailable")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pdf_path = root / "type0.pdf"
            fig, ax = plt.subplots(figsize=(88 / 25.4, 60 / 25.4))
            ax.plot([0, 1], [0, 1])
            ax.set_xlabel("x")
            ax.set_ylabel("y")
            fig.savefig(pdf_path, dpi=300)
            plt.close(fig)
            report = audit_pdf(pdf_path)
        self.assertEqual(report["status"], "PASS")
        self.assertIn("embedded", report["evidence_type"])
        type0 = [font for font in report["fonts"] if font["subtype"] == "/type0"]
        self.assertTrue(type0)
        self.assertTrue(all(font["embedded"] for font in type0))

    def test_pdf_type3_is_rejected(self) -> None:
        sys.path.insert(0, str(OPS))
        try:
            from pdf_font_audit import audit_pdf
        finally:
            sys.path.pop(0)
        try:
            import matplotlib
            matplotlib.use("Agg")
            previous = matplotlib.rcParams["pdf.fonttype"]
            matplotlib.rcParams.update({"pdf.fonttype": 3})
            import matplotlib.pyplot as plt
        except ImportError:
            self.skipTest("matplotlib unavailable")
        try:
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                pdf_path = root / "type3.pdf"
                fig, ax = plt.subplots(figsize=(88 / 25.4, 60 / 25.4))
                ax.plot([0, 1], [0, 1])
                ax.set_xlabel("x")
                ax.set_ylabel("y")
                fig.savefig(pdf_path, dpi=300)
                plt.close(fig)
                report = audit_pdf(pdf_path)
        finally:
            matplotlib.rcParams.update({"pdf.fonttype": previous})
        self.assertEqual(report["status"], "FAIL")
        self.assertTrue(any("type3" in font["subtype"] for font in report["fonts"]))

    def test_in_figure_title_uses_source_and_report(self) -> None:
        sys.path.insert(0, str(OPS))
        try:
            import audit_figure_artifacts
            from pdf_font_audit import audit_pdf
        finally:
            sys.path.pop(0)
        try:
            import matplotlib
            matplotlib.use("Agg")
            matplotlib.rcParams.update({"pdf.fonttype": 42})
            import matplotlib.pyplot as plt
        except ImportError:
            self.skipTest("matplotlib unavailable")

        def render(root: Path, name: str) -> None:
            fig, ax = plt.subplots(figsize=(88 / 25.4, 60 / 25.4))
            ax.plot([0, 1], [0, 1])
            ax.set_title("")
            fig.savefig(root / f"{name}.png", dpi=300, bbox_inches=None)
            fig.savefig(root / f"{name}.pdf", dpi=300, bbox_inches=None)
            (root / f"{name}_plot.pkl").write_bytes(b"figure-object")
            plt.close(fig)

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            render(root, "missing_report")
            audit = audit_figure_artifacts.audit_one(
                root,
                {
                    "template_id": "missing_report",
                    "canonical_output": "missing_report.png",
                    "width_mm": 88,
                    "height_mm": 60,
                    "object_kind": "pkl",
                    "source_path": "missing_report.py",
                },
            )
            self.assertIn("figure report missing", " ".join(audit["issues"]))

            render(root, "wrong_report")
            source = root / "wrong_report.py"
            source.write_text(
                dedent(
                    """
                    import matplotlib.pyplot as plt
                    fig, ax = plt.subplots()
                    ax.set_title("Unexpected figure title")
                    fig.savefig("wrong_report.png", dpi=300)
                    fig.savefig("wrong_report.pdf", dpi=300)
                    """
                ),
                encoding="utf-8",
                newline="\n",
            )
            report = root / "wrong_report_report.txt"
            report.write_text("plot_title=empty\n", encoding="utf-8", newline="\n")
            audit = audit_figure_artifacts.audit_one(
                root,
                {
                    "template_id": "wrong_report",
                    "canonical_output": "wrong_report.png",
                    "width_mm": 88,
                    "height_mm": 60,
                    "object_kind": "pkl",
                    "source_path": "wrong_report.py",
                },
            )
            self.assertIn("in-figure plot.title is non-empty", " ".join(audit["issues"]))

            render(root, "good_report")
            report = root / "good_report_report.txt"
            report.write_text("plot_title=empty\n", encoding="utf-8", newline="\n")
            audit = audit_figure_artifacts.audit_one(
                root,
                {
                    "template_id": "good_report",
                    "canonical_output": "good_report.png",
                    "width_mm": 88,
                    "height_mm": 60,
                    "object_kind": "pkl",
                    "source_path": "good_report.py",
                },
            )
            self.assertEqual(audit["status"], "PASS", audit["issues"])

    def test_pdf_metadata_title_is_separate_from_plot_title(self) -> None:
        sys.path.insert(0, str(OPS))
        try:
            from pdf_font_audit import audit_pdf
        finally:
            sys.path.pop(0)
        try:
            import matplotlib
            matplotlib.use("Agg")
            matplotlib.rcParams.update({"pdf.fonttype": 42})
            import matplotlib.pyplot as plt
            from pypdf import PdfWriter
        except ImportError:
            self.skipTest("matplotlib/pypdf unavailable")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pdf_path = root / "metadata.pdf"
            fig, ax = plt.subplots(figsize=(88 / 25.4, 60 / 25.4))
            ax.plot([0, 1], [0, 1])
            ax.set_title("")
            fig.savefig(pdf_path, dpi=300)
            plt.close(fig)
            writer = PdfWriter(clone_from=str(pdf_path))
            writer.add_metadata({"/Title": "Document metadata only"})
            with pdf_path.open("wb") as handle:
                writer.write(handle)
            report = audit_pdf(pdf_path)
        self.assertEqual(report["metadata_title_empty"], False)
        self.assertEqual(report["plot_title_status"], "UNAVAILABLE")

    def test_metadata_title_issue_does_not_change_plot_title_status(self) -> None:
        sys.path.insert(0, str(OPS))
        try:
            import audit_figure_artifacts
            from pypdf import PdfWriter
        finally:
            sys.path.pop(0)
        try:
            import matplotlib
            matplotlib.use("Agg")
            matplotlib.rcParams.update({"pdf.fonttype": 42})
            import matplotlib.pyplot as plt
        except ImportError:
            self.skipTest("matplotlib/pypdf unavailable")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fig, ax = plt.subplots(figsize=(88 / 25.4, 60 / 25.4))
            ax.plot([0, 1], [0, 1])
            ax.set_title("")
            fig.savefig(root / "metadata_only.png", dpi=300, bbox_inches=None)
            pdf_path = root / "metadata_only.pdf"
            fig.savefig(pdf_path, dpi=300, bbox_inches=None)
            plt.close(fig)
            (root / "metadata_only_plot.pkl").write_bytes(b"figure-object")
            (root / "metadata_only_report.txt").write_text(
                "plot_title=empty\n", encoding="utf-8", newline="\n"
            )
            writer = PdfWriter(clone_from=str(pdf_path))
            writer.add_metadata({"/Title": "Metadata only"})
            with pdf_path.open("wb") as handle:
                writer.write(handle)
            audit = audit_figure_artifacts.audit_one(
                root,
                {
                    "template_id": "metadata_only",
                    "canonical_output": "metadata_only.png",
                    "width_mm": 88,
                    "height_mm": 60,
                    "object_kind": "pkl",
                    "source_path": "metadata_only.py",
                },
            )
        self.assertIn("PDF metadata title is non-empty", " ".join(audit["issues"]))
        self.assertEqual(audit["status"], "FAIL", audit["issues"])
        self.assertEqual(audit["metrics"]["plot_title_status"], "PASS")

    def test_manifest_width_and_height_fail_for_rendered_png(self) -> None:
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
        except ImportError:
            self.skipTest("matplotlib unavailable")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            png = root / "wrong.png"
            fig, ax = plt.subplots(figsize=(90 / 25.4, 65 / 25.4))
            ax.plot([0, 1], [0, 1])
            fig.savefig(png, dpi=300, bbox_inches=None)
            plt.close(fig)
            manifest = root / "manifest.json"
            manifest.write_text(
                json.dumps({"figures": [{
                    "template_id": "wrong", "canonical_output": "wrong.png",
                    "width_mm": 88, "height_mm": 60, "object_kind": "pkl",
                }]}),
                encoding="utf-8",
            )
            result = subprocess.run(
                [sys.executable, str(OPS / "audit_figure_artifacts.py"),
                 "--contract-dir", str(root), "--manifest", str(manifest)],
                capture_output=True, text=True, timeout=60,
            )
            self.assertEqual(result.returncode, 1)
            self.assertIn("PNG width", result.stdout)
            self.assertIn("PNG height", result.stdout)

    def test_manifest_uses_declared_subdirectory_paths(self) -> None:
        sys.path.insert(0, str(OPS))
        try:
            import audit_figure_artifacts
        finally:
            sys.path.pop(0)
        try:
            import matplotlib
            matplotlib.use("Agg")
            matplotlib.rcParams.update({"pdf.fonttype": 42})
            import matplotlib.pyplot as plt
        except ImportError:
            self.skipTest("matplotlib unavailable")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            line_dir = root / "figures" / "line1_bulk"
            line_dir.mkdir(parents=True)
            figure = {
                "template_id": "subdir",
                "canonical_output": "subdir_verified.png",
                "output_png": "figures/line1_bulk/subdir_verified.png",
                "output_pdf": "figures/line1_bulk/subdir_verified.pdf",
                "output_object": "figures/line1_bulk/subdir_verified_plot.pkl",
                "output_report": "figures/line1_bulk/subdir_verified_report.txt",
                "width_mm": 88,
                "height_mm": 60,
                "object_kind": "pkl",
                "filename": "fig_subdir.py",
            }
            fig, ax = plt.subplots(figsize=(88 / 25.4, 60 / 25.4))
            ax.plot([0, 1], [0, 1])
            ax.set_title("")
            fig.savefig(line_dir / figure["canonical_output"], dpi=300, bbox_inches=None)
            fig.savefig(line_dir / "subdir_verified.pdf", dpi=300, bbox_inches=None)
            plt.close(fig)
            (line_dir / "subdir_verified_plot.pkl").write_bytes(b"figure-object")
            (line_dir / "subdir_verified_report.txt").write_text(
                "plot_title=empty\n", encoding="utf-8", newline="\n"
            )
            source = line_dir / "fig_subdir.py"
            source.write_text(
                "import matplotlib.pyplot as plt\nfig, ax = plt.subplots()\n"
                "ax.plot([0, 1], [0, 1])\nax.set_title('')\n",
                encoding="utf-8",
            )
            audit = audit_figure_artifacts.audit_one(root, figure)
        self.assertEqual(audit["status"], "PASS", audit["issues"])

    def test_manifest_rejects_paths_outside_contract_dir(self) -> None:
        sys.path.insert(0, str(OPS))
        try:
            import audit_figure_artifacts
        finally:
            sys.path.pop(0)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            outside = Path(tmp).parent / "outside.png"
            outside.write_bytes(b"png")
            figure = {
                "template_id": "escape",
                "canonical_output": "escape_verified.png",
                "output_png": "../outside.png",
                "width_mm": 88,
                "height_mm": 60,
                "object_kind": "pkl",
            }
            audit = audit_figure_artifacts.audit_one(root, figure)
        self.assertEqual(audit["status"], "FAIL", audit["issues"])
        self.assertIn("outside", " ".join(audit["issues"]))

    def test_pdf_media_size_is_audited_for_both_dimensions(self) -> None:
        sys.path.insert(0, str(OPS))
        try:
            import audit_figure_artifacts
        finally:
            sys.path.pop(0)
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
        except ImportError:
            self.skipTest("matplotlib unavailable")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pdf = root / "bad.pdf"
            fig, ax = plt.subplots(figsize=(90 / 25.4, 65 / 25.4))
            ax.plot([0, 1], [0, 1])
            fig.savefig(pdf, dpi=300, bbox_inches=None)
            plt.close(fig)
            audit = audit_figure_artifacts.audit_one(
                root,
                {
                    "canonical_output": "bad.pdf",
                    "width_mm": 88,
                    "height_mm": 60,
                },
            )
        self.assertIn("PDF width", " ".join(audit["issues"]))
        self.assertIn("PDF height", " ".join(audit["issues"]))
    def test_python_default_is_single_column(self) -> None:
        probe = (
            "import json, sys; "
            f"sys.path.insert(0, {json.dumps(str(REPO / 'ops'))}); "
            "from layout_helper import figsize_for; "
            "print(json.dumps(figsize_for('4:3')))"
        )
        result = subprocess.run(
            [sys.executable, "-c", probe],
            cwd=REPO,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            self.skipTest(result.stderr.strip() or "matplotlib unavailable")
        width, height = json.loads(result.stdout)
        self.assertAlmostEqual(width, 88 / 25.4, places=6)
        self.assertAlmostEqual(height, 66.0 / 25.4, places=3)

    def test_fixed_canvas_ignores_tight_bbox(self) -> None:
        try:
            import matplotlib  # noqa: F401
        except ImportError:
            self.skipTest("matplotlib unavailable")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project = root / "project.json"
            project.write_text(
                json.dumps({"plot_layout_config": {"template_id": "template_4x3"}}),
                encoding="utf-8",
            )
            output = root / "single.png"
            script = (
                "import json, matplotlib; "
                "matplotlib.use('Agg'); "
                "import matplotlib.pyplot as plt; "
                f"out = {json.dumps(str(output))}; "
                "fig, ax = plt.subplots(figsize=(88 / 25.4, 85 / 25.4)); "
                "ax.plot([0, 1], [0, 1]); "
                "fig.savefig(out, dpi=300, bbox_inches='tight')"
            )
            env = os.environ.copy()
            env["PYTHONPATH"] = os.pathsep.join(
                [str(REPO / "ops" / "layout_autoload"), str(REPO / "ops")]
            )
            env["BIOANALYS_PROJECT_JSON"] = str(project)
            env["BIOANALYS_LAYOUT_PRESERVE_FIGSIZE"] = "1"
            env["BIOANALYS_LAYOUT_FIXED_CANVAS"] = "1"
            result = subprocess.run(
                [sys.executable, "-c", script],
                cwd=REPO,
                env=env,
                capture_output=True,
                text=True,
                timeout=60,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            width, height = png_size(output)
            self.assertLessEqual(abs(width - round(88 / 25.4 * 300)), 1)
            self.assertLessEqual(abs(height - round(85 / 25.4 * 300)), 1)

    def test_r_default_is_single_column(self) -> None:
        rscript = shutil.which("Rscript")
        if not rscript:
            self.skipTest("Rscript unavailable")
        probe = (
            f"source({json.dumps(str(REPO / 'bin' / 'layout_helper.R'))}); "
            "cat(layout_figsize_r(NULL)[1])"
        )
        result = subprocess.run(
            [rscript, "--vanilla", "-e", probe],
            cwd=REPO,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            self.skipTest(result.stderr.strip() or "R helper unavailable")
        self.assertAlmostEqual(float(result.stdout.strip()), 88 / 25.4, places=5)

    def test_r_autoload_preserves_millimetres(self) -> None:
        rscript = shutil.which("Rscript")
        if not rscript:
            self.skipTest("Rscript unavailable")
        packages = subprocess.run(
            [
                rscript,
                "--vanilla",
                "-e",
                "cat(requireNamespace('ggplot2', quietly=TRUE) && "
                "requireNamespace('jsonlite', quietly=TRUE))",
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if packages.returncode != 0 or packages.stdout.strip() != "TRUE":
            self.skipTest("ggplot2/jsonlite unavailable")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project = root / "project.json"
            project.write_text(
                json.dumps({"plot_layout_config": {"template_id": "template_4x3"}}),
                encoding="utf-8",
            )
            output = root / "single.png"
            script = (
                "library(ggplot2); "
                f"source({json.dumps(str(REPO / 'ops' / 'layout_autoload' / 'Rprofile'))}); "
                "p <- ggplot(data.frame(x=1:3,y=1:3),aes(x,y)) + geom_point(); "
                f"ggsave({json.dumps(str(output))},p,width=88,height=80,"
                "units='mm',dpi=300,bg='white')"
            )
            env = os.environ.copy()
            env["BIOANALYS_PROJECT_JSON"] = str(project)
            env["BIOANALYS_LAYOUT_PRESERVE_FIGSIZE"] = "1"
            env["BIOANALYS_LAYOUT_FIXED_CANVAS"] = "1"
            env["BIOANALYS_LAYOUT_LIB"] = str(REPO / "bin")
            result = subprocess.run(
                [rscript, "--vanilla", "-e", script],
                cwd=REPO,
                env=env,
                capture_output=True,
                text=True,
                timeout=60,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            width, height = png_size(output)
            self.assertLessEqual(abs(width - round(88 / 25.4 * 300)), 1)
            self.assertLessEqual(abs(height - round(80 / 25.4 * 300)), 1)

    def test_raw_python_audit_passes_outside_legend_and_fails_inside(self) -> None:
        try:
            import matplotlib  # noqa: F401
        except ImportError:
            self.skipTest("matplotlib unavailable")
        sys.path.insert(0, str(REPO / "ops"))
        try:
            import audit_figure_layout
        finally:
            sys.path.pop(0)

        template = (
            "import matplotlib; matplotlib.use('Agg'); "
            "import matplotlib.pyplot as plt; "
            "fig, ax = plt.subplots(figsize=(88 / 25.4, 60 / 25.4)); "
            "ax.plot([0, 1], [0, 1], label='series'); "
            "fig.subplots_adjust(left=0.30, right=0.72, bottom=0.24, top=0.86); "
            "{legend}; "
            "fig.savefig('out.png', dpi=300, bbox_inches=None)"
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            passing = root / "pass.py"
            passing.write_text(
                template.format(
                    legend=(
                        "fig.subplots_adjust(right=0.72); "
                        "ax.legend(frameon=False, loc='upper left', "
                        "bbox_to_anchor=(1.02, 1.0))"
                    )
                ),
                encoding="utf-8",
            )
            failing = root / "fail.py"
            failing.write_text(
                template.format(
                    legend="ax.legend(frameon=False, loc='upper right')"
                ),
                encoding="utf-8",
            )

            pass_audit = audit_figure_layout.run_one(
                str(passing), str(root), runner="python"
            )
            fail_audit = audit_figure_layout.run_one(
                str(failing), str(root), runner="python"
            )

        self.assertEqual(pass_audit.figs, 1)
        self.assertEqual(pass_audit.fail, 0, pass_audit.report)
        self.assertEqual(fail_audit.figs, 1)
        self.assertGreater(fail_audit.fail, 0, fail_audit.report)


if __name__ == "__main__":
    unittest.main()
