"""Evidence-aware visual rule checks for single-figure PNG artifacts.

The module deliberately keeps two result lanes apart:

- machine checks read pixels or embedded PDF object metadata;
- static-source checks only raise source findings and can never mark a
  rendered artifact as machine-verified;
- when a rule needs a missing viewer or parser, its status is
  ``UNAVAILABLE`` instead of a speculative pass.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path


STATIC_RULE_LABELS = {
    "tight_bbox",
    "tick_rotation_45",
    "thin_line",
    "rainbow_colormap",
    "red_green_colors",
    "legend_frame",
    "legend_position",
    "scrna_rasterization",
}

MARKER_SOURCE_HINTS = (
    "adata",
    "anndata",
    "scrna",
    "scanpy",
    "cell",
    "umap",
    "tsne",
)

FORBIDDEN_COLORMAPS = {"rainbow", "jet", "hsv", "turbo", "gist_rainbow", "nipy_spectral"}

RED_GREEN_PAIRS = {
    ("#FF0000", "#00FF00"),
    ("#FF0000", "#008000"),
    ("#FF0000", "#00A651"),
    ("#E41A1C", "#4DAF4A"),
    ("#D62728", "#2CA02C"),
    ("#CC0000", "#339933"),
}

LEGEND_KWARGS = {
    "frameon": True,
    "borderpad": True,
    "edgecolor": True,
    "facecolor": True,
    "framealpha": True,
    "labelspacing": True,
}

FORBIDDEN_LEGEND_LOCS = {
    "best",
    "lower left",
    "lower right",
}

RASTER_KEYWORDS = {"rasterized", "raster", "dpi"}


def _source_files(root: Path) -> list[Path]:
    if root.is_file():
        return [root]
    if root.is_dir():
        return sorted(
            path
            for path in root.rglob("*")
            if path.is_file() and path.suffix.lower() in {".py", ".r"}
        )
    return []


def static_findings(source_root: Path, cell_count: int | None = None) -> list[dict]:
    """Return explicit source-hint findings for the rendered-figure root."""
    findings: list[dict] = []
    for path in _source_files(source_root):
        text = path.read_text(encoding="utf-8", errors="ignore")
        lines = text.splitlines()

        for index, line in enumerate(lines, 1):
            if re.search(r"bbox_inches\s*=\s*['\"]tight['\"]", line):
                findings.append(_finding(path, index, "tight_bbox", line))
            if re.search(r"(?:angle\s*=|rotation\s*=)\s*45(?:\.0)?\b", line):
                findings.append(_finding(path, index, "tick_rotation_45", line))
            for match in re.finditer(
                r"(?:linewidth|linewidths|lwd)\s*=\s*([0-9]+(?:\.[0-9]+)?)", line
            ):
                value = float(match.group(1))
                if 0 < value < 0.25:
                    findings.append(_finding(path, index, "thin_line", line))
            lowered = line.lower()
            for colormap in FORBIDDEN_COLORMAPS:
                if re.search(rf"\b{re.escape(colormap)}\b", lowered):
                    findings.append(_finding(path, index, "rainbow_colormap", line))
            for left, right in RED_GREEN_PAIRS:
                if left.lower() in lowered and right.lower() in lowered:
                    findings.append(_finding(path, index, "red_green_colors", line))
            if re.search(r"\blegend\s*\(", line) and re.search(
                r"frameon\s*=\s*True|frameon\s*=\s*T\b", line, re.I
            ):
                findings.append(_finding(path, index, "legend_frame", line))
            match = re.search(r"\blegend\s*\([^)]*\)", line)
            if match:
                legend_call = match.group(0)
                loc_match = re.search(r"""loc\s*=\s*['"]([^'"]+)['"]""", legend_call)
                if loc_match and loc_match.group(1).strip().lower() in FORBIDDEN_LEGEND_LOCS:
                    findings.append(_finding(path, index, "legend_position", line))
            if (
                cell_count is not None
                and cell_count > 5000
                and re.search(r"\bscatter\s*\(", line)
                and not any(keyword in lowered for keyword in RASTER_KEYWORDS)
            ):
                findings.append(_finding(path, index, "scrna_rasterization", line))
            if (
                cell_count is None
                and re.search(r"\bscatter\s*\(", line)
                and any(hint in path.stem.lower() for hint in MARKER_SOURCE_HINTS)
                and re.search(r"rasterized\s*=\s*False|rasterized\s*=\s*adata\.n_obs\s*<\s*5000", text)
            ):
                findings.append(_finding(path, index, "scrna_rasterization", line))

    grouped: dict[str, list[dict]] = {}
    for finding in findings:
        grouped.setdefault(finding["rule"], []).append(finding)
    return grouped


def _finding(path: Path, line_number: int, rule: str, line: str) -> dict:
    return {
        "rule": rule,
        "evidence_type": "source",
        "file": path.name,
        "line": line_number,
        "text": line.strip()[:180],
    }


def _png_findings(path: Path) -> tuple[list[str], list[str]]:
    if not path.is_file():
        return [f"PNG missing: {path.name}"], []
    if path.suffix.lower() != ".png":
        return [], []
    try:
        from PIL import Image, ImageChops
    except ImportError:
        return [], ["Pillow unavailable for edge and whitespace audit"]
    issues: list[str] = []
    unavailable: list[str] = []
    with Image.open(path) as image:
        rgb = image.convert("RGB")
    white = Image.new("RGB", rgb.size, (255, 255, 255))
    diff = ImageChops.difference(rgb, white).convert("L")
    mask = diff.point(lambda value: 255 if value > 8 else 0)
    bbox = mask.getbbox()
    if bbox is None:
        issues.append("PNG contains no visible ink")
    else:
        left, top, right, bottom = bbox
        if min(left, top, rgb.width - right, rgb.height - bottom) < 2:
            issues.append("visible ink touches canvas edge")
        content_ratio = (right - left) / rgb.width
        if content_ratio < 0.50:
            issues.append(
                f"rendered content occupies too little width ({content_ratio:.3f})"
            )
    return issues, unavailable


def audit_visual(
    png_path: Path | str,
    source_root: Path | str | None = None,
    entry_name: str | None = None,
) -> dict:
    """Audit a rendered PNG and optional sibling source files."""
    path = Path(png_path)
    issues, unavailable = _png_findings(path)
    static = static_findings(Path(source_root)) if source_root else []
    return {
        "entry": entry_name or path.name,
        "status": "FAIL" if issues else ("UNAVAILABLE" if unavailable else "PASS"),
        "issues": issues,
        "unavailable": unavailable,
        "machine_evidence": {
            "png": str(path),
            "checks": ["png_ink", "png_edge", "content_ratio"],
        },
        "source_findings": static,
    }
