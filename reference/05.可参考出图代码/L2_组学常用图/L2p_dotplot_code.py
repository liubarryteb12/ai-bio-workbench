"""L2 Python 单细胞 marker 点图。

用途：查看 marker 基因在各细胞聚类中的表达比例与平均表达强度。
输入数据契约：AnnData 的 X 为细胞乘基因矩阵，obs 提供聚类标签；本脚本内置可复现示例数据。
关键函数：scanpy.pp.neighbors()、scanpy.tl.leiden() 与 scanpy.pl.dotplot()。
"""

import numpy as np
import scanpy as sc
import matplotlib

matplotlib.use("Agg")

rng = np.random.default_rng(42)
sc.set_figure_params(dpi=300, dpi_save=300, frameon=False, fontsize=7)

n_per = 250
k = 4
n_genes = 6
X = np.vstack([rng.normal(0, 1, size=(n_per, 40)) for _ in range(k)]).astype("float32")
adata = sc.AnnData(X)
adata.var_names = [f"G{i}" for i in range(40)]
adata.obs["leiden"] = np.repeat([f"CT{i + 1}" for i in range(k)], n_per)

for gene_index in range(n_genes):
    adata.X[gene_index::k, gene_index] += 3.0

sc.pp.neighbors(adata, n_neighbors=15, random_state=42)
sc.tl.umap(adata, random_state=42)
sc.tl.leiden(
    adata,
    resolution=0.8,
    flavor="igraph",
    n_iterations=2,
    directed=False,
    key_added="leiden",
)
sc.pl.dotplot(
    adata,
    var_names=[f"G{i}" for i in range(n_genes)],
    groupby="leiden",
    cmap="viridis",
    dot_max=0.6,
    smallest_dot=8,
    save="_L2p_dotplot_verified.png",
)
print("RENDER_OK dotplot_py")
