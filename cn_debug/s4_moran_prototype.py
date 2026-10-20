# s4_moran_prototype：空间自相关原型探针（逐样本 KNN 权重 + 批量 Moran's I / Geary's C）
# 目标：定稿口径（权重 k / 行标准化 / 基因范围 / p 值路线）+ 计时 + top 基因生物学 sanity
import time

import numpy as np
import pandas as pd
import anndata as ad
from scipy.sparse import csr_matrix
from scipy.spatial import cKDTree

ad.settings.allow_write_nullable_strings = False

PATHS = {
    "mouse": "/mnt/ssd/bio_data/line3_spatial/processed/spatial_marker_mouse.h5ad",
    "human": "/mnt/ssd/bio_data/line3_spatial/processed/spatial_marker_human.h5ad",
}
K_NN = 6  # 每个 spot 的样本内像素最近邻数（squidpy 默认 spatial_neighbors 同量级）


def build_knn_weights(coords, k):
    """逐样本像素 KNN 权重（行标准化）。跨样本坐标范围重叠，禁在全数据集上建树（坑 #114）。"""
    n = coords.shape[0]
    tree = cKDTree(coords)
    dist, idx = tree.query(coords, k=k + 1)  # 第一列是自身
    rows = np.repeat(np.arange(n), k)
    cols = idx[:, 1:].ravel()
    vals = np.ones(n * k, dtype=np.float64)  # 距离权重退化为等权（探针对比距离权重版）
    w = csr_matrix((vals, (rows, cols)), shape=(n, n))
    row_sums = np.asarray(w.sum(axis=1)).ravel()
    row_sums[row_sums == 0] = 1.0
    w = csr_matrix(w.multiply(1.0 / row_sums[:, None]))
    return w


def morans_i_and_geary(w, x):
    """x: (n,) 表达向量。返回 (I, C)。w 行标准化。"""
    n = x.shape[0]
    xc = x - x.mean()
    denom = float((xc ** 2).sum())
    if denom <= 0:
        return np.nan, np.nan
    lag = w @ xc  # 行标准化后 lag_i = mean(neighbor xc)
    s0 = float(w.sum())
    i_val = (n / s0) * float((xc * lag).sum()) / denom
    c_val = ((n - 1) / (2 * s0)) * float(((w @ x - x) ** 2).sum()) / denom
    return i_val, c_val


for species, path in PATHS.items():
    a = ad.read_h5ad(path)
    print("=== %s spots=%d genes=%d" % (species, a.shape[0], a.shape[1]))
    t_all = time.time()
    per_sample = {}
    for sample in sorted(a.obs["sample_id"].unique()):
        mask = (a.obs["sample_id"] == sample).to_numpy()
        sub = a[mask]
        x = np.asarray(sub.X.todense())
        coords = np.asarray(sub.obsm["spatial"])
        w = build_knn_weights(coords, K_NN)
        t0 = time.time()
        # 批量：一次稀疏乘拿全部基因的 lag（W @ X，(n,g)）
        lag = w @ x  # (n,g)
        xc = x - x.mean(axis=0, keepdims=True)
        denom = (xc ** 2).sum(axis=0)  # (g,)
        n = x.shape[0]
        s0 = float(w.sum())
        i_vec = (n / s0) * (xc * lag).sum(axis=0) / denom
        geary_lag = w @ x
        c_vec = ((n - 1) / (2 * s0)) * ((geary_lag - x) ** 2).sum(axis=0) / denom
        per_sample[sample] = (i_vec, c_vec)
        print("  %s n=%d genes=%d %.1fs" % (sample, n, x.shape[1], time.time() - t0))
    i_mat = np.vstack([v[0] for v in per_sample.values()])
    c_mat = np.vstack([v[1] for v in per_sample.values()])
    i_mean = i_mat.mean(axis=0)
    c_mean = c_mat.mean(axis=0)
    print("moran %.1fs | I mean=%.4f min=%.4f max=%.4f | C mean=%.4f"
          % (time.time() - t_all, np.nanmean(i_mean), np.nanmin(i_mean), np.nanmax(i_mean),
             np.nanmean(c_mean)))
    # top 基因（按跨样本 I 均值）与已知空间基因 sanity
    symbols = a.var["gene_symbol"].to_numpy()
    order = np.argsort(-i_mean)
    print("top20 I genes: %s" % " ".join("%s(%.2f)" % (symbols[g], i_mean[g]) for g in order[:20]))
    print("bottom5 I genes: %s" % " " .join("%s(%.2f)" % (symbols[g], i_mean[g]) for g in order[-5:]))
    known = {"mouse": ["Apoa2", "Mup3", "Cyp2c69", "Hamp", "Tmsb4x", "Cd5l", "Spp1"],
             "human": ["ALB", "APOA1", "CYP2A6", "CES1", "MARCO", "C1QB"]}[species]
    hits = {}
    for gene in known:
        idxs = np.where(symbols == gene)[0]
        if len(idxs):
            g = idxs[0]
            hits[gene] = (round(float(i_mean[g]), 3), round(float(c_mean[g]), 3))
    print("known genes (I, C): %s" % hits)
    # 与 marker 域的交叉：巨噬域 top marker（Cd5l）的 I 应显著高于随机基因
    print("PROBE_MORAN_DONE_%s" % species)
