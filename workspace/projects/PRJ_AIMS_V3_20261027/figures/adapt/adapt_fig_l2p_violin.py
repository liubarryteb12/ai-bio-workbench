# Master-Source: reference/05.可参考出图代码/L2_组学常用图/L2p_more_code.py | Master-SHA256: 79cf20cbfffbd90e016abef003845540de71948ae8e6031587c420a05038af76
# Adapted-Project: PRJ_AIMS_V3_20261027
# Adapted-Line: line2_scrna
# Adapt-Variable input_data: 项目本线只读输入文件路径，相对于本项目根目录
# Adapt-Variable group_col: 细胞类型列名
# Adapt-Variable value_col: 组成比例列名
ADAPT_VARS = {
  "input_data": "data/line2_scrna/processed/celltype_composition.tsv",
  "group_col": "celltype",
  "value_col": "prop"
}

# Real-Data-Adapter: v1
# Project-Input: data/line2_scrna/processed/celltype_composition.tsv
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
input_data = "/mnt/ssd/bio_data/projects/PRJ_AIMS_V3_20261027/line2_scrna/processed/celltype_composition.tsv"
output_file = "figures/violin_L2p_violin_verified.png"
if not Path(input_data).exists():
    raise FileNotFoundError(f"real input missing: {input_data}")
Path(output_file).parent.mkdir(parents=True, exist_ok=True)

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

raise SystemExit(0)
# Retained master source for byte-level audit; unreachable after successful real-data render.
"""L2 Python 三件套：火山图 / marker 点图 / 分组小提琴图（scanpy + seaborn 风格）"""
import numpy as np, scanpy as sc, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import scanpy.plotting as scp

rng = np.random.default_rng(42)
plt.rcParams.update({"font.size": 7, "axes.linewidth": 0.6, "savefig.dpi": 300})
sc.set_figure_params(dpi=300, dpi_save=300, frameon=False, fontsize=7)

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
