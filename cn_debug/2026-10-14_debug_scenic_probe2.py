"""SCENIC 可行性探针（探针 2/2）：GRNBoost2 手机端测速 + TF 名单 + API 确认。

只读。用固定子集（细胞/基因数可调）计时，外推全量规模可行性。
"""
import os
import time

import numpy as np
import pandas as pd
import anndata as ad

ad.settings.allow_write_nullable_strings = False

NORM = "/mnt/ssd/bio_data/line2_scrna/processed/scrna_norm.h5ad"
ANNO = "/mnt/ssd/bio_data/line2_scrna/processed/scrna_annotated.h5ad"
TBL = "/mnt/ssd/bio_data/public_references/cistarget/motifs-v10nr_clust-nr.hgnc-m0.001-o0.0.tbl"
SEED = 20261013

# --- TF 名单：从 motifs tbl 的 directly_annotated_genes 提取 ---
t0 = time.time()
tf_names = set()
with open(TBL, encoding="utf-8") as fh:
    header = fh.readline().rstrip("\n").split("\t")
    gi = header.index("gene_name")
    for line in fh:
        parts = line.rstrip("\n").split("\t")
        if len(parts) <= gi:
            continue
        g = parts[gi].strip()
        if g and g != "None":
            tf_names.add(g)
tf_names = sorted(tf_names)
print("motifs tbl header:", header[:6], "...")
print("TF names from tbl: %d (%.1fs)" % (len(tf_names), time.time() - t0))
print("sample TFs:", tf_names[:10])

# --- 数据 ---
t0 = time.time()
a = ad.read_h5ad(NORM)
anno = ad.read_h5ad(ANNO)
print("norm shape=%s anno shape=%s" % (a.shape, anno.shape))
print("celltype in anno:", "celltype" in anno.obs.columns)
# 细胞索引一致性
same = (a.obs_names == anno.obs_names).all()
print("obs_names aligned with anno: %s" % same)
ct = anno.obs["celltype"].astype(str)
print("celltype counts:")
print(ct.value_counts().to_string())
print("load %.1fs" % (time.time() - t0))

# --- 基因空间：按表达广度 top N ---
X = a.X.tocsc()
nnz = np.diff(X.indptr)
gene_order = np.argsort(-nnz)
N_GENES = 2000
N_CELLS = 400
sel_genes = gene_order[:N_GENES]
rng = np.random.default_rng(SEED)
cell_idx = np.sort(rng.choice(a.n_obs, size=N_CELLS, replace=False))

sub = a[cell_idx, sel_genes]
Xd = np.asarray(sub.X.todense(), dtype=np.float32)
expr = pd.DataFrame(Xd, index=sub.obs_names, columns=sub.var_names)
print("subset expr %s, nonzero frac=%.3f" % (expr.shape, (Xd > 0).mean()))

tf_in = [g for g in expr.columns if g in set(tf_names)]
print("TFs present in subset: %d" % len(tf_in))

# --- GRNBoost2 计时（proot 下 Nanny 无法 fork worker，改线程模式） ---
import dask
from distributed import Client, LocalCluster
from arboreto.algo import grnboost2

print("dask=%s distributed=%s" % (dask.__version__, __import__("distributed").__version__))
cluster = LocalCluster(n_workers=1, threads_per_worker=3, processes=False,
                       dashboard_address=None)
client = Client(cluster)
print("dask client threads=%s processes=%s"
      % (client.nthreads(), cluster.processes))

t0 = time.time()
adj = grnboost2(expression_data=expr, tf_names=tf_in, seed=SEED,
                client_or_address=client, verbose=False)
dt = time.time() - t0
client.close()
cluster.close()
print("grnboost2 %d cells x %d genes -> %d edges in %.1fs"
      % (N_CELLS, N_GENES, len(adj), dt))
scale_cells = a.n_obs / N_CELLS
scale_genes = 20000 / N_GENES
print("naive extrapolation to %d cells x 20000 genes: %.1f min"
      % (a.n_obs, dt * scale_cells * scale_genes / 60))
print("naive extrapolation to %d cells x 5000 genes: %.1f min"
      % (a.n_obs, dt * scale_cells * (5000 / N_GENES) / 60))
print("elapsed_total=%.1fs" % (time.time() - t0))
