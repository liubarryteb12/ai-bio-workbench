#!/usr/bin/env bash
# ko_adapt：PRJ_DCM_BENCH_20261105 line2_scrna 项目内适配步（scTenifoldKnk 虚拟敲除，DR genes）。
#
# 为什么项目内写而不动母版 virtual_knockout：
#   1) 群体口径：母版 POPULATION="Psoriasis"（diagnosis 值），本线诊断词是 DCM/Ctrl/NonDiseased/Fetal；
#      本步固定取 DCM 细胞核为敲除群体（疾病状态下的调控网络）。
#   2) 基因空间：母版要求 hvg_genes.tsv 有 "gene" 列；部署母版 normalize_hvg 产出的是 Ensembl index
#      命名的 hvg_genes.tsv（上一研究 var_names=symbol 才恰好可用）。本线 var_names=Ensembl、
#      符号在 var['gene_symbol']，scTenifold 与 R 版 scTenifoldKnk 的惯例输入是 gene x cell 的
#      符号矩阵，因此本步自己从 norm 的 layers['counts']（未经 HVG 裁剪的符号视图）取
#      HVG 2000 对应行建网络基因空间。
#   3) sc_QC 适配：scTenifoldpy 默认 max_mito_ratio=0.1（全细胞口径），核转录组 MT 本底高，
#      按 0.1 会误删大量心肌细胞核；本步经 qc_kws 放宽到 pct_mito<0.20（与 qc_nuclei.sh 同口径，
#      两处阈值一致性由自校验强制）。min_lib_size 由 1000 降为 200（核内 mRNA 少，
#      与 nfeature>=200 的 QC 下限同源），调整全部写进报告。
#   4) 靶基因缺失策略：母版有 TNF 兜底。本步禁止兜底、禁止换基因：KO_GENE 未注入即 exit 2；
#      基因不在符号矩阵即 fail exit 1。
#
# 常量（用户定稿 2026-11-05）：N_NETS=10 / N_SAMP_CELLS=500 / TOP_N=20 / SIG_LEVEL=0.05。
#   其余 scTenifoldKnk 参数与 R 包默认一致（n_comp=3, q=0.9, td_rank=3, ma_dims=2, ko_method=default）。
#
# 输入（--input，模式前后带 *，坑 #99）：
#   *annotated*.h5ad  annotate_cardiac 产物（obs['diagnosis'] 群体标签 + uns['annotation']）
#   *norm*.h5ad       母版 normalize_hvg 产物（layers['counts'] 整数计数，全基因）
#   *hvg*.tsv         母版 normalize_hvg 产物 hvg_genes.tsv（index=Ensembl；HVG 基因空间来源）
# 靶基因注入优先级：--ko-gene 参数 > 环境变量 KO_GENE > 环境变量 BIO_KO_GENE（三者皆空 exit 2）。
# 产物（--output 同名优先；否则第一个 --output 目录；再否则当前目录）：
#   results/ko_dr_genes.tsv（全 DR 表，p-value 升序，is_knockout_gene 标志列）
#   results/ko_report.txt
#
# 自校验（任一不过 fail() exit 1，不落盘）：输入契约、细胞集合一致、HVG 清单全在符号矩阵、
# KO_GENE 在符号矩阵且表达占比 > 0.05（sc_QC 基因闸，不达即失败不换基因）、
# DR 表列名与行数结构、p/padj 有限且在 [0,1]、Distance 非负、敲除基因位移 > 0（空敲除拦截）、
# no-outgoing-edge 警告拦截、QC 保留细胞为群体子集。
set -euo pipefail

seed="${BIOANALYS_SEED:-UNSET}"
if [ "$seed" = "UNSET" ]; then
  echo "BIOANALYS_SEED 未注入（引擎契约：seed 必须注入）" >&2
  exit 3
fi

BIO_PY="${BIO_PY:-/root/venvs/bio-py/bin/python3}"
if [ ! -x "$BIO_PY" ]; then
  echo "python 解释器不可执行: $BIO_PY（可用环境变量 BIO_PY 覆盖）" >&2
  exit 2
