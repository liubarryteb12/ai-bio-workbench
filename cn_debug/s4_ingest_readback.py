# s4_ingest_readback.py：S4 步骤 1 回读验证：两个 h5ad + samples_meta 全内容核对
import sys

import anndata as ad
import numpy as np
import pandas as pd

PROCESSED = "/mnt/ssd/bio_data/line3_spatial/processed"
EXPECT_MOUSE = {"JBO001": 1646, "JBO002": 1651, "JBO003": 1604, "JBO004": 2286,
                "CAP002": 438, "JBO006": 1279, "JBO009": 2348, "JBO010": 2076,
                "JBO012": 2254, "BH001": 1708}
EXPECT_HUMAN = {"JBO014": 1248, "JBO015": 532, "JBO018": 2501, "JBO019": 1185, "JBO022": 1423}


def check(name, cond, detail=""):
    status = "OK" if cond else "FAIL"
    print("%s %s %s" % (status, name, detail))
    if not cond:
        sys.exit(1)


for tag, expect in (("mouse", EXPECT_MOUSE), ("human", EXPECT_HUMAN)):
    path = "%s/spatial_counts_%s.h5ad" % (PROCESSED, tag)
    a = ad.read_h5ad(path)
    print("=== %s ===" % tag)
    check("shape", a.n_vars in (31053, 32738), "spots=%d genes=%d" % (a.n_obs, a.n_vars))
    check("X_csr", a.X.getformat() == "csr", "format=%s dtype=%s" % (a.X.getformat(), a.X.dtype))
    counts = a.obs["sample_id"].value_counts().to_dict()
    check("per_sample_spots", counts == expect, "%s" % counts)
    check("obs_names_unique", a.obs_names.is_unique)
    check("obs_names_prefixed", all("_" in n for n in a.obs_names[:5]), a.obs_names[0])
    for col in ["barcode", "sample_id", "gsm", "species", "platform_id", "strain",
                "condition", "condition_class", "group", "tissue", "in_tissue",
                "array_row", "array_col", "pxl_row_fullres", "pxl_col_fullres",
                "ncount", "nfeature"]:
        check("obs_col_%s" % col, col in a.obs.columns)
    for col in ["gene_symbol", "genome", "feature_type"]:
        check("var_col_%s" % col, col in a.var.columns)
    check("var_names_unique", a.var_names.is_unique)
    check("obsm_spatial", "spatial" in a.obsm and a.obsm["spatial"].shape == (a.n_obs, 2),
          str(a.obsm["spatial"].shape))
    check("uns_seed", a.uns.get("seed") == "20261013", str(a.uns.get("seed")))
    check("uns_species", a.uns.get("species") in ("Mus musculus", "Homo sapiens"))
    check("uns_samples", sorted(a.uns.get("samples", [])) == sorted(expect))
    check("uns_spatial_keys", sorted(a.uns.get("spatial", {}).keys()) == sorted(expect))
    # 每个样本的 lowres 图与 scalefactors 在位
    for sf in expect:
        entry = a.uns["spatial"][sf]
        img = entry["images"]["lowres"]
        scf = entry["scalefactors"]
        ok = img.ndim == 3 and img.shape[2] == 3 and len(scf) == 4
        if not ok:
            check("spatial_entry_%s" % sf, False, str(img.shape))
    print("spatial entries all OK (lowres RGB + 4 scalefactors)")
    # ncount/nfeature 与矩阵一致（抽 3 个样本核对）
    import numpy as np
    for sf in list(expect)[:3]:
        sub = a[a.obs["sample_id"] == sf]
        recomputed = np.asarray(sub.X.sum(axis=1)).ravel()
        check("ncount_%s" % sf, bool((recomputed == sub.obs["ncount"].to_numpy()).all()))
    # X 非负整数
    check("X_nonneg", int(a.X.data.min()) >= 0, "min=%d" % int(a.X.data.min()))
    # 坐标范围
    print("array_row range: %d-%d  array_col range: %d-%d"
          % (a.obs["array_row"].min(), a.obs["array_row"].max(),
             a.obs["array_col"].min(), a.obs["array_col"].max()))
    print("group counts: %s" % a.obs["group"].value_counts().to_dict())
    print("condition counts: %s" % a.obs["condition"].value_counts().to_dict())

meta = pd.read_csv("%s/samples_meta.tsv" % PROCESSED, sep="\t")
check("meta_rows", meta.shape[0] == 15, str(meta.shape))
check("meta_has_adt", bool(meta.loc[meta["sample_id"] == "BH001", "has_adt"].iloc[0]))
check("meta_adt_overlap", int(meta.loc[meta["sample_id"] == "BH001", "adt_spot_overlap"].iloc[0]) == 1698)
check("meta_spots_match", bool(meta["spots_match"].all()))
print("=== samples_meta ===")
print(meta[["sample_id", "species", "condition", "group", "n_spots_matrix",
            "n_spots_soft", "has_adt", "spot_diameter_fullres"]].to_string(index=False))
print("ALL_READBACK_OK")
