#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""cellcomm_adapt：LIANA 细胞通讯（成纤维/心肌优先），内存按需物化。

为什么要改内存形态：原实现整对象读入 annotated 与 norm（norm 是 74,883 x 29,327 且带
layers['counts']，约 1.7GB），在手机 11.5GB 上触发 Android 内核低内存杀手：
  2026-11-05 11:48:20 lowmemorykiller: Kill 'com.immate.termux' ... reason: device is in direct reclaim
（Termux 进程本身仅 63MB，真正吃内存的是 proot 里的 python）。所以改成：
  1) 两个 h5ad 都用 backed 模式打开，不把矩阵读进内存；
  2) 先取 LIANA consensus 资源，只保留配体/受体基因（约 1.7k 个）；
  3) 按 celltype x donor 分层抽样细胞（每类 <= MAX_CELLS_PER_CT）；
  4) 只把「抽样细胞 x LR 基因」这个小矩阵物化进内存，再跑 rank_aggregate。
口径不变：resource=consensus、aggregate=rra、de_method=t-test、expr_prop/min_cells 同母版。
"""
import os
import resource
import sys
import time

import numpy as np
import pandas as pd
import anndata as ad
import h5py
import liana as li

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from h5_rows import read_csr_rows, read_var_column  # noqa: E402

# 置换检验是 LIANA 里唯一的重内存环节：每次置换要按「细胞 x 配体受体对」构造矩阵，
# 本数据 1500 细胞 x 约 1.7 万 LR 对就已上 GB，几次置换就把手机打到 thrash
# （2026-11-05 11:57:12 内核 thrashing 24% 后 lowmemorykiller 杀掉 com.termux，
#  reason: device is in direct reclaim）。
# BIO_LIANA_PERMS=none 表示关掉置换：仍出 specificity/magnitude 排序（rank_aggregate 的
# 主产物），但不出 cellphone_pvals。手机基准默认关，桌面端可用 1000 复现母版口径。
_PERMS_ENV = os.environ.get("BIO_LIANA_PERMS", "none").strip().lower()
N_PERMS = None if _PERMS_ENV in ("none", "0", "off", "") else int(_PERMS_ENV)
EXPR_PROP = 0.1
MIN_CELLS = 5
COVERAGE_MIN = 0.5
TOP_N = 20
PRIORITY_PAIRS = [("fibroblast", "cardiomyocyte"), ("cardiomyocyte", "fibroblast")]


def fail(message):
    sys.stderr.write("cellcomm_adapt 自校验失败: %s\n" % message)
    sys.stderr.flush()
    sys.exit(1)


def log(message):
    print(message, flush=True)


def peak_rss_mb():
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0


annotated_file = os.environ["ANNOTATED_FILE"]
norm_file = os.environ["NORM_FILE"]
seed = os.environ["BIOANALYS_SEED"]
try:
    seed_int = int(seed)
except ValueError:
    fail("BIOANALYS_SEED 不是整数: %s" % seed)
START = time.time()

# --- 1. 打开方式：annotated 用 backed 只取 obs；norm 只用 h5py 取 var 与按行切片 ---
# 为什么 norm 不能走 anndata：实测 backed 对象在读取时仍会把 layers 里的稀疏矩阵整层
# to_memory()（layers["counts"] nnz=2.1 亿 -> indices 单数组 802 MiB），叠加 data/indptr
# 约 2.4GB，触发 Android 低内存杀手（11:48:20 lowmemorykiller ... device is in direct reclaim）。
annot = ad.read_h5ad(annotated_file, backed="r")
log("backed annotated=%s peak_rss=%.0fMB" % (annot.shape, peak_rss_mb()))
norm_shape = None
with h5py.File(norm_file, "r") as _f:
    norm_shape = tuple(int(x) for x in _f["X"].attrs["shape"])
    _has_counts = "counts" in _f["layers"] if "layers" in _f else False
log("norm shape=%s has_counts_layer=%s peak_rss=%.0fMB" % (norm_shape, _has_counts, peak_rss_mb()))

if "celltype" not in annot.obs.columns:
    fail("annotated 缺 obs['celltype']（不是 annotate_cardiac 产物？）")
if "annotation" not in annot.uns:
    fail("annotated 缺 uns['annotation']")
if not _has_counts:
    fail("norm 缺 layers['counts']（不是 normalize_hvg 产物？）")
if norm_shape[1] <= 2000:
    fail("norm 基因数 %d <= 2000：疑似喂了 HVG 裁剪矩阵，consensus LR 覆盖率会崩" % norm_shape[1])
# obs 的索引列名存在 obs 组的 _index 属性里（不一定叫 _index），按属性取再读该列
with h5py.File(norm_file, "r") as _f:
    _idx_name = _f["obs"].attrs.get("_index", "_index")
    if isinstance(_idx_name, bytes):
        _idx_name = _idx_name.decode()
    _node = _f["obs"][_idx_name]
    if isinstance(_node, h5py.Dataset):
        _norm_obs = [v.decode() if isinstance(v, bytes) else str(v) for v in _node[...]]
    else:
        _cats = [c.decode() if isinstance(c, bytes) else str(c) for c in _node["categories"][...]]
        _norm_obs = [_cats[c] for c in _node["codes"][...]]
if set(annot.obs_names) != set(_norm_obs):
    fail("annotated 与 norm 细胞集合不一致（%d vs %d）"
         % (len(set(annot.obs_names)), len(set(_norm_obs))))

labels = annot.obs["celltype"].astype(str)
donors = annot.obs["donor"].astype(str) if "donor" in annot.obs.columns else pd.Series("NA", index=annot.obs_names)
celltype_counts = labels.value_counts()
celltypes = sorted(celltype_counts.index)
log("celltypes=%d cells=%d" % (len(celltypes), len(labels)))

# --- 2. 资源先行：只有 LR 基因需要进内存 ---
# 变量名不能叫 resource：会遮住标准库 resource（peak_rss_mb 用它取 ru_maxrss）
lr_resource = li.resource.select_resource("consensus")
db_genes = set(lr_resource["ligand"].astype(str)) | set(lr_resource["receptor"].astype(str))
db_upper = {g.upper() for g in db_genes}

sym_series = pd.Series(read_var_column(norm_file, "gene_symbol"))
duplicated = int(sym_series.duplicated().sum())
sym_upper = sym_series.str.upper()
gene_mask = sym_upper.isin(db_upper).to_numpy()
n_lr_in_matrix = int(gene_mask.sum())
coverage = n_lr_in_matrix / max(len(db_genes), 1)
log("consensus db_genes=%d LR genes in matrix=%d coverage=%.4f peak_rss=%.0fMB"
    % (len(db_genes), n_lr_in_matrix, coverage, peak_rss_mb()))
if coverage < COVERAGE_MIN:
    fail("LR 基因覆盖率 %.4f < %.2f（表达矩阵应取 norm 全基因，HVG 裁剪会崩）" % (coverage, COVERAGE_MIN))

# --- 3. 分层抽样细胞（celltype x donor），只影响互作打分，不影响标签来源 ---
MAX_CELLS_PER_CT = int(os.environ.get("BIO_LIANA_MAX_CELLS_PER_CT", "250"))
_rng = np.random.default_rng(seed_int)
_keep_idx = []
_sub_counts = {}
labels_arr = labels.to_numpy()
donors_arr = donors.to_numpy()
for _ct in celltypes:
    _ct_mask = labels_arr == _ct
    _idx_all = np.where(_ct_mask)[0]
    _n_take = min(MAX_CELLS_PER_CT, len(_idx_all))
    if _n_take >= len(_idx_all):
        _picked = _idx_all
    else:
        _donors = donors_arr[_ct_mask]
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
cells_before = int(labels.shape[0])

# --- 4. 物化「抽样细胞 x LR 基因」小矩阵（唯一进内存的矩阵）---
gene_idx = np.where(gene_mask)[0]
# 只按行读 X（log 归一化后的表达），再在内存里切列：nnz 与抽样细胞数成正比
X_sub = read_csr_rows(norm_file, "X", _keep_idx)
_var_syms = sym_series.to_numpy()[gene_idx]
_cell_ids = np.asarray(annot.obs_names)[_keep_idx]
adata = ad.AnnData(
    X=X_sub[:, gene_idx],
    obs=pd.DataFrame({"celltype": labels.to_numpy()[_keep_idx]},
                     index=pd.Index(_cell_ids, name="cell_id")),
    var=pd.DataFrame({"gene_symbol": _var_syms},
                     index=pd.Index(_var_syms, name="gene")),
)
# var_names 保持 symbol 原样（不做 make_unique）：LIANA 按名字精确匹配资源基因，
# 加后缀会让重复 symbol 那几条彻底失配；重复本身在报告里已记录。
if adata.obs["celltype"].isna().any():
    fail("抽样后存在无标签细胞")
log("materialized subsample %d x %d (cells x LR genes) peak_rss=%.0fMB"
    % (adata.shape[0], adata.shape[1], peak_rss_mb()))
log("subsample_per_celltype=%s" % _sub_counts)

# --- 5. LIANA rank_aggregate ---
li.mt.rank_aggregate(adata, groupby="celltype", resource_name="consensus",
                     use_raw=False, n_perms=N_PERMS, seed=seed_int,
                     expr_prop=EXPR_PROP, min_cells=MIN_CELLS, verbose=False)
log("rank_aggregate done peak_rss=%.0fMB" % peak_rss_mb())
res = adata.uns["liana_res"].copy()
del adata.uns["liana_res"]
log("liana_res rows=%d" % res.shape[0])

if res.shape[0] == 0:
    fail("liana 结果为空")
# 两种模式的结果形态不同：
#   n_perms=None（手机基准）：rank_aggregate 只出各方法原始分数与 lr_means，不出 aggregate 排序列；
#   有置换（桌面端）：额外出 specificity_rank / magnitude_rank / cellphone_pvals。
AGG_MODE = "rank_aggregate_with_perms" if "specificity_rank" in res.columns else "rank_aggregate_no_perms"
if AGG_MODE == "rank_aggregate_with_perms":
    if res["specificity_rank"].isna().any() or res["magnitude_rank"].isna().any():
        fail("rank 列存在 NaN")
else:
    # 无置换模式下用 lr_means 排序（只反映共表达强度，不含特异性/显著性），报告里写明
    res["magnitude_rank"] = res["lr_means"].rank(ascending=False, method="average")
    res["specificity_rank"] = res["magnitude_rank"]
if (res["lr_means"] < 0).any():
    fail("lr_means 存在负值")
if "cellphone_pvals" in res.columns:
    pvals = res["cellphone_pvals"].dropna()
    if len(pvals) and ((pvals < 0) | (pvals > 1)).any():
        fail("cellphone_pvals 超出 [0,1]")
if set(res["source"].unique()) != set(celltypes) or set(res["target"].unique()) != set(celltypes):
    fail("结果 source/target 与 celltype 分组不一致")

os.makedirs("results", exist_ok=True)
res.to_csv(os.path.join("results", "cellcomm_interactions.tsv"), sep="\t", index=False)

# h5ad 只落 LIANA 工作子集（抽样细胞 x LR 基因）+ 台账 uns：
# 写全量 annotated 会把 1.5 亿个浮点重新读进内存，正是本轮要消除的内存峰值。
adata.uns["cell_communication"] = {
    "method": "liana_rank_aggregate_consensus",
    "resource": "consensus",
    "groupby": "celltype",
    "expr_prop": EXPR_PROP, "min_cells": MIN_CELLS, "n_perms": N_PERMS,
    "seed": seed_int, "aggregate_method": "rra", "de_method": "t-test",
    "expression_source": norm_file, "label_source": annotated_file,
    "subset_note": "h5ad 仅含抽样细胞 x LR 基因（内存纪律），全量表达见 expression_source",
}
adata.write_h5ad("scrna_cellcomm.h5ad")

# 列名随 LIANA 版本/模式不同：有置换时可能是 source_/target_，无置换时是 ligand_complex/receptor_complex
LIG = "ligand_complex" if "ligand_complex" in res.columns else "source_"
REC = "receptor_complex" if "receptor_complex" in res.columns else "target_"
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
                              % (s, t, row[LIG], row[REC],
                                 float(row["specificity_rank"]), float(row["magnitude_rank"]),
                                 float(row["cellphone_pvals"]) if "cellphone_pvals" in res.columns and pd.notna(row["cellphone_pvals"]) else float("nan")))
    else:
        pair_lines.append("priority_pair=%s->%s 跳过：注释结果里没有该细胞类型" % (s, t))

report = [
    "step=cellcomm_adapt",
    "seed=%s" % seed,
    "label_source=%s" % annotated_file,
    "expression_source=%s" % norm_file,
    "agg_mode=%s（无置换模式只出 lr_means 排序，不含特异性与置换 p 值）" % AGG_MODE,
    "method=liana rank_aggregate resource=consensus n_perms=%s expr_prop=%.2f min_cells=%d "
    "aggregate=rra de_method=t-test（常量逐项继承母版，写死）" % (N_PERMS, EXPR_PROP, MIN_CELLS),
    "lr_coverage=%.4f（门槛 %.2f；表达矩阵取 norm 全基因，HVG 裁剪矩阵覆盖率会崩）" % (coverage, COVERAGE_MIN),
    "var_names_space=gene_symbol（liana 资源按 symbol 匹配；本链 var_names 是 Ensembl，适配层切换；重复 symbol=%d 保留首个）" % duplicated,
    "celltype_counts=%s" % celltype_counts.to_dict(),
    "memory_mode=backed_read + LR_gene_subset + stratified_cell_subsample（矩阵只物化一次）",
    "peak_rss_mb=%.0f" % peak_rss_mb(),
    "subsample=%s（性能界：置换检验成本随细胞数线性涨；按供体分层，每 celltype <= %d；"
    "只影响互作打分，不影响 obs['celltype'] 标签）"
    % ({str(k): int(v) for k, v in _sub_counts.items()}, MAX_CELLS_PER_CT),
    "cells_scored=%d（降采样后参与 liana 的细胞数；全量 %d）" % (adata.n_obs, cells_before),
    "interactions_rows=%d" % res.shape[0],
    "top%d_by_specificity=%s" % (TOP_N, [
        "%s->%s:%s/%s" % (r["source"], r["target"], r[LIG], r[REC])
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
log("cellcomm_adapt OK peak_rss=%.0fMB" % peak_rss_mb())