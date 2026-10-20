# s4_qc_probe.py：S4 步骤 2 QC 原型探针：spot 级指标分布 + 线粒体比例 + 跨样本差异
import numpy as np
import anndata as ad
import pandas as pd

PROCESSED = "/mnt/ssd/bio_data/line3_spatial/processed"

for tag in ("mouse", "human"):
    a = ad.read_h5ad("%s/spatial_counts_%s.h5ad" % (PROCESSED, tag))
    print("=== %s === spots=%d genes=%d" % (tag, a.n_obs, a.n_vars))
    mito_prefix = "mt-" if tag == "mouse" else "MT-"
    mito_mask = a.var["gene_symbol"].str.startswith(mito_prefix).to_numpy()
    print("mito_genes=%d (prefix %s)" % (mito_mask.sum(), mito_prefix))
    mito_total = np.asarray(a[:, mito_mask].X.sum(axis=1)).ravel()
    ncount = a.obs["ncount"].to_numpy()
    nfeature = a.obs["nfeature"].to_numpy()
    pct = mito_total / np.maximum(ncount, 1) * 100
    print("pct_mito: min=%.2f p1=%.2f med=%.2f p99=%.2f max=%.2f" % (
        pct.min(), np.percentile(pct, 1), np.median(pct), np.percentile(pct, 99), pct.max()))
    print("ncount : min=%d p1=%d med=%d p99=%d max=%d" % (
        ncount.min(), np.percentile(ncount, 1), np.median(ncount), np.percentile(ncount, 99), ncount.max()))
    print("nfeature: min=%d p1=%d med=%d p99=%d max=%d" % (
        nfeature.min(), np.percentile(nfeature, 1), np.median(nfeature), np.percentile(nfeature, 99), nfeature.max()))
    # 逐样本分布
    df = pd.DataFrame({"sample_id": a.obs["sample_id"].to_numpy(),
                       "group": a.obs["group"].to_numpy(),
                       "ncount": ncount, "nfeature": nfeature, "pct_mito": pct})
    agg = df.groupby(["sample_id", "group"], sort=True).agg(
        spots=("ncount", "size"),
        ncount_med=("ncount", "median"), ncount_min=("ncount", "min"),
        nfeat_med=("nfeature", "median"), nfeat_min=("nfeature", "min"),
        mito_med=("pct_mito", "median"), mito_max=("pct_mito", "max"))
    print(agg.to_string())
    # 低指标 spot 候选量（常见扫描阈值试算）
    for cmin in (100, 200, 300, 500):
        for gmin in (50, 100, 200, 300):
            low = (ncount < cmin) | (nfeature < gmin)
            if low.sum() > 0:
                print("trial ncount<%d or nfeature<%d -> %d spots (%.2f%%)" % (
                    cmin, gmin, low.sum(), low.mean() * 100))
    # 线粒体高比例 spot
    for thr in (20, 30, 50):
        high = pct > thr
        print("pct_mito>%d -> %d spots (%.2f%%)" % (thr, high.sum(), high.mean() * 100))
    # 零计数 spot / 单基因 spot
    print("zero_count_spots=%d single_gene_spots=%d" % ((ncount == 0).sum(), (nfeature <= 1).sum()))
    # 基因级：跨 spot 表达数
    nspots_per_gene = np.diff(a.X.tocsr().indptr)
    print("genes with 0 spots=%d, 1 spot=%d, <3 spots=%d (of %d)" % (
        (nspots_per_gene == 0).sum(), (nspots_per_gene == 1).sum(),
        (nspots_per_gene < 3).sum(), a.n_vars))
    print()
