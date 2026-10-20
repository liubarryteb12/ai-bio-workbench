#!/usr/bin/env python3
"""S4 步骤 12 spatial_localization 回读验证。

独立性原则（坑 #119）：所有参考值从步骤 10 产物独立重算：
朴素候选池构建（python set/dict）、朴素逐样本 enrich、朴素排序键。
"""
import sys

import numpy as np
import pandas as pd
import anndata as ad

ad.settings.allow_write_nullable_strings = False

BASE = "/mnt/ssd/bio_data/line3_spatial/processed"
TOPK_MARKER = 20
N_TARGETS = 10
PASSED = 0
FAILED = 0


def check(name, cond, detail=""):
    global PASSED, FAILED
    if cond:
        PASSED += 1
    else:
        FAILED += 1
        print("FAIL: %s %s" % (name, detail))


for species in ["mouse", "human"]:
    print("== %s ==" % species)
    a10 = ad.read_h5ad(BASE + "/spatial_communication_%s.h5ad" % species)
    a12 = ad.read_h5ad(BASE + "/spatial_localization_%s.h5ad" % species)
    tsv = pd.read_csv(BASE + "/gene_localization_%s.tsv" % species, sep="\t")
    loc_uns = a12.uns["localization"]

    # A 键集合
    check("%s obs target_gene_expr" % species, "target_gene_expr" in a12.obs.columns)
    for key in ["method", "n_candidates", "n_targets", "top_target_gene", "targets"]:
        check("%s uns localization.%s" % (species, key), key in loc_uns)
    check("%s topk_marker=%d" % (species, TOPK_MARKER),
          int(loc_uns["topk_marker"]) == TOPK_MARKER)

    # B 候选池独立重算
    names_arr = np.asarray(a10.uns["domain_markers"]["names"])
    groups = a10.obs["domain"].astype("category").cat.categories.tolist()
    cand = {}
    for g in groups:
        for rank in range(TOPK_MARKER):
            cand.setdefault(str(names_arr[g][rank]), set()).add(g)
    check("%s 候选池大小一致" % species,
          int(loc_uns["n_candidates"]) == len(cand),
          "%s vs %d" % (loc_uns["n_candidates"], len(cand)))
    check("%s tsv 行数=候选池" % species, len(tsv) == len(cand),
          "%d vs %d" % (len(tsv), len(cand)))
    check("%s tsv 基因集合=候选池" % species,
          set(tsv["ensembl_id"]) == set(cand.keys()))

    # C 逐基因 enrich 独立重算（抽 top20 基因精确对账）
    var_index = {v: i for i, v in enumerate(a10.var_names.tolist())}
    X = a10.X.tocsc()
    dom = a10.obs["domain"].astype(str).to_numpy()
    sample_arr = a10.obs["sample_id"].astype(str).to_numpy()
    samples = sorted(a10.obs["sample_id"].unique().tolist())
    tsv_indexed = tsv.set_index("ensembl_id")
    n_ok_enrich = 0
    n_chk = 0
    for gene in list(cand.keys())[:20]:
        if gene not in tsv_indexed.index:
            continue
        n_chk += 1
        gi = var_index[gene]
        col = np.asarray(X[:, gi].toarray()).ravel()
        marker_doms = sorted(cand[gene])
        n_top = 0
        n_total = 0
        best_enrich = 0.0
        for s in samples:
            sm = sample_arr == s
            cs = col[sm]
            all_frac_s = float((cs > 0).mean())
            if all_frac_s <= 0:
                continue
            n_total += 1
            dom_s = dom[sm]
            marker_here = [d for d in marker_doms if (dom_s == d).any()]
            if not marker_here:
                continue
            per_dom = []
            for d in sorted(set(dom_s.tolist())):
                m = dom_s == d
                per_dom.append((d, float((cs[m] > 0).mean())))
            per_dom_sorted = sorted(per_dom, key=lambda x: (-x[1], x[0]))
            top_d, top_frac = per_dom_sorted[0]
            enrich = top_frac / all_frac_s
            if enrich > best_enrich:
                best_enrich = enrich
            if top_d in marker_here:
                n_top += 1
        rec = tsv_indexed.loc[gene]
        ok = (int(rec["n_samples_top"]) == n_top and
              int(rec["n_samples_total"]) == n_total and
              abs(float(rec["best_enrich"]) - round(best_enrich, 4)) < 1e-4 and
              int(rec["n_expr"]) == int((col > 0).sum()))
        if ok:
            n_ok_enrich += 1
        else:
            print("  %s: tsv=(%s,%s,%.4f,%d) naive=(%d,%d,%.4f,%d)"
                  % (gene, rec["n_samples_top"], rec["n_samples_total"],
                     float(rec["best_enrich"]), int(rec["n_expr"]),
                     n_top, n_total, best_enrich, int((col > 0).sum())))
    check("%s 前 %d 基因 enrich/自洽/计数逐点一致（实际一致 %d）"
          % (species, n_chk, n_ok_enrich), n_ok_enrich == n_chk and n_chk > 0)

    # D 排序键独立验证：tsv 顺序必须满足排序键非降规则
    keys = [(-int(r["n_samples_top"]), -float(r["best_enrich"]),
             float(r["frac_all"]), r["ensembl_id"]) for _, r in tsv.iterrows()]
    ok_order = all(keys[i] <= keys[i + 1] for i in range(len(keys) - 1))
    check("%s tsv 顺序符合排序键" % species, ok_order)

    # E targets 集合 = tsv 前 N_TARGETS
    # uns 键是 target1..targetN，字符串字典序会把 target10 插到第二位，
    # 必须按数值后缀排序（回读自身踩过：字典序排 target1/target10/target2...）
    uns_targets = loc_uns["targets"]
    check("%s targets 数=%d" % (species, N_TARGETS),
          len(uns_targets) == N_TARGETS, str(len(uns_targets)))
    top_genes_tsv = tsv.head(N_TARGETS)["ensembl_id"].tolist()
    top_genes_uns = [v["ensembl_id"] for k, v in sorted(
        uns_targets.items(), key=lambda kv: int(kv[0].replace("target", "")))]
    check("%s targets 与 tsv 前 N 一致" % species, top_genes_uns == top_genes_tsv,
          "%s vs %s" % (top_genes_uns[:3], top_genes_tsv[:3]))
    check("%s top_target_gene=tsv 首行" % species,
          loc_uns["top_target_gene"] == top_genes_tsv[0])
    # target1 的字段与 tsv 首行对账（uns 是 4 位舍入值，tsv 同舍入口径）
    t1 = uns_targets["target1"]
    r0 = tsv.iloc[0]
    check("%s target1 基因=tsv 首行" % species, t1["ensembl_id"] == r0["ensembl_id"])
    check("%s target1 n_expr 一致" % species, int(t1["n_expr"]) == int(r0["n_expr"]))
    check("%s target1 best_enrich 一致（uns round4 vs tsv round4）" % species,
          abs(float(t1["best_enrich"]) - round(float(r0["best_enrich"]), 4)) < 1e-9,
          "%s vs %s" % (t1["best_enrich"], r0["best_enrich"]))
    check("%s target1 symbol 与 var 一致" % species,
          str(t1["gene_symbol"]) == str(
              a10.var["gene_symbol"].iloc[var_index[t1["ensembl_id"]]]))

    # F spot 级贴回 = top 目标基因表达列
    spot_vals = a12.obs["target_gene_expr"].to_numpy(dtype=float)
    ref_col = np.asarray(X[:, var_index[loc_uns["top_target_gene"]]].toarray()).ravel()
    check("%s spot target_gene_expr 与 top 基因列一致" % species,
          np.allclose(spot_vals, ref_col, atol=1e-12))
    check("%s spot 值非负有限" % species,
          bool(np.all(np.isfinite(spot_vals)) and np.all(spot_vals >= -1e-12)))

    # G 不变量 vs 步骤 10 产物
    check("%s X nnz 不变" % species, a12.X.nnz == a10.X.nnz)
    check("%s counts 层 nnz 不变" % species,
          a12.layers["counts"].nnz == a10.layers["counts"].nnz)
    check("%s X_pca 不变" % species,
          np.allclose(np.asarray(a12.obsm["X_pca"]), np.asarray(a10.obsm["X_pca"])))
    check("%s domain 列不变" % species,
          a12.obs["domain"].astype(str).equals(a10.obs["domain"].astype(str)))
    check("%s obs_names 不变" % species,
          list(a12.obs_names) == list(a10.obs_names))
    check("%s var_names 不变" % species,
          list(a12.var_names) == list(a10.var_names))
    for col_name in ["lr_score_recv", "domain_rank", "domain_prop"]:
        check("%s 上游 obs 列 %s 保留" % (species, col_name), col_name in a12.obs.columns)
    check("%s uns communication 保留" % species, "communication" in a12.uns)

print()
print("PASSED=%d FAILED=%d" % (PASSED, FAILED))
sys.exit(1 if FAILED else 0)