fi

declare -a INPUTS=()
declare -a OUTPUTS=()
ko_gene=""
ko_gene_source=""
while [ $# -gt 0 ]; do
  case "$1" in
    --input) INPUTS+=("$2"); shift 2 ;;
    --output) OUTPUTS+=("$2"); shift 2 ;;
    --seed) shift 2 ;;
    --ko-gene) ko_gene="$2"; ko_gene_source="cli:--ko-gene"; shift 2 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

# 靶基因解析：无兜底。缺注入是参数错误（exit 2），不是计算失败。
if [ -z "$ko_gene" ]; then
  if [ -n "${KO_GENE:-}" ]; then
    ko_gene="$(printf '%s' "${KO_GENE}" | tr -d '[:space:]')"
    ko_gene_source="env:KO_GENE"
  elif [ -n "${BIO_KO_GENE:-}" ]; then
    ko_gene="$(printf '%s' "${BIO_KO_GENE}" | tr -d '[:space:]')"
    ko_gene_source="env:BIO_KO_GENE"
  fi
fi
if [ -z "$ko_gene" ]; then
  echo "缺少靶基因注入：--ko-gene 参数或环境变量 KO_GENE/BIO_KO_GENE 必须给一个（本步禁止兜底与换基因）" >&2
  exit 2
fi

annotated_file=""
norm_file=""
hvg_file=""
for path in "${INPUTS[@]:-}"; do
  [ -n "$path" ] || continue
  case "$path" in
    *annotated*.h5ad) annotated_file="$path" ;;
    *norm*.h5ad) norm_file="$path" ;;
    *hvg*.tsv) hvg_file="$path" ;;
    *) echo "无法识别的输入文件: $path（需要 *annotated*.h5ad、*norm*.h5ad 与 *hvg*.tsv）" >&2; exit 2 ;;
  esac
done
if [ -z "$annotated_file" ] || [ -z "$norm_file" ] || [ -z "$hvg_file" ]; then
  echo "缺少必需输入：需要 annotated 产物、norm 产物与 hvg 清单（annotated='$annotated_file' norm='$norm_file' hvg='$hvg_file'）" >&2
  exit 2
fi
for f in "$annotated_file" "$norm_file" "$hvg_file"; do
  if [ ! -f "$f" ]; then
    echo "输入文件不存在: $f" >&2
    exit 2
  fi
done

out_dir="."
if [ "${#OUTPUTS[@]}" -gt 0 ]; then
  out_dir="$(dirname "${OUTPUTS[0]}")"
fi
mkdir -p "$out_dir"

out_path() {
  local name="$1"
  local p
  for p in "${OUTPUTS[@]:-}"; do
    [ -n "$p" ] || continue
    if [ "$(basename "$p")" = "$name" ]; then
      printf '%s\n' "$p"
      return 0
    fi
  done
  printf '%s\n' "$out_dir/$name"
}

DR_OUT="$(out_path ko_dr_genes.tsv)"
REPORT_OUT="$(out_path ko_report.txt)"
rm -f "$DR_OUT" "$REPORT_OUT"

echo "step_executed=ko_adapt"
echo "bioanalys_seed=${seed}"
echo "input_annotated=${annotated_file}"
echo "input_norm=${norm_file}"
echo "input_hvg=${hvg_file}"
echo "ko_gene=${ko_gene}"
echo "ko_gene_source=${ko_gene_source}"

ANNOTATED_FILE="$annotated_file" NORM_FILE="$norm_file" HVG_FILE="$hvg_file" \
BIOANALYS_SEED="$seed" KO_GENE="$ko_gene" KO_GENE_SOURCE="$ko_gene_source" \
DR_OUT="$DR_OUT" REPORT_OUT="$REPORT_OUT" \
"$BIO_PY" - <<'PYSCRIPT'
import gc
import hashlib
import os
import sys
import time
import warnings

