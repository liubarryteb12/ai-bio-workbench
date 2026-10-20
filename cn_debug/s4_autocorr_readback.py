# s4_autocorr_readback：步骤 7 回读验证（含朴素双重循环核对单基因 I/C）
import json

import numpy as np
import anndata as ad
from scipy.sparse import csr_matrix
from scipy.spatial import cKDTree

ad.settings.allow_write_nullable_strings = False

BASE = "/mnt/ssd/bio_data/line3_spatial/processed/s4_autocorr_test"
K_NN = 6
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print("%s %s %s" % ("PASS" if ok else "FAIL", name, detail))


def naive_moments(x, coords, k):
    """朴素双重循环：I 与 C 的教科书定义式（无批量展开，无对称化优化写法对比用）。"""
    n = x.shape[0]
    tree = cKDTree(coords)
    _, idx = tree.query(coords, k=k + 1)
    w = np.zeros((n, n))
    for i in range(n):
        for j in idx[i, 1:]:
            w[i, j] = 1.0
            w[j, i] = 1.0
    rs = w.sum(axis=1)
    rs[rs == 0] = 1.0
    w = w / rs[:, None]
    g = x[:, 0]
    xbar = g.mean()
    num_i = sum(w[i, j] * (g[i] - xbar) * (g[j] - xbar) for i in range(n) for j in range(n))
    denom = ((g - xbar) ** 2).sum()
    i_val = (n / w.sum()) * num_i / denom
    num_c = sum(w[i, j] * (g[i] - g[j]) ** 2 for i in range(n) for j in range(n))
    c_val = ((n - 1) / (2 * w.sum())) * num_c / denom
    return i_val, c_val


