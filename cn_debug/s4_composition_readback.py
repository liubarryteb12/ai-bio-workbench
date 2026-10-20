# s4_composition_readback：步骤 9 spatial_composition 回读验证。
#
# 独立性原则（坑 #119）：所有参考值都从步骤 8 产物（spatial_cooccurrence_*.h5ad）
# 用朴素教科书式实现独立重算，再与步骤 9 产物对账：
#   - 组成谱：Counter 数域 -> (-count, name) 降序 -> 占比（与生产定义逐点一致）；
#   - KW：教科书 H = 12/(n(n+1)) * sum(Rj^2/nj) - 3(n+1) + tie 校正，
#     p = chi2.sf(H, k-1)（不调 scipy.stats.kruskal，防同源实现互证）；
#   - 置换：朴素双重循环 L1 + itertools 精确枚举全部标签分配；
#   - spot 级列、tsv、uns 三处对账 + 与步骤 8 产物的不变量逐项核对。
import os
import sys
from collections import Counter
from itertools import combinations
from math import comb

import numpy as np
import pandas as pd
import anndata as ad
from scipy.stats import chi2

ad.settings.allow_write_nullable_strings = False

PROC = "/mnt/ssd/bio_data/line3_spatial/processed"
SPECIES = ("mouse", "human")
ALPHA = 0.05

passed = 0
failed = 0
failures = []


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        failures.append("%s %s" % (name, detail))
        print("FAIL %s %s" % (name, detail))


def naive_profile(labels):
    """朴素组成谱：Counter -> (-count, name) 降序 -> 占比。返回 (domains, props)。"""
    total = len(labels)
    cnt = Counter(labels)
    ordered = sorted(cnt.items(), key=lambda kv: (-kv[1], kv[0]))
    return [d for d, _ in ordered], [c / total for _, c in ordered]


def naive_shannon(props):
    return float(-sum(p * np.log(p) for p in props if p > 0))


def naive_kruskal(groups):
    """教科书 KW（带 tie 校正），不调 scipy.stats.kruskal。"""
    groups = [np.asarray(g, dtype=float) for g in groups]
    allv = np.concatenate(groups)
    n = len(allv)
    order = np.argsort(allv, kind="mergesort")
    ranks = np.empty(n)
    sv = allv[order]
    i = 0
    tie_terms = 0.0
    while i < n:
        j = i
        while j + 1 < n and sv[j + 1] == sv[i]:
            j += 1
        ranks[order[i:j + 1]] = (i + j) / 2.0 + 1.0
        t = j - i + 1
        if t > 1:
            tie_terms += t ** 3 - t
        i = j + 1
    starts = np.cumsum([0] + [len(g) for g in groups])
    rsum = [float(ranks[starts[b]:starts[b + 1]].sum()) for b in range(len(groups))]
    ns = [len(g) for g in groups]
    h = 12.0 / (n * (n + 1)) * sum(r * r / nn for r, nn in zip(rsum, ns)) - 3 * (n + 1)
    if tie_terms > 0:
        h = h / (1.0 - tie_terms / (n ** 3 - n))
    return float(h), float(chi2.sf(h, len(groups) - 1))


def naive_l1(a, b):
    s = 0.0
    for x, y in zip(a, b):
        s += abs(x - y)
    return s


def naive_permutation(P, labels):
    """朴素精确置换：全部 C(n, n1) 种标签分配，T = 组间均值 - 组内均值。"""
    n = len(labels)
    uniq = sorted(set(labels))
    ga = uniq[0]
    idx_a = [i for i, g in enumerate(labels) if g == ga]
    pairs = [(i, j) for i in range(n) for j in range(i + 1, n)]

    def t_of(lab):
        w = [naive_l1(P[i], P[j]) for i, j in pairs if lab[i] == lab[j]]
        b = [naive_l1(P[i], P[j]) for i, j in pairs if lab[i] != lab[j]]
        return sum(b) / len(b) - sum(w) / len(w)

    t_obs = t_of(labels)
    count = 0
    for choice in combinations(range(n), len(idx_a)):
        cs = set(choice)
        lab = [ga if i in cs else uniq[1] for i in range(n)]
        if abs(t_of(lab)) >= abs(t_obs) - 1e-12:
            count += 1
    return t_obs, count / comb(n, len(idx_a))


