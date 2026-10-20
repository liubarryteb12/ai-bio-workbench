#!/usr/bin/env python3
"""探针：确认 layers['counts'] 是否为原始整数计数 + 验证 log2FC 口径。"""
import warnings

import anndata as ad
import numpy as np
import scipy.sparse as sp

warnings.filterwarnings("ignore")
a = ad.read_h5ad("/mnt/ssd/bio_data/line2_scrna/processed/scrna_composition.h5ad")
c = a.layers["counts"]
print("X: dtype=%s min=%g max=%g sparse=%s"
      % (a.X.dtype, a.X.min(), a.X.max(), sp.issparse(a.X)))
print("counts: dtype=%s min=%g max=%g sparse=%s"
      % (c.dtype, c.min(), c.max(), sp.issparse(c)))
carr = np.asarray(c.todense()) if sp.issparse(c) else np.asarray(c)
print("counts integer-like: %s" % np.allclose(carr, np.round(carr)))
print("counts per-cell sum range: %.0f - %.0f"
      % (carr.sum(axis=1).min(), carr.sum(axis=1).max()))
print("counts nnz frac=%.3f" % (np.count_nonzero(carr) / carr.size))

# 重算 lognorm 后看分布
w = a.copy()
w.X = w.layers["counts"].copy()
import scanpy as sc
sc.pp.normalize_total(w, target_sum=1e4)
print("after normalize_total: X max=%g (期望 ~1e4 量级)" % w.X.max())
sc.pp.log1p(w)
print("after log1p: X max=%g (期望 log1p(1e4)~9.2)" % w.X.max())
