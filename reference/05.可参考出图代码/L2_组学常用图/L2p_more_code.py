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
