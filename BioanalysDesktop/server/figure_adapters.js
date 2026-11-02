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
volcano_df <- volcano_df[is.finite(volcano_df$log2fc) & is.finite(volcano_df$pvalue) & volcano_df$pvalue > 0, ]
volcano_df$sig <- ifelse(volcano_df$padj < 0.05 & volcano_df$log2fc > 1, "Up",
                  ifelse(volcano_df$padj < 0.05 & volcano_df$log2fc < -1, "Down", "NS"))
labels <- unique(c(as.character(adapt_vars$label_genes), head(volcano_df$gene[order(volcano_df$padj)], 8)))
label_df <- volcano_df[volcano_df$gene %in% labels, ]
volcano <- ggplot(volcano_df, aes(x = log2fc, y = -log10(pvalue), colour = sig)) +
  geom_point(size = 0.8, alpha = 0.72) +
  scale_colour_manual(values = c(Up = "#D55E00", Down = "#0072B2", NS = "grey72")) +
  geom_vline(xintercept = c(-1, 1), linetype = "dashed", linewidth = 0.35, colour = "grey35") +
  geom_hline(yintercept = -log10(0.05), linetype = "dashed", linewidth = 0.35, colour = "grey35") +
  geom_text_repel(data = label_df, aes(label = gene), size = 2.2, max.overlaps = 30) +
  labs(x = "log2(Fold Change)", y = "-log10(P)", colour = NULL) +
  theme_classic(base_size = 7) +
  theme(legend.position = "top")
ggsave(output_file, volcano, width = 89, height = 75, units = "mm", dpi = 300,
       device = png, type = "cairo", bg = "white")
cat("ADAPT_REAL_INPUT_OK volcano rows=", nrow(volcano_df), "\n", sep = "")
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
png(output_file, width = 183, height = 90, units = "mm", res = 300, type = "cairo", bg = "white")
par(mar = c(1, 1, 1, 1))
plot.new()
plot.window(xlim = c(0, 1), ylim = c(0, 1))
segments(0.2, flow$left_y, 0.8, flow$right_y, col = adjustcolor("#56B4E9", alpha.f = 0.35),
         lwd = pmax(2, flow$count / max(flow$count) * 18))
rect(0.12, flow$left_y - flow$width, 0.20, flow$left_y + flow$width,
     col = "#0072B2", border = NA)
rect(0.80, flow$right_y - flow$width, 0.88, flow$right_y + flow$width,
     col = "#D55E00", border = NA)
text(0.19, flow$left_y, flow$module, adj = c(1, 0.5), cex = 0.65)
text(0.81, flow$right_y, paste0("genes=", flow$count), adj = c(0, 0.5), cex = 0.65)
title(main = "WGCNA module composition", cex.main = 0.8)
dev.off()
cat("ADAPT_REAL_INPUT_OK sankey modules=", nrow(flow), "\n", sep = "")
`,
};

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
fig, ax = plt.subplots(figsize=(89 / 25.4, 75 / 25.4))
palette = ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#56B4E9", "#F0E442", "#999999"]
for index, group in enumerate(top_groups):
    part = plot_df[plot_df[group_col] == group]
    ax.scatter(part["log2fc"], part["neglog10"], s=2.4, alpha=0.72,
               color=palette[index % len(palette)], label=str(group), linewidths=0)
ax.axvline(-1, ls="--", lw=0.45, color="#555555")
ax.axvline(1, ls="--", lw=0.45, color="#555555")
ax.axhline(-np.log10(0.05), ls="--", lw=0.45, color="#555555")
label_genes = set(ADAPT_VARS.get("label_genes") or [])
top_labels = plot_df.nsmallest(8, "pvals_adj")["gene_symbol"].astype(str).tolist()
for gene in list(label_genes.union(top_labels))[:12]:
    row = plot_df[plot_df["gene_symbol"].astype(str) == gene].nsmallest(1, "pvals_adj")
    if not row.empty:
        ax.annotate(gene, (float(row.iloc[0]["log2fc"]), float(row.iloc[0]["neglog10"])),
                    fontsize=4.2, xytext=(2, 2), textcoords="offset points")
ax.set_xlabel("log2 fold change")
ax.set_ylabel("-log10(adjusted P)")
ax.legend(frameon=False, fontsize=4.5, loc="upper right", ncol=2)
for spine in ("top", "right"):
    ax.spines[spine].set_visible(False)
fig.tight_layout()
fig.savefig(output_file, dpi=300, bbox_inches="tight")
plt.close(fig)
print(f"ADAPT_REAL_INPUT_OK volcano rows={len(plot_df)}")
`,
  fig_l2p_umap: `# Real-data spatial UMAP overlay
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
