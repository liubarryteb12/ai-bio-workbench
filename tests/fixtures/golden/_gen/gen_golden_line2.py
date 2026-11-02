#!/usr/bin/env python3
"""gen_golden_line2.py —— Line2 scRNA 黄金矩阵生成器（Argon 配方，2026-11-02）

150 基因 x 80 细胞：3 个预标注 cluster（30/30/20），靶基因 STAT3 在 cluster0 高表达
（供 scTenifoldKnk 虚拟敲除：敲除组 vs 对照组的 marker 差异必须可检出）。
seed=42 确定性；产出 golden_scrna/pbmc3k_toy.h5ad（X 为 raw counts int）。
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import anndata as ad

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.')
OUT.mkdir(parents=True, exist_ok=True)

rng = np.random.default_rng(42)
n_genes, n_cells = 150, 80
clusters = np.array([0]*30 + [1]*30 + [2]*20)
# 基线：每基因 mu 3~40，NB(size=5) 保证稀疏但可算
mu_base = rng.uniform(3, 40, n_genes)
counts = np.zeros((n_cells, n_genes), dtype=np.int32)
for g in range(n_genes):
    counts[:, g] = rng.negative_binomial(5, 5 / (5 + mu_base[g]), n_cells)
# cluster 特异 marker：c0 -> GENE_C0_1..5 x8；c1 -> GENE_C1_1..5 x8；c2 -> GENE_C2_1..5 x8
gene_names = ([f'GENE_C{c}_{i}' for c in range(3) for i in range(1, 6)]
              + ['STAT3'] + [f'GENE_BG_{i}' for i in range(1, 135)])
assert len(gene_names) == n_genes
for c in range(3):
    idx = np.where(clusters == c)[0]
    for j in range(5):
        g = gene_names.index(f'GENE_C{c}_{j+1}')
        counts[idx, g] = rng.negative_binomial(5, 5 / (5 + mu_base[g] * 8), len(idx))
# 靶基因 STAT3：cluster0 高表达（x10），其余基线 —— 虚拟敲除的可检出锚点
g_stat = gene_names.index('STAT3')
idx0 = np.where(clusters == 0)[0]
counts[idx0, g_stat] = rng.negative_binomial(5, 5 / (5 + mu_base[g_stat] * 10), len(idx0))

var = pd.DataFrame(index=gene_names)
var['highly_variable'] = [n.startswith('GENE_C') or n == 'STAT3' for n in gene_names]
obs = pd.DataFrame({'cluster': clusters.astype(str)}, index=[f'CELL_{i:03d}' for i in range(n_cells)])
adata = ad.AnnData(X=counts, obs=obs, var=var)
adata.write_h5ad(OUT / 'pbmc3k_toy.h5ad', compression='gzip')
print('GOLDEN_LINE2_OK', counts.shape, 'STAT3_c0_mean=', counts[idx0, g_stat].mean().round(2))