#!/usr/bin/env python3
"""步骤 13 回读验证：spatial_knockout 产物独立重算对账。

纪律（坑 #119）：参考值从上游产物/tsv 独立重算，不调 scTenifold 同源函数。
检查项：
  A. h5ad 结构：obs 26 列 + ko_dr_expr、var 15 列、uns['knockout'] 键与口径；
  B. tsv 结构：11 列、species/ko_gene 一致、significant 布尔、adj p 与 is_knockout 互斥；
  C. 对账 1：每样本 tsv 行数 == uns['sample_dr_stats_json'] 的 n_dr_genes；
  D. 对账 2：物种级 n_significant_dr == 跨样本 significant 并集基因数；
  E. 对账 3：top_dr 的 n_sig_samples/adj_p 与 tsv 独立重算一致；
  F. 对账 4：ko_dr_expr == 显著基因 spot counts 均值（独立重算）；
  G. 对账 5：显著基因不在敲除基因内、敲除基因始终 is_knockout_gene；
  H. 不变量：spots/genes 与步骤 12 一致、X nnz/counts nnz/X_pca/domain 不变；
  I. 样本级一致性：skipped 样本无 tsv 行。
"""
import json
import sys

import anndata as ad
import numpy as np
import pandas as pd

ad.settings.allow_write_nullable_strings = False

BASE = "/mnt/ssd/bio_data/line3_spatial/processed"
SRC12 = BASE + "/spatial_localization_%s.h5ad"
KO13 = BASE + "/spatial_knockout_%s.h5ad"
TSV = BASE + "/ko_dr_genes_%s.tsv"

fails = []
passes = [0]


def check(cond, msg):
    if cond:
        passes[0] += 1
    else:
        fails.append(msg)


