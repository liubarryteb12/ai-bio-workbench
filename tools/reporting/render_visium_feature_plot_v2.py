#!/usr/bin/env python3
"""Render Visium spatial gene expression on each section's own H&E image.

This is the reusable version of the stroke-figure style. It reproduces the
"target D" look: the section's real histology as the bottom layer, spots on
native Space Ranger pixels, a cold-to-warm ramp, and a visible base layer for
in-tissue spots whose count is zero.

Section list
  Read from a JSON config rather than hard-coded GSM ids, so the same script
  serves every Visium project:
    {"sections": [
      {"sample_id": "D1-D3", "label": "D3", "gsm": "GSM7437223",
       "json": "GSM7437223_V10M09-040-D1.json.gz"}
    ]}

Coordinates
  The spot table must carry (array_row, array_col). Pixel coordinates come
  from the sample JSON oligo geometry (imageX, imageY) joined on that pair,
  then scaled by tissue_lowres_scalef. A shared slide layout is never used as
  the pixel source, because it places spots on a reference slide.

Zero-count handling
  Spots inside the tissue with a zero value are drawn as a light base layer,
  then positive spots are overlaid with the colormap. The data is not changed;
  --zero-color none restores the plain single-layer render.
"""

from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from PIL import Image


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--master", required=True, type=Path)
    parser.add_argument("--spatial-dir", required=True, type=Path)
    parser.add_argument("--samples", required=True, type=Path, help="section config JSON")
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument(
        "--layout",
        type=Path,
        default=Path("references/07.Visium_v1_载玻片布局/visium_v1_tissue_positions.csv"),
        help="Visium v1 layout used only to map barcode to (array_row, array_col)",
    )
    parser.add_argument("--genes", default="", help="comma-separated genes; empty means all expr_ columns")
    parser.add_argument("--cmap", default="Spectral_r")
    parser.add_argument("--alpha", type=float, default=0.75)
    parser.add_argument("--spot-size", type=float, default=8.0)
    parser.add_argument("--zero-color", default="#D9D9D9")
    parser.add_argument("--zero-alpha", type=float, default=0.55)
    parser.add_argument("--vmax-quantile", type=float, default=0.99)
    parser.add_argument("--panel", action="store_true", help="also render a one-row multi-section panel per gene")
    parser.add_argument("--single", action="store_true", help="also render one PNG per section and gene")
    parser.add_argument("--smoothed-master", type=Path, help="optional smoothed spot master for display-only figures")
    parser.add_argument("--smoothed-out", type=Path, help="output directory for smoothed figures")
    return parser.parse_args()


def load_sections(path):
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    sections = payload["sections"] if isinstance(payload, dict) else payload
    for entry in sections:
        for key in ("sample_id", "label", "gsm", "json"):
            if key not in entry:
                raise SystemExit("section entry missing %s: %s" % (key, entry))
    return sections


def load_master(path, layout_path):
    master = pd.read_csv(path, sep="\t")
    if "barcode" not in master.columns:
        master["barcode"] = master["spot"].str.split("_", n=1).str[1]
    if {"array_row", "array_col"}.issubset(master.columns):
        return master
    layout = pd.read_csv(
        layout_path,
        comment="#",
        header=None,
        names=["barcode", "in_tissue", "array_row", "array_col", "pxl_row", "pxl_col"],
    )
    frame = master.merge(
        layout[["barcode", "array_row", "array_col"]], on="barcode", how="left"
    )
    missing = int(frame["array_row"].isna().sum())
    if missing:
        raise SystemExit("%d spots have no (array_row, array_col) mapping" % missing)
    return frame