import numpy as np
import pandas as pd
import anndata as ad
import scTenifold as st

# pandas 3 与 2 的 infer_string 默认值不同，显式关掉（坑 #107）。
ad.settings.allow_write_nullable_strings = False

START = time.time()
KO_GENE = os.environ.get("KO_GENE", "").strip()
KO_GENE_SOURCE = os.environ.get("KO_GENE_SOURCE", "unknown").strip() or "unknown"
POPULATION = "DCM"          # 本线疾病群体（diagnosis 值）；母版 Psoriasis 词不适用
N_NETS = 10
N_SAMP_CELLS = 500
N_COMP = 3
Q_VALUE = 0.9
TD_RANK = 3
MA_DIMS = 2
TOP_N = 20
SIG_LEVEL = 0.05
# sc_QC 适配口径（核转录组；与 qc_nuclei.sh 同源，一致性自校验强制）：
QC_MIN_LIB_SIZE = 200.0     # 母版/包默认 1000 为全细胞口径，核内 mRNA 少，降到 200
QC_MAX_MITO = 0.20          # 包默认 0.1 会误删高 MT 本底的细胞核；与 qc_nuclei pct_mito<20 对齐
QC_MIN_PERCENT = 0.05       # 包默认基因闸，保持不动（预检也用这一口径）
EXPR_CELL_CAP = 5000        # 稠密化前的群体细胞上限（2000 基因 x 全群体稠密 float64 在 2 万核时约 320MB，
                            # 叠加 tolist 拷贝会顶穿容器内存；scTenifold 建网每网只抽 500 细胞，
                            # 预采 5000 不改变统计口径，采样随机态用注入 seed）
DR_COLUMNS = ["Gene", "Distance", "boxcox-transformed distance", "Z", "FC",
              "p-value", "adjusted p-value"]


def fail(message):
    sys.stderr.write("ko_adapt 自校验失败: %s\n" % message)
    sys.stderr.flush()
    sys.exit(1)


def log(message):
    print(message, flush=True)


annotated_file = os.environ["ANNOTATED_FILE"]
norm_file = os.environ["NORM_FILE"]
hvg_file = os.environ["HVG_FILE"]
DR_OUT = os.environ["DR_OUT"]
REPORT_OUT = os.environ["REPORT_OUT"]
seed = os.environ["BIOANALYS_SEED"]
try:
    seed_int = int(seed)
except ValueError:
    fail("BIOANALYS_SEED 不是整数: %s" % seed)
if not KO_GENE:
    fail("KO_GENE 为空：bash 包装层应经 --ko-gene / KO_GENE / BIO_KO_GENE 注入，本步禁止兜底与换基因")

# --- 1. 输入契约 ---
annot = ad.read_h5ad(annotated_file)
norm = ad.read_h5ad(norm_file)
log("loaded annotated=%s norm=%s" % (annot.shape, norm.shape))
if "diagnosis" not in annot.obs.columns:
    fail("annotated 缺少 obs['diagnosis']（群体标签来源）")
if "annotation" not in annot.uns:
    fail("annotated 缺少 uns['annotation']（不是 annotate_cardiac 产物？）")
if "counts" not in norm.layers:
    fail("norm 缺少 layers['counts']（不是 normalize_hvg 产物？）")
if "gene_symbol" not in norm.var.columns:
    fail("norm 缺少 var['gene_symbol']（符号矩阵无法构建）")
if norm.shape[1] <= 2000:
    fail("norm 基因数 %d <= 2000：疑似喂了 HVG 裁剪矩阵，必须全基因 counts" % norm.shape[1])
if set(annot.obs_names.astype(str)) != set(norm.obs_names.astype(str)):
    fail("annotated 与 norm 细胞集合不一致（%d vs %d）"
         % (len(set(annot.obs_names)), len(set(norm.obs_names))))