for species, exp_spots, exp_genes in [("mouse", 17283, 18628), ("human", 6877, 19613)]:
    print("=" * 70)
    print("[%s]" % species)
    a12 = ad.read_h5ad(SRC12 % species)
    a = ad.read_h5ad(KO13 % species)
    tsv = pd.read_csv(TSV % species, sep="\t", dtype={"sample_id": str})
    print("  h5ad %s, tsv %d 行" % (a.shape, len(tsv)))

    # H. 不变量 + 规模
    check(a.shape == (exp_spots, exp_genes),
          "%s h5ad 规模 %s 期望 (%d,%d)" % (species, a.shape, exp_spots, exp_genes))
    check(list(a12.obs_names) == list(a.obs_names), "%s obs_names 与步骤 12 不一致" % species)
    check(list(a12.var_names) == list(a.var_names), "%s var_names 与步骤 12 不一致" % species)
    check(a.X.nnz == a12.X.nnz, "%s X nnz 变了 %d->%d" % (species, a12.X.nnz, a.X.nnz))
    check(a.layers["counts"].nnz == a12.layers["counts"].nnz,
          "%s counts nnz 变了 %d->%d" % (species, a12.layers["counts"].nnz,
                                        a.layers["counts"].nnz))
    check(np.array_equal(a.obsm["X_pca"], a12.obsm["X_pca"]), "%s X_pca 被改" % species)
    check(np.array_equal(a.obsm["spatial"], a12.obsm["spatial"]), "%s spatial 被改" % species)
    check(a.obs["domain"].astype(str).equals(a12.obs["domain"].astype(str)),
          "%s domain 被改" % species)

    # A. uns['knockout']
    ko_uns = a.uns.get("knockout")
    check(isinstance(ko_uns, dict), "%s 缺 uns['knockout']" % species)
    need_keys = ["method", "note", "seed", "ko_gene", "ko_gene_note", "ko_gene_requested",
                 "alpha", "n_samples_total", "n_samples_ok", "skipped_samples",
                 "n_genes_in_dr", "n_genes_hvg_universe", "n_significant_dr",
                 "sample_dr_stats_json", "seconds", "top_dr", "source_h5ad"]
    miss = [k for k in need_keys if k not in ko_uns]
    check(not miss, "%s uns['knockout'] 缺键 %s" % (species, miss))
    check(ko_uns["seed"] == 20261013, "%s uns seed=%s" % (species, ko_uns["seed"]))
    check(ko_uns["alpha"] == 0.05, "%s uns alpha=%s" % (species, ko_uns["alpha"]))
    check(a12.uns["seed"] == 20261013, "%s 上游 seed=%s 不一致" % (species, a12.uns["seed"]))
    check(ko_uns["n_samples_ok"] + len(ko_uns["skipped_samples"]) == ko_uns["n_samples_total"],
          "%s 样本数不对账 %d+%d != %d" % (species, ko_uns["n_samples_ok"],
                                       len(ko_uns["skipped_samples"]),
                                       ko_uns["n_samples_total"]))
    exp_ko_gene = "Spp1" if species == "mouse" else "SPP1"
    check(ko_uns["ko_gene"] == exp_ko_gene,
          "%s ko_gene=%s 期望 %s" % (species, ko_uns["ko_gene"], exp_ko_gene))
    stats = json.loads(ko_uns["sample_dr_stats_json"])
    check(sum(1 for r in stats if r["status"] == "ok") == ko_uns["n_samples_ok"],
          "%s stats ok 数与 uns 不一致" % species)

    # B. tsv 结构
    need_cols = ["species", "ko_gene", "sample_id", "Gene", "Distance", "Z", "FC",
                 "p-value", "adjusted p-value", "is_knockout_gene", "significant"]
    check(list(tsv.columns) == need_cols,
          "%s tsv 列 %s" % (species, list(tsv.columns)))
    check((tsv["species"] == species).all(), "%s tsv species 混值" % species)
    check((tsv["ko_gene"] == exp_ko_gene).all(), "%s tsv ko_gene 混值" % species)
    check(tsv["adjusted p-value"].between(0, 1).all(), "%s adj p 越界" % species)
    # G. 敲除基因互斥
    ko_rows = tsv[tsv["is_knockout_gene"]]
    check((ko_rows["Gene"] == exp_ko_gene).all(), "%s is_knockout 行 Gene 不符" % species)
    check(not ko_rows["significant"].any(),
          "%s 敲除基因出现在显著 DR（应自动排除）" % species)
    check(bool((tsv["Gene"] == exp_ko_gene).any()),
          "%s tsv 未见敲除基因行（应在每样本 DR 表内）" % species)

    # C. 每样本行数对账
    cnt = tsv.groupby("sample_id").size()
    for r in stats:
        got = int(cnt.get(r["sample_id"], 0))
        check(got == r["n_dr_genes"],
              "%s %s tsv 行数 %d != stats %d" % (species, r["sample_id"], got,
                                              r["n_dr_genes"]))
        if r["status"] != "ok":
            check(got == 0, "%s skipped 样本 %s 却有 %d 行" % (species, r["sample_id"], got))

    # D. 物种级显著并集
    sig_genes = set(tsv.loc[tsv["significant"], "Gene"].astype(str))
    check(len(sig_genes) == ko_uns["n_significant_dr"],
          "%s 显著并集 %d != uns %d" % (species, len(sig_genes),
                                     ko_uns["n_significant_dr"]))

    # E. top_dr 独立重算
    agg = {}
    for g, sub in tsv[tsv["significant"]].groupby("Gene"):
        agg[g] = (len(sub), float(sub["adjusted p-value"].min()))
    expect_top = sorted(agg, key=lambda g: (-agg[g][0], agg[g][1]))[:10]
    got_top = [ko_uns["top_dr"]["dr%d" % i]["gene"] for i in range(1, len(expect_top) + 1)]
    check(expect_top == got_top,
          "%s top_dr 期望 %s 实得 %s" % (species, expect_top, got_top))
    for i in range(1, 11):
        entry = ko_uns["top_dr"].get("dr%d" % i)
        if entry is None:
            check(len(expect_top) < i, "%s top_dr 缺 dr%d（期望 %d 个）" % (species, i,
                                                                      len(expect_top)))
            continue
        n_exp, p_exp = agg[entry["gene"]]
        check(entry["n_sig_samples"] == n_exp,
              "%s top_dr %s n_sig %d != %d" % (species, entry["gene"],
                                            entry["n_sig_samples"], n_exp))
        check(abs(entry["adj_p"] - p_exp) <= 1e-12 * max(1.0, p_exp),
              "%s top_dr %s adj_p %g != %g" % (species, entry["gene"],
                                            entry["adj_p"], p_exp))

    # F. ko_dr_expr 独立重算（显著基因 spot counts 均值）
    if sig_genes:
        counts = a.layers["counts"].tocsr()
        first_pos = {}
        for i, s in enumerate(a.var["gene_symbol"].astype(str).tolist()):
            first_pos.setdefault(s, i)
        cols = [first_pos[g] for g in sorted(sig_genes) if g in first_pos]
        mat = np.asarray(counts[:, cols].todense(), dtype=float)
        expect = mat.mean(axis=1)
        got = a.obs["ko_dr_expr"].to_numpy(dtype=float)
        check(np.allclose(got, expect, rtol=1e-9, atol=1e-9),
              "%s ko_dr_expr 与独立重算不一致 maxdiff=%g"
              % (species, float(np.max(np.abs(got - expect))) if len(got) else -1))
    check("ko_dr_expr" in a.obs.columns, "%s 缺 obs['ko_dr_expr']" % species)
    check(np.isfinite(a.obs["ko_dr_expr"].to_numpy(dtype=float)).all(),
          "%s ko_dr_expr 有非有限值" % species)

    # A. 输入契约列完整（步骤 12 键集合 + ko_dr_expr）
    need_obs = ["barcode", "sample_id", "species", "domain", "lr_score_recv",
                "target_gene_expr", "ko_dr_expr"]
    miss_obs = [c for c in need_obs if c not in a.obs.columns]
    check(not miss_obs, "%s obs 缺 %s" % (species, miss_obs))
    check("localization" in a.uns and "knockout" in a.uns,
          "%s uns 缺 localization/knockout" % species)
    check(np.array_equal(a.obsm["X_umap"], a12.obsm["X_umap"]), "%s X_umap 被改" % species)

print("=" * 70)
if fails:
    print("FAIL %d 项：" % len(fails))
    for f in fails:
        print("  - %s" % f)
    sys.exit(1)
print("ALL_PASS %d 项检查全过" % passes[0])
