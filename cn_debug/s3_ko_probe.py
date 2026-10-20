"""S3 步骤 9 虚拟敲除：数据侧探针（一次性，不进 src/）。

确认四件事，供敲除口径设计定稿：
1. scrna_annotated.h5ad 的 obs 列名与 celltype 构成（含 pDC 计数、按组拆分）；
2. hvg_genes.tsv 基因集与候选敲除基因的成员资格（候选全部来自本线：步骤 6 注释 marker、
   步骤 8 top 交互 LR 基因，不碰线1）；
3. scrna_norm.h5ad 的 layers 结构（确认 layers['counts'] 在位，scTenifold 走原始计数）；
4. scrna_cellcomm.h5ad uns['cell_communication']['top_specificity'] 表头与前几行
   （确认步骤 8 产出的可复用的敲除候选来源）。
"""
import pandas as pd
import scanpy as sc

BASE = "/mnt/ssd/bio_data/line2_scrna/processed"

annot = sc.read_h5ad(f"{BASE}/scrna_annotated.h5ad")
norm = sc.read_h5ad(f"{BASE}/scrna_norm.h5ad")

print("annot shape:", annot.shape)
print("norm shape:", norm.shape)
print("annot obs columns:", list(annot.obs.columns))
print("annot layers:", list(annot.layers.keys()))
print("norm layers:", list(norm.layers.keys()))

print("\n== celltype 构成 ==")
print(annot.obs["celltype"].value_counts().to_string())

group_col = None
for cand in ("diagnosis", "group", "region"):
    if cand in annot.obs.columns:
        group_col = cand
        break
print("\ngroup column:", group_col)
if group_col:
    print(annot.obs[group_col].value_counts().to_string())
    pdc = annot.obs[annot.obs["celltype"] == "pDC"]
    print("\npDC 按组:")
    print(pdc[group_col].value_counts().to_string())

hvg = pd.read_csv(f"{BASE}/hvg_genes.tsv", sep="\t")
print("\nhvg columns:", list(hvg.columns), "rows:", len(hvg))
hvg_genes = set(hvg.iloc[:, 0].astype(str))
print("hvg 与 norm var_names 交集:", len(hvg_genes & set(norm.var_names.astype(str))))

candidates = [
    "TCF4", "IL3RA", "IRF8", "GZMB",          # pDC 簇 marker（步骤 6）
    "CSF2", "CSF1R", "LAG3", "HLA-DQB2",      # 步骤 8 top 交互 LR
    "BST2", "LILRA4", "RSPO1", "LGR5", "FGF7", "FGFR1",
    "SELPLG", "SELL", "CD14", "TLR9",
    "CCL22", "IL17A", "MMP12", "TNF", "CXCL13",  # top HVG
]
norm_var = set(norm.var_names.astype(str))
print("\n候选基因在 HVG 中:", [g for g in candidates if g in hvg_genes])
print("候选基因在 norm var 中:", [g for g in candidates if g in norm_var])
print("候选基因两处都缺:", [g for g in candidates if g not in hvg_genes and g not in norm_var])

cc = sc.read_h5ad(f"{BASE}/scrna_cellcomm.h5ad")
meta = cc.uns["cell_communication"]
print("\ncellcomm uns keys:", list(meta.keys()))
top_spec = meta["top_specificity"]
print("top_specificity type:", type(top_spec).__name__, "shape:", getattr(top_spec, "shape", None))
if isinstance(top_spec, pd.DataFrame):
    print(top_spec.columns.tolist())
    print(top_spec.head(8).to_string())
