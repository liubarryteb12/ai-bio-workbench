#!/usr/bin/env python3
"""探针5（定稿口径 + 计时）：向量化 domain-pair LR score。

向量化推导（与探针3 的逐 pair 定义严格一致，只是算法不同）：
  score(p; di, dj) = sum_i sum_j lv_ip * w_ij * rv_jp * 1[dom_i=di] * 1[dom_j=dj]

分两步稀疏乘：
  1) rec_side[p, i, dj] = sum_j w_ij * rv_jp * 1[dom_j=dj]
     实现：M_dj = W @ (rv * mask_dj)          # spots x pairs（W 稀疏，右乘 dense 转 csr）
  2) score[p, di, dj] = sum_i lv_ip * 1[dom_i=di] * M_dj[i, p]
     实现：score[:, :, dj] = (lv * mask_di).T @ M_dj    # pairs x n_dom

mask_di/mask_dj 都是 0/1 向量，逻辑与 onehot 聚合一致。

归一化口径：除以 domain-pair 的权重质量 mass[di,dj] = sum_{i in di, j in dj} w_ij，
得到"该域对每单位邻域质量的 LR 强度"，消除域大小差异（与步骤 9 rank 对齐精神一致：
域间规模不可比，对齐的是方向与单位质量强度）。
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
    n_pairs = len(pair_names)
    print("%s: mapped %d / %d pairs" % (tag, n_pairs, len(pairs)))

    X = a.X.tocsc()
    L = np.asarray(X[:, lig_idx].toarray(), dtype=float)   # spots x pairs
    R = np.asarray(X[:, rec_idx].toarray(), dtype=float)   # spots x pairs
    dom = a.obs["domain"].astype(str).to_numpy()
    doms = sorted(set(dom.tolist()))
    n_dom = len(doms)
    dom_code = {d: i for i, d in enumerate(doms)}
    dcodes = np.array([dom_code[d] for d in dom])
    masks = [dcodes == k for k in range(n_dom)]
    samples = a.obs["sample_id"].astype(str).to_numpy()

    total = np.zeros((n_pairs, n_dom, n_dom))
    mass = np.zeros((n_dom, n_dom))
    t0 = time.time()
    for sample in sorted(set(samples.tolist())):
        sm = samples == sample
        w = build_knn_weights(np.asarray(a.obsm["spatial"])[sm], K_NN)
        lv = np.asarray(L[sm], dtype=float)
        rv = np.asarray(R[sm], dtype=float)
        sub_masks = [np.asarray(m[sm], dtype=float) for m in masks]
        for dj in range(n_dom):
            m = sub_masks[dj]
            if not m.any():
                continue
            rhs = rv * m[:, None]
            rec_side = np.asarray((w @ csr_matrix(rhs)).toarray())  # spots x pairs（toarray 是 ndarray，todense 是 matrix）
            for di in range(n_dom):
                mi = sub_masks[di]
                if not mi.any():
                    continue
                total[:, di, dj] += np.einsum(
                    'ip,ip->p', lv * mi[:, None], rec_side)
                mass[di, dj] += float(
                    mi @ np.asarray((w @ csr_matrix(m[:, None])).toarray()).ravel())
    elapsed = time.time() - t0
    print("  向量化 score 耗时 %.1fs" % elapsed)
    mass_safe = np.where(mass > 0, mass, 1.0)
    norm = total / mass_safe[None, :, :]
    # 每样本单位质量平均（再除以样本数？不，mass 已含全部样本权重质量，norm 已是全物种每单位质量强度）
    top_pairs = np.dstack(np.unravel_index(np.argsort(-norm.ravel())[:20], norm.shape))[0]
    print("  top20 单位质量 LR->domain-pair:")
    seen = set()
    shown = 0
    for pi, dli, dri in top_pairs:
        key = (doms[dli], doms[dri])
        if key in seen:
            continue
        seen.add(key)
        print("    %s -> %s : pair=%s-%s score=%.3f"
              % (doms[dli], doms[dri], pair_names[pi][0], pair_names[pi][1], norm[pi, dli, dri]))
        shown += 1
        if shown >= 8:
            break
    print("  全流程(含读盘) %.1fs" % (time.time() - t_start))
