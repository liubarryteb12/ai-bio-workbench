import path from 'node:path';

const LINES = ['line1_bulk', 'line2_scrna', 'line3_spatial'];
const REMOTE_PROJECTS_ROOT = '/mnt/ssd/bio_data/projects';

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
  'fig_l3_multipanel',
  'fig_l2p_violin',
  'fig_l3_sankey',
  'fig_l2p_scatterplot',
  'fig_l2p_barplot',
  'fig_l2p_heatmap',
  'fig_l2p_boxplot',
  'fig_l1_ridgeline',
  'fig_l1_upsetplot',
  'fig_l1_vennplot',
  'fig_l2p_gseaplot',
  'fig_l2p_enrichmentplot',
  'fig_l2_networkplot',
  'fig_l1_correlogram',
  'fig_l1_bubble',
  'fig_l3_chorddiagram',
  'fig_l1_connectedscatter',
]);

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
    || normalized.split('/').includes('..') || !/^[A-Za-z0-9._/-]+$/.test(normalized)) {
    throw new Error(`canonical_output 非法: ${value}`);
  }
  return normalized;
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

function rPrelude(template, inputPath, remoteInput) {
  return `# Real-Data-Adapter: v1
# Project-Input: ${inputPath}
seed_value <- Sys.getenv("BIOANALYS_SEED", unset = "")
if (nchar(seed_value) == 0) quit(status = 3)
set.seed(as.integer(seed_value))
input_data <- "${remoteInput}"
output_file <- "${template.canonical_output}"
if (!file.exists(input_data)) stop(paste("real input missing:", input_data))
dir.create(dirname(output_file), recursive = TRUE, showWarnings = FALSE)
`;
}

