"""S3 步骤 9 虚拟敲除原型（一次性，不进 src/）。

验证三件事：
1. 口径可行性：Psoriasis 2747 细胞 x HVG 2000（counts）-> scTenifoldKnk(TNF) 全流程能跑完，
   QC 细胞/基因剔除量、每步耗时、TNF 在 WT 网络有无出边（无出边则敲除是空操作）；
2. 结果合理性：DR 表 adj p-value 显著基因数、top DR 基因生物学是否讲得通
   （TNF 敲除后调控重组应落在免疫/炎症/角化相关基因）；
3. 种子稳定性：换一个 seed 重跑，比较 top20 DR 基因（按 adj p-value）重合度。
"""
import time
import warnings

import pandas as pd
import scanpy as sc

import scTenifold as st

BASE = "/mnt/ssd/bio_data/line2_scrna/processed"
SEED_A = 20261013
SEED_B = 42
KO_GENE = "TNF"
POPULATION = "Psoriasis"

norm = sc.read_h5ad(f"{BASE}/scrna_norm.h5ad")
annot = sc.read_h5ad(f"{BASE}/scrna_annotated.h5ad")
hvg = pd.read_csv(f"{BASE}/hvg_genes.tsv", sep="\t")
hvg_genes = [str(g) for g in hvg["gene"].tolist()]

var_names = norm.var_names.astype(str).to_numpy()
assert set(hvg_genes) <= set(var_names), "HVG 列表与 norm var_names 不一致"
gene_mask = pd.Series(var_names).isin(hvg_genes).to_numpy()
counts = norm.layers["counts"][:, gene_mask]
print("counts 子集:", counts.shape, "HVG:", len(hvg_genes))

labels = annot.obs["diagnosis"].astype(str)
aligned = labels.reindex(norm.obs_names)
assert aligned.isna().sum() == 0, "标签按索引对齐后有缺失"
pop_mask = (aligned == POPULATION).to_numpy()
print(f"{POPULATION} 细胞数:", int(pop_mask.sum()))

pop_counts = counts[pop_mask]
pop_cells = norm.obs_names[pop_mask].astype(str)
expr = pd.DataFrame(
    pop_counts.toarray().T,
    index=[str(g) for g in var_names[gene_mask]],
    columns=pop_cells,
)
print("expr(genes x cells):", expr.shape)
print("TNF 表达细胞占比: %.4f" % ((expr.loc[KO_GENE] > 0).mean()))

t0 = time.perf_counter()
with warnings.catch_warnings(record=True) as wlist:
    warnings.simplefilter("always")
    scn = st.scTenifoldKnk(expr, ko_genes=KO_GENE,
                           nc_kws={"random_state": SEED_A},
                           td_kws={"random_state": SEED_A})
    dr = scn.build()
    for w in wlist:
        print("WARN:", str(w.message)[:200])
print("总耗时: %.1fs" % (time.perf_counter() - t0))

qc = scn.QC_dict["WT"]
print("QC 后矩阵(genes x cells):", qc.shape, "（输入 %d 基因 x %d 细胞）" % expr.shape)
print("shared_gene_names:", len(scn.shared_gene_names))
print("ko_genes_used:", scn._ko_genes_used)
print("DR 表:", dr.shape, "列:", dr.columns.tolist())

n_sig = int((dr["adjusted p-value"] < 0.05).sum())
print("adj p-value < 0.05 基因数:", n_sig)
ko_row = dr[dr["Gene"] == KO_GENE]
print("TNF 行:\n", ko_row.to_string(index=False))

top = dr[dr["Gene"] != KO_GENE].head(25)
print("\ntop25 DR（剔除 TNF 自身，按 adj p-value）:")
print(top[["Gene", "Distance", "Z", "FC", "p-value", "adjusted p-value"]].to_string(index=False))

# 种子稳定性：换 seed 重跑，比 top20 重合
t1 = time.perf_counter()
scn2 = st.scTenifoldKnk(expr, ko_genes=KO_GENE,
                        nc_kws={"random_state": SEED_B},
                        td_kws={"random_state": SEED_B})
dr2 = scn2.build()
print("第二次总耗时: %.1fs" % (time.perf_counter() - t1))
top_a = set(dr[dr["Gene"] != KO_GENE].head(20)["Gene"])
top_b = set(dr2[dr2["Gene"] != KO_GENE].head(20)["Gene"])
print("top20 重合: %d/20" % len(top_a & top_b))
print("仅 A 有:", sorted(top_a - top_b))
print("仅 B 有:", sorted(top_b - top_a))
