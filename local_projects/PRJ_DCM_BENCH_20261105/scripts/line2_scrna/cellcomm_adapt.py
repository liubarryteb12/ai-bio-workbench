#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""cellcomm_adapt：LIANA 细胞通讯（心脏类对），替代旧母版 cell_communication。

与母版的差异只有两处（其余口径逐项继承）：
- 输入标签用 annotate_cardiac 的 obs['celltype']（心脏 11 大类），
  不依赖上一研究的皮肤标签与任何作者注释；
- 报告里 priority 对（fibroblast<->cardiomyocyte）单独列出。

常量与母版一致（写死）：N_PERMS=1000、EXPR_PROP=0.1、MIN_CELLS=5、
COVERAGE_MIN=0.5、HVG_GENE_LIMIT=2000、TOP_N=20；rank_aggregate + consensus。
输入契约：annotated 提供 obs['celltype']+uns['annotation']；norm 提供
layers['counts'] 与全基因矩阵（基因数 > 2000，防喂 HVG 裁剪矩阵）。

产物：cellcomm_interactions.tsv、scrna_cellcomm.h5ad、cellcomm_report.txt。
"""
import os
import sys
import time

import numpy as np
import pandas as pd
import anndata as ad
import scanpy as sc
import liana as li

ad.settings.allow_write_nullable_strings = False

START = time.time()
N_PERMS = 1000
EXPR_PROP = 0.1
MIN_CELLS = 5
COVERAGE_MIN = 0.5
HVG_GENE_LIMIT = 2000
TOP_N = 20
PRIORITY_PAIRS = [("fibroblast", "cardiomyocyte"), ("cardiomyocyte", "fibroblast")]


def fail(msg):
    sys.stderr.write("cellcomm_adapt 自校验失败: %s\n" % msg)
    sys.stderr.flush()
    sys.exit(1)


def log(msg):
    print(msg, flush=True)


annotated_file = os.environ["ANNOTATED_FILE"]
norm_file = os.environ["NORM_FILE"]
seed = os.environ["BIOANALYS_SEED"]
try:
    seed_int = int(seed)
except ValueError:
    fail("BIOANALYS_SEED 不是整数: %s" % seed)

annot = ad.read_h5ad(annotated_file)
norm = ad.read_h5ad(norm_file)
log("loaded annotated=%s norm=%s" % (annot.shape, norm.shape))

if "celltype" not in annot.obs.columns:
    fail("annotated 缺 obs['celltype']（不是 annotate_cardiac 产物？）")
if "annotation" not in annot.uns:
    fail("annotated 缺 uns['annotation']")
if "counts" not in norm.layers:
    fail("norm 缺 layers['counts']（不是 normalize_hvg 产物？）")
if norm.shape[1] <= HVG_GENE_LIMIT:
    fail("norm 基因数 %d <= %d：疑似喂了 HVG 裁剪矩阵，consensus LR 覆盖率会崩"
         % (norm.shape[1], HVG_GENE_LIMIT))
if set(annot.obs_names) != set(norm.obs_names):
    fail("annotated 与 norm 细胞集合不一致（%d vs %d）" % (len(set(annot.obs_names)), len(set(norm.obs_names))))

labels = annot.obs["celltype"].astype(str)
aligned = labels.reindex(norm.obs_names)
if aligned.isna().any():
    fail("按索引对齐后存在无标签细胞 %d 个" % int(aligned.isna().sum()))

adata = norm
adata.obs["celltype"] = aligned
celltype_counts = adata.obs["celltype"].value_counts()
celltypes = sorted(celltype_counts.index)
log("celltypes=%d cells=%d" % (len(celltypes), adata.shape[0]))

# liana 用 var_names 匹配 LR 资源（symbol 空间）；本链 var_names 是 Ensembl ID，
# 必须先换成 symbol 索引再跑。重复 symbol 保留首个 Ensembl（按 var 顺序）并计数留痕。
if "gene_symbol" not in adata.var.columns:
    fail("norm 缺 var['gene_symbol']：无法映射到 liana 的 symbol 空间")
sym_series = adata.var["gene_symbol"].astype(str)
duplicated = int(sym_series.duplicated().sum())
adata.var_names = pd.Index(sym_series.to_numpy(), unique=False)
log("var_names 切到 gene_symbol 空间（重复 symbol=%d，按 var 顺序保留首个 Ensembl 行）" % duplicated)

# 性能界：LIANA 的置换检验成本随细胞数线性增长。母版原型 4,587 细胞、n_perms=1000；
# 本数据 74,883 细胞直接跑是小时级，且在手机上会撞热节流。这里按 celltype x donor 分层
# 降采样到每 celltype <= MAX_CELLS_PER_CT（默认 500，与母版同量级），n_perms 保持 1000。
# 降采样只影响互作打分/置换，不影响 obs['celltype'] 标签本身（标签来自全量注释）。
MAX_CELLS_PER_CT = int(os.environ.get("BIO_LIANA_MAX_CELLS_PER_CT", "500"))
_rng = np.random.default_rng(seed_int)
_keep_idx = []
_sub_counts = {}
for _ct in sorted(adata.obs["celltype"].astype(str).unique()):
    _ct_mask = adata.obs["celltype"].astype(str).to_numpy() == _ct
    _donors = adata.obs.loc[_ct_mask, "donor"].astype(str).to_numpy()
    _idx_all = np.where(_ct_mask)[0]
    _n_take = min(MAX_CELLS_PER_CT, len(_idx_all))
    if _n_take >= len(_idx_all):
        _picked = _idx_all
    else:
        # 分层：每个供体至少按比例取，避免降采样把某供体整类抹掉
        _picked_list = []
        for _d in sorted(set(_donors)):
            _d_idx = _idx_all[_donors == _d]
            _share = max(1, int(round(_n_take * len(_d_idx) / len(_idx_all))))
            _share = min(_share, len(_d_idx))
            _picked_list.append(_rng.choice(_d_idx, size=_share, replace=False))
        _picked = np.concatenate(_picked_list)
        if len(_picked) > _n_take:
            _picked = _rng.choice(_picked, size=_n_take, replace=False)
    _sub_counts[_ct] = int(len(_picked))
    _keep_idx.append(_picked)
_keep_idx = np.sort(np.concatenate(_keep_idx))
cells_before = adata.n_obs
adata = adata[_keep_idx].copy()
log("liana subsample: %d -> %d cells（per celltype cap=%d，按供体分层；只影响互作打分）"
    % (cells_before, adata.n_obs, MAX_CELLS_PER_CT))
log("subsample_per_celltype=%s" % _sub_counts)

resource = li.resource.select_resource("consensus")
db_genes = set(resource["ligand"].astype(str)) | set(resource["receptor"].astype(str))
covered = db_genes & set(adata.var_names.astype(str))
coverage = len(covered) / len(db_genes)
log("consensus db_genes=%d covered=%d coverage=%.4f" % (len(db_genes), len(covered), coverage))
if coverage < COVERAGE_MIN:
    fail("LR 基因覆盖率 %.4f < %.2f" % (coverage, COVERAGE_MIN))

li.mt.rank_aggregate(adata, groupby="celltype", resource_name="consensus",
                     use_raw=False, n_perms=N_PERMS, seed=seed_int,
                     expr_prop=EXPR_PROP, min_cells=MIN_CELLS, verbose=False)
res = adata.uns["liana_res"].copy()
del adata.uns["liana_res"]
log("liana_res rows=%d" % res.shape[0])

if res.shape[0] == 0:
    fail("liana 结果为空")
if res["specificity_rank"].isna().any() or res["magnitude_rank"].isna().any():
    fail("rank 列存在 NaN")
if (res["lr_means"] < 0).any():
    fail("lr_means 存在负值")
pvals = res["cellphone_pvals"].dropna()
if len(pvals) and ((pvals < 0) | (pvals > 1)).any():
    fail("cellphone_pvals 超出 [0,1]")
if set(res["source"].unique()) != set(celltypes) or set(res["target"].unique()) != set(celltypes):
    fail("结果 source/target 与 celltype 分组不一致")

os.makedirs("results", exist_ok=True)
res.to_csv(os.path.join("results", "cellcomm_interactions.tsv"), sep="\t", index=False)

out = annot.copy()
out.uns["cell_communication"] = {
    "method": "liana_rank_aggregate_consensus",
    "resource": "consensus",
    "groupby": "celltype",
    "expr_prop": EXPR_PROP, "min_cells": MIN_CELLS, "n_perms": N_PERMS,
    "seed": seed_int, "aggregate_method": "rra", "de_method": "t-test",
    "expression_source": norm_file, "label_source": annotated_file,
}
out.write_h5ad("scrna_cellcomm.h5ad")

top_specificity = res.sort_values("specificity_rank").head(TOP_N).reset_index(drop=True)


def pair_rows(source, target):
    sub = res[(res["source"] == source) & (res["target"] == target)]
    return sub.sort_values("specificity_rank").head(5)


pair_lines = []
for s, t in PRIORITY_PAIRS:
    if s in celltypes and t in celltypes:
        rows = pair_rows(s, t)
        if len(rows) == 0:
            pair_lines.append("priority_pair=%s->%s 无通过 min_cells/expr_prop 的互作" % (s, t))
        for _, row in rows.iterrows():
            pair_lines.append("priority_pair=%s->%s %s->%s spec_rank=%.3f mag_rank=%.3f p=%.4g"
                              % (s, t, row["source_"], row["target_"],
                                 float(row["specificity_rank"]), float(row["magnitude_rank"]),
                                 float(row["cellphone_pvals"]) if pd.notna(row["cellphone_pvals"]) else float("nan")))
    else:
        pair_lines.append("priority_pair=%s->%s 跳过：注释结果里没有该细胞类型" % (s, t))

report = [
    "step=cellcomm_adapt",
    "seed=%s" % seed,
    "label_source=%s" % annotated_file,
    "expression_source=%s" % norm_file,
    "method=liana rank_aggregate resource=consensus n_perms=%d expr_prop=%.2f min_cells=%d "
    "aggregate=rra de_method=t-test（常量逐项继承母版，写死）" % (N_PERMS, EXPR_PROP, MIN_CELLS),
    "lr_coverage=%.4f（门槛 %.2f；表达矩阵取 norm 全基因，HVG 裁剪矩阵覆盖率会崩）" % (coverage, COVERAGE_MIN),
    "var_names_space=gene_symbol（liana 资源按 symbol 匹配；本链 var_names 是 Ensembl，适配层切换；重复 symbol=%d 保留首个）" % duplicated,
    "celltype_counts=%s" % celltype_counts.to_dict(),
    "subsample=%s（性能界：置换检验成本随细胞数线性涨；按供体分层，每 celltype <= %d；"
    "只影响互作打分，不影响 obs['celltype'] 标签）"
    % ({str(k): int(v) for k, v in _sub_counts.items()}, MAX_CELLS_PER_CT),
    "cells_scored=%d（降采样后参与 liana 的细胞数；全量 %d）" % (adata.n_obs, cells_before),
    "interactions_rows=%d" % res.shape[0],
    "top%d_by_specificity=%s" % (TOP_N, [
        "%s->%s:%s/%s" % (r["source"], r["target"], r["source_"], r["target_"])
        for _, r in top_specificity.iterrows()]),
    "priority_fibroblast_cardiomyocyte_begin",
    *pair_lines,
    "priority_fibroblast_cardiomyocyte_end",
    "limitation_note=细胞类型标签来自 marker 自动打分（未经人工核验），标签错分会直接错置配体-受体对；"
    "snRNA-seq 测核内转录本，分泌程序基因检测功率低于细胞质 scRNA，LR 表达判定偏保守；"
    "Fetal 细胞作为独立 source/target 参与全对计算，但不做疾病对比。",
    "elapsed_seconds=%.0f" % (time.time() - START),
    "outputs=results/cellcomm_interactions.tsv, scrna_cellcomm.h5ad, cellcomm_report.txt",
]
with open("cellcomm_report.txt", "w", encoding="utf-8") as fh:
    fh.write("\n".join(report) + "\n")
for line in report:
    log(line)
log("cellcomm_adapt OK")