function pythonPrelude(template, inputPath, remoteInput) {
  return `# Real-Data-Adapter: v1
# Project-Input: ${inputPath}
import os
from pathlib import Path
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import networkx as nx
# 别名必须避开 pathlib.Path：prelude 用 Path(input_data).exists() 做输入存在性检查，
# 直接 import Path 会被 matplotlib 的 Path 覆盖，导致把文件路径当贝塞尔控制点解析
# （实测报 ValueError: could not convert string to float）。
from matplotlib.path import Path as MplPath
import matplotlib.patches as patches

seed_value = os.environ.get("BIOANALYS_SEED", "")
if not seed_value:
    raise SystemExit(3)
seed = int(seed_value)
np.random.seed(seed)
input_data = "${remoteInput}"
output_file = "${template.canonical_output}"
if not Path(input_data).exists():
    raise FileNotFoundError(f"real input missing: {input_data}")
Path(output_file).parent.mkdir(parents=True, exist_ok=True)
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
pca_plot <- ggplot(pca_df, aes(x = PC1, y = PC2, colour = .data[[group_name]])) +
  geom_point(size = 1.8, alpha = 0.9) +
  labs(colour = group_name, x = "PC1", y = "PC2") +
  theme_classic(base_size = 8)
if (length(group_sizes) > 1 && all(group_sizes >= 3)) {
  pca_plot <- pca_plot + stat_ellipse(linewidth = 0.45, level = 0.95)
}
ggsave(output_file, pca_plot, width = 89, height = 80, units = "mm", dpi = 300,
       device = png, type = "cairo", bg = "white")
cat("ADAPT_REAL_INPUT_OK pca rows=", nrow(pca_df), "\n", sep = "")
`,
  fig_l2_heatmap: `# Real-data expression heatmap overlay
suppressPackageStartupMessages({library(ComplexHeatmap); library(viridis); library(circlize)})
expr_df <- read.delim(input_data, check.names = FALSE)
if (ncol(expr_df) < 3 || nrow(expr_df) < 2) stop("heatmap input has insufficient dimensions")
expr_matrix <- as.matrix(expr_df[, -1, drop = FALSE])
rownames(expr_matrix) <- make.unique(as.character(expr_df[[1]]))
storage.mode(expr_matrix) <- "numeric"
if (anyNA(expr_matrix)) stop("heatmap input contains non-numeric or missing values")
var_top <- order(apply(expr_matrix, 1, var), decreasing = TRUE)
expr_matrix <- expr_matrix[head(var_top, min(50, length(var_top))), , drop = FALSE]
expr_z <- t(scale(t(expr_matrix)))
expr_z[!is.finite(expr_z)] <- 0
heat <- Heatmap(
  expr_z,
  name = "Z-score",
  col = viridis(100),
  cluster_rows = TRUE,
  cluster_columns = ncol(expr_z) >= 3,
  show_row_names = nrow(expr_z) <= 40,
  row_title = NULL,
  column_title = NULL,
  heatmap_legend_param = list(title = "Z-score")
)
png(output_file, width = 183, height = 120, units = "mm", res = 300, type = "cairo")
draw(heat)
dev.off()
cat("ADAPT_REAL_INPUT_OK heatmap genes=", nrow(expr_z), " samples=", ncol(expr_z), "\n", sep = "")
`,
  fig_l2_volcano: `
# Real-data differential-expression volcano overlay
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
as_cutoff <- function(value, fallback) {
  if (is.null(value)) return(fallback)
  num <- suppressWarnings(as.numeric(value))
  if (!length(num) || !is.finite(num) || num <= 0) return(fallback)
  num
}
# 阈值与判据口径都来自需求单：project.json 的 analysis_cutoffs 是唯一真源，
# adapt_vars 里的两个 cutoff 是兜底（门户未绑定项目时用）。
use_adj_p <- TRUE
project_json <- Sys.getenv("BIOANALYS_PROJECT_JSON")
if (nzchar(project_json) && requireNamespace("jsonlite", quietly = TRUE)) {
  cutoff_meta <- tryCatch(
    jsonlite::fromJSON(project_json, simplifyVector = FALSE)$analysis_cutoffs,
    error = function(e) NULL)
  if (is.list(cutoff_meta)) {
    use_adj_p <- isTRUE(cutoff_meta$use_adj_p)
    if (!is.null(cutoff_meta$log2fc_threshold)) adapt_vars$log2fc_cutoff <- cutoff_meta$log2fc_threshold
    if (use_adj_p && !is.null(cutoff_meta$adj_p_threshold)) adapt_vars$padj_cutoff <- cutoff_meta$adj_p_threshold
    if (!use_adj_p && !is.null(cutoff_meta$p_threshold)) adapt_vars$padj_cutoff <- cutoff_meta$p_threshold
  }
}
fc_cut <- as_cutoff(adapt_vars$log2fc_cutoff, 1)
p_cut <- as_cutoff(adapt_vars$padj_cutoff, 0.05)
p_label <- if (use_adj_p) "adj p" else "p"
volcano_df <- data.frame(
  gene = as.character(deg_df[[gene_col]]),
  log2fc = as.numeric(deg_df[[fc_col]]),
  pvalue = as.numeric(deg_df[[p_col]]),
  padj = as.numeric(deg_df[[padj_col]])
)
volcano_df$p_use <- if (use_adj_p) volcano_df$padj else volcano_df$pvalue
volcano_df <- volcano_df[is.finite(volcano_df$log2fc) & is.finite(volcano_df$p_use) &
                           volcano_df$p_use > 0 & volcano_df$p_use <= 1, ]
volcano_df$sig <- ifelse(volcano_df$p_use < p_cut & volcano_df$log2fc > fc_cut, "Up",
                  ifelse(volcano_df$p_use < p_cut & volcano_df$log2fc < -fc_cut, "Down", "NS"))
volcano_df$sig <- factor(volcano_df$sig, levels = c("Up", "NS", "Down"))
sig_counts <- table(volcano_df$sig)
legend_labels <- c(
  Up = sprintf("Up (n=%d)", as.integer(sig_counts[["Up"]])),
  NS = sprintf("NS (n=%d)", as.integer(sig_counts[["NS"]])),
  Down = sprintf("Down (n=%d)", as.integer(sig_counts[["Down"]]))
)
sig_only <- volcano_df[volcano_df$sig != "NS", , drop = FALSE]
ranked <- head(sig_only$gene[order(sig_only$p_use, -abs(sig_only$log2fc))], 6)
label_pool <- unique(c(as.character(adapt_vars$label_genes), ranked))
label_pool <- label_pool[label_pool %in% volcano_df$gene]
label_df <- volcano_df[volcano_df$gene %in% label_pool, , drop = FALSE]
label_df <- label_df[!duplicated(label_df$gene), , drop = FALSE]
y_max <- max(-log10(volcano_df$p_use), na.rm = TRUE)
n_sig <- as.integer(sig_counts[["Up"]]) + as.integer(sig_counts[["Down"]])
volcano <- ggplot(volcano_df, aes(x = log2fc, y = -log10(p_use), colour = sig)) +
  geom_point(size = 0.8, alpha = 0.72) +
  scale_colour_manual(values = c(Up = "#EE0000", NS = "#BEBEBE", Down = "#3B4992"),
                      labels = legend_labels, drop = FALSE) +
  guides(colour = guide_legend(override.aes = list(size = 2.4, alpha = 1))) +
  scale_y_continuous(expand = expansion(mult = c(0.02, 0.20))) +
  geom_vline(xintercept = c(-fc_cut, fc_cut), linetype = "dashed", linewidth = 0.35, colour = "grey35") +
  geom_hline(yintercept = -log10(p_cut), linetype = "dashed", linewidth = 0.35, colour = "grey35") +
  annotate("text", x = -Inf, y = -log10(p_cut), label = sprintf("%s=%g", p_label, p_cut),
           hjust = -0.04, vjust = -0.5, size = 2.8, colour = "grey20") +
  annotate("text", x = fc_cut, y = y_max * 1.10, label = sprintf("log2FC=%g", fc_cut),
           angle = 90, hjust = 1, vjust = 1, size = 2.8, colour = "grey20") +
  annotate("text", x = -fc_cut, y = y_max * 1.10, label = sprintf("log2FC=-%g", fc_cut),
           angle = 90, hjust = 1, vjust = 1, size = 2.8, colour = "grey20") +
  geom_text_repel(data = label_df, aes(label = gene), size = 2.8, max.overlaps = 30,
                  seed = 42, min.segment.length = 0.2,
                  nudge_x = ifelse(label_df$sig == "Up", 2.1, -2.1), nudge_y = 0.8,
                  direction = "both") +
  labs(x = "log2(Fold Change)",
       y = if (use_adj_p) "-log10(adjusted P)" else "-log10(P)",
       colour = NULL,
       caption = paste(
         "adapted volcano, real DEG table",
         sprintf("threshold |log2FC|>%g & %s<%g", fc_cut, p_label, p_cut),
         sprintf("%d genes, %d significant", nrow(volcano_df), n_sig),
         "red = up, blue = down, grey = NS", sep = "\\n")) +
  theme_classic(base_size = 8) +
  theme(legend.position = "right",
        legend.text = element_text(size = 8),
        legend.key.size = unit(3.2, "mm"),
        plot.caption.position = "plot",
        plot.caption = element_text(hjust = 0, size = 8))
ggsave(output_file, volcano, width = 89, height = 75, units = "mm", dpi = 300,
       device = png, type = "cairo", bg = "white")
cat("ADAPT_REAL_INPUT_OK volcano rows=", nrow(volcano_df),
    " up=", as.integer(sig_counts[["Up"]]), " down=", as.integer(sig_counts[["Down"]]), "\n", sep = "")
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
enrich$direction <- ifelse(enrich[[value_col]] >= 0, "Activated", "Suppressed")
enrich[[x_col]] <- factor(enrich[[x_col]], levels = rev(unique(enrich[[x_col]])))
plot <- ggplot(enrich, aes(x = .data[[x_col]], y = .data[[value_col]], fill = direction)) +
  geom_col(width = 0.72, colour = "grey25", linewidth = 0.2) +
  scale_fill_manual(values = c(Activated = "#D55E00", Suppressed = "#0072B2")) +
  coord_flip() +
  facet_wrap(stats::as.formula(paste("~", group_col)), scales = "free_y") +
  labs(x = NULL, y = value_col, fill = NULL) +
  theme_classic(base_size = 7) +
  theme(legend.position = "top", strip.text = element_text(size = 6))
ggsave(output_file, plot, width = 183, height = 120, units = "mm", dpi = 300,
       device = png, type = "cairo", bg = "white")
cat("ADAPT_REAL_INPUT_OK groupedbar rows=", nrow(enrich), "\n", sep = "")
`,
  fig_l1_scatter: `# Real-data model-importance scatter overlay
suppressPackageStartupMessages({library(ggplot2)})
hub <- read.delim(input_data, check.names = FALSE)
x_col <- if (is.null(adapt_vars$x_col) || !nzchar(adapt_vars$x_col)) "rf_importance" else adapt_vars$x_col
y_col <- if (is.null(adapt_vars$y_col) || !nzchar(adapt_vars$y_col)) "gbdt_importance" else adapt_vars$y_col
required <- c("gene", x_col, y_col)
if (!all(required %in% names(hub))) stop(paste("scatter input columns missing:", paste(required, collapse = " / ")))
hub[[x_col]] <- as.numeric(hub[[x_col]])
hub[[y_col]] <- as.numeric(hub[[y_col]])
hub <- hub[is.finite(hub[[x_col]]) & is.finite(hub[[y_col]]), , drop = FALSE]
hub$score <- -log10(pmax(as.numeric(hub$p_value), 1e-300))
label_genes <- unique(c(as.character(adapt_vars$label_genes), head(hub$gene[order(hub$importance_rank)], 8)))
labels <- hub[hub$gene %in% label_genes, , drop = FALSE]
labels <- labels[!duplicated(labels$gene), , drop = FALSE]
plot <- ggplot(hub, aes(x = .data[[x_col]], y = .data[[y_col]], colour = score)) +
  geom_point(size = 1.15, alpha = 0.82) +
  geom_text(data = labels, aes(label = gene), size = 2, check_overlap = TRUE, show.legend = FALSE) +
  scale_colour_viridis_c(name = "-log10(P)") +
  labs(x = x_col, y = y_col) +
  theme_classic(base_size = 7)
ggsave(output_file, plot, width = 89, height = 75, units = "mm", dpi = 300,
       device = png, type = "cairo", bg = "white")
cat("ADAPT_REAL_INPUT_OK scatter rows=", nrow(hub), "\n", sep = "")
`,
  fig_l1_boxplot: `# Real-data differential-effect boxplot overlay
suppressPackageStartupMessages({library(ggplot2)})
deg <- read.delim(input_data, check.names = FALSE)
value_col <- if (is.null(adapt_vars$value_col) || !nzchar(adapt_vars$value_col)) "log2FC" else adapt_vars$value_col
required <- c(value_col, "adj_P_Val")
if (!all(required %in% names(deg))) stop(paste("boxplot input columns missing:", paste(required, collapse = " / ")))
deg$value <- as.numeric(deg[[value_col]])
deg$direction <- ifelse(deg$adj_P_Val < 0.05 & deg$value > 0, "Up",
                 ifelse(deg$adj_P_Val < 0.05 & deg$value < 0, "Down", "NS"))
deg <- deg[is.finite(deg$value), , drop = FALSE]
plot <- ggplot(deg, aes(x = direction, y = value, fill = direction)) +
  geom_hline(yintercept = 0, linetype = "dashed", linewidth = 0.3, colour = "grey55") +
  geom_boxplot(width = 0.55, outlier.size = 0.35, linewidth = 0.35) +
  scale_fill_manual(values = c(Up = "#D55E00", Down = "#0072B2", NS = "grey75")) +
  labs(x = NULL, y = value_col) +
  theme_classic(base_size = 7) +
  theme(legend.position = "none")
ggsave(output_file, plot, width = 89, height = 60, units = "mm", dpi = 300,
       device = png, type = "cairo", bg = "white")
cat("ADAPT_REAL_INPUT_OK boxplot rows=", nrow(deg), "\n", sep = "")
`,
  fig_l1_density: `# Real-data expression density overlay
suppressPackageStartupMessages({library(ggplot2)})
expr <- read.delim(input_data, check.names = FALSE)
if (ncol(expr) < 2 || nrow(expr) < 2) stop("density input has insufficient dimensions")
mat <- as.matrix(expr[, -1, drop = FALSE])
storage.mode(mat) <- "numeric"
values <- as.vector(mat)
sample_names <- rep(colnames(mat), each = nrow(mat))
keep <- is.finite(values)
values <- values[keep]
sample_names <- sample_names[keep]
if (length(values) > 120000) {
  idx <- seq(1, length(values), length.out = 120000)
  values <- values[idx]
  sample_names <- sample_names[idx]
}
density_df <- data.frame(sample = sample_names, value = values)
plot <- ggplot(density_df, aes(x = value, colour = sample)) +
  geom_density(linewidth = 0.35) +
  labs(x = "expression", y = "density", colour = NULL) +
  theme_classic(base_size = 7) +
  theme(legend.position = "right", legend.text = element_text(size = 5))
ggsave(output_file, plot, width = 120, height = 80, units = "mm", dpi = 300,
       device = png, type = "cairo", bg = "white")
cat("ADAPT_REAL_INPUT_OK density values=", length(values), "\n", sep = "")
`,
  fig_l1_histogram: `# Real-data expression histogram overlay
suppressPackageStartupMessages({library(ggplot2)})
expr <- read.delim(input_data, check.names = FALSE)
if (ncol(expr) < 2 || nrow(expr) < 2) stop("histogram input has insufficient dimensions")
mat <- as.matrix(expr[, -1, drop = FALSE])
storage.mode(mat) <- "numeric"
values <- as.vector(mat)
values <- values[is.finite(values)]
if (length(values) > 120000) values <- values[seq(1, length(values), length.out = 120000)]
hist_df <- data.frame(value = values)
plot <- ggplot(hist_df, aes(x = value)) +
  geom_histogram(bins = 60, fill = "#0072B2", colour = "white", linewidth = 0.15) +
  labs(x = "expression", y = "count") +
  theme_classic(base_size = 7)
ggsave(output_file, plot, width = 89, height = 60, units = "mm", dpi = 300,
       device = png, type = "cairo", bg = "white")
cat("ADAPT_REAL_INPUT_OK histogram values=", length(values), "\n", sep = "")
`,
  fig_l1_violin: `# Real-data differential-effect violin overlay
suppressPackageStartupMessages({library(ggplot2)})
deg <- read.delim(input_data, check.names = FALSE)
value_col <- if (is.null(adapt_vars$value_col) || !nzchar(adapt_vars$value_col)) "log2FC" else adapt_vars$value_col
required <- c(value_col, "adj_P_Val")
if (!all(required %in% names(deg))) stop(paste("violin input columns missing:", paste(required, collapse = " / ")))
deg$value <- as.numeric(deg[[value_col]])
deg$direction <- ifelse(deg$adj_P_Val < 0.05 & deg$value > 0, "Up",
                 ifelse(deg$adj_P_Val < 0.05 & deg$value < 0, "Down", "NS"))
deg <- deg[is.finite(deg$value), , drop = FALSE]
plot <- ggplot(deg, aes(x = direction, y = value, fill = direction)) +
  geom_hline(yintercept = 0, linetype = "dashed", linewidth = 0.3, colour = "grey55") +
  geom_violin(width = 0.75, scale = "width", linewidth = 0.3) +
  geom_boxplot(width = 0.12, outlier.shape = NA, linewidth = 0.25, fill = "white") +
  scale_fill_manual(values = c(Up = "#D55E00", Down = "#0072B2", NS = "grey75")) +
  labs(x = NULL, y = value_col) +
  theme_classic(base_size = 7) +
  theme(legend.position = "none")
ggsave(output_file, plot, width = 89, height = 60, units = "mm", dpi = 300,
       device = png, type = "cairo", bg = "white")
cat("ADAPT_REAL_INPUT_OK violin rows=", nrow(deg), "\n", sep = "")
`,
  fig_l3_multipanel: `# Real-data external-validation multi-panel overlay
suppressPackageStartupMessages({library(ggplot2); library(patchwork)})
pred <- read.delim(input_data, check.names = FALSE)
required <- c("true", "pred", "prob_LS")
if (!all(required %in% names(pred))) stop(paste("multipanel input columns missing:", paste(required, collapse = " / ")))
pred$true <- factor(pred$true)
pred$pred <- factor(pred$pred)
pred$prob_LS <- as.numeric(pred$prob_LS)
pred$truth_num <- as.numeric(as.character(pred$true))
pred <- pred[is.finite(pred$prob_LS), , drop = FALSE]
panel_a <- ggplot(pred, aes(x = true, y = prob_LS, fill = true)) +
  geom_boxplot(width = 0.55, outlier.size = 0.4) +
  labs(title = "A Risk by truth", x = "truth", y = "risk") +
  theme_classic(base_size = 7) + theme(legend.position = "none")
panel_b <- ggplot(pred, aes(x = true, y = pred)) +
  geom_jitter(width = 0.2, height = 0.12, size = 0.8, alpha = 0.7) +
  labs(title = "B Prediction", x = "truth", y = "pred") +
  theme_classic(base_size = 7)
pred$risk_bin <- cut(pred$prob_LS, breaks = seq(0, 1, by = 0.2), include.lowest = TRUE)
cal <- aggregate(cbind(prob_LS, truth_num) ~ risk_bin, data = pred, FUN = mean)
panel_c <- ggplot(cal, aes(x = prob_LS, y = truth_num)) +
  geom_abline(linetype = "dashed", linewidth = 0.3, colour = "grey55") +
  geom_point(size = 1.2, colour = "#0072B2") +
  labs(title = "C Calibration", x = "mean risk", y = "observed") +
  theme_classic(base_size = 7)
pred$rank <- rank(-pred$prob_LS, ties.method = "first")
panel_d <- ggplot(pred, aes(x = rank, y = prob_LS, colour = true)) +
  geom_point(size = 0.9, alpha = 0.8) +
  labs(title = "D Ranked risk", x = "sample rank", y = "risk") +
  theme_classic(base_size = 7) + theme(legend.position = "top")
figure <- (panel_a | panel_b) / (panel_c | panel_d)
ggsave(output_file, figure, width = 183, height = 120, units = "mm", dpi = 300,
       device = png, type = "cairo", bg = "white")
cat("ADAPT_REAL_INPUT_OK multipanel rows=", nrow(pred), "\n", sep = "")
`,
  fig_l3_sankey: `
# Real-data WGCNA module flow overlay (ggalluvial alluvial: module -> module size tertile, ribbon width = real gene count)
suppressPackageStartupMessages({library(ggplot2); library(ggalluvial)})
modules <- read.delim(input_data, check.names = FALSE)
module_col <- if (is.null(adapt_vars$module_col) || !nzchar(adapt_vars$module_col)) "module" else adapt_vars$module_col
if (!all(c("gene", module_col) %in% names(modules))) stop(paste("sankey input columns missing:", module_col, "gene"))
modules$gene <- as.character(modules$gene)
modules$module <- as.character(modules[[module_col]])
modules <- modules[!is.na(modules$gene) & nzchar(modules$gene), , drop = FALSE]
modules$module[is.na(modules$module) | !nzchar(modules$module)] <- "grey"
mod_counts <- sort(table(modules$module), decreasing = TRUE)
top_n <- if (is.null(adapt_vars$top_modules)) 10 else max(3, as.integer(adapt_vars$top_modules))
top_modules <- names(mod_counts)[seq_len(min(top_n, length(mod_counts)))]
flow <- modules[modules$module %in% top_modules, c("gene", "module"), drop = FALSE]
if (!nrow(flow)) stop("sankey input has no genes assigned to modules")
flow$module <- factor(flow$module, levels = top_modules)
# 第二轴按真实模块规模的三分位分层（数据驱动，不写死阈值）
kept_counts <- as.integer(mod_counts[top_modules])
cuts <- unique(quantile(kept_counts, probs = c(1/3, 2/3), na.rm = TRUE))
size_rank <- function(n) {
  if (length(cuts) >= 2) {
    if (n > cuts[[2]]) return("Large")
    if (n > cuts[[1]]) return("Medium")
    return("Small")
  }
  if (length(cuts) == 1) { if (n >= cuts[[1]]) "Large" else "Small" } else "All"
}
flow$size_band <- factor(
  vapply(as.integer(mod_counts[as.character(flow$module)]), size_rank, character(1)),
  levels = c("Large", "Medium", "Small", "All")
)
flow <- flow[!is.na(flow$size_band), , drop = FALSE]
flow$axis_module <- factor(as.character(flow$module), levels = top_modules)
counts_df <- data.frame(module = top_modules, n = kept_counts, stringsAsFactors = FALSE)
# WGCNA 模块名本身即颜色名，画布若认识就直接用，否则回落 viridis；
# 图例出轴框（规范 三之二），标签带真实基因数，读者不必回查表格
module_labels <- setNames(
  sprintf("%s (%d)", counts_df$module, counts_df$n), counts_df$module)
module_fills <- top_modules
known_colours <- !inherits(tryCatch(grDevices::col2rgb(module_fills), error = function(e) e), "try-error")
legend_scale <- scale_fill_viridis_d(labels = module_labels, name = "WGCNA module",
                                     guide = guide_legend(ncol = 1))
if (known_colours) {
  fill_values <- setNames(vapply(module_fills, function(m) {
    rgb <- grDevices::col2rgb(m)
    grDevices::rgb(rgb[1], rgb[2], rgb[3], maxColorValue = 255)
  }, character(1)), module_fills)
  legend_scale <- scale_fill_manual(values = fill_values, labels = module_labels,
                                    name = "WGCNA module", guide = guide_legend(ncol = 1))
}
sankey <- ggplot(flow, aes(axis1 = axis_module, axis2 = size_band, y = 1)) +
  geom_alluvium(aes(fill = axis_module), width = 0.16, alpha = 0.78, knot.pos = 0.35) +
  geom_stratum(width = 0.16, fill = "grey93", colour = "grey45", linewidth = 0.2) +
  geom_text(stat = "stratum", aes(label = after_stat(stratum)), size = 2.4, check_overlap = TRUE) +
  scale_x_discrete(limits = c("WGCNA module", "Size band"), expand = c(0.04, 0.04)) +
  scale_y_continuous(expand = expansion(mult = c(0.03, 0.03))) +
  coord_cartesian(clip = "off") +
  legend_scale +
  labs(y = "Genes",
       caption = paste(
         "adapted sankey, real WGCNA modules",
         sprintf("top %d of %d modules, %d of %d genes", nrow(counts_df), length(mod_counts), nrow(flow), sum(mod_counts)),
         "ribbon width = real gene count",
         "right axis = module size tertile", sep = "\\n")) +
  theme_classic(base_size = 8) +
  theme(axis.text.x = element_text(size = 8),
        axis.text.y = element_blank(),
        axis.ticks.y = element_blank(),
        axis.line.y = element_blank(),
        axis.title.x = element_blank(),
        legend.position = "right",
        legend.text = element_text(size = 8),
        legend.key.size = unit(3.2, "mm"),
        legend.title = element_text(size = 8),
        plot.caption.position = "plot",
        plot.caption = element_text(hjust = 0, size = 8))
ggsave(output_file, sankey, width = 183, height = 112, units = "mm", dpi = 300,
       device = png, type = "cairo", bg = "white")
cat("ADAPT_REAL_INPUT_OK sankey modules=", nrow(counts_df), " genes=", nrow(flow),
    " bands=", nlevels(droplevels(flow$size_band)), "\n", sep = "")
`,};

