import crypto from 'node:crypto';
import path from 'node:path';

const LINES = ['line1_bulk', 'line2_scrna', 'line3_spatial'];
const REMOTE_PROJECTS_ROOT = '/mnt/ssd/bio_data/projects';
const LEGEND_POSITIONS = new Set(['none', 'right', 'top', 'inside']);

const SUPPORTED_TEMPLATE_IDS = new Set([
  'fig_l2_pca',
  'fig_l2_heatmap',
  'fig_l2_volcano',
  'fig_l2p_dotplot',
  'fig_l2p_volcano',
  'fig_l2p_umap',
  'fig_l1_groupedbar',
  'fig_l1_scatter',
  'fig_l1_boxplot',
  'fig_l1_density',
  'fig_l1_histogram',
  'fig_l1_violin',
  'fig_l2_umap',
  'fig_l2p_violin',
  'fig_l3_sankey',
]);

// Physical size is a property of the selected reference figure, not of the
// project-wide 4:3 / 16:9 styling template. It is read from figure_layout.
export const SUPPORTED_FIGURE_IDS = Object.freeze([...SUPPORTED_TEMPLATE_IDS]);

export function figureContractComment(template) {
  const contract = figureLayoutContract(template);
  return [
    '# Figure-Contract:',
    `width_mm=${contract.width_mm};`,
    `height_mm=${contract.height_mm};`,
    `dpi=${contract.dpi};`,
    `column=${contract.column}`,
  ].join(' ');
}

export function figureLayoutContract(template) {
  const layout = template?.figure_layout;
  if (!layout || typeof layout !== 'object') {
    throw new Error(`图模板缺少 figure_layout: ${template?.id || 'unknown'}`);
  }
  const width = Number(layout.width_mm);
  const height = Number(layout.height_mm);
  const dpi = Number(layout.dpi ?? 300);
  const legendPosition = String(layout.legend_position || '');
  if (!Number.isFinite(width) || width <= 0) throw new Error(`figure_layout.width_mm 非法: ${template.id}`);
  if (!Number.isFinite(height) || height <= 0) throw new Error(`figure_layout.height_mm 非法: ${template.id}`);
  if (!Number.isFinite(dpi) || dpi <= 0) throw new Error(`figure_layout.dpi 非法: ${template.id}`);
  if (!LEGEND_POSITIONS.has(legendPosition)) {
    throw new Error(`figure_layout.legend_position 非法: ${template.id}`);
  }
  return {
    width_mm: width,
    height_mm: height,
    dpi,
    column: layout.column || null,
    legend_position: legendPosition,
  };
}

function normalizeRelativePath(value, fieldName) {
  const normalized = String(value || '').trim().split('\\').join('/').replace(/^\.\/+/, '');
  if (!normalized) throw new Error(`${fieldName} 缺失`);
  if (!/^[A-Za-z0-9._/-]+$/.test(normalized)) {
    throw new Error(`${fieldName} 含非法字符`);
  }
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`${fieldName} 必须是项目相对路径`);
  }
  if (normalized.split('/').includes('..')) {
    throw new Error(`${fieldName} 禁止跨项目路径`);
  }
  return normalized;
}

function validateCanonicalOutput(value) {
  const normalized = String(value || '').trim().split('\\').join('/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)
    || normalized.split('/').includes('..') || normalized.split('/').length !== 1
    || !/^[A-Za-z0-9._-]+$/.test(normalized)) {
    throw new Error(`canonical_output 非法: ${value}`);
  }
  return normalized;
}

// Host-language-agnostic master audit block: Base64 UTF-8 bytes in comments,
// so both R and Python parsers accept the full generated file.
function renderMasterAuditBlock(template, masterSource) {
  const masterBytes = Buffer.from(masterSource, 'utf8');
  const sha256 = crypto.createHash('sha256').update(masterBytes).digest('hex');
  if (template.source_sha256 && template.source_sha256 !== sha256) {
    throw new Error(`master source sha256 mismatch: ${template.id}`);
  }
  const encoded = masterBytes.toString('base64');
  const chunks = encoded.match(/.{1,76}/g) || [];
  return [
    '# Retained master source for byte-level audit; unreachable after real-data render.',
    `# Master-SHA256: ${sha256}`,
    ...chunks.map((chunk) => `# MASTER-B64: ${chunk}`),
  ].join('\n');
}

function validateBoundaries({ projectId, lineId, inputPath, template }) {
  if (!/^[A-Za-z0-9._-]+$/.test(String(projectId || ''))) {
    throw new Error(`projectId 非法: ${projectId}`);
  }
  if (!LINES.includes(lineId)) throw new Error(`lineId 非法: ${lineId}`);
  if (!Array.isArray(template?.lines) || !template.lines.includes(lineId)) {
    throw new Error(`lineId 与模板跨线: ${lineId} 不在 ${template?.id || 'unknown'}.lines`);
  }

  const segments = inputPath.split('/').filter(Boolean);
  const localProjectsIndex = segments.indexOf('local_projects');
  if (localProjectsIndex >= 0 && segments[localProjectsIndex + 1] !== projectId) {
    throw new Error(`inputPath 跨项目: 期望 ${projectId}，收到 ${segments[localProjectsIndex + 1] || 'unknown'}`);
  }
  const foreignLine = LINES.find((candidate) => candidate !== lineId && inputPath.includes(candidate));
  if (foreignLine) throw new Error(`inputPath 跨线: ${lineId} 出现 ${foreignLine}`);
  if (!segments.includes(lineId)) {
    throw new Error(`inputPath 必须位于 ${lineId} 数据目录`);
  }
}

