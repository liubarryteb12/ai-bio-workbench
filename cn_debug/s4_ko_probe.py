#!/usr/bin/env python3
"""S4 步骤 13 虚拟敲除探针：scTenifoldKnk 在 spot 级数据的口径定性。

背景：line2 步骤 9 已用 scTenifoldpy 0.5.1 走 tenifoldknk 路线（敲除基因 TNF，
Psoriasis 2747 细胞，表达矩阵 HVG 2000 上的 counts）。line3 是 Visium spot 级
（mouse 17283 spots × 18628 基因，spot 含多细胞混合），用户约束：
"若为 spot 级空间数据，直接虚拟敲除需谨慎，可按空间域聚合或子集运行"。

探针回答四个问题：
1. 敲除对象口径：直接 spot 级 vs 按空间域聚合（每 spot 的 domain 标签已在 obs）。
   聚合 = 取各域 spot 的 counts 均值构成 pseudo-bulk（每样本每域一个 pseudo-cell），
   敲除对象 = pseudo-cell 集合。子集 = 直接取原 spot 子集跑（保留空间结构但
   scTenifoldKnk 的共表达网络是按样本建，spot 级样本内 spot 数 438-2348，
   域内 spot 数更少，网络质量存疑）。
2. 敲除基因选择：line3 的 top 基因。候选 = 步骤 12 top 目标基因（线内证据）
   vs line2 的 TNF（跨线不取，禁）。按线内 marker/定位/HVG 证据选。
3. 分组口径：敲除后比较 nafld vs stst（mouse condition_class）/ steatotic vs
   non_steatotic（human），DR genes = 组间调控差异，与 line2 同思路（DR≠DEG）。
4. 计时与可行性：scTenifoldKnk 在 pseudo-cell 数量上的耗时估计。
"""
import importlib.util
import time

import numpy as np
import anndata as ad

ad.settings.allow_write_nullable_strings = False
BASE = "/mnt/ssd/bio_data/line3_spatial/processed"

print("== 1. scTenifoldKnk 可用性 ==")
for m in ["scTenifoldKnk", "scTenifoldpy"]:
    print("%-14s %s" % (m, "present" if importlib.util.find_spec(m) else "ABSENT"))

print()
print("== 2. 敲除基因候选（线内证据） ==")
for tag in ["mouse", "human"]:
    a = ad.read_h5ad(BASE + "/spatial_localization_%s.h5ad" % tag)
    loc = a.uns["localization"]
    targets = loc["targets"]
    print("-- %s --" % tag)
    for i in range(1, 6):
        t = targets.get("target%d" % i)
        if t is None:
            continue
        print("   target%-2d %-10s %-18s 自洽=%d/%d enrich=%.2f frac=%.3f"
              % (i, t["gene_symbol"], t["ensembl_id"], t["n_samples_top"],
                 t["n_samples_total"], t["best_enrich"], t["frac_all"]))

print()
print("== 3. 分组与 pseudo-cell 规模 ==")
for tag in ["mouse", "human"]:
    a = ad.read_h5ad(BASE + "/spatial_localization_%s.h5ad" % tag)
    dom = a.obs["domain"].astype(str).to_numpy()
    cond = a.obs["condition_class"].astype(str).to_numpy()
    sample = a.obs["sample_id"].astype(str).to_numpy()
    print("-- %s --" % tag)
    for s in sorted(set(sample.tolist())):
        m = sample == s
        n_dom = len(set(dom[m].tolist()))
        print("   %s cond=%s spots=%d domains=%d" % (s, cond[m][0], int(m.sum()), n_dom))
    # pseudo-cell 规模 = 每样本域数之和
    n_pseudo = sum(len(set(dom[sample == s].tolist()))
                   for s in sorted(set(sample.tolist())))
    print("   pseudo-cell 总数（按样本 x 域聚合）: %d" % n_pseudo)

print()
print("== 4. counts 层可用性（敲除需原始计数，line2 同口径） ==")
a = ad.read_h5ad(BASE + "/spatial_localization_mouse.h5ad")
print("counts 层 dtype:", a.layers["counts"].dtype)
print("counts 层 nnz:", a.layers["counts"].nnz)
print("X dtype:", a.X.dtype, "X min/max:", float(a.X.min()), float(a.X.max()))