R_OVERLAYS.fig_l1_bubble = `# Real-data DEG multi-dimensional bubble overlay
suppressPackageStartupMessages({library(ggplot2); library(ggrepel)})
deg_df <- read.delim(input_data, check.names = FALSE, quote = "")
pick_column <- function(candidates) {
  hit <- candidates[candidates %in% names(deg_df)]
  if (!length(hit)) stop(paste("bubble input columns missing:", paste(candidates, collapse = " / ")))
  hit[[1]]
}
gene_col <- pick_column(c("gene", "gene_symbol", "symbol"))
fc_col <- pick_column(c("log2FC", "log2fc", "logFC"))
pval_col <- pick_column(c("P_Value", "P.Value", "pvalue", "p_value", "pval"))
padj_col <- tryCatch(pick_column(c("adj_P_Val", "adj.P.Val", "p.adjust", "padj")), error = function(e) NA_character_)
expr_col <- tryCatch(pick_column(c("AveExpr", "baseMean", "mean_expr")), error = function(e) NA_character_)
deg_df$.fc <- suppressWarnings(as.numeric(deg_df[[fc_col]]))
deg_df$.p <- suppressWarnings(as.numeric(deg_df[[pval_col]]))
deg_df$.gene <- as.character(deg_df[[gene_col]])
deg_df$.padj <- if (!is.na(padj_col)) suppressWarnings(as.numeric(deg_df[[padj_col]])) else NA_real_
deg_df$.expr <- if (!is.na(expr_col)) suppressWarnings(as.numeric(deg_df[[expr_col]])) else NA_real_
deg_df <- deg_df[is.finite(deg_df$.fc) & is.finite(deg_df$.p) & deg_df$.p > 0 & nzchar(deg_df$.gene), , drop = FALSE]
if (!nrow(deg_df)) stop("bubble input has no usable DEG rows")
# 气泡大小不能含 NA：AveExpr 缺失时回退到 |logFC|，保证每个点都有可映射的第三个维度
if (all(!is.finite(deg_df$.expr))) deg_df$.expr <- abs(deg_df$.fc)
deg_df$.expr[!is.finite(deg_df$.expr)] <- stats::median(deg_df$.expr, na.rm = TRUE)
# 显著性分级：优先 padj；若整表 padj 均不达标则回退未校正 p（与批次 A 同一套降级判据）
sig_ok <- if (any(is.finite(deg_df$.padj))) sum(deg_df$.padj < 0.05, na.rm = TRUE) >= 2 else FALSE
deg_df$.score <- if (sig_ok) deg_df$.padj else deg_df$.p
deg_df$.tier <- ifelse(deg_df$.score < 0.05, "significant", "ns")
label_df <- deg_df[order(abs(deg_df$.fc), decreasing = TRUE), , drop = FALSE]
label_df <- head(label_df, 12)
bubble_plot <- ggplot(deg_df, aes(x = .fc, y = -log10(.p))) +
  geom_point(aes(size = .expr, colour = .tier), alpha = 0.6) +
  geom_text_repel(data = label_df, aes(label = .gene), size = 1.8, max.overlaps = 20,
                  min.segment.length = 0.2, segment.size = 0.2) +
  scale_colour_manual(values = c(significant = "#D55E00", ns = "#9E9E9E")) +
  scale_size_continuous(range = c(0.3, 3.2), guide = "none") +
  labs(x = "log2(fold change)", y = "-log10(p)", colour = NULL,
       subtitle = paste("genes =", nrow(deg_df), "| size = mean expression")) +
  theme_classic(base_size = 8) +
  theme(legend.position = "none")
ggsave(output_file, bubble_plot, width = 89, height = 75, units = "mm", dpi = 300,
       device = png, type = "cairo", bg = "white")
cat("ADAPT_REAL_INPUT_OK bubble genes=", nrow(deg_df), " labels=", nrow(label_df), "\\n", sep = "")
`;



