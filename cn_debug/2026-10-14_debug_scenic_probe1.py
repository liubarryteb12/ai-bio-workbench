"""SCENIC 可行性探针（探针 1/2）：输入矩阵规格 + 基因过滤阈值 + GRNBoost2 计时。

只读，不改任何数据面文件。用于决定 GRN 推断的基因空间与是否可在手机端完成。
"""
import time

import numpy as np
import anndata as ad

ad.settings.allow_write_nullable_strings = False

PATH = "/mnt/ssd/bio_data/line2_scrna/processed/scrna_norm.h5ad"

t0 = time.time()
a = ad.read_h5ad(PATH)
print("loaded shape=%s in %.1fs" % (a.shape, time.time() - t0))
print("X dtype=%s type=%s" % (a.X.dtype, type(a.X).__name__))
print("obs cols:", list(a.obs.columns))
print("var cols:", list(a.var.columns))
print("layers:", list(a.layers.keys()))
print("obsm:", list(a.obsm.keys()))

X = a.X
if hasattr(X, "tocsc"):
    Xc = X.tocsc()
    nnz_per_gene = np.diff(Xc.indptr)
else:
    nnz_per_gene = (np.asarray(X) > 0).sum(axis=0)

print("\ngene expression breadth (cells with count>0):")
for thr in [1, 3, 5, 10, 20, 50, 100]:
    n = int((nnz_per_gene >= thr).sum())
    print("  genes in >=%3d cells: %5d" % (thr, n))

print("\ncell library size (post-normalize should be 1e4):")
if hasattr(X, "tocsr"):
    lib = np.asarray(X.tocsr().sum(axis=1)).ravel()
else:
    lib = np.asarray(X).sum(axis=1)
print("  min=%.1f median=%.1f max=%.1f" % (lib.min(), np.median(lib), lib.max()))

print("\ncelltype distribution:")
print(a.obs["celltype"].astype(str).value_counts().to_string())

print("\nelapsed=%.1fs" % (time.time() - t0))
