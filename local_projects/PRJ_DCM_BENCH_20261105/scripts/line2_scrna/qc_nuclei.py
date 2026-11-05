#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qc_nuclei：GSE185100 心脏 snRNA-seq（10x）专用 QC。

为什么不用旧母版 qc_cells：其阈值（nCount>50000、nFeature>1500、ERCC<0.15）
是 Smart-seq2 全细胞 + ERCC spike-in 口径，对 10x 细胞核完全不适配
（snRNA-seq 典型 nGene 数百到数千、无 spike-in）。本脚本阈值针对核悬液重写，
但输出契约严格对齐 qc_cells 产物：旧链 normalize_hvg 的输入校验
（obs 8 列 + var['ercc'] + uns['qc_thresholds']/['qc_doublet_disposition'] +
无 doublet + 整数 X）必须原样满足。

阈值（写死在顶部，固定不随结果调整）：
- nFeature_by_bars（检出基因数，按 symbol 去重前的 Ensembl 列计）∈ [200, 6000]；
- pct_counts_mt < 20（MT- 前缀基因计数占比；snRNA 含核内残余线粒体转录本，阈值比
  scRNA 常规 10% 宽松，写此口径并记录理由）；
- pct_ribos（RPL/RPS）仅报告不参与过滤（核内新生转录本占比高，过滤会误杀）；
- doublet：默认不做（scrublet 在 8GB 手机上对 ~8.7 万细胞 x 3 万基因过慢），
  BIO_QC_SCRUBLET=1 时启用；未启用时报告如实写"未做 doublet 检出"，
  obs['class'] 保持 singlet，保证 normalize_hvg 的"无 doublet"校验成立。
基因过滤：保留细胞中表达细胞数 >= 3（沿用旧链口径）。

