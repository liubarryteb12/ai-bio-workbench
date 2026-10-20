# s4_marker_readback：步骤 6 产物回读验证（不变量 + 对账 + 命中复核）
import json

import numpy as np
import pandas as pd
import anndata as ad

ad.settings.allow_write_nullable_strings = False

BASE = "/mnt/ssd/bio_data/line3_spatial/processed"
SRC = {"mouse": "%s/spatial_domains_mouse.h5ad" % BASE,
       "human": "%s/spatial_domains_human.h5ad" % BASE}
OUT = {"mouse": "%s/s4_marker_test/spatial_marker_mouse.h5ad" % BASE,
       "human": "%s/s4_marker_test/spatial_marker_human.h5ad" % BASE}
TSV = {"mouse": "%s/s4_marker_test/domain_markers_mouse.tsv" % BASE,
       "human": "%s/s4_marker_test/domain_markers_human.tsv" % BASE}
N_DOMAINS = {"mouse": 57, "human": 18}

checks = []


def ck(name, ok, detail=""):
    checks.append({"check": name, "ok": bool(ok), "detail": str(detail)})
    print("%s %s %s" % ("PASS" if ok else "FAIL", name, detail))


for species in ["mouse", "human"]:
    src = ad.read_h5ad(SRC[species])
    out = ad.read_h5ad(OUT[species])
    tsv = pd.read_csv(TSV[species], sep="\t")
    nd = N_DOMAINS[species]

    # 1. 形状与 obs 列
    ck("%s_shape" % species, out.shape == src.shape, "%s" % str(out.shape))
    ck("%s_obs_cols" % species, list(out.obs.columns) == list(src.obs.columns),
       "%d 列" % len(out.obs.columns))
    ck("%s_domain_unchanged" % species, out.obs["domain"].equals(src.obs["domain"]), "")
    ck("%s_obs_names" % species, out.obs_names.equals(src.obs_names), "")

    # 2. 不变量
    ck("%s_X_nnz" % species, out.X.nnz == src.X.nnz, "%d" % out.X.nnz)
    ck("%s_counts_nnz" % species, out.layers["counts"].nnz == src.layers["counts"].nnz,
       "%d" % out.layers["counts"].nnz)
    ck("%s_X_pca_equal" % species, np.array_equal(out.obsm["X_pca"], src.obsm["X_pca"]), "")
    ck("%s_spatial_pair" % species,
       "spatial" in out.obsm and "spatial" in out.uns, "")
    ck("%s_uns_spatial_samples" % species,
       set(out.uns["spatial"].keys()) == set(src.uns["spatial"].keys()), "")

    # 3. uns 新键
    ck("%s_uns_markers" % species, "markers" in out.uns,
       json.dumps({k: v for k, v in out.uns["markers"].items()
                   if k not in ("panel", "panel_hits", "sanity_genes")}, ensure_ascii=False, default=str))
    ck("%s_uns_domain_markers" % species, "domain_markers" in out.uns,
       "groups=%s" % list(out.uns["domain_markers"].keys()))
    # domain_markers 每组 200 个名字（scanpy 标准结构：外层统计量、内层结构化数组字段为 group）
    dm = out.uns["domain_markers"]
    n_names = {g: len(np.atleast_1d(dm["names"][g])) for g in dm["names"].dtype.names}
    ck("%s_domain_markers_200" % species, all(v == 200 for v in n_names.values()),
       "groups=%d min=%d max=%d" % (len(n_names), min(n_names.values()), max(n_names.values())))

    # 4. tsv 口径
    expect_cols = ["group", "rank", "ensembl_id", "gene_symbol", "scores",
                   "logfoldchanges", "pvals", "pvals_adj", "pct_nz_group", "pct_nz_reference"]
    ck("%s_tsv_cols" % species, list(tsv.columns) == expect_cols, "%s" % list(tsv.columns))
    ck("%s_tsv_rows" % species, len(tsv) == 20 * nd, "%d 行（预期 %d）" % (len(tsv), 20 * nd))
    ck("%s_tsv_group_set" % species, set(tsv["group"]) == set(out.obs["domain"].unique()),
       "%d 域" % tsv["group"].nunique())
    ck("%s_tsv_rank_range" % species,
       tsv["rank"].min() == 1 and tsv["rank"].max() == 20, "")
    ck("%s_tsv_symbol_noNA" % species, int(tsv["gene_symbol"].isna().sum()) == 0, "")
    ck("%s_tsv_scores_desc" % species,
       all(tsv[tsv["group"] == g]["scores"].is_monotonic_decreasing for g in tsv["group"].unique()),
       "每组 scores 降序")

    # 5. tsv 与 uns['domain_markers'] 对账：每组 top20 的 ensembl_id 集合一致
    mismatch = []
    for g in tsv["group"].unique():
        tsv_ids = set(tsv[tsv["group"] == g]["ensembl_id"])
        uns_ids = set(list(dm["names"][g])[:20])
        if tsv_ids != uns_ids:
            mismatch.append(g)
    ck("%s_tsv_vs_uns" % species, not mismatch, "mismatch=%s" % mismatch[:3])

    # 6. panel / sanity 命中复核（与探针一致）
    mk = out.uns["markers"]
    ck("%s_panel_hits_recorded" % species, len(mk["panel_hits"]) == len(mk["panel"]),
       json.dumps(mk["panel_hits"], ensure_ascii=False))

# 7. 报告文件
import os
rep = open("%s/s4_marker_test/marker_report.txt" % BASE, encoding="utf-8").read()
ck("report_step", "step=spatial_markers" in rep, "")
ck("report_panel", "panel_hits" in rep, "")
ck("report_files", all(f in os.listdir("%s/s4_marker_test" % BASE)
                       for f in ["spatial_marker_mouse.h5ad", "spatial_marker_human.h5ad",
                                 "domain_markers_mouse.tsv", "domain_markers_human.tsv",
                                 "marker_report.txt"]),
   str(sorted(os.listdir("%s/s4_marker_test" % BASE))))

n_fail = sum(1 for c in checks if not c["ok"])
print("TOTAL %d checks, %d failed" % (len(checks), n_fail))
with open("/tmp/s4_marker_readback.json", "w") as fh:
    json.dump(checks, fh, ensure_ascii=False, indent=1)
print("READBACK_DONE")
