"""SCI Single Plot Style Standard (reference/03出图规范 v3.0).

Pure single-plot styling and export module for Python matplotlib/scanpy pipelines.
Enforces exact millimetre canvas sizes, font hierarchies, line widths, and three-piece exports.
"""

from __future__ import annotations

import os
import pickle
from pathlib import Path
from typing import Any

import matplotlib
matplotlib.use("Agg", force=False)
import matplotlib.pyplot as plt

WIDTHS_MM: dict[str, float] = {
    "small": 58.0,
    "single": 88.0,
    "medium": 130.0,
    "wide": 180.0,
}

OKABE_ITO_PALETTE: tuple[str, ...] = (
    "#0072B2",  # blue
    "#D55E00",  # vermillion
    "#009E73",  # green
    "#E69F00",  # orange
    "#56B4E9",  # sky blue
    "#CC79A7",  # reddish purple
    "#F0E442",  # yellow
    "#999999",  # grey
)

DEG_SAFE_COLORS: dict[str, str] = {
    "Down": "#0072B2",
    "ns": "#BFBFBF",
    "Up": "#D55E00",
}


def activate_style() -> None:
    """Activate SCI single-plot typography, linewidth and canvas defaults."""
    plt.rcParams.update({
        "font.family": "sans-serif",
        "font.sans-serif": ["Arial", "Helvetica", "DejaVu Sans"],
        "font.size": 7.0,
        "axes.titlesize": 7.0,
        "axes.labelsize": 7.0,
        "xtick.labelsize": 6.5,
        "ytick.labelsize": 6.5,
        "legend.fontsize": 6.5,
        "legend.title_fontsize": 7.0,
        "axes.linewidth": 0.5,
        "lines.linewidth": 0.75,
        "xtick.major.width": 0.5,
        "ytick.major.width": 0.5,
        "xtick.major.size": 3.2,
        "ytick.major.size": 3.2,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.grid": False,
        "figure.autolayout": False,
        "figure.dpi": 300,
        "savefig.dpi": 300,
        "savefig.bbox": None,
        "image.cmap": "viridis",
        "pdf.fonttype": 42,
        "ps.fonttype": 42,
    })


def create_single_canvas(
    size_preset: str = "single",
    height_mm: float = 75.0,
) -> tuple[plt.Figure, plt.Axes]:
    """Generate a single-Axes canvas with exact millimetre physical dimensions."""
    activate_style()
    width_mm = WIDTHS_MM.get(size_preset, 88.0)
    w_in = width_mm / 25.4
    h_in = height_mm / 25.4
    fig, ax = plt.subplots(1, 1, figsize=(w_in, h_in))
    return fig, ax


def finish_axes(ax: plt.Axes) -> plt.Axes:
    """Clean axes boundaries: hide top/right spines, clear title, set tick font."""
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_linewidth(0.5)
    ax.spines["bottom"].set_linewidth(0.5)
    ax.tick_params(axis="both", which="major", width=0.5, length=3.2, labelsize=6.5)
    ax.set_title("")
    return ax


def export_single_fig(
    fig: plt.Figure,
    name: str,
    size_preset: str = "single",
    height_mm: float | None = None,
    out_dir: str | Path = "figures",
    version: str = "v01",
    dpi: int = 300,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Path]:
    """Export the SCI three-piece set: PDF (vector), PNG (300 DPI), and PKL (object)."""
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    # Force title blank per single-plot specification
    for ax in fig.axes:
        ax.set_title("")

    width_mm = WIDTHS_MM.get(size_preset, 88.0)
    if height_mm is not None:
        fig.set_size_inches(width_mm / 25.4, height_mm / 25.4)

    stem = f"{name}_{version}" if version else name
    pdf_path = out_path / f"{stem}.pdf"
    png_path = out_path / f"{stem}.png"
    pkl_path = out_path / f"{stem}_plot.pkl"
    report_path = out_path / f"{stem}_report.txt"

    # Export vector PDF with embedded TrueType fonts
    fig.savefig(pdf_path, dpi=600, bbox_inches=None)

    # Export PNG with exact 300 DPI without tight cropping
    fig.savefig(png_path, dpi=dpi, bbox_inches=None)

    # Export editable object
    try:
        with open(pkl_path, "wb") as handle:
            pickle.dump(fig, handle)
    except Exception:
        pass

    # Export audit metadata report
    meta = metadata or {}
    report_lines = [
        "step_executed=export_single_fig",
        f"artifact_name={name}",
        f"size_preset={size_preset}",
        f"width_mm={width_mm:.1f}",
        f"height_mm={fig.get_size_inches()[1] * 25.4:.1f}",
        f"dpi={dpi}",
        f"artifact_png={png_path.name}",
        f"artifact_pdf={pdf_path.name}",
        f"artifact_object={pkl_path.name}",
        f"seed={os.environ.get('BIOANALYS_SEED', '')}",
    ]
    for k, v in meta.items():
        report_lines.append(f"{k}={v}")
    report_path.write_text("\n".join(report_lines) + "\n", encoding="utf-8")

    return {
        "pdf": pdf_path,
        "png": png_path,
        "pkl": pkl_path,
        "report": report_path,
    }
