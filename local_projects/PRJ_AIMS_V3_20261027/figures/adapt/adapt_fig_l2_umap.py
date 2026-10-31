# Master-Source: reference/05.可参考出图代码/L2_组学常用图/L2p_umap_code.py | Master-SHA256: 34b79c4febb105c93cd31d80b6d6ebdde4fc7870ad3f8a15e16ad098d8c2ee7d
# Adapted-Project: PRJ_AIMS_V3_20261027
# Adapted-Line: line2_scrna
# Adapt-Variable input_data: 项目本线只读输入文件路径，相对于本项目根目录
# Adapt-Variable group_col: 细胞分组列名
ADAPT_VARS = {
  "input_data": "data/line2_scrna/processed/scrna_clustered.h5ad",
  "group_col": "leiden"
}

# Real-Data-Adapter: v1
# Project-Input: data/line2_scrna/processed/scrna_clustered.h5ad
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
input_data = "/mnt/ssd/bio_data/projects/PRJ_AIMS_V3_20261027/line2_scrna/processed/scrna_clustered.h5ad"
output_file = "umap_L2p_umap_verified.png"
if not Path(input_data).exists():
    raise FileNotFoundError(f"real input missing: {input_data}")
Path(output_file).parent.mkdir(parents=True, exist_ok=True)

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

raise SystemExit(0)
# Retained master source for byte-level audit; unreachable after successful real-data render.
"""L2 Python scanpy UMAP 图。

用途：展示单细胞聚类在二维 UMAP 嵌入中的分离结构。
输入数据契约：AnnData 的 X 为细胞乘基因矩阵；本脚本内置可复现示例数据。
关键函数：scanpy.pp.neighbors()、scanpy.tl.umap()、scanpy.tl.leiden() 与 scanpy.pl.umap()。
"""
import numpy as np, scanpy as sc, matplotlib
matplotlib.use("Agg")

rng = np.random.default_rng(42)
n_per, k = 300, 4
centers = rng.normal(0, 6, size=(k, 20))
X = np.vstack([centers[i] + rng.normal(0, 1.2, size=(n_per, 20)) for i in range(k)])
adata = sc.AnnData(X.astype("float32"))
adata.var_names = [f"G{i}" for i in range(X.shape[1])]

sc.pp.neighbors(adata, n_neighbors=15, random_state=42)
sc.tl.umap(adata, random_state=42)
sc.tl.leiden(adata, resolution=0.8, flavor="igraph", n_iterations=2, directed=False, key_added="leiden")

sc.settings.figdir = "."
sc.settings.autoshow = False
sc.settings.set_figure_params(dpi=300, dpi_save=300, frameon=False, fontsize=7, vector_friendly=True)
sc.pl.umap(adata, color="leiden", palette=["#0072B2", "#D55E00", "#009E73", "#CC79A7"],
           size=8, title="scanpy UMAP (leiden)",
           save="_L2p_umap_verified.png")
print("clusters:", adata.obs["leiden"].nunique(), "| cells:", adata.n_obs)
print("RENDER_OK umap_scanpy")
