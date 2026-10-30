# Figure-Contract: width_mm=180; height_mm=85; dpi=300; column=wide
# Master-Source: src/figure_sources/fig_l2p_violin.py | Master-SHA256: 04c11db5c3fa8edf9b5bc8d89f1885fa37a4037cc9884ddcf163fd5b53b89700
# Catalog-ID: 472 | Catalog-Language: Python | Source-Match: exact
# Adapted-Project: PRJ_AIMS_V3_20261027
# Adapted-Line: line2_scrna
# Adapt-Variable input_data: [object Object]
# Adapt-Variable group_col: [object Object]
# Adapt-Variable value_col: [object Object]
ADAPT_VARS = {
  "input_data": "data/line2_scrna/processed/celltype_composition.tsv",
  "group_col": "celltype",
  "value_col": "prop"
}

# Real-Data-Adapter: v1
# Project-Input: data/line2_scrna/processed/celltype_composition.tsv
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
input_data = "/mnt/ssd/bio_data/projects/PRJ_AIMS_V3_20261027/line2_scrna/processed/celltype_composition.tsv"
output_file = "figures/line2_scrna/violin_L2p_violin_verified.png"
width_mm = 180
height_mm = 85
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

# Real-data cell-composition violin overlay
comp = pd.read_csv(input_data, sep = "\t")
group_col = str(ADAPT_VARS.get("group_col") or "celltype")
value_col = str(ADAPT_VARS.get("value_col") or "prop")
required = {group_col, value_col}
missing = sorted(required.difference(comp.columns))
if missing:
    raise ValueError(f"violin input columns missing: {missing}")
comp[value_col] = pd.to_numeric(comp[value_col], errors="coerce")
comp = comp.dropna(subset=[group_col, value_col])
order = comp.groupby(group_col, observed=True).size().sort_values(ascending=False).head(8).index.tolist()
data = [comp.loc[comp[group_col] == group, value_col].to_numpy() for group in order]
fig, ax = plt.subplots()
fig.set_size_inches(width_mm / 25.4, height_mm / 25.4)
parts = ax.violinplot(data, vert=False, showmeans=False, showmedians=False, widths=0.72)
for body in parts["bodies"]:
    body.set_facecolor(BIOANALYS_COLORS[4])
    body.set_edgecolor("#333333")
    body.set_alpha(0.72)
box = ax.boxplot(
    data, vert=False, widths=0.10, patch_artist=True, showfliers=False,
    medianprops={"color": "black", "linewidth": 0.45},
    whiskerprops={"color": "#555555", "linewidth": 0.35},
    capprops={"color": "#555555", "linewidth": 0.35},
)
for patch in box["boxes"]:
    patch.set_facecolor("white")
    patch.set_edgecolor("#555555")
    patch.set_linewidth(0.35)
rng = np.random.default_rng(seed)
for index, values in enumerate(data, start=1):
    jitter = rng.normal(0, 0.035, size=len(values))
    ax.scatter(values, index + jitter, s=3, color="#333333", alpha=0.25, linewidths=0)
ax.set_yticks(np.arange(1, len(order) + 1), order, rotation=0, fontsize=6.5)
ax.set_ylabel(group_col)
ax.set_xlabel(value_col)
bioanalys_finish_axes(ax)
label_length = max((len(str(label)) for label in order), default=0)
left = min(0.42, max(0.18, 0.010 * label_length))
fig.subplots_adjust(left=left, right=0.98, top=0.96, bottom=0.16)
bioanalys_fit_tick_margins(fig, ax)
bioanalys_save_single(
  fig, output_file, dpi=dpi, template_id="fig_l2p_violin",
  dims=f"data_dimensions=rows={len(comp)};categories={len(order)}",
  stats="threshold=top_groups<=8;method=cell_composition_violin",
)
plt.close(fig)
print(f"ADAPT_REAL_INPUT_OK violin groups={len(order)} rows={len(comp)}")

raise SystemExit(0)
# Retained master source for byte-level audit; unreachable after successful real-data render.
# Catalog-ID: 472
# Catalog-Title: Violin plot with Beeswarm
# Catalog-Page: https://python-graph-gallery.com/502-violinplot-and-swarmplot/
# Catalog-Language: Python
# Source-Match: exact
# Materialized-From: chart_code_library.db
# The adapter keeps this source after its real-data overlay for byte-level audit.
# libraries & dataset
import pandas as pd
import seaborn as sns
import matplotlib.pyplot as plt

# ---- cell ----
path = 'https://raw.githubusercontent.com/holtzy/The-Python-Graph-Gallery/master/static/data/sqa_data.csv'
data = pd.read_csv(path)

# ---- cell ----
# Palettes for the areas and the datapoints 
# Light colors for the dots
swarmplot_palette = {'Sqa_par':'#8f96bf', 'Sqa_bif':'#ebb0e5', 'Sqa_zz':'#9feed3'}

# Dark colors for the violin
violin_palette = {'Sqa_par':'#333c70', 'Sqa_bif':'#90367c', 'Sqa_zz':'#34906c'}

# ---- cell ----
# create figure and seaborn context
sns.set_context('notebook', font_scale=1.2)
fig, ax = plt.subplots(figsize=(8,4))

# Plot the violin
ax = sns.violinplot(y="dist", 
                    x="name", 
                    data=data,
                    palette=violin_palette,
                    scale='count',
                    inner=None
              )

plt.show()

# ---- cell ----
# create figure and seaborn context
sns.set_context('notebook', font_scale=1.2)
fig, ax = plt.subplots(figsize=(8,5))

# Plot the violin
ax = sns.violinplot(y="dist", 
                    x="name", 
                    data=data,
                    palette=violin_palette,
                    scale='count',
                    inner=None
              )

# Plot the swarmplot on top 
ax = sns.swarmplot(y="dist",
                   x="name",
                   data=data, 
                   color="white", 
                   edgecolor="gray",
                   s=6, # Circle size
                   palette=swarmplot_palette
             )

# Change axis labels, ticks and title
ax.set_xticks([0, 1, 2], ['Parallel','Bifurcated','Zig-zag'])
ax.set_xlabel('Squaramide CCSD systems')
ax.set_ylabel(r'$HB distance\ (\AA)$')
plt.ylim(1.5, 3.5)

# Add horizontal grid
ax.grid(axis='y')
ax.set_axisbelow(True)

plt.show()
