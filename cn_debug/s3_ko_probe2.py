"""S3 步骤 9 虚拟敲除：群体 x 候选基因表达占比探针（一次性，不进 src/）。

sc_QC 默认 min_percent=0.05（基因需在 >5% 细胞中表达才保留），而 scTenifoldKnk 的
ko 步骤要求敲除基因必须活在 QC 后的基因集里。本脚本对候选（群体，基因）组合算
counts>0 的细胞占比，挑出既能过 QC 又有生物学由头的组合。
候选基因全部来自本线：步骤 3 top HVG、步骤 6 注释 marker、步骤 8 top LR。
"""
import numpy as np
import pandas as pd
import scanpy as sc

BASE = "/mnt/ssd/bio_data/line2_scrna/processed"
norm = sc.read_h5ad(f"{BASE}/scrna_norm.h5ad")
annot = sc.read_h5ad(f"{BASE}/scrna_annotated.h5ad")

counts = norm.layers["counts"]
var_names = norm.var_names.astype(str).to_numpy()
labels = annot.obs["celltype"].astype(str).to_numpy()
diagnosis = annot.obs["diagnosis"].astype(str).to_numpy()
group = annot.obs["group"].astype(str).to_numpy()

print("group values:", pd.Series(group).value_counts().to_dict())

populations = {
    "all": np.ones(len(labels), dtype=bool),
    "Psoriasis": diagnosis == "Psoriasis",
    "Healthy": diagnosis == "Healthy",
    "T_cell": labels == "T_cell",
    "NK_ILC": labels == "NK_ILC",
    "T_cell+NK_ILC": np.isin(labels, ["T_cell", "NK_ILC"]),
    "activated_keratinocyte": labels == "activated_keratinocyte",
    "macrophage_mDC": labels == "macrophage_mDC",
    "Langerhans_cell": labels == "Langerhans_cell",
    "basal_keratinocyte": labels == "basal_keratinocyte",
}

candidates = [
    "IL17A", "TNF", "CCL22", "MMP12", "CXCL13",          # 步骤 3 top HVG
    "TCF4", "IL3RA", "IRF8", "GZMB",                     # pDC 注释 marker
    "CSF2", "CSF1R", "HLA-DQB2", "LAG3",                 # 步骤 8 top LR
    "BST2", "LILRA4", "SCT", "VIPR2", "ASIP", "MC1R",
    "RSPO1", "LGR5", "FGF7", "FGFR1", "FN1", "PLAUR",
    "SELPLG", "SELL", "CD14", "TLR9",
]

mt_mask = np.array([g.upper().startswith("MT-") for g in var_names])
print("HVG 中 MT- 基因数:", int(mt_mask.sum()))

rows = []
for pop_name, mask in populations.items():
    n_cells = int(mask.sum())
    if n_cells == 0:
        continue
    sub = counts[mask][:, [g in set(candidates) for g in var_names]]
    sub = np.asarray(sub.todense()) if hasattr(sub, "todense") else np.asarray(sub)
    frac = (sub > 0).mean(axis=0)
    lib = np.asarray(sub.sum(axis=1)).ravel()
    rows.append((pop_name, n_cells, lib.min(), int(np.median(lib)), lib.max(), frac))

hdr = f"{'population':<24}{'n':>6}{'lib_min':>10}{'lib_med':>10}{'lib_max':>10}   " + "  ".join(f"{g[:8]:>8}" for g in candidates)
print("\n" + hdr)
for pop_name, n_cells, lo, med, hi, frac in rows:
    cells = "  ".join(f"{f * 100:8.2f}" for f in frac)
    print(f"{pop_name:<24}{n_cells:>6}{lo:>10.0f}{med:>10.0f}{hi:>10.0f}   {cells}")
print("\n（单元格 = 该群体中 counts>0 的细胞占比 %；>5.00 才能过 sc_QC 默认基因闸）")
