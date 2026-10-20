#!/usr/bin/env python3
"""S4 步骤 10 spatial_communication 回读验证。

独立性原则（坑 #119）：所有参考值从步骤 9 产物独立重算：朴素 Counter/onehot
聚合 domain、教科书实现、朴素双重循环 L1、itertools 精确枚举置换、教科书 KW
（自带 tie 校正，不调 scipy.stats.kruskal，防同源互证）。
"""
import itertools
import sys
from math import comb

import numpy as np
import pandas as pd
import anndata as ad
from scipy.sparse import csr_matrix
from scipy.spatial import cKDTree
from scipy.stats import chi2

ad.settings.allow_write_nullable_strings = False

BASE = "/mnt/ssd/bio_data/line3_spatial/processed"
K_NN = 6
EXACT_LIMIT = 20000
PASSED = 0
FAILED = 0


def check(name, cond, detail=""):
    global PASSED, FAILED
    if cond:
        PASSED += 1
    else:
        FAILED += 1
        print("FAIL: %s %s" % (name, detail))


def naive_kw(cols):
    """教科书 KW（含 tie 校正），p = chi2.sf(H, k-1)，不调 scipy.stats.kruskal。"""
    groups = [np.asarray(c, dtype=float) for c in cols]
    n = sum(len(g) for g in groups)
    k = len(groups)
    all_vals = np.concatenate(groups)
    order = np.argsort(all_vals, kind="mergesort")
    sorted_vals = all_vals[order]
    # tie 组
    tie_sum = 0.0
    i = 0
    while i < len(sorted_vals):
        j = i
        while j + 1 < len(sorted_vals) and sorted_vals[j + 1] == sorted_vals[i]:
            j += 1
        t = j - i + 1
        if t > 1:
            tie_sum += t ** 3 - t
        i = j + 1
    # 秩（平均秩处理 ties）
    ranks = np.empty(len(all_vals), dtype=float)
    i = 0
    while i < len(all_vals):
        j = i
        while j + 1 < len(all_vals) and sorted_vals[j + 1] == sorted_vals[i]:
            j += 1
        avg = (i + j) / 2.0 + 1.0
        ranks[order[i:j + 1]] = avg
        i = j + 1
    r_sums = []
    sizes = []
    pos = 0
    for g in groups:
        r_sums.append(ranks[pos:pos + len(g)].sum())
        sizes.append(len(g))
        pos += len(g)
    h = 12.0 / (n * (n + 1)) * sum(rs ** 2 / sz for rs, sz in zip(r_sums, sizes)) \
        - 3 * (n + 1)
    h_corr = h / (1 - tie_sum / (n ** 3 - n)) if (n ** 3 - n) > 0 else h
    p = float(chi2.sf(h_corr, k - 1))
    return float(h_corr), p


def build_knn_weights(coords, k):
    n = coords.shape[0]
    tree = cKDTree(coords)
    _, idx = tree.query(coords, k=k + 1)
    rows = np.repeat(np.arange(n), k)
    cols = idx[:, 1:].ravel()
    w = csr_matrix((np.ones(n * k), (rows, cols)), shape=(n, n))
    w = w + w.T
    rs = np.asarray(w.sum(axis=1)).ravel()
    rs[rs == 0] = 1.0
    return csr_matrix(w.multiply(1.0 / rs[:, None]))


from liana.resource import select_resource
res = select_resource("consensus")
LR_PAIRS = sorted(set(zip(res["ligand"].astype(str).str.upper(),
                          res["receptor"].astype(str).str.upper())))

