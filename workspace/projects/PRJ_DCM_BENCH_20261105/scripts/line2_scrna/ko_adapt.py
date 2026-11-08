#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ko_adapt：scTenifoldKnk 虚拟敲除适配（产出 DR gene list 供 summarize_dr）。

输入：annotate_cardiac 产物 *annotated*.h5ad（obs['diagnosis'] 群体标签来源）、
normalize_hvg 产物 *norm*.h5ad（layers['counts'] 全基因矩阵）、*hvg*.tsv（网内基因空间）。

靶基因解析顺序：--ko-gene 参数 > 环境变量 KO_GENE / BIO_KO_GENE > 项目元数据
biological_priors.target_ko_gene。禁止兜底默认基因：任务书要求"KO_GENE 不在表达矩阵/HVG
里必须明确失败，不许静默换基因"，所以母版的 TNF 兜底在本适配里移除。

群体：obs['diagnosis']==DCM（病例群体内建 WT 网络再敲除；与旧母版"在疾病群体内做敲除"
的口径一致，POPULATION 可用 BIO_KO_POPULATION 覆盖为 NonDiseased）。

常量继承母版（写死）：N_NETS=10、N_SAMP_CELLS=500、N_COMP=3、Q_VALUE=0.9、
TD_RANK=3、MA_DIMS=2、TOP_N=20、SIG_LEVEL=0.05、QC_MIN_PERCENT=0.05。

内存护栏（本项目新增，手机上必需）：群体细胞数超过 MAX_EXPR_CELLS 时按 seed 确定性
随机抽样到该上限再稠密化（2000 基因 x 细胞稠密矩阵是 scTenifold 的输入形态，
母版在上一研究未触发上限；触发与否如实写进报告，不许静默）。

