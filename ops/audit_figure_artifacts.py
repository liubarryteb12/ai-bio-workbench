#!/usr/bin/env python3
"""Audit rendered single-figure PNG, PDF and editable-object artifacts."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import struct
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audit_figure_visual import audit_visual
from pdf_font_audit import audit_pdf

MIN_DPI = 299.0
MAX_FILE_BYTES = 10 * 1024 * 1024
SIZE_TOLERANCE_MM = 0.6
MIN_EDGE_MARGIN_PX = 2
MIN_CONTENT_WIDTH_RATIO = 0.50
MIN_CONTENT_HEIGHT_RATIO = 0.45
INK_THRESHOLD = 8


def read_png_header(path: Path) -> dict:
    result = {"width_px": 0, "height_px": 0, "dpi": 0.0}
    with path.open("rb") as handle:
        if handle.read(8) != b"\x89PNG\r\n\x1a\n":
            raise ValueError("not a PNG")
        while True:
            header = handle.read(8)
            if len(header) < 8:
                break
            length = struct.unpack(">I", header[:4])[0]
            chunk_type = header[4:8]
            data = handle.read(length)
            handle.read(4)
            if chunk_type == b"IHDR" and length >= 13:
                width, height = struct.unpack(">II", data[:8])
                result["width_px"] = width
                result["height_px"] = height
            elif chunk_type == b"pHYs" and length >= 9:
                ppux, _ppuy, unit = struct.unpack(">IIB", data[:9])
                if unit == 1:
                    result["dpi"] = ppux * 0.0254
            elif chunk_type == b"IEND":
                break
    return result


def image_metrics(path: Path) -> dict:
    try:
        from PIL import Image, ImageChops
    except ImportError as exc:
        raise RuntimeError("Pillow is required for image layout audit") from exc

    with Image.open(path) as source:
        image = source.convert("RGB")
        white = Image.new("RGB", image.size, (255, 255, 255))
        diff = ImageChops.difference(image, white).convert("L")
        mask = diff.point(lambda value: 255 if value > INK_THRESHOLD else 0)
        bbox = mask.getbbox()
        if bbox is None:
            raise ValueError("PNG contains no visible ink")
        left, top, right, bottom = bbox
        width, height = image.size
        return {
            "width_px": width,
            "height_px": height,
            "ink_bbox": [left, top, right, bottom],
            "margins_px": {
                "left": left,
                "top": top,
                "right": width - right,
                "bottom": height - bottom,
            },
            "content_width_ratio": (right - left) / width,
            "content_height_ratio": (bottom - top) / height,
        }


def pdf_media_box(path: Path) -> list[float] | None:
    gs = shutil.which("gs")
    if not gs:
        try:
            from pypdf import PdfReader
        except ImportError:
            return None
        box = PdfReader(path).pages[0].mediabox
        return [float(box.left), float(box.bottom), float(box.right), float(box.top)]
    expression = (
        f'({path.as_posix()}) (r) file runpdfbegin '
        "1 pdfgetpage /MediaBox get == quit"
    )
    completed = subprocess.run(
        [
            gs,
            "-q",
            "-dNOSAFER",
            "-dNODISPLAY",
            "-dBATCH",
            "-c",
            expression,
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or "Ghostscript PDF read failed")
    values = completed.stdout.strip().strip("[]").split()
    if len(values) != 4:
        raise ValueError(f"unexpected MediaBox: {completed.stdout.strip()}")
    return [float(value) for value in values]


def pdf_text(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise RuntimeError("pypdf is required for PDF text audit") from exc
    return "\n".join(page.extract_text() or "" for page in PdfReader(path).pages)


def _check_plot_title(
    figure: dict, root: Path, report_path: Path, issues: list[str], metrics: dict
) -> None:
    """Judge the in-figure title from source/report, never PDF metadata or text."""
    report_value = None
    if report_path.is_file():
        for line in report_path.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("plot_title="):
                report_value = line.split("=", 1)[1].strip().lower()
                break
    else:
        issues.append(f"figure report missing: {report_path.name}")
        metrics["plot_title_status"] = "FAIL"
        return

    source_name = str(figure.get("source_path") or figure.get("filename") or "")
    source_path = root / source_name if source_name else None
    title_texts: list[str] = []
    if source_path and source_path.is_file():
        text = source_path.read_text(encoding="utf-8", errors="ignore")
        for match in re.finditer(r"set_title\s*\(\s*(?P<value>['\"])(?P<text>.*?)\1", text):
            if match.group("text").strip():
                title_texts.append(match.group("text"))
        for match in re.finditer(
            r"labs\s*\(\s*[^)]*?title\s*=\s*(?P<value>['\"])(?P<text>.*?)\1",
            text,
            flags=re.S,
        ):
            if match.group("text").strip():
                title_texts.append(match.group("text"))
        for match in re.finditer(r"ggtitle\s*\(\s*['\"](?P<text>.*?)['\"]", text, flags=re.S):
            if match.group("text").strip():
                title_texts.append(match.group("text"))
        for match in re.finditer(
            r"plot\.title\s*=\s*ggplot2::element_text\s*\(\s*title\s*=\s*"
            r"(?P<value>['\"])(?P<text>.*?)\1",
            text,
        ):
            if match.group("text").strip():
                title_texts.append(match.group("text"))
        metrics["source_plot_title_nonempty"] = bool(title_texts)

    if title_texts or report_value != "empty":
        issues.append("in-figure plot.title is non-empty")
        metrics["plot_title_status"] = "FAIL"
        return
    metrics["plot_title_status"] = "PASS"


def audit_one(root: Path, figure: dict) -> dict:
    def resolve_declared(field: str, fallback: Path) -> Path:
        value = str(figure.get(field) or "")
        if not value:
            return fallback
        candidate = (root / value).resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            return root / Path(value).name
        return candidate

    output = str(figure.get("output_png") or figure.get("canonical_output") or "")
    png = resolve_declared("output_png", root / str(figure.get("canonical_output") or ""))
    stem = png.with_suffix("")
    pdf = resolve_declared("output_pdf", stem.with_suffix(".pdf"))
    object_path = resolve_declared(
        "output_object",
        Path(f"{stem}_plot.{figure.get('object_kind') or 'rds'}"),
    )
    report_path = resolve_declared(
        "output_report", Path(f"{stem}_report.txt")
    )
    expected_width = float(figure["width_mm"])
    expected_height = float(figure["height_mm"])
    issues: list[str] = []
    warnings: list[str] = []
    unavailable: list[str] = []
    metrics: dict = {}

    for label, path in (("PNG", png), ("PDF", pdf), ("object", object_path)):
        if not path.is_file():
            issues.append(f"{label} missing: {path.name}")
        elif path.stat().st_size == 0:
            issues.append(f"{label} empty: {path.name}")
        elif path.stat().st_size > MAX_FILE_BYTES:
            issues.append(f"{label} exceeds 10 MB: {path.stat().st_size} bytes")

    if png.is_file():
        try:
            header = read_png_header(png)
            metrics.update(header)
            dpi = float(header["dpi"])
            if dpi < MIN_DPI:
                issues.append(f"PNG DPI {dpi:.1f} below {MIN_DPI:.0f}")
            if dpi > 0:
                width_mm = header["width_px"] / dpi * 25.4
                height_mm = header["height_px"] / dpi * 25.4
                metrics["width_mm"] = round(width_mm, 3)
                metrics["height_mm"] = round(height_mm, 3)
                if abs(width_mm - expected_width) > SIZE_TOLERANCE_MM:
                    issues.append(
                        f"PNG width {width_mm:.2f} mm != {expected_width:.2f} mm"
                    )
                if abs(height_mm - expected_height) > SIZE_TOLERANCE_MM:
                    issues.append(
                        f"PNG height {height_mm:.2f} mm != {expected_height:.2f} mm"
                    )
            layout = image_metrics(png)
            metrics.update(layout)
            if min(layout["margins_px"].values()) < MIN_EDGE_MARGIN_PX:
                issues.append(f"visible ink touches canvas edge: {layout['margins_px']}")
            if layout["content_width_ratio"] < MIN_CONTENT_WIDTH_RATIO:
                issues.append(
                    "plot content occupies too little width "
                    f"({layout['content_width_ratio']:.3f})"
                )
            if layout["content_height_ratio"] < MIN_CONTENT_HEIGHT_RATIO:
                issues.append(
                    "plot content occupies too little height "
                    f"({layout['content_height_ratio']:.3f})"
                )
        except Exception as exc:
            issues.append(f"PNG audit failed: {exc}")

    if pdf.is_file():
        try:
            media_box = pdf_media_box(pdf)
            if media_box is not None:
                width_mm = (media_box[2] - media_box[0]) / 72 * 25.4
                height_mm = (media_box[3] - media_box[1]) / 72 * 25.4
                metrics["pdf_media_box_pt"] = media_box
                metrics["pdf_width_mm"] = round(width_mm, 3)
                metrics["pdf_height_mm"] = round(height_mm, 3)
                if abs(width_mm - expected_width) > SIZE_TOLERANCE_MM:
                    issues.append(
                        f"PDF width {width_mm:.2f} mm != {expected_width:.2f} mm"
                    )
                if abs(height_mm - expected_height) > SIZE_TOLERANCE_MM:
                    issues.append(
                        f"PDF height {height_mm:.2f} mm != {expected_height:.2f} mm"
                    )
            if media_box is None:
                warnings.append("Ghostscript unavailable; PDF page size not checked")
        except Exception as exc:
            issues.append(f"PDF audit failed: {exc}")

    font_report = audit_pdf(pdf)
    metrics["pdf_font_status"] = font_report["status"]
    metrics["pdf_fonts"] = font_report["fonts"]
    metrics["pdf_metadata_title_empty"] = font_report["metadata_title_empty"]
    if font_report["status"] == "FAIL":
        issues.append(f"PDF font embedding failed: {font_report['detail']}")
    elif font_report["status"] == "UNAVAILABLE":
        unavailable.append("PDF font embedding check unavailable")
    if font_report["metadata_title_empty"] is False:
        issues.append("PDF metadata title is non-empty")
    _check_plot_title(figure, root, report_path, issues, metrics)

    visual = audit_visual(png, entry_name=png.name)
    metrics["visual_status"] = visual["status"]
    issues.extend(f"rendered visual: {item}" for item in visual["issues"])

    return {
        "template_id": figure.get("template_id"),
        "canonical_output": str(figure.get("canonical_output") or ""),
        "output_png": str(png.relative_to(root)),
        "status": "FAIL" if issues else ("UNAVAILABLE" if unavailable else "PASS"),
        "issues": issues,
        "warnings": warnings,
        "unavailable": unavailable,
        "metrics": metrics,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-dir", required=True)
    parser.add_argument(
        "--manifest",
        default="",
        help="manifest path; defaults to <contract-dir>/manifest.json",
    )
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    root = Path(args.contract_dir).resolve()
    manifest_path = Path(args.manifest).resolve() if args.manifest else root / "manifest.json"
    if not root.is_dir():
        print(f"ERR_DIR_NOT_FOUND: {root}", file=sys.stderr)
        return 2
    if not manifest_path.is_file():
        print(f"ERR_MANIFEST_NOT_FOUND: {manifest_path}", file=sys.stderr)
        return 2

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    figures = manifest.get("figures")
    if not isinstance(figures, list) or not figures:
        print("ERR_MANIFEST_EMPTY", file=sys.stderr)
        return 2

    results = [audit_one(root, figure) for figure in figures]
    fail = sum(result["status"] != "PASS" for result in results)
    unavailable = sum(result["status"] == "UNAVAILABLE" for result in results)
    payload = {
        "contract_dir": str(root),
        "manifest": str(manifest_path),
        "pass": len(results) - fail,
        "fail": fail,
        "unavailable": unavailable,
        "figures": results,
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(f"AUDIT_CONTRACT_DIR: {root}")
        for result in results:
            print(f"[{result['status']}] {result['template_id']} {result['canonical_output']}")
            for issue in result["issues"]:
                print(f"  - {issue}")
            for warning in result["warnings"]:
                print(f"  WARN: {warning}")
        print(f"SUMMARY: pass={payload['pass']} fail={payload['fail']} "
              f"unavailable={payload['unavailable']}")
    return 1 if fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
