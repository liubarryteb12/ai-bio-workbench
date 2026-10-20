#!/usr/bin/env python3
"""探针2：mouse symbol 命名体系 + X 矩阵语义核对。"""
import numpy as np
import anndata as ad

ad.settings.allow_write_nullable_strings = False
BASE = "/mnt/ssd/bio_data/line3_spatial/processed"

for tag in ["mouse", "human"]:
    a = ad.read_h5ad(BASE + "/spatial_composition_%s.h5ad" % tag)
    sym = a.var["gene_symbol"].astype(str)
    print("==", tag, "==")
    print("var_names[:5]:", a.var_names[:5].tolist())
    print("symbol[:10]:", sym[:10].tolist())
    print("symbol 全大写比例:", float((sym == sym.str.upper()).mean()))
    # 常见 LR 基因 symbol 命中情况
    probes = ["TGFB1", "Tgfb1", "CSF1", "Csf1", "IL10", "Il10", "LGALS9",
              "Lgals9", "SPP1", "Spp1", "C1QA", "C1qa", "CD74", "Cd74",
              "MARCO", "Marco", "HLA-DQB2", "H2-Aa", "TNF", "Tnf"]
    hits = [p for p in probes if p in set(sym.tolist())]
    print("命中探针基因:", hits)
    # X 语义
    x = a.X[:200].toarray() if hasattr(a.X, "toarray") else np.asarray(a.X[:200])
    print("X min/max/mean:", float(x.min()), float(x.max()), float(x.mean()))
    print("X >0 格点比例:", float((x > 0).mean()))
    print("log1p 注释:", a.uns.get("log1p"))
    break  # 先看 mouse
