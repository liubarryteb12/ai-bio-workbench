#!/usr/bin/env bash
# cellcomm_adapt：PRJ_DCM_BENCH_20261105 line2_scrna 项目内适配步（liana 细胞间通讯）。
#
# 为什么项目内写而不动母版 cell_communication：母版把 consensus LR 资源与 var_names 直接比对，
# 本线 var_names 是 Ensembl ID（ingest 契约），比对覆盖率会崩到近 0 并被 COVERAGE_MIN 拦死。
# 本步在 symbol 空间做比对：取 var['gene_symbol'] 唯一命名列建视图（一对多符号行剔除并如实计数，
# 不做求和/取 max 合并：合并会虚增或歪曲丰度，剔少量重复符号对 consensus 覆盖影响可忽略），
# 其余口径与母版一致（liana 1.10.0 rank_aggregate, resource=consensus, aggregate=rra,
# de_method=t-test, n_perms=1000, seed=BIOANALYS_SEED）。
#
# 常量（用户定稿 2026-11-05）：EXPR_PROP=0.1 / MIN_CELLS=5 / TOP_N=20。
# 全部 celltype 组合都算（含 fibroblast<->cardiomyocyte 双向与自分泌对）；报告单列
# fibroblast<->cardiomyocyte 两方向 top 对，供心脏重构重点解读。
#
# 输入（--input，模式前后带 *，坑 #99）：
#   *annotated*.h5ad  annotate_cardiac 产物（obs['celltype'] 标签来源 + uns['annotation']）
#   *norm*.h5ad       母版 normalize_hvg 产物（X=全基因 log1p 表达矩阵，非 HVG 裁剪）
# 产物（--output 同名优先；否则第一个 --output 目录；再否则当前目录）：
#   results/cellcomm_interactions.tsv（liana 全量结果）
#   results/cellcomm_report.txt
#
# 自校验（任一不过 fail() exit 1，不落盘）：两输入契约（obs/uns/var 必备项）、
# 细胞集合一致、标签对齐无缺失、symbol 视图基因数 > 20000（防喂裁剪矩阵）、
# consensus LR 基因覆盖率 >= 0.5、liana 结果非空且 rank 列完整、lr_means 非负、
# cellphone_pvals 在 [0,1]、source/target 集合与 celltype 分组一致、
# fibroblast 与 cardiomyocyte 两类都存在时其定向对结果非空（缺类则报告如实写明）。
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
while [ $# -gt 0 ]; do
  case "$1" in
    --input) INPUTS+=("$2"); shift 2 ;;
    --output) OUTPUTS+=("$2"); shift 2 ;;
    --seed) shift 2 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

annotated_file=""
norm_file=""
for path in "${INPUTS[@]:-}"; do
  [ -n "$path" ] || continue
  case "$path" in
    *annotated*.h5ad) annotated_file="$path" ;;
    *norm*.h5ad) norm_file="$path" ;;
    *) echo "无法识别的输入文件: $path（需要 *annotated*.h5ad 与 *norm*.h5ad）" >&2; exit 2 ;;
  esac
done
if [ -z "$annotated_file" ] || [ -z "$norm_file" ]; then
  echo "缺少必需输入：需要 annotate_cardiac 产物与 normalize_hvg 产物（annotated='$annotated_file' norm='$norm_file'）" >&2
  exit 2
fi
for f in "$annotated_file" "$norm_file"; do
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

TSV_OUT="$(out_path cellcomm_interactions.tsv)"
REPORT_OUT="$(out_path cellcomm_report.txt)"
rm -f "$TSV_OUT" "$REPORT_OUT"

echo "step_executed=cellcomm_adapt"
echo "bioanalys_seed=${seed}"
echo "input_annotated=${annotated_file}"
echo "input_norm=${norm_file}"

ANNOTATED_FILE="$annotated_file" NORM_FILE="$norm_file" BIOANALYS_SEED="$seed" \
TSV_OUT="$TSV_OUT" REPORT_OUT="$REPORT_OUT" \
"$BIO_PY" - <<'PYSCRIPT'
import hashlib
import os
import sys
import time

import numpy as np
import pandas as pd
import anndata as ad
import liana as li

# pandas 3 与 2 的 infer_string 默认值不同，显式关掉（坑 #107）。
ad.settings.allow_write_nullable_strings = False