function resolveRemoteInput(inputPath, projectId, lineId) {
  const prefixes = [
    `data/${lineId}/`,
    'processed/',
    'results/',
  ];
  const prefix = prefixes.find((item) => inputPath.startsWith(item));
  if (!prefix) {
    throw new Error(`inputPath 必须位于 data/${lineId}/、processed/ 或 results/`);
  }
  const suffix = prefix === `data/${lineId}/`
    ? inputPath.slice(prefix.length)
    : `${prefix}${inputPath.slice(prefix.length)}`;
  return path.posix.join(REMOTE_PROJECTS_ROOT, projectId, lineId, suffix);
}

function literalValue(value, language) {
  if (value === null || value === undefined) return language === 'python' ? 'None' : 'NULL';
  if (Array.isArray(value)) {
    const items = value.map((item) => literalValue(item, language));
    return language === 'python' ? `[${items.join(', ')}]` : `c(${items.join(', ')})`;
  }
  if (typeof value === 'boolean') return language === 'python' ? (value ? 'True' : 'False') : String(value).toUpperCase();
  if (typeof value === 'number') return String(value);
  const escaped = String(value).replace(/\\/g, '\\\\').replace(/'/g, String.raw`\'`);
  return language === 'python'
    ? `"${escaped.replace(/"/g, '\\"')}"`
    : `'${escaped}'`;
}

function renderAdaptDeclaration(template, adaptVars) {
  const language = template.language;
  const keys = Object.keys(template.adapt_vars || {});
  const lines = keys.map((key) => {
    const value = adaptVars?.[key] ?? null;
    return language === 'python'
      ? `  "${key}": ${literalValue(value, language)},`
      : `  ${key} = ${literalValue(value, language)},`;
  });
  const declarations = lines.join('\n').replace(/,$/, '');
  if (language === 'python') {
    return `ADAPT_VARS = {\n${declarations}\n}\n`;
  }
  return `adapt_vars <- list(\n${declarations}\n)\n`;
}

function rPrelude(template, inputPath, remoteInput, lineId) {
  const layout = figureLayoutContract(template);
  return `# Real-Data-Adapter: v1
# Project-Input: ${inputPath}
seed_value <- Sys.getenv("BIOANALYS_SEED", unset = "")
if (nchar(seed_value) == 0) quit(status = 3)
set.seed(as.integer(seed_value))
Sys.setenv(
  BIOANALYS_LAYOUT_PRESERVE_FIGSIZE = "1",
  BIOANALYS_LAYOUT_FIXED_CANVAS = "1"
)
input_data <- "${remoteInput}"
output_file <- "figures/${lineId}/${template.canonical_output}"
width_mm <- ${layout.width_mm}
height_mm <- ${layout.height_mm}
dpi <- ${layout.dpi}
legend_position <- "${layout.legend_position}"
if (!file.exists(input_data)) stop(paste("real input missing:", input_data))
dir.create(dirname(output_file), recursive = TRUE, showWarnings = FALSE)

bioanalys_colors <- c(
  blue = "#0072B2", vermillion = "#D55E00", green = "#009E73",
  orange = "#E69F00", sky = "#56B4E9", purple = "#CC79A7",
  yellow = "#F0E442", grey = "#999999"
)

bioanalys_theme_single <- function(base_size = 7) {
  ggplot2::theme_classic(base_size = base_size, base_family = "DejaVu Sans") +
    ggplot2::theme(
      plot.title = ggplot2::element_blank(),
      plot.subtitle = ggplot2::element_blank(),
      text = ggplot2::element_text(colour = "black"),
      axis.title = ggplot2::element_text(size = 7, colour = "black"),
      axis.text = ggplot2::element_text(size = 6.5, colour = "black"),
      axis.line = ggplot2::element_line(linewidth = 0.5 / 2.845276, colour = "black"),
      axis.ticks = ggplot2::element_line(linewidth = 0.5 / 2.845276, colour = "black"),
      axis.ticks.length = ggplot2::unit(1.4, "mm"),
      legend.title = ggplot2::element_text(size = 7, colour = "black"),
      legend.text = ggplot2::element_text(size = 6.5, colour = "black"),
      legend.key.size = ggplot2::unit(3, "mm"),
      legend.background = ggplot2::element_blank(),
      legend.key = ggplot2::element_blank(),
      panel.background = ggplot2::element_blank(),
      plot.background = ggplot2::element_blank(),
      panel.grid = ggplot2::element_blank(),
      plot.margin = ggplot2::unit(c(2, 2, 2, 2), "mm")
    )
}

bioanalys_output_paths <- function(path) {
  stem <- sub("\\\\.png$", "", basename(path), ignore.case = TRUE)
  list(
    png = path,
    pdf = file.path(dirname(path), paste0(stem, ".pdf")),
    rds = file.path(dirname(path), paste0(stem, "_plot.rds")),
    report = file.path(dirname(path), paste0(stem, "_report.txt"))
  )
}

bioanalys_report <- function(paths, template_id, width_mm, height_mm, dpi, dims, stats = "", palette = "Okabe-Ito") {
  lines <- c(
    "step_executed=adapt_figure",
    paste0("template_id=", template_id),
    paste0("seed=", Sys.getenv("BIOANALYS_SEED")),
    paste0("input_data=", input_data),
    paste0("line_id=", Sys.getenv("BIO_LINE_ID", unset = "unknown")),
    paste0("width_mm=", width_mm),
    paste0("height_mm=", height_mm),
    paste0("dpi=", dpi),
    dims,
    if (nzchar(stats)) stats else character(0),
    paste0("palette=", palette),
    paste0("legend_position=", legend_position),
    "plot_title=empty",
    paste0("artifact_png=", basename(paths$png)),
    paste0("artifact_pdf=", basename(paths$pdf)),
    paste0("artifact_object=", basename(paths$rds))
  )
  writeLines(lines, paths$report)
  invisible(paths)
}

bioanalys_export_ggplot <- function(plot_obj, path, width_mm, height_mm, dpi = 300,
                                    template_id = "unknown", dims = "", stats = "", palette = "Okabe-Ito") {
  paths <- bioanalys_output_paths(path)
  dir.create(dirname(paths$pdf), recursive = TRUE, showWarnings = FALSE)
  grDevices::cairo_pdf(paths$pdf, width = width_mm / 25.4, height = height_mm / 25.4, onefile = TRUE)
  print(plot_obj)
  grDevices::dev.off()
  ggplot2::ggsave(paths$png, plot_obj, width = width_mm, height = height_mm, units = "mm",
                  dpi = dpi, device = png, type = "cairo", bg = "white")
  saveRDS(plot_obj, paths$rds, compress = "xz")
  bioanalys_report(paths, template_id, width_mm, height_mm, dpi, dims, stats, palette)
  invisible(paths)
}

bioanalys_export_device <- function(draw_fn, path, width_mm, height_mm, dpi = 300,
                                    template_id = "unknown", dims = "", stats = "",
                                    palette = "Okabe-Ito") {
  paths <- bioanalys_output_paths(path)
  dir.create(dirname(paths$pdf), recursive = TRUE, showWarnings = FALSE)
  grDevices::cairo_pdf(paths$pdf, width = width_mm / 25.4, height = height_mm / 25.4, onefile = TRUE)
  draw_fn()
  recorded_plot <- grDevices::recordPlot()
  grDevices::dev.off()
  grDevices::png(paths$png, width = width_mm, height = height_mm, units = "mm",
                 res = dpi, type = "cairo", bg = "white")
  draw_fn()
  grDevices::dev.off()
  saveRDS(recorded_plot, paths$rds, compress = "xz")
  bioanalys_report(paths, template_id, width_mm, height_mm, dpi, dims, stats, palette)
  invisible(paths)
}
`;
}

function pythonPrelude(template, inputPath, remoteInput, lineId) {
  const layout = figureLayoutContract(template);
  return `# Real-Data-Adapter: v1
# Project-Input: ${inputPath}
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
input_data = "${remoteInput}"
output_file = "figures/${lineId}/${template.canonical_output}"
width_mm = ${layout.width_mm}
height_mm = ${layout.height_mm}
dpi = ${layout.dpi}
legend_position = "${layout.legend_position}"
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

def bioanalys_report(paths, template_id, width_mm, height_mm, dpi, dims, stats="", palette="Okabe-Ito"):
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
        f"palette={palette}",
        f"legend_position={legend_position}",
        "plot_title=empty",
        f"artifact_png={paths['png'].name}",
        f"artifact_pdf={paths['pdf'].name}",
        f"artifact_object={paths['object'].name}",
    ]
    paths["report"].write_text("\\n".join([line for line in lines if line]) + "\\n", encoding="utf-8")

def bioanalys_save_single(fig, path, dpi=300, template_id="unknown", dims="", stats="", palette="Okabe-Ito"):
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
    bioanalys_report(paths, template_id, width_mm, height_mm, dpi, dims, stats, palette)
    return paths
`;
}

const R_OVERLAYS = {
  fig_l2_pca: `# Real-data PCA overlay
suppressPackageStartupMessages({library(ggplot2)})
pca_df <- read.delim(input_data, check.names = FALSE)
group_name <- if (is.null(adapt_vars$group_col) || !nzchar(adapt_vars$group_col)) "group" else adapt_vars$group_col
if (!all(c("PC1", "PC2", group_name) %in% names(pca_df))) {
  stop(paste("PCA input columns missing:", group_name, "PC1", "PC2"))
}
pca_df[[group_name]] <- factor(pca_df[[group_name]])
group_sizes <- table(pca_df[[group_name]])
pc_cols <- grep("^PC[0-9]+$", names(pca_df), value = TRUE)
pc_cols <- pc_cols[order(as.integer(sub("PC", "", pc_cols)))]
pc_variance <- vapply(pca_df[pc_cols], stats::var, numeric(1), na.rm = TRUE)
pc_pct <- 100 * pc_variance / sum(pc_variance, na.rm = TRUE)
x_label <- if (length(pc_cols) >= 3) sprintf("PC1 (%.1f%% of shown PCs)", pc_pct[["PC1"]]) else "PC1"
y_label <- if (length(pc_cols) >= 3) sprintf("PC2 (%.1f%% of shown PCs)", pc_pct[["PC2"]]) else "PC2"
pca_plot <- ggplot(pca_df, aes(x = PC1, y = PC2, colour = .data[[group_name]], shape = .data[[group_name]])) +
  geom_point(size = 1.7, alpha = 0.9, stroke = 0.25) +
  labs(colour = group_name, shape = group_name, x = x_label, y = y_label) +
  bioanalys_theme_single() +
  theme(legend.position = "right")
if (length(group_sizes) > 1 && all(group_sizes >= 3)) {
  pca_plot <- pca_plot + stat_ellipse(linewidth = 0.45, level = 0.95)
}
bioanalys_export_ggplot(
  pca_plot, output_file,
  width_mm = width_mm, height_mm = height_mm, dpi = dpi,
  template_id = "fig_l2_pca",
  dims = paste0("data_dimensions=rows=", nrow(pca_df), ";columns=", ncol(pca_df)),
  stats = paste0(
    "threshold=group_count>=3_for_ellipse;",
    "method=principal_component_scatter;ellipse_level=0.95"
  )
)
cat("ADAPT_REAL_INPUT_OK pca rows=", nrow(pca_df), "\\n", sep = "")
`,
  fig_l2_heatmap: `# Real-data expression heatmap overlay
suppressPackageStartupMessages({library(ggplot2)})
expr_df <- read.delim(input_data, check.names = FALSE)
if (ncol(expr_df) < 3 || nrow(expr_df) < 2) stop("heatmap input has insufficient dimensions")
expr_matrix <- as.matrix(expr_df[, -1, drop = FALSE])
rownames(expr_matrix) <- make.unique(as.character(expr_df[[1]]))
storage.mode(expr_matrix) <- "numeric"
if (anyNA(expr_matrix)) stop("heatmap input contains non-numeric or missing values")
var_top <- order(apply(expr_matrix, 1, var), decreasing = TRUE)
expr_matrix <- expr_matrix[head(var_top, min(30, length(var_top))), , drop = FALSE]
expr_z <- t(scale(t(expr_matrix)))
expr_z[!is.finite(expr_z)] <- 0
expr_long <- data.frame(
  gene = factor(
    rep(rownames(expr_z), times = ncol(expr_z)),
    levels = rev(rownames(expr_z))
  ),
  sample = factor(
    rep(colnames(expr_z), each = nrow(expr_z)),
    levels = colnames(expr_z)
  ),
  z = as.vector(expr_z)
)
heat <- ggplot(expr_long, aes(x = sample, y = gene, fill = z)) +
  geom_tile(linewidth = 0) +
  scale_fill_gradient2(
    name = "Z-score",
    low = "#2166AC",
    mid = "#F7F7F7",
    high = "#B2182B",
    midpoint = 0,
    space = "Lab"
  ) +
  labs(x = NULL, y = NULL) +
  bioanalys_theme_single() +
  theme(
    axis.text.x = element_text(angle = 0, hjust = 0.5, vjust = 1),
    axis.text.y = element_text(size = 6.5),
    axis.ticks = element_blank(),
    panel.grid = element_blank(),
    legend.position = "right"
  )
bioanalys_export_ggplot(
  heat,
  output_file,
  width_mm = width_mm,
  height_mm = height_mm,
  dpi = dpi,
  template_id = "fig_l2_heatmap",
  dims = paste0("data_dimensions=rows=", nrow(expr_z), ";columns=", ncol(expr_z)),
  stats = "threshold=top_variance_features<=30;method=row_zscore",
  palette = "RdBu_r"
)
cat("ADAPT_REAL_INPUT_OK heatmap genes=", nrow(expr_z), " samples=", ncol(expr_z), "\\n", sep = "")
`,
  fig_l2_volcano: `# Real-data differential-expression volcano overlay
suppressPackageStartupMessages({library(ggplot2); library(ggrepel)})
deg_df <- read.delim(input_data, check.names = FALSE)
pick_column <- function(candidates) {
  hit <- candidates[candidates %in% names(deg_df)]
  if (!length(hit)) stop(paste("volcano input columns missing:", paste(candidates, collapse = " / ")))
  hit[[1]]
}
gene_col <- pick_column(c("gene", "gene_symbol", "symbol"))
fc_col <- pick_column(c("log2FC", "log2fc", "logFC"))
p_col <- pick_column(c("P_Value", "pvalue", "p_value", "P.Value"))
padj_col <- pick_column(c("adj_P_Val", "padj", "pvals_adj", "adj.P.Val"))
volcano_df <- data.frame(
  gene = as.character(deg_df[[gene_col]]),
  log2fc = as.numeric(deg_df[[fc_col]]),
  pvalue = as.numeric(deg_df[[p_col]]),
  padj = as.numeric(deg_df[[padj_col]])
)
volcano_df <- volcano_df[
  is.finite(volcano_df$log2fc) & is.finite(volcano_df$padj) & volcano_df$padj > 0,
]
volcano_df$neglog10 <- -log10(pmax(volcano_df$padj, 1e-300))
volcano_df$sig <- ifelse(volcano_df$padj < 0.05 & volcano_df$log2fc > 1, "Up",
                  ifelse(volcano_df$padj < 0.05 & volcano_df$log2fc < -1, "Down", "NS"))
labels <- unique(c(as.character(adapt_vars$label_genes), head(volcano_df$gene[order(volcano_df$padj)], 8)))
label_df <- volcano_df[volcano_df$gene %in% labels, ]
volcano <- ggplot(volcano_df, aes(x = log2fc, y = neglog10, colour = sig)) +
  geom_point(size = 0.8, alpha = 0.72, stroke = 0) +
  scale_colour_manual(values = c(Up = bioanalys_colors[["vermillion"]],
                                 Down = bioanalys_colors[["blue"]],
                                 NS = "grey72")) +
  geom_vline(xintercept = c(-1, 1), linetype = "dashed", linewidth = 0.35, colour = "grey35") +
  geom_hline(yintercept = -log10(0.05), linetype = "dashed", linewidth = 0.35, colour = "grey35") +
  geom_text_repel(
    data = label_df, aes(label = gene), size = 6.5 / 2.845276,
    family = "DejaVu Sans",
    min.segment.length = 0, max.overlaps = 30, seed = as.integer(seed_value),
    box.padding = 0.3, point.padding = 0.2
  ) +
  labs(x = "log2 fold change", y = "-log10(adjusted P)", colour = NULL) +
  bioanalys_theme_single() +
  theme(
    legend.position = "right",
    legend.direction = "vertical",
    legend.title = element_blank()
  )
bioanalys_export_ggplot(
  volcano, output_file,
  width_mm = width_mm, height_mm = height_mm, dpi = dpi,
  template_id = "fig_l2_volcano",
  dims = paste0("data_dimensions=rows=", nrow(volcano_df), ";columns=", ncol(volcano_df)),
  stats = "threshold=padj<0.05;log2fc_abs>1;method=BH_adjusted_volcano"
)
cat("ADAPT_REAL_INPUT_OK volcano rows=", nrow(volcano_df), "\\n", sep = "")
`,
  fig_l1_groupedbar: `# Real-data enrichment grouped bar overlay
suppressPackageStartupMessages({library(ggplot2)})
enrich <- read.delim(input_data, check.names = FALSE)
x_col <- if (is.null(adapt_vars$x_col) || !nzchar(adapt_vars$x_col)) "Description" else adapt_vars$x_col
value_col <- if (is.null(adapt_vars$value_col) || !nzchar(adapt_vars$value_col)) "NES" else adapt_vars$value_col
group_col <- if (is.null(adapt_vars$group_col) || !nzchar(adapt_vars$group_col)) "ont" else adapt_vars$group_col
required <- c(x_col, value_col, group_col)
if (!all(required %in% names(enrich))) stop(paste("groupedbar input columns missing:", paste(required, collapse = " / ")))
enrich[[value_col]] <- as.numeric(enrich[[value_col]])
enrich <- enrich[is.finite(enrich[[value_col]]), , drop = FALSE]
enrich <- head(enrich[order(abs(enrich[[value_col]]), decreasing = TRUE), , drop = FALSE], 15)
wrap_label <- function(x, width = 30) {
  vapply(as.character(x), function(value) {
    paste(strwrap(value, width = width), collapse = "\\n")
  }, character(1))
}
enrich$label <- wrap_label(enrich[[x_col]], width = 30)
enrich$label <- factor(enrich$label, levels = rev(unique(enrich$label)))
group_levels <- unique(as.character(enrich[[group_col]]))
group_colors <- setNames(
  rep(unname(bioanalys_colors), length.out = length(group_levels)),
  group_levels
)
plot <- ggplot(
  enrich,
  aes(x = label, y = .data[[value_col]], fill = .data[[group_col]])
) +
  geom_hline(yintercept = 0, linewidth = 0.35, colour = "grey55") +
  geom_col(position = position_dodge(width = 0.78), width = 0.68,
           colour = "grey20", linewidth = 0.18) +
  scale_fill_manual(values = group_colors) +
  coord_flip() +
  labs(x = NULL, y = value_col, fill = group_col) +
  bioanalys_theme_single() +
  theme(
    legend.position = "right",
    legend.direction = "vertical"
  )
bioanalys_export_ggplot(
  plot, output_file,
  width_mm = width_mm, height_mm = height_mm, dpi = dpi,
  template_id = "fig_l1_groupedbar",
  dims = paste0("data_dimensions=rows=", nrow(enrich), ";columns=", ncol(enrich)),
  stats = "threshold=top_terms<=15;method=enrichment_value_bar"
)
cat("ADAPT_REAL_INPUT_OK groupedbar rows=", nrow(enrich), "\\n", sep = "")
`,
  fig_l1_scatter: `# Real-data model-importance scatter overlay
suppressPackageStartupMessages({library(ggplot2); library(ggrepel)})
hub <- read.delim(input_data, check.names = FALSE)
x_col <- if (is.null(adapt_vars$x_col) || !nzchar(adapt_vars$x_col)) "rf_importance" else adapt_vars$x_col
y_col <- if (is.null(adapt_vars$y_col) || !nzchar(adapt_vars$y_col)) "gbdt_importance" else adapt_vars$y_col
required <- c("gene", x_col, y_col, "p_value", "importance_rank")
if (!all(required %in% names(hub))) stop(paste("scatter input columns missing:", paste(required, collapse = " / ")))
hub[[x_col]] <- as.numeric(hub[[x_col]])
hub[[y_col]] <- as.numeric(hub[[y_col]])
hub$p_value <- as.numeric(hub$p_value)
hub$importance_rank <- as.numeric(hub$importance_rank)
hub <- hub[
  is.finite(hub[[x_col]]) & is.finite(hub[[y_col]]) &
    is.finite(hub$p_value) & is.finite(hub$importance_rank),
  ,
  drop = FALSE
]
if (nrow(hub) < 2) stop("scatter input has insufficient finite rows")
hub$score <- -log10(pmax(as.numeric(hub$p_value), 1e-300))
label_genes <- unique(c(as.character(adapt_vars$label_genes), head(hub$gene[order(hub$importance_rank)], 8)))
labels <- hub[hub$gene %in% label_genes, , drop = FALSE]
labels <- labels[!duplicated(labels$gene), , drop = FALSE]
plot <- ggplot(hub, aes(x = .data[[x_col]], y = .data[[y_col]], colour = score)) +
  geom_point(size = 1.1, alpha = 0.82, stroke = 0) +
  geom_text_repel(
    data = labels, aes(label = gene), size = 6.5 / 2.845276,
    family = "DejaVu Sans",
    min.segment.length = 0, max.overlaps = 30, seed = as.integer(seed_value),
    box.padding = 0.3, point.padding = 0.2, show.legend = FALSE
  ) +
  scale_colour_viridis_c(name = "-log10(P)") +
  labs(x = x_col, y = y_col) +
  bioanalys_theme_single() +
  theme(legend.position = "right")
bioanalys_export_ggplot(
  plot, output_file,
  width_mm = width_mm, height_mm = height_mm, dpi = dpi,
  template_id = "fig_l1_scatter",
  dims = paste0("data_dimensions=rows=", nrow(hub), ";columns=", ncol(hub)),
  stats = "threshold=top_labels<=8;method=importance_correlation_scatter"
)
cat("ADAPT_REAL_INPUT_OK scatter rows=", nrow(hub), "\\n", sep = "")
`,
  fig_l1_boxplot: `# Real-data differential-effect boxplot overlay
suppressPackageStartupMessages({library(ggplot2)})
deg <- read.delim(input_data, check.names = FALSE)
value_col <- if (is.null(adapt_vars$value_col) || !nzchar(adapt_vars$value_col)) "log2FC" else adapt_vars$value_col
required <- c(value_col, "adj_P_Val")
if (!all(required %in% names(deg))) stop(paste("boxplot input columns missing:", paste(required, collapse = " / ")))
deg$value <- as.numeric(deg[[value_col]])
deg <- deg[is.finite(deg$value), , drop = FALSE]
if (!nrow(deg)) stop("boxplot input has no finite values")
deg$padj <- as.numeric(deg[["adj_P_Val"]])
deg$direction <- ifelse(
  is.finite(deg$padj) & deg$padj < 0.05 & deg$value > 0, "Up",
  ifelse(is.finite(deg$padj) & deg$padj < 0.05 & deg$value < 0, "Down", "NS")
)
counts <- table(factor(deg$direction, levels = c("Down", "NS", "Up")))
if (sum(counts) != nrow(deg)) stop("boxplot direction counts do not reconcile")
deg$direction <- factor(
  paste0(deg$direction, "\\nn=", counts[as.character(deg$direction)]),
  levels = paste0(c("Down", "NS", "Up"), "\\nn=", counts[c("Down", "NS", "Up")])
)
plot <- ggplot(deg, aes(x = direction, y = value, fill = direction)) +
  geom_hline(yintercept = 0, linetype = "dashed", linewidth = 0.3, colour = "grey55") +
  geom_boxplot(width = 0.52, outlier.shape = NA, linewidth = 0.35) +
  geom_jitter(width = 0.16, height = 0, size = 0.35, alpha = 0.35, stroke = 0) +
  scale_fill_manual(values = setNames(
    c(bioanalys_colors[["blue"]], "grey75", bioanalys_colors[["vermillion"]]),
    levels(deg$direction)
  ), drop = FALSE) +
  labs(x = NULL, y = value_col) +
  bioanalys_theme_single() +
  theme(legend.position = "none")
bioanalys_export_ggplot(
  plot, output_file,
  width_mm = width_mm, height_mm = height_mm, dpi = dpi,
  template_id = "fig_l1_boxplot",
  dims = paste0("data_dimensions=rows=", nrow(deg), ";categories=", nlevels(deg$direction)),
  stats = "threshold=padj<0.05;direction_sign=nonzero;method=differential_effect_boxplot"
)
cat("ADAPT_REAL_INPUT_OK boxplot rows=", nrow(deg), "\\n", sep = "")
`,
  fig_l1_density: `# Real-data expression density overlay
suppressPackageStartupMessages({library(ggplot2)})
expr <- read.delim(input_data, check.names = FALSE)
if (ncol(expr) < 2 || nrow(expr) < 2) stop("density input has insufficient dimensions")
mat <- as.matrix(expr[, -1, drop = FALSE])
storage.mode(mat) <- "numeric"
values <- as.vector(mat)
expanded_values <- length(values)
keep <- is.finite(values)
values <- values[keep]
if (!length(values)) stop("density input has no finite values")
if (length(values) > 120000) {
  idx <- seq(1, length(values), length.out = 120000)
  values <- values[idx]
}
stopifnot(length(values) > 0L, length(values) <= expanded_values)
density_df <- data.frame(value = values)
plot <- ggplot(density_df, aes(x = value)) +
  geom_density(fill = bioanalys_colors[["blue"]], colour = "grey20",
               linewidth = 0.5, alpha = 0.35, adjust = 1.0) +
  labs(x = "Expression", y = "Density") +
  bioanalys_theme_single()
bioanalys_export_ggplot(
  plot, output_file,
  width_mm = width_mm, height_mm = height_mm, dpi = dpi,
  template_id = "fig_l1_density",
  dims = paste0("data_dimensions=values=", length(values), ";expanded=", expanded_values),
  stats = "threshold=max_values=120000;kernel_adjust=1.0;method=kernel_density"
)
cat("ADAPT_REAL_INPUT_OK density values=", length(values),
    " expanded=", expanded_values, "\\n", sep = "")
`,
  fig_l1_histogram: `# Real-data expression histogram overlay
suppressPackageStartupMessages({library(ggplot2)})
expr <- read.delim(input_data, check.names = FALSE)
if (ncol(expr) < 2 || nrow(expr) < 2) stop("histogram input has insufficient dimensions")
mat <- as.matrix(expr[, -1, drop = FALSE])
storage.mode(mat) <- "numeric"
values <- as.vector(mat)
expanded_values <- length(values)
values <- values[is.finite(values)]
if (!length(values)) stop("histogram input has no finite values")
if (length(values) > 120000) values <- values[seq(1, length(values), length.out = 120000)]
bins <- 60L
stopifnot(length(values) > 0L, length(values) <= expanded_values, bins == 60L)
hist_df <- data.frame(value = values)
plot <- ggplot(hist_df, aes(x = value)) +
  geom_histogram(bins = bins, fill = bioanalys_colors[["blue"]],
                 colour = "white", linewidth = 0.15) +
  labs(x = "Expression", y = "Count") +
  bioanalys_theme_single()
bioanalys_export_ggplot(
  plot, output_file,
  width_mm = width_mm, height_mm = height_mm, dpi = dpi,
  template_id = "fig_l1_histogram",
  dims = paste0("data_dimensions=values=", length(values), ";expanded=", expanded_values, ";bins=", bins),
  stats = "threshold=max_values=120000;method=frequency_histogram"
)
cat("ADAPT_REAL_INPUT_OK histogram values=", length(values),
    " expanded=", expanded_values, " bins=", bins, "\\n", sep = "")
`,
  fig_l1_violin: `# Real-data differential-effect violin overlay
suppressPackageStartupMessages({library(ggplot2)})
deg <- read.delim(input_data, check.names = FALSE)
value_col <- if (is.null(adapt_vars$value_col) || !nzchar(adapt_vars$value_col)) "log2FC" else adapt_vars$value_col
required <- c(value_col, "adj_P_Val")
if (!all(required %in% names(deg))) stop(paste("violin input columns missing:", paste(required, collapse = " / ")))
deg$value <- as.numeric(deg[[value_col]])
deg <- deg[is.finite(deg$value), , drop = FALSE]
if (!nrow(deg)) stop("violin input has no finite values")
deg$padj <- as.numeric(deg[["adj_P_Val"]])
deg$direction <- ifelse(
  is.finite(deg$padj) & deg$padj < 0.05 & deg$value > 0, "Up",
  ifelse(is.finite(deg$padj) & deg$padj < 0.05 & deg$value < 0, "Down", "NS")
)
counts <- table(factor(deg$direction, levels = c("Down", "NS", "Up")))
if (sum(counts) != nrow(deg)) stop("violin direction counts do not reconcile")
deg$axis_label <- factor(
  paste0(deg$direction, "\\nn=", counts[as.character(deg$direction)]),
  levels = paste0(c("Down", "NS", "Up"), "\\nn=", counts[c("Down", "NS", "Up")])
)
plot <- ggplot(deg, aes(x = axis_label, y = value, fill = axis_label)) +
  geom_hline(yintercept = 0, linetype = "dashed", linewidth = 0.3, colour = "grey55") +
  geom_violin(width = 0.72, scale = "width", linewidth = 0.3, trim = TRUE) +
  geom_boxplot(width = 0.10, outlier.shape = NA, linewidth = 0.25, fill = "white") +
  geom_jitter(width = 0.08, height = 0, size = 0.22, alpha = 0.22, stroke = 0) +
  scale_fill_manual(values = setNames(
    c(bioanalys_colors[["blue"]], "grey75", bioanalys_colors[["vermillion"]]),
    levels(deg$axis_label)
  ), drop = FALSE) +
  labs(x = NULL, y = value_col) +
  bioanalys_theme_single() +
  theme(legend.position = "none")
bioanalys_export_ggplot(
  plot, output_file,
  width_mm = width_mm, height_mm = height_mm, dpi = dpi,
  template_id = "fig_l1_violin",
  dims = paste0("data_dimensions=rows=", nrow(deg), ";categories=", nlevels(deg$axis_label)),
  stats = "threshold=padj<0.05;direction_sign=nonzero;method=differential_effect_violin"
)
cat("ADAPT_REAL_INPUT_OK violin rows=", nrow(deg), "\\n", sep = "")
`,
  fig_l3_sankey: `# Real-data WGCNA module flow overlay
modules <- read.delim(input_data, check.names = FALSE)
module_col <- if (is.null(adapt_vars$module_col) || !nzchar(adapt_vars$module_col)) "module" else adapt_vars$module_col
if (!all(c("gene", module_col) %in% names(modules))) stop(paste("sankey input columns missing:", module_col, "gene"))
flow <- aggregate(list(count = rep(1, nrow(modules))), by = list(module = modules[[module_col]]), FUN = sum)
flow <- flow[order(flow$count, decreasing = TRUE), , drop = FALSE]
flow <- head(flow, min(10, nrow(flow)))
flow$left_y <- rev(seq(0.12, 0.88, length.out = nrow(flow)))
flow$right_y <- seq(0.12, 0.88, length.out = nrow(flow))
flow$width <- flow$count / max(flow$count) * 0.08
draw_flow <- function() {
  graphics::par(mar = c(2.5, 2.5, 2.0, 2.0), family = "DejaVu Sans", cex.axis = 0.58, cex.lab = 0.58)
  graphics::plot.new()
  graphics::plot.window(xlim = c(0, 1), ylim = c(0, 1))
  graphics::segments(
    0.20, flow$left_y, 0.80, flow$right_y,
    col = grDevices::adjustcolor(bioanalys_colors[["sky"]], alpha.f = 0.32),
    lwd = pmax(0.75, flow$count / max(flow$count) * 10)
  )
  graphics::rect(0.12, flow$left_y - flow$width, 0.20, flow$left_y + flow$width,
                 col = bioanalys_colors[["blue"]], border = NA)
  graphics::rect(0.80, flow$right_y - flow$width, 0.88, flow$right_y + flow$width,
                 col = bioanalys_colors[["vermillion"]], border = NA)
  graphics::text(0.19, flow$left_y, flow$module, adj = c(1, 0.5), cex = 0.58)
  graphics::text(0.81, flow$right_y, paste0("n=", flow$count), adj = c(0, 0.5), cex = 0.58)
  graphics::mtext("WGCNA module", side = 1, line = 1.2, cex = 0.58)
  graphics::mtext("Gene count", side = 2, line = 1.2, cex = 0.58)
}
bioanalys_export_device(
  draw_flow, output_file,
  width_mm = width_mm, height_mm = height_mm, dpi = dpi,
  template_id = "fig_l3_sankey",
  dims = paste0("data_dimensions=rows=", nrow(flow), ";categories=", nrow(flow)),
  stats = "threshold=max_modules=10;method=wgcna_module_flow"
)
cat("ADAPT_REAL_INPUT_OK sankey modules=", nrow(flow), "\\n", sep = "")
`,
};

function pythonUmapOverlay(templateId) {
  return `# Real-data spatial UMAP overlay
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
  fig, output_file, dpi=dpi, template_id="${templateId}",
  dims=f"data_dimensions=cells={adata.n_obs};categories={len(labels)}",
  stats="threshold=raster_cells>5000;method=UMAP_scatter",
)
plt.close(fig)
print(f"ADAPT_REAL_INPUT_OK umap cells={adata.n_obs} groups={len(labels)}")
`;
}

const PYTHON_OVERLAYS = {
  fig_l2p_dotplot: `# Real-data target localization dot plot overlay
loc = pd.read_csv(input_data, sep = "\\t")
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
`,
  fig_l2p_volcano: `# Real-data cell-type differential-expression volcano overlay
deg = pd.read_csv(input_data, sep = "\\t")
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
`,
  fig_l2p_umap: pythonUmapOverlay('fig_l2p_umap'),
  fig_l2p_violin: `# Real-data cell-composition violin overlay
comp = pd.read_csv(input_data, sep = "\\t")
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
`,
};

// The line2 registry entry uses the same verified Python UMAP renderer at the
// double-column physical size required by its own reference figure.
PYTHON_OVERLAYS.fig_l2_umap = pythonUmapOverlay('fig_l2_umap');

export function buildAdaptedFigureSource({
  template,
  masterSource,
  inputPath,
  projectId,
  lineId,
  adaptVars = {},
  legendPositionOverride,
}) {
  if (!template || !SUPPORTED_TEMPLATE_IDS.has(template.id)) {
    throw new Error(`未知 ready 图模板: ${template?.id || 'missing'}`);
  }
  if (typeof masterSource !== 'string' || !masterSource) {
    throw new Error('masterSource 缺失');
  }
  if (!['r', 'python'].includes(template.language)) {
    throw new Error(`模板语言非法: ${template.language}`);
  }
  const canonicalOutput = validateCanonicalOutput(template.canonical_output);
  const normalizedInput = normalizeRelativePath(inputPath, 'inputPath');
  validateBoundaries({ projectId, lineId, inputPath: normalizedInput, template });
  const declaredInput = normalizeRelativePath(adaptVars.input_data, 'adaptVars.input_data');
  validateBoundaries({ projectId, lineId, inputPath: declaredInput, template });
  if (declaredInput !== normalizedInput) {
    throw new Error('inputPath 与 adaptVars.input_data 不一致');
  }

  const remoteInput = resolveRemoteInput(normalizedInput, projectId, lineId);
  let resolvedTemplate = template;
  if (legendPositionOverride !== undefined && legendPositionOverride !== null) {
    if (typeof legendPositionOverride !== 'string'
      || !LEGEND_POSITIONS.has(legendPositionOverride)) {
      throw new Error(`legend_position 非法: ${legendPositionOverride}`);
    }
    resolvedTemplate = {
      ...template,
      figure_layout: {
        ...template.figure_layout,
        legend_position: legendPositionOverride,
      },
    };
  }
  const commentLines = [
    figureContractComment(resolvedTemplate),
    `# Master-Source: ${String(template.source || '').replace(/\\/g, '/')} | Master-SHA256: ${template.source_sha256 || ''}`,
    `# Catalog-ID: ${template.catalog_id ?? 'missing'} | Catalog-Language: ${template.catalog_language ?? 'missing'} | Source-Match: ${template.source_match ?? 'missing'}`,
    `# Adapted-Project: ${projectId}`,
    `# Adapted-Line: ${lineId}`,
    ...Object.entries(template.adapt_vars || {}).map(
      ([key, description]) => `# Adapt-Variable ${key}: ${description}`,
    ),
  ];
  const prelude = template.language === 'r'
    ? rPrelude({
        ...resolvedTemplate,
        canonical_output: canonicalOutput,
        lineId,
      }, normalizedInput, remoteInput, lineId)
    : pythonPrelude({
        ...resolvedTemplate,
        canonical_output: canonicalOutput,
        lineId,
      }, normalizedInput, remoteInput, lineId);
  const overlay = template.language === 'r'
    ? R_OVERLAYS[template.id]
    : PYTHON_OVERLAYS[template.id];
  const realRunExit = template.language === 'r'
    ? 'quit(status = 0)'
    : 'raise SystemExit(0)';
  return [
    ...commentLines,
    renderAdaptDeclaration(template, adaptVars),
    prelude,
    overlay,
    realRunExit,
    renderMasterAuditBlock(template, masterSource.replace(/\r\n/g, '\n')),
  ].join('\n').replace(/\r\n/g, '\n');
}
