#!/usr/bin/env python3
"""line2 出图探针：确认 scrna_deg.h5ad 里可画的字段与结构。"""
import warnings

import anndata as ad
import numpy as np

warnings.filterwarnings("ignore")
a = ad.read_h5ad("/mnt/ssd/bio_data/line2_scrna/processed/scrna_deg.h5ad")
print("shape=%s" % (a.shape,))
print("obsm=%s" % list(a.obsm.keys()))
print("obs cols=%s" % list(a.obs.columns))
print("uns keys=%s" % sorted(a.uns.keys()))
print("has dpt=%s" % ("dpt_pseudotime" in a.obs.columns))
cm = a.uns.get("cluster_markers")
print("cluster_markers type=%s" % type(cm).__name__)
if isinstance(cm, dict):
    print("  keys=%s" % list(cm.keys())[:6])
    for k in list(cm.keys())[:1]:
        v = cm[k]
        print("  [%s] type=%s len=%s sample=%s"
              % (k, type(v).__name__, len(v) if hasattr(v, "__len__") else "-",
                 str(v)[:200]))
elif cm is not None:
    print("  repr=%s" % str(cm)[:300])
print("deg keys=%s" % list(a.uns["deg"].keys()))
print("composition keys=%s" % list(a.uns["composition"].keys()))
