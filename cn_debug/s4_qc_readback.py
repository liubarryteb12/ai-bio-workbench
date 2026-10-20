# s4_qc_readback.py：S4 步骤 2 回读验证：两个 qc h5ad + spot_qc_metrics 全内容核对
import sys

import anndata as ad
import numpy as np
import pandas as pd

PROCESSED = "/mnt/ssd/bio_data/line3_spatial/processed"
EXPECT = {
    "mouse": {"spots": 17283, "genes": 18628, "before": 17290, "genes_before": 31053,
              "samples": {"JBO001": 1646, "JBO002": 1651, "JBO003": 1604, "JBO004": 2284,
                          "CAP002": 438, "JBO006": 1279, "JBO009": 2348, "JBO010": 2074,
                          "JBO012": 2253, "BH001": 1706}},
    "human": {"spots": 6877, "genes": 19613, "before": 6889, "genes_before": 32738,
              "samples": {"JBO014": 1244, "JBO015": 530, "JBO018": 2500,
                          "JBO019": 1184, "JBO022": 1419}},
}
MITO_PREFIX = {"mouse": "mt-", "human": "MT-"}


def check(name, cond, detail=""):
    status = "OK" if cond else "FAIL"
    print("%s %s %s" % (status, name, detail))
    if not cond:
        sys.exit(1)


for tag, exp in EXPECT.items():
    path = "%s/spatial_qc_%s.h5ad" % (PROCESSED, tag)
    a = ad.read_h5ad(path)
    print("=== %s ===" % tag)
    check("shape", a.n_obs == exp["spots"] and a.n_vars == exp["genes"],
          "spots=%d genes=%d" % (a.n_obs, a.n_vars))
    check("X_csr", a.X.getformat() == "csr", "format=%s" % a.X.getformat())
    check("X_nonneg", a.X.min() >= 0)
    check("obs_names_unique", a.obs_names.is_unique)
    # obs 列不丢 + 新增 QC 列在位
    for col in ["barcode", "sample_id", "gsm", "species", "platform_id", "strain",
                "condition", "condition_class", "group", "tissue", "in_tissue",
                "array_row", "array_col", "pxl_row_fullres", "pxl_col_fullres"]:
        check("obs_col_%s" % col, col in a.obs.columns)
    for col in ["total_counts", "n_genes_by_counts", "pct_mito"]:
        check("obs_qc_col_%s" % col, col in a.obs.columns)
    for col in ["gene_symbol", "genome", "feature_type"]:
        check("var_col_%s" % col, col in a.var.columns)
    # 逐样本 spot 数
    counts = a.obs["sample_id"].value_counts().to_dict()
    check("per_sample_spots", counts == exp["samples"], str(counts))
    # 阈值在保留矩阵上生效
    check("min_counts", a.obs["total_counts"].min() >= 100,
          "min=%d" % a.obs["total_counts"].min())
    check("min_features", a.obs["n_genes_by_counts"].min() >= 50,
          "min=%d" % a.obs["n_genes_by_counts"].min())
    check("max_mito", a.obs["pct_mito"].max() <= 50.0,
          "max=%.2f" % a.obs["pct_mito"].max())
    # 指标列与矩阵一致
    recomputed = np.asarray(a.X.sum(axis=1)).ravel()
    check("total_counts_matches_matrix",
          bool((recomputed == a.obs["total_counts"].to_numpy()).all()))
    recount = np.asarray(a.X.sum(axis=1)).ravel()
    nfeat = np.diff(a.X.indptr)
    check("n_genes_matches_matrix",
          bool((nfeat == a.obs["n_genes_by_counts"].to_numpy()).all()))
    # 基因过滤生效：每基因 spot 数 >= 3
    gene_spots = np.bincount(a.X.indices, minlength=a.n_vars)
    check("gene_min_spots", gene_spots.min() >= 3, "min=%d" % gene_spots.min())
    check("gene_spots_sum_eq_nnz", gene_spots.sum() == a.X.nnz)
    # uns 完整：spatial 图、scalefactors、口径键、qc 键
    check("uns_seed", a.uns.get("seed") == "20261013", str(a.uns.get("seed")))
    check("uns_samples", sorted(a.uns.get("samples", [])) == sorted(exp["samples"]))
    check("uns_spatial_keys", sorted(a.uns.get("spatial", {}).keys()) == sorted(exp["samples"]))
    for sf in exp["samples"]:
        entry = a.uns["spatial"][sf]
        img = entry["images"]["lowres"]
        scf = entry["scalefactors"]
        if not (img.ndim == 3 and img.shape[2] == 3 and len(scf) == 4):
            check("spatial_entry_%s" % sf, False, str(img.shape))
    print("spatial entries all OK (lowres RGB + 4 scalefactors)")
    for key in ["seed", "source_tar", "species", "genome", "gene_id_type", "samples",
                "coord_note", "image_note"]:
        check("uns_key_%s" % key, key in a.uns)
    qc = a.uns.get("qc", {})
    check("uns_qc_step", qc.get("step") == "qc_spots")
    check("uns_qc_thresholds",
          qc.get("min_counts") == 100 and qc.get("min_features") == 50
          and qc.get("max_mito_pct") == 50.0 and qc.get("gene_min_spots") == 3,
          str({k: qc.get(k) for k in ("min_counts", "min_features", "max_mito_pct", "gene_min_spots")}))
    check("uns_qc_counts",
          qc.get("spots_before") == exp["before"] and qc.get("spots_after") == exp["spots"]
          and qc.get("genes_before") == exp["genes_before"] and qc.get("genes_after") == exp["genes"],
          "spots %d->%d genes %d->%d" % (qc.get("spots_before", -1), qc.get("spots_after", -1),
                                         qc.get("genes_before", -1), qc.get("genes_after", -1)))
    # obsm spatial 坐标与 obs array 行列数一致
    check("obsm_spatial", "spatial" in a.obsm and a.obsm["spatial"].shape == (a.n_obs, 2))
    print()

# spot_qc_metrics.tsv 全量核对：行数 = 两物种过滤前总数，keep 列与 h5ad 一致
m = pd.read_csv("%s/spot_qc_metrics.tsv" % PROCESSED, sep="\t")
print("=== spot_qc_metrics.tsv ===")
check("rows", len(m) == 17290 + 6889, "rows=%d" % len(m))
check("columns", {"species", "sample_id", "group", "condition", "ncount", "nfeature",
                  "pct_mito", "qc_keep", "drop_reason"} <= set(m.columns),
      str(sorted(m.columns)))
kept = m[m["qc_keep"]]
check("kept_rows", len(kept) == 17283 + 6877, "kept=%d" % len(kept))
dropped = m[~m["qc_keep"]]
check("dropped_rows", len(dropped) == 19, "dropped=%d" % len(dropped))
check("drop_reasons_filled", (dropped["drop_reason"] != "").all(),
      str(dropped["drop_reason"].value_counts().to_dict()))
# 指标表与 h5ad 的 kept 集合一致（按 obs_name 对账）
for tag, exp in EXPECT.items():
    a = ad.read_h5ad("%s/spatial_qc_%s.h5ad" % (PROCESSED, tag))
    sub = m[(m["species"] == ("Mus musculus" if tag == "mouse" else "Homo sapiens")) & m["qc_keep"]]
    check("metrics_vs_h5ad_%s" % tag,
          set(sub["obs_name"]) == set(a.obs_names),
          "metrics=%d h5ad=%d" % (len(sub), a.n_obs))

print("ALL_READBACK_OK")
