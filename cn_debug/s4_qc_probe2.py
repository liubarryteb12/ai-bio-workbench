# s4_qc_probe2.py：阈值设计二探针：边缘聚集性 + 准则重叠 + 候选阈值终值
import numpy as np
import anndata as ad
import pandas as pd

PROCESSED = "/mnt/ssd/bio_data/line3_spatial/processed"

for tag in ("mouse", "human"):
    a = ad.read_h5ad("%s/spatial_counts_%s.h5ad" % (PROCESSED, tag))
    print("=== %s ===" % tag)
    mito_prefix = "mt-" if tag == "mouse" else "MT-"
    mito_mask = a.var["gene_symbol"].str.startswith(mito_prefix).to_numpy()
    mito_total = np.asarray(a[:, mito_mask].X.sum(axis=1)).ravel()
    ncount = a.obs["ncount"].to_numpy()
    nfeature = a.obs["nfeature"].to_numpy()
    pct = mito_total / np.maximum(ncount, 1) * 100
    row = a.obs["array_row"].to_numpy()
    col = a.obs["array_col"].to_numpy()
    sid = a.obs["sample_id"].to_numpy()

    # 候选阈值下的各准则命中
    c_low = (ncount < 100) | (nfeature < 50)
    c_mito20 = pct > 20
    c_mito50 = pct > 50
    print("criterion ncount<100|nfeature<50: %d (%.2f%%)" % (c_low.sum(), c_low.mean() * 100))
    print("criterion pct_mito>20: %d (%.2f%%)" % (c_mito20.sum(), c_mito20.mean() * 100))
    print("criterion pct_mito>50: %d (%.2f%%)" % (c_mito50.sum(), c_mito50.mean() * 100))
    print("overlap low&mito20: %d" % (c_low & c_mito20).sum())
    print("union low|mito20: %d (%.2f%%)" % ((c_low | c_mito20).sum(), (c_low | c_mito20).mean() * 100))
    print("union low|mito50: %d (%.2f%%)" % ((c_low | c_mito50).sum(), (c_low | c_mito50).mean() * 100))

    # 边缘聚集性：命中 spot 的 array 坐标是否偏向捕获区边缘
    # 每样本内 row/col 的 min/max 定义该样本网格边界
    edge_hits = []
    edge_total = []
    for sf in np.unique(sid):
        m = sid == sf
        r, c = row[m], col[m]
        rmin, rmax, cmin, cmax = r.min(), r.max(), c.min(), c.max()
        # 距边界 1 格内算边缘（in_tissue spot 的边界即组织边缘）
        is_edge = (r <= rmin + 1) | (r >= rmax - 1) | (c <= cmin + 1) | (c >= cmax - 1)
        hits = (c_low | c_mito20)[m]
        edge_hits.append(int((hits & is_edge).sum()))
        edge_total.append(int(hits.sum()))
    print("filtered spots at grid edge: %d / %d (%.1f%%)" % (
        sum(edge_hits), sum(edge_total),
        100.0 * sum(edge_hits) / max(sum(edge_total), 1)))

    # 逐样本终值（low|mito20）
    keep = ~(c_low | c_mito20)
    df = pd.DataFrame({"sample_id": sid, "ncount": ncount, "nfeature": nfeature,
                       "pct_mito": pct, "keep": keep})
    g = df.groupby("sample_id").agg(
        spots=("keep", "size"), dropped=("keep", lambda s: int((~s).sum())))
    g["drop_pct"] = (g["dropped"] / g["spots"] * 100).round(2)
    print(g.to_string())

    # 过滤后残留矩阵的基本盘
    print("kept spots=%d (%.2f%%)" % (keep.sum(), keep.mean() * 100))
    ka = a[keep]
    n_per_gene = np.diff(ka.X.tocsr().indptr)
    print("after filter: genes with <3 spots=%d / %d" % ((n_per_gene < 3).sum(), ka.n_vars))

    # 样本间中位数差异（报告用，不过滤）
    print("per-sample ncount med range: %.0f - %.0f" % (
        df.groupby("sample_id")["ncount"].median().min(),
        df.groupby("sample_id")["ncount"].median().max()))
    print("per-sample pct_mito med range: %.2f - %.2f" % (
        df.groupby("sample_id")["pct_mito"].median().min(),
        df.groupby("sample_id")["pct_mito"].median().max()))
    print()
