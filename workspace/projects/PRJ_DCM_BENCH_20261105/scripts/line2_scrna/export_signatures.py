#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""export_signatures：L2 注释产物 -> L3 解卷积用的细胞类型平均表达签名。

内存纪律（2026-11-05 实测）：norm 是 74,883 x 29,327、nnz 2.1 亿，整对象加载约 1.7GB，
且 anndata 读 layers 时会整层 to_memory（单数组 802MB），足以把手机打到 thrash。
这里改成按行块流式累加：每块读若干细胞的行，按 celltype 累加和与计数，
峰值内存与块大小成正比（默认 2000 行/块）。
"""
import os
import sys
import time

import numpy as np
import pandas as pd
import anndata as ad
import h5py

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from h5_rows import read_csr_rows, read_var_column  # noqa: E402

BLOCK_ROWS = int(os.environ.get("BIO_SIG_BLOCK_ROWS", "2000"))
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

annot = ad.read_h5ad(annotated_file, backed="r")
if "celltype" not in annot.obs.columns:
    fail("annotated 缺 obs['celltype']")
labels = annot.obs["celltype"].astype(str)
celltypes = [c for c in sorted(labels.unique()) if c != "unknown"]
counts = labels.value_counts()
kept = [c for c in celltypes if int(counts.get(c, 0)) >= MIN_CELLS]
skipped = {c: int(counts.get(c, 0)) for c in celltypes if c not in kept}
if not kept:
    fail("没有细胞类型达到 %d 细胞的门槛" % MIN_CELLS)
log("celltypes_kept=%d skipped=%s" % (len(kept), skipped))

with h5py.File(norm_file, "r") as f:
    n_genes = int(f["X"].attrs["shape"][1])
    n_obs = int(f["X"].attrs["shape"][0])
symbols = read_var_column(norm_file, "gene_symbol")
if n_obs != labels.shape[0]:
    fail("norm 细胞数 %d 与 annotated %d 不一致" % (n_obs, labels.shape[0]))

label_arr = labels.to_numpy()
sums = {c: np.zeros(n_genes, dtype=np.float64) for c in kept}
n_cells = {c: 0 for c in kept}
for start in range(0, n_obs, BLOCK_ROWS):
    stop = min(start + BLOCK_ROWS, n_obs)
    rows = np.arange(start, stop)
    Xb = read_csr_rows(norm_file, "X", rows)
    block_labels = label_arr[start:stop]
    for c in kept:
        m = block_labels == c
        if not m.any():
            continue
        sums[c] += np.asarray(Xb[m].sum(axis=0)).ravel()
        n_cells[c] += int(m.sum())
    del Xb
    log("block %d-%d done (%.0fs)" % (start, stop, time.time() - START))

cols = {}
for c in kept:
    if n_cells[c] == 0:
        continue
    cols[c] = sums[c] / n_cells[c]
if not cols:
    fail("没有任何细胞类型有细胞")

df = pd.DataFrame(cols, index=pd.Index(symbols, name="gene_symbol"))
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
    "cells=%d genes=%d block_rows=%d" % (n_obs, n_genes, BLOCK_ROWS),
    "expression=norm 的 X（log1p 归一化域）按细胞类型求均值，流式分块累加",
    "min_cells=%d" % MIN_CELLS,
    "celltypes_kept=%s" % {c: n_cells[c] for c in cols},
    "celltypes_skipped=%s" % skipped,
    "limitation_note=签名来自人心 snRNA 的细胞类型均值，跨物种到小鼠靠 symbol 大写同名映射，"
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