# s4_cooccur_probe：步骤 8 原型探针（逐样本 domain 邻域共现 + 置换 z 定稿验证）
import time

import numpy as np
import anndata as ad
from scipy.sparse import csr_matrix
from scipy.spatial import cKDTree

ad.settings.allow_write_nullable_strings = False

PATHS = {
    "mouse": "/mnt/ssd/bio_data/line3_spatial/processed/spatial_autocorr_mouse.h5ad",
    "human": "/mnt/ssd/bio_data/line3_spatial/processed/spatial_autocorr_human.h5ad",
}
K_NN = 6
N_PERM = 100


def build_knn_weights(coords, k):
    """逐样本像素 KNN 权重：建树 -> KNN -> 对称化 -> 行标准化（与步骤 7 同构）。"""
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


def cooccurrence(w, labels, n_types):
    """domain 共现矩阵：C[di,dj] = sum_i sum_j w_ij [label_i=di][label_j=dj]
    （行标准化权重下每 spot 邻居权重和 1，矩阵行和 = 该类型 spot 数比例口径）。"""
    # 标签 one-hot (n, n_types)，C = onehot.T @ W @ onehot
    oh = csr_matrix((np.ones(len(labels)), (np.arange(len(labels)), labels)),
                    shape=(len(labels), n_types))
    c = (oh.T @ w @ oh).toarray()
    return c


def enrichment_z(w, labels, n_types, n_perm, rng):
    """squidpy nhood_enrichment 思路：共现矩阵对置换零模型的 z。
    置换保持几何权重不变、只打乱 domain 标签。"""
    c_obs = cooccurrence(w, labels, n_types)
    perm_stack = np.empty((n_perm, n_types, n_types))
    for p in range(n_perm):
        perm_stack[p] = cooccurrence(w, rng.permutation(labels), n_types)
    mu = perm_stack.mean(axis=0)
    sd = perm_stack.std(axis=0, ddof=1)
    sd[sd == 0] = 1.0
    z = (c_obs - mu) / sd
    return c_obs, z


for species, path in PATHS.items():
    a = ad.read_h5ad(path)
    print("=== %s" % species)
    t_all = time.time()
    rng = np.random.default_rng(20261013)
    for sample in sorted(a.obs["sample_id"].unique()):
        mask = (a.obs["sample_id"] == sample).to_numpy()
        sub = a[mask]
        dom = sub.obs["domain"].astype("category")
        labels = dom.cat.codes.to_numpy()
        n_types = len(dom.cat.categories)
        t0 = time.time()
        w = build_knn_weights(np.asarray(sub.obsm["spatial"]), K_NN)
        c_obs, z = enrichment_z(w, labels, n_types, N_PERM, rng)
        # 每 domain 的同域富集 z（对角）
        diag_z = np.diag(z)
        # 归一化共现（行内比例）：C_norm[di,dj] = C[di,dj] / sum_j C[di,j]
        row = c_obs.sum(axis=1)
        c_norm = c_obs / np.where(row[:, None] == 0, 1, row[:, None])
        same_frac = np.diag(c_norm)
        print("  %s n=%d types=%d %.1fs | diag_z mean=%.2f min=%.2f max=%.2f | same_frac mean=%.3f min=%.3f max=%.3f"
              % (sample, w.shape[0], n_types, time.time() - t0,
                 diag_z.mean(), diag_z.min(), diag_z.max(),
                 same_frac.mean(), same_frac.min(), same_frac.max()))
    print("%s cooccur+perm done %.1fs" % (species, time.time() - t_all))