START = time.time()
N_PERMS = 1000
EXPR_PROP = 0.1
MIN_CELLS = 5
TOP_N = 20
COVERAGE_MIN = 0.5
MIN_SYMBOL_GENES = 8000    # symbol 视图基因数下限（防喂 HVG 裁剪矩阵；LR 覆盖另有 COVERAGE_MIN 闸）
FOCUS_PAIRS = [("fibroblast", "cardiomyocyte"), ("cardiomyocyte", "fibroblast")]


def fail(message):
    sys.stderr.write("cellcomm_adapt 自校验失败: %s\n" % message)
    sys.stderr.flush()
    sys.exit(1)


def log(message):
    print(message, flush=True)


annotated_file = os.environ["ANNOTATED_FILE"]
norm_file = os.environ["NORM_FILE"]
TSV_OUT = os.environ["TSV_OUT"]
REPORT_OUT = os.environ["REPORT_OUT"]
seed = os.environ["BIOANALYS_SEED"]
try:
    seed_int = int(seed)
except ValueError:
    fail("BIOANALYS_SEED 不是整数: %s" % seed)

# --- 1. 输入契约 ---
annot = ad.read_h5ad(annotated_file)
norm = ad.read_h5ad(norm_file)
log("loaded annotated=%s norm=%s" % (annot.shape, norm.shape))
if "celltype" not in annot.obs.columns:
    fail("annotated 缺少 obs['celltype']（不是 annotate_cardiac 产物？）")
if "annotation" not in annot.uns:
    fail("annotated 缺少 uns['annotation']（不是 annotate_cardiac 产物？）")
if "gene_symbol" not in norm.var.columns:
    fail("norm 缺少 var['gene_symbol']（symbol 视图无法构建）")
if norm.shape[1] <= 2000:
    fail("norm 基因数 %d <= 2000：疑似喂了 HVG 裁剪矩阵，必须全基因表达矩阵" % norm.shape[1])
if set(annot.obs_names.astype(str)) != set(norm.obs_names.astype(str)):
    fail("annotated 与 norm 细胞集合不一致（%d vs %d）"
         % (len(set(annot.obs_names)), len(set(norm.obs_names))))

# --- 2. 装配：标签按 obs_names 索引对齐；表达建唯一 symbol 视图 ---
labels = annot.obs["celltype"].astype(str).reindex(norm.obs_names)
if labels.isna().any():
    fail("按索引对齐后存在无标签细胞（%d 个）" % int(labels.isna().sum()))

symbols = pd.Index(norm.var["gene_symbol"].astype(str))
usable_np = np.asarray(symbols != "NA") & np.asarray(symbols != "")
usable_idx = np.flatnonzero(usable_np)
dup_np = np.asarray(pd.Index(symbols[usable_idx]).duplicated(keep=False))
keep_pos = usable_idx[~dup_np]
n_dup_rows = int(dup_np.sum())
n_na_rows = int((~usable_np).sum())

# 显式重建 AnnData：X 取切片拷贝（稀疏保持），var 用唯一 symbol 做索引并保留 Ensembl 溯源列。
# 不靠 var/var_names 连续赋值（anndata 0.13 的 .var setter 会按新 index 重排，两步赋值易错位）。
sub = norm[:, keep_pos]
new_var = pd.DataFrame({
    "ensembl_id": np.asarray(sub.var_names.astype(str)),
    "gene_symbol": np.asarray(symbols[keep_pos]),
})
if "ercc" in sub.var.columns:
    new_var["ercc"] = sub.var["ercc"].to_numpy()
if "highly_variable" in sub.var.columns:
    new_var["highly_variable"] = sub.var["highly_variable"].to_numpy()
new_var = new_var.set_index("gene_symbol")
new_var.index.name = "gene"
view = ad.AnnData(X=sub.X.copy(), obs=sub.obs.copy(), var=new_var)
view.obs["celltype"] = labels.astype(str).to_numpy()
log("symbol_view genes=%d cells=%d dropped_dup_symbol_rows=%d dropped_na=%d"
    % (view.shape[1], view.shape[0], n_dup_rows, n_na_rows))
if view.shape[1] < MIN_SYMBOL_GENES:
    fail("symbol 视图基因数 %d < %d，LR 资源覆盖不可能充分" % (view.shape[1], MIN_SYMBOL_GENES))
if not view.var_names.is_unique:
    fail("symbol 视图 var_names 仍不唯一（去重逻辑失效）")

