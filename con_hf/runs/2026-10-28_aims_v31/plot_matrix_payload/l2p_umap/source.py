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
sc.settings.set_figure_params(dpi=300, frameon=False, fontsize=7, vector_friendly=True)
sc.pl.umap(adata, color="leiden", palette=["#0072B2", "#D55E00", "#009E73", "#CC79A7"],
           size=8, title="scanpy UMAP (leiden)",
           save="_L2p_umap_verified.png")
print("clusters:", adata.obs["leiden"].nunique(), "| cells:", adata.n_obs)
print("RENDER_OK umap_scanpy")
