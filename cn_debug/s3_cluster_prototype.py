# S3 步骤 5 降维与聚类一次性原型：验证 X_pca_harmony 上 neighbors/UMAP/leiden 链路
# 用完即弃，不进 src/。运行：python3 s3_cluster_prototype.py <h5ad>
import sys
import numpy as np
import anndata as ad
import scanpy as sc

h5ad_path = sys.argv[1]
adata = ad.read_h5ad(h5ad_path)
print("loaded", adata.shape)
print("obsm", list(adata.obsm.keys()))
print("uns integration", adata.uns.get("integration"))

SEED = 20261013

# neighbors on X_pca_harmony（校正后嵌入）
sc.pp.neighbors(adata, n_neighbors=15, n_pcs=30, use_rep="X_pca_harmony", random_state=SEED)
print("neighbors OK", list(adata.obsp.keys()))

# leiden
sc.tl.leiden(adata, flavor="igraph", resolution=1.0, random_state=SEED)
n_clusters = adata.obs["leiden"].nunique()
print("leiden clusters:", n_clusters)
print(adata.obs["leiden"].value_counts().to_dict())

# UMAP：先测 umap-learn 是否真的缺位
try:
    sc.tl.umap(adata, random_state=SEED)
    print("umap OK", adata.obsm["X_umap"].shape)
except Exception as e:
    print("umap FAILED:", type(e).__name__, str(e)[:300])

# 聚类 x group / donor 交叉
import pandas as pd
print(pd.crosstab(adata.obs["leiden"], adata.obs["group"]))
print(pd.crosstab(adata.obs["leiden"], adata.obs["donor"]))
print("PROTOTYPE_DONE")
