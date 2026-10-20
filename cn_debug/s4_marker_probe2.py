# s4_marker_probe2：验证 ensembl→symbol 映射与肝巨噬 panel 命中（步骤 6 定稿探针）
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
N_TOP = 200
PANEL = {"mouse": ["Marco", "Cd5l", "C1qb", "C1qa", "Clec4f", "Adgre1", "Siglecf"],
         "human": ["MARCO", "CD5L", "C1QB", "C1QA", "CLEC4F", "ADGRE1", "SIGLEC1"]}

for species, path in PATHS.items():
    a = ad.read_h5ad(path)
    print("=== %s domains=%d" % (species, a.obs["domain"].nunique()))
    t0 = time.time()
    sc.tl.rank_genes_groups(a, groupby="domain", method="wilcoxon", pts=True,
                            n_genes=N_TOP, key_added="domain_markers")
    print("wilcoxon n_genes=%d %.1fs" % (N_TOP, time.time() - t0))

    df = sc.get.rank_genes_groups_df(a, group=None, key="domain_markers")
    # ensembl -> symbol 映射（symbol 有重复属已知口径，映射表逐 ID 取 var['gene_symbol']）
    symbol_map = a.var["gene_symbol"].to_dict()
    df["gene_symbol"] = df["names"].map(symbol_map)
    print("marker 表 %d 行，symbol 缺失=%d" % (len(df), int(df["gene_symbol"].isna().sum())))

    top20 = df[df["names"].notna()].sort_values(["group", "scores"], ascending=[True, False])
    top20 = top20.groupby("group").head(20)
    print("top20 per domain 行数=%d（预期 %d）" % (len(top20), 20 * a.obs["domain"].nunique()))

    # 肝巨噬 panel：panel 基因在各域 top20 的命中分布
    panel = PANEL[species]
    hits = {}
    for gene in panel:
        rows = top20[top20["gene_symbol"] == gene]
        if len(rows):
            best = rows.sort_values("scores", ascending=False).iloc[0]
            hits[gene] = (best["group"], round(float(best["scores"]), 1))
    print("肝巨噬 panel top20 命中: %s" % hits)
    # 命中域示例 top5（看是否巨噬域）
    if hits:
        dom = list(hits.values())[0][0]
        print("  示例域 %s top5: %s" % (dom, " ".join(top20[top20['group'] == dom].head(5)["gene_symbol"].astype(str))))
print("PROBE2_DONE")
