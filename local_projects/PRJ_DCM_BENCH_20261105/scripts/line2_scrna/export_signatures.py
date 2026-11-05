#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""export_signatures：L2 注释产物 -> L3 解卷积用的细胞类型平均表达签名。

为什么需要这一步：L3（小鼠 Visium）的 NNLS 解卷积必须用**本项目的**细胞类型签名，
不能用任何内置或外部研究的签名（物种/组织/平台都不同）。L2 是人心脏 snRNA，
所以这里导出 human symbol 空间的均值表达谱，由 L3 侧按 symbol 同名映射到小鼠。

口径：
  - 表达用 layers['counts'] 重算 normalize_total(1e4)+log1p（与 L2 DEG 同口径，避免用整合空间）；
  - 签名 = 每个 celltype 内细胞的均值表达（不按供体加权，供体差异已被 Harmony 校正）；
  - 只保留在 >= MIN_CELLS 细胞里出现的类型，并把细胞数与供体数写进报告；
  - 输出宽表：第一列 gene_symbol，其后每列一个 celltype。
"""
import os
import sys
import time

import numpy as np
import pandas as pd
import anndata as ad

TARGET_SUM = 1e4
MIN_CELLS = 50


def fail(message):
    sys.stderr.write("export_signatures 自校验失败: %s\n" % message)
    sys.stderr.flush()
    sys.exit(1)


def log(message):
    print(message, flush=True)


annotated_file = os.environ["ANNOTATED_FILE"]
norm_file = os.environ["NORM_FILE"]
out_file = os.environ["SIG_OUT"]
seed = os.environ.get("BIOANALYS_SEED", "UNSET")
START = time.time()

annot = ad.read_h5ad(annotated_file)
norm = ad.read_h5ad(norm_file)
log("annotated=%s norm=%s" % (annot.shape, norm.shape))
if "celltype" not in annot.obs.columns:
    fail("annotated 缺 obs['celltype']")
if "counts" not in norm.layers:
    fail("norm 缺 layers['counts']")
if set(annot.obs_names) != set(norm.obs_names):
    fail("annotated 与 norm 细胞集合不一致")

# 顺序对齐到 annotated 的细胞顺序（两者细胞集合已断言一致），避免标签与矩阵错位
annot = annot[norm.obs_names].copy()

X = norm.layers["counts"].tocsr().astype(np.float32)
lib = np.asarray(X.sum(axis=1)).ravel().astype(np.float64)
if (lib <= 0).any():
    fail("有细胞库大小为 0")
scaling = (TARGET_SUM / lib).astype(np.float32)
indptr = X.indptr
row_nnz = np.diff(indptr)
data = X.data
for start in range(0, X.shape[0], 4000):
    stop = min(start + 4000, X.shape[0])
    lo, hi = int(indptr[start]), int(indptr[stop])
    blk = np.repeat(scaling[start:stop], row_nnz[start:stop])
    data[lo:hi] *= blk
    del blk
np.log1p(data, out=data)

symbols = (norm.var["gene_symbol"].astype(str).to_numpy()
           if "gene_symbol" in norm.var.columns else norm.var_names.astype(str))
celltype = annot.obs["celltype"].astype(str).to_numpy()
donor = annot.obs["donor"].astype(str).to_numpy()

kept, skipped = [], {}
cols = {}
for ct in sorted(set(celltype)):
    mask = celltype == ct
    n_cells = int(mask.sum())
    n_donors = len(set(donor[mask]))
    if ct == "unknown" or n_cells < MIN_CELLS:
        skipped[ct] = {"cells": n_cells, "donors": n_donors,
                       "reason": "unknown" if ct == "unknown" else "cells<%d" % MIN_CELLS}
        continue
    mean_vec = np.asarray(X[mask].mean(axis=0)).ravel()
    cols[ct] = mean_vec
    kept.append({"celltype": ct, "cells": n_cells, "donors": n_donors})
if not cols:
    fail("没有任何细胞类型通过门槛（>= %d 细胞且非 unknown）" % MIN_CELLS)

df = pd.DataFrame(cols, index=pd.Index(symbols, name="gene_symbol"))
# 同 symbol 多行：取均值（签名表按 symbol 唯一，L3 侧按 symbol 精确匹配）
if df.index.duplicated().any():
    n_dup = int(df.index.duplicated().sum())
    df = df.groupby(level=0, sort=False).mean()
    log("duplicated symbols merged=%d" % n_dup)
df = df.sort_index()
df.to_csv(out_file, sep="\t")

report = [
    "step=export_signatures",
    "seed=%s" % seed,
    "annotated=%s" % annotated_file,
    "norm=%s" % norm_file,
    "cells=%d genes=%d" % (X.shape[0], X.shape[1]),
    "normalization=normalize_total(%g)+log1p（从 layers['counts'] 重算，分块实现）" % TARGET_SUM,
    "signature=per_celltype_mean_expression（不按供体加权）",
    "min_cells=%d" % MIN_CELLS,
    "celltypes_kept=%s" % {r["celltype"]: {"cells": r["cells"], "donors": r["donors"]} for r in kept},
    "celltypes_skipped=%s" % skipped,
    "limitation_note=签名来自人心 snRNA 的细胞类型均值，跨物种到小鼠靠 symbol 同名映射，"
    " 存在同源误配与表达域差异（log1p 域线性混合是近似），L3 报告需重复该局限。",
    "outputs=%s" % out_file,
    "elapsed_seconds=%.0f" % (time.time() - START),
]
report_path = os.path.join(os.path.dirname(out_file) or ".", "signatures_report.txt")
with open(report_path, "w", encoding="utf-8") as fh:
    fh.write("\n".join(report) + "\n")
for line in report:
    log(line)
log("export_signatures OK")