# --- 2. HVG 基因空间：hvg_genes.tsv 的行名是 Ensembl，映射到符号 ---
hvg_table = pd.read_csv(hvg_file, sep="\t", index_col=0)
hvg_ensembl = [str(g) for g in hvg_table.index]
norm_var = set(norm.var_names.astype(str))
missing_hvg = sorted(set(hvg_ensembl) - norm_var)
if missing_hvg:
    fail("hvg 清单有 %d 个 Ensembl 不在 norm var_names（前 10: %s）" % (len(missing_hvg), missing_hvg[:10]))
ensembl_to_symbol = pd.Series(norm.var["gene_symbol"].astype(str).to_numpy(),
                              index=norm.var_names.astype(str))
hvg_symbols = sorted({str(ensembl_to_symbol.get(e)).upper() for e in hvg_ensembl} - {"NA", ""})
ko_symbol_gene = KO_GENE.upper()
log("hvg_ensembl=%d hvg_symbols=%d" % (len(hvg_ensembl), len(hvg_symbols)))

# --- 3. 群体与符号表达矩阵装配（gene x cell 原始整数计数）---
diagnosis = annot.obs["diagnosis"].astype(str).reindex(norm.obs_names)
pop_mask = (diagnosis == POPULATION).to_numpy()
n_pop = int(pop_mask.sum())
if n_pop == 0:
    fail("群体 %s 在输入中 0 个细胞（diagnosis 值异常？）" % POPULATION)
n_pop_sampled = 0
if n_pop > EXPR_CELL_CAP:
    rng = np.random.default_rng(seed_int)
    chosen = np.sort(rng.choice(np.flatnonzero(pop_mask), size=EXPR_CELL_CAP, replace=False))
    pre = pop_mask.copy()
    pop_mask = np.zeros_like(pop_mask)
    pop_mask[chosen] = True
    n_pop_sampled = n_pop - int(pop_mask.sum())
    log("population=%s cells_pre=%d -> capped=%d (sampled_out=%d, random_state=%d)"
        % (POPULATION, n_pop, int(pop_mask.sum()), n_pop_sampled, seed_int))
else:
    log("population=%s cells=%d（未超上限 %d，不采样）" % (POPULATION, n_pop, EXPR_CELL_CAP))

symbols = pd.Index(norm.var["gene_symbol"].astype(str)).str.upper().to_numpy()
ensembl_arr = np.asarray(norm.var_names.astype(str))
hvg_pos = np.flatnonzero(np.isin(ensembl_arr, hvg_ensembl))
hvg_sym = symbols[hvg_pos]
# 只保留有符号的行（NA 符号行进网络是噪声），再按符号去碰撞（keep=first）
uniq_keep = np.isin(hvg_sym, list(hvg_symbols)) & ~np.asarray(pd.Index(hvg_sym).duplicated(keep="first"))
if int(np.isin(hvg_sym, list(hvg_symbols)).sum()) == 0:
    fail("HVG Ensembl 全部映射不到有效 gene_symbol：符号矩阵无法构建")
n_collapsed = int((~uniq_keep).sum())
sel_pos = hvg_pos[uniq_keep]

pop_counts = norm.layers["counts"][pop_mask][:, sel_pos]
pop_cells = np.asarray(norm.obs_names[pop_mask].astype(str))
expr = pd.DataFrame(np.asarray(pop_counts.todense()).T,
                    index=symbols[sel_pos],
                    columns=pop_cells)
expr.index.name = "gene"
log("expr(genes x cells)=%s (symbol_collapsed_rows=%d)" % (expr.shape, n_collapsed))

# 靶基因硬校验：缺失或不在矩阵内即失败，禁止换基因（用户定稿）。
if ko_symbol_gene not in set(hvg_symbols):
    fail("敲除靶基因 %s 不在 HVG 符号空间（%d 个符号）：网络基因空间由 HVG 定义，"
         "敲除目标必须在网内。本步禁止换基因。" % (ko_symbol_gene, len(hvg_symbols)))
