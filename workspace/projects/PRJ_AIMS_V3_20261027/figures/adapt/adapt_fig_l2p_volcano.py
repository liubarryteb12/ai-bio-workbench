# Master-Source: reference/05.可参考出图代码/L2_组学常用图/L2p_more_code.py | Master-SHA256: 01d5bd21b306677947aa771ccc8f70b97d225919470d5f95536442c4ff8472e6
# Adapted-Project: PRJ_AIMS_V3_20261027
# Adapted-Line: line2_scrna
# Adapt-Variable input_data: 项目本线只读输入文件路径，相对于本项目根目录
# Adapt-Variable group_col: 比较方向定义使用的分组列名
# Adapt-Variable label_genes: 需要标注的基因清单，可为空
ADAPT_VARS = {
  "input_data": "data/line2_scrna/processed/deg_all_by_celltype.tsv",
  "group_col": "celltype",
  "label_genes": ["S100A8"]
}

# Real-Data-Adapter: v1
# Project-Input: data/line2_scrna/processed/deg_all_by_celltype.tsv
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
input_data = "/mnt/ssd/bio_data/projects/PRJ_AIMS_V3_20261027/line2_scrna/processed/deg_all_by_celltype.tsv"
output_file = "L2p_volcano_verified.png"
if not Path(input_data).exists():
    raise FileNotFoundError(f"real input missing: {input_data}")
Path(output_file).parent.mkdir(parents=True, exist_ok=True)

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

raise SystemExit(0)
# Retained master source for byte-level audit; unreachable after successful real-data render.
"""L2 Python 三件套：火山图 / marker 点图 / 分组小提琴图（scanpy + seaborn 风格）"""
import numpy as np, scanpy as sc, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import scanpy.plotting as scp

rng = np.random.default_rng(42)
plt.rcParams.update({"font.size": 7, "axes.linewidth": 0.6, "savefig.dpi": 300})
sc.set_figure_params(dpi=300, frameon=False, fontsize=7)

# ---- L2-05P 火山图（matplotlib 手写，替代 Bizard R 版）----
n = 4000
log2fc = rng.normal(0, 1.2, n)
pval = rng.uniform(0, 1, n)
from scipy import stats as st
# BH 校正
order = np.argsort(pval); ranked = pval[order]
q = ranked * n / np.arange(1, n + 1)
q = np.minimum.accumulate(q[::-1])[::-1]; q = np.clip(q, 0, 1)
padj = np.empty(n); padj[order] = q
cls = np.where((padj < 0.05) & (log2fc > 1), "Up",
      np.where((padj < 0.05) & (log2fc < -1), "Down", "NS"))
fig, ax = plt.subplots(figsize=(89/25.4, 75/25.4))
for c, col, lab in [("NS", "#b0b0b0", "NS"), ("Up", "#D55E00", "Up"), ("Down", "#0072B2", "Down")]:
    m = cls == c
    ax.scatter(log2fc[m], -np.log10(pval[m]), s=2.5, c=col, label=lab, alpha=0.75, linewidths=0)
ax.axvline(1, ls="--", lw=0.5, c="#444444"); ax.axvline(-1, ls="--", lw=0.5, c="#444444")
ax.axhline(-np.log10(0.05), ls="--", lw=0.5, c="#444444")
top = np.argsort(padj)[:8]
for i in top:
    ax.annotate(f"G{i}", (log2fc[i], -np.log10(pval[i])), fontsize=4.5)
ax.set_xlabel("log2(Fold Change)"); ax.set_ylabel("-log10(P)")
for s in ("top", "right"): ax.spines[s].set_visible(False)
fig.savefig("L2p_volcano_verified.png", bbox_inches="tight"); fig.savefig("L2p_volcano_verified.pdf", bbox_inches="tight")
plt.close(fig); print("RENDER_OK volcano_py")

# ---- L2-06P marker 点图（scanpy dotplot）----
n_per, k, n_genes = 250, 4, 6
X = np.vstack([rng.normal(0, 1, size=(n_per, 40)) for _ in range(k)]).astype("float32")
adata = sc.AnnData(X)
adata.var_names = [f"G{i}" for i in range(40)]
adata.obs["leiden"] = pd_col = np.repeat([f"CT{i+1}" for i in range(k)], n_per)
# 让前 6 个基因在各群有差异
for g in range(n_genes):
    adata.X[g::k, g] += 3.0
sc.pp.neighbors(adata, n_neighbors=15, random_state=42)
sc.tl.umap(adata, random_state=42)
sc.tl.leiden(adata, resolution=0.8, flavor="igraph", n_iterations=2, directed=False, key_added="leiden")
sc.pl.dotplot(adata, var_names=[f"G{i}" for i in range(n_genes)], groupby="leiden",
              cmap="viridis", dot_max=0.6, smallest_dot=8,
              save="_L2p_dotplot_verified.png")
print("RENDER_OK dotplot_py")

# ---- L2-07P 分组小提琴图 ----
sc.pl.violin(adata, keys=[f"G{i}" for i in range(n_genes)], groupby="leiden",
             palette=["#0072B2", "#D55E00", "#009E73", "#CC79A7"],
             jitter=0.35, size=0.4, save="_L2p_violin_verified.png")
print("RENDER_OK violin_py")