# s4_moran_probe2：定稿探针（权重对称化 + 解析正态近似 z/p + 已知基因 sanity）
import time

import numpy as np
import anndata as ad
from scipy.sparse import csr_matrix
from scipy.spatial import cKDTree

ad.settings.allow_write_nullable_strings = False

PATHS = {
    "mouse": "/mnt/ssd/bio_data/line3_spatial/processed/spatial_marker_mouse.h5ad",
    "human": "/mnt/ssd/bio_data/line3_spatial/processed/spatial_marker_human.h5ad",
}
K_NN = 6


def build_knn_weights(coords, k):
    """逐样本像素 KNN 权重：建树 -> KNN -> 对称化(w+w.T) -> 行标准化。
    跨样本坐标范围重叠，禁在全数据集上建树（坑 #114）。"""
    n = coords.shape[0]
    tree = cKDTree(coords)
    _, idx = tree.query(coords, k=k + 1)
    rows = np.repeat(np.arange(n), k)
    cols = idx[:, 1:].ravel()
    w = csr_matrix((np.ones(n * k), (rows, cols)), shape=(n, n))
    w = w + w.T
    row_sums = np.asarray(w.sum(axis=1)).ravel()
    row_sums[row_sums == 0] = 1.0
    w = csr_matrix(w.multiply(1.0 / row_sums[:, None]))
    return w


def cliff_ord_moments(w, n):
    """行标准化权重下 Cliff-Ord 随机化假设的 E[I] 与 Var[I]（正态近似，esda norm 模式同式）。"""
    s0 = float(w.sum())
    w_dense_sq = w.multiply(w)  # 逐元素平方（稀疏）
    s1 = float((w_dense_sq + w_dense_sq.T).sum()) / 2.0
    deg = np.asarray(w.sum(axis=1)).ravel() + np.asarray(w.sum(axis=0)).ravel()
    s2 = float((deg ** 2).sum())
    ei = -1.0 / (n - 1)
    var_i = (n * n * s1 - n * s2 + 3.0 * s0 * s0) / ((n * n - 1.0) * s0 * s0) - ei * ei
    return ei, var_i


for species, path in PATHS.items():
    a = ad.read_h5ad(path)
    symbols = a.var["gene_symbol"].to_numpy()
    print("=== %s" % species)
    t_all = time.time()
    i_rows, z_rows, valid_rows = [], [], []
    for sample in sorted(a.obs["sample_id"].unique()):
        mask = (a.obs["sample_id"] == sample).to_numpy()
        sub = a[mask]
        x = np.asarray(sub.X.todense())
        n = x.shape[0]
        w = build_knn_weights(np.asarray(sub.obsm["spatial"]), K_NN)
        ei, var_i = cliff_ord_moments(w, n)
        t0 = time.time()
        xc = x - x.mean(axis=0, keepdims=True)
        denom = (xc ** 2).sum(axis=0)
        lag = w @ xc
        i_vec = (n / float(w.sum())) * (xc * lag).sum(axis=0) / denom
        sd = np.sqrt(max(var_i, 1e-30))
        z_vec = (i_vec - ei) / sd
        finite = np.isfinite(i_vec)
        i_rows.append(i_vec)
        z_rows.append(np.where(finite, z_vec, np.nan))
        valid_rows.append(finite.astype(np.int8))
        print("  %s n=%d E[I]=%.5f sd=%.5f %.1fs" % (sample, n, ei, sd, time.time() - t0))
    i_mat = np.vstack(i_rows)
    z_mat = np.vstack(z_rows)
    valid = np.vstack(valid_rows)
    i_mean = np.nanmean(i_mat, axis=0)
    z_mean = np.nanmean(z_mat, axis=0)
    n_valid = valid.sum(axis=0)
    order = np.argsort(-i_mean)
    print("moran+z %.1fs | top10: %s" % (time.time() - t_all,
          " ".join("%s(I=%.2f,z=%.0f)" % (symbols[g], i_mean[g], z_mean[g]) for g in order[:10])))
    known = {"mouse": ["Apoa2", "Mup3", "Cyp2c69", "Hamp", "Cd5l", "Spp1"],
             "human": ["ALB", "APOA1", "CYP2A6", "CES1", "MARCO", "C1QB"]}[species]
    for gene in known:
        idxs = np.where(symbols == gene)[0]
        if len(idxs):
            g = idxs[0]
            print("  %-8s I=%.3f z=%.1f n_valid=%d" % (gene, i_mean[g], z_mean[g], n_valid[g]))
    nan_genes = int((n_valid == 0).sum())
    print("  全零表达基因(nan)=%d / %d" % (nan_genes, a.shape[1]))
    # 对称化前后对比：与 probe1（未对称化）top10 是否一致
    print("PROBE2_MORAN_DONE_%s" % species)
