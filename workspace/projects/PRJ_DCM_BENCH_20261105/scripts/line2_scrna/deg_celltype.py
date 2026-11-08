#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""deg_celltype：逐细胞类型 DCM vs Ctrl 差异分析（适配 deg_groups 口径）。

输入：annotate_cardiac 产物 *annotated*.h5ad（obs['celltype']、layers['counts']）。
表达矩阵口径与母版一致：从 layers['counts'] 重算 normalize_total(1e4)+log1p
（不用 X：cluster_umap 之后 X 已是 scale z-score，log2fc 会 nan）。
检验：wilcoxon，reference=DCM，groups=[Ctrl]，BH 校正。显著判据 |log2fc|>1 且 adj p<0.05。

门槛（写死）：每个 celltype 要求 case(DCM) 与 ctrl(Ctrl) 各 >=20 细胞且各覆盖 >=2 donor，
否则跳过并记录原因（Fetal 细胞不参与两组比较，也不计入任何一组）。
priority=成纤维(fibroblast)与心肌(cardiomyocyte)优先出报告，其余类全跑，样本不足跳过并记录。

产物：results/deg_all_by_celltype.tsv、results/deg_significant_by_celltype.tsv、deg_report.txt。
"""
import os
import sys
import time

import numpy as np
import pandas as pd
import anndata as ad
import scanpy as sc

ad.settings.allow_write_nullable_strings = False

START = time.time()

MIN_CELLS_PER_GROUP = 20   # 母版同口径
MIN_DONORS_PER_GROUP = 2   # 本项目新增：单供体支撑的比较不算数
GROUP_A = "DCM"
GROUP_B = "Ctrl"
ALPHA = 0.05               # 显著性阈值（写死）
MIN_ABS_LOG2FC = 1.0       # 显著性阈值（写死）
PRIORITY = ["fibroblast", "cardiomyocyte"]


def fail(msg):
    sys.stderr.write("deg_celltype 自校验失败: %s\n" % msg)
    sys.stderr.flush()
    sys.exit(1)


def log(msg):
    print(msg, flush=True)


annotated_file = os.environ["DEG_INPUT"]
seed = int(os.environ["BIOANALYS_SEED"])

adata = ad.read_h5ad(annotated_file)
log("loaded cells=%d genes=%d" % adata.shape)

for col in ["celltype", "group", "donor", "diagnosis"]:
    if col not in adata.obs.columns:
        fail("输入 h5ad 缺少 obs['%s']（不是 annotate_cardiac 产物？）" % col)
if "counts" not in adata.layers:
    fail("缺少 layers['counts']（cluster_umap 之后母版链应保留该层）")

grp = adata.obs["group"].astype(str).to_numpy()
ct_arr = adata.obs["celltype"].astype(str).to_numpy()
donor_arr = adata.obs["donor"].astype(str).to_numpy()
if set(np.unique(grp)) < {GROUP_A, GROUP_B}:
    fail("obs['group'] 缺少 %s/%s 两组: %s" % (GROUP_A, GROUP_B, sorted(set(grp))))
fetal_cells = int((grp == "Fetal").sum())

work = adata.copy()
work.X = work.layers["counts"].copy()
sc.pp.normalize_total(work, target_sum=1e4)
sc.pp.log1p(work)

celltypes = sorted(set(ct_arr))
per_ct = {}
all_rows = []
sig_rows = []
for ct in celltypes:
    m_ct = ct_arr == ct
    n_a = int((m_ct & (grp == GROUP_A)).sum())
    n_b = int((m_ct & (grp == GROUP_B)).sum())
    d_a = len(set(donor_arr[m_ct & (grp == GROUP_A)]))
    d_b = len(set(donor_arr[m_ct & (grp == GROUP_B)]))
    meta = {"celltype": ct, "n_cells": int(m_ct.sum()), "n_case": n_a, "n_ctrl": n_b,
            "case_donors": d_a, "ctrl_donors": d_b}
    reasons = []
    if n_a < MIN_CELLS_PER_GROUP:
        reasons.append("case_cells<%d" % MIN_CELLS_PER_GROUP)
    if n_b < MIN_CELLS_PER_GROUP:
        reasons.append("ctrl_cells<%d" % MIN_CELLS_PER_GROUP)
    if d_a < MIN_DONORS_PER_GROUP:
        reasons.append("case_donors<%d" % MIN_DONORS_PER_GROUP)
    if d_b < MIN_DONORS_PER_GROUP:
        reasons.append("ctrl_donors<%d" % MIN_DONORS_PER_GROUP)
    if reasons:
        meta["status"] = "skipped:" + "+".join(reasons)
        per_ct[ct] = meta
        log("  [%s] 跳过 %s" % (ct, meta["status"]))
        continue
    sub = work[m_ct & ((grp == GROUP_A) | (grp == GROUP_B))].copy()
    meta["status"] = "ok"
    sc.tl.rank_genes_groups(sub, groupby="group", groups=[GROUP_B], reference=GROUP_A,
                            method="wilcoxon", corr_method="benjamini-hochberg",
                            n_genes=sub.n_vars, key_added="deg")
    names_b = sub.uns["deg"]["names"][GROUP_B]
    pvals = np.asarray(sub.uns["deg"]["pvals_adj"][GROUP_B], dtype=float)
    praw = np.asarray(sub.uns["deg"]["pvals"][GROUP_B], dtype=float)
    logfc = np.asarray(sub.uns["deg"]["logfoldchanges"][GROUP_B], dtype=float)
    if not np.all(np.isfinite(pvals)):
        fail("%s pvals_adj 含非有限值" % ct)
    if (pvals < -1e-12).any() or (pvals > 1 + 1e-12).any():
        fail("%s pvals_adj 越界" % ct)
    var_names = sub.var_names.astype(str)
    gene_symbols = (sub.var["gene_symbol"].astype(str).to_numpy()
                    if "gene_symbol" in sub.var.columns else var_names)
    n_sig = int(((pvals < ALPHA) & (np.abs(logfc) > MIN_ABS_LOG2FC)).sum())
    meta["n_genes_tested"] = int(sub.n_vars)
    meta["n_sig"] = n_sig
    per_ct[ct] = meta
    log("  [%s] cells=%d（%s %d / %s %d）显著 %d/%d"
        % (ct, sub.n_obs, GROUP_A, n_a, GROUP_B, n_b, n_sig, sub.n_vars))
    order = np.argsort(pvals, kind="mergesort")
    for rank, gi in enumerate(order, 1):
        p, l2 = float(pvals[gi]), float(logfc[gi])
        is_sig = bool(p < ALPHA and abs(l2) > MIN_ABS_LOG2FC)
        row = {"gene": str(gene_symbols[gi]), "ensembl_id": str(var_names[gi]),
               "celltype": ct, "rank": rank,
               "log2FC": round(l2, 6), "pvals": float(praw[gi]), "pvals_adj": p,
               "n_case": n_a, "n_ctrl": n_b,
               "case_donors": d_a, "ctrl_donors": d_b,
               "direction": ("up_in_%s" % GROUP_B) if l2 > 0 else ("up_in_%s" % GROUP_A),
               "significant": is_sig}
        all_rows.append(row)
        if is_sig:
            sig_rows.append(row)

if not any(m["status"] == "ok" for m in per_ct.values()):
    fail("没有任何 celltype 通过门槛（%s vs %s）" % (GROUP_A, GROUP_B))

os.makedirs("results", exist_ok=True)
cols = ["gene", "celltype", "log2FC", "pvals", "pvals_adj", "n_case", "n_ctrl",
        "case_donors", "ctrl_donors", "rank", "direction", "significant", "ensembl_id"]
pd.DataFrame(all_rows, columns=cols).to_csv(
    os.path.join("results", "deg_all_by_celltype.tsv"), sep="\t", index=False)
df_sig = pd.DataFrame(sig_rows, columns=cols)
if len(df_sig):
    df_sig = df_sig.sort_values(["celltype", "pvals_adj"])
df_sig.to_csv(os.path.join("results", "deg_significant_by_celltype.tsv"), sep="\t", index=False)

lines = []
for ct in celltypes:
    m = per_ct[ct]
    tag = "PRIORITY " if ct in PRIORITY else ""
    if m["status"] == "ok":
        lines.append("%s%s: ok cells_case=%d cells_ctrl=%d donors_case=%d donors_ctrl=%d sig=%d/%d"
                     % (tag, ct, m["n_case"], m["n_ctrl"], m["case_donors"], m["ctrl_donors"],
                        m["n_sig"], m["n_genes_tested"]))
    else:
        lines.append("%s%s: %s (cells_case=%d cells_ctrl=%d donors_case=%d donors_ctrl=%d)"
                     % (tag, ct, m["status"], m["n_case"], m["n_ctrl"],
                        m["case_donors"], m["ctrl_donors"]))

report = [
    "step=deg_celltype",
    "seed=%d" % seed,
    "input_annotated=%s" % annotated_file,
    "design=%s vs %s；Fetal %d 细胞不参与两组比较" % (GROUP_A, GROUP_B, fetal_cells),
    "method=逐 celltype wilcoxon（reference=%s，groups=[%s]）+ BH；表达矩阵从 layers['counts'] "
    "重算 normalize_total(1e4)+log1p（复现步骤 3 口径；X 已被 scale 不能用）" % (GROUP_A, GROUP_B),
    "thresholds=每类 case/ctrl 各 >=%d 细胞且各 >=%d donor；显著 |log2FC|>%g & adj p<%g（全部写死，不随结果调整）"
    % (MIN_CELLS_PER_GROUP, MIN_DONORS_PER_GROUP, MIN_ABS_LOG2FC, ALPHA),
    "priority=%s（用户指定优先出报告的类，其余全跑）" % PRIORITY,
    "celltypes_total=%d ok=%d skipped=%d" % (
        len(celltypes), sum(1 for m in per_ct.values() if m["status"] == "ok"),
        sum(1 for m in per_ct.values() if m["status"] != "ok")),
    "sig_genes_total=%d" % len(sig_rows),
    "per_celltype_begin",
    *lines,
    "per_celltype_end",
    "limitation_note=供体数 DCM 4 vs Ctrl 3，细胞级 wilcoxon p 值把同一供体的多个细胞当独立样本，"
    "不等同供体级显著性（伪重复风险）；BH 校正只在单 celltype 内做，跨类不校正；"
    "注释来自 marker 自动打分未经人工核验，细胞类型错分会把差异带进对应类。",
    "elapsed_seconds=%.0f" % (time.time() - START),
    "outputs=results/deg_all_by_celltype.tsv, results/deg_significant_by_celltype.tsv, deg_report.txt",
]
with open("deg_report.txt", "w", encoding="utf-8") as fh:
    fh.write("\n".join(report) + "\n")
for line in report:
    log(line)
log("deg_celltype OK")
