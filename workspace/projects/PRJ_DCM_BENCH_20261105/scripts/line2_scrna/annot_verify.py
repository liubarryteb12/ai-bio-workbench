#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""annot_verify：L2 细胞注释核验（Argon 第 38 轮 Q3 A+C）。

两件事：
  1. 10 类 x Canonical Marker 的表达比例与均值核验表（判断标签是否站得住）；
  2. 重点复核 schwann（心脏样本里 1,240 个、占 1.65%，偏高，易与心内膜/成纤维串味）。

内存纪律：走 h5_rows 行块读取，不整层加载。
"""
import os
import sys
import json

import numpy as np
import pandas as pd
import anndata as ad

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from h5_rows import read_csr_rows, read_var_column  # noqa: E402

BLOCK_ROWS = 2000

# 心脏各类型 canonical marker（文献常用，不来自本数据）
CANONICAL = {
    "cardiomyocyte": ["TNNT2", "MYH6", "MYH7", "NPPA", "ACTC1", "TTN"],
    "fibroblast": ["DCN", "LUM", "COL1A1", "COL1A2", "POSTN", "FBLN1"],
    "endothelial": ["PECAM1", "VWF", "CDH5", "EGFL7", "CLDN5"],
    "macrophage": ["CD68", "CD163", "MRC1", "C1QA", "LYZ"],
    "pericyte": ["RGS5", "KCNJ8", "ABCC9", "PDGFRB"],
    "smooth_muscle": ["MYH11", "ACTA2", "TAGLN", "CNN1"],
    "T_cell": ["CD3D", "CD3E", "IL7R", "LTB"],
    "B_cell": ["CD79A", "MS4A1", "CD19"],
    "schwann_nerve": ["PLP1", "MPZ", "S100B", "NRXN1", "MBP"],
    "unknown": [],
}


def fail(m):
    sys.stderr.write("annot_verify 失败: %s\n" % m)
    sys.stderr.flush()
    sys.exit(1)


def log(m):
    print(m, flush=True)


annotated = os.environ["ANNOTATED_FILE"]
norm_file = os.environ["NORM_FILE"]
out_dir = os.environ.get("OUT_DIR", "results")
sample_n = int(os.environ.get("VERIFY_SAMPLE_N", "200"))
seed = int(os.environ.get("BIOANALYS_SEED", "20261105"))

a = ad.read_h5ad(annotated, backed="r")
if "celltype" not in a.obs.columns:
    fail("annotated 缺 obs['celltype']")
labels = a.obs["celltype"].astype(str).to_numpy()
donors = a.obs["donor"].astype(str).to_numpy() if "donor" in a.obs.columns else np.array(["NA"] * len(labels))
celltypes = sorted(set(labels))
symbols = read_var_column(norm_file, "gene_symbol")
sym_upper = pd.Series(symbols).str.upper()
pos = {s: i for i, s in enumerate(sym_upper.tolist())}

needed = sorted({g for genes in CANONICAL.values() for g in genes})
missing = [g for g in needed if g not in pos]
log("canonical_markers=%d found=%d missing=%s" % (len(needed), len(needed) - len(missing), missing))
gene_idx = [pos[g] for g in needed if g in pos]
gene_names = [g for g in needed if g in pos]

# --- 1. 逐类累加：表达比例与均值 ---
n_cells_by = {c: 0 for c in celltypes}
expr_sum = {c: np.zeros(len(gene_names)) for c in celltypes}
expr_pos = {c: np.zeros(len(gene_names)) for c in celltypes}
n_obs = len(labels)
for start, stop in [(s, min(s + BLOCK_ROWS, n_obs)) for s in range(0, n_obs, BLOCK_ROWS)]:
    rows = np.arange(start, stop)
    Xb = read_csr_rows(norm_file, "X", rows)
    block_labels = labels[start:stop]
    for c in celltypes:
        m = block_labels == c
        if not m.any():
            continue
        sub = Xb[m][:, gene_idx]
        n_cells_by[c] += int(m.sum())
        expr_sum[c] += np.asarray(sub.sum(axis=0)).ravel()
        expr_pos[c] += np.asarray((sub > 0).sum(axis=0)).ravel()
    del Xb

rows_out = []
for c in celltypes:
    n = n_cells_by[c]
    for j, g in enumerate(gene_names):
        rows_out.append({
            "celltype": c,
            "gene_symbol": g,
            "is_canonical_for": ",".join([k for k, v in CANONICAL.items() if g in v]) or "",
            "n_cells": n,
            "pct_expressing": round(100.0 * expr_pos[c][j] / n, 3) if n else 0.0,
            "mean_expr": round(float(expr_sum[c][j] / n), 5) if n else 0.0,
        })
mat = pd.DataFrame(rows_out)
os.makedirs(out_dir, exist_ok=True)
mat.to_csv(os.path.join(out_dir, "annot_verify_matrix.tsv"), sep="\t", index=False)
log("wrote annot_verify_matrix.tsv rows=%d" % len(mat))

# --- 2. 靶向判据：每类自己的 marker 是否显著高于其他类 ---
# 判据先做一次「背景基因」筛除：长度极大或普遍高检出的基因（TTN 是 10 万 bp 级的 titin，
# 在平滑肌里也有 88% 检出）会把某一类的均值拉平，产生假阴性。做法是要求该基因在
# 自身类型内部的检出率至少比其它类型最高值高 20 个百分点，才算「有区分力的 marker」，
# 没达到的基因单独列进 weak_markers 如实报告，不静默丢弃也不拿它下结论。
pivot = mat.pivot(index="celltype", columns="gene_symbol", values="pct_expressing").fillna(0.0)
SELF_MARGIN = 20.0  # 百分点
self_hits, self_miss, weak_markers = [], [], []
for c, genes in CANONICAL.items():
    if c not in pivot.index or not genes:
        continue
    present = [g for g in genes if g in pivot.columns]
    if not present:
        continue
    usable = []
    for g in present:
        self_pct = float(pivot.loc[c, g])
        other_max = float(pivot.drop(index=c)[g].max()) if len(pivot) > 1 else 0.0
        # 绝对差值门槛在低检出基因上会误判：snRNA 测核内转录本，膜蛋白类 marker（CD68/CD3D）',
        # 整体检出率就低（自身 ~20%），与其它类型的差值是 18 个百分点，但相对富集高（9 倍）。',
        # 所以用「差值够大」或「自身是其它类型最高值的 2 倍以上且自身 >= 10%」两条之一。',
        ratio_ok = other_max > 0 and self_pct >= 2.0 * other_max and self_pct >= 10.0
        if (self_pct - other_max >= SELF_MARGIN) or ratio_ok:
            usable.append(g)
        else:
            weak_markers.append({"celltype": c, "gene_symbol": g,
                                 "self_pct": round(self_pct, 2),
                                 "max_other_pct": round(other_max, 2),
                                 "reason": "自身与其它类型检出率差距 < %.0f 个百分点，无区分力" % SELF_MARGIN})
    if not usable:
        self_miss.append((c, None, None, present))
        continue
    self_mean = float(pivot.loc[c, usable].mean())
    others = pivot.drop(index=c)[usable].mean(axis=0)
    top_other = float(others.max()) if len(others) else 0.0
    ok = self_mean > top_other
    (self_hits if ok else self_miss).append((c, round(self_mean, 2), round(top_other, 2), usable))

# --- 3. schwann 专项 ---
schwann_genes = [g for g in CANONICAL["schwann_nerve"] if g in pivot.columns]
schwann_detail = {}
if "schwann_nerve" in pivot.index and schwann_genes:
    for g in schwann_genes:
        schwann_detail[g] = {
            "schwann_pct": float(pivot.loc["schwann_nerve", g]),
            "max_other_pct": float(pivot.drop(index="schwann_nerve")[g].max()),
            "max_other_type": str(pivot.drop(index="schwann_nerve")[g].idxmax()),
        }

report = {
    "step": "annot_verify",
    "seed": seed,
    "annotated": os.path.abspath(annotated),
    "norm": os.path.abspath(norm_file),
    "n_cells_total": int(n_obs),
    "celltype_counts": {c: int(n_cells_by[c]) for c in celltypes},
    "canonical_markers_checked": len(gene_names),
    "canonical_markers_missing": missing,
    "self_marker_higher_than_others": [{"celltype": c, "self_mean_pct": m, "best_other_pct": o, "genes": g}
                                        for c, m, o, g in self_hits],
    "self_marker_lower_than_others": [{"celltype": c, "self_mean_pct": m, "best_other_pct": o, "genes": g}
                                      for c, m, o, g in self_miss],
    "markers_without_discrimination": weak_markers,
    "discrimination_margin_pct": SELF_MARGIN,
    "schwann_nerve_detail": schwann_detail,
    "verdict": "pass" if not self_miss else "review_needed",
}
with open(os.path.join(out_dir, "annot_verify_report.json"), "w", encoding="utf-8") as fh:
    json.dump(report, fh, ensure_ascii=False, indent=2)

log("celltypes_with_own_marker_highest=%d/%d" % (len(self_hits), len(self_hits) + len(self_miss)))
for c, m, o, g in self_miss:
    log("  REVIEW %s: self=%s best_other=%s genes=%s" % (c, m, o, g))
for w in weak_markers:
    log("  WEAK %s/%s: self=%.2f%% max_other=%.2f%%" % (w["celltype"], w["gene_symbol"],
                                                        w["self_pct"], w["max_other_pct"]))
log("schwann_detail=%s" % json.dumps(schwann_detail, ensure_ascii=False))
log("verdict=%s" % report["verdict"])