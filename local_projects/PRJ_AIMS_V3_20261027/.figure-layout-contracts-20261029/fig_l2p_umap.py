# Figure-Contract: width_mm=88; height_mm=80; dpi=300; column=single
# Master-Source: src/figure_sources/fig_l2p_umap.py | Master-SHA256: e913b7b61f0aa17730ac3b4353d782960b9fbaef3869b18724c37e9168b501cf
# Catalog-ID: 505 | Catalog-Language: Python | Source-Match: analogous
# Adapted-Project: PRJ_AIMS_V3_20261027
# Adapted-Line: line3_spatial
# Adapt-Variable input_data: [object Object]
# Adapt-Variable group_col: [object Object]
ADAPT_VARS = {
  "input_data": "data/line3_spatial/processed/spatial_dimred_human.h5ad",
  "group_col": "celltype"
}

# Real-Data-Adapter: v1
# Project-Input: data/line3_spatial/processed/spatial_dimred_human.h5ad
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
input_data = "/mnt/ssd/bio_data/projects/PRJ_AIMS_V3_20261027/line3_spatial/processed/spatial_dimred_human.h5ad"
output_file = "figures/line3_spatial/umap_L2p_umap_verified.png"
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

# Real-data spatial UMAP overlay
import scanpy as sc
adata = sc.read_h5ad(input_data)
if "X_umap" not in adata.obsm:
    raise ValueError("spatial h5ad missing obsm['X_umap']")
umap = np.asarray(adata.obsm["X_umap"])[:, :2]
group_col = str(ADAPT_VARS.get("group_col") or "group")
if group_col not in adata.obs.columns:
    group_col = next((key for key in ("group", "condition", "celltype", "leiden") if key in adata.obs.columns), None)
if group_col is None:
    groups = pd.Series(["all"] * adata.n_obs)
    group_col = "all"
else:
    groups = adata.obs[group_col].astype(str).reset_index(drop=True)
fig, ax = plt.subplots()
fig.set_size_inches(width_mm / 25.4, height_mm / 25.4)
labels = sorted(pd.unique(groups).tolist())
legend_labels = [textwrap.fill(str(label), width=12) for label in labels]
for index, label in enumerate(labels):
    mask = (groups == label).to_numpy()
    ax.scatter(umap[mask, 0], umap[mask, 1], s=4, alpha=0.8,
               color=BIOANALYS_COLORS[index % len(BIOANALYS_COLORS)],
               marker=BIOANALYS_MARKERS[(index // len(BIOANALYS_COLORS)) % len(BIOANALYS_MARKERS)],
               label=legend_labels[index], linewidths=0, rasterized=adata.n_obs > 5000)
ax.set_xlabel("UMAP 1")
ax.set_ylabel("UMAP 2")
legend = ax.legend(
    frameon=False,
    fontsize=6.0,
    markerscale=1.8,
    loc="upper left",
    bbox_to_anchor=(1.02, 1.0),
    ncol=1,
)
legend._bioanalys_position_locked = True
bioanalys_finish_axes(ax)
fig.subplots_adjust(
    left=0.13,
    right=0.76,
    top=0.96,
    bottom=0.18,
)
bioanalys_fit_tick_margins(fig, ax)
bioanalys_save_single(
  fig, output_file, dpi=dpi, template_id="fig_l2p_umap",
  dims=f"data_dimensions=cells={adata.n_obs};categories={len(labels)}",
  stats="threshold=raster_cells>5000;method=UMAP_scatter",
)
plt.close(fig)
print(f"ADAPT_REAL_INPUT_OK umap cells={adata.n_obs} groups={len(labels)}")
  dims=f"data_dimensions=rows={len(plot_df)};categories={len(group_order)}",
  stats="threshold=top_genes<=8;top_groups<=12;method=target_localization_dotplot",
)
plt.close(fig)
print(f"ADAPT_REAL_INPUT_OK umap cells={adata.n_obs} groups={len(labels)}")

raise SystemExit(0)
# Retained master source for byte-level audit; unreachable after successful real-data render.
# Catalog-ID: 505
# Catalog-Title: Scatter plot with a grouping variable with Pandas
# Catalog-Page: https://python-graph-gallery.com/537-scatter-plots-grouped-by-color-with-pandas/
# Catalog-Language: Python
# Source-Match: analogous
# Materialized-From: chart_code_library.db
# The adapter keeps this source after its real-data overlay for byte-level audit.
import pandas as pd
import numpy as np # data generation
import matplotlib.pyplot as plt

# ---- cell ----
# Generate a sample of 100 observations
sample_size = 200
first_variable = np.random.uniform(30, 20, sample_size)
second_variable = first_variable * 10 + np.random.normal(0, 10, sample_size)
categorical_variable = ['Group1' if i < 25 else 'Group2' for i in first_variable]

# Put the data into a pandas df
df = pd.DataFrame({'variable1': first_variable,
                   'variable2': second_variable,
                   'categorical_variable': categorical_variable}
                 )

# ---- cell ----
df.plot.scatter('variable1', # x-axis
                'variable2', # y-axis
                grid=True, # Add a grid in the background
               )
plt.show()

# ---- cell ----
# Get color for each data point
colors = {'Group1': 'orange', 'Group2': 'purple'}
color_list = [colors[group] for group in df['categorical_variable']]

# Create a scatter plot with color-coding based on 'categorical_variable'
ax = df.plot.scatter('variable1',
                'variable2',
                c=color_list,
                grid=True)

# Create legend handles, labels for each group and add legend to the plot
import matplotlib.patches as mpatches
legend_handles = [
    mpatches.Patch(color=colors['Group1'], label='Group1'),
    mpatches.Patch(color=colors['Group2'], label='Group2'), # add as many as needed
]
ax.legend(handles=legend_handles,
          loc='upper left')

plt.show()

# ---- cell ----
# Get color for each data point
colors = {'Group1': 'orange', 'Group2': 'purple'}
color_list = [colors[group] for group in df['categorical_variable']]

# Create a scatter plot with color-coding based on 'categorical_variable'
ax = df.plot.scatter('variable1',
                'variable2',
                c=color_list,
                grid=True,
                figsize=(7,6))

# Create legend handles, labels for each group and add legend to the plot
import matplotlib.patches as mpatches
legend_handles = [
    mpatches.Patch(color=colors['Group1'], label='Group1'),
    mpatches.Patch(color=colors['Group2'], label='Group2'), # add as many as needed
]
ax.legend(handles=legend_handles,
          loc='upper left')

# Add title and labels ('\n' allow us to jump rows)
ax.set_title('Scatter plot\nwith pandas',
             weight='bold')
ax.set_xlabel('Life Expectancy')
ax.set_ylabel('GDP per capita')

plt.show()
