"""S3 步骤 9 虚拟敲除：产物回读验证（一次性）。"""
import pandas as pd
import scanpy as sc

BASE = "/mnt/ssd/bio_data/line2_scrna/processed"

dr = pd.read_csv(f"{BASE}/ko_dr_genes.tsv", sep="\t")
print("ko_dr_genes.tsv:", dr.shape, "列:", dr.columns.tolist())
print("TNF 行 is_knockout_gene:", dr.loc[dr["Gene"] == "TNF", "is_knockout_gene"].tolist())
print("is_knockout_gene=True 行数:", int(dr["is_knockout_gene"].sum()))
print("p-value 单调非降:", bool((dr["p-value"].diff().dropna() >= -1e-15).all()))
print("前 5 行:\n", dr.head(5).to_string(index=False))

ko = sc.read_h5ad(f"{BASE}/scrna_knockout.h5ad")
print("\nscrna_knockout.h5ad:", ko.shape)
print("obs 新增列 tenifold_qc_kept:", int(ko.obs["tenifold_qc_kept"].sum()), "/", ko.shape[0])
print("var 新增列:", [c for c in ko.var.columns if c.startswith("tenifold_")])
print("tenifold_dr_available=True:", int(ko.var["tenifold_dr_available"].sum()))
print("tenifold_adj_p_value 非空:", int(ko.var["tenifold_adj_p_value"].notna().sum()))
print("TNF 的 tenifold 行:",
      ko.var.loc["TNF", ["tenifold_distance", "tenifold_adj_p_value", "tenifold_dr_available"]].to_dict()
      if "TNF" in ko.var_names else "TNF 不在 var")
meta = ko.uns["virtual_knockout"]
print("\nuns keys:", sorted(meta.keys()))
for key in ["method", "sctenifoldpy_version", "ko_gene", "population", "n_cells_population",
            "n_cells_after_qc", "n_genes_input", "n_genes_network", "n_nets", "n_samp_cells",
            "n_comp", "q_value", "td_rank", "ma_dims", "ko_method", "ko_expression_fraction",
            "seed", "n_dr_genes", "n_significant", "n_significant_excluding_ko", "ko_rank_by_pvalue"]:
    print("  %s = %s" % (key, meta[key]))
top = meta["top_dr_genes"]
print("top_dr_genes 表:", type(top).__name__, top.shape)
print(top.head(5).to_string(index=False))
print("warnings:", meta["warnings"])

print("\n== knockout_report.txt ==")
with open(f"{BASE}/knockout_report.txt") as fh:
    print(fh.read())
