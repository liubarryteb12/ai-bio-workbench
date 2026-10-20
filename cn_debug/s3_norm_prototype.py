# S3 步骤 3 归一化/高变基因一次性原型：验证 ERCC 剔除 + normalize_total + log1p + HVG
# 用完即弃，不进 src/。运行：python3 s3_norm_prototype.py <h5ad>
import sys
import numpy as np
import anndata as ad
import scanpy as sc

h5ad_path = sys.argv[1]
adata = ad.read_h5ad(h5ad_path)
print("loaded", adata.shape, "ercc genes:", int(adata.var["ercc"].sum()))

# ERCC 剔除（spike-in 不进归一化与 HVG）
ercc_mask = adata.var["ercc"].to_numpy(dtype=bool)
adata = adata[:, ~ercc_mask].copy()
print("after ercc removal", adata.shape)

lib_before = np.asarray(adata.X.sum(axis=1)).ravel()
print("lib_before min/median/max = %.0f %.0f %.0f" % (lib_before.min(), np.median(lib_before), lib_before.max()))

sc.pp.normalize_total(adata, target_sum=1e4)
lib_after = np.asarray(adata.X.sum(axis=1)).ravel()
print("lib_after min/median/max = %.6f %.6f %.6f" % (lib_after.min(), np.median(lib_after), lib_after.max()))
print("lib_after allclose 1e4:", bool(np.allclose(lib_after, 1e4, rtol=1e-4)))

sc.pp.log1p(adata)
X = adata.X
print("X after log1p min/max = %.4f %.4f" % (X.min(), X.max()))
print("X finite:", bool(np.isfinite(X.data).all()))

# HVG：seurat flavor，n_top_genes=2000（BJD 论文 Seurat 默认口径）
sc.pp.highly_variable_genes(adata, flavor="seurat", n_top_genes=2000)
hvg = adata.var["highly_variable"].to_numpy(dtype=bool)
print("hvg=%d / %d" % (hvg.sum(), adata.shape[1]))
print("hvg ercc overlap:", int((hvg & adata.var["ercc"].to_numpy(dtype=bool)).sum()) if "ercc" in adata.var else "n/a (ercc removed)")
means = np.asarray(adata.X.mean(axis=0)).ravel()
print("hvg mean range: %.4f - %.4f" % (means[hvg].min(), means[hvg].max()))
print("non-hvg mean range: %.4f - %.4f" % (means[~hvg].min(), means[~hvg].max()))
top = adata.var.index[hvg][:20]
print("top20 hvg:", " ".join(list(top)))
print("PROTOTYPE_DONE")
