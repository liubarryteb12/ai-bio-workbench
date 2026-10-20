# s4_norm_prototype.py：S4 步骤 3 标准化原型探针（服务器真实数据上验证口径）
# 验证点：var 列与 feature_type、normalize_total+log1p 数值行为、HVG seurat flavor
# 的 n_top 敏感性与 top 基因合理性、计时。
import time

import anndata as ad
import numpy as np
import scanpy as sc

# 坑 #107：pandas 3/2 的 infer_string 默认值不同，显式关掉保证写盘行为一致
ad.settings.allow_write_nullable_strings = False

PROCESSED = "/mnt/ssd/bio_data/line3_spatial/processed"
SPECIES_FILES = {
    "mouse": "spatial_qc_mouse.h5ad",
    "human": "spatial_qc_human.h5ad",
}

for tag, fname in SPECIES_FILES.items():
    t0 = time.time()
    a = ad.read_h5ad("%s/%s" % (PROCESSED, fname))
    print("=== %s ===" % tag, flush=True)
    print("shape spots=%d genes=%d" % a.shape, flush=True)
    print("obs cols=%s" % list(a.obs.columns), flush=True)
    print("var cols=%s" % list(a.var.columns), flush=True)
    if "feature_type" in a.var.columns:
        print("feature_type counts=%s" % a.var["feature_type"].value_counts().to_dict(), flush=True)
    print("X format=%s dtype=%s nnz=%d" % (a.X.getformat(), a.X.dtype, a.X.nnz), flush=True)
    print("uns keys=%s" % sorted(a.uns.keys()), flush=True)

    # 原始整数计数层
    if not np.issubdtype(a.X.dtype, np.integer):
        print("WARN: X dtype 非整数: %s" % a.X.dtype, flush=True)
    counts = a.X.copy()
    a.layers["counts"] = counts

    # 归一化（每 spot 缩到 1e4 后 log1p）
    sc.pp.normalize_total(a, target_sum=1e4)
    lib = np.asarray(a.X.sum(axis=1)).ravel()
    print("lib_after min=%.6f max=%.6f median=%.6f" % (lib.min(), lib.max(), float(np.median(lib))), flush=True)
    sc.pp.log1p(a)
    print("X_after_log finite=%s min=%.4f max=%.4f" % (bool(np.isfinite(a.X.data).all()), a.X.data.min(), a.X.data.max()), flush=True)

    # HVG seurat flavor，试两档 n_top
    for n_top in (2000, 3000):
        b = a.copy()
        sc.pp.highly_variable_genes(b, flavor="seurat", n_top_genes=n_top)
        hvg = b.var["highly_variable"].to_numpy(dtype=bool)
        print("n_top=%d hvg=%d means=%.4f-%.4f disp_norm=%.4f-%.4f"
              % (n_top, int(hvg.sum()),
                 float(b.var["means"][hvg].min()), float(b.var["means"][hvg].max()),
                 float(b.var["dispersions_norm"][hvg].min()), float(b.var["dispersions_norm"][hvg].max())),
              flush=True)
        top = b.var[hvg].sort_values("dispersions_norm", ascending=False)
        print("top20_symbols=%s" % " ".join(list(top["gene_symbol"][:20])), flush=True)
        # mito 基因进 HVG 的情况
        mito = top["gene_symbol"].str.startswith("mt-" if tag == "mouse" else "MT-")
        print("mito_in_top=%d" % int(mito.sum()), flush=True)

    print("elapsed=%.1fs" % (time.time() - t0), flush=True)
print("PROTOTYPE_DONE", flush=True)
