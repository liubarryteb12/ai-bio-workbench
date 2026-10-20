#!/usr/bin/env python3
"""line2 步骤 14 探针：细胞比例/组成分析可行性定性（只读）。

回答：
  1. scrna_annotated.h5ad 的 obs 字段（celltype/condition/donor/leiden）；
  2. 逐 donor x condition 的细胞数矩阵与组设计（谁是组内、谁是单样本）；
  3. celltype 总数与每类最小规模（比例检验的功效下限）；
  4. KRUSKAL-WALLIS + 置换的可行性（组数、样本数组合数）。
"""
import itertools

import anndata as ad
import numpy as np
import pandas as pd

ad.settings.allow_write_nullable_strings = False
PATH = "/mnt/ssd/bio_data/line2_scrna/processed/scrna_annotated.h5ad"
a = ad.read_h5ad(PATH)
print("shape=%s" % (a.shape,))
print("obs cols=%s" % list(a.obs.columns))
print("uns keys=%s" % sorted(a.uns.keys()))

ct = a.obs["celltype"].astype(str)
print("\ncelltype n=%d" % ct.nunique())
print(ct.value_counts().to_string())

cond = a.obs["condition"].astype(str) if "condition" in a.obs else None
cc = a.obs["condition_class"].astype(str) if "condition_class" in a.obs else None
donor = a.obs["donor"].astype(str) if "donor" in a.obs else None
print("\ncondition n=%d, condition_class n=%d, donor n=%d"
      % (cond.nunique() if cond is not None else -1,
         cc.nunique() if cc is not None else -1,
         donor.nunique() if donor is not None else -1))

print("\n=== condition_class x celltype 计数 ===")
if cc is not None:
    print(pd.crosstab(ct, cc).to_string())

print("\n=== donor x condition 计数 ===")
if donor is not None and cond is not None:
    print(pd.crosstab(donor, cond).to_string())

# 组设计可行性：condition_class 两组的 donor 数
if cc is not None and donor is not None:
    df = pd.DataFrame({"cc": cc, "donor": donor}).drop_duplicates()
    print("\n=== cc -> donors ===")
    print(df.groupby("cc")["donor"].apply(lambda s: sorted(s.tolist())).to_string())
    g = df.groupby("cc").size().to_dict()
    vals = list(g.values())
    if len(vals) == 2:
        n1, n2 = vals
        print("\n组合数 C(%d,%d)=%d" % (n1 + n2, min(n1, n2),
                                     len(list(itertools.combinations(range(n1 + n2), min(n1, n2))))))
    else:
        print("\n组数=%d，非 2 组，需回退置换" % len(vals))
