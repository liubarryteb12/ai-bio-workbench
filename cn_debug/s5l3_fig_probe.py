#!/usr/bin/env python3
"""line3 出图探针：确认 spatial_knockout h5ad 可画字段。"""
import warnings

import anndata as ad

warnings.filterwarnings("ignore")
for sp in ["mouse", "human"]:
    p = "/mnt/ssd/bio_data/line3_spatial/processed/spatial_knockout_%s.h5ad" % sp
    a = ad.read_h5ad(p)
    print("=== %s shape=%s ===" % (sp, a.shape))
    print("obsm=%s" % list(a.obsm.keys()))
    print("obs cols=%s" % list(a.obs.columns))
    print("var cols=%s" % list(a.var.columns))
    print("uns=%s" % sorted(a.uns.keys()))
    ko = a.uns.get("knockout", {})
    print("knockout keys=%s" % list(ko.keys()))
    print("  top_dr sample=%s" % str(ko.get("top_dr", {}).get("dr1")))
    loc = a.uns.get("localization", {})
    print("localization keys=%s" % list(loc.keys()))
    print("  targets keys=%s" % list(loc.get("targets", {}).keys())[:5])
    t1 = loc.get("targets", {}).get("target1")
    print("  target1=%s" % str(t1)[:200])
    print("  n samples=%d domains=%d"
          % (a.obs["sample_id"].nunique(), a.obs["domain"].nunique()))