if ko_symbol_gene not in set(expr.index):
    fail("敲除靶基因 %s 不在 HVG 符号矩阵内（矩阵 %d 基因）。本步禁止替换基因：请确认注入的 KO_GENE "
         "拼写与大小写，或改用母版 normalize_hvg 的 hvg_genes.tsv 重建。" % (ko_symbol_gene, expr.shape[0]))
ko_fraction = float((expr.loc[ko_symbol_gene] > 0).mean())
log("ko_gene=%s expression_fraction=%.4f（sc_QC 基因闸 %.2f）" % (ko_symbol_gene, ko_fraction, QC_MIN_PERCENT))
if ko_fraction <= QC_MIN_PERCENT:
    fail("敲除基因 %s 在 %s 群体表达占比 %.4f <= 基因闸 %.2f，进不了网络。"
         "本步禁止换基因：结果留空并向项目主报告，不静默替换。"
         % (ko_symbol_gene, POPULATION, ko_fraction, QC_MIN_PERCENT))

del pop_counts, norm
gc.collect()

# --- 4. scTenifoldKnk 全流程 ---
captured = []
with warnings.catch_warnings(record=True) as wlist:
    warnings.simplefilter("always")
    # nc/td 显式给抽样参数与 random_state；td 的 K=3/n_decimal=3 与 ma 的 d=2 来自
    # scTenifoldKnk.step_defaults（与 R 包默认等价，实例化实测确认），不重复传。
    scn = st.scTenifoldKnk(expr, ko_genes=ko_symbol_gene,
                           qc_kws={"min_lib_size": QC_MIN_LIB_SIZE,
                                   "max_mito_ratio": QC_MAX_MITO,
                                   "min_percent": QC_MIN_PERCENT},
                           nc_kws={"n_nets": N_NETS, "n_samp_cells": N_SAMP_CELLS,
                                   "n_comp": N_COMP, "q": Q_VALUE,
                                   "random_state": seed_int},
                           td_kws={"random_state": seed_int})
    dr = scn.build()
    for w in wlist:
        captured.append(str(w.message))
for message in captured:
    log("WARN: %s" % message[:200])
no_edge = [m for m in captured if "no outgoing edges" in m]
if no_edge:
    fail("敲除基因在 WT 网络没有出边，敲除是空操作，DR 结果只是数值噪声: %s" % no_edge[0][:200])

qc_matrix = scn.QC_dict["WT"]
n_cells_qc = int(qc_matrix.shape[1])
n_genes_net = len(scn.shared_gene_names)
qc_kept_cells = set(qc_matrix.columns.astype(str))
log("QC 后矩阵(genes x cells)=%s（输入 %d 基因 x %d 细胞；剔 %d 细胞 %d 基因）"
    % (qc_matrix.shape, expr.shape[0], expr.shape[1],
       expr.shape[1] - n_cells_qc, expr.shape[0] - n_genes_net))
if not qc_kept_cells <= set(pop_cells):
    fail("sc_QC 保留细胞越出群体集合")
if n_cells_qc < N_SAMP_CELLS:
    fail("sc_QC 后细胞数 %d < n_samp_cells %d：无法按定稿参数建网（不自动降参数凑数）"
         % (n_cells_qc, N_SAMP_CELLS))
if n_genes_net == 0:
    fail("QC 后网络基因数为 0")

del scn, qc_matrix
gc.collect()

# --- 5. 自校验（DR 表）---
if list(dr.columns) != DR_COLUMNS:
    fail("DR 表列名与预期不符: %s" % list(dr.columns))
if dr.shape[0] != n_genes_net:
    fail("DR 表行数 %d != 网络基因数 %d" % (dr.shape[0], n_genes_net))
if not dr["Gene"].isin([ko_symbol_gene]).any():
    fail("DR 表中没有敲除基因 %s" % ko_symbol_gene)
for col in ["Distance", "Z", "FC", "p-value", "adjusted p-value"]:
    if dr[col].isna().any():
        fail("DR 表 %s 列存在 NaN" % col)
