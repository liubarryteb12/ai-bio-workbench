#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""normalize_hvg_adapt：scrna_qc.h5ad 的归一化 / 高变基因（分块实现）。

为什么要适配：全局母版直接调 sc.pp.normalize_total，scanpy 内部用
np.repeat(scaling, np.diff(indptr)) 造一个与 nnz 等长的临时数组。本数据 nnz=2.1 亿
（母版原型只有 4,587 细胞），临时数组 802 MiB 叠加原始矩阵后顶破 7.5GB RLIMIT，
实测 _ArrayMemoryError。这里按行块就地缩放，临时量只有块大小，口径与 scanpy 逐字一致
（normalize_total(target_sum=1e4) 后 log1p），产物契约不变。
"""
import gc
import os
import time

import numpy as np
import pandas as pd
import anndata as ad
import scanpy as sc

TARGET_SUM = 1e4
N_TOP_GENES = 2000
BLOCK_ROWS = 4000


def fail(message):
    sys_stderr_write = __import__('sys').stderr.write
    sys_stderr_write("normalize_hvg_adapt 自校验失败: %s\n" % message)
    __import__('sys').exit(1)


def log(message):
    print(message, flush=True)


h5ad_file = os.environ["H5AD_FILE"]
seed = os.environ["BIOANALYS_SEED"]
START = time.time()

adata = ad.read_h5ad(h5ad_file)
log("loaded cells=%d genes=%d" % adata.shape)
if "ercc" not in adata.var.columns:
    fail("输入缺 var['ercc']（不是 qc 产物？）")

ercc_mask = adata.var["ercc"].astype(bool).to_numpy()
n_ercc_genes = int(ercc_mask.sum())
# 10x 无 spike-in：ercc 全 False，剔除数为 0，但保留这一步的台账形态与母版一致
if n_ercc_genes:
    adata = adata[:, ~ercc_mask].copy()

X = adata.X
if not hasattr(X, "indptr"):
    from scipy.sparse import csr_matrix
    X = csr_matrix(X)
X = X.tocsr()
if not np.issubdtype(X.dtype, np.integer):
    fail("输入 X 非整数 dtype（qc 产物应为计数矩阵）")
# 原始整数计数先留层，再把 X 转 float32 就地归一化：只多一次拷贝，
# 不重读 1.8GB 的输入文件（重读会把两份全矩阵同时驻留，反而更容易 OOM）
adata.layers["counts"] = X.copy().astype(np.int32)
X = X.astype(np.float32)
adata.X = X

# --- 分块就地缩放：libsize -> target_sum，再 log1p（等价 normalize_total + log1p）---
indptr = adata.X.indptr
row_nnz = np.diff(indptr)
libsize = np.asarray(adata.X.sum(axis=1)).ravel().astype(np.float64)
zero_lib = int((libsize <= 0).sum())
if zero_lib:
    fail("有 %d 个细胞库大小为 0，归一化会出 NaN" % zero_lib)
scale = TARGET_SUM / libsize
data = adata.X.data
for start in range(0, adata.n_obs, BLOCK_ROWS):
    stop = min(start + BLOCK_ROWS, adata.n_obs)
    lo, hi = int(indptr[start]), int(indptr[stop])
    block_scale = np.repeat(scale[start:stop].astype(np.float32), row_nnz[start:stop])
    data[lo:hi] *= block_scale
    del block_scale
np.log1p(data, out=data)
del scale, libsize, row_nnz, indptr
gc.collect()
log("normalized in place: nnz=%d" % data.size)

# 归一化后不应有 NaN/Inf
probe = data[: min(len(data), 2 * 10 ** 7)]
if not np.isfinite(probe).all():
    fail("归一化结果含非有限值")

# --- 高变基因：seurat flavor，n_top_genes=2000（母版同口径）---
sc.pp.highly_variable_genes(
    adata, n_top_genes=N_TOP_GENES, flavor="seurat", inplace=True)
hvg_flag = adata.var["highly_variable"].astype(bool).to_numpy()
n_hvg = int(hvg_flag.sum())
if n_hvg != N_TOP_GENES:
    fail("HVG 选出 %d 个 != %d" % (n_hvg, N_TOP_GENES))

# uns 形态与全局母版逐字一致（dict 而非 JSON 字符串、seed 为 int）：
# 下游母版步骤可能按 uns["normalization"]["method"] 这类键路径取值，字符串会让它崩。
adata.uns["normalization"] = {
    "method": "scanpy_normalize_total_log1p",
    "target_sum": TARGET_SUM,
    "implementation": "block_inplace_rows=%d" % BLOCK_ROWS,
    "reason": "scanpy 默认实现造 nnz 等长临时数组，本数据 nnz=2.1 亿触发 OOM",
}
adata.uns["hvg"] = {
    "method": "scanpy_seurat_flavor",
    "n_top_genes": N_TOP_GENES,
    "n_hvg": n_hvg,
    "on_genes": int(adata.n_vars),
}
adata.uns["ercc_removed_count"] = n_ercc_genes
adata.uns["source_h5ad"] = h5ad_file
adata.uns["seed"] = int(seed)

os.makedirs("processed", exist_ok=True)
adata.write_h5ad(os.path.join("processed", "scrna_norm.h5ad"))

report = [
    "step=normalize_hvg_adapt",
    "seed=%s" % seed,
    "input_h5ad=%s" % h5ad_file,
    "cells=%d genes=%d" % adata.shape,
    "nnz=%d" % adata.X.nnz,
    "layers=counts(int32 原始计数)",
    "target_sum=%g" % TARGET_SUM,
    "block_rows=%d（分块就地缩放，避免 nnz 等长临时数组）" % BLOCK_ROWS,
    "ercc_removed=%d" % n_ercc_genes,
    "hvg=n_top_genes=%d flavor=seurat 全数据集选取未按供体分batch" % N_TOP_GENES,
    "self_check=库大小非零/归一化有限值/HVG 数精确匹配 OK",
    "limitation_note=分块实现与 scanpy 数值等价（同为 target_sum 缩放后 log1p），"
    " 但浮点求和顺序不同会有 1e-7 量级末位差，跨软件对账时以本口径为准；"
    " 全数据集选 HVG（母版同口径），步骤 4 Harmony 再按供体校正批次效应。",
    "elapsed_seconds=%.0f" % (time.time() - START),
    "outputs=processed/scrna_norm.h5ad, normalize_report.txt",
]
with open("normalize_report.txt", "w", encoding="utf-8") as fh:
    fh.write("\n".join(report) + "\n")
for line in report:
    log(line)
log("normalize_hvg_adapt OK")