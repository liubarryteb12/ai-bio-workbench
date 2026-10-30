# Figure-Contract: width_mm=88; height_mm=80; dpi=300; column=single
# Master-Source: src/figure_sources/fig_l2p_volcano.py | Master-SHA256: 8e33825a9e45ab20a160c97a7020f41a471074356a712f00cd193ca1c330b756
# Catalog-ID: 683 | Catalog-Language: Python | Source-Match: analogous
# Adapted-Project: PRJ_AIMS_V3_20261027
# Adapted-Line: line2_scrna
# Adapt-Variable input_data: [object Object]
# Adapt-Variable group_col: [object Object]
# Adapt-Variable label_genes: [object Object]
ADAPT_VARS = {
  "input_data": "data/line2_scrna/processed/deg_all_by_celltype.tsv",
  "group_col": "celltype",
  "label_genes": ["S100A8"]
}

# Real-Data-Adapter: v1
# Project-Input: data/line2_scrna/processed/deg_all_by_celltype.tsv
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
input_data = "/mnt/ssd/bio_data/projects/PRJ_AIMS_V3_20261027/line2_scrna/processed/deg_all_by_celltype.tsv"
output_file = "figures/line2_scrna/L2p_volcano_verified.png"
width_mm = 88
height_mm = 80
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

# Real-data cell-type differential-expression volcano overlay
deg = pd.read_csv(input_data, sep = "\t")
required = {"celltype", "gene_symbol", "log2fc", "pvals_adj"}
missing = sorted(required.difference(deg.columns))
if missing:
    raise ValueError(f"volcano input columns missing: {missing}")
deg = deg.replace([np.inf, -np.inf], np.nan).dropna(subset=["gene_symbol", "log2fc", "pvals_adj"])
deg["neglog10"] = -np.log10(np.clip(deg["pvals_adj"].astype(float), 1e-300, 1.0))
deg["sig"] = np.where(
    (deg["pvals_adj"].astype(float) < 0.05) & (deg["log2fc"].astype(float) > 1), "Up",
    np.where((deg["pvals_adj"].astype(float) < 0.05) & (deg["log2fc"].astype(float) < -1), "Down", "NS"),
)
group_col = str(ADAPT_VARS.get("group_col") or "celltype")
if group_col not in deg.columns:
    group_col = "celltype"
top_groups = (
    deg.groupby(group_col, observed=True)["pvals_adj"].min()
    .sort_values().head(8).index
)
plot_df = deg[deg[group_col].isin(top_groups)].copy()
if len(plot_df) > 5000:
    plot_df = plot_df.nsmallest(5000, "pvals_adj")
fig, ax = plt.subplots()
fig.set_size_inches(width_mm / 25.4, height_mm / 25.4)
for index, group in enumerate(top_groups):
    part = plot_df[plot_df[group_col] == group]
    ax.scatter(part["log2fc"], part["neglog10"], s=2.4, alpha=0.72,
               color=BIOANALYS_COLORS[index % len(BIOANALYS_COLORS)],
               marker=BIOANALYS_MARKERS[index % len(BIOANALYS_MARKERS)],
               label=textwrap.fill(str(group), width=10), linewidths=0)
ax.axvline(-1, ls="--", lw=0.45, color="#555555")
ax.axvline(1, ls="--", lw=0.45, color="#555555")
ax.axhline(-np.log10(0.05), ls="--", lw=0.45, color="#555555")
label_genes = set(ADAPT_VARS.get("label_genes") or [])
top_labels = plot_df.nsmallest(6, "pvals_adj")["gene_symbol"].astype(str).tolist()
texts = []
for gene in list(label_genes.union(top_labels))[:8]:
    row = plot_df[plot_df["gene_symbol"].astype(str) == gene].nsmallest(1, "pvals_adj")
    if not row.empty:
        texts.append(ax.text(
            float(row.iloc[0]["log2fc"]), float(row.iloc[0]["neglog10"]), gene,
            fontsize=6.0, color="#333333",
        ))
if texts:
    try:
        from adjustText import adjust_text
        adjust_text(
            texts, ax=ax, expand_points=(1.2, 1.4),
            arrowprops={"arrowstyle": "-", "color": "#777777", "lw": 0.35},
        )
    except ImportError:
        pass
ax.set_xlabel("log2 fold change")
ax.set_ylabel("-log10(adjusted P)")
legend = ax.legend(
    frameon=False,
    fontsize=6.0,
    loc="upper left",
    bbox_to_anchor=(1.02, 1.0),
    ncol=1,
    markerscale=1.5,
    handlelength=1.0,
    handletextpad=0.35,
    columnspacing=0.8,
    labelspacing=0.25,
    borderaxespad=0.0,
)
legend._bioanalys_position_locked = True
bioanalys_finish_axes(ax)
fig.subplots_adjust(left=0.16, right=0.76, top=0.96, bottom=0.18)
bioanalys_fit_tick_margins(fig, ax)
bioanalys_save_single(
  fig, output_file, dpi=dpi, template_id="fig_l2p_volcano",
  dims=f"data_dimensions=rows={len(plot_df)};categories={len(top_groups)}",
  stats="threshold=padj<0.05;log2fc_abs>1;method=BH_adjusted_volcano",
)
plt.close(fig)
print(f"ADAPT_REAL_INPUT_OK volcano rows={len(plot_df)}")