if (dr["Distance"] < 0).any():
    fail("DR 表 Distance 存在负值")
for col in ["p-value", "adjusted p-value"]:
    if ((dr[col] < 0) | (dr[col] > 1)).any():
        fail("DR 表 %s 越出 [0,1]" % col)
ko_distance = float(dr.loc[dr["Gene"] == ko_symbol_gene, "Distance"].iloc[0])
if ko_distance <= 0:
    fail("敲除基因 %s 位移为 0，敲除未产生扰动" % ko_symbol_gene)
log("self_check 契约/矩阵/DR 结构/敲除生效 OK")

dr_sorted = dr.sort_values("p-value", kind="mergesort").reset_index(drop=True)
n_sig_all = int((dr_sorted["adjusted p-value"] < SIG_LEVEL).sum())
non_ko = dr_sorted[dr_sorted["Gene"] != ko_symbol_gene]
n_sig_non_ko = int((non_ko["adjusted p-value"] < SIG_LEVEL).sum())
ko_rank = int(dr_sorted.index[dr_sorted["Gene"] == ko_symbol_gene][0]) + 1
log("dr_genes=%d significant_adj<%.2f=%d（含敲除基因）/ %d（不含）ko_rank_by_pvalue=%d"
    % (dr_sorted.shape[0], SIG_LEVEL, n_sig_all, n_sig_non_ko, ko_rank))

top_dr = non_ko.head(TOP_N)[["Gene", "Distance", "Z", "FC", "p-value", "adjusted p-value"]].reset_index(drop=True)
for _, row in top_dr.iterrows():
    log("  top_dr %-10s Z=%8.3f FC=%12.3f padj=%.3e"
        % (row["Gene"], row["Z"], row["FC"], row["adjusted p-value"]))

# --- 6. 落盘 ---
dr_out = dr_sorted.copy()
dr_out["is_knockout_gene"] = dr_out["Gene"] == ko_symbol_gene
dr_out.to_csv(DR_OUT, sep="\t", index=False)

report_lines = [
    "step=ko_adapt",
    "seed=%s" % seed,
    "label_source=%s" % annotated_file,
    "expression_source=%s" % norm_file,
    "gene_set_source=%s (Ensembl index -> var['gene_symbol'] 映射, %d Ensembl -> %d 唯一符号, 碰撞并首行保留 %d)"
    % (hvg_file, len(hvg_ensembl), int(expr.shape[0]), n_collapsed),
    "method=scTenifoldpy %s scTenifoldKnk ko_method=default（与 R 包 scTenifoldKnk 默认参数等价）"
    % getattr(st, "__version__", "0.5.1"),
    "params=n_nets=%d n_samp_cells=%d n_comp=%d q=%.2f td_rank=%d ma_dims=%d random_state=%d"
    % (N_NETS, N_SAMP_CELLS, N_COMP, Q_VALUE, TD_RANK, MA_DIMS, seed_int),
    "population=%s cells=%d（diagnosis 列；母版 Psoriasis 词不适用于本线）" % (POPULATION, n_pop),
    "population_per_sample=%s" % ({str(d): int(c) for d, c in annot.obs["donor"].astype(str)[(annot.obs["diagnosis"].astype(str) == POPULATION).to_numpy()].value_counts().items()} if "donor" in annot.obs.columns else {}),
    "cell_pre_sampling=%s（内存口径：2000 基因 x 群体细胞稠密化上限 %d，超出按 seed 随机抽 %d，"
    "被抽走 %d 个；建网每网仍只抽 %d 细胞，统计口径不变）"
    % ("未触发" if n_pop_sampled == 0 else "已触发", EXPR_CELL_CAP, EXPR_CELL_CAP, n_pop_sampled, N_SAMP_CELLS),
    "ko_gene=%s source=%s expression_fraction=%.4f（基因闸 %.2f）"
    % (ko_symbol_gene, KO_GENE_SOURCE, ko_fraction, QC_MIN_PERCENT),
    "ko_missing_policy=靶基因未注入 exit 2；不在矩阵或表达闸不过 fail exit 1；任何情况下不替换基因、不静默兜底",
    "qc_adaptation=sc_QC min_lib_size 1000 -> %g（核内 mRNA 少）, max_mito_ratio 0.1 -> %.2f"
    "（与 qc_nuclei pct_mito<20 同口径）, min_percent 保持 %.2f（包默认）。"
    % (QC_MIN_LIB_SIZE, QC_MAX_MITO, QC_MIN_PERCENT),
    "qc_effect=细胞 %d -> %d（剔 %d），基因 %d -> %d（剔 %d）"
    % (expr.shape[1], n_cells_qc, expr.shape[1] - n_cells_qc,
       expr.shape[0], n_genes_net, expr.shape[0] - n_genes_net),
    "dr_genes=%d significant(adj p<%.2f)=%d 含敲除基因 / %d 不含；敲除基因按 p-value 排名第 %d"
    % (dr_sorted.shape[0], SIG_LEVEL, n_sig_all, n_sig_non_ko, ko_rank),
    "",
    "TOP%d DR genes（剔除敲除基因自身，按 p-value 升序表内位置；DR=调控变化不是表达差异）:" % TOP_N,
]
for _, row in top_dr.iterrows():
    report_lines.append("  %-10s Distance=%.3e Z=%8.3f FC=%12.3f p=%.3e padj=%.3e"
                        % (row["Gene"], row["Distance"], row["Z"], row["FC"],
                           row["p-value"], row["adjusted p-value"]))
