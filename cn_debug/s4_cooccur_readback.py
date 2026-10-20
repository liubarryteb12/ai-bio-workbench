# s4_cooccur_readback：步骤 8 回读验证（含朴素双重循环核对单样本共现矩阵）
import json
import os

import numpy as np
import pandas as pd
import anndata as ad
from scipy.spatial import cKDTree

ad.settings.allow_write_nullable_strings = False

BASE = "/mnt/ssd/bio_data/line3_spatial/processed/s4_cooccur_test"
SRC = "/mnt/ssd/bio_data/line3_spatial/processed"
K_NN = 6
N_PERM = 100
SEED = 20261013
NAIVE_SAMPLE = {"mouse": "BH001", "human": "JBO014"}
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print("%s %s %s" % ("PASS" if ok else "FAIL", name, detail))


def naive_cooccurrence(coords, labels, n_types, k):
    """朴素双重循环：教科书定义式共现矩阵（稠密 w 逐格累加，无稀疏批处理）。
    权重定义与生产脚本逐点一致：有向 KNN 邻接 A -> 对称化 A+A.T（互向近邻
    权重为 2）-> 行标准化。参考实现若改成并集对称（互向为 1）会与生产差
    0.4-0.7%，属定义性偏差，不是生产算错。"""
    n = coords.shape[0]
    tree = cKDTree(coords)
    _, idx = tree.query(coords, k=k + 1)
    a = np.zeros((n, n))
    for i in range(n):
        for j in idx[i, 1:]:
            a[i, j] = 1.0
    w = a + a.T
    rs = w.sum(axis=1)
    rs[rs == 0] = 1.0
    w = w / rs[:, None]
    c = np.zeros((n_types, n_types))
    for i in range(n):
        for j in range(n):
            c[labels[i], labels[j]] += w[i, j]
    return c / c.sum(axis=1, keepdims=True)