产物：results/ko_dr_genes.tsv、scrna_knockout.h5ad、ko_report.txt。
"""
import gc
import os
import sys
import time
import warnings

import numpy as np
import pandas as pd
import anndata as ad
import scTenifold as st

ad.settings.allow_write_nullable_strings = False

START = time.time()
N_NETS = 10
N_SAMP_CELLS = 500
N_COMP = 3
Q_VALUE = 0.9
TD_RANK = 3
MA_DIMS = 2
TOP_N = 20
SIG_LEVEL = 0.05
QC_MIN_PERCENT = 0.05
HVG_GENE_LIMIT = 2000
MAX_EXPR_CELLS = 20000  # 2000x20000 float64 稠密 ~320MB，手机 7.5GB RLIMIT 内的护栏

DR_COLUMNS = ["Gene", "Distance", "boxcox-transformed distance", "Z", "FC",
              "p-value", "adjusted p-value"]


def fail(msg):
    sys.stderr.write("ko_adapt 自校验失败: %s\n" % msg)
    sys.stderr.flush()
    sys.exit(1)


def log(msg):
    print(msg, flush=True)


KO_GENE = os.environ.get("KO_GENE", "").strip()
KO_GENE_SOURCE = os.environ.get("KO_GENE_SOURCE", "unknown").strip() or "unknown"
POPULATION = os.environ.get("BIO_KO_POPULATION", "DCM").strip() or "DCM"
annotated_file = os.environ["ANNOTATED_FILE"]
norm_file = os.environ["NORM_FILE"]
hvg_file = os.environ["HVG_FILE"]
seed = os.environ["BIOANALYS_SEED"]
seed_int = int(seed)

if not KO_GENE:
    fail("敲除基因未注入（--ko-gene / KO_GENE / BIO_KO_GENE / project.json 任一渠道）。"
         "本适配禁止兜底默认基因：母版的 TNF 兜底在跨研究场景会静默敲错基因")

annot = ad.read_h5ad(annotated_file)
norm = ad.read_h5ad(norm_file)
log("loaded annotated=%s norm=%s" % (annot.shape, norm.shape))

if "diagnosis" not in annot.obs.columns:
    fail("annotated 缺 obs['diagnosis']（群体标签来源）")
if "annotation" not in annot.uns:
    fail("annotated 缺 uns['annotation']（不是 annotate_cardiac 产物？）")
if "counts" not in norm.layers:
    fail("norm 缺 layers['counts']（不是 normalize_hvg 产物？）")
if norm.shape[1] <= HVG_GENE_LIMIT:
    fail("norm 基因数 %d <= %d：疑似喂了 HVG 裁剪矩阵" % (norm.shape[1], HVG_GENE_LIMIT))

hvg_table = pd.read_csv(hvg_file, sep="\t")
if "gene" not in hvg_table.columns:
    fail("hvg 清单缺少 gene 列")
hvg_genes = [str(g) for g in hvg_table["gene"].tolist()]
norm_var = set(norm.var_names.astype(str))
if not set(hvg_genes) <= norm_var:
    fail("hvg 清单有 %d 个基因不在 norm var_names" % len(set(hvg_genes) - norm_var))
# 客户习惯输入 gene symbol（如 TNF），而矩阵 var_names 是 Ensembl ID。
# 允许一次显式解析：symbol 在 var['gene_symbol'] 里唯一命中才接受，并把解析
# 结果写进报告与 uns；歧义或零命中直接失败。这与"静默换基因"的区别是渠道与
# 结果全部留痕，人工可复核。
KO_GENE_INPUT = KO_GENE
KO_SYMBOL_RESOLVED = ""
if KO_GENE not in norm_var:
    if "gene_symbol" not in norm.var.columns:
        fail("敲除基因 %s 不在 var_names（Ensembl 空间）且 var 无 gene_symbol 列可解析；"
             "禁止静默替换" % KO_GENE)
    sym = norm.var["gene_symbol"].astype(str)
    hits = norm.var_names[(sym == KO_GENE).to_numpy()].astype(str).tolist()
    if len(hits) == 0:
        fail("敲除基因 %s 既不是已知 Ensembl ID 也无 symbol 命中：不许静默换基因" % KO_GENE)
    if len(hits) > 1:
        fail("敲除基因 symbol %s 映射到 %d 个 Ensembl ID（%s）有歧义：要求显式给 Ensembl ID，"
             "禁止挑一个" % (KO_GENE, len(hits), hits[:5]))
    KO_SYMBOL_RESOLVED = "%s -> %s（var['gene_symbol'] 唯一命中）" % (KO_GENE, hits[0])
    KO_GENE = hits[0]
    log("ko_gene 解析: %s" % KO_SYMBOL_RESOLVED)
if KO_GENE not in hvg_genes:
    fail("敲除基因 %s 不在 HVG 清单：网络基因空间由 HVG 定义，目标必须在网内。"
         "禁止静默换成'最接近的基因'" % KO_GENE)

if set(annot.obs_names) != set(norm.obs_names):
    fail("annotated 与 norm 细胞集合不一致")

diagnosis = annot.obs["diagnosis"].astype(str).reindex(norm.obs_names)
pop_mask = (diagnosis == POPULATION).to_numpy()
n_pop = int(pop_mask.sum())
if n_pop == 0:
    fail("群体 %s 在输入中 0 个细胞（可选值: %s）" % (POPULATION, sorted(set(diagnosis))))

sampling_note = "群体细胞数 %d <= 护栏 %d，全量入网" % (n_pop, MAX_EXPR_CELLS)
cell_subset_mask = pop_mask
if n_pop > MAX_EXPR_CELLS:
    rng = np.random.default_rng(seed_int)
    pop_idx = np.where(pop_mask)[0]
    chosen = rng.choice(pop_idx, size=MAX_EXPR_CELLS, replace=False)
    cell_subset_mask = np.zeros(norm.shape[0], dtype=bool)
    cell_subset_mask[chosen] = True
    sampling_note = ("群体细胞数 %d > 护栏 %d：按 seed=%d 确定性随机抽样到 %d 细胞入网"
                     % (n_pop, MAX_EXPR_CELLS, seed_int, MAX_EXPR_CELLS))
log(sampling_note)

gene_mask = pd.Series(norm.var_names.astype(str)).isin(hvg_genes).to_numpy()
pop_counts = norm.layers["counts"][cell_subset_mask][:, gene_mask]
pop_cells = norm.obs_names[cell_subset_mask].astype(str)
expr = pd.DataFrame(np.asarray(pop_counts.todense()).T,
                    index=list(norm.var_names.astype(str)[gene_mask]),
                    columns=pop_cells)
del pop_counts, norm
gc.collect()
log("expr(genes x cells)=%s" % (expr.shape,))

ko_fraction = float((expr.loc[KO_GENE] > 0).mean())
log("ko_gene=%s population=%s expression_fraction=%.4f（sc_QC 基因闸 %.2f）"
    % (KO_GENE, POPULATION, ko_fraction, QC_MIN_PERCENT))
if ko_fraction <= QC_MIN_PERCENT:
    fail("敲除基因 %s 在 %s 群体表达占比 %.4f 不超过 sc_QC 基因闸 %.2f，进不了网络"
         % (KO_GENE, POPULATION, ko_fraction, QC_MIN_PERCENT))

gc.collect()
captured = []
with warnings.catch_warnings(record=True) as wlist:
    warnings.simplefilter("always")
    scn = st.scTenifoldKnk(expr, ko_genes=KO_GENE,
                           nc_kws={"random_state": seed_int},
                           td_kws={"random_state": seed_int})
    dr = scn.build()
    for w in wlist:
        captured.append(str(w.message))
for message in captured:
    log("WARN: %s" % message[:200])
if any("no outgoing edges" in m for m in captured):
    fail("敲除基因在 WT 网络没有出边，DR 结果只是数值噪声")

qc_matrix = scn.QC_dict["WT"]
n_cells_qc = int(qc_matrix.shape[1])
n_genes_net = len(scn.shared_gene_names)
qc_kept_cells = set(qc_matrix.columns.astype(str))
if not qc_kept_cells <= set(pop_cells):
    fail("QC 保留细胞越出群体集合")
if n_cells_qc == 0 or n_genes_net == 0:
    fail("QC 后矩阵为空")
del scn, qc_matrix
gc.collect()

dr_sorted = dr.sort_values("adjusted p-value", kind="mergesort").reset_index(drop=True)
if list(dr_sorted.columns) != DR_COLUMNS:
    fail("DR 表列集合与母版口径不一致: %s" % list(dr_sorted.columns))
non_ko = dr_sorted[dr_sorted["Gene"] != KO_GENE]
n_sig_all = int((dr_sorted["adjusted p-value"] < SIG_LEVEL).sum())
n_sig_non_ko = int((non_ko["adjusted p-value"] < SIG_LEVEL).sum())
ko_rank = int(np.where(dr_sorted["Gene"].to_numpy() == KO_GENE)[0][0]) + 1
top_dr = non_ko.head(TOP_N)[["Gene", "Distance", "Z", "FC", "p-value", "adjusted p-value"]].reset_index(drop=True)
log("DR genes=%d sig(adj p<%g)=%d（不含自身 %d），KO 自身排名 %d"
    % (dr_sorted.shape[0], SIG_LEVEL, n_sig_all, n_sig_non_ko, ko_rank))

os.makedirs("results", exist_ok=True)
dr_sorted.to_csv(os.path.join("results", "ko_dr_genes.tsv"), sep="\t", index=False)

out = annot.copy()
dr_indexed = dr_sorted.set_index("Gene")
var_names = out.var_names.astype(str)
out.var["tenifold_distance"] = [float(dr_indexed["Distance"].get(g, np.nan)) for g in var_names]
out.var["tenifold_z"] = [float(dr_indexed["Z"].get(g, np.nan)) for g in var_names]
out.var["tenifold_fc"] = [float(dr_indexed["FC"].get(g, np.nan)) for g in var_names]
out.var["tenifold_p_value"] = [float(dr_indexed["p-value"].get(g, np.nan)) for g in var_names]
out.var["tenifold_adj_p_value"] = [float(dr_indexed["adjusted p-value"].get(g, np.nan)) for g in var_names]
out.var["tenifold_dr_available"] = var_names.isin(dr_indexed.index)
out.obs["tenifold_qc_kept"] = [name in qc_kept_cells for name in out.obs_names.astype(str)]
out.uns["virtual_knockout"] = {
    "method": "scTenifoldKnk_virtual_knockout",
    "ko_gene": KO_GENE,
    "ko_gene_source": KO_GENE_SOURCE,
    "ko_gene_input": KO_GENE_INPUT,
    "ko_gene_symbol_resolution": KO_SYMBOL_RESOLVED or "not_needed_direct_ensembl",
    "population": POPULATION,
    "n_nets": N_NETS, "n_samp_cells": N_SAMP_CELLS, "n_comp": N_COMP,
    "q_value": Q_VALUE, "td_rank": TD_RANK, "ma_dims": MA_DIMS,
    "sig_level": SIG_LEVEL, "qc_min_percent": QC_MIN_PERCENT,
    "seed": seed_int, "n_genes_network": int(n_genes_net), "n_cells_input": int(len(pop_cells)),
    "n_cells_qc_kept": int(n_cells_qc),
    "n_significant": n_sig_all, "n_significant_excl_ko": n_sig_non_ko,
    "ko_gene_rank": ko_rank,
    "cell_sampling": sampling_note,
    "source_annotated": annotated_file, "source_norm": norm_file, "source_hvg": hvg_file,
}
out.uns["ko_gene"] = KO_GENE
out.uns["population"] = POPULATION
out.uns["seed"] = seed_int
out.write_h5ad("scrna_knockout.h5ad")

report = [
    "step=ko_adapt",
    "seed=%s" % seed,
    "input_annotated=%s" % annotated_file,
    "input_norm=%s" % norm_file,
    "input_hvg=%s" % hvg_file,
    "ko_gene=%s（来源 %s；本适配无默认兜底，缺注入直接失败）" % (KO_GENE, KO_GENE_SOURCE),
    "ko_gene_input=%s 解析=%s" % (KO_GENE_INPUT, KO_SYMBOL_RESOLVED or "无需解析（直接 Ensembl ID）"),
    "population=%s（obs['diagnosis'] 值；BIO_KO_POPULATION 可覆盖）" % POPULATION,
    "params=n_nets=%d n_samp_cells=%d n_comp=%d q=%.2f td_rank=%d ma_dims=%d random_state=%d "
    "（逐项继承母版 virtual_knockout，写死）" % (N_NETS, N_SAMP_CELLS, N_COMP, Q_VALUE, TD_RANK, MA_DIMS, seed_int),
    "cells_population=%d cells_input=%d cells_after_scQC=%d genes_network=%d"
    % (n_pop, len(pop_cells), n_cells_qc, n_genes_net),
    "cell_sampling=%s" % sampling_note,
    "ko_expression_fraction=%.4f（须 > %.2f 才进得了网络）" % (ko_fraction, QC_MIN_PERCENT),
    "DR 表：%d 基因；adj p<%g 显著（含敲除基因）%d、（不含）%d；KO 自身排名 %d"
    % (dr_sorted.shape[0], SIG_LEVEL, n_sig_all, n_sig_non_ko, ko_rank),
    "top%d_DR=%s" % (TOP_N, ",".join(top_dr["Gene"].astype(str).tolist())),
    "self_check=基因在 var/HVG/群体非空/细胞集合一致/QC 细胞不越界/DR 列口径 OK",
    "limitation_note=scTenifold 结果是计算模拟不是实验验证，供假设生成与人工复核；"
    "DR=调控网络距离变化，不等于表达量差异；核转录组里 TTN/NPPA 等高丰度心肌基因会主导网络结构；"
    "抽样护栏触发时网络只代表被抽中的细胞子集（报告如实标注）。",
    "elapsed_seconds=%.0f" % (time.time() - START),
    "outputs=results/ko_dr_genes.tsv, scrna_knockout.h5ad, ko_report.txt",
]
with open("ko_report.txt", "w", encoding="utf-8") as fh:
    fh.write("\n".join(report) + "\n")
for line in report:
    log(line)
log("ko_adapt OK")
