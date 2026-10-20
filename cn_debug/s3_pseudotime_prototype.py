#!/usr/bin/env python3
"""S3 步骤 7 拟时序原型：验证 diffusion map + DPT 路线在 GSE254707 数据上可行。

拟时序口径（先验证再定稿生产脚本）：
1. diffmap：在步骤 5 的 harmony 邻居图上算 diffusion map
2. 根选择：progenitor_keratinocyte（簇 15）为皮肤分化谱系起点，
   取该簇中 DC 空间里"离其余簇最远"的细胞为根（iroot）
3. dpt：sc.tl.dpt 计算拟时序，预期根细胞 ≈0，值域 [0,1]
4. 与注释对照：progenitor -> basal -> suprabasal 的 pseudotime 是否单调
"""
import numpy as np
import pandas as pd
import anndata as ad
import scanpy as sc

H5AD = "/mnt/ssd/bio_data/line2_scrna/processed/scrna_annotated.h5ad"
SEED = 20261013

adata = ad.read_h5ad(H5AD)
print("loaded", adata.shape)
print("obsm", list(adata.obsm.keys()))
print("leiden", sorted(adata.obs["leiden"].unique(), key=int))

# --- diffmap on harmony 邻居图 ---
sc.tl.diffmap(adata, n_comps=15, random_state=SEED)
dc = adata.obsm["X_diffmap"]
print("X_diffmap", dc.shape, "finite", bool(np.isfinite(dc).all()))

# --- 根选择：progenitor_keratinocyte 簇 ---
root_mask = (adata.obs["celltype"] == "progenitor_keratinocyte").to_numpy()
print("root cluster cells:", int(root_mask.sum()))
root_idx = np.where(root_mask)[0]

# 根簇内细胞 DC 空间的质心
root_center = dc[root_idx].mean(axis=0)
# 其余细胞到根质心的距离
all_center = dc.copy()
dists = np.linalg.norm(all_center - root_center, axis=1)
# 根 = 根簇内离质心最远的细胞（谱系极端点）
root_local_dists = dists[root_idx]
root_cell = root_idx[int(np.argmax(root_local_dists))]
print("root cell idx:", root_cell, "dist to root-center:", float(dists[root_cell]))
print("root cell leiden:", adata.obs["leiden"].iloc[root_cell],
      "celltype:", adata.obs["celltype"].iloc[root_cell])

adata.uns["iroot"] = int(root_cell)

# --- DPT ---
sc.tl.dpt(adata, n_dcs=10, n_branchings=0, min_group_size=0.01)
dpt = adata.obs["dpt_pseudotime"].to_numpy()
print("dpt range:", float(np.nanmin(dpt)), float(np.nanmax(dpt)),
      "nan:", int(np.isnan(dpt).sum()))
print("root dpt:", float(dpt[root_cell]))

# --- 与注释对照：各 celltype 的 pseudotime 分布 ---
tab = adata.obs[["celltype", "dpt_pseudotime"]].copy()
grouped = tab.groupby("celltype", observed=True)["dpt_pseudotime"].agg(
    ["count", "median", "mean"]).sort_values("median")
print(grouped)

# --- 簇 x pseudotime 中位数 ---
tab2 = adata.obs[["leiden", "dpt_pseudotime"]].copy()
grouped2 = tab2.groupby("leiden", observed=True)["dpt_pseudotime"].median().sort_values()
print(grouped2)

# --- 线性谱系检查：progenitor/basal/suprabasal 的 pseudotime 中位数是否单调 ---
for ct in ["progenitor_keratinocyte", "basal_keratinocyte",
           "suprabasal_keratinocyte", "activated_keratinocyte",
           "melanocyte", "T_cell", "pDC", "unknown"]:
    sub = dpt[(adata.obs["celltype"] == ct).to_numpy()]
    if len(sub):
        print("pseudotime %-28s n=%4d median=%.4f q25=%.4f q75=%.4f"
              % (ct, len(sub), float(np.median(sub)),
                 float(np.percentile(sub, 25)), float(np.percentile(sub, 75))))
