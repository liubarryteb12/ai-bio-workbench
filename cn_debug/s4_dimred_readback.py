# s4_dimred_readback：线3 步骤 4 降维回读验证（一次性，服务器 /tmp 跑）
# 覆盖：shape / X（归一化 log 值未被 scale 改动）/ csr float finite nonneg /
# counts 层 int 与 nnz 与 obs['total_counts'] 对账 / var hvg 仍 2000 /
# X_pca (n,50) 全有限 + uns['pca'] variance_ratio 长度 50 且 >0 /
# X_umap (n,2) 全有限 / obsp connectivities+distances (n,n) 且每 spot 有邻居 /
# obsm spatial / uns spatial 12 键不丢 / obs 20 列 / uns dimred 口径与 seed /
# per-sample spots 与步骤 3 一致 / report 内容。
import sys

import numpy as np
import anndata as ad
from scipy import sparse

ad.settings.allow_write_nullable_strings = False

EXPECT = {
    "mouse": {"spots": 17283, "genes": 18628, "hvg": 2000,
              "samples": {"JBO001": 1646, "JBO002": 1651, "JBO003": 1604, "JBO004": 2284,
                          "CAP002": 438, "JBO006": 1279, "JBO009": 2348, "JBO010": 2074,
                          "JBO012": 2253, "BH001": 1706}},
    "human": {"spots": 6877, "genes": 19613, "hvg": 2000,
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


for species in ["mouse", "human"]:
    exp = EXPECT[species]
    a = ad.read_h5ad("/mnt/ssd/bio_data/line3_spatial/processed/spatial_dimred_%s.h5ad" % species)
    check("%s shape" % species, a.shape == (exp["spots"], exp["genes"]), str(a.shape))

    # X：归一化 log 值（scale 只在 HVG 子集副本上做，全基因 X 应保持稀疏 csr）
    check("%s X csr" % species, sparse.issparse(a.X) and a.X.format == "csr")
    check("%s X float" % species, a.X.dtype == np.float32 or a.X.dtype == np.float64, str(a.X.dtype))
    check("%s X finite" % species, bool(np.isfinite(a.X.data).all()))
    check("%s X nonneg" % species, bool(a.X.data.min() >= 0))

    # layers['counts']：原始整数计数，nnz 与 totals 对账
    check("%s counts int" % species, np.issubdtype(a.layers["counts"].dtype, np.integer))
    check("%s counts nnz" % species, a.layers["counts"].nnz == a.X.nnz,
          "counts=%d X=%d" % (a.layers["counts"].nnz, a.X.nnz))
    layer_totals = np.asarray(a.layers["counts"].sum(axis=1)).ravel()
    check("%s counts totals 对账" % species,
          bool((layer_totals == a.obs["total_counts"].to_numpy()).all()))

    # var：hvg 仍精确 2000，三列在
    check("%s hvg count" % species, int(a.var["highly_variable"].sum()) == exp["hvg"],
          str(int(a.var["highly_variable"].sum())))
    check("%s var cols" % species,
          all(c in a.var.columns for c in ["gene_symbol", "genome", "feature_type"]))

    # X_pca
    check("%s X_pca shape" % species, a.obsm["X_pca"].shape == (exp["spots"], 50),
          str(a.obsm["X_pca"].shape))
    check("%s X_pca finite" % species, bool(np.isfinite(a.obsm["X_pca"]).all()))
    vr = a.uns["pca"]["variance_ratio"]
    check("%s pca variance_ratio" % species,
          len(vr) == 50 and bool((np.asarray(vr) > 0).all()) and bool(np.isfinite(vr).all()),
          "PC1=%.4f%%" % (vr[0] * 100))

    # X_umap
    check("%s X_umap shape" % species, a.obsm["X_umap"].shape == (exp["spots"], 2))
    check("%s X_umap finite" % species, bool(np.isfinite(a.obsm["X_umap"]).all()))

    # obsp 邻居图：形状 (n,n) 且每 spot 有邻居（connectivities 行和 > 0）
    for key in ["connectivities", "distances"]:
        m = a.obsp[key]
        check("%s obsp %s shape" % (species, key), m.shape == (exp["spots"], exp["spots"]))
    row_sums = np.asarray(a.obsp["connectivities"].sum(axis=1)).ravel()
    check("%s connectivities 每 spot 有邻居" % species, bool((row_sums > 0).all()),
          "min=%.4f" % row_sums.min())

    # obsm spatial / uns spatial 不丢
    check("%s obsm spatial" % species, "spatial" in a.obsm and a.obsm["spatial"].shape[1] == 2)
    check("%s uns spatial" % species, "spatial" in a.uns and len(a.uns["spatial"]) == len(exp["samples"]),
          "entries=%d" % len(a.uns["spatial"]))

    # obs 20 列 + per-sample spots
    check("%s obs cols" % species, all(c in a.obs.columns for c in REQUIRED_OBS))
    per_sample = a.obs["sample_id"].value_counts().to_dict()
    check("%s per-sample spots" % species, per_sample == exp["samples"], str(per_sample))

    # uns dimred 口径
    dr = a.uns.get("dimred", {})
    check("%s uns dimred" % species,
          dr.get("n_comps") == 50 and dr.get("seed") == SEED
          and dr.get("batch_correction") is None and dr.get("n_top_genes_hvg", 2000) in (None, 2000),
          str(dr))

report = open("/mnt/ssd/bio_data/line3_spatial/processed/dimred_report.txt", encoding="utf-8").read()
for token in ["step=dim_reduce", "seed=%d" % SEED, "batch_correction=none",
              "[mouse]", "[human]", "PC1", "silhouette_sample_id_pca10", "silhouette_group_pca10"]:
    check("report 含 %s" % token, token in report)

print("ALL_READBACK_OK checks=%d" % n_checks[0])