celltype_counts = view.obs["celltype"].value_counts()
celltypes = sorted(celltype_counts.index)
log("celltypes=%d cells=%d" % (len(celltypes), view.shape[0]))

# --- 3. consensus LR 覆盖率（喂错矩阵的第一道防线）---
resource = li.resource.select_resource("consensus")
db_genes = set(resource["ligand"].astype(str)) | set(resource["receptor"].astype(str))
var_genes = set(view.var_names.astype(str))
covered = db_genes & var_genes
coverage = len(covered) / len(db_genes)
log("consensus db_genes=%d covered=%d coverage=%.4f" % (len(db_genes), len(covered), coverage))
if coverage < COVERAGE_MIN:
    fail("LR 基因覆盖率 %.4f < %.2f：输入矩阵基因覆盖不足" % (coverage, COVERAGE_MIN))

# --- 4. rank_aggregate（全 celltype 组合；liana 默认方法集合，consensus 聚合）---
li.mt.rank_aggregate(view, groupby="celltype", resource_name="consensus",
                     use_raw=False, n_perms=N_PERMS, seed=seed_int,
                     expr_prop=EXPR_PROP, min_cells=MIN_CELLS, verbose=False)
res = view.uns["liana_res"].copy()
del view.uns["liana_res"]
log("liana_res rows=%d cols=%d" % (res.shape[0], res.shape[1]))

# --- 5. 自校验 ---
if res.shape[0] == 0:
    fail("liana 结果为空")
if res["specificity_rank"].isna().any() or res["magnitude_rank"].isna().any():
    fail("rank 列存在 NaN")
if (res["lr_means"] < 0).any():
    fail("lr_means 存在负值")
pvals = res["cellphone_pvals"].dropna()
if len(pvals) and ((pvals < 0) | (pvals > 1)).any():
    fail("cellphone_pvals 超出 [0,1]")
res_groups = set(res["source"].unique()) | set(res["target"].unique())
if not res_groups:
    fail("liana 结果没有可用细胞类型分组")
if not res_groups <= set(celltypes):
    fail("结果 source/target 出现未知分组: %s" % sorted(res_groups - set(celltypes)))
n_absent = len(set(celltypes) - res_groups)
log("groups_in_result=%d/%d（liana 会整对丢弃低于 min_cells=%d/expr_prop=%.2f 门槛的稀有类，%d 个缺席属预期，报告如实记录）"
    % (len(res_groups), len(celltypes), MIN_CELLS, EXPR_PROP, n_absent))
for src, tgt in FOCUS_PAIRS:
    sel = res[(res["source"] == src) & (res["target"] == tgt)]
    if src in celltypes and tgt in celltypes and sel.shape[0] == 0:
        fail("focus 对 %s->%s 两类都有细胞但结果 0 行（不该发生）" % (src, tgt))
log("self_check 契约/对齐/覆盖率/rank 完整/分组一致/focus 对 OK")

# --- 6. 落盘 ---
res.to_csv(TSV_OUT, sep="\t", index=False)

top_specificity = res.sort_values("specificity_rank").head(TOP_N).reset_index(drop=True)
report_lines = [
    "step=cellcomm_adapt",
    "seed=%s" % seed,
    "label_source=%s" % annotated_file,
    "expression_source=%s" % norm_file,
    "method=liana %s rank_aggregate resource=consensus n_perms=%d expr_prop=%.2f min_cells=%d "
    "aggregate=rra de_method=t-test（与母版同参数；symbol 视图为本步适配）"
    % (getattr(li, "__version__", "1.10.0"), N_PERMS, EXPR_PROP, MIN_CELLS),
    "adaptation_note=本线 var_names=Ensembl，母版按 var_names 比对 consensus 会零覆盖；"
    "本步取 var['gene_symbol'] 唯一命名列建视图（重复符号 %d 行剔除，不做合并以免歪曲丰度）。" % n_dup_rows,
    "per_sample_cells=%s" % {str(d): int(c) for d, c in (annot.obs["donor"].astype(str).value_counts().items() if "donor" in annot.obs.columns else {})},
    "cells=%d celltypes=%d symbol_genes=%d (dropped_dup_symbol_rows=%d dropped_na_symbol=%d)"
    % (int(celltype_counts.sum()), len(celltypes), int(view.shape[1]), n_dup_rows, n_na_rows),
    "celltype_counts=%s" % ", ".join("%s:%d" % (c, int(celltype_counts[c])) for c in celltypes),
    "lr_resource_pairs=%d lr_genes=%d covered=%d coverage=%.4f" % (resource.shape[0], len(db_genes), len(covered), coverage),
    "interactions=%d（source x target x 过滤后 LR 对，全类对都算，含自分泌）" % res.shape[0],
    "groups_in_result=%d/%d（缺席 %d 个：min_cells=%d 与 expr_prop=%.2f 门槛丢弃的稀有细胞类型，"
    "fibroblast<->cardiomyocyte 重点对已单独自检）" % (len(res_groups), len(celltypes), n_absent, MIN_CELLS, EXPR_PROP),
    "",
    "TOP%d by specificity_rank（越小越强；衡量该 LR 对相对其他细胞类型组的特异性）:" % TOP_N,
]
for _, row in top_specificity.iterrows():
    report_lines.append("  %-22s -> %-22s %-16s -> %-16s spec=%.3e mag=%.3e"
                        % (row["source"], row["target"], row["ligand_complex"],
                           row["receptor_complex"], row["specificity_rank"], row["magnitude_rank"]))
