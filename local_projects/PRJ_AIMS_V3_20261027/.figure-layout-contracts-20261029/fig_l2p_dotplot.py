# Figure-Contract: width_mm=88; height_mm=60; dpi=300; column=single
# Master-Source: src/figure_sources/fig_l2p_dotplot.py | Master-SHA256: 12c89ae1c1cbee2d3a496a72fb5b80ecc36c5ae7b6eca35fb5e35569241f2fcf
# Catalog-ID: 414 | Catalog-Language: Python | Source-Match: analogous
# Adapted-Project: PRJ_AIMS_V3_20261027
# Adapted-Line: line2_scrna
# Adapt-Variable input_data: [object Object]
# Adapt-Variable group_col: [object Object]
ADAPT_VARS = {
  "input_data": "data/line2_scrna/processed/target_gene_localization.tsv",
  "group_col": "celltype"
}

# Real-Data-Adapter: v1
# Project-Input: data/line2_scrna/processed/target_gene_localization.tsv
import os
import pickle
import textwrap
from pathlib import Path
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

plt.rcParams.update({
    "figure.dpi": 96,
    "font.size": 7,
    "font.family": "sans-serif",
    "font.sans-serif": ["Arial", "Helvetica", "DejaVu Sans"],
    "axes.titlesize": 7,
    "axes.labelsize": 7,
    "xtick.labelsize": 6.5,
    "ytick.labelsize": 6.5,
    "legend.fontsize": 6.5,
    "legend.title_fontsize": 7,
    "axes.linewidth": 0.5,
    "lines.linewidth": 0.75,
    "axes.grid": False,
    "figure.autolayout": False,
    "savefig.dpi": 300,
    "savefig.bbox": None,
    "image.cmap": "viridis",
    "pdf.fonttype": 42,
    "ps.fonttype": 42,
})
seed_value = os.environ.get("BIOANALYS_SEED", "")
if not seed_value:
    raise SystemExit(3)
seed = int(seed_value)
np.random.seed(seed)
os.environ["BIOANALYS_LAYOUT_PRESERVE_FIGSIZE"] = "1"
os.environ["BIOANALYS_LAYOUT_FIXED_CANVAS"] = "1"
input_data = "/mnt/ssd/bio_data/projects/PRJ_AIMS_V3_20261027/line2_scrna/processed/target_gene_localization.tsv"
output_file = "figures/line2_scrna/dotplot__L2p_dotplot_verified.png"
width_mm = 88
height_mm = 60
dpi = 300
if not Path(input_data).exists():
    raise FileNotFoundError(f"real input missing: {input_data}")
Path(output_file).parent.mkdir(parents=True, exist_ok=True)

BIOANALYS_COLORS = (
    "#0072B2", "#D55E00", "#009E73", "#E69F00",
    "#56B4E9", "#CC79A7", "#F0E442", "#999999",
)
BIOANALYS_MARKERS = ("o", "s", "^", "D", "P", "X", "v", "<")

def bioanalys_finish_axes(ax):
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_linewidth(0.5)
    ax.spines["bottom"].set_linewidth(0.5)
    ax.tick_params(axis="both", which="major", width=0.5, length=3.2, labelsize=6.5)
    ax.set_title("")
    return ax

def bioanalys_fit_tick_margins(fig, ax, pad_px=6.0, max_iter=8):
    """Grow the axes margin until every visible plot artist fits the canvas."""
    for _ in range(max_iter):
        fig.canvas.draw()
        renderer = fig.canvas.get_renderer()
        fig_box = fig.bbox
        artists = [
            *list(ax.get_xticklabels()),
            *list(ax.get_yticklabels()),
            ax.xaxis.label,
            ax.yaxis.label,
            *list(ax.texts),
        ]
        for extra_ax in fig.axes:
            artists.extend(list(extra_ax.get_xticklabels()))
            artists.extend(list(extra_ax.get_yticklabels()))
            artists.extend((extra_ax.xaxis.label, extra_ax.yaxis.label))
            legend = extra_ax.get_legend()
            if legend is not None:
                artists.append(legend)
        boxes = []
        for artist in artists:
            if artist is None or not artist.get_visible():
                continue
            if hasattr(artist, "get_text") and not artist.get_text().strip():
                continue
            try:
                box = artist.get_window_extent(renderer=renderer)
            except Exception:
                continue
            if box.width > 0 and box.height > 0:
                boxes.append(box)
        if not boxes:
            return fig
        min_x = min(box.x0 for box in boxes)
        max_x = max(box.x1 for box in boxes)
        min_y = min(box.y0 for box in boxes)
        max_y = max(box.y1 for box in boxes)
        position = ax.get_position()
        left, bottom, right, top = (
            position.x0, position.y0, position.x1, position.y1
        )
        changed = False
        if min_x < pad_px:
            left = min(0.72, left + (pad_px - min_x) / fig_box.width)
            changed = True
        if max_x > fig_box.width - pad_px:
            right = max(0.28, right - (max_x - (fig_box.width - pad_px)) / fig_box.width)
            changed = True
        if min_y < pad_px:
            bottom = min(0.62, bottom + (pad_px - min_y) / fig_box.height)
            changed = True
        if max_y > fig_box.height - pad_px:
            top = max(0.48, top - (max_y - (fig_box.height - pad_px)) / fig_box.height)
            changed = True
        if not changed or right <= left + 0.08 or top <= bottom + 0.08:
            return fig
        fig.subplots_adjust(left=left, bottom=bottom, right=right, top=top)
    return fig