R_OVERLAYS.fig_l1_correlogram = `# Real-data sample correlation matrix overlay
suppressPackageStartupMessages({library(corrplot)})
expr <- read.delim(input_data, check.names = FALSE, quote = "")
sample_mat <- as.matrix(expr[, -1, drop = FALSE])
storage.mode(sample_mat) <- "numeric"
if (ncol(sample_mat) < 2) stop(paste("correlogram needs >= 2 sample columns, got", ncol(sample_mat)))
if (anyNA(sample_mat)) {
  # 低表达基因在部分样本里可能是空值：先按行剔除，避免相关性算成 NA
  keep <- stats::complete.cases(sample_mat)
  sample_mat <- sample_mat[keep, , drop = FALSE]
}
if (!nrow(sample_mat)) stop("correlogram input has no complete rows")
# 样本数多时相关性图会糊成一团：超过 40 个样本先取方差最大的 40 列
if (ncol(sample_mat) > 40) {
  top <- order(apply(sample_mat, 2, stats::var), decreasing = TRUE)[1:40]
  sample_mat <- sample_mat[, top, drop = FALSE]
}
cor_mat <- stats::cor(sample_mat, use = "pairwise.complete.obs", method = "pearson")
p_mat <- tryCatch(corrplot::cor.mtest(sample_mat, conf.level = 0.95)$p, error = function(e) NULL)
png(output_file, width = 120, height = 110, units = "mm", res = 300, type = "cairo")
corrplot::corrplot(cor_mat,
                   method = "color", type = "upper", order = "hclust",
                   hclust.method = "ward.D2", addrect = 3, rect.col = "#333333",
                   tl.col = "#333333", tl.cex = 0.5, tl.srt = 45,
                   col = colorRampPalette(c("#0072B2", "white", "#D55E00"))(200),
                   p.mat = p_mat, sig.level = c(0.001, 0.01, 0.05),
                   insig = "label_sig", pch.cex = 0.5)
dev.off()
cat("ADAPT_REAL_INPUT_OK correlogram samples=", ncol(sample_mat), " genes=", nrow(sample_mat), "\\n", sep = "")
`;


R_OVERLAYS.fig_l1_ridgeline = `# Real-data GSEA NES ridge overlay
suppressPackageStartupMessages({library(ggplot2); library(ggridges)})
gsea_df <- read.delim(input_data, check.names = FALSE, quote = "")
pick_column <- function(candidates) {
  hit <- candidates[candidates %in% names(gsea_df)]
  if (!length(hit)) stop(paste("ridgeline input columns missing:", paste(candidates, collapse = " / ")))
  hit[[1]]
}
nes_col <- pick_column(c("NES", "nes", "enrichmentScore"))
ont_col <- if ("ont" %in% names(gsea_df)) "ont" else if ("library" %in% names(gsea_df)) "library" else NA
padj_col <- pick_column(c("qvalue", "p.adjust", "p_adjust", "padj"))
if (is.na(ont_col)) {
  gsea_df$.facet <- "all"
  facet_var <- ".facet"
} else {
  facet_var <- ont_col
}
gsea_df$.nes <- suppressWarnings(as.numeric(gsea_df[[nes_col]]))
gsea_df$.padj <- suppressWarnings(as.numeric(gsea_df[[padj_col]]))
gsea_df <- gsea_df[is.finite(gsea_df$.nes) & is.finite(gsea_df$.padj), , drop = FALSE]
if (!nrow(gsea_df)) stop("ridgeline input has no finite NES rows")
gsea_df$.group <- as.factor(gsea_df[[facet_var]])
ridge_plot <- ggplot(gsea_df, aes(x = .nes, y = .group, fill = .group)) +
  geom_density_ridges(scale = 1.4, rel_min_height = 0.01, alpha = 0.72,
                      colour = "grey25", linewidth = 0.35) +
  geom_vline(xintercept = 0, linetype = "dashed", linewidth = 0.4, colour = "grey40") +
  labs(x = "Normalized enrichment score (NES)", y = NULL,
       subtitle = paste("gene sets =", nrow(gsea_df))) +
  theme_classic(base_size = 8) +
  theme(legend.position = "none")
ggsave(output_file, ridge_plot, width = 89, height = 75, units = "mm", dpi = 300,
       device = png, type = "cairo", bg = "white")
cat("ADAPT_REAL_INPUT_OK ridgeline sets=", nrow(gsea_df), "\\n", sep = "")
`;

