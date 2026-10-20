# S3 步骤 4 去批次/整合一次性原型：验证 HVG→scale→PCA→harmony 链路与 donor 混合效果
# 用完即弃，不进 src/。运行：python3 s3_integrate_prototype.py <h5ad>
import sys
import numpy as np
import anndata as ad
import scanpy as sc
import scanpy.external as sce
from sklearn.metrics import silhouette_score

h5ad_path = sys.argv[1]
adata = ad.read_h5ad(h5ad_path)
print("loaded", adata.shape)

# HVG 子集 → scale → PCA
hvg = adata.var["highly_variable"].to_numpy(dtype=bool)
print("hvg genes:", int(hvg.sum()))
adata = adata[:, hvg].copy()
sc.pp.scale(adata, max_value=10)
sc.tl.pca(adata, n_comps=50)
print("pca shape", adata.obsm["X_pca"].shape)
vr = adata.uns["pca"]["variance_ratio"]
print("pca var ratio PC1-5:", " ".join("%.4f" % v for v in vr[:5]))
print("pca var ratio cum 10/30/50: %.4f %.4f %.4f" % (vr[:10].sum(), vr[:30].sum(), vr[:50].sum()))

# donor 混合度：silhouette（donor 标签，前 10 PC，越低越混合）
labels = adata.obs["donor"].to_numpy()
sil_before = silhouette_score(adata.obsm["X_pca"][:, :10], labels)
print("donor silhouette before harmony: %.4f" % sil_before)

# harmony 校正（绕过 scanpy 包装器：1.12.4 的 harmony_integrate 对 Z_corr 做了 .T，
# 与容器内 harmonypy 返回形状不兼容，obsm 校验直接 ValueError。原生调用形状正确）
import harmonypy
ho = harmonypy.run_harmony(adata.obsm["X_pca"], adata.obs, "donor", random_state=20261013)
print("Z_corr type", type(ho.Z_corr).__name__, "shape", ho.Z_corr.shape)
adata.obsm["X_pca_harmony"] = np.asarray(ho.Z_corr)
print("harmony shape", adata.obsm["X_pca_harmony"].shape)
sil_after = silhouette_score(adata.obsm["X_pca_harmony"][:, :10], labels)
print("donor silhouette after harmony: %.4f" % sil_after)

emb_b = adata.obsm["X_pca"][:, :10]
emb_a = adata.obsm["X_pca_harmony"][:, :10]
print("finite before/after:", bool(np.isfinite(emb_b).all()), bool(np.isfinite(emb_a).all()))
print("scale before/after (std of first comp): %.4f %.4f" % (emb_b[:, 0].std(), emb_a[:, 0].std()))

# 供体-组混淆提示：每个 donor 出现在哪些组
import pandas as pd
print(pd.crosstab(adata.obs["donor"], adata.obs["group"]))
print("PROTOTYPE_DONE")
