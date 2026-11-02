#!/usr/bin/env python3
"""gen_golden_line3.py —— Line3 空间转录组黄金矩阵生成器（Argon 配方，2026-11-02）

100 基因 x 64 spot（8x8 规则网格坐标）：不含 H&E 大图（Squidpy 邻接图与 Moran's I
只需 obsm['spatial'] 二维坐标 + 表达矩阵）。seed=42。产出 golden_spatial/spatial_toy.h5ad。
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import anndata as ad

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.')
OUT.mkdir(parents=True, exist_ok=True)

rng = np.random.default_rng(42)
n_genes, side = 100, 8
n_spots = side * side
# 8x8 网格坐标（单位 1.0），行主序
coords = np.array([[x, y] for y in range(side) for x in range(side)], dtype=float)
# 左半区 vs 右半区两个空间域（供空间域识别与 Moran 检验有方向性信号）
left = coords[:, 0] < side / 2
mu_base = rng.uniform(5, 60, n_genes)
counts = np.zeros((n_spots, n_genes), dtype=np.int32)
for g in range(n_genes):
    counts[:, g] = rng.negative_binomial(5, 5 / (5 + mu_base[g]), n_spots)
gene_names = ['SPATIAL_DOM_A_1', 'SPATIAL_DOM_A_2', 'SPATIAL_DOM_B_1', 'SPATIAL_DOM_B_2'] + [f'SP_BG_{i}' for i in range(1, 97)]
assert len(gene_names) == n_genes
# 域 A marker 在左半 x8，域 B marker 在右半 x8（Moran's I 必须有强空间自相关）
for name, mask in [('SPATIAL_DOM_A_1', left), ('SPATIAL_DOM_A_2', left),
                   ('SPATIAL_DOM_B_1', ~left), ('SPATIAL_DOM_B_2', ~left)]:
    g = gene_names.index(name)
    counts[mask, g] = rng.negative_binomial(5, 5 / (5 + mu_base[g] * 8), int(mask.sum()))

obs = pd.DataFrame(index=[f'SPOT_{i:02d}' for i in range(n_spots)])
var = pd.DataFrame(index=gene_names)
adata = ad.AnnData(X=counts, obs=obs, var=var)
adata.obsm['spatial'] = coords
adata.write_h5ad(OUT / 'spatial_toy.h5ad', compression='gzip')
print('GOLDEN_LINE3_OK', counts.shape)