R_OVERLAYS.fig_l1_upsetplot = `# Real-data DEG subset intersection UpSet overlay
suppressPackageStartupMessages({library(UpSetR)})
deg_df <- read.delim(input_data, check.names = FALSE, quote = "")
pick_column <- function(candidates) {
  hit <- candidates[candidates %in% names(deg_df)]
  if (!length(hit)) stop(paste("upset input columns missing:", paste(candidates, collapse = " / ")))
  hit[[1]]
}

pick_threshold <- function(frame, padj_name, pval_name) {
  # 优先用 BH 校正后的 padj<0.05；该数据集零命中时降级到未校正 P_Value<0.05。
  # 实测依据：PRJ_AIMS_V3_20261027 最小 adj_P_Val=0.4524（padj<0.05 共 0 个），
  # 而未校正 P_Value<0.05 有 1121 个、<0.01 有 151 个。集合全空会让图形退化。
  for (candidate in c(padj_name, pval_name)) {
    if (is.na(candidate) || !nzchar(candidate) || !candidate %in% names(frame)) next
    values <- suppressWarnings(as.numeric(frame[[candidate]]))
    finite <- values[is.finite(values)]
    if (!length(finite)) next
    if (sum(finite < 0.05) >= 2) {
      return(list(column = candidate, adjusted = identical(candidate, padj_name)))
    }
  }
  stop("neither padj nor p-value yields at least 2 genes below 0.05")
}
gene_col <- pick_column(c("gene", "gene_symbol", "symbol"))
padj_col <- pick_column(c("adj_P_Val", "adj.P.Val", "p.adjust", "padj", "qvalue"))
pval_col <- pick_column(c("P_Value", "P.Value", "pvalue", "p_value", "pval"))
fc_col <- pick_column(c("log2FC", "log2fc", "logFC"))
deg_df$.fc <- suppressWarnings(as.numeric(deg_df[[fc_col]]))
deg_df$.gene <- as.character(deg_df[[gene_col]])
sig_choice <- pick_threshold(deg_df, padj_col, pval_col)
deg_df$.padj <- as.numeric(deg_df[[sig_choice$column]])
deg_df <- deg_df[is.finite(deg_df$.padj) & is.finite(deg_df$.fc) & nzchar(deg_df$.gene), , drop = FALSE]
if (!nrow(deg_df)) stop("upset input has no usable DEG rows")
deg_df$.rank <- rank(deg_df$.padj, ties.method = "first")
fc_abs <- abs(deg_df$.fc)
sets <- list(
  sig = deg_df$.gene[deg_df$.padj < 0.05],
  padj_lt_0.01_or_rank = deg_df$.gene[deg_df$.rank <= max(2L, ceiling(sum(deg_df$.padj < 0.05) * 0.5))],
  top_ranked_5pct = deg_df$.gene[deg_df$.rank <= max(2L, ceiling(nrow(deg_df) * 0.05))],
  top_ranked_10pct = deg_df$.gene[deg_df$.rank <= max(2L, ceiling(nrow(deg_df) * 0.10))],
  abs_fc_top_10pct = deg_df$.gene[fc_abs >= stats::quantile(fc_abs, 0.90, na.rm = TRUE)],
  abs_fc_top_25pct = deg_df$.gene[fc_abs >= stats::quantile(fc_abs, 0.75, na.rm = TRUE)],
  up_regulated = deg_df$.gene[deg_df$.fc > 0],
  down_regulated = deg_df$.gene[deg_df$.fc < 0]
)
sets <- sets[vapply(sets, length, integer(1)) > 0]
if (length(sets) < 2) stop(paste("upset needs at least 2 non-empty sets, got", length(sets)))
png(output_file, width = 89, height = 75, units = "mm", res = 300, type = "cairo")
up <- upset(fromList(sets), nsets = length(sets), nintersects = 20,
            order.by = "freq", keep.order = TRUE,
            main.bar.color = "#0072B2", sets.bar.color = "#D55E00",
            matrix.color = "#333333", shade.color = "#EEEEEE",
            mainbar.y.label = "Intersection size", sets.x.label = "Genes per subset")
print(up)
dev.off()
cat("ADAPT_REAL_INPUT_OK upset sets=", length(sets), " genes=", nrow(deg_df),
    " threshold=", sig_choice$column, " adjusted=", sig_choice$adjusted, "\\n", sep = "")
`;

R_OVERLAYS.fig_l1_vennplot = `# Real-data DEG subset Venn overlay
suppressPackageStartupMessages({library(VennDiagram); library(futile.logger)})
flog.threshold(ERROR, name = "VennDiagramLogger")
deg_df <- read.delim(input_data, check.names = FALSE, quote = "")
pick_column <- function(candidates) {
  hit <- candidates[candidates %in% names(deg_df)]
  if (!length(hit)) stop(paste("venn input columns missing:", paste(candidates, collapse = " / ")))
  hit[[1]]
}

pick_threshold <- function(frame, padj_name, pval_name) {
  # 优先 padj<0.05；零命中时降级到未校正 P_Value<0.05（实测本库 padj 最小 0.4524，
  # 未校正 p<0.05 有 1121 个），避免集合全空。
  for (candidate in c(padj_name, pval_name)) {
    if (is.na(candidate) || !nzchar(candidate) || !candidate %in% names(frame)) next
    values <- suppressWarnings(as.numeric(frame[[candidate]]))
    finite <- values[is.finite(values)]
    if (!length(finite)) next
    if (sum(finite < 0.05) >= 2) {
      return(list(column = candidate, adjusted = identical(candidate, padj_name)))
    }
  }
  stop("neither padj nor p-value yields at least 2 genes below 0.05")
}
gene_col <- pick_column(c("gene", "gene_symbol", "symbol"))
padj_col <- pick_column(c("adj_P_Val", "adj.P.Val", "p.adjust", "padj", "qvalue"))
pval_col <- pick_column(c("P_Value", "P.Value", "pvalue", "p_value", "pval"))
fc_col <- pick_column(c("log2FC", "log2fc", "logFC"))
deg_df$.fc <- suppressWarnings(as.numeric(deg_df[[fc_col]]))
deg_df$.gene <- as.character(deg_df[[gene_col]])
sig_choice <- pick_threshold(deg_df, padj_col, pval_col)
deg_df$.padj <- suppressWarnings(as.numeric(deg_df[[sig_choice$column]]))
deg_df <- deg_df[is.finite(deg_df$.padj) & is.finite(deg_df$.fc) & nzchar(deg_df$.gene), , drop = FALSE]
if (!nrow(deg_df)) stop("venn input has no usable DEG rows")
sig_genes <- unique(deg_df$.gene[deg_df$.padj < 0.05])
g1 <- sig_genes
g2 <- unique(deg_df$.gene[abs(deg_df$.fc) >= stats::quantile(abs(deg_df$.fc), 0.9, na.rm = TRUE)])
g3 <- unique(deg_df$.gene[abs(deg_df$.fc) >= stats::quantile(abs(deg_df$.fc), 0.75, na.rm = TRUE)])
if (length(g1) < 2 || length(g2) < 2 || length(g3) < 2) {
  stop(paste("venn needs non-degenerate sets:", length(g1), length(g2), length(g3)))
}
png(output_file, width = 89, height = 75, units = "mm", res = 300, type = "cairo")
grid::grid.newpage()
venn_plot <- venn.diagram(
  x = list(significant = g1, abs_fc_top_10pct = g2, abs_fc_top_25pct = g3),
  filename = NULL,
  fill = c("#0072B2", "#D55E00", "#009E73"),
  alpha = 0.55, cex = 1.0, cat.cex = 0.8,
  cat.col = c("#0072B2", "#D55E00", "#009E73"),
  margin = 0.08, disable.logging = TRUE
)
grid::grid.draw(venn_plot)
dev.off()
junk <- list.files(pattern = "^VennDiagram_.*\\\\.log$")
if (length(junk)) file.remove(junk)
cat("ADAPT_REAL_INPUT_OK venn sets=", length(g1), "/", length(g2), "/", length(g3), "\\n", sep = "")
`;



