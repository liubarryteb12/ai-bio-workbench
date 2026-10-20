# s4_marker_prototype：线3 步骤 6 空间 marker 原型探针（一次性，服务器 /tmp 跑）
# 目的：
#   1. 计时：逐物种 57/18 域 wilcoxon rank_genes_groups（全基因矩阵，pts 开关对比）
#   2. top marker 生物学合理性：肝巨噬细胞域应出 Marco/Cd5l/C1qb/C1qa 等
#      （Guilliams 2022 肝 KC 标记），人源对应 MARCO/CD5L/C1QB/C1QA
#   3. 域数多时的组织方式：57 域 × top20 = 1140 行，tsv 组织与列口径
#   4. min_fc/min_in_group_fraction 过滤是否需要（空间 spot 稀疏噪声）
import time

import numpy as np
import pandas as pd
import anndata as ad
import scanpy as sc

ad.settings.allow_write_nullable_strings = False

PATHS = {
    "mouse": "/mnt/ssd/bio_data/line3_spatial/processed/spatial_domains_mouse.h5ad",
    "human": "/mnt/ssd/bio_data/line3_spatial/processed/spatial_domains_human.h5ad",
}

for species, path in PATHS.items():
    a = ad.read_h5ad(path)
    print("=== %s spots=%d genes=%d domains=%d" % (species, a.shape[0], a.shape[1], a.obs["domain"].nunique()))

    t0 = time.time()
    sc.tl.rank_genes_groups(a, groupby="domain", method="wilcoxon", pts=True,
                            n_genes=a.shape[1], key_added="domain_markers_pts")
    t1 = time.time()
    print("wilcoxon pts=True %.1fs" % (t1 - t0))

    # top5 marker per domain（前 8 个域），看生物学合理性
    df = sc.get.rank_genes_groups_df(a, group=None, key="domain_markers_pts")
    print("marker 表行数=%d 列=%s" % (len(df), list(df.columns)))
    for dom in list(a.obs["domain"].unique())[:8]:
        sub = df[df["group"] == dom].head(5)
        print("  %s: %s" % (dom, " ".join(sub["names"].astype(str))))

    # 肝巨噬细胞标记命中抽查（小鼠 marco/cd5l/c1qb，人 MARCO/CD5L/C1QB）
    panel = {"mouse": ["Marco", "Cd5l", "C1qb", "C1qa", "Clec4f"],
             "human": ["MARCO", "CD5L", "C1QB", "C1QA", "CLEC4F"]}[species]
    hits = {}
    for gene in panel:
        row = df[df["names"] == gene]
        if len(row):
            best = row.sort_values("scores", ascending=False).iloc[0]
            hits[gene] = (best["group"], round(float(best["scores"]), 1))
    print("肝巨噬 panel 命中: %s" % hits)

    # 无 pts 计时对比（pts 计算 pct 表达成本）
    t2 = time.time()
    sc.tl.rank_genes_groups(a, groupby="domain", method="wilcoxon", pts=False,
                            n_genes=a.shape[1], key_added="domain_markers_nopts")
    print("wilcoxon pts=False %.1fs" % (time.time() - t2))
print("PROTOTYPE_DONE")
