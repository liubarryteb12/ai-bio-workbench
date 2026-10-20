# s4_domains_readback：线3 步骤 5 空间域识别回读验证（一次性，服务器 /tmp 跑）
# 覆盖：shape / obs 20 列 + domain 列 / domain 每 spot 非空且命名空间隔离 /
# 域数与 uns['domains'] 对账 / 逐样本连贯性与 uns 对账 / X_pca 与步骤 4 一致 /
# X_umap 不变 / counts 层 nnz 与 totals 对账 / hvg 仍 2000 / spatial 双不丢 /
# per-sample spots 不变 / report 内容。
import sys
from collections import Counter

import numpy as np
import anndata as ad
from scipy import sparse

ad.settings.allow_write_nullable_strings = False

EXPECT = {
    "mouse": {"spots": 17283, "genes": 18628, "hvg": 2000, "domains": 57,
              "samples": {"JBO001": 1646, "JBO002": 1651, "JBO003": 1604, "JBO004": 2284,
                          "CAP002": 438, "JBO006": 1279, "JBO009": 2348, "JBO010": 2074,
                          "JBO012": 2253, "BH001": 1706}},
    "human": {"spots": 6877, "genes": 19613, "hvg": 2000, "domains": 18,
              "samples": {"JBO014": 1244, "JBO015": 530, "JBO018": 2500,
                          "JBO019": 1184, "JBO022": 1419}},
}
SEED = 20261013
REQUIRED_OBS = ["barcode", "sample_id", "gsm", "species", "platform_id", "strain",
                "condition", "condition_class", "group", "tissue", "in_tissue",
                "array_row", "array_col", "pxl_row_fullres", "pxl_col_fullres",
                "ncount", "nfeature", "total_counts", "n_genes_by_counts", "pct_mito"]

n_checks = [0]


def check(name, cond, detail=""):
    status = "OK" if cond else "FAIL"
    n_checks[0] += 1
    print("%s %s %s" % (status, name, detail))
    if not cond:
        sys.exit(1)


dimred = {}
for species in ["mouse", "human"]:
    dimred[species] = ad.read_h5ad(
        "/mnt/ssd/bio_data/line3_spatial/processed/spatial_dimred_%s.h5ad" % species)

for species in ["mouse", "human"]:
    exp = EXPECT[species]
    a = ad.read_h5ad("/mnt/ssd/bio_data/line3_spatial/processed/spatial_domains_%s.h5ad" % species)
    d = dimred[species]
    check("%s shape" % species, a.shape == (exp["spots"], exp["genes"]), str(a.shape))

    # domain 列：非空、命名空间隔离（前缀均为本行 spot 的 sample_id）、无跨样本混编
    domains = a.obs["domain"].astype(str)
    check("%s domain 非空" % species, bool((domains.str.len() > 0).all()))
    prefixes = domains.str.rsplit("_d", n=1).str[0]
    check("%s domain 命名空间隔离" % species, bool((prefixes == a.obs["sample_id"].astype(str)).all()))
    n_domains = domains.nunique()
    check("%s domains 数" % species, n_domains == exp["domains"], str(n_domains))
    check("%s 每样本域数>1" % species,
          all(v > 1 for v in a.obs.groupby("sample_id")["domain"].nunique()))

    # uns['domains'] 与 obs 对账
    du = a.uns.get("domains", {})
    check("%s uns domains total 对账" % species, du.get("domains_total") == n_domains)
    check("%s uns domains seed/resolution" % species,
          du.get("seed") == SEED and du.get("resolution") == 0.5
          and du.get("n_neighbors") == 15 and du.get("n_pcs") == 30)
    coh = du.get("per_sample_spatial_coherence", {})
    check("%s uns coherence 每样本" % species,
          len(coh) == len(exp["samples"]) and all(0 <= v <= 1 for v in coh.values()),
          "mean=%.4f" % np.mean(list(coh.values())))

    # 嵌入与 counts 层不被改动
    check("%s X_pca 与步骤4一致" % species, np.array_equal(a.obsm["X_pca"], d.obsm["X_pca"]))
    check("%s X_umap 与步骤4一致" % species, np.array_equal(a.obsm["X_umap"], d.obsm["X_umap"]))
    check("%s counts nnz 不变" % species, a.layers["counts"].nnz == d.layers["counts"].nnz)
    layer_totals = np.asarray(a.layers["counts"].sum(axis=1)).ravel()
    check("%s counts totals 对账" % species,
          bool((layer_totals == a.obs["total_counts"].to_numpy()).all()))
    check("%s hvg 仍 2000" % species, int(a.var["highly_variable"].sum()) == exp["hvg"])

    # obs 20 列 + per-sample spots + spatial 双不丢
    check("%s obs cols" % species, all(c in a.obs.columns for c in REQUIRED_OBS))
    per_sample = a.obs["sample_id"].value_counts().to_dict()
    check("%s per-sample spots" % species, per_sample == exp["samples"], str(per_sample))
    check("%s obsm spatial" % species, "spatial" in a.obsm and a.obsm["spatial"].shape[1] == 2)
    check("%s uns spatial" % species, "spatial" in a.uns and len(a.uns["spatial"]) == len(exp["samples"]))

report = open("/mnt/ssd/bio_data/line3_spatial/processed/domains_report.txt", encoding="utf-8").read()
for token in ["step=spatial_domains", "seed=%d" % SEED, "resolution=0.5",
              "[mouse]", "[human]", "coherence_definition", "tool_route"]:
    check("report 含 %s" % token, token in report)
check("report mouse 连贯性 0.5163", "0.5163" in report)
check("report human 连贯性 0.6951", "0.6951" in report)

print("ALL_READBACK_OK checks=%d" % n_checks[0])