const PYTHON_OVERLAYS = {
  fig_l2p_dotplot: `# Real-data target localization dot plot overlay
loc = pd.read_csv(input_data, sep = "\\t")
required = {"gene", "celltype", "mean_expr_lognorm", "pct_expressing"}
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
    .head(20)
    .index
)
plot_df = loc[loc["gene"].isin(genes)].copy()
gene_order = list(genes)
plot_df["gene"] = pd.Categorical(plot_df["gene"], categories=gene_order, ordered=True)
celltypes = list(plot_df["celltype"].drop_duplicates())
plot_df["celltype"] = pd.Categorical(plot_df["celltype"], categories=celltypes, ordered=True)
fig, ax = plt.subplots(figsize=(max(5.0, len(celltypes) * 0.45), max(4.0, len(genes) * 0.24)))
scatter = ax.scatter(
    plot_df[group_col].astype(str),
    plot_df["gene"].astype(str),
    s=np.clip(plot_df["pct_expressing"].to_numpy() * 42, 5, 42),
    c=plot_df["mean_expr_lognorm"].to_numpy(),
    cmap="viridis",
    linewidths=0,
    alpha=0.9,
)
ax.set_xlabel(group_col)
ax.set_ylabel("gene")
ax.tick_params(axis="x", rotation=45, labelsize=6)
ax.tick_params(axis="y", labelsize=6)
for spine in ("top", "right"):
    ax.spines[spine].set_visible(False)
fig.colorbar(scatter, ax=ax, label="mean expression")
fig.tight_layout()
fig.savefig(output_file, dpi=300, bbox_inches="tight")
plt.close(fig)
print(f"ADAPT_REAL_INPUT_OK dotplot rows={len(plot_df)}")
`,
  fig_l2p_volcano: `# Real-data cell-type differential-expression volcano overlay
import json

deg = pd.read_csv(input_data, sep="\t")
required = {"celltype", "gene_symbol", "log2fc", "pvals_adj"}
missing = sorted(required.difference(deg.columns))
if missing:
    raise ValueError(f"volcano input columns missing: {missing}")

# 阈值与判据口径来自需求单：project.json 的 analysis_cutoffs 是唯一真源，
# ADAPT_VARS 里的两个 cutoff 是兜底（门户未绑定项目时用）。
use_adj_p = True
l2_cut = float(ADAPT_VARS.get("log2fc_cutoff") or 1.0)
p_cut = float(ADAPT_VARS.get("padj_cutoff") or 0.05)
meta_path = os.environ.get("BIOANALYS_PROJECT_JSON", "")
if meta_path and Path(meta_path).exists():
    try:
        meta = json.loads(Path(meta_path).read_text(encoding="utf-8"))
        cut = meta.get("analysis_cutoffs") or {}
        use_adj_p = bool(cut.get("use_adj_p", True))
        if cut.get("log2fc_threshold") is not None:
            l2_cut = float(cut["log2fc_threshold"])
        if use_adj_p and cut.get("adj_p_threshold") is not None:
            p_cut = float(cut["adj_p_threshold"])
        if not use_adj_p and cut.get("p_threshold") is not None:
            p_cut = float(cut["p_threshold"])
    except Exception:
        pass
p_label = "adj p" if use_adj_p else "p"

deg = deg.replace([np.inf, -np.inf], np.nan).dropna(subset=["gene_symbol", "log2fc", "pvals_adj"])
deg["fc"] = deg["log2fc"].astype(float)
deg["p_use"] = np.clip(deg["pvals_adj"].astype(float), 1e-300, 1.0)
deg["neglog10"] = -np.log10(deg["p_use"])
deg["sig"] = np.where(
    (deg["p_use"] < p_cut) & (deg["fc"] > l2_cut), "Up",
    np.where((deg["p_use"] < p_cut) & (deg["fc"] < -l2_cut), "Down", "NS"),
)
group_col = str(ADAPT_VARS.get("group_col") or "celltype")
if group_col not in deg.columns:
    group_col = "celltype"
top_groups = (
    deg.groupby(group_col, observed=True)["p_use"].min()
    .sort_values().head(8).index
)
plot_df = deg[deg[group_col].isin(top_groups)].copy()
if len(plot_df) > 5000:
    plot_df = plot_df.nsmallest(5000, "p_use")

# 配色按上调/下调编码，不按细胞类型；NS 先画，红蓝永远压在上层（规范 三之二）
colors = {"Up": "#EE0000", "NS": "#BEBEBE", "Down": "#3B4992"}
counts = plot_df["sig"].value_counts()
fig, ax = plt.subplots(figsize=(89 / 25.4, 75 / 25.4))
for group in ("NS", "Up", "Down"):
    part = plot_df[plot_df["sig"] == group]
    if part.empty:
        continue
    ax.scatter(part["fc"], part["neglog10"], s=2.4, alpha=0.72, color=colors[group],
               label=f"{group} (n={int(counts.get(group, 0))})", linewidths=0, zorder=3 if group != "NS" else 2)

ax.axvline(-l2_cut, ls="--", lw=0.45, color="#595959")
ax.axvline(l2_cut, ls="--", lw=0.45, color="#595959")
ax.axhline(-np.log10(p_cut), ls="--", lw=0.45, color="#595959")

# 基因名分列在两条竖直阈值线外侧、逐级下移，绝不与阈值标注争同一位置
label_genes = set(ADAPT_VARS.get("label_genes") or [])
sig_df = plot_df[plot_df["sig"] != "NS"]
xlo_f, xhi_f = float(plot_df["fc"].min()), float(plot_df["fc"].max())
ylo_f = 0.0
yhi_f = float(plot_df["neglog10"].max()) * 1.42
label_rows = []
for grp in ("Down", "Up"):
    part = sig_df[sig_df["sig"] == grp].nsmallest(3, "p_use")
    label_rows.extend([(grp, row) for _, row in part.iterrows()])
named = [r for r in label_rows if str(r[1]["gene_symbol"]) in label_genes]
named += [r for r in label_rows if r not in named]
for rank, (grp, row) in enumerate(named[:8]):
    x_txt = (-l2_cut - 0.35) if grp == "Down" else (l2_cut + 0.35)
    y_txt = yhi_f - (0.05 + 0.085 * (rank % 3)) * yhi_f
    ax.annotate(str(row["gene_symbol"]), xy=(float(row["fc"]), float(row["neglog10"])),
                xytext=(x_txt, y_txt), fontsize=8,
                ha="right" if grp == "Down" else "left", va="center", zorder=6,
                arrowprops=dict(arrowstyle="-", color="0.55", lw=0.4,
                                shrinkA=1, shrinkB=2))

ax.set_xlabel("log2 fold change")
ax.set_ylabel("-log10(adjusted P)" if use_adj_p else "-log10(P)")
ax.set_xlim(xlo_f - 0.10 * (xhi_f - xlo_f), xhi_f + 0.10 * (xhi_f - xlo_f))
ax.set_ylim(ylo_f, yhi_f)
ax.legend(loc="upper left", bbox_to_anchor=(1.02, 1.0), frameon=False, fontsize=8,
          title=None, handletextpad=0.4, labelspacing=0.5)
for spine in ("top", "right"):
    ax.spines[spine].set_visible(False)

n_sig = int(counts.get("Up", 0)) + int(counts.get("Down", 0))
caption_lines = [
    "adapted volcano, real per-celltype DEG",
    f"threshold |log2FC|>{l2_cut:g} & {p_label}<{p_cut:g}",
    f"{len(plot_df)} genes, {n_sig} significant",
    "red = up, blue = down, grey = NS",
]
fig.subplots_adjust(right=0.74)
fig.text(0.01, -0.06, "\\n".join(caption_lines), ha="left", va="top", fontsize=8, linespacing=1.5)
fig.savefig(output_file, dpi=300, bbox_inches="tight")
plt.close(fig)
print(f"ADAPT_REAL_INPUT_OK volcano rows={len(plot_df)}")
`,  fig_l2p_umap: `# Real-data spatial UMAP overlay
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
fig, ax = plt.subplots(figsize=(183 / 25.4, 90 / 25.4))
labels = list(pd.unique(groups))
palette = plt.get_cmap("tab20")(np.linspace(0, 1, max(len(labels), 2)))
for index, label in enumerate(labels):
    mask = (groups == label).to_numpy()
    ax.scatter(umap[mask, 0], umap[mask, 1], s=4, alpha=0.8,
               color=palette[index % len(palette)], label=str(label), linewidths=0)
ax.set_xlabel("UMAP 1")
ax.set_ylabel("UMAP 2")
if len(labels) <= 12:
    ax.legend(frameon=False, fontsize=5, markerscale=2, loc="best")
for spine in ("top", "right"):
    ax.spines[spine].set_visible(False)
fig.tight_layout()
fig.savefig(output_file, dpi=300, bbox_inches="tight")
plt.close(fig)
print(f"ADAPT_REAL_INPUT_OK umap cells={adata.n_obs} groups={len(labels)}")
`,
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
order = comp.groupby(group_col, observed=True).size().sort_values(ascending=False).head(12).index.tolist()
data = [comp.loc[comp[group_col] == group, value_col].to_numpy() for group in order]
fig, ax = plt.subplots(figsize=(183 / 25.4, 85 / 25.4))
parts = ax.violinplot(data, showmeans=False, showmedians=True, widths=0.78)
for body in parts["bodies"]:
    body.set_facecolor("#56B4E9")
    body.set_edgecolor("#333333")
    body.set_alpha(0.72)
ax.set_xticks(np.arange(1, len(order) + 1), order, rotation=45, ha="right", fontsize=6)
ax.set_ylabel(value_col)
ax.set_xlabel(group_col)
for spine in ("top", "right"):
    ax.spines[spine].set_visible(False)
fig.tight_layout()
fig.savefig(output_file, dpi=300, bbox_inches="tight")
plt.close(fig)
print(f"ADAPT_REAL_INPUT_OK violin groups={len(order)} rows={len(comp)}")
`,
  fig_l2p_scatterplot: `# Real-data cluster marker score scatter overlay
mk = pd.read_csv(input_data, sep="\t")
x_col = str(ADAPT_VARS.get("x_col") or "rank")
y_col = str(ADAPT_VARS.get("y_col") or "score")
required = {"cluster", x_col, y_col}
missing = sorted(required.difference(mk.columns))
if missing:
    raise ValueError(f"scatter input columns missing: {missing}")
mk[y_col] = pd.to_numeric(mk[y_col], errors="coerce")
mk = mk.dropna(subset=[x_col, y_col])
groups = sorted(mk["cluster"].astype(str).unique(), key=lambda s: (len(s), s))[:12]
cmap = plt.get_cmap("tab20")
fig, ax = plt.subplots(figsize=(183 / 25.4, 120 / 25.4))
for i, g in enumerate(groups):
    sub = mk[mk["cluster"].astype(str) == g]
    ax.scatter(sub[x_col], sub[y_col], s=6, alpha=0.7, linewidths=0, color=cmap(i % 20), label=str(g))
ax.set_xlabel(x_col); ax.set_ylabel(y_col)
ax.legend(fontsize=5, markerscale=2, frameon=False, ncol=2)
for spine in ("top", "right"):
    ax.spines[spine].set_visible(False)
fig.tight_layout()
fig.savefig(output_file, dpi=300, bbox_inches="tight")
plt.close(fig)
print(f"ADAPT_REAL_INPUT_OK scatter rows={len(mk)} groups={len(groups)}")
`,
  fig_l2p_barplot: `# Real-data celltype proportion bar overlay
comp = pd.read_csv(input_data, sep="\t")
x_col = str(ADAPT_VARS.get("x_col") or "celltype")
value_col = str(ADAPT_VARS.get("value_col") or "prop")
required = {x_col, value_col}
missing = sorted(required.difference(comp.columns))
if missing:
    raise ValueError(f"bar input columns missing: {missing}")
comp[value_col] = pd.to_numeric(comp[value_col], errors="coerce")
comp = comp.dropna(subset=[x_col, value_col])
agg = comp.groupby(x_col, observed=True)[value_col].mean().sort_values(ascending=False).head(15)
fig, ax = plt.subplots(figsize=(183 / 25.4, 100 / 25.4))
ax.bar(range(len(agg)), agg.to_numpy(), color="#56B4E9", edgecolor="#333333", linewidth=0.4)
ax.set_xticks(range(len(agg)), agg.index.tolist(), rotation=45, ha="right", fontsize=6)
ax.set_ylabel(value_col); ax.set_xlabel(x_col)
for spine in ("top", "right"):
    ax.spines[spine].set_visible(False)
fig.tight_layout()
fig.savefig(output_file, dpi=300, bbox_inches="tight")
plt.close(fig)
print(f"ADAPT_REAL_INPUT_OK bar bars={len(agg)}")
`,
  fig_l2p_heatmap: `# Real-data GSVA pathway heatmap overlay
gs = pd.read_csv(input_data, sep="\t", index_col=0)
row_col = str(ADAPT_VARS.get("row_col") or "pathway")
if gs.index.name != row_col and row_col in gs.columns:
    gs = gs.set_index(row_col)
num = gs.select_dtypes(include=["number"])
if num.shape[1] < 2 or num.shape[0] < 2:
    raise ValueError("heatmap needs >=2 numeric columns and rows")
keep = num.loc[num.var(axis=1, ddof=0) > 0].abs().mean(axis=1).sort_values(ascending=False).head(25).index
mat = num.loc[keep].to_numpy(float)
fig, ax = plt.subplots(figsize=(183 / 25.4, 150 / 25.4))
im = ax.imshow(mat, aspect="auto", cmap="coolwarm")
ax.set_yticks(np.arange(mat.shape[0]), [str(i)[:34] for i in keep], fontsize=5)
ax.set_xticks(np.arange(mat.shape[1]), [str(c)[:22] for c in num.columns], rotation=90, fontsize=5)
fig.colorbar(im, ax=ax, fraction=0.035, pad=0.02)
ax.set_title(row_col + " x samples", fontsize=7)
fig.tight_layout()
fig.savefig(output_file, dpi=300, bbox_inches="tight")
plt.close(fig)
print(f"ADAPT_REAL_INPUT_OK heatmap shape={mat.shape}")
`,
  fig_l2p_boxplot: `# Real-data per-group metric boxplot overlay
qc = pd.read_csv(input_data, sep="\t")
group_col = str(ADAPT_VARS.get("group_col") or "diagnosis")
value_col = str(ADAPT_VARS.get("value_col") or "nfeature_total")
required = {group_col, value_col}
missing = sorted(required.difference(qc.columns))
if missing:
    raise ValueError(f"boxplot input columns missing: {missing}")
qc[value_col] = pd.to_numeric(qc[value_col], errors="coerce")
qc = qc.dropna(subset=[group_col, value_col])
order = qc.groupby(group_col, observed=True).size().sort_values(ascending=False).head(10).index.tolist()
data = [qc.loc[qc[group_col] == g, value_col].to_numpy() for g in order]
fig, ax = plt.subplots(figsize=(183 / 25.4, 100 / 25.4))
bp = ax.boxplot(data, tick_labels=[str(g) for g in order], patch_artist=True, showfliers=False)
for patch in bp["boxes"]:
    patch.set_facecolor("#E69F00"); patch.set_alpha(0.65)
ax.set_yscale("log"); ax.set_ylabel(value_col); ax.set_xlabel(group_col)
plt.setp(ax.get_xticklabels(), rotation=45, ha="right", fontsize=6)
for spine in ("top", "right"):
    ax.spines[spine].set_visible(False)
fig.tight_layout()
fig.savefig(output_file, dpi=300, bbox_inches="tight")
plt.close(fig)
print(f"ADAPT_REAL_INPUT_OK boxplot groups={len(order)}")
`,
};

// The line2 registry entry uses the verified Python UMAP source so it can stay
// inside line2's Python module graph while keeping its original figure id.
PYTHON_OVERLAYS.fig_l2p_gseaplot = `# Real-data GSEA ridge overlay
gsea = pd.read_csv(input_data, sep="\\t")
required = {"celltype", "Term", "NES"}
missing = sorted(required.difference(gsea.columns))
if missing:
    raise ValueError(f"gsea input columns missing: {missing}")
gsea["NES"] = pd.to_numeric(gsea["NES"], errors="coerce")
gsea = gsea.dropna(subset=["celltype", "Term", "NES"])
if gsea.empty:
    raise ValueError("gsea input has no numeric NES rows")
order = gsea.groupby("celltype", observed=True)["NES"].median().sort_values().index.tolist()
fig, ax = plt.subplots(figsize=(89 / 25.4, 75 / 25.4))
for idx, celltype in enumerate(order):
    values = np.sort(gsea.loc[gsea["celltype"] == celltype, "NES"].to_numpy())
    ax.fill_between(values, idx, idx + np.linspace(0, 0.28, values.size),
                    color=plt.cm.tab10(idx % 10), alpha=0.55, lw=0)
    ax.plot(values, np.repeat(idx, values.size), color="#4d4d4d", lw=0.6)
ax.set_yticks(range(len(order)), order, fontsize=5.5)
ax.axvline(0, ls="--", lw=0.4, c="#737373")
ax.set_xlabel("Normalized enrichment score (NES)")
ax.set_title("GSEA NES by cell type", fontsize=7.5)
for side in ("top", "right"):
    ax.spines[side].set_visible(False)
fig.tight_layout()
fig.savefig(output_file, dpi=300, bbox_inches="tight")
plt.close(fig)
print(f"ADAPT_REAL_INPUT_OK gsea rows={len(gsea)} celltypes={len(order)}")
`;

PYTHON_OVERLAYS.fig_l2p_enrichmentplot = `# Real-data ORA bubble overlay
ora = pd.read_csv(input_data, sep="\\t")
required = {"Term", "Overlap", "Adjusted P-value"}
missing = sorted(required.difference(ora.columns))
if missing:
    raise ValueError(f"ora input columns missing: {missing}")
ora["padj"] = pd.to_numeric(ora["Adjusted P-value"], errors="coerce")
ora["overlap"] = pd.to_numeric(ora["Overlap"].astype(str).str.split("/").str[0], errors="coerce")
ora = ora.dropna(subset=["padj", "overlap"])
ora = ora[ora["padj"] > 0]
if ora.empty:
    raise ValueError("ora input has no usable rows")
top = ora.nsmallest(15, "padj").copy()
top["neglog"] = -np.log10(top["padj"])
fig, ax = plt.subplots(figsize=(100 / 25.4, 75 / 25.4))
sizes = top["overlap"] / max(top["overlap"].max(), 1) * 110 + 10
scatter = ax.scatter(top["neglog"], top["overlap"], s=sizes,
                     c=top["neglog"], cmap="viridis", alpha=0.82,
                     linewidths=0.4, edgecolors="#333333")
for _, row in top.head(4).iterrows():
    label = str(row["Term"])
    ax.annotate(label[:42], (row["neglog"], row["overlap"]), fontsize=4.5,
                xytext=(3, 3), textcoords="offset points")
ax.set_xlabel("-log10(adjusted p)")
ax.set_ylabel("overlap genes")
ax.set_title("Over-representation analysis (top 15)", fontsize=7.5)
fig.colorbar(scatter, ax=ax, fraction=0.046, pad=0.04, label="-log10(padj)")
for side in ("top", "right"):
    ax.spines[side].set_visible(False)
fig.tight_layout()
fig.savefig(output_file, dpi=300, bbox_inches="tight")
plt.close(fig)
print(f"ADAPT_REAL_INPUT_OK ora terms={len(top)}")
`;

PYTHON_OVERLAYS.fig_l2_networkplot = `# Real-data differential-regulation network overlay
net = pd.read_csv(input_data, sep="\\t")
required = {"tf", "target"}
missing = sorted(required.difference(net.columns))
if missing:
    raise ValueError(f"network input columns missing: {missing}")
sig_col = "target_is_significant_dr" if "target_is_significant_dr" in net.columns else None
edges = net.dropna(subset=["tf", "target"]).copy()
if edges.empty:
    raise ValueError("network input has no usable edges")
graph = nx.DiGraph()
for _, row in edges.iterrows():
    graph.add_edge(str(row["tf"]), str(row["target"]))
if graph.number_of_nodes() < 2:
    raise ValueError("network needs at least 2 nodes")
pos = nx.spring_layout(graph, seed=seed, k=0.5)
degree_rank = sorted(graph.degree, key=lambda item: item[1], reverse=True)
hubs = {node for node, _ in degree_rank[:5]}
fig, ax = plt.subplots(figsize=(89 / 25.4, 75 / 25.4))
colors = ["#D55E00" if node in hubs else "#0072B2" for node in graph.nodes]
nx.draw_networkx_edges(graph, pos, ax=ax, alpha=0.45, width=0.6, arrows=False)
nx.draw_networkx_nodes(graph, pos, ax=ax, node_size=70, node_color=colors, linewidths=0.3)
nx.draw_networkx_labels(graph, pos, ax=ax, font_size=4.2)
ax.set_title("Differential regulation network (knockout)", fontsize=7.5)
ax.axis("off")
fig.tight_layout()
fig.savefig(output_file, dpi=300, bbox_inches="tight")
plt.close(fig)
print(f"ADAPT_REAL_INPUT_OK network nodes={graph.number_of_nodes()} edges={graph.number_of_edges()}")
`;

PYTHON_OVERLAYS.fig_l3_chorddiagram = `# Real-data LIANA cell-cell communication chord overlay
inter = pd.read_csv(input_data, sep="\\t")
required = {"source", "target"}
missing = sorted(required.difference(inter.columns))
if missing:
    raise ValueError(f"chord input columns missing: {missing}")
weight_col = next((c for c in ("scaled_weight", "lr_means", "expr_prod") if c in inter.columns), None)
rank_col = next((c for c in ("magnitude_rank", "specificity_rank", "lrscore") if c in inter.columns), None)
# 权重列缺失时必须整列置 1，绝不能把字符串（比如 input 路径）当数值转
if weight_col is None:
    weight_col = None
key = inter[["source", "target"]].copy()
key["source"] = key["source"].astype(str)
key["target"] = key["target"].astype(str)
key["weight"] = pd.to_numeric(inter[weight_col], errors="coerce") if weight_col else 1.0
if rank_col:
    key["rank"] = pd.to_numeric(inter[rank_col], errors="coerce")
else:
    key["rank"] = np.nan
key = key.dropna(subset=["source", "target", "weight"])
key = key[(key["source"] != "") & (key["target"] != "")]
if key.empty:
    raise ValueError("chord input has no usable rows")
# 57,282 行原始 LR 对直接画会把画布涂成黑团：先筛显著对，不足 20 条降级 Top 200
sig = key[key["rank"] <= 0.05] if key["rank"].notna().any() else key.iloc[0:0]
if len(sig) < 20:
    sig = key.sort_values("rank", na_position="last").head(200)
# 聚合键是细胞对，权重累加（同一对可能有几十个配体-受体组合）
agg = sig.groupby(["source", "target"], observed=True)["weight"].sum().reset_index()
agg = agg[agg["weight"] > 0]
if agg.empty:
    raise ValueError("chord aggregation produced no weighted cell pairs")
agg = agg.sort_values("weight", ascending=False).head(300)
cells = sorted(set(agg["source"]) | set(agg["target"]))
n = len(cells)
fig, ax = plt.subplots(figsize=(120 / 25.4, 120 / 25.4))
ax.set_xlim(-1.35, 1.35); ax.set_ylim(-1.35, 1.35); ax.set_aspect("equal"); ax.axis("off")
ang = np.linspace(90, 90 - 360, n, endpoint=False)
rad = np.deg2rad(ang)
xs, ys = np.cos(rad), np.sin(rad)
idx = {c: i for i, c in enumerate(cells)}
cmap = plt.cm.coolwarm
vmax = float(agg["weight"].max()) or 1.0
for _, row in agg.iterrows():
    i, j = idx[row["source"]], idx[row["target"]]
    p0 = (xs[i] * 0.98, ys[i] * 0.98)
    p3 = (xs[j] * 0.98, ys[j] * 0.98)
    p1 = (xs[i] * 0.35, ys[i] * 0.35)
    p2 = (xs[j] * 0.35, ys[j] * 0.35)
    path = MplPath([p0, p1, p2, p3],
                   [MplPath.MOVETO, MplPath.CURVE4, MplPath.CURVE4, MplPath.CURVE4])
    ax.add_patch(patches.PathPatch(path, facecolor="none",
                                   edgecolor=cmap(float(row["weight"]) / vmax),
                                   lw=0.7, alpha=0.42, capstyle="round"))
ax.scatter(xs, ys, s=26, c="#56B4E9", edgecolors="#333333", linewidths=0.4, zorder=3)
for xi, yi, name in zip(xs, ys, cells):
    ax.text(xi * 1.09, yi * 1.09, name, fontsize=5.2,
            ha="left" if xi >= 0 else "right", va="center")
ax.set_title(f"Cell-cell communication | pairs = {len(agg)}", fontsize=7.5)
fig.savefig(output_file, bbox_inches="tight")
plt.close(fig)
print(f"ADAPT_REAL_INPUT_OK chord pairs={len(agg)} cells={len(cells)} from_rows={len(inter)}")
`;

PYTHON_OVERLAYS.fig_l1_connectedscatter = `# Real-data spatial autocorrelation scatter overlay
auto = pd.read_csv(input_data, sep="\\t")
gene_col = next((c for c in ("gene_symbol", "gene", "var_index") if c in auto.columns), None)
if gene_col is None:
    raise ValueError(f"autocorr input missing gene column; columns = {list(auto.columns)[:12]}")
morans_col = next((c for c in ("morans_i_mean", "morans_i", "moran_i") if c in auto.columns), None)
geary_col = next((c for c in ("gearys_c_mean", "gearys_c", "geary_c") if c in auto.columns), None)
if morans_col is None or geary_col is None:
    raise ValueError(f"autocorr input missing Moran/Geary columns; columns = {list(auto.columns)[:12]}")
auto["gene"] = auto[gene_col].astype(str)
auto["morans"] = pd.to_numeric(auto[morans_col], errors="coerce")
auto["geary"] = pd.to_numeric(auto[geary_col], errors="coerce")
# 空间转录组里低表达基因的 Moran's I 常算成 NaN/Inf，绘图前必须剔除
auto = auto.dropna(subset=["morans", "geary"])
auto = auto[auto["gene"].str.len() > 0]
if auto.empty:
    raise ValueError("autocorr input has no finite Moran/Geary rows")
auto["neg_geary"] = -auto["geary"]
# 1.9 万个点直接散会糊成一坨：按 |Moran's I| 取 Top 500 做主体，Top 30 高亮，Top 10 标注
top500 = auto.reindex(auto["morans"].abs().sort_values(ascending=False).index).head(500)
top30 = top500.head(30)
label = top30.head(10)
fig, ax = plt.subplots(figsize=(89 / 25.4, 80 / 25.4))
ax.scatter(top500["morans"], top500["neg_geary"], s=1.2, c="#9E9E9E", alpha=0.45, linewidths=0)
ax.plot(top30["morans"], top30["neg_geary"], color="#0072B2", lw=0.35, alpha=0.55)
ax.scatter(top30["morans"], top30["neg_geary"], s=7, c="#D55E00", alpha=0.85, linewidths=0)
for _, row in label.iterrows():
    ax.annotate(row["gene"], (row["morans"], row["neg_geary"]),
                fontsize=4.2, xytext=(2, 2), textcoords="offset points")
ax.set_xlabel("Moran's I (spatial autocorrelation)")
ax.set_ylabel("-Geary's C (spatial gradient)")
ax.set_title(f"genes = {len(auto)} | shown = top 500", fontsize=7)
for side in ("top", "right"):
    ax.spines[side].set_visible(False)
fig.tight_layout()
fig.savefig(output_file, bbox_inches="tight")
plt.close(fig)
print(f"ADAPT_REAL_INPUT_OK autocorr genes={len(auto)} shown={len(top500)}")
`;

PYTHON_OVERLAYS.fig_l2_umap = PYTHON_OVERLAYS.fig_l2p_umap;

export function buildAdaptedFigureSource({
  template,
  masterSource,
  inputPath,
  projectId,
  lineId,
  adaptVars = {},
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
  const commentLines = [
    `# Master-Source: ${String(template.source || '').replace(/\\/g, '/')} | Master-SHA256: ${template.source_sha256 || ''}`,
    `# Adapted-Project: ${projectId}`,
    `# Adapted-Line: ${lineId}`,
    ...Object.entries(template.adapt_vars || {}).map(
      ([key, description]) => `# Adapt-Variable ${key}: ${description}`,
    ),
  ];
  const prelude = template.language === 'r'
    ? rPrelude({ ...template, canonical_output: canonicalOutput }, normalizedInput, remoteInput)
    : pythonPrelude({ ...template, canonical_output: canonicalOutput }, normalizedInput, remoteInput);
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
    '# Retained master source for byte-level audit; unreachable after successful real-data render.',
    masterSource.replace(/\r\n/g, '\n'),
  ].join('\n').replace(/\r\n/g, '\n');
}