def section_coordinates(spatial_dir, section, frame):
    json_path = spatial_dir / "shared_raw" / section["json"]
    opener = gzip.open if json_path.suffix == ".gz" else open
    with opener(json_path, "rt", encoding="utf-8") as handle:
        payload = json.load(handle)
    scale = json.loads(
        (spatial_dir / ("%s_scalefactors_json.json" % section["gsm"])).read_text(encoding="utf-8")
    )["tissue_lowres_scalef"]
    geometry = pd.DataFrame(
        [
            {
                "array_row": spot["row"],
                "array_col": spot["col"],
                "pxl_row": spot["imageY"] * scale,
                "pxl_col": spot["imageX"] * scale,
            }
            for spot in payload["oligo"]
        ]
    )
    block = frame[frame["sample_id"] == section["sample_id"]]
    merged = block.merge(geometry, on=["array_row", "array_col"], how="inner")
    if merged.empty:
        raise SystemExit("no spots matched for section %s" % section["label"])
    return merged, spatial_dir / ("%s_tissue_lowres_image.png" % section["gsm"])


def draw_spots(ax, merged, gene_col, vmax, cmap, spot_size, alpha, zero_color, zero_alpha, size_factor):
    x = merged["pxl_col"].to_numpy()
    y = merged["pxl_row"].to_numpy()
    values = pd.to_numeric(merged[gene_col], errors="coerce").fillna(0.0).to_numpy()
    scatter = None
    if zero_color.lower() != "none" and (values <= 0).any():
        zero = values <= 0
        ax.scatter(
            x[zero], y[zero], s=spot_size * size_factor * 1.05, c=zero_color,
            alpha=zero_alpha, linewidths=0.2, edgecolors="#9A9A9A", zorder=2,
        )
        positive = ~zero
        if positive.any():
            scatter = ax.scatter(
                x[positive], y[positive], c=values[positive], cmap=cmap, vmin=0, vmax=vmax,
                s=spot_size * size_factor, alpha=alpha, linewidths=0, zorder=3,
            )
    else:
        scatter = ax.scatter(
            x, y, c=values, cmap=cmap, vmin=0, vmax=vmax, s=spot_size * size_factor,
            alpha=alpha, linewidths=0, zorder=2,
        )
    return scatter


def style_axes(ax, title):
    ax.set_title(title, fontsize=12, fontweight="bold", pad=8)
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)


def render_single(frame, sections, spatial_dir, genes, out_dir, cmap, alpha, spot_size,
                  zero_color, zero_alpha, vmax_map, suffix=""):
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = []
    for gene in genes:
        column = "expr_%s" % gene
        vmax = vmax_map[gene]
        for section in sections:
            merged, image_path = section_coordinates(spatial_dir, section, frame)
            fig, ax = plt.subplots(figsize=(5.6, 5.4), dpi=300)
            ax.imshow(Image.open(image_path))
            scatter = draw_spots(
                ax, merged, column, vmax, cmap, spot_size, alpha,
                zero_color, zero_alpha, 1.3,
            )
            style_axes(ax, "%s - %s" % (section["label"], gene))
            if scatter is not None:
                colorbar = fig.colorbar(scatter, ax=ax, fraction=0.045, pad=0.03, shrink=0.7)
                colorbar.set_label("Expression", fontsize=9)
                colorbar.ax.tick_params(labelsize=8)
            if zero_color.lower() != "none":
                ax.text(0.5, -0.035, "gray spots: in-tissue, zero UMI count",
                        transform=ax.transAxes, ha="center", va="top",
                        fontsize=7, color="#666666")
            name = "slice_%s_%s%s_styleD.png" % (section["label"], gene, suffix)
            fig.savefig(out_dir / name, bbox_inches="tight", dpi=300)
            plt.close(fig)
            manifest.append(
                {
                    "gene": gene,
                    "section": section["label"],
                    "file": name,
                    "spots": int(len(merged)),
                    "vmax": round(vmax, 4),
                    "smoothed": bool(suffix),
                }
            )
            print("[OK] %s" % (out_dir / name))
    return manifest


