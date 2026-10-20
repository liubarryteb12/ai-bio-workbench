# s4_marker_probe3：panel 在 top200 的命中分布 + human top20 top1 盘点（sanity 定稿取证）
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
# 泛免疫基因：任何组织空间数据都应在某些域富集的宽泛标记
PAN_IMMUNE = {"mouse": ["Tmsb4x", "Cd74", "H2-Aa", "Ptprc", "Lyz2"],
              "human": ["TMSB4X", "CD74", "HLA-DRA", "PTPRC", "LYZ"]}

for species, path in PATHS.items():
    a = ad.read_h5ad(path)
    t0 = time.time()
    sc.tl.rank_genes_groups(a, groupby="domain", method="wilcoxon", pts=True,
                            n_genes=N_TOP, key_added="domain_markers")
    print("=== %s domains=%d wilcoxon %.1fs" % (species, a.obs["domain"].nunique(), time.time() - t0))

    df = sc.get.rank_genes_groups_df(a, group=None, key="domain_markers")
    symbol_map = a.var["gene_symbol"].to_dict()
    df["gene_symbol"] = df["names"].map(symbol_map)

    # panel 在 top200 的命中分布（每基因最好排名所在域与 rank）
    for gene in PANEL[species] + PAN_IMMUNE[species]:
        rows = df[df["gene_symbol"] == gene].sort_values("scores", ascending=False)
        if len(rows):
            best = rows.iloc[0]
            rank_in_group = int((df[df["group"] == best["group"]]["scores"] > best["scores"]).sum()) + 1
            print("  %-9s best group=%-12s scores=%7.1f rank_in_group=%d" %
                  (gene, best["group"], float(best["scores"]), rank_in_group))
        else:
            print("  %-9s NOT_IN_TABLE" % gene)

    # 每域 top1 symbol 盘点（看域标记整体质量）
    top1 = df.sort_values(["group", "scores"], ascending=[True, False]).groupby("group").head(1)
    print("  每域 top1 symbol: %s" % " ".join(top1["gene_symbol"].astype(str).tolist()))
print("PROBE3_DONE")
