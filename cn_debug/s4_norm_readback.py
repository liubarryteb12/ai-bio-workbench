# s4_norm_readback.py：S4 步骤 3 回读验证：两 norm h5ad + HVG tsv + report 全内容核对
import os
import sys

import anndata as ad
import numpy as np
import pandas as pd

OUTDIR = os.environ.get("NORM_OUTDIR", "/tmp/s4_norm_test")
SEED = "20261013"

EXPECT = {
    "mouse": {"spots": 17283, "genes": 18628, "hvg": 2000,
              "samples": {"JBO001": 1646, "JBO002": 1651, "JBO003": 1604, "JBO004": 2284,
                          "CAP002": 438, "JBO006": 1279, "JBO009": 2348, "JBO010": 2074,
                          "JBO012": 2253, "BH001": 1706}},
    "human": {"spots": 6877, "genes": 19613, "hvg": 2000,
              "samples": {"JBO014": 1244, "JBO015": 530, "JBO018": 2500,
                          "JBO019": 1184, "JBO022": 1419}},
}

n_checks = [0]


def check(name, cond, detail=""):
    status = "OK" if cond else "FAIL"
    n_checks[0] += 1
    print("%s %s %s" % (status, name, detail))
    if not cond:
        sys.exit(1)


for tag, expect in EXPECT.items():
    path = "%s/spatial_norm_%s.h5ad" % (OUTDIR, tag)
    print("=== %s ===" % tag)
    check("file_exists_%s" % tag, os.path.isfile(path), path)
    a = ad.read_h5ad(path)
    check("shape_%s" % tag, a.n_obs == expect["spots"] and a.n_vars == expect["genes"],
          "spots=%d genes=%d" % (a.n_obs, a.n_vars))
    check("X_csr_%s" % tag, a.X.getformat() == "csr", a.X.getformat())
    check("X_float_%s" % tag, not np.issubdtype(a.X.dtype, np.integer), str(a.X.dtype))
    check("X_finite_%s" % tag, bool(np.isfinite(a.X.data).all()))
    check("X_nonneg_%s" % tag, a.X.data.size == 0 or float(a.X.data.min()) >= 0.0,
          "min=%.4f" % float(a.X.data.min()))
    # 归一化生效：每 spot log 值合计 == log(1e4 + ...) 附近；直接验 X 非整数且
    # counts 层为原始整数
    lib = np.asarray(a.X.sum(axis=1)).ravel()
    check("X_log_scaled_%s" % tag, bool((lib > 0).all()), "lib median=%.4f" % float(np.median(lib)))
    counts = a.layers["counts"]
    check("counts_layer_int_%s" % tag, bool(np.issubdtype(counts.dtype, np.integer)), str(counts.dtype))
    check("counts_layer_nnz_%s" % tag, counts.nnz == a.X.nnz,
          "counts nnz=%d X nnz=%d" % (counts.nnz, a.X.nnz))
    totals = np.asarray(counts.sum(axis=1)).ravel()
    check("counts_totals_match_%s" % tag, bool((totals == a.obs["total_counts"].to_numpy()).all()))
    # obs/var 列
    for col in ["barcode", "sample_id", "gsm", "species", "platform_id", "strain",
                "condition", "condition_class", "group", "tissue", "in_tissue",
                "array_row", "array_col", "pxl_row_fullres", "pxl_col_fullres",
                "ncount", "nfeature", "total_counts", "n_genes_by_counts", "pct_mito"]:
        check("obs_col_%s" % col, col in a.obs.columns)
    for col in ["gene_symbol", "genome", "feature_type"]:
        check("var_col_%s" % col, col in a.var.columns)
    check("obs_names_unique_%s" % tag, a.obs_names.is_unique)
    per_sample = a.obs["sample_id"].value_counts().to_dict()
    check("per_sample_spots_%s" % tag, per_sample == expect["samples"], str(per_sample))
    # uns 口径键
    for key in ["seed", "source_tar", "source_soft_mouse", "source_soft_human",
                "grouping_check", "species", "genome", "gene_id_type", "samples",
                "coord_note", "image_note", "qc", "normalization", "hvg", "source_h5ad"]:
        check("uns_%s" % key, key in a.uns)
    check("uns_norm_target_%s" % tag, a.uns["normalization"]["target_sum"] == 1e4,
          str(a.uns["normalization"]))
    check("uns_hvg_ntop_%s" % tag, a.uns["hvg"]["n_top_genes"] == 2000, str(a.uns["hvg"]))
    check("uns_seed_%s" % tag, int(a.uns["seed"]) == int(SEED), str(a.uns["seed"]))
    check("uns_samples_%s" % tag, sorted(a.uns["samples"]) == sorted(expect["samples"]))
    check("uns_spatial_keys_%s" % tag, sorted(a.uns["spatial"].keys()) == sorted(expect["samples"]))
    check("obsm_spatial_%s" % tag, a.obsm["spatial"].shape == (a.n_obs, 2),
          str(a.obsm["spatial"].shape))
    # spatial 图与 scalefactors 未丢（step 2 保留的）
    for sf in list(expect["samples"])[:3]:
        entry = a.uns["spatial"][sf]
        img = entry["images"]["lowres"]
        check("spatial_entry_%s_%s" % (tag, sf),
              img.ndim == 3 and img.shape[2] == 3 and len(entry["scalefactors"]) == 4)
    # HVG
    hvg_mask = a.var["highly_variable"].to_numpy(dtype=bool)
    check("hvg_count_%s" % tag, int(hvg_mask.sum()) == expect["hvg"], str(int(hvg_mask.sum())))
    tsv = pd.read_csv("%s/hvg_genes_%s.tsv" % (OUTDIR, tag), sep="\t", index_col=0)
    check("hvg_tsv_rows_%s" % tag, tsv.shape[0] == expect["hvg"], str(tsv.shape))
    check("hvg_tsv_index_match_%s" % tag,
          sorted(tsv.index) == sorted(a.var_names[hvg_mask]))
    check("hvg_tsv_disp_desc_%s" % tag,
          bool((tsv["dispersions_norm"].diff().dropna() <= 1e-9).all()))
    for col in ["gene_symbol", "genome", "means", "dispersions", "dispersions_norm"]:
        check("hvg_tsv_col_%s" % col, col in tsv.columns)
    # mito 进 HVG 数（原型实测 mouse=10 human=5，允许记录值）
    mito_prefix = "mt-" if tag == "mouse" else "MT-"
    mito_in_hvg = int(tsv["gene_symbol"].str.startswith(mito_prefix).sum())
    print("mito_in_hvg=%d（原型实测 mouse=10 human=5）" % mito_in_hvg)

report_path = "%s/norm_report.txt" % OUTDIR
check("report_exists", os.path.isfile(report_path), report_path)
with open(report_path, "r", encoding="utf-8") as fh:
    report = fh.read()
for key in ["step=normalize_hvg", "seed=%s" % SEED, "target_sum=10000",
            "n_top_genes=2000", "spatial_norm_mouse.h5ad", "spatial_norm_human.h5ad",
            "hvg_genes_mouse.tsv", "hvg_genes_human.tsv", "top20_hvg"]:
    check("report_%s" % key, key in report)
check("report_species_sections", "[mouse]" in report and "[human]" in report)

print("ALL_READBACK_OK checks=%d" % n_checks[0])