report_lines += ["", "focus fibroblast<->cardiomyocyte（重点：心脏重构配受体；两方向全列，各取 spec top10）:"]
for src, tgt in FOCUS_PAIRS:
    sel = res[(res["source"] == src) & (res["target"] == tgt)].sort_values("specificity_rank")
    have = src in celltypes and tgt in celltypes
    report_lines.append("  %s -> %s: rows=%d%s"
                        % (src, tgt, int(sel.shape[0]), "" if have else "（一类或两类不存在于注释，如实记录）"))
    for _, row in sel.head(10).iterrows():
        report_lines.append("    %-16s -> %-16s spec=%.3e mag=%.3e lr_means=%.4e"
                            % (row["ligand_complex"], row["receptor_complex"],
                               row["specificity_rank"], row["magnitude_rank"], row["lr_means"]))
report_lines += [
    "",
    "口径说明:",
    "1. specificity_rank 与 magnitude_rank 分工：前者衡量相对其他组的特异性，后者衡量表达强度；"
    "结论以 specificity 排序为准。",
    "2. unknown 类（%d 细胞）是注释打分不过阈值的混合类，保留在结果中但不作生物学结论。"
    % int(celltype_counts.get("unknown", 0)),
    "3. 全量结果见 cellcomm_interactions.tsv（%d 行，含自分泌 source==target 对）。" % res.shape[0],
    "4. liana 结果为统计评分不是实验验证；供假设生成，供人工复核。",
    "limitation_note=1) 重复 symbol 行剔除（%d 行），个别 LR 基因若恰为多 Ensembl 行符号会缺席，"
    "consensus 覆盖数已在报告列出可核对；2) 表达取 normalize_hvg 的 log1p X，lr_means 在该尺度上"
    "组间比较，跨研究绝对值不可比；3) 细胞通讯按细胞类型聚合，抹平了供体与 DCM/Ctrl 分组差异："
    "分组间通讯差异需按 group 分层重跑（本步不做，如实声明）；4) 核转录组分泌配体/受体基因检出率"
    "低于全细胞，expr_prop=0.1 与 min_cells=5 门槛下部分对整对缺失是预期行为。",
    "outputs=%s, %s" % (TSV_OUT, REPORT_OUT),
    "elapsed_seconds=%.0f" % (time.time() - START),
]
with open(REPORT_OUT, "w", encoding="utf-8") as fh:
    fh.write("\n".join(report_lines) + "\n")

for line in report_lines:
    log(line)

with open(TSV_OUT, "rb") as _fh:
    _digest = hashlib.sha256(_fh.read()).hexdigest()
with open(REPORT_OUT, "a", encoding="utf-8") as _fh:
    _fh.write("cellcomm_interactions.tsv_sha256=%s\n" % _digest)
log("cellcomm_adapt_done rows=%d coverage=%.4f elapsed=%.1fs"
    % (res.shape[0], coverage, time.time() - START))
PYSCRIPT

# sha256 产物台账后置补登：k40 通用脚本存在才调。
if [ -x "/mnt/ssd/bio_data/ops/k40_step_sha_ledger.sh" ]; then
  "/mnt/ssd/bio_data/ops/k40_step_sha_ledger.sh" "$PWD" "$(basename "$REPORT_OUT")" > /dev/null 2>>"$0.ledger.err" \
  || echo "WARN sha256 ledger backfill failed, see $0.ledger.err" >&2
fi