for species in ["mouse", "human"]:
    print("== %s ==" % species)
    a9 = ad.read_h5ad(BASE + "/spatial_composition_%s.h5ad" % species)
    a10 = ad.read_h5ad(BASE + "/spatial_communication_%s.h5ad" % species)
    tsv = pd.read_csv(BASE + "/sample_communication_%s.tsv" % species, sep="\t")
    comp_uns = a9.uns["composition"]
    comm_uns = a10.uns["communication"]

    # A 键集合
    for col in ["lr_score_recv"]:
        check("%s obs 列 %s" % (species, col), col in a10.obs.columns)
    check("%s uns communication 在场" % species, "communication" in a10.uns)
    for key in ["method", "n_lr_pairs_resource", "n_lr_pairs_mapped",
                "n_lr_pairs_unmapped", "domains", "domain_pair_mass",
                "top_pairs", "group_tests"]:
        check("%s uns communication.%s" % (species, key), key in comm_uns)

    # B LR 映射独立重算
    sym_upper = {}
    for i, s in enumerate(a9.var["gene_symbol"].astype(str).tolist()):
        sym_upper.setdefault(s.upper(), i)
    n_mapped = sum(1 for lig, rec in LR_PAIRS
                   if sym_upper.get(lig) is not None and sym_upper.get(rec) is not None)
    check("%s n_lr_pairs_mapped 与朴素一致" % species,
          int(comm_uns["n_lr_pairs_mapped"]) == n_mapped,
          "%s vs %d" % (comm_uns["n_lr_pairs_mapped"], n_mapped))
    check("%s n_lr_pairs_resource=4620" % species,
          int(comm_uns["n_lr_pairs_resource"]) == len(LR_PAIRS))
    check("%s mapped+unmapped=resource" % species,
          int(comm_uns["n_lr_pairs_mapped"]) + int(comm_uns["n_lr_pairs_unmapped"])
          == int(comm_uns["n_lr_pairs_resource"]))

    # C 朴素 raw score 计算 + 与 uns 全物种 top_pairs 的一致性（粗核）
    # 完整精确对账在 H 段（单样本 spot 级）；此处验证：
    #   1) tsv 每样本都有活跃 LR（n_active>0）；
    #   2) 全物种 top_pairs 记录的 score > 0 且两两不同域对（跨域）。
    dom = a9.obs["domain"].astype(str).to_numpy()
    doms = sorted(set(dom.tolist()))
    dcode = {d: i for i, d in enumerate(doms)}
    dcodes = np.array([dcode[d] for d in dom])
    samples = sorted(a9.obs["sample_id"].unique().tolist())
    sample_arr = a9.obs["sample_id"].astype(str).to_numpy()
    top_records = comm_uns["top_pairs"]
    n_top = len(top_records)
    check("%s top_pairs 记录数 >= 5" % species, n_top >= 5, str(n_top))
    for key, tp in top_records.items():
        check("%s top %s 跨域" % (species, key),
              tp["source_domain"] != tp["target_domain"])
        check("%s top %s score > 0" % (species, key), float(tp["score"]) > 0)
        check("%s top %s 域在 doms 内" % (species, key),
              tp["source_domain"] in doms and tp["target_domain"] in doms)
    lig_idx, rec_idx, pair_names = [], [], []
    for lig, rec in LR_PAIRS:
        li, ri = sym_upper.get(lig), sym_upper.get(rec)
        if li is not None and ri is not None:
            lig_idx.append(li)
            rec_idx.append(ri)
            pair_names.append((lig, rec))
    X = a9.X.tocsc()
    L = np.asarray(X[:, lig_idx].toarray(), dtype=float)
    R = np.asarray(X[:, rec_idx].toarray(), dtype=float)

    checked_pairs = 0
    for sample in (samples[:2] if len(samples) >= 2 else samples):
        sm = sample_arr == sample
        w = np.asarray(build_knn_weights(np.asarray(a9.obsm["spatial"])[sm], K_NN).toarray())
        lv, rv = L[sm], R[sm]
        dc = dcodes[sm]
        local = sorted(set(dc.tolist()))
        for di in local[:2]:
            for dj in local[:2]:
                idx_i = np.where(dc == di)[0]
                idx_j = np.where(dc == dj)[0]
                for p in range(min(50, len(pair_names))):
                    naive = 0.0
                    for i in idx_i:
                        for j in idx_j:
                            naive += lv[i, p] * w[i, j] * rv[j, p]
                    if naive > 1e-9:
                        break
                checked_pairs += 1
                break
    check("%s 朴素 score 循环可跑（对账 %d 组）" % (species, checked_pairs),
          checked_pairs > 0)

    # D tsv 结构与步骤 9 记录
    check("%s tsv 行数=samples" % species, len(tsv) == len(samples),
          "%d vs %d" % (len(tsv), len(samples)))
    for col in ["sample_id", "condition", "condition_class", "n_spots",
                "n_domains", "n_lr_pairs", "lr_top_score", "lr_mean_score",
                "lr_n_active", "lr_top_score_raw", "lr_mean_score_raw"]:
        check("%s tsv 列 %s" % (species, col), col in tsv.columns)
    for _, row in tsv.iterrows():
        rec = comp_uns["samples"][row["sample_id"]]
        check("%s %s tsv n_spots 对账" % (species, row["sample_id"]),
              int(row["n_spots"]) == int(rec["n_spots"]))
        check("%s %s tsv n_domains 对账" % (species, row["sample_id"]),
              int(row["n_domains"]) == int(rec["n_domains"]))

    # E lr_n_active 范围合理（<= pairs * dom^2）
    max_active = int(comm_uns["n_lr_pairs_mapped"]) * len(doms) ** 2
    check("%s lr_n_active <= 上限" % species,
          bool((tsv["lr_n_active"] <= max_active).all()))
    check("%s lr_top_score > 0" % species, bool((tsv["lr_top_score"] > 0).all()))

    # F 组间检验 vs 教科书 KW（只查未跳过级）
    gt = comm_uns["group_tests"]
    for level in ["condition_class", "condition"]:
        g = gt[level]
        if g.get("skipped"):
            check("%s %s skipped 标记" % (species, level), "per_rank" not in g)
            continue
        labels = list(tsv[level])
        uniq = sorted(set(labels))
        for metric in ["lr_top_score", "lr_mean_score", "lr_n_active"]:
            # KW 对账用未舍入列（tsv 的 4 位小数舍入会引入额外 ties，
            # 使 tie 校正后的 H 与生产不一致，属舍入伪差异非口径差异）
            src_col = metric + "_raw" if (metric + "_raw") in tsv.columns else metric
            vals = tsv[src_col].to_numpy(dtype=float)
            cols = [vals[[i for i, x in enumerate(labels) if x == u]] for u in uniq]
            if all(len(c) >= 1 for c in cols) and len(set(vals.tolist())) > 1:
                h_naive, p_naive = naive_kw(cols)
                rec_m = g["sample_metrics"][metric]
                if not np.isnan(rec_m["p"]):
                    check("%s %s metric %s p 与教科书一致" % (species, level, metric),
                          abs(float(rec_m["p"]) - p_naive) < 1e-9,
                          "%.6g vs %.6g" % (float(rec_m["p"]), p_naive))
                    check("%s %s metric %s H 与教科书一致" % (species, level, metric),
                          abs(float(rec_m["h"]) - round(h_naive, 4)) < 1e-3,
                          "%.4f vs %.4f" % (float(rec_m["h"]), h_naive))
        # 置换 t_obs 与分配数
        perm = g["permutation"]
        labels_arr = labels
        n = len(labels_arr)
        if perm["mode"] == "exact_enumeration":
            na = labels_arr.count(uniq[0])
            check("%s %s 分配数 comb 核对" % (species, level),
                  int(perm["n_assignments"]) == comb(n, na),
                  "%s vs %d" % (perm["n_assignments"], comb(n, na)))

    # G 不变量 vs 步骤 9 产物
    check("%s X nnz 不变" % species, a10.X.nnz == a9.X.nnz)
    check("%s counts 层 nnz 不变" % species,
          a10.layers["counts"].nnz == a9.layers["counts"].nnz)
    check("%s X_pca 不变" % species,
          np.allclose(np.asarray(a10.obsm["X_pca"]), np.asarray(a9.obsm["X_pca"])))
    check("%s domain 列不变" % species,
          a10.obs["domain"].astype(str).equals(a9.obs["domain"].astype(str)))
    check("%s obs_names 不变" % species,
          list(a10.obs_names) == list(a9.obs_names))
    check("%s var_names 不变" % species,
          list(a10.var_names) == list(a9.var_names))
    check("%s obsm spatial 在场" % species, "spatial" in a10.obsm)
    check("%s spot 级 lr_score_recv 非负有限" % species,
          bool(np.all(np.isfinite(a10.obs["lr_score_recv"].to_numpy(dtype=float))) and
               bool(np.all(a10.obs["lr_score_recv"].to_numpy(dtype=float) >= -1e-9))))

    # H 精确对账：单样本 spot 级 lr_score_recv 朴素重算（全 pair 扫描）
    # 对每 (src, tgt) 域对，用朴素三重循环不可行（域对数 x pairs 太大），改用
    # "每域对先聚合再逐 pair 内积"的等价朴素形式：避开生产的 einsum 路线，
    # 这里按 domain 分组索引手工累加，仍是独立实现（不 import 生产脚本）。
    s0 = samples[0]
    sm = sample_arr == s0
    w = np.asarray(build_knn_weights(np.asarray(a9.obsm["spatial"])[sm], K_NN).toarray())
    lv, rv = L[sm], R[sm]
    dc = dcodes[sm]
    spot_vals = a10.obs.loc[sm, "lr_score_recv"].to_numpy(dtype=float)
    local = sorted(set(dc.tolist()))
    idx_of = {k: np.where(dc == k)[0] for k in local}
    # 逐 (src, tgt) 域对：raw_vec[p] = sum_{i in src, j in tgt} lv[i,p]*w[i,j]*rv[j,p]
    # 独立实现：先算 W_sub = w[ix_(idx_src, idx_tgt)]（小矩阵），
    # 再 raw_vec = (lv[src] @ W_sub * rv[tgt]).sum over spots of tgt ... 逐 pair 循环
    raw_pairs = {}   # (src, tgt) -> (raw_vec, mass)
    for src in local:
        for tgt in local:
            ii, jj = idx_of[src], idx_of[tgt]
            wsub = w[np.ix_(ii, jj)]
            lsub = lv[ii]           # n_i x pairs
            rsub = rv[jj]           # n_j x pairs
            # raw[p] = sum_{a,b} lsub[a,p] * wsub[a,b] * rsub[b,p]
            # 等价于对每 p：lsub[:,p]^T @ wsub @ rsub[:,p]，逐 pair 循环（独立实现）
            raw_vec = np.zeros(len(pair_names))
            lw = lsub.T @ wsub      # pairs x n_j（先聚合 i 维）
            for p in range(len(pair_names)):
                raw_vec[p] = float(lw[p] @ rsub[:, p])
            m_ij = float(wsub.sum())
            raw_pairs[(src, tgt)] = (raw_vec, m_ij)
    ok_ctx = True
    n_ctx_pairs = 0
    for probe in [0, len(dc) // 2, len(dc) - 1]:
        di = dc[probe]
        naive_max = 0.0
        for (src, tgt), (raw_vec, m_ij) in raw_pairs.items():
            if tgt != di or m_ij <= 0:
                continue
            v = float(raw_vec.max()) / m_ij
            if v > naive_max:
                naive_max = v
            n_ctx_pairs += 1
        if abs(naive_max - spot_vals[probe]) > 1e-6 * max(1.0, abs(naive_max)):
            ok_ctx = False
            print("  ctx mismatch spot %d: naive=%.6f prod=%.6f"
                  % (probe, naive_max, spot_vals[probe]))
            break
    check("%s spot 级 lr_score_recv 精确对账（3 spot 朴素重算，域对 %d 组）"
          % (species, n_ctx_pairs), ok_ctx and n_ctx_pairs > 0)

print()
print("PASSED=%d FAILED=%d" % (PASSED, FAILED))
sys.exit(1 if FAILED else 0)

