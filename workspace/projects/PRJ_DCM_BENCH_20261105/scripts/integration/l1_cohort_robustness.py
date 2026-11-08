#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""l1_cohort_robustness：L1 队列混杂的本地复核，产出贯通用的 hub 候选表。

为什么单独做这一步：母版 deg_limma 的 design 是 ~0+group，不含任何队列/性别协变量。
本数据集 DCM 58 例（室间隔活检，新测）与 Ctrl 12 例（历史 GSE11625 重对齐）来自不同队列，
实测 27% 的基因在其中一组里 >=95% 样本表达为 0（检测/注释差异），Top 差异基因被这批
假信号占据，LOOCV AUC 因此达到 1.000（模型在分队列，不是在分疾病）。

本脚本做三件事（全部可复现，不引入外部数据）：
  1. 标注三类基因：单侧沉默型（队列假信号）、技术/非编码（克隆号/RNA 类/线粒体编码）、低检出；
  2. 用 OLS 复核 group 效应，**把性别作为协变量**（y ~ 1 + is_DCM + is_male，逐基因），
     BH 校正。注意：这是 OLS 近似，不含 limma 的经验贝叶斯与 trend，只作稳健性复核，
     报告与产物里都标注 method=OLS_sex_adjusted，不冒充 limma；
  3. 与 WGCNA hub、PPI hub 取交集，给出**过滤后的 hub 候选表**与 Top5，供 L2/L3 贯通使用。