for species in ["mouse", "human"]:
    a = ad.read_h5ad("%s/spatial_cooccurrence_%s.h5ad" % (BASE, species))
    check("%s_h5ad_readable" % species, a.shape[0] > 0 and a.shape[1] > 0,
          "spots=%d genes=%d" % (a.shape[0], a.shape[1]))

    # --- obs 新列与旧列 ---
    check("%s_obs_new_cols" % species,
          "domain_same_frac" in a.obs.columns and "domain_same_z" in a.obs.columns,
          str([c for c in ["domain_same_frac", "domain_same_z"] if c not in a.obs.columns]))
    src = ad.read_h5ad("%s/spatial_autocorr_%s.h5ad" % (SRC, species))
    check("%s_obs_old_cols_kept" % species,
          all(c in a.obs.columns for c in src.obs.columns),
          str([c for c in src.obs.columns if c not in a.obs.columns]))
    check("%s_var_cols_kept" % species,
          all(c in a.var.columns for c in src.var.columns),
          str([c for c in src.var.columns if c not in a.var.columns]))
    check("%s_obs_cols_exact" % species,
          list(a.obs.columns) == list(src.obs.columns) + ["domain_same_frac", "domain_same_z"],
          "末尾两列=%s" % list(a.obs.columns)[-2:])

    # --- uns 口径 ---
    co = a.uns.get("cooccurrence", {})
    check("%s_uns_keys" % species,
          co.get("knn") == K_NN and co.get("symmetrized") is True
          and co.get("row_standardized") is True and co.get("n_perm") == N_PERM
          and co.get("seed") == SEED and co.get("samples_total") == a.obs["sample_id"].nunique(),
          "knn=%s n_perm=%s seed=%s samples_total=%s"
          % (co.get("knn"), co.get("n_perm"), co.get("seed"), co.get("samples_total")))
    samples_uns = co.get("samples", {})
    ok_entries = all(
        all(k in v for k in ["n_spots", "domains", "cooccurrence_norm", "enrichment_z"])
        for v in samples_uns.values())
    n_spots_ok = all(
        int((a.obs["sample_id"] == s).sum()) == v["n_spots"] for s, v in samples_uns.items())
    check("%s_uns_samples_entries" % species,
          ok_entries and n_spots_ok and set(samples_uns) == set(a.obs["sample_id"].unique()),
          "samples=%d" % len(samples_uns))
    # uns 值为 4 位小数舍入，行和容差按类型数放宽
    row_norm_ok = all(
        abs(float(np.sum(np.asarray(v["cooccurrence_norm"], dtype=float), axis=1).min()) - 1.0) < 1e-3
        and abs(float(np.sum(np.asarray(v["cooccurrence_norm"], dtype=float), axis=1).max()) - 1.0) < 1e-3
        for v in samples_uns.values())
    check("%s_uns_row_normalized" % species, row_norm_ok)
    z_diag_pos = all(
        min(np.diag(np.asarray(v["enrichment_z"], dtype=float))) > 0 for v in samples_uns.values())
    check("%s_uns_z_diag_positive" % species, z_diag_pos)

    # --- spot 级数值范围 ---
    frac = a.obs["domain_same_frac"].to_numpy(dtype=float)
    zval = a.obs["domain_same_z"].to_numpy(dtype=float)
    check("%s_spot_frac_range" % species,
          np.all(~np.isnan(frac)) and frac.min() >= -1e-9 and frac.max() <= 1.0 + 1e-9,
          "frac=[%.4f, %.4f]" % (float(frac.min()), float(frac.max())))
    check("%s_spot_z_positive" % species,
          np.all(~np.isnan(zval)) and zval.min() > 0,
          "z min=%.2f mean=%.2f" % (float(zval.min()), float(zval.mean())))

    # --- tsv 核对 ---
    with open("%s/domain_cooccurrence_%s.tsv" % (BASE, species)) as fh:
        lines = fh.read().splitlines()
    header = lines[0].split("\t")
    check("%s_tsv_header" % species,
          header == ["sample_id", "domain", "n_spots", "same_frac", "same_z",
                     "top_partner_domain", "top_partner_frac"], str(header))
    tsv = pd.read_csv("%s/domain_cooccurrence_%s.tsv" % (BASE, species), sep="\t")
    expected_rows = sum(len(v["domains"]) for v in samples_uns.values())
    check("%s_tsv_rows" % species, len(tsv) == expected_rows,
          "rows=%d expected=%d" % (len(tsv), expected_rows))
    check("%s_tsv_z_positive" % species, bool((tsv["same_z"] > 0).all()),
          "z min=%.2f" % float(tsv["same_z"].min()))

    # --- spot 级与 tsv 逐行对账 ---
    recon_ok = True
    recon_detail = ""
    for _, row in tsv.iterrows():
        mask = ((a.obs["sample_id"] == row["sample_id"]) & (a.obs["domain"] == row["domain"])).to_numpy()
        if int(mask.sum()) != int(row["n_spots"]):
            recon_ok = False
            recon_detail = "%s/%s n_spots %d vs %d" % (row["sample_id"], row["domain"],
                                                       int(mask.sum()), int(row["n_spots"]))
            break
        if not (np.all(np.abs(frac[mask] - row["same_frac"]) <= 1e-4)
                and np.all(np.abs(zval[mask] - row["same_z"]) <= 5e-3)):
            recon_ok = False
            recon_detail = "%s/%s 数值不对账" % (row["sample_id"], row["domain"])
            break
    check("%s_spot_tsv_reconcile" % species, recon_ok, recon_detail or "全部 %d 行对账通过" % len(tsv))

    # --- top partner 与 uns 归一化矩阵一致 ---
    partner_ok = True
    partner_detail = ""
    for _, row in tsv.iterrows():
        v = samples_uns[row["sample_id"]]
        doms = list(v["domains"])
        di = doms.index(row["domain"])
        crow = np.asarray(v["cooccurrence_norm"][di], dtype=float)
        off = crow.copy()
        off[di] = -np.inf
        top = int(np.argmax(off))
        if v["domains"][top] != row["top_partner_domain"] or abs(crow[top] - row["top_partner_frac"]) > 1e-4:
            partner_ok = False
            partner_detail = "%s/%s top=%s(%.4f) vs tsv %s(%.4f)" % (
                row["sample_id"], row["domain"], v["domains"][top], crow[top],
                row["top_partner_domain"], row["top_partner_frac"])
            break
    check("%s_top_partner_matches_uns" % species, partner_ok, partner_detail or "全部一致")

    # --- 朴素核对：单样本共现矩阵对角 ---
    sample = NAIVE_SAMPLE[species]
    sub = a[a.obs["sample_id"] == sample]
    dom = sub.obs["domain"].astype("category")
    cats = list(dom.cat.categories)
    labels = dom.cat.codes.to_numpy()
    c_naive = naive_cooccurrence(np.asarray(sub.obsm["spatial"]), labels, len(cats), K_NN)
    diag_naive = np.diag(c_naive)
    c_uns = np.asarray(samples_uns[sample]["cooccurrence_norm"], dtype=float)
    diff_uns = float(np.abs(diag_naive - np.diag(c_uns)).max())
    tsv_s = tsv[tsv["sample_id"] == sample].set_index("domain")
    diff_tsv = float(max(abs(diag_naive[cats.index(d)] - tsv_s.loc[d, "same_frac"]) for d in cats))
    check("%s_naive_single_sample_diag" % species,
          diff_uns <= 1e-4 and diff_tsv <= 1e-4,
          "%s n=%d naive_diag=%s diff_uns=%.2e diff_tsv=%.2e"
          % (sample, sub.shape[0], [round(float(v), 4) for v in diag_naive], diff_uns, diff_tsv))

    # --- 不变量（对步骤 7 产物） ---
    check("%s_invariant_x_nnz" % species, a.X.nnz == src.X.nnz, "%d vs %d" % (a.X.nnz, src.X.nnz))
    check("%s_invariant_counts_nnz" % species, a.layers["counts"].nnz == src.layers["counts"].nnz)
    check("%s_invariant_pca" % species, np.array_equal(a.obsm["X_pca"], src.obsm["X_pca"]))
    check("%s_invariant_domain" % species, a.obs["domain"].equals(src.obs["domain"]))
    check("%s_invariant_obs_names" % species, list(a.obs_names) == list(src.obs_names))

