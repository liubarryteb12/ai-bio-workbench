#!/usr/bin/env python3
"""探针3：大小写不敏感匹配后的 LR 覆盖度 + domain 邻域通讯打分口径 + 计时。

口径要点：
- liana consensus 资源是人类命名（大写），物种间用大写归一匹配（小鼠 Title case）。
- 空间打分：配体/受体在像素 KNN 邻域上的"配体源域 x 受体靶域"强度，
  score(l,d,r) = sum_{(i,j) in W} lig_i * rec_j（邻域权重 × 表达乘积，
  squidpy gr.ligrec 同思路零新依赖），再归一化为"每 domain 对平均每 spot 强度"。
- 变换地层：spot 级表达按 domain identity 聚合不夸 domain 身份可比（步骤 9 教训），
  但配受体 score 是 flow（从 A 域流到 B 域），域身份标签本身可比，这一步与
  步骤 9 的"domain 身份私有"不冲突：score 始终在同一份邻域权重内计算。
"""
import time

import numpy as np
import pandas as pd
import anndata as ad
from scipy.sparse import csr_matrix
from scipy.spatial import cKDTree

ad.settings.allow_write_nullable_strings = False
BASE = "/mnt/ssd/bio_data/line3_spatial/processed"

from liana.resource import select_resource
res = select_resource("consensus")
pairs = sorted(set(zip(res["ligand"].astype(str).str.upper(),
                       res["receptor"].astype(str).str.upper())))
print("consensus pairs:", len(pairs))

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


for tag in ["mouse", "human"]:
    a = ad.read_h5ad(BASE + "/spatial_composition_%s.h5ad" % tag)
    sym_upper = {}
    sym_series = a.var["gene_symbol"].astype(str)
    for i, s in enumerate(sym_series.tolist()):
        up = s.upper()
        sym_upper.setdefault(up, i)
    lig_idx, rec_idx, pair_names = [], [], []
    for lig, rec in pairs:
        li = sym_upper.get(lig)
        ri = sym_upper.get(rec)
        if li is not None and ri is not None:
            lig_idx.append(li)
            rec_idx.append(ri)
            pair_names.append((lig, rec))
    print("%s: LR pairs mapped = %d / %d" % (tag, len(pair_names), len(pairs)))
    if not lig_idx:
        continue

    X = a.X.tocsc()
    L = X[:, lig_idx].toarray()          # spots x pairs 配体表达
    R = X[:, rec_idx].toarray()          # spots x pairs 受体表达
    expr_lig = (L > 0).any(axis=0)
    print("  配体有表达的 pair:", int(expr_lig.sum()))

    t0 = time.time()
    dom = a.obs["domain"].astype(str).to_numpy()
    doms = sorted(set(dom.tolist()))
    dom_code = {d: i for i, d in enumerate(doms)}
    dcodes = np.array([dom_code[d] for d in dom])
    onehot = csr_matrix((np.ones(len(dcodes)), (np.arange(len(dcodes)), dcodes)),
                        shape=(len(dcodes), len(doms)))
    # 逐样本算权重（像素坐标逐样本可比，坑 #114）
    samples = sorted(a.obs["sample_id"].unique().tolist())
    total_score = np.zeros((len(pair_names), len(doms), len(doms)))
    for sample in samples:
        mask = (a.obs["sample_id"].to_numpy() == sample)
        sub_spatial = np.asarray(a.obsm["spatial"])[mask]
        w = build_knn_weights(sub_spatial, K_NN)
        lv = L[mask]
        rv = R[mask]
        sc = onehot[mask].T @ w @ onehot[mask]   # domain x domain 权重总质量
        # pair 级 score[d_lig, d_rec] = sum_i sum_j lv_i * w_ij * rv_j
        for p in range(len(pair_names)):
            lvp = lv[:, p]
            rvp = rv[:, p]
            if not (lvp > 0).any() or not (rvp > 0).any():
                continue
            s = onehot[mask].T @ csr_matrix(lvp[:, None] * w.multiply(rvp[None, :]).toarray()) @ onehot[mask]
            total_score[p] += np.asarray(s.todense())
    elapsed = time.time() - t0
    print("  逐样本 domain-pair score 耗时 %.1fs" % elapsed)
    # 归一化：除以 domain-pair 权重质量
    qc = total_score.sum(axis=0)
    top = np.dstack(np.unravel_index(np.argsort(-qc.ravel()), qc.shape))[0][:10]
    print("  top domain-pair 总强度（含域名）:")
    for dli, dri in top:
        print("    %s -> %s : %.2f" % (doms[dli], doms[dri], qc[dli, dri]))
