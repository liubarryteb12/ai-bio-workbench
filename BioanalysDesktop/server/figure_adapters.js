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
};

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
};

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