def render_panel(frame, sections, spatial_dir, genes, out_dir, cmap, alpha, spot_size,
                 zero_color, zero_alpha, vmax_map):
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = []
    for gene in genes:
        column = "expr_%s" % gene
        vmax = vmax_map[gene]
        fig, axes = plt.subplots(1, len(sections), figsize=(4.4 * len(sections), 4.8), dpi=300)
        if len(sections) == 1:
            axes = [axes]
        for ax, section in zip(axes, sections):
            merged, image_path = section_coordinates(spatial_dir, section, frame)
            ax.imshow(Image.open(image_path))
            scatter = draw_spots(
                ax, merged, column, vmax, cmap, spot_size, alpha,
                zero_color, zero_alpha, 1.0,
            )
            style_axes(ax, "%s - %s" % (section["label"], gene))
            if scatter is not None:
                colorbar = fig.colorbar(scatter, ax=ax, fraction=0.045, pad=0.02, shrink=0.65)
                colorbar.set_label("Expression", fontsize=8)
                colorbar.ax.tick_params(labelsize=7)
        plt.subplots_adjust(wspace=0.15)
        if zero_color.lower() != "none":
            fig.text(0.5, -0.01, "gray spots: in-tissue, zero UMI count",
                     ha="center", va="top", fontsize=7, color="#666666")
        name = "spatial_panel_%dsections_%s_styleD.png" % (len(sections), gene)
        fig.savefig(out_dir / name, bbox_inches="tight", dpi=300)
        plt.close(fig)
        manifest.append({"gene": gene, "section": "panel", "file": name, "vmax": round(vmax, 4)})
        print("[OK] %s" % (out_dir / name))
    return manifest


def compute_vmax(frame, genes, quantile):
    vmax_map = {}
    for gene in genes:
        column = "expr_%s" % gene
        if column not in frame.columns:
            raise SystemExit("gene column missing: %s" % column)
        values = pd.to_numeric(frame[column], errors="coerce").fillna(0.0)
        vmax = float(np.percentile(values, 100.0 * quantile))
        vmax_map[gene] = vmax if vmax > 0 else max(float(values.max()), 1.0)
    return vmax_map


def main():
    args = parse_args()
    sections = load_sections(args.samples)
    frame = load_master(args.master, args.layout)
    genes = [gene.strip() for gene in args.genes.split(",") if gene.strip()]
    if not genes:
        genes = sorted(
            column[len("expr_"):] for column in frame.columns if column.startswith("expr_")
        )
    vmax_map = compute_vmax(frame, genes, args.vmax_quantile)
    print("sections=%d genes=%d" % (len(sections), len(genes)))
    print("vmax", {gene: round(value, 3) for gene, value in vmax_map.items()})

    manifest = []
    if args.panel:
        manifest.extend(
            render_panel(frame, sections, args.spatial_dir, genes, args.out_dir,
                         args.cmap, args.alpha, args.spot_size, args.zero_color,
                         args.zero_alpha, vmax_map)
        )
    if args.single:
        manifest.extend(
            render_single(frame, sections, args.spatial_dir, genes, args.out_dir,
                          args.cmap, args.alpha, args.spot_size, args.zero_color,
                          args.zero_alpha, vmax_map)
        )
    if args.smoothed_master and args.smoothed_out:
        smoothed = load_master(args.smoothed_master, args.layout)
        smoothed_vmax = compute_vmax(smoothed, genes, args.vmax_quantile)
        manifest.extend(
            render_single(smoothed, sections, args.spatial_dir, genes, args.smoothed_out,
                          args.cmap, args.alpha, args.spot_size, "none", 0.0,
                          smoothed_vmax, suffix="_smoothed")
        )
    if manifest:
        pd.DataFrame(manifest).to_csv(args.out_dir / "figure_manifest.tsv", sep="\t", index=False)
        print("manifest rows=%d" % len(manifest))


if __name__ == "__main__":
    main()