raise SystemExit(0)
# Retained master source for byte-level audit; unreachable after successful real-data render.
# Catalog-ID: 683
# Catalog-Title: Scatterplot with labels and text repel in Matplotlib
# Catalog-Page: https://python-graph-gallery.com/web-text-repel-with-matplotlib/
# Catalog-Language: Python
# Source-Match: analogous
# Materialized-From: chart_code_library.db
# The adapter keeps this source after its real-data overlay for byte-level audit.
import matplotlib.pyplot as plt
import numpy as np

from adjustText import adjust_text
from faker import Faker
from palmerpenguins import load_penguins

# ---- cell ----
penguins = load_penguins()
penguins.head()

# ---- cell ----
penguins = penguins.dropna()

# ---- cell ----
# Colors
BG_WHITE = "#fbf9f4"
GREY_LIGHT = "#b4aea9"
GREY50 = "#7F7F7F"
GREY30 = "#4d4d4d"
BLUE_DARK = "#1B2838"
BLUE = "#2a475e"
COLORS = ["#386cb0", "#fdb462", "#7fc97f" ] # A color for each species

# A list with the species names
SPECIES = sorted(penguins["species"].unique())

# Horizontal lines
HLINES = [40, 50, 60]

# Vertical and horizontal tick marks
YTICKS = [40, 50, 60]
XTICKS = [160, 170, 180, 190, 200, 210, 220, 230, 240]

# List of random names
# Generate Faker instance and set seed or reproducibility
faker = Faker()
# Set seed for reproducibility of the random names
faker.seed_instance(11) 
NAMES = [faker.first_name() for i in range(len(penguins))]

# The markers we use in the scatterplot
MARKERS = ["o", "^", "s"] # circle, triangle, square

# ---- cell ----
# Initialize layout ----------------------------------------------
fig, ax = plt.subplots(figsize= (14, 10))

# Background color
fig.patch.set_facecolor(BG_WHITE)
ax.set_facecolor(BG_WHITE)

# Horizontal lines in the background
for h in HLINES:
    ax.axhline(h, color=GREY50, ls=(0, (5, 5)), alpha=0.8, zorder=0)

# Add scatterplot  -----------------------------------------------
# Loop through species, colors, and markers.
# Each species receives a different combination of color and marker.
for species, color, marker  in zip(SPECIES, COLORS, MARKERS):
    data = penguins[penguins["species"] == species]
    ax.scatter(
        "flipper_length_mm", "bill_length_mm", s=50, color=color, 
        marker=marker, alpha=0.8, data=data
    )

# ---- cell ----
# Add name labels ------------------------------------------------
# Only names that start with the letter "C" are added.
# `ax.text()` outputs are appended to the `TEXTS` list. 
# This list is passed to `adjust_text()` to repel the labels and add arrows.
TEXTS = []
for i in range(len(penguins)):
    if NAMES[i].startswith("C"):
        x = penguins["flipper_length_mm"].iloc[i]
        y = penguins["bill_length_mm"].iloc[i]
        text = NAMES[i]
        TEXTS.append(ax.text(x, y, text, color=GREY30, fontsize=14, fontname="Poppins"))


# Adjust text position and add arrows ----------------------------
# 'expand_points' is a tuple with two multipliers by which to expand
# the bounding box of texts when repelling them from points

# 'arrowprops' receives a dictionary with all the properties we want
# for the arrows
adjust_text(
    TEXTS, 
    expand_points=(2, 2),
    arrowprops=dict(
        arrowstyle="->", 
        color=GREY50, 
        lw=2
    ),
    ax=fig.axes[0]
)
fig

# ---- cell ----
# Add title and subtitle -----------------------------------------
# Title
fig.suptitle(
    "Palmer Penguins Data Visualization",
    x = 0.122,
    y = 0.975,
    ha="left",
    fontsize=32,
    fontname="Lobster Two",
    color=BLUE,
    weight="bold",    
)

# Subtitle
ax.set_title(
    "Scatter plot of flipper length vs bill length",
    loc="left",
    ha="left",
    fontsize=24,
    fontname="Lobster Two",
    color=BLUE_DARK,
    weight="bold",
    pad=10
)

# Add legend -----------------------------------------------------

# We store the result of `ax.legend()` for further customizations
legend = ax.legend(
    loc=(0.85, 0.025), # bottom-right
    labelspacing=1.5,  # add space between labels
    markerscale=1.5,   # increase marker size
    frameon=False      # don't put a frame
)

# Iterate through text elements and species names
for text, species in zip(legend.get_texts(), SPECIES):
    text.set_text(species)       # Set species name
    text.set_fontname("Roboto")  # Change default font 
    text.set_fontsize(16)        # Change default font size

# Grab title and customize its appearence.
legend.set_title("Species")
legend_title = legend.get_title()
legend_title.set_fontname("Roboto")
legend_title.set_fontweight("bold")
legend_title.set_fontsize(18)
legend_title.set_ha("left")

# Customize layout -----------------------------------------------
# Hide spines
ax.spines["right"].set_color("none")
ax.spines["top"].set_color("none")

# Customize spines color
ax.spines["left"].set_color(GREY_LIGHT)
ax.spines["left"].set_linewidth(2)
ax.spines["bottom"].set_color(GREY_LIGHT)
ax.spines["bottom"].set_linewidth(2)

# Customize labels and ticks
ax.tick_params(length=0)

ax.set_yticks(YTICKS)
ax.set_yticklabels(YTICKS, fontname="Lobster Two", size=15)
ax.set_ylabel("bill Length (mm)", fontname="Lobster Two", size=18, weight="bold")

ax.set_xticks(XTICKS)
ax.set_xticklabels(XTICKS, fontname="Lobster Two", size=15)
ax.set_xlabel("flip length (mm)", fontname="Lobster Two", size=18, weight="bold")

fig
