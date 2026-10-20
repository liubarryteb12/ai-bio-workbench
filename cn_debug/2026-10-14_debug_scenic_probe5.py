"""SCENIC 可行性探针（探针 5）：全量规模测算 + AUCell API 验证。

1) 全基因空间下表达的 TF 数量（决定 GRN 推断的 TF 循环次数）
2) 用探针 4 的 regulons.csv 验证 aucell API 可跑通
"""
import os
import time

import numpy as np
import pandas as pd
import anndata as ad

ad.settings.allow_write_nullable_strings = False

REF = "/mnt/ssd/bio_data/public_references/cistarget"
TBL = os.path.join(REF, "motifs-v10nr_clust-nr.hgnc-m0.001-o0.0.tbl")
NORM = "/mnt/ssd/bio_data/line2_scrna/processed/scrna_norm.h5ad"
PROBE = "/mnt/ssd/bio_data/_probe_20261014"

# --- TF 名单 ---
tf_all = set()
with open(TBL, encoding="utf-8") as fh:
    header = fh.readline().rstrip("\n").split("\t")
    gi = header.index("gene_name")
    for line in fh:
        parts = line.rstrip("\n").split("\t")
        if len(parts) > gi and parts[gi].strip() not in ("", "None"):
            tf_all.add(parts[gi].strip())
print("annotated TFs in tbl: %d" % len(tf_all))

a = ad.read_h5ad(NORM)
X = a.X.tocsc()
nnz = np.diff(X.indptr)
genes = np.array(a.var_names)
for thr in [3, 10, 20]:
    mask = nnz >= thr
    tfs_in = [g for g in genes[mask] if g in tf_all]
    print("genes in >=%2d cells: %5d ; TFs among them: %d" % (thr, int(mask.sum()), len(tfs_in)))

# --- AUCell API 验证（用探针 4 的 regulons.csv） ---
reg_csv = os.path.join(PROBE, "regulons.csv")
if os.path.exists(reg_csv):
    from pyscenic.utils import load_motifs
    from pyscenic.transform import df2regulons
    from pyscenic.aucell import aucell
    if not hasattr(np, "object"):
        np.object = object
    t0 = time.time()
    df = pd.read_csv(reg_csv)
    print("regulons.csv shape=%s cols=%s" % (df.shape, list(df.columns)[:5]))
    regulons = df2regulons(df)
    print("regulons=%d (%.1fs)" % (len(regulons), time.time() - t0))
    expr = pd.read_csv(os.path.join(PROBE, "expr.csv"), index_col=0)
    t0 = time.time()
    auc = aucell(expr, regulons, num_workers=3, seed=20261013)
    print("aucell -> %s in %.1fs" % (str(auc.shape), time.time() - t0))
    print("regulon names:", [r.name for r in regulons[:8]])
else:
    print("no regulons.csv, skip aucell")
