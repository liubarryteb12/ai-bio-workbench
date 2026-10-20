#!/usr/bin/env python3
"""探针4：向量化 domain-pair LR score（替代逐 pair 循环）。

向量化推导：score(p; di, dj) = sum_i sum_j lv_i[p] * w_ij * rv_j[p] * 1[dom_i=di] * 1[dom_j=dj]
                          = sum_i lv_i[p] * 1[dom_i=di] * (sum_j w_ij * rv_j[p] * 1[dom_j=dj])
定义：
  A[p, i, dj] = sum_j w_ij * rv_j[p] * 1[dom_j=dj]   # 广播一次性算
              = (W @ (R * onehot_j))[p, i]            # 对每个 p 是 W @ diag(rv_p) @ oh
向量化实现：先 W_full = W @ oh（spots x domains，权重按目标域聚合），
  再对每个 spot i 与 pair p：score[p, di, dj] = lv_ip * (W_oh)[i, dj] * rv_jp 的聚合
写成 einsum：
  M = A_lig @ w @ A_rec^T 其中 A_lig[p,i,·] 已经是 onehot 加权
最直接的形式：
  对 pair p: S_p = (diag(lv_p) @ W @ diag(rv_p))  -> domain 聚合
  domain 聚合 = oh.T @ diag(lv_p) @ W @ diag(rv_p) @ oh
             = (oh.T * lv_p) @ W @ (oh * rv_p^T)^T ... 用 einsum 一次算：
             ohT_scaled = onehot.T.multiply(lv_p[:, None])   # domains x spots
             rec_scaled = onehot.multiply(rv_p[:, None])      # spots x domains
             S_p = ohT_scaled @ W @ rec_scaled
全部 pair 一起：批量做 (n_domains x spots) @ (spots x spots) 太奢侈。
替代：对每个 domain 对 (di, dj) 批量算所有 pair。
  lig_mass[p, di] = sum_i lv_ip * 1[dom_i=di]                  # L^T @ oh  (pairs x domains)
  # 需要 sum_i sum_j lv_ip rv_jp w_ij 1[dom_i=di]1[dom_j=dj]
  # = sum_{i,j} (lv_ip 1[di_i]) (rv_jp 1[dj_j]) w_ij
  # 定义 Xp[p,i,j] 太大。改走：W @ (rv_p * 1[dj]) -> 向量 v_p（spots），
  # 再 sum_i lv_ip 1[di_i] v_p[i]
  即 v_p = W @ (rv_p * oh_j)      # spots
     score[p,di,dj] = (lv_p * oh_i).T @ v_p
批量：V[p] = W @ (rv_p * oh_j) 对所有 p 是 (spots x spots) @ (spots x pairs) 一次稀疏乘
       = W @ (rv_cols_masked_by_oh_j)  但 oh_j 依赖 j，只能按 domain 循环（doms 数 3-7 很小）
所以复杂度 = n_domains 次稀疏乘 (spots x spots) @ (spots x pairs)，可接受。
"""
import time

import numpy as np
import anndata as ad
from scipy.sparse import csr_matrix
from scipy.spatial import cKDTree

ad.settings.allow_write_nullable_strings = False
BASE = "/mnt/ssd/bio_data/line3_spatial/processed"

from liana.resource import select_resource
res = select_resource("consensus")
pairs = sorted(set(zip(res["ligand"].astype(str).str.upper(),
                       res["receptor"].astype(str).str.upper())))

K_NN = 6


def build_knn_weights(coords, k):
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


for tag in ["human", "mouse"]:
    t_start = time.time()
    a = ad.read_h5ad(BASE + "/spatial_composition_%s.h5ad" % tag)
    sym_upper = {}
    for i, s in enumerate(a.var["gene_symbol"].astype(str).tolist()):
        sym_upper.setdefault(s.upper(), i)
    lig_idx, rec_idx, pair_names = [], [], []
    for lig, rec in pairs:
        li = sym_upper.get(lig)
        ri = sym_upper.get(rec)
        if li is not None and ri is not None:
            lig_idx.append(li)
            rec_idx.append(ri)
            pair_names.append((lig, rec))
    print("%s: mapped pairs %d / %d" % (tag, len(pair_names), len(pairs)))

    X = a.X.tocsc()
    L = X[:, lig_idx].toarray()
    R = X[:, rec_idx].toarray()
    dom = a.obs["domain"].astype(str).to_numpy()
    doms = sorted(set(dom.tolist()))
    n_dom = len(doms)
    dom_code = {d: i for i, d in enumerate(doms)}
    dcodes = np.array([dom_code[d] for d in dom])
    onehot = csr_matrix((np.ones(len(dcodes)), (np.arange(len(dcodes)), dcodes)),
                        shape=(len(dcodes), n_dom))
    samples = a.obs["sample_id"].astype(str).to_numpy()
    total = np.zeros((len(pair_names), n_dom, n_dom))
    t0 = time.time()
    for sample in sorted(set(samples.tolist())):
        mask = samples == sample
        w = build_knn_weights(np.asarray(a.obsm["spatial"])[mask], K_NN)
        lv = L[mask]              # spots x pairs
        rv = R[mask]
        oh = onehot[mask]         # spots x n_dom
        for dj in range(n_dom):
            # v = W @ (rv * oh[:, dj])   -> spots x pairs
            v = w @ rv.multiply(np.asarray(oh[:, dj].todense()).ravel()[:, None]) \
                if hasattr(rv, "multiply") else w @ csr_matrix(rv * np.asarray(oh[:, dj].todense()).ravel()[:, None])
            # score[p, di] = sum_i lv_ip * oh[i,di] * v[i,p]
            lvm = lv if not hasattr(lv, "multiply") else lv
            scaled = np.asarray(oh.todense()).T @ (lvm * 1.0)   # n_dom x pairs? 不对，见下
        break
    print("  先算一遍 W @ rv 的类型:", type(w @ csr_matrix(rv)).__name__)
    # 正确向量化：V = W @ rv_densemasked -> (spots x n_dom) @ (n_dom x pairs) 太绕，
    # 直接：对每 dj，rw = rv * oh_j（spots x pairs）稀疏不可，rv 是 dense。
    # 最简：把 rv 按 domain 源切成 mask 后 W @ (rv * mask) 逐 dj dense 乘：
    # W 是稀疏，右侧 dense spots x pairs -> 结果 spots x pairs dense。复杂度 W nnz * pairs。
    print("W nnz:", int(w.nnz), "spots:", w.shape[0], "pairs:", lv.shape[1])
    t1 = time.time()
    # 试算一个样本的耗时
    for dj in range(n_dom):
        mask_dj = np.asarray(oh[:, dj].todense()).ravel()
        rhs = rv * mask_dj[:, None]        # spots x pairs
        v = np.asarray(w @ csr_matrix(rhs))   # W(sparse) @ csr(dense 转稀疏) -> dense
    t2 = time.time()
    print("  单样本 %d domains dense 路线 %.2fs（domain 循环）" % (n_dom, t2 - t1))