产物：processed/scrna_qc.h5ad、processed/qc_cell_metrics.tsv、qc_report.txt。
"""
import os
import sys
import time

import numpy as np
import pandas as pd
import anndata as ad
import scipy.sparse as sp

ad.settings.allow_write_nullable_strings = False

START = time.time()


def fail(message):
    sys.stderr.write("qc_nuclei 自校验失败: %s\n" % message)
    sys.stderr.flush()
    sys.exit(1)


def log(message):
    print(message, flush=True)


# --- 常量（阈值真源，全部回写报告）---
NFEATURE_MIN = 200        # 闭区间下界
NFEATURE_MAX = 6000       # 闭区间上界
PCT_MITO_MAX = 20.0       # 百分数，严格小于
GENE_MIN_CELLS = 3        # 基因过滤沿用旧链
SCRUBLET_ON = os.environ.get("BIO_QC_SCRUBLET", "0").strip() == "1"

h5ad_file = os.environ["H5AD_FILE"]
seed = int(os.environ["BIOANALYS_SEED"])

adata = ad.read_h5ad(h5ad_file)
log("loaded cells=%d genes=%d" % adata.shape)

# --- 1. 输入契约：必须是 ingest_10x 产物 ---
required_obs = ["sample_title", "donor", "diagnosis", "region", "group", "class",
                "plate", "well", "ncount_computed", "nfeature_computed",
                "ercc_fraction_computed", "celltype_paper", "seurat_cluster_paper"]
missing = [c for c in required_obs if c not in adata.obs.columns]
if missing:
    fail("输入 h5ad 缺少 obs 列 %s（不是 ingest_10x 产物？）" % missing)
if "ercc" not in adata.var.columns or "gene_symbol" not in adata.var.columns:
    fail("输入 h5ad 缺少 var['ercc'] / var['gene_symbol']")
for key in ["region_to_group", "seed", "source_counts_tar", "source_gpl_soft", "grouping_check"]:
    if key not in adata.uns:
        fail("输入 h5ad 缺少 uns['%s']" % key)
X = adata.X.tocsr()
if not sp.issparse(X):
    fail("输入 X 不是稀疏矩阵（禁止稠密化 33939 x 细胞）")
if not np.issubdtype(X.dtype, np.integer):
    fail("输入 X dtype 非整数")

# 前缀判定走 pandas 字符串访问器：var 列经 astype(str).to_numpy() 是 object dtype，
# np.char.startswith 在 object 数组上没有对应 ufunc loop（k40 实测 TypeError），
# 而 pandas .str.startswith 对 object 数组始终可用。
symbols = adata.var["gene_symbol"].astype(str)
mt_mask = symbols.str.startswith("MT-").to_numpy()
ribbo_mask = (symbols.str.startswith("RPL") | symbols.str.startswith("RPS")).to_numpy()
ercc_mask = adata.var["ercc"].to_numpy(dtype=bool)
log("flag_genes mt=%d ribosomal=%d ercc=%d" % (mt_mask.sum(), ribbo_mask.sum(), ercc_mask.sum()))
if mt_mask.sum() == 0:
    fail("没有 MT- 前缀基因：symbol 列口径异常，pct_mito 无从计算")

# --- 2. 每细胞指标（矩阵重算，稀疏行运算，不稠密化）---
n_counts = np.asarray(X.sum(axis=1)).ravel().astype(np.int64)
n_genes_by = np.asarray((X > 0).sum(axis=1)).ravel().astype(np.int64)
mt_counts = np.asarray(X[:, mt_mask].sum(axis=1)).ravel().astype(np.int64)
ribbo_counts = np.asarray(X[:, ribbo_mask].sum(axis=1)).ravel().astype(np.int64)
with np.errstate(divide="ignore", invalid="ignore"):
    pct_mt = np.where(n_counts > 0, 100.0 * mt_counts / np.maximum(n_counts, 1), 0.0)
    pct_rib = np.where(n_counts > 0, 100.0 * ribbo_counts / np.maximum(n_counts, 1), 0.0)

# 与 ingest 的 computed 列对账（ercc 恒 0，所以直接相等）
if not np.array_equal(n_counts, adata.obs["ncount_computed"].to_numpy(dtype=np.int64)):
    fail("ncount 口径不一致：矩阵重算 != ingest ncount_computed")
if not np.array_equal(n_genes_by, adata.obs["nfeature_computed"].to_numpy(dtype=np.int64)):
    fail("nfeature 口径不一致")

# --- 3. doublet ---
is_doublet = np.zeros(adata.shape[0], dtype=bool)
scrublet_note = "未做 doublet 检出（BIO_QC_SCRUBLET 未开启；手机上 scrublet 对该规模过慢），class 全部保持 singlet"
if SCRUBLET_ON:
    try:
        import scrublet as scr
        for sample in adata.obs["sample_title"].unique():
            idx = np.where((adata.obs["sample_title"] == sample).to_numpy())[0]
            if len(idx) < 100:
                continue
            # 逐样本切片后再转 float64：整矩阵 astype 会一次性驻留双份 nnz（手机内存护栏）
            so = scr.Scrublet(X[idx].astype(np.float64))
            scores, predicted = so.scrublet_scores()
            is_doublet[idx] = predicted.astype(bool)
        scrublet_note = ("scrublet 逐样本检出 doublet=%d（阈值用 scrublet 默认自动口径）；"
                         "被标 doublet 的细胞 class 改写为 doublet 并排除出主矩阵" % int(is_doublet.sum()))
        cls = adata.obs["class"].astype(str).to_numpy()
        cls[is_doublet] = "doublet"
        adata.obs["class"] = cls
        log("scrublet doublets=%d" % is_doublet.sum())
    except ImportError:
        fail("BIO_QC_SCRUBLET=1 但容器无 scrublet 包：不许静默降级为未检测，"
             "要么装包要么关掉开关（诚实原则：报告与实现必须一致）")
else:
    log(scrublet_note)

# --- 4. 阈值判定（闭区间；mito 严格小于）---
fail_ngene_low = n_genes_by < NFEATURE_MIN
fail_ngene_high = n_genes_by > NFEATURE_MAX
fail_mito = pct_mt >= PCT_MITO_MAX
qc_pass = ~(fail_ngene_low | fail_ngene_high | fail_mito)
kept = qc_pass & ~is_doublet
log("fail_ngene_low=%d fail_ngene_high=%d fail_mito=%d qc_pass=%d doublet=%d kept=%d"
    % (fail_ngene_low.sum(), fail_ngene_high.sum(), fail_mito.sum(), qc_pass.sum(),
       is_doublet.sum(), kept.sum()))


def reason_of(i):
    parts = []
    if is_doublet[i]:
        parts.append("doublet")
    if fail_ngene_low[i]:
        parts.append("nfeature<%d" % NFEATURE_MIN)
    if fail_ngene_high[i]:
        parts.append("nfeature>%d" % NFEATURE_MAX)
    if fail_mito[i]:
        parts.append("pct_mt>=%.0f" % PCT_MITO_MAX)
    return "+".join(parts)


fail_reasons = [reason_of(i) for i in range(adata.shape[0])]

# --- 5. 基因过滤（在保留细胞上算）---
gene_ncells = np.asarray((X[kept] > 0).sum(axis=0)).ravel()
gene_keep = gene_ncells >= GENE_MIN_CELLS

# --- 6. 自校验 ---
if kept.sum() == 0:
    fail("QC 后无细胞保留")
if gene_keep.sum() == 0:
    fail("QC 后无基因保留")
for col in ["group", "donor"]:
    for value in adata.obs[col].unique():
        sel = (adata.obs[col] == value).to_numpy()
        if int((sel & kept).sum()) == 0:
            fail("%s=%s 的细胞被全部滤掉（%d 个），不允许静默清空分组" % (col, value, int(sel.sum())))
kept_matrix = X[kept][:, gene_keep]
if kept_matrix.data.size and kept_matrix.data.min() < 0:
    fail("输出矩阵存在负计数")

# --- 7. 落盘 ---
os.makedirs("processed", exist_ok=True)
out = adata[kept][:, gene_keep].copy()
outX = out.X  # 已按 kept x gene_keep 切片，不再从全矩阵重切第二份（手机内存护栏）
if not np.issubdtype(outX.dtype, np.integer):
    fail("切片后 X dtype 非整数")
out.obs["n_counts"] = np.asarray(outX.sum(axis=1)).ravel().astype(np.int64)
out.obs["n_genes_by_counts"] = np.asarray((outX > 0).sum(axis=1)).ravel().astype(np.int64)
out.obs["pct_counts_mt"] = 100.0 * np.asarray(outX[:, mt_mask[gene_keep]].sum(axis=1)).ravel() / np.maximum(out.obs["n_counts"].to_numpy(), 1)
out.obs["pct_counts_ribosomal"] = 100.0 * np.asarray(outX[:, ribbo_mask[gene_keep]].sum(axis=1)).ravel() / np.maximum(out.obs["n_counts"].to_numpy(), 1)
out.obs["qc_pass"] = np.ones(out.shape[0], dtype=bool)
# 基因过滤后按保留矩阵重算 computed 列（保持与矩阵逐字节一致的口径，下游对账不吃亏）
out.obs["ncount_computed"] = out.obs["n_counts"]
out.obs["nfeature_computed"] = out.obs["n_genes_by_counts"]
out.var["n_cells_expressing"] = gene_ncells[gene_keep]

out.uns["qc_thresholds"] = {
    "nfeature_min": NFEATURE_MIN, "nfeature_max": NFEATURE_MAX,
    "pct_mito_max": PCT_MITO_MAX, "gene_min_cells": GENE_MIN_CELLS,
    "basis": "snRNA-seq 10x 核悬液口径（非旧链 Smart-seq2+ERCC），固定不随结果调整",
}
out.uns["qc_doublet_disposition"] = "none_detected_scrublet_off" if not SCRUBLET_ON else "excluded_from_main_matrix"
out.uns["qc_source_h5ad"] = h5ad_file
out.uns["seed"] = seed
out.write_h5ad(os.path.join("processed", "scrna_qc.h5ad"))

metrics = pd.DataFrame({
    "cell_id": adata.obs_names.to_numpy(),
    "sample_title": adata.obs["sample_title"].to_numpy(),
    "donor": adata.obs["donor"].to_numpy(),
    "diagnosis": adata.obs["diagnosis"].to_numpy(),
    "group": adata.obs["group"].to_numpy(),
    "class": adata.obs["class"].astype(str).to_numpy(),
    "n_counts": n_counts, "n_genes_by_counts": n_genes_by,
    "pct_counts_mt": np.round(pct_mt, 4), "pct_counts_ribosomal": np.round(pct_rib, 4),
    "fail_ngene_low": fail_ngene_low, "fail_ngene_high": fail_ngene_high,
    "fail_mito": fail_mito, "qc_pass": qc_pass, "is_doublet": is_doublet,
    "kept": kept, "fail_reason": fail_reasons,
})
metrics.to_csv(os.path.join("processed", "qc_cell_metrics.tsv"), sep="\t", index=False)

per_sample = []
for sample, g in metrics.groupby("sample_title", sort=True):
    per_sample.append("sample=%s total=%d kept=%d removed=%d (low=%d high=%d mito=%d doublet=%d)" % (
        sample, len(g), int(g["kept"].sum()), int((~g["kept"]).sum()),
        int(g["fail_ngene_low"].sum()), int(g["fail_ngene_high"].sum()),
        int(g["fail_mito"].sum()), int(g["is_doublet"].sum())))

report = [
    "step=qc_nuclei",
    "seed=%d" % seed,
    "input_h5ad=%s" % h5ad_file,
    "cells_in=%d cells_kept=%d cells_removed=%d" % (adata.shape[0], int(kept.sum()), int((~kept).sum())),
    "genes_in=%d genes_kept=%d" % (adata.shape[1], int(gene_keep.sum())),
    "thresholds=nfeature in [%d, %d], pct_counts_mt < %.1f, gene_min_cells=%d（snRNA 核悬液口径，写死）"
    % (NFEATURE_MIN, NFEATURE_MAX, PCT_MITO_MAX, GENE_MIN_CELLS),
    "ribosomal=仅报告不过滤（核内新生转录本占比高，过滤会误杀真实核细胞）",
    "doublet=%s" % scrublet_note,
    "kept_group_counts=%s" % out.obs["group"].value_counts().to_dict(),
    "kept_donor_counts=%s" % out.obs["donor"].value_counts().to_dict(),
    "per_sample=%s" % " | ".join(per_sample),
    "median_pct_mt_kept=%.2f" % float(np.median(out.obs["pct_counts_mt"])),
    "median_nfeature_kept=%.0f" % float(np.median(out.obs["n_genes_by_counts"])),
    "self_check=输入契约/矩阵重算对账/保留非空/分组非空/无负值 OK",
    "contract_note=输出保留旧链 qc_cells 全部契约（obs 8+列/var ercc 全 False/uns qc_thresholds/"
    "qc_doublet_disposition/整数稀疏 X/无 doublet 行），normalize_hvg 起可原样复用旧母版",
    "limitation_note=未做作者注释比对（celltype_paper=NA）；pct_mito 阈值 20% 宽于 scRNA 常规 10%，"
    "理由是 snRNA-seq 核悬液携带线粒体外膜残余，收紧会系统性剔除高质量核；"
    "doublet 默认未检出，下游任何'去 doublet'表述均不成立。",
    "elapsed_seconds=%.0f" % (time.time() - START),
    "outputs=processed/scrna_qc.h5ad, processed/qc_cell_metrics.tsv, qc_report.txt",
]
with open("qc_report.txt", "w", encoding="utf-8") as fh:
    fh.write("\n".join(report) + "\n")
for line in report:
    log(line)
log("qc_nuclei OK")