report_lines += [
    "",
    "limitation_note=1) DR genes（Differentially Regulated Gene）衡量敲除后调控关系变化，不是 DEG，"
    "不得与 limma/细胞级差异概念混用；",
    "2) 网络只用 DCM 群体细胞核：单群体网络无法区分疾病与正常的调控差异，结论是疾病态内的假设生成；",
    "3) 网络基因空间 = HVG %d 符号，sc_QC 后再剔低表达与高 MT 细胞核，DR 表只覆盖留网 %d 基因，"
    "未留网基因不等于无调控变化；" % (expr.shape[0], n_genes_net),
    "4) max_mito_ratio 从包默认 0.1 放宽到 0.20 是本线核转录组适配决定，跨研究不可比；",
    "5) scTenifold 结果为计算模拟不是实验验证；供假设生成，供人工复核；种子稳定性：换 seed 重跑",
    "头部 DR 重合高、尾部对抽样敏感，结论以头部显著基因为准。",
    "warnings:",
]
for message in captured:
    report_lines.append("  %s" % message[:300])
report_lines.append("outputs=%s, %s" % (DR_OUT, REPORT_OUT))
report_lines.append("elapsed_seconds=%.0f" % (time.time() - START))
with open(REPORT_OUT, "w", encoding="utf-8") as fh:
    fh.write("\n".join(report_lines) + "\n")

for line in report_lines:
    log(line)

with open(DR_OUT, "rb") as _fh:
    _digest = hashlib.sha256(_fh.read()).hexdigest()
with open(REPORT_OUT, "a", encoding="utf-8") as _fh:
    _fh.write("ko_dr_genes.tsv_sha256=%s\n" % _digest)
log("ko_adapt_done dr_genes=%d significant=%d elapsed=%.1fs"
    % (dr_sorted.shape[0], n_sig_non_ko, time.time() - START))
PYSCRIPT

# sha256 产物台账后置补登：k40 通用脚本存在才调。
if [ -x "/mnt/ssd/bio_data/ops/k40_step_sha_ledger.sh" ]; then
  "/mnt/ssd/bio_data/ops/k40_step_sha_ledger.sh" "$PWD" "$(basename "$REPORT_OUT")" > /dev/null 2>>"$0.ledger.err" \
  || echo "WARN sha256 ledger backfill failed, see $0.ledger.err" >&2
fi