# --- 报告与产物 ---
report_path = "%s/cooccurrence_report.txt" % BASE
check("report_file", os.path.isfile(report_path) and os.path.getsize(report_path) > 0,
      "%d bytes" % (os.path.getsize(report_path) if os.path.isfile(report_path) else -1))
if os.path.isfile(report_path):
    with open(report_path) as fh:
        report = fh.read()
    check("report_content",
          "step=spatial_cooccurrence" in report and "seed=%d" % SEED in report
          and "[mouse]" in report and "[human]" in report and "same_z_min" in report,
          "含 step/seed/两物种段/same_z_min")

expected_files = ["spatial_cooccurrence_mouse.h5ad", "spatial_cooccurrence_human.h5ad",
                  "domain_cooccurrence_mouse.tsv", "domain_cooccurrence_human.tsv",
                  "cooccurrence_report.txt"]
check("products_exist", all(os.path.getsize("%s/%s" % (BASE, f)) > 0 for f in expected_files),
      str([f for f in expected_files if not os.path.exists("%s/%s" % (BASE, f))]))

with open("/tmp/s4_cooccur_readback.json", "w") as fh:
    json.dump([{"name": n, "ok": ok, "detail": d} for n, ok, d in results], fh, ensure_ascii=False)
n_fail = sum(1 for _, ok, _ in results if not ok)
print("TOTAL=%d FAIL=%d" % (len(results), n_fail))
