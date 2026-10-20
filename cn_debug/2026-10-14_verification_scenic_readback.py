"""SCENIC 回读验证（坑 #119 纪律）：独立重算关键数字，与产物交叉核对。

只读，不改数据面。
"""
import os

import numpy as np

if not hasattr(np, "object"):
    np.object = object

import pandas as pd
from pyscenic.utils import load_motifs
from pyscenic.transform import df2regulons

P = "/mnt/ssd/bio_data/line2_scrna/processed"

reg = load_motifs(os.path.join(P, "scenic_regulons.csv"))
regulons = df2regulons(reg)
auc = pd.read_csv(os.path.join(P, "scenic_auc_mtx.tsv"), sep="\t", index_col=0)
byct = pd.read_csv(os.path.join(P, "scenic_regulon_by_celltype.tsv"), sep="\t", index_col=0)
summary = pd.read_csv(os.path.join(P, "scenic_tf_summary.tsv"), sep="\t")
adj = pd.read_csv(os.path.join(P, "scenic_adjacencies.tsv"), sep="\t")

checks = []
checks.append(("regulon count == auc columns", len(regulons) == auc.shape[1],
               "%d vs %d" % (len(regulons), auc.shape[1])))
checks.append(("auc cells == 4587", auc.shape[0] == 4587, str(auc.shape[0])))
checks.append(("by_celltype shape == (13, n_reg)",
               byct.shape == (13, auc.shape[1]), str(byct.shape)))
checks.append(("summary rows == n_reg", len(summary) == auc.shape[1],
               "%d vs %d" % (len(summary), auc.shape[1])))
checks.append(("summary regulons == auc columns",
               set(summary["regulon"]) == set(auc.columns), ""))
nt = {r.name: len(r) for r in regulons}
ok = all(int(summary.loc[summary["regulon"] == k, "n_targets"].iloc[0]) == v
         for k, v in nt.items())
checks.append(("n_targets match regulons", ok, ""))
checks.append(("adj edges == 450907", len(adj) == 450907, str(len(adj))))
checks.append(("adj TFs == 309", adj["TF"].nunique() == 309, str(adj["TF"].nunique())))
checks.append(("by_celltype values in [0,1]",
               bool(((byct.values >= 0) & (byct.values <= 1)).all()), ""))
checks.append(("regulon names end with (+)", bool(regulons) and
               all(r.name.endswith("(+)") for r in regulons), ""))

# 独立重算：by_celltype 按细胞数加权后 == auc 全体均值（同一口径的两种视图）
# 注意 by_celltype 本身是各 celltype 的未加权均值，celltype 大小不均（20..939），
# 必须按细胞数加权才能与 auc.mean(axis=0) 对上。
import anndata as ad
ad.settings.allow_write_nullable_strings = False
anno = ad.read_h5ad(os.path.join(P, "scrna_annotated.h5ad"))
ct = anno.obs["celltype"].astype(str).reindex(auc.index)
counts = ct.value_counts()
w = counts.reindex(byct.index).values.astype(float)
weighted = (byct.values * w[:, None]).sum(axis=0) / w.sum()
col_mean_gap = float(np.abs(weighted - auc.mean(axis=0).values).max())
checks.append(("by_celltype cell-weighted mean ~ auc mean (<=1e-6)",
               col_mean_gap <= 1e-6, "max gap=%.2e" % col_mean_gap))

allok = True
for name, ok, detail in checks:
    print("%s  %s  %s" % ("PASS" if ok else "FAIL", name, detail))
    allok = allok and ok
print("ALL_PASS" if allok else "SOME_FAIL")
print("regulons=%d cells=%d celltypes=%d adj_edges=%d"
      % (len(regulons), auc.shape[0], byct.shape[0], len(adj)))