"""
import os
import sys
import numpy as np
import pandas as pd
from scipy import stats

BASE = os.environ.get("L1_PROCESSED", "local_projects/PRJ_DCM_BENCH_20261105/data/line1_bulk/processed")
OUT = os.environ.get("OUT_DIR", "local_projects/PRJ_DCM_BENCH_20261105/results/line1_bulk")
os.makedirs(OUT, exist_ok=True)

FDR = 0.05
LFC_MIN = 1.0
MIN_DETECT = 0.20
SILENT_FRAC = 0.95

expr = pd.read_csv(os.path.join(BASE, "expr_genes.tsv"), sep="\t", index_col=0)
gmap = pd.read_csv(os.path.join(BASE, "group_map.tsv"), sep="\t")
groups = dict(zip(gmap["sample"], gmap["group"]))
cases = [s for s in expr.columns if groups.get(s) == "DCM"]
ctrls = [s for s in expr.columns if groups.get(s) == "Ctrl"]
if not cases or not ctrls:
    sys.exit("分组解析失败: DCM=%d Ctrl=%d" % (len(cases), len(ctrls)))
V = expr.astype(np.float32)

# --- 1. 性别：Y 基因均值推断（与之前审计同口径），记录供复核 ---
Y = [g for g in ("RPS4Y1", "DDX3Y", "EIF1AY", "KDM5D", "UTY") if g in V.index]
y_score = V.loc[Y].mean(axis=0)
is_male = (y_score > 2.5).astype(float)
sex_tab = pd.DataFrame({"sample": V.columns, "group": [groups.get(s) for s in V.columns],
                       "y_score": y_score.round(4).values, "is_male": is_male.astype(int).values})
sex_tab.to_csv(os.path.join(OUT, "inferred_sex_ols.tsv"), sep="\t", index=False)

# --- 2. 三类假信号标注 ---
zc = (V[cases] == 0).mean(axis=1)
zk = (V[ctrls] == 0).mean(axis=1)
silent = (zc >= SILENT_FRAC) | (zk >= SILENT_FRAC)
import re
CLONE = re.compile(r"^(AL|AC|AP|LINC|CTD|CTAG|RP11|RNA5|Y_RNA$|RN7SL|RF\d)")
tech = pd.Series([bool(CLONE.match(g)) or g.startswith("MT-") for g in V.index], index=V.index)
detect_case = (V[cases] > 0).mean(axis=1)
detect_ctrl = (V[ctrls] > 0).mean(axis=1)
low_detect = (detect_case < MIN_DETECT) & (detect_ctrl < MIN_DETECT)

# --- 3. OLS 逐基因：y ~ 1 + is_DCM + is_male（矩阵化，避免逐基因循环开销）---
is_case = np.array([1.0 if groups.get(s) == "DCM" else 0.0 for s in V.columns])
male = is_male.reindex(V.columns).to_numpy(dtype=float)   # 按样本名对齐，别用位置索引
X = np.column_stack([np.ones(len(V.columns)), is_case, male])
XtX_inv = np.linalg.pinv(X.T @ X)
Y = V.to_numpy(dtype=np.float64).T           # samples x genes
beta = XtX_inv @ (X.T @ Y)                    # 3 x genes
resid = Y - X @ beta
dof = Y.shape[0] - X.shape[1]
sigma2 = (resid ** 2).sum(axis=0) / dof
se = np.sqrt(np.maximum(sigma2, 1e-30) * XtX_inv[1, 1])
tstat = beta[1] / np.where(se > 0, se, np.nan)
pvals = 2 * stats.t.sf(np.abs(tstat), dof)
order = np.argsort(pvals)
ranked = np.empty_like(pvals)
ranked[order] = np.arange(1, len(pvals) + 1)
padj = np.minimum.accumulate((pvals[order] * len(pvals) / np.arange(1, len(pvals) + 1))[::-1])[::-1]
padj_full = np.empty_like(padj)
padj_full[order] = padj

res = pd.DataFrame({
    "gene": V.index,
    "log2FC_ols": beta[1].round(6),
    "p_ols": pvals,
    "adj_p_ols": np.minimum(padj_full, 1.0),
    "detect_case": detect_case.round(4).values,
    "detect_ctrl": detect_ctrl.round(4).values,
    "silent_one_side": silent.values,
    "tech_or_noncoding": tech.values,
    "low_detection": low_detect.values,
})
res["sig_ols"] = (res["adj_p_ols"] < FDR) & (res["log2FC_ols"].abs() > LFC_MIN)
res["usable"] = res["sig_ols"] & ~res["silent_one_side"] & ~res["tech_or_noncoding"] & ~res["low_detection"]
res.sort_values("adj_p_ols").to_csv(os.path.join(OUT, "l1_ols_sex_adjusted.tsv"), sep="\t", index=False)

# --- 4. 与 WGCNA hub / PPI hub 交集，给贯通用 hub 表 ---
def load_first_col(path):
    if not os.path.isfile(path):
        return set()
    df = pd.read_csv(path, sep="\t")
    return set(df.iloc[:, 0].astype(str))

wgcna_hub = load_first_col(os.path.join(BASE, "wgcna_hub_genes.tsv"))
ppi_hub = load_first_col(os.path.join(BASE, "ppi_hubs.tsv"))
usable = res[res["usable"]].sort_values("adj_p_ols")
usable["in_wgcna_hub"] = usable["gene"].isin(wgcna_hub)
usable["in_ppi_hub"] = usable["gene"].isin(ppi_hub)
usable.to_csv(os.path.join(OUT, "l1_usable_deg.tsv"), sep="\t", index=False)

hub = usable[usable["in_wgcna_hub"] | usable["in_ppi_hub"]].copy()
hub["support"] = hub["in_wgcna_hub"].astype(int) + hub["in_ppi_hub"].astype(int)
hub = hub.sort_values(["support", "adj_p_ols"], ascending=[False, True])
hub.head(50).to_csv(os.path.join(OUT, "l1_hub_candidates.tsv"), sep="\t", index=False)
top5 = hub.head(5)["gene"].tolist()
with open(os.path.join(OUT, "l1_hub_top5.txt"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(top5) + "\n")

report = [
    "step=l1_cohort_robustness",
    "input=%s" % os.path.join(BASE, "expr_genes.tsv"),
    "samples=%d（DCM %d / Ctrl %d）genes=%d" % (V.shape[1], len(cases), len(ctrls), V.shape[0]),
    "sex_inferred=%s" % sex_tab.groupby(["group", "is_male"]).size().to_dict(),
    "silent_one_side=%d tech_or_noncoding=%d low_detection=%d" % (int(silent.sum()), int(tech.sum()), int(low_detect.sum())),
    "method=OLS（y ~ 1 + is_DCM + is_male，逐基因，BH 校正）；这是 limma 的稳健性复核，不含经验贝叶斯与 trend",
    "criteria=adj_p<%.2f & |log2FC|>%.1f & 非单侧沉默 & 非技术/非编码 & 检出率>=%.0f%%" % (FDR, LFC_MIN, MIN_DETECT * 100),
    "sig_ols=%d usable_after_filters=%d" % (int(res["sig_ols"].sum()), int(res["usable"].sum())),
    "wgcna_hub=%d ppi_hub=%d hub_candidates=%d" % (len(wgcna_hub), len(ppi_hub), len(hub)),
    "top5_hub=%s" % ",".join(top5),
    "outputs=l1_ols_sex_adjusted.tsv, l1_usable_deg.tsv, l1_hub_candidates.tsv, l1_hub_top5.txt, inferred_sex_ols.tsv",
]
with open(os.path.join(OUT, "l1_cohort_robustness_report.txt"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(report) + "\n")
print("\n".join(report))