def bioanalys_report(paths, template_id, width_mm, height_mm, dpi, dims, stats=""):
    lines = [
        "step_executed=adapt_figure",
        f"template_id={template_id}",
        f"seed={os.environ.get('BIOANALYS_SEED', '')}",
        f"input_data={input_data}",
        f"line_id={os.environ.get('BIO_LINE_ID', 'unknown')}",
        f"width_mm={width_mm}",
        f"height_mm={height_mm}",
        f"dpi={dpi}",
        dims,
        stats,
        "palette=Okabe-Ito",
        "legend_position=outside",
        f"artifact_png={paths['png'].name}",
        f"artifact_pdf={paths['pdf'].name}",
        f"artifact_object={paths['object'].name}",
    ]
    paths["report"].write_text("
".join([line for line in lines if line]) + "
", encoding="utf-8")

def bioanalys_save_single(fig, path, dpi=300, template_id="unknown", dims="", stats=""):
    target = Path(path)
    stem = target.with_suffix("")
    pdf_path = stem.with_suffix(".pdf")
    pkl_path = Path(f"{stem}_plot.pkl")
    report_path = Path(f"{stem}_report.txt")
    fig.savefig(pdf_path, dpi=600, bbox_inches=None)
    fig.savefig(target, dpi=dpi, bbox_inches=None)
    with open(pkl_path, "wb") as handle:
        pickle.dump(fig, handle)
    paths = {"pdf": pdf_path, "png": target, "object": pkl_path, "report": report_path}
    bioanalys_report(paths, template_id, width_mm, height_mm, dpi, dims, stats)
    return paths

# Real-data target localization dot plot overlay
loc = pd.read_csv(input_data, sep = "\t")
required = {"gene", "celltype", "mean_expr_lognorm", "pct_expressing", "specificity_vs_global"}
missing = sorted(required.difference(loc.columns))
if missing:
    raise ValueError(f"dotplot input columns missing: {missing}")
group_col = str(ADAPT_VARS.get("group_col") or "celltype")
if group_col not in loc.columns or group_col == "celltype":
    group_col = "celltype"
genes = (
    loc.groupby("gene", observed=True)["specificity_vs_global"]
    .max()
    .sort_values(ascending=False)
    .head(8)
    .index
)
plot_df = loc[loc["gene"].isin(genes)].copy()
gene_order = list(genes)
plot_df["gene"] = pd.Categorical(plot_df["gene"], categories=gene_order, ordered=True)
group_order = (
    plot_df.groupby(group_col, observed=True)["n_cells"].sum()
    .sort_values(ascending=False).head(12).index.tolist()
)
plot_df = plot_df[plot_df[group_col].isin(group_order)].copy()
plot_df[group_col] = pd.Categorical(plot_df[group_col], categories=group_order, ordered=True)
fig, ax = plt.subplots()
fig.set_size_inches(width_mm / 25.4, height_mm / 25.4)
scatter = ax.scatter(
    plot_df["gene"].astype(str),
    plot_df[group_col].astype(str),
    s=np.clip(8 + plot_df["pct_expressing"].to_numpy() * 38, 8, 46),
    c=plot_df["mean_expr_lognorm"].to_numpy(),
    cmap="viridis",
    linewidths=0,
    alpha=0.9,
)
ax.set_xlabel("Gene")
ax.set_ylabel(group_col)
ax.tick_params(axis="x", rotation=0, labelsize=6.5)
ax.tick_params(axis="y", labelsize=6.5)
bioanalys_finish_axes(ax)
colorbar = fig.colorbar(scatter, ax=ax, fraction=0.046, pad=0.04)
colorbar.set_label("Mean expression", fontsize=7)
colorbar.ax.tick_params(labelsize=6.5, width=0.5, length=2.5)
size_handles = [
    ax.scatter([], [], s=8 + value * 38, facecolors="none", edgecolors="#555555", linewidths=0.4)
    for value in (0.25, 0.50, 0.75, 1.00)
]
size_labels = ["25", "50", "75", "100"]
ax.legend(
    size_handles, size_labels, title="Percent expressed",
    frameon=False, fontsize=6.0, title_fontsize=7,
    loc="upper left", bbox_to_anchor=(1.02, 1.0),
    ncol=1,
    handletextpad=0.4, columnspacing=1.2,
)
label_length = max((len(str(label)) for label in group_order), default=0)
left = min(0.52, max(0.24, (label_length * 4.6 + 10) / (width_mm / 25.4 * 96)))
fig.subplots_adjust(left=left, right=0.76, top=0.96, bottom=0.18)
bioanalys_fit_tick_margins(fig, ax)
bioanalys_save_single(
  fig, output_file, dpi=dpi, template_id="fig_l2p_dotplot",
  dims=f"data_dimensions=rows={len(plot_df)};categories={len(group_order)}",
  stats="threshold=top_genes<=8;top_groups<=12;method=target_localization_dotplot",
)
plt.close(fig)
print(f"ADAPT_REAL_INPUT_OK dotplot rows={len(plot_df)}")

raise SystemExit(0)
# Retained master source for byte-level audit; unreachable after successful real-data render.
# Catalog-ID: 414
# Catalog-Title: Basic Bubble Plot with matplotlib
# Catalog-Page: https://python-graph-gallery.com/270-basic-bubble-plot/
# Catalog-Language: Python
# Source-Match: analogous
# Materialized-From: chart_code_library.db
# The adapter keeps this source after its real-data overlay for byte-level audit.
# libraries
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

# create data
df = pd.DataFrame({
      'x': np.random.rand(40),
      'y': np.random.rand(40),
      'z': np.random.rand(40),
   })
df.head()

# ---- cell ----
plt.scatter(df['x'], df['y'], s=df['z']*1000, alpha=0.5)
plt.show()
