#!/usr/bin/env python3
"""探针：定位 rank_genes_groups logfoldchanges 非有限值的来源。"""
import warnings

import anndata as ad
import numpy as np
import scanpy as sc

warnings.filterwarnings("ignore")
a = ad.read_h5ad("/mnt/ssd/bio_data/line2_scrna/processed/scrna_composition.h5ad")
ct = a.obs["celltype"].astype(str).to_numpy()
grp = a.obs["diagnosis"].astype(str).to_numpy()
m = (ct == "basal_keratinocyte") & np.isin(grp, ["Healthy", "Psoriasis"])
sub = a[m].copy()
print("cells=%d genes=%d" % sub.shape)
print("X type=%s min=%g max=%g zeros=%d"
      % (type(sub.X).__name__, sub.X.min(), sub.X.max(),
         int((np.asarray(sub.X) == 0).sum())))
ha = (grp[m] == "Healthy").sum()
pa = (grp[m] == "Psoriasis").sum()
print("Healthy=%d Psoriasis=%d" % (ha, pa))
sc.tl.rank_genes_groups(sub, groupby="diagnosis", groups=["Psoriasis"],
                        reference="Healthy", method="wilcoxon",
                        corr_method="benjamini-hochberg", n_genes=sub.n_vars,
                        key_added="deg", pts=True)
l2 = np.asarray(sub.uns["deg"]["logfoldchanges"]["Psoriasis"], dtype=float)
p = np.asarray(sub.uns["deg"]["pvals_adj"]["Psoriasis"], dtype=float)
bad = ~np.isfinite(l2)
print("nonfinite log2fc=%d / %d" % (bad.sum(), len(l2)))
if bad.any():
    names = sub.uns["deg"]["names"]["Psoriasis"]
    print("bad genes first 10: %s" % [str(x) for x in np.asarray(names)[bad][:10]])
    idx = np.where(bad)[0][:5]
    for gi in idx:
        g = str(sub.uns["deg"]["names"]["Psoriasis"][gi])
        col = np.asarray(a[:, g].X).ravel()[m] if g in a.var_names else None
        print("  gene=%s in_var=%s" % (g, g in a.var_names))
