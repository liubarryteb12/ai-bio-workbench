# s3_dr_summary_probe.py — 一次性原型探针
# 目的：确认步骤 10 DR genes 汇总的输入数据形态与汇总口径可行性
#   - ko_dr_genes.tsv 的列、行数、敲除基因唯一性、adj p 单调性
#   - FC 符号分布（上调/下调 DR 基因数）
#   - scrna_knockout.h5ad 的 uns['virtual_knockout'] 可读性
import pandas as pd

dr = pd.read_csv("/mnt/ssd/bio_data/line2_scrna/processed/ko_dr_genes.tsv", sep="\t")
print("columns:", list(dr.columns))
print("n_rows:", dr.shape[0])
print("ko rows:", int(dr["is_knockout_gene"].sum()))
sig = dr[(dr["adjusted p-value"] < 0.05) & (~dr["is_knockout_gene"])]
print("sig_non_ko:", sig.shape[0])
print("sig_up(FC>1):", int((sig["FC"] > 1).sum()), "sig_down(FC<1):", int((sig["FC"] < 1).sum()))
print("sig top10:")
print(sig.head(10)[["Gene", "Distance", "Z", "FC", "p-value", "adjusted p-value"]].to_string(index=False))

import anndata as ad
ad.settings.allow_write_nullable_strings = False  # 坑 #107
ko = ad.read_h5ad("/mnt/ssd/bio_data/line2_scrna/processed/scrna_knockout.h5ad")
uns = ko.uns["virtual_knockout"]
print("uns keys:", sorted(uns.keys()))
print("ko_gene:", uns["ko_gene"], "population:", uns["population"], "seed:", uns["seed"])
print("n_genes_network:", uns["n_genes_network"], "n_cells_after_qc:", uns["n_cells_after_qc"])
print("obs cols:", list(ko.obs.columns)[:20])
print("celltype in obs:", "celltype" in ko.obs.columns)
print("tenifold_dr_available var sum:", int(ko.var["tenifold_dr_available"].sum()))