for species in SPECIES:
    print("== %s ==" % species)
    step9 = os.path.join(PROC, "spatial_composition_%s.h5ad" % species)
    step8 = os.path.join(PROC, "spatial_cooccurrence_%s.h5ad" % species)
    tsv9 = os.path.join(PROC, "sample_composition_%s.tsv" % species)
    for p in (step9, step8, tsv9):
        check("exists %s" % os.path.basename(p), os.path.isfile(p))
    a9 = ad.read_h5ad(step9)
    a8 = ad.read_h5ad(step8)

    # --- A. 键集合 ---
    check("%s obs 新列" % species,
          "domain_rank" in a9.obs.columns and "domain_prop" in a9.obs.columns)
    comp = a9.uns.get("composition")
    check("%s uns composition 在位" % species, comp is not None)
    for key in ("method", "note", "alpha", "seed", "samples_total", "samples",
                "group_tests", "source_h5ad"):
        check("%s uns composition.%s" % (species, key), key in comp)
    check("%s uns seed" % species, int(comp["seed"]) == 20261013, str(comp["seed"]))
    check("%s uns alpha" % species, float(comp["alpha"]) == ALPHA)

    # --- B. tsv 结构 ---
    tsv = pd.read_csv(tsv9, sep="\t")
    n_samples = a8.obs["sample_id"].nunique()
    check("%s tsv 行数" % species, len(tsv) == n_samples, "%d vs %d" % (len(tsv), n_samples))
    need_cols = ["sample_id", "condition", "condition_class", "n_spots", "n_domains",
                 "shannon", "effective_domains", "top1_frac", "top3_frac"]
    check("%s tsv 必需列" % species, all(c in tsv.columns for c in need_cols),
          str([c for c in need_cols if c not in tsv.columns]))
    rank_cols = sorted([c for c in tsv.columns if c.startswith("prop_rank")],
                       key=lambda c: int(c.replace("prop_rank", "")))
    check("%s tsv rank 列连续" % species,
          [int(c.replace("prop_rank", "")) for c in rank_cols] == list(range(1, len(rank_cols) + 1)))

    # --- C. 朴素重算 vs tsv（逐样本） ---
    samples = sorted(a8.obs["sample_id"].unique())
    naive_profiles = {}
    max_props_diff = 0.0
    max_shannon_diff = 0.0
    for s in samples:
        labels = a8.obs.loc[a8.obs["sample_id"] == s, "domain"].astype(str).tolist()
        doms, props = naive_profile(labels)
        naive_profiles[s] = (doms, props)
        row = tsv[tsv["sample_id"] == s].iloc[0]
        check("%s %s n_domains" % (species, s), int(row["n_domains"]) == len(doms),
              "%d vs %d" % (int(row["n_domains"]), len(doms)))
        check("%s %s n_spots" % (species, s), int(row["n_spots"]) == len(labels))
        for r in range(len(props)):
            v = float(row["prop_rank%d" % (r + 1)])
            max_props_diff = max(max_props_diff, abs(v - props[r]))
        max_shannon_diff = max(max_shannon_diff, abs(float(row["shannon"]) - naive_shannon(props)))
        eff = float(np.exp(naive_shannon(props)))
        check("%s %s effective_domains" % (species, s),
              abs(float(row["effective_domains"]) - eff) < 1e-3,
              "%.4f vs %.4f" % (float(row["effective_domains"]), eff))
        check("%s %s top1_frac" % (species, s),
              abs(float(row["top1_frac"]) - props[0]) < 1e-3)
        top3 = sum(props[: min(3, len(props))])
        check("%s %s top3_frac" % (species, s),
              abs(float(row["top3_frac"]) - top3) < 1e-3,
              "%.4f vs %.4f" % (float(row["top3_frac"]), top3))
        check("%s %s condition" % (species, s),
              str(row["condition"]) == str(a8.obs.loc[a8.obs["sample_id"] == s, "condition"].iloc[0]))
        check("%s %s condition_class" % (species, s),
              str(row["condition_class"]) == str(a8.obs.loc[a8.obs["sample_id"] == s, "condition_class"].iloc[0]))
    check("%s tsv props 与朴素一致" % species, max_props_diff < 1e-3, "max diff %.6f" % max_props_diff)
    check("%s tsv shannon 与朴素一致" % species, max_shannon_diff < 1e-3, "max diff %.6f" % max_shannon_diff)

    # --- D. spot 级两列对账 ---
    spot_rank = a9.obs["domain_rank"].to_numpy()
    spot_prop = a9.obs["domain_prop"].to_numpy()
    check("%s spot_rank 无 0" % species, np.all(spot_rank >= 1))
    check("%s spot_prop 范围" % species,
          bool(np.all((spot_prop >= -1e-9) & (spot_prop <= 1.0 + 1e-9))))
    bad_rank = 0
    bad_prop = 0.0
    for s in samples:
        doms, props = naive_profiles[s]
        rank_of = {d: r + 1 for r, d in enumerate(doms)}
        m = (a9.obs["sample_id"] == s).to_numpy()
        for d, r in rank_of.items():
            sel = m & (a9.obs["domain"].astype(str) == d).to_numpy()
            if not np.all(spot_rank[sel] == r):
                bad_rank += 1
            bad_prop = max(bad_prop, float(np.max(np.abs(spot_prop[sel] - props[r - 1]))))
    check("%s spot_rank 与朴素 rank_map 一致" % species, bad_rank == 0, "%d 处不一致" % bad_rank)
    check("%s spot_prop 与朴素 props 一致" % species, bad_prop < 1e-3, "max diff %.6f" % bad_prop)

    # --- E. uns samples vs 朴素 ---
    uns_samples = comp["samples"]
    max_uns_diff = 0.0
    for s in samples:
        doms, props = naive_profiles[s]
        rec = uns_samples[s]
        check("%s %s uns domains 顺序" % (species, s),
              list(rec["domains"]) == doms, "%s vs %s" % (list(rec["domains"]), doms))
        got = np.asarray(rec["domain_props"], dtype=float)
        max_uns_diff = max(max_uns_diff, float(np.max(np.abs(got - np.asarray(props)))))
        check("%s %s uns rank_map" % (species, s),
              dict(rec["domain_rank_map"]) == {d: r + 1 for r, d in enumerate(doms)})
        check("%s %s uns n_spots" % (species, s), int(rec["n_spots"]) == len(
            a8.obs.loc[a8.obs["sample_id"] == s]))
    check("%s uns domain_props 与朴素一致" % species, max_uns_diff < 1e-3, "max diff %.6f" % max_uns_diff)

    # --- F. 组间检验 vs 朴素教科书实现 ---
    labels_ccls = [str(a8.obs.loc[a8.obs["sample_id"] == s, "condition_class"].iloc[0])
                   for s in samples]
    labels_cond = [str(a8.obs.loc[a8.obs["sample_id"] == s, "condition"].iloc[0])
                   for s in samples]
    max_k = max(len(p) for _, p in naive_profiles.values())
    P = np.zeros((len(samples), max_k))
    for i, s in enumerate(samples):
        _, props = naive_profiles[s]
        P[i, : len(props)] = props

    gt = comp["group_tests"]
    check("%s group_tests 两级在场" % species,
          "condition_class" in gt and "condition" in gt)
    for level, labels in (("condition_class", labels_ccls), ("condition", labels_cond)):
        g = gt[level]
        sizes = {lab: labels.count(lab) for lab in sorted(set(labels))}
        check("%s %s groups 记录" % (species, level),
              dict(g["groups"]) == sizes, "%s vs %s" % (dict(g["groups"]), sizes))
        if any(v < 2 for v in sizes.values()):
            check("%s %s 单样本组如实跳过" % (species, level),
                  bool(g.get("skipped")) and "per_rank" not in g, str(g.get("skipped")))
            continue
        check("%s %s 未误跳过" % (species, level), not g.get("skipped"))
        uniq = sorted(set(labels))
        max_p_diff = 0.0
        for r in range(max_k):
            vals = P[:, r]
            cols = [vals[[i for i, lab in enumerate(labels) if lab == u]] for u in uniq]
            h_naive, p_naive = naive_kruskal(cols)
            rec = g["per_rank"]["rank%d" % (r + 1)]
            check("%s %s rank%d n_nonzero" % (species, level, r + 1),
                  int(rec["n_nonzero"]) == int((vals > 0).sum()))
            if np.isnan(rec["p"]):
                # 全组同值：朴素实现此时 H=0 p=1，生产记 skipped 也自洽
                check("%s %s rank%d skipped 标记" % (species, level, r + 1),
                      bool(rec.get("skipped")), str(rec.get("skipped")))
                continue
            max_p_diff = max(max_p_diff, abs(float(rec["p"]) - p_naive))
            check("%s %s rank%d H" % (species, level, r + 1),
                  abs(float(rec["h"]) - round(h_naive, 4)) < 1e-3,
                  "%.4f vs %.4f" % (float(rec["h"]), h_naive))
        check("%s %s 逐 rank p 与教科书一致" % (species, level), max_p_diff < 1e-9,
              "max diff %.2e" % max_p_diff)
        # 样本级指标 KW
        for metric in ("shannon", "effective_domains", "top1_frac", "top3_frac", "n_domains"):
            vals = tsv[metric].to_numpy(dtype=float)
            cols = [vals[[i for i, lab in enumerate(labels) if lab == u]] for u in uniq]
            h_naive, p_naive = naive_kruskal(cols)
            rec = g["sample_metrics"][metric]
            if np.isnan(rec["p"]):
                continue
            check("%s %s metric %s p" % (species, level, metric),
                  abs(float(rec["p"]) - p_naive) < 1e-9,
                  "%.6f vs %.6f" % (float(rec["p"]), p_naive))
        # 置换精确枚举
        t_obs, p_perm = naive_permutation(P, labels)
        perm = g["permutation"]
        check("%s %s 置换 mode" % (species, level), perm["mode"] == "exact_enumeration")
        check("%s %s 置换 t_obs" % (species, level),
              abs(float(perm["t_obs"]) - round(t_obs, 6)) < 1e-6,
              "%.6f vs %.6f" % (float(perm["t_obs"]), t_obs))
        check("%s %s 置换 p 精确一致" % (species, level),
              abs(float(perm["p"]) - p_perm) < 1e-12,
              "%.6f vs %.6f" % (float(perm["p"]), p_perm))
        check("%s %s 置换分配数" % (species, level),
              int(perm["n_assignments"]) == comb(len(samples), min(
                  labels.count(u) for u in uniq)))

    # --- G. 不变量 vs 步骤 8 产物 ---
    check("%s X nnz 不变" % species, a9.X.nnz == a8.X.nnz,
          "%d vs %d" % (a9.X.nnz, a8.X.nnz))
    check("%s counts nnz 不变" % species, a9.layers["counts"].nnz == a8.layers["counts"].nnz)
    check("%s X_pca 不变" % species, np.array_equal(a9.obsm["X_pca"], a8.obsm["X_pca"]))
    check("%s domain 列不变" % species,
          np.array_equal(a9.obs["domain"].astype(str).to_numpy(),
                         a8.obs["domain"].astype(str).to_numpy()))
    check("%s obs_names 一致" % species,
          list(a9.obs_names) == list(a8.obs_names))
    check("%s 步骤 8 obs 列不丢" % species,
          all(c in a9.obs.columns for c in a8.obs.columns))
    check("%s 步骤 8 var 列不丢" % species,
          all(c in a9.var.columns for c in a8.var.columns))
    check("%s 步骤 8 uns 键不丢" % species,
          all(k in a9.uns for k in a8.uns))
    check("%s obsm spatial 不丢" % species, "spatial" in a9.obsm)
    # 与步骤 8 uns['cooccurrence'] 样本记录对账（生产自校验同款，独立复核）
    rec8 = a8.uns["cooccurrence"]["samples"]
    ok = True
    for s in samples:
        doms, props = naive_profiles[s]
        if len(doms) != len(list(rec8[s]["domains"])):
            ok = False
        if len(a8.obs.loc[a8.obs["sample_id"] == s]) != int(rec8[s]["n_spots"]):
            ok = False
    check("%s 与步骤 8 uns 样本记录一致" % species, ok)

    # --- H. 报告与产物 ---
    rep = os.path.join(PROC, "composition_report.txt")
    check("%s report 存在" % species, os.path.isfile(rep))
    text = open(rep, encoding="utf-8").read()
    for token in ("step=spatial_composition", "seed=20261013",
                  "domain_identity_note", "grouping_note",
                  "small_sample_note", "[%s]" % species):
        check("%s report 含 %s" % (species, token), token in text)

print()
print("PASSED=%d FAILED=%d" % (passed, failed))
if failures:
    print("failures:")
    for f in failures:
        print(" -", f)
sys.exit(1 if failed else 0)
