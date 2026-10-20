"""SCENIC 可行性探针（探针 3）：ctx(cisTarget) + aucell API 与耗时验证。

构造合成 adjacencies（不重跑 GRN），验证 motif 富集与 AUCell 在容器内可跑通。
"""
import inspect
import os
import time

import numpy as np
import pandas as pd
import anndata as ad

ad.settings.allow_write_nullable_strings = False

REF = "/mnt/ssd/bio_data/public_references/cistarget"
R10 = os.path.join(REF, "hg38_10kbp_up_10kbp_down_full_tx_v10_clust.genes_vs_motifs.rankings.feather")
R500 = os.path.join(REF, "hg38_500bp_up_100bp_down_full_tx_v10_clust.genes_vs_motifs.rankings.feather")
TBL = os.path.join(REF, "motifs-v10nr_clust-nr.hgnc-m0.001-o0.0.tbl")
NORM = "/mnt/ssd/bio_data/line2_scrna/processed/scrna_norm.h5ad"
SEED = 20261013

print("=== import probe ===")
for mod, name in [
    ("ctxcore.rnkdb", "FeatherRankingDatabase"),
    ("pyscenic.rnkdb", "FeatherRankingDatabase"),
    ("pyscenic.utils", "load_motifs"),
    ("pyscenic.ctx", "ctx"),
    ("pyscenic.aucell", "aucell"),
    ("pyscenic.transform", "df2regulons"),
]:
    try:
        m = __import__(mod, fromlist=[name])
        obj = getattr(m, name)
        try:
            sig = str(inspect.signature(obj))
        except Exception:
            sig = "(no signature)"
        print("OK  %s.%s%s" % (mod, name, sig[:200]))
    except Exception as e:
        print("ERR %s.%s -> %s" % (mod, name, str(e)[:120]))

print("\n=== data ===")
a = ad.read_h5ad(NORM)
N_GENES, N_CELLS = 1500, 300
X = a.X.tocsc()
nnz = np.diff(X.indptr)
sel = np.argsort(-nnz)[:N_GENES]
rng = np.random.default_rng(SEED)
cidx = np.sort(rng.choice(a.n_obs, size=N_CELLS, replace=False))
sub = a[cidx, sel]
Xd = np.asarray(sub.X.todense(), dtype=np.float32)
expr = pd.DataFrame(Xd, index=sub.obs_names, columns=sub.var_names)
print("expr %s" % (expr.shape,))

# 合成 adjacencies：每 TF 取表达方差 top 30 靶基因（只为验证 ctx 通路，非结果）
genes = expr.columns.tolist()
tfs = [g for g in genes if g.startswith(("STAT", "IRF", "NFKB", "JUN", "FOS", "RELA", "TCF", "SPI", "RUNX", "KLF"))][:40]
if len(tfs) < 5:
    tfs = genes[:20]
var = expr.var(axis=0).sort_values(ascending=False).index.tolist()
rows = []
for tf in tfs:
    for tgt in [g for g in var if g != tf][:30]:
        rows.append((tf, tgt, float(np.random.default_rng(SEED).uniform(1, 10))))
adj = pd.DataFrame(rows, columns=["TF", "target", "importance"])
print("synthetic adj %s tfs=%d" % (adj.shape, len(tfs)))

print("\n=== ctx (cisTarget) ===")
try:
    from ctxcore.rnkdb import FeatherRankingDatabase as RankingDatabase
    from pyscenic.utils import load_motifs
    from pyscenic.ctx import ctx
    from pyscenic.transform import df2regulons
    from pyscenic.aucell import aucell
except Exception as e:
    print("import for run failed:", e)
    raise SystemExit(1)

t0 = time.time()
dbs = [RankingDatabase(fname=p, name=os.path.basename(p).split(".")[0])
       for p in (R10, R500)]
print("loaded %d ranking dbs in %.1fs" % (len(dbs), time.time() - t0))

t0 = time.time()
motif_annotations = load_motifs(TBL)
print("motifs annotations: %d in %.1fs" % (len(motif_annotations), time.time() - t0))

t0 = time.time()
modules = ctx(adjacencies=adj, ranking_databases=dbs,
              motif_annotations_fname=TBL,
              expression_matrix=expr, num_workers=3,
              seed=SEED)
print("ctx -> %d modules in %.1fs" % (len(modules), time.time() - t0))

t0 = time.time()
regulons = df2regulons(modules)
print("regulons=%d in %.1fs" % (len(regulons), time.time() - t0))

t0 = time.time()
auc = aucell(expr, regulons, num_workers=3, seed=SEED)
print("aucell -> %s in %.1fs" % (str(auc.shape), time.time() - t0))
print("top regulons:", [r.name for r in regulons[:5]])
