#!/usr/bin/env python3
"""Render single-section spatial preview figures from a spot master table.

Inputs
  --master  spot-level TSV with columns: spot, sample_id, domain, umap_1,
            umap_2, expr_<gene>...
  --layout  Visium v1 global layout CSV:
            barcode,in_tissue,array_row,array_col,pxl_row,pxl_col

Outputs
  Per section: spatial-domain slice, global-cluster slice, and one
  spatial-expression slice per requested gene. Plus UMAP by section and
  UMAP by global cluster.

This is a draft/preview renderer, not a production pipeline step. It writes
single-panel PNGs only, so the output can be reviewed without assembling a
multi-panel figure.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib
from matplotlib.cm import ScalarMappable
from matplotlib.colors import LinearSegmentedColormap, Normalize

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import ndimage
from matplotlib.lines import Line2D
from scipy.cluster.vq import kmeans2


SAMPLE_LABELS = {
    "C1-control": "sham",
    "B1-D1": "D1",
    "D1-D3": "D3",
    "C1-D7": "D7",
    "D1-D7": "D7b",
}
SAMPLE_ORDER = ["C1-control", "B1-D1", "D1-D3", "C1-D7", "D1-D7"]


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--master", required=True, type=Path)
    parser.add_argument("--layout", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--genes", default="Abca1,Egr1,Tjp1")
    parser.add_argument("--clusters", type=int, default=24)
    parser.add_argument("--seed", type=int, default=20261112)
    parser.add_argument(
        "--cmap",
        default="white_purple",
        help=(
            "continuous colormap for expression plots; white_purple mimics "
            "the Seurat white-to-deep-purple target style"
        ),
    )
    parser.add_argument(
        "--pt-size",
        type=float,
        default=6.5,
        help="expression-plot spot area in points squared; smaller spots read as a tissue texture",
    )
    parser.add_argument(
        "--low-alpha",
        type=float,
        default=0.05,
        help="alpha for zero-expression spots; keep some body so edges stay clean",
    )
    parser.add_argument(
        "--high-alpha",
        type=float,
        default=1.0,
        help="alpha for top-expression spots",
    )
    parser.add_argument(
        "--vmax-quantile",
        type=float,
        default=0.99,
        help="global vmax quantile per gene, shared by all five sections",
    )
    parser.add_argument(
        "--vmin",
        type=float,
        default=0.0,
        help="fixed lower color limit, equivalent to Seurat min.cutoff",
    )
    parser.add_argument(
        "--vmax-map",
        default="",
        help=(
            "optional per-gene fixed upper limits, e.g. Egr1=2.1,Abca1=1.7; "
            "genes absent here fall back to the global quantile"
        ),
    )
    parser.add_argument(
        "--stroke",
        type=float,
        default=0.0,
        help="thin gray spot outline width; 0 disables the outline",
    )
    parser.add_argument(
        "--background",
        choices=["none", "silhouette"],
        default="silhouette",
        help="faint tissue layer behind expression spots; silhouette stands in for the H&E image",
    )
    parser.add_argument(
        "--gene-scalebar",
        choices=["off", "small"],
        default="off",
        help="scale bar for single-gene expression plots",
    )
    parser.add_argument(
        "--section-scalebar",
        choices=["off", "small"],
        default="small",
        help="scale bar for domain and cluster plots",
    )
    return parser.parse_args()


def configure_style():
    plt.rcParams.update(
        {
            "figure.dpi": 300,
            "savefig.dpi": 300,
            "font.family": "sans-serif",
            "font.sans-serif": [
                "Arial",
                "Helvetica",
                "Liberation Sans",
                "DejaVu Sans",
            ],
            "font.size": 8,
            "axes.titlesize": 10,
            "axes.labelsize": 8,
            "xtick.labelsize": 8,
            "ytick.labelsize": 8,
            "legend.fontsize": 8,
            "legend.title_fontsize": 8,
            "axes.grid": False,
            "figure.autolayout": False,
            "savefig.bbox": "tight",
            "image.cmap": "viridis",
        }
    )


def caption(fig, *parts):
    text = "\n".join(str(part) for part in parts if part not in (None, ""))
    if text:
        fig.text(0.01, -0.02, text, ha="left", va="top", fontsize=8, linespacing=1.5)


def panel_header(ax, title, size=11):
    ax.text(
        0.5,
        1.015,
        title,
        transform=ax.transAxes,
        ha="center",
        va="bottom",
        fontsize=size,
        fontweight="bold",
    )


def scalebar(ax, x, y, length, label="500 um", small=False):
    line_width = 1.1 if small else 2.2
    tick_width = 0.7 if small else 1.2
    font_size = 6 if small else 8
    tick_height = 0.45 if small else 0.8
    ax.plot(
        [x, x + length],
        [y, y],
        color="black",
        lw=line_width,
        solid_capstyle="butt",
    )
    ax.plot([x, x], [y - tick_height, y + tick_height], color="black", lw=tick_width)
    ax.plot(
        [x + length, x + length],
        [y - tick_height, y + tick_height],
        color="black",
        lw=tick_width,
    )
    ax.text(
        x + length / 2,
        y + (0.8 if small else 1.4),
        label,
        ha="center",
        va="bottom",
        fontsize=font_size,
    )


def clean_axes(ax):
    ax.set_aspect("equal")
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)


def finish_spatial(ax, sub, scalebar_mode="small"):
    xmin, xmax = sub["array_col"].min(), sub["array_col"].max()
    ymin, ymax = -sub["array_row"].max(), -sub["array_row"].min()
    ax.set_xlim(xmin - 2, xmax + 2)
    ax.set_ylim(ymin - 2, ymax + 2)
    if scalebar_mode == "small":
        scalebar(ax, xmax - 18, ymin + 2, 10, small=True)


def load_master(master_path, layout_path):
    master = pd.read_csv(master_path, sep="\t")
    layout = pd.read_csv(
        layout_path,
        comment="#",
        header=None,
        names=[
            "barcode",
            "in_tissue",
            "array_row",
            "array_col",
            "pxl_row",
            "pxl_col",
        ],
    )
    master["barcode"] = master["spot"].str.split("_", n=1).str[1]
    df = master.merge(layout, on="barcode", how="left", validate="many_to_one")
    missing = int(df["array_row"].isna().sum())
    if missing:
        raise SystemExit("missing spatial coordinates for %d spots" % missing)
    df["sample_label"] = df["sample_id"].map(SAMPLE_LABELS)
    if df["sample_label"].isna().any():
        unknown = sorted(df.loc[df["sample_label"].isna(), "sample_id"].unique())
        raise SystemExit("unknown sample_id values: %s" % unknown)
    return df


def add_global_clusters(df, k, seed):
    xy = df[["umap_1", "umap_2"]].to_numpy(dtype=float)
    centroids, labels = kmeans2(xy, k, iter=50, minit="++", seed=seed)
    sizes = np.bincount(labels, minlength=k)
    order = np.argsort(-sizes)
    remap = {int(old): int(new) for new, old in enumerate(order)}
    df["global_cluster"] = [str(remap[int(label)]) for label in labels]
    return df


def palette(n):
    base = [plt.get_cmap("tab20")(i) for i in range(min(n, 20))]
    if n > 20:
        base.extend(plt.get_cmap("tab20b")(np.linspace(0, 1, n - 20)))
    return base


def expression_cmap(name):
    if name == "grey_navy":
        return LinearSegmentedColormap.from_list(
            "grey_navy", ["lightgrey", "#7b93c8", "navy"]
        )
    if name == "white_purple":
        return LinearSegmentedColormap.from_list(
            "white_purple", ["#F2F2F4", "#C9C3D8", "#6A51A3", "#1F0B3B"]
        )
    if name == "white_red":
        return LinearSegmentedColormap.from_list(
            "white_red", ["#FFFFFF", "#F0F0F0", "#CB181D", "#67000D"]
        )
    if name == "white_navy":
        return LinearSegmentedColormap.from_list(
            "white_navy", ["#FFFFFF", "#D6DCEF", "#4A6FA5", "#000080"]
        )
    return plt.get_cmap(name)


def parse_vmax_map(spec):
    mapping = {}
    for item in str(spec or "").split(","):
        item = item.strip()
        if not item or "=" not in item:
            continue
        gene, value = item.split("=", 1)
        try:
            mapping[gene.strip()] = float(value)
        except ValueError:
            continue
    return mapping


def tissue_polygon(ax, sub):
    """Draw a light tissue footprint from spot occupancy.

    The surviving table has no H&E image, so the footprint is a smoothed
    occupancy mask on the Visium array grid. It preserves ventricles and edge
    notches, unlike a convex hull.
    """
    cols = np.sort(sub["array_col"].unique())
    rows = np.sort(sub["array_row"].unique())
    col_index = {value: index for index, value in enumerate(cols)}
    row_index = {value: index for index, value in enumerate(rows)}
    mask = np.zeros((len(rows), len(cols)), dtype=bool)
    for row, col in zip(sub["array_row"], sub["array_col"]):
        mask[row_index[row], col_index[col]] = True
    mask = ndimage.binary_closing(mask, iterations=2)
    mask = ndimage.binary_dilation(mask, iterations=1)
    mask = ndimage.binary_fill_holes(mask)
    smooth = ndimage.gaussian_filter(mask.astype(float), sigma=1.4)
    x_mesh, y_mesh = np.meshgrid(cols, -rows)
    ax.contourf(
        x_mesh,
        y_mesh,
        smooth,
        levels=[0.5, 1.1],
        colors=["#E6E2ED"],
        alpha=0.9,
        zorder=0,
    )
    ax.contour(
        x_mesh,
        y_mesh,
        smooth,
        levels=[0.5],
        colors=["#C9C3D8"],
        linewidths=0.5,
        zorder=0.5,
    )


def plot_domains(df, sample, out, scalebar_mode="small"):
    sub = df[df["sample_id"] == sample].copy()
    domains = sorted(sub["domain"].unique(), key=lambda value: int(value.rsplit("_d", 1)[1]))
    colors = palette(len(domains))
    color_map = {domain: colors[i] for i, domain in enumerate(domains)}

    fig, ax = plt.subplots(figsize=(5.2, 4.2))
    for domain in domains:
        part = sub[sub["domain"] == domain]
        ax.scatter(
            part["array_col"],
            -part["array_row"],
            s=12,
            c=[color_map[domain]],
            linewidths=0,
            alpha=0.95,
            rasterized=True,
        )
    clean_axes(ax)
    handles = [
        Line2D(
            [0],
            [0],
            marker="o",
            linestyle="",
            markersize=5,
            markerfacecolor=color_map[domain],
            markeredgewidth=0,
            label=domain.rsplit("_", 1)[1].lstrip("d"),
        )
        for domain in domains
    ]
    ax.legend(
        handles=handles,
        title="Spatial domain",
        loc="upper left",
        bbox_to_anchor=(1.02, 1.0),
        frameon=False,
        borderaxespad=0,
        ncol=1,
    )
    panel_header(ax, "%s - spatial domains" % SAMPLE_LABELS[sample])
    finish_spatial(ax, sub, scalebar_mode)
    caption(
        fig,
        "%s spatial domains, n=%d spots, %d domains"
        % (SAMPLE_LABELS[sample], len(sub), len(domains)),
    )
    fig.savefig(out, dpi=300, pad_inches=0.02)
    plt.close(fig)


def plot_clusters(df, sample, out, k, scalebar_mode="small"):
    sub = df[df["sample_id"] == sample].copy()
    clusters = sorted(df["global_cluster"].unique(), key=int)
    colors = palette(len(clusters))
    color_map = {cluster: colors[i] for i, cluster in enumerate(clusters)}

    fig, ax = plt.subplots(figsize=(5.8, 4.4))
    for cluster in clusters:
        part = sub[sub["global_cluster"] == cluster]
        if part.empty:
            continue
        ax.scatter(
            part["array_col"],
            -part["array_row"],
            s=12,
            c=[color_map[cluster]],
            linewidths=0,
            alpha=0.95,
            rasterized=True,
        )
    clean_axes(ax)
    handles = [
        Line2D(
            [0],
            [0],
            marker="o",
            linestyle="",
            markersize=5,
            markerfacecolor=color_map[cluster],
            markeredgewidth=0,
            label=cluster,
        )
        for cluster in clusters
    ]
    ax.legend(
        handles=handles,
        title="Cluster",
        loc="upper left",
        bbox_to_anchor=(1.02, 1.0),
        frameon=False,
        borderaxespad=0,
        ncol=2,
        fontsize=7,
        columnspacing=0.8,
        handletextpad=0.4,
    )
    panel_header(ax, "%s - clusters" % SAMPLE_LABELS[sample])
    finish_spatial(ax, sub, scalebar_mode)
    caption(
        fig,
        "%s global clusters, KMeans k=%d, n=%d spots"
        % (SAMPLE_LABELS[sample], k, len(sub)),
    )
    fig.savefig(out, dpi=300, pad_inches=0.02)
    plt.close(fig)


def plot_genes(df, genes, out_dir, cmap_name, pt_size, low_alpha, high_alpha,
               vmax_quantile, stroke_width, background, scalebar_mode,
               vmin, vmax_map):
    manifest = []
    cmap = expression_cmap(cmap_name)
    for gene in genes:
        column = "expr_%s" % gene
        if column not in df.columns:
            manifest.append({"gene": gene, "status": "missing_column"})
            continue
        values = pd.to_numeric(df[column], errors="coerce").fillna(0.0)
        fixed_vmax = vmax_map.get(gene)
        vmax = float(fixed_vmax) if fixed_vmax is not None else float(
            np.percentile(values, 100.0 * vmax_quantile)
        )
        if not np.isfinite(vmax) or vmax <= 0:
            vmax = float(values.max()) if values.max() > 0 else 1.0
        for sample in SAMPLE_ORDER:
            sub = df[df["sample_id"] == sample].copy()
            sample_values = pd.to_numeric(sub[column], errors="coerce").fillna(0.0)
            vmax_quantile_high = vmax
            # Scale low-expression spots down visually without hiding them.
            # The ramp maps 0 -> low_alpha and vmax -> high_alpha.
            relative = np.clip(
                (sample_values - vmin) / max(vmax_quantile_high - vmin, 1e-9),
                0.0,
                1.0,
            )
            alphas = low_alpha + (high_alpha - low_alpha) * relative
            rgba = cmap(relative.to_numpy())
            rgba[:, 3] = alphas.to_numpy()
            fig, ax = plt.subplots(figsize=(4.5, 3.2))
            if background == "silhouette":
                tissue_polygon(ax, sub)
            ax.scatter(
                sub["array_col"],
                -sub["array_row"],
                s=pt_size,
                c=rgba,
                linewidths=stroke_width,
                edgecolors="gray" if stroke_width > 0 else "none",
                zorder=2,
                rasterized=True,
            )
            color_source = ScalarMappable(
                norm=Normalize(vmin=vmin, vmax=vmax_quantile_high), cmap=cmap
            )
            color_source.set_array([])
            colorbar = fig.colorbar(
                color_source,
                ax=ax,
                fraction=0.020,
                pad=0.010,
                shrink=0.55,
                aspect=26,
            )
            colorbar.ax.tick_params(labelsize=8)
            clean_axes(ax)
            panel_header(ax, "%s - %s" % (SAMPLE_LABELS[sample], gene), size=14)
            finish_spatial(ax, sub, scalebar_mode)
            name = "slice_%s_%s.png" % (gene, SAMPLE_LABELS[sample])
            fig.savefig(out_dir / name, dpi=300, pad_inches=0.02)
            plt.close(fig)
            manifest.append(
                {
                    "gene": gene,
                    "sample": SAMPLE_LABELS[sample],
                    "file": name,
                    "spots": len(sub),
                    "vmin": vmin,
                    "vmax": vmax,
                    "cmap": cmap_name,
                    "pt_size": pt_size,
                    "low_alpha": low_alpha,
                    "high_alpha": high_alpha,
                    "status": "ok",
                }
            )
    return manifest


def plot_umap_section(df, out):
    fig, ax = plt.subplots(figsize=(5.2, 5.2))
    colors = plt.get_cmap("tab10")
    for index, sample in enumerate(SAMPLE_ORDER):
        sub = df[df["sample_id"] == sample]
        ax.scatter(
            sub["umap_1"],
            sub["umap_2"],
            s=4,
            c=[colors(index)],
            linewidths=0,
            alpha=0.8,
            label=SAMPLE_LABELS[sample],
            rasterized=True,
        )
    ax.set_xlabel("umap_1")
    ax.set_ylabel("umap_2")
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.legend(
        title="Section",
        loc="upper left",
        bbox_to_anchor=(1.02, 1.0),
        frameon=False,
        borderaxespad=0,
    )
    caption(
        fig,
        "line3 spatial: UMAP by section",
        "five GSE233814 sections in one embedding; n=%d spots" % len(df),
        "embedding is shared across sections for visual comparison",
    )
    fig.savefig(out, dpi=300)
    plt.close(fig)


def plot_umap_cluster(df, out, k):
    clusters = sorted(df["global_cluster"].unique(), key=int)
    colors = palette(len(clusters))
    color_map = {cluster: colors[i] for i, cluster in enumerate(clusters)}

    fig, ax = plt.subplots(figsize=(5.6, 5.6))
    for cluster in clusters:
        sub = df[df["global_cluster"] == cluster]
        ax.scatter(
            sub["umap_1"],
            sub["umap_2"],
            s=4,
            c=[color_map[cluster]],
            linewidths=0,
            alpha=0.85,
            rasterized=True,
        )
        center_x = sub["umap_1"].median()
        center_y = sub["umap_2"].median()
        ax.text(
            center_x,
            center_y,
            cluster,
            ha="center",
            va="center",
            fontsize=7,
            bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.7),
        )
    ax.set_xlabel("umap_1")
    ax.set_ylabel("umap_2")
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)
    handles = [
        Line2D(
            [0],
            [0],
            marker="o",
            linestyle="",
            markersize=5,
            markerfacecolor=color_map[cluster],
            markeredgewidth=0,
            label=cluster,
        )
        for cluster in clusters
    ]
    ax.legend(
        handles=handles,
        title="Cluster",
        loc="upper left",
        bbox_to_anchor=(1.02, 1.0),
        frameon=False,
        borderaxespad=0,
        ncol=2,
        fontsize=7,
    )
    caption(
        fig,
        "line3 spatial: UMAP by global cluster",
        "KMeans k=%d on the shared UMAP embedding; n=%d spots" % (k, len(df)),
        "cluster labels are display groupings, not a separate biological annotation",
    )
    fig.savefig(out, dpi=300)
    plt.close(fig)


def main():
    args = parse_args()
    configure_style()
    args.out.mkdir(parents=True, exist_ok=True)
    genes = [gene.strip() for gene in args.genes.split(",") if gene.strip()]

    df = load_master(args.master, args.layout)
    df = add_global_clusters(df, args.clusters, args.seed)

    for sample in SAMPLE_ORDER:
        label = SAMPLE_LABELS[sample]
        plot_domains(
            df,
            sample,
            args.out / ("slice_domains_%s.png" % label),
            args.section_scalebar,
        )
        plot_clusters(
            df,
            sample,
            args.out / ("slice_clusters_%s.png" % label),
            args.clusters,
            args.section_scalebar,
        )

    plot_umap_section(df, args.out / "umap_by_section.png")
    plot_umap_cluster(df, args.out / "umap_by_cluster.png", args.clusters)

    sample_spots = df.groupby("sample_id").size().to_dict()
    manifest = []
    for sample in SAMPLE_ORDER:
        label = SAMPLE_LABELS[sample]
        manifest.append(
            {
                "gene": "",
                "sample": label,
                "file": "slice_domains_%s.png" % label,
                "status": "ok",
                "spots": sample_spots[sample],
            }
        )
        manifest.append(
            {
                "gene": "",
                "sample": label,
                "file": "slice_clusters_%s.png" % label,
                "status": "ok",
                "spots": sample_spots[sample],
            }
        )
    manifest.extend(
        plot_genes(
            df,
            genes,
            args.out,
            args.cmap,
            args.pt_size,
            args.low_alpha,
            args.high_alpha,
            args.vmax_quantile,
            args.stroke,
            args.background,
            args.gene_scalebar,
            args.vmin,
            parse_vmax_map(args.vmax_map),
        )
    )
    manifest.extend(
        [
            {
                "gene": "",
                "sample": "",
                "file": "umap_by_section.png",
                "status": "ok",
                "spots": len(df),
            },
            {
                "gene": "",
                "sample": "",
                "file": "umap_by_cluster.png",
                "status": "ok",
                "spots": len(df),
            },
        ]
    )

    frame = pd.DataFrame(manifest)
    frame["spots"] = frame["spots"].astype("Int64")
    frame = frame.fillna("")
    frame.to_csv(args.out / "slice_preview_manifest.tsv", sep="\t", index=False)
    print("samples=%d spots=%d clusters=%d" % (df["sample_id"].nunique(), len(df), args.clusters))
    print("wrote %d png files to %s" % (len(list(args.out.glob("*.png"))), args.out))
    print(frame.to_string(index=False))


if __name__ == "__main__":
    main()
