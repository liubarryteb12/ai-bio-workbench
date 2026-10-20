#!/usr/bin/env python3
"""line2 步骤 14 探针 2：分组字段定性（group/class/diagnosis 分布 + donor 配对性）。"""
import itertools

import anndata as ad
import pandas as pd

ad.settings.allow_write_nullable_strings = False
PATH = "/mnt/ssd/bio_data/line2_scrna/processed/scrna_annotated.h5ad"
a = ad.read_h5ad(PATH)
for col in ["group", "class", "diagnosis", "region", "celltype_paper"]:
    s = a.obs[col].astype(str)
    print("=== %s === n=%d" % (col, s.nunique()))
    print(s.value_counts().to_string())
    print()

print("=== donor x group ===")
print(pd.crosstab(a.obs["donor"].astype(str), a.obs["group"].astype(str)).to_string())
print("\n=== donor x diagnosis ===")
print(pd.crosstab(a.obs["donor"].astype(str), a.obs["diagnosis"].astype(str)).to_string())
print("\n=== celltype x group ===")
print(pd.crosstab(a.obs["celltype"].astype(str), a.obs["group"].astype(str)).to_string())
print("\n=== celltype x diagnosis ===")
print(pd.crosstab(a.obs["celltype"].astype(str), a.obs["diagnosis"].astype(str)).to_string())