for species in ["mouse", "human"]:
    a = ad.read_h5ad("%s/spatial_autocorr_%s.h5ad" % (BASE, species))
    check("%s_h5ad_readable" % species, a.shape[0] > 0 and a.shape[1] > 0,
          "spots=%d genes=%d" % (a.shape[0], a.shape[1]))
    new_cols = ["morans_i_mean", "morans_i_min", "morans_i_max", "morans_z_mean",
                "gearys_c_mean", "gearys_c_min", "gearys_c_max",
                "autocorr_n_valid_samples"]
    check("%s_var_new_cols" % species,
          all(c in a.var.columns for c in new_cols),
          str([c for c in new_cols if c not in a.var.columns]))
    old_cols = ["gene_symbol", "genome", "feature_type", "means", "dispersions",
                "dispersions_norm", "highly_variable"]
    check("%s_var_old_cols_kept" % species,
          all(c in a.var.columns for c in old_cols))
    ac = a.uns.get("autocorr", {})
    check("%s_uns_autocorr_keys" % species,
          ac.get("knn") == K_NN and ac.get("symmetrized") is True
          and ac.get("seed") == 20261013 and ac.get("samples_total") == a.obs["sample_id"].nunique(),
          "seed=%s knn=%s" % (ac.get("seed"), ac.get("knn")))
    check("%s_nan_genes_zero" % species, ac.get("nan_genes") == 0,
          "nan_genes=%s" % ac.get("nan_genes"))
    check("%s_i_range" % species,
          float(np.nanmax(np.abs(a.var["morans_i_mean"]))) <= 1.0,
          "max|I|=%.4f" % float(np.nanmax(np.abs(a.var["morans_i_mean"]))))
    check("%s_c_range" % species,
          float(a.var["gearys_c_mean"].min()) >= -1e-9 and float(a.var["gearys_c_mean"].max()) <= 2.0 + 1e-6,
          "C=[%.3f, %.3f]" % (float(a.var["gearys_c_mean"].min()), float(a.var["gearys_c_mean"].max())))
    check("%s_n_valid_no_nan_gene" % species,
          int((a.var["autocorr_n_valid_samples"] >= 1).sum()) == a.shape[1],
          "n_valid>=1 基因=%d/%d，n_valid<样本数的基因=%d"
          % (int((a.var["autocorr_n_valid_samples"] >= 1).sum()), a.shape[1],
             int((a.var["autocorr_n_valid_samples"] < a.obs["sample_id"].nunique()).sum())))
    sym = a.var["gene_symbol"].to_numpy()

    def i_of(gene):
        return float(a.var["morans_i_mean"].to_numpy()[np.where(sym == gene)[0][0]])

    def c_of(gene):
        return float(a.var["gearys_c_mean"].to_numpy()[np.where(sym == gene)[0][0]])

    if species == "mouse":
        zon, imm = ["Apoa2", "Mup3", "Hamp"], ["Cd5l", "C1qb"]
    else:
        zon, imm = ["ALB", "APOA1"], ["MARCO", "C1QB"]
    check("%s_sanity_zonation_gt_immune" % species,
          min(i_of(g) for g in zon) > max(i_of(g) for g in imm),
          "zon=%s imm=%s" % ([round(i_of(g), 3) for g in zon], [round(i_of(g), 3) for g in imm]))
    check("%s_sanity_geary_direction" % species,
          max(c_of(g) for g in zon) < min(c_of(g) for g in imm),
          "zon_C=%s imm_C=%s（C<1 均为聚集倾向，zonation 聚集更强）"
          % ([round(c_of(g), 3) for g in zon], [round(c_of(g), 3) for g in imm]))
    # 朴素核对：取第一样本第一基因（i_mean top1 基因）双重循环
    sample = sorted(a.obs["sample_id"].unique())[0]
    mask = (a.obs["sample_id"] == sample).to_numpy()
    sub = a[mask]
    gidx = int(np.nanargmax(a.var["morans_i_mean"].to_numpy()))
    x = np.asarray(sub.X.todense())[:, [gidx]]
    coords = np.asarray(sub.obsm["spatial"])
    i_ref, c_ref = naive_moments(x, coords, K_NN)
    i_prod = float(a.var["morans_i_min"].to_numpy()[gidx])  # 单样本值应落在 min..max 内
    check("%s_naive_single_sample_in_range" % species,
          i_prod - 1e-9 <= i_ref <= float(a.var["morans_i_max"].to_numpy()[gidx]) + 1e-9,
          "naive I=%.4f prod min=%.4f max=%.4f" % (i_ref, i_prod, float(a.var["morans_i_max"].to_numpy()[gidx])))
    # tsv 核对
    with open("%s/gene_autocorr_%s.tsv" % (BASE, species)) as fh:
        lines = fh.read().splitlines()
    header = lines[0].split("\t")
    check("%s_tsv_header" % species,
          header[:4] == ["var_index", "ensembl_id", "gene_symbol", "morans_i_mean"], str(header[:4]))
    check("%s_tsv_rows" % species, len(lines) - 1 == a.shape[1], "rows=%d genes=%d" % (len(lines) - 1, a.shape[1]))
    icol = header.index("morans_i_mean")
    vals = [float(l.split("\t")[icol]) for l in lines[1:]]
    check("%s_tsv_sorted_desc" % species, all(vals[i] >= vals[i + 1] for i in range(len(vals) - 1)))
    # 不变量
    src = ad.read_h5ad("/mnt/ssd/bio_data/line3_spatial/processed/spatial_marker_%s.h5ad" % species)
    check("%s_invariant_x_nnz" % species, a.X.nnz == src.X.nnz, "%d vs %d" % (a.X.nnz, src.X.nnz))
    check("%s_invariant_counts_nnz" % species, a.layers["counts"].nnz == src.layers["counts"].nnz)
    check("%s_invariant_pca" % species, np.array_equal(a.obsm["X_pca"], src.obsm["X_pca"]))
    check("%s_invariant_domain" % species, a.obs["domain"].equals(src.obs["domain"]))
    check("%s_invariant_obs_cols" % species, list(a.obs.columns) == list(src.obs.columns),
          "%d cols" % len(a.obs.columns))

with open("/tmp/s4_autocorr_readback.json", "w") as fh:
    json.dump([{"name": n, "ok": ok, "detail": d} for n, ok, d in results], fh, ensure_ascii=False)
n_fail = sum(1 for _, ok, _ in results if not ok)
print("TOTAL=%d FAIL=%d" % (len(results), n_fail))
