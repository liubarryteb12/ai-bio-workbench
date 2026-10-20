"""SCENIC 可行性探针（探针 4）：生成合成输入，供 CLI ctx 验证。

产出到 /mnt/ssd/bio_data/_probe_20261014/：
  adj.tsv（TF target importance，无表头）
  expr.csv（cells x genes）
"""
import numpy as np
import pandas as pd
import anndata as ad

ad.settings.allow_write_nullable_strings = False

OUT = "/mnt/ssd/bio_data/_probe_20261014"
NORM = "/mnt/ssd/bio_data/line2_scrna/processed/scrna_norm.h5ad"
SEED = 20261013
N_GENES, N_CELLS = 1500, 300

a = ad.read_h5ad(NORM)
X = a.X.tocsc()
nnz = np.diff(X.indptr)
sel = np.argsort(-nnz)[:N_GENES]
rng = np.random.default_rng(SEED)
cidx = np.sort(rng.choice(a.n_obs, size=N_CELLS, replace=False))
sub = a[cidx, sel]
Xd = np.asarray(sub.X.todense(), dtype=np.float32)
expr = pd.DataFrame(Xd, index=sub.obs_names, columns=sub.var_names)
expr.to_csv("%s/expr.csv" % OUT)
print("expr.csv %s" % (expr.shape,))

genes = expr.columns.tolist()
var = expr.var(axis=0).sort_values(ascending=False).index.tolist()
tfs = [g for g in genes if g.startswith(("STAT", "IRF", "NFKB", "JUN", "FOS",
                                         "RELA", "TCF", "SPI", "RUNX", "KLF"))][:40]
if len(tfs) < 5:
    tfs = genes[:20]
rows = []
for tf in tfs:
    for tgt in [g for g in var if g != tf][:30]:
        rows.append((tf, tgt, float(np.random.default_rng(SEED).uniform(1, 10))))
adj = pd.DataFrame(rows, columns=["TF", "target", "importance"])
adj.to_csv("%s/adj.tsv" % OUT, sep="\t", header=True, index=False)
print("adj.tsv %s tfs=%d" % (adj.shape, len(tfs)))
