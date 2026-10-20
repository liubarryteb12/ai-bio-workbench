#!/usr/bin/env python3
"""S3 步骤 8 原型：liana 细胞间通讯（一次性，不进生产）。

验证点：
1. annotated(标签) + norm(全基因表达) 双输入装配是否成立（索引对齐）
2. consensus 资源对 norm 全基因矩阵的覆盖率
3. rank_aggregate 跑通 + 计时 + seed 复现性
4. top 交互的生物学合理性抽查（皮肤免疫常识）
5. 决定生产口径（n_perms / 方法集合 / 过滤参数）
"""
import time

import anndata as ad
import liana as li
import numpy as np
import pandas as pd

ad.settings.allow_write_nullable_strings = False

PROCESSED = "/mnt/ssd/bio_data/line2_scrna/processed"
SEED = 20261013

t0 = time.time()
annot = ad.read_h5ad(f"{PROCESSED}/scrna_annotated.h5ad")
norm = ad.read_h5ad(f"{PROCESSED}/scrna_norm.h5ad")
print("loaded annotated=%s norm=%s (%.1fs)" % (annot.shape, norm.shape, time.time() - t0))
print("norm has raw:", norm.raw is not None, "| layers:", list(norm.layers.keys()))
print("annot has raw:", annot.raw is not None)

# --- 装配：表达取 norm 全基因矩阵，标签取 annotated celltype ---
assert list(annot.obs_names) == list(norm.obs_names), "两个产物细胞顺序不一致，需按索引对齐"
labels = annot.obs["celltype"].astype(str)
print("celltypes:", labels.value_counts().to_dict())

adata = norm.copy()
adata.obs["celltype"] = labels
print("combined:", adata.shape)

# --- consensus 资源覆盖 ---
res = li.resource.select_resource("consensus")
db_genes = set(res["ligand"].astype(str)) | set(res["receptor"].astype(str))
var_genes = set(adata.var_names.astype(str))
covered = db_genes & var_genes
print("db_genes=%d covered_in_norm=%d coverage=%.3f"
      % (len(db_genes), len(covered), len(covered) / len(db_genes)))
# 对照：若只用 2000 HVG 矩阵覆盖率多少
hvg_genes = set(annot.var_names.astype(str))
covered_hvg = db_genes & hvg_genes
print("coverage_in_2000hvg=%d (%.3f)" % (len(covered_hvg), len(covered_hvg) / len(db_genes)))

# --- rank_aggregate：先用 n_perms=100 试通与计时 ---
t1 = time.time()
li.mt.rank_aggregate(adata, groupby="celltype", resource_name="consensus",
                     use_raw=False, n_perms=100, seed=SEED, verbose=False)
print("rank_aggregate n_perms=100: %.1fs" % (time.time() - t1))
res_df = adata.uns["liana_res"]
print("result shape:", res_df.shape)
print("columns:", list(res_df.columns))
print(res_df.head(10).to_string())

# --- top 交互总览（specificity_rank 越小越强）---
top = res_df.sort_values("specificity_rank").head(15)
print("\nTOP15 by specificity_rank:")
print(top[["source", "target", "ligand_complex", "receptor_complex", "specificity_rank", "magnitude_rank"]].to_string())

# --- 分组抽查：每对 source->target 的最强交互（magnitude_rank 越小越强）---
print("\nper-pair top1 (by magnitude_rank):")
for (src, tgt), grp in res_df.groupby(["source", "target"]):
    row = grp.sort_values("magnitude_rank").iloc[0]
    print("  %-28s -> %-28s %s->%s mag=%.2e" % (src, tgt, row["ligand_complex"], row["receptor_complex"], row["magnitude_rank"]))

# --- n_perms 稳定性：100 vs 1000 的 top20 overlap ---
import shutil
res100 = res_df.copy()
del adata.uns["liana_res"]
t2 = time.time()
li.mt.rank_aggregate(adata, groupby="celltype", resource_name="consensus",
                     use_raw=False, n_perms=1000, seed=SEED, verbose=False)
print("\nrank_aggregate n_perms=1000: %.1fs" % (time.time() - t2))
res1000 = adata.uns["liana_res"]
key100 = set(map(tuple, res100.sort_values("specificity_rank").head(20)[["source", "target", "ligand_complex", "receptor_complex"]].values))
key1000 = set(map(tuple, res1000.sort_values("specificity_rank").head(20)[["source", "target", "ligand_complex", "receptor_complex"]].values))
print("top20 specificity overlap 100 vs 1000: %d/20" % len(key100 & key1000))
print("top20 @1000:")
print(res1000.sort_values("specificity_rank").head(20)[["source", "target", "ligand_complex", "receptor_complex", "specificity_rank", "magnitude_rank"]].to_string())

print("\ntotal %.1fs" % (time.time() - t0))
