#!/usr/bin/env python3
"""diffcheck：targets 字典序 vs tsv 顺序差异定位。"""
import numpy as np
import pandas as pd
import anndata as ad

ad.settings.allow_write_nullable_strings = False
BASE = "/mnt/ssd/bio_data/line3_spatial/processed"

for species in ["mouse", "human"]:
    a12 = ad.read_h5ad(BASE + "/spatial_localization_%s.h5ad" % species)
    tsv = pd.read_csv(BASE + "/gene_localization_%s.tsv" % species, sep="\t")
    uns_targets = a12.uns["localization"]["targets"]
    print("== %s ==" % species)
    print("uns keys:", list(uns_targets.keys()))
    top_genes_tsv = tsv.head(10)["ensembl_id"].tolist()
    top_genes_uns = [v["ensembl_id"] for k, v in sorted(uns_targets.items())]
    print("tsv 前10:", top_genes_tsv)
    print("uns 前10(键字典序):", top_genes_uns)
    # 按数值后缀排
    import re
    def keyf(k):
        return int(re.search(r"\d+", k).group())
    top_uns_num = [v["ensembl_id"] for k, v in sorted(uns_targets.items(), key=lambda kv: keyf(kv[0]))]
    print("uns 前10(数值序):", top_uns_num)
    print("一致(数值序):", top_uns_num == top_genes_tsv)
    t1 = uns_targets["target1"]
    r0 = tsv.iloc[0]
    print("target1:", t1["ensembl_id"], t1["best_enrich"], t1["n_expr"])
    print("tsv首行:", r0["ensembl_id"], r0["best_enrich"], r0["n_expr"])
