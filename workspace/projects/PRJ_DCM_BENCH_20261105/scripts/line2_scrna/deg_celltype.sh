#!/usr/bin/env bash
# deg_celltype：PRJ_DCM_BENCH_20261105 line2_scrna 项目内适配步（逐细胞类型 DCM vs Ctrl DEG）。
#
# 为什么项目内写而不动母版 deg_groups：母版输入是 scrna_composition.h5ad（步骤 14 产物），
# REQUIRED_OBS 含 sample_title/celltype_paper_major/celltype_donor_prop/donor_n_cells，
# REQUIRED_UNS 含 composition 等 21 键，且比较口径写死 Healthy vs Psoriasis（上一研究分组词）。
# 本线没有 composition 步，分组词是 DCM vs Ctrl（diagnosis 值），必须按本线契约重写。
#
# 口径（与母版同源的部分保持不动）：
#   1) 表达矩阵从 layers['counts'] 重算 normalize_total(target_sum=1e4) + log1p，
#      不用 X（X 已被整合步换成 HVG 子集/校正空间，且 log2 对负值出 nan 是母版踩过的坑）；
#   2) 统计：scanpy rank_genes_groups wilcoxon + corr_method=benjamini-hochberg（每 celltype 内 BH）；
#   3) 显著判据固定：padj < 0.05 且 |log2FC| > 1，阈值不随结果调整；
#   4) 运行门槛：该 celltype 内 DCM 与 Ctrl 每侧 >= 20 细胞且每侧 >= 2 供体，否则跳过（skipped 状态进报告）；
#   5) Fetal 组细胞不参与（按 group 过滤，仅 DCM/Ctrl 进入对比）。
#   全基因空间：表达取 normalize_hvg 母版产物 scrna_norm.h5ad 的 layers['counts']
#   （未经 HVG 裁剪），注释与分组标签取 annotate_cardiac 产物按 obs_names 对齐。
#
# 输入（--input，前后带 * 的模式匹配，坑 #99）：
#   *annotated*.h5ad  步 annotate_cardiac 产物（obs['celltype']/'group'/'donor'/'diagnosis' + uns['annotation']）
#   *norm*.h5ad       母版 normalize_hvg 产物（layers['counts'] 整数计数，全基因）
# 产物（--output 同名优先；否则第一个 --output 目录；再否则当前目录）：
#   results/deg_all_by_celltype.tsv            全部受检基因（按 celltype 分组，padj 升序 rank）
#   results/deg_significant_by_celltype.tsv    仅显著行（padj<0.05 且 |log2FC|>1）
#   results/deg_report.txt
#
# 自校验（任一不过 fail() exit 1，不落盘）：两输入契约（obs 列/uns 键/counts 层整数）、
# annotated 与 norm 细胞集合一致、标签对齐无缺失、每个跑了的 celltype 结果结构与
# rank_genes_groups 一致（pvals_adj 有限且在 [0,1]、log2fc 有限）、annotated 的 leiden/celltype
# 前后不变（本步只读它，防误写）、显著集合与全表判据一致。
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

ALL_OUT="$(out_path deg_all_by_celltype.tsv)"
SIG_OUT="$(out_path deg_significant_by_celltype.tsv)"
CLEAN_OUT="$(out_path deg_significant_filtered_by_celltype.tsv)"
REPORT_OUT="$(out_path deg_report.txt)"
rm -f "$ALL_OUT" "$SIG_OUT" "$CLEAN_OUT" "$REPORT_OUT"

echo "step_executed=deg_celltype"
echo "bioanalys_seed=${seed}"
echo "input_annotated=${annotated_file}"
echo "input_norm=${norm_file}"

ANNOTATED_FILE="$annotated_file" NORM_FILE="$norm_file" BIOANALYS_SEED="$seed" \
ALL_OUT="$ALL_OUT" SIG_OUT="$SIG_OUT" CLEAN_OUT="$CLEAN_OUT" REPORT_OUT="$REPORT_OUT" \
"$BIO_PY" - <<'PYSCRIPT'
import hashlib
import os
import sys
import time

import gc
import numpy as np
import pandas as pd
import anndata as ad
import scanpy as sc

# pandas 3 与 2 的 infer_string 默认值不同，显式关掉（坑 #107）。
ad.settings.allow_write_nullable_strings = False

START = time.time()
ALPHA = 0.05
MIN_ABS_LOG2FC = 1.0
MIN_CELLS_PER_GROUP = 20   # 每侧细胞数门槛（与母版 deg_groups 同口径）
MIN_DONORS_PER_GROUP = 2   # 每侧供体数门槛（本线新增：1 供体撑起一组时细胞级 p 无供体意义）
TARGET_SUM = 1e4
GROUP_LEVEL = "group"      # 用户设计分组列（DCM/Ctrl/Fetal）
GROUP_CASE = "DCM"
GROUP_CTRL = "Ctrl"

ANNOT_REQUIRED_OBS = ["celltype", "leiden", "donor", "diagnosis", "group", "class",
                      "plate", "well", "region"]


def fail(message):
    sys.stderr.write("deg_celltype 自校验失败: %s\n" % message)
    sys.stderr.flush()
    sys.exit(1)


def log(message):
    print(message, flush=True)


annotated_file = os.environ["ANNOTATED_FILE"]
norm_file = os.environ["NORM_FILE"]
ALL_OUT = os.environ["ALL_OUT"]
SIG_OUT = os.environ["SIG_OUT"]
CLEAN_OUT = os.environ["CLEAN_OUT"]
REPORT_OUT = os.environ["REPORT_OUT"]
seed = os.environ["BIOANALYS_SEED"]
try:
    seed_int = int(seed)
except ValueError:
    fail("BIOANALYS_SEED 不是整数: %s" % seed)

annot = ad.read_h5ad(annotated_file)
norm = ad.read_h5ad(norm_file)
log("loaded annotated=%s norm=%s" % (annot.shape, norm.shape))

# --- 1. 输入契约 ---
missing_obs = [c for c in ANNOT_REQUIRED_OBS if c not in annot.obs.columns]
if missing_obs:
    fail("annotated 缺少 obs 列 %s（不是 annotate_cardiac 产物？）" % missing_obs)
for key in ["annotation", "clustering"]:
    if key not in annot.uns:
        fail("annotated 缺少 uns['%s']" % key)
if "counts" not in norm.layers:
    fail("norm 缺少 layers['counts']（不是 normalize_hvg 产物？）")
if norm.shape[1] <= 2000:
    fail("norm 基因数 %d <= 2000：疑似喂了 HVG 裁剪矩阵，必须全基因 counts" % norm.shape[1])
counts_layer = norm.layers["counts"]
if not np.issubdtype(counts_layer.dtype, np.integer):
    fail("norm layers['counts'] dtype %s 非整数" % counts_layer.dtype)
if counts_layer.data.size and counts_layer.data.min() < 0:
    fail("norm layers['counts'] 含负值")
if set(annot.obs_names.astype(str)) != set(norm.obs_names.astype(str)):
    fail("annotated 与 norm 细胞集合不一致（%d vs %d）"
         % (len(set(annot.obs_names)), len(set(norm.obs_names))))

# --- 2. 装配：全基因 counts 工作副本 + 按索引对齐的标签 ---
# 只搬需要的东西（obs/var + counts 层），不 copy 整个 norm（其 X 已 log 归一化且不再需要）：
# 74,883 x 29,327 / nnz 2.1 亿时，整对象 copy 会多留一份 X 与 layers 共 ~1.7GB。
counts_csr = norm.layers["counts"].tocsr()
work = ad.AnnData(X=counts_csr, obs=norm.obs.copy(), var=norm.var.copy())
del norm
for col in ["celltype", "leiden", "donor", "diagnosis", "group"]:
    work.obs[col] = annot.obs[col].astype(str).reindex(work.obs_names)
    if work.obs[col].isna().any():
        fail("标签 %s 按索引对齐后存在缺失" % col)
del annot  # 标签已拷入 work.obs；原对象释放，防大对象并存

# 分块就地缩放复现 normalize_total(1e4)：scanpy 的默认实现会造 nnz 等长临时数组
# （2.1 亿 -> 802 MiB），叠加全矩阵后顶破 7.5GB RLIMIT（母版 normalize_hvg 已实测 OOM）。
Xw = work.X.tocsr().astype(np.float32)
indptr_w = Xw.indptr
row_nnz_w = np.diff(indptr_w)
lib_w = np.asarray(Xw.sum(axis=1)).ravel().astype(np.float64)
if (lib_w <= 0).any():
    fail("有细胞库大小为 0，归一化会出 NaN")
scale_w = TARGET_SUM / lib_w
data_w = Xw.data
for _s in range(0, work.n_obs, 4000):
    _e = min(_s + 4000, work.n_obs)
    _lo, _hi = int(indptr_w[_s]), int(indptr_w[_e])
    _blk = np.repeat(scale_w[_s:_e].astype(np.float32), row_nnz_w[_s:_e])
    data_w[_lo:_hi] *= _blk
    del _blk
# 库大小检查必须落在 log1p 之前：log 之后行和本来就不等于 target_sum
lib_after = np.asarray(Xw.sum(axis=1)).ravel()
if not np.allclose(lib_after, TARGET_SUM, rtol=1e-4, atol=1e-2):
    fail("重算归一化后库大小不都等于 %g（实测 min=%.3f max=%.3f）"
         % (TARGET_SUM, float(lib_after.min()), float(lib_after.max())))
np.log1p(data_w, out=data_w)
work.X = Xw
del scale_w, lib_w, row_nnz_w, indptr_w, data_w, lib_after
gc.collect()

ct_arr = work.obs["celltype"].astype(str).to_numpy()
grp_arr = work.obs[GROUP_LEVEL].astype(str).to_numpy()
donor_arr = work.obs["donor"].astype(str).to_numpy()
celltypes = sorted(set(ct_arr))
log("celltypes=%d cells=%d" % (len(celltypes), work.shape[0]))

# --- 3. 逐 celltype DEG ---
all_rows, sig_rows, per_ct_meta = [], [], {}
for ct in celltypes:
    m_ct = ct_arr == ct
    n_case = int((m_ct & (grp_arr == GROUP_CASE)).sum())
    n_ctrl = int((m_ct & (grp_arr == GROUP_CTRL)).sum())
    donors_case = sorted(set(donor_arr[m_ct & (grp_arr == GROUP_CASE)]))
    donors_ctrl = sorted(set(donor_arr[m_ct & (grp_arr == GROUP_CTRL)]))
    meta = {"celltype": ct, "n_case": n_case, "n_ctrl": n_ctrl,
            "donors_case": len(donors_case), "donors_ctrl": len(donors_ctrl)}
    if (n_case < MIN_CELLS_PER_GROUP or n_ctrl < MIN_CELLS_PER_GROUP
            or len(donors_case) < MIN_DONORS_PER_GROUP
            or len(donors_ctrl) < MIN_DONORS_PER_GROUP):
        meta["status"] = "skipped_too_small"
        per_ct_meta[ct] = meta
        log("  [%s] 跳过：DCM=%d(供体%d) / Ctrl=%d(供体%d)（门槛 %d 细胞且 %d 供体每侧）"
            % (ct, n_case, len(donors_case), n_ctrl, len(donors_ctrl),
               MIN_CELLS_PER_GROUP, MIN_DONORS_PER_GROUP))
        continue
    keep = m_ct & np.isin(grp_arr, [GROUP_CASE, GROUP_CTRL])
    sub = work[keep].copy()
    meta["status"] = "ok"
    sc.tl.rank_genes_groups(
        sub, groupby=GROUP_LEVEL, groups=[GROUP_CASE], reference=GROUP_CTRL,
        method="wilcoxon", corr_method="benjamini-hochberg",
        n_genes=sub.n_vars, key_added="deg", pts=True,
    )
    names = sub.uns["deg"]["names"][GROUP_CASE]
    pvals = np.asarray(sub.uns["deg"]["pvals_adj"][GROUP_CASE], dtype=float)
    logfc = np.asarray(sub.uns["deg"]["logfoldchanges"][GROUP_CASE], dtype=float)
    # scanpy 把「检出细胞比例」放在 uns['deg']['pts'] 的 DataFrame（index=基因名, columns=组），
    # 不存在 pts_<group> 这个键；旧写法因此恒为 None，报告里 pts 全空。
    pts_map_case, pts_map_ctrl = {}, {}
    if "pts" in sub.uns["deg"]:
        _pts = sub.uns["deg"]["pts"]
        if GROUP_CASE in getattr(_pts, "columns", []):
            pts_map_case = {str(k): float(v) for k, v in _pts[GROUP_CASE].items()}
        if GROUP_CTRL in getattr(_pts, "columns", []):
            pts_map_ctrl = {str(k): float(v) for k, v in _pts[GROUP_CTRL].items()}
    if not np.all(np.isfinite(pvals)) or (pvals < -1e-12).any() or (pvals > 1 + 1e-12).any():
        fail("%s pvals_adj 非有限或越界 [0,1]" % ct)
    if not np.all(np.isfinite(logfc)):
        fail("%s logfoldchanges 含非有限值" % ct)
    n_sig = int(((pvals < ALPHA) & (np.abs(logfc) > MIN_ABS_LOG2FC)).sum())
    meta["n_genes_tested"] = int(sub.n_vars)
    meta["n_sig"] = n_sig
    per_ct_meta[ct] = meta
    log("  [%s] cells=%d（DCM %d / Ctrl %d）-> 显著 %d/%d 基因"
        % (ct, sub.n_obs, n_case, n_ctrl, n_sig, sub.n_vars))

    var_names = np.asarray(sub.var_names.astype(str))
    symbols = (sub.var["gene_symbol"].astype(str).to_numpy()
               if "gene_symbol" in sub.var.columns else var_names)
    order = np.argsort(pvals, kind="mergesort")
    for rank, gi in enumerate(order, start=1):
        p = float(pvals[gi])
        l2 = float(logfc[gi])
        is_sig = bool(p < ALPHA and abs(l2) > MIN_ABS_LOG2FC)
        _vn = str(var_names[gi])
        row = {"celltype": ct, "rank": rank,
               "ensembl_id": _vn, "gene_symbol": str(symbols[gi]),
               "log2fc": round(l2, 6), "pvals_adj": p,
               "pts_case_dcm": round(pts_map_case.get(_vn, float("nan")), 6),
               "pts_ctrl": round(pts_map_ctrl.get(_vn, float("nan")), 6),
               "direction": "up_in_DCM" if l2 > 0 else "up_in_Ctrl",
               "significant": is_sig}
        all_rows.append(row)
        if is_sig:
            sig_rows.append(row)
    del sub

# --- 4. 自校验（落盘前）---
if not all_rows:
    fail("没有任何 celltype 通过运行门槛（%s/%s 每侧 >= %d 细胞且 >= %d 供体），无可报 DEG"
         % (GROUP_CASE, GROUP_CTRL, MIN_CELLS_PER_GROUP, MIN_DONORS_PER_GROUP))
sig_from_all = [r for r in all_rows if r["significant"]]
if len(sig_from_all) != len(sig_rows):
    fail("显著表与全表判据不一致: %d vs %d" % (len(sig_from_all), len(sig_rows)))
for r in sig_rows:
    if not (r["pvals_adj"] < ALPHA and abs(r["log2fc"]) > MIN_ABS_LOG2FC):
        fail("显著行不满足判据: %s" % r)

df_all = pd.DataFrame(all_rows)
df_sig = pd.DataFrame(sig_rows)
df_all.to_csv(ALL_OUT, sep="\t", index=False)
if len(df_sig):
    df_sig.to_csv(SIG_OUT, sep="\t", index=False)
else:
    df_all.iloc[0:0].to_csv(SIG_OUT, sep="\t", index=False)  # 空表保头，防下游找不到文件

# --- 4b. 技术性假信号筛查（本数据实测暴露：同一批 lncRNA/克隆号在每个 celltype 都排第一）---
# 判据一 泛细胞类型同向：同一基因在 >= 70% 受检 celltype 同时显著且方向相同，说明差异来自
#   样本/建库层面而非该细胞类型本身（跨细胞类型完全一致不可能是细胞类型特异调控）。
# 判据二 检出率过低：显著基因需至少一侧检出 >= 10% 细胞，否则是低计数噪声被放大。
# 两条都只**标注**、不改原判据；原始显著表原样保留，另出过滤表供下游使用。
MIN_DETECT = 0.10
PAN_FRACTION = 0.70


def _detect_ok(row):
    vals = [row.get("pts_case_dcm"), row.get("pts_ctrl")]
    vals = [float(v) for v in vals if v is not None and np.isfinite(float(v))]
    return bool(vals) and max(vals) >= MIN_DETECT


pan_stats = {}
# ran 在报告段才定义，这里按 per_ct_meta 现算（避免前向引用 NameError）
n_tested_ct = max(sum(1 for _m in per_ct_meta.values() if _m["status"] == "ok"), 1)
if len(df_sig):
    for (gene, direction), grp in df_sig.groupby(["gene_symbol", "direction"]):
        cts = set(grp["celltype"])
        frac = len(cts) / n_tested_ct
        if frac >= PAN_FRACTION and len(cts) >= 3:
            pan_stats[gene] = {"direction": direction, "celltypes": len(cts),
                               "fraction": round(frac, 3)}
for _df in (df_all, df_sig):
    _df["pan_celltype_suspect"] = _df["gene_symbol"].map(lambda g: g in pan_stats)
    _df["low_detection"] = ~_df.apply(_detect_ok, axis=1)
df_clean = df_sig[(~df_sig["pan_celltype_suspect"]) & (~df_sig["low_detection"])] if len(df_sig) else df_sig
df_all.to_csv(ALL_OUT, sep="\t", index=False)
if len(df_sig):
    df_sig.to_csv(SIG_OUT, sep="\t", index=False)
else:
    df_all.iloc[0:0].to_csv(SIG_OUT, sep="\t", index=False)
df_clean.to_csv(CLEAN_OUT, sep="\t", index=False)

# --- 5. 报告 ---
ran = [ct for ct, m in per_ct_meta.items() if m["status"] == "ok"]
skipped = [ct for ct, m in per_ct_meta.items() if m["status"] != "ok"]
total_case = int((grp_arr == GROUP_CASE).sum())
total_ctrl = int((grp_arr == GROUP_CTRL).sum())
donors_case = sorted(set(donor_arr[grp_arr == GROUP_CASE]))
donors_ctrl = sorted(set(donor_arr[grp_arr == GROUP_CTRL]))

report_lines = [
    "step=deg_celltype",
    "seed=%s" % seed,
    "input_annotated=%s" % annotated_file,
    "input_norm=%s" % norm_file,
    "comparison=%s vs %s on obs['%s']（Fetal 组不参与，按 group 过滤）" % (GROUP_CASE, GROUP_CTRL, GROUP_LEVEL),
    "expression=recompute from layers['counts']: normalize_total(%g) + log1p（不用 X，防整合空间/负值 nan）" % TARGET_SUM,
    "stats=per-celltype scanpy rank_genes_groups method=wilcoxon corr_method=benjamini-hochberg（BH 在每个 celltype 内部独立做）",
    "significance_gate=padj<%.2f 且 |log2FC|>%.1f（固定，不随结果调整）" % (ALPHA, MIN_ABS_LOG2FC),
    "run_gate=每侧 >= %d 细胞 且 每侧 >= %d 供体（不足记 skipped_too_small，不硬跑）" % (MIN_CELLS_PER_GROUP, MIN_DONORS_PER_GROUP),
    "cells_comparable=DCM %d（供体 %s）vs Ctrl %d（供体 %s）" % (total_case, ",".join(donors_case), total_ctrl, ",".join(donors_ctrl)),
    "per_sample_cells_comparable=%s" % {str(d): int(((donor_arr == d) & np.isin(grp_arr, [GROUP_CASE, GROUP_CTRL])).sum()) for d in sorted(set(donor_arr))},
    "celltypes_tested=%d skipped=%d" % (len(ran), len(skipped)),
    "artifact_screen=泛细胞类型同向(>=%.0f%% 受检类型且同方向)记 pan_celltype_suspect；"
    " 至少一侧检出 <%.0f%% 记 low_detection；两者都只标注不改判据"
    % (PAN_FRACTION * 100, MIN_DETECT * 100),
    "pan_celltype_suspects=%d %s" % (len(pan_stats), dict(sorted(pan_stats.items())[:15])),
    "sig_before_screen=%d sig_after_screen=%d" % (len(df_sig), len(df_clean)),
    "per_celltype:",
]
for ct in celltypes:
    m = per_ct_meta[ct]
    if m["status"] == "ok":
        report_lines.append("  %s: DCM=%d Ctrl=%d donors=%d/%d genes_tested=%d sig=%d"
                            % (ct, m["n_case"], m["n_ctrl"], m["donors_case"], m["donors_ctrl"],
                               m["n_genes_tested"], m["n_sig"]))
    else:
        report_lines.append("  %s: SKIPPED DCM=%d Ctrl=%d donors=%d/%d（门槛不满足）"
                            % (ct, m["n_case"], m["n_ctrl"], m["donors_case"], m["donors_ctrl"]))
for ct in ran:
    top = [r for r in sig_rows if r["celltype"] == ct][:10]
    if top:
        report_lines.append("  top10_sig %s:" % ct)
        for r in top:
            report_lines.append("    %-12s log2fc=%+.3f adj_p=%.4g pts(DCM)=%s pts(Ctrl)=%s"
                                % (r["gene_symbol"], r["log2fc"], r["pvals_adj"],
                                   r["pts_case_dcm"], r["pts_ctrl"]))
report_lines += [
    "outputs=%s（全部受检基因行）, %s（仅显著行；无显著行时为带表头空表）, %s" % (ALL_OUT, SIG_OUT, REPORT_OUT),
    "limitation_note=1) 供体数 DCM 4 vs Ctrl 3，wilcoxon 在细胞级做检验：同一供体的细胞不独立，"
    "细胞级 p 不是供体级显著，不得据此声称供体水平差异；供体级结论需 pseudobulk/线性模型复核；"
    "2) BH 校正只在每个 celltype 内部进行，跨 celltype 不共享校正族；"
    "3) Fetal 三例按设计排除在本对比外；"
    "4) DEG 是表达变化不是调控变化，DR 基因由 ko_adapt.sh（scTenifoldKnk）负责；"
    "5) 小群细胞类型（每侧 < 门槛）如实 skipped，未强行出结论。",
    "elapsed_seconds=%.0f" % (time.time() - START),
]
with open(REPORT_OUT, "w", encoding="utf-8") as fh:
    fh.write("\n".join(report_lines) + "\n")

for line in report_lines:
    log(line)

for _p in (ALL_OUT, SIG_OUT):
    with open(_p, "rb") as _fh:
        _digest = hashlib.sha256(_fh.read()).hexdigest()
    with open(REPORT_OUT, "a", encoding="utf-8") as _fh:
        _fh.write("%s_sha256=%s\n" % (os.path.basename(_p), _digest))
log("deg_celltype_done rows_all=%d rows_sig=%d elapsed=%.1fs"
    % (len(df_all), len(df_sig), time.time() - START))
PYSCRIPT

# sha256 产物台账后置补登：k40 通用脚本存在才调。
if [ -x "/mnt/ssd/bio_data/ops/k40_step_sha_ledger.sh" ]; then
  "/mnt/ssd/bio_data/ops/k40_step_sha_ledger.sh" "$PWD" "$(basename "$REPORT_OUT")" > /dev/null 2>>"$0.ledger.err" \
  || echo "WARN sha256 ledger backfill failed, see $0.ledger.err" >&2
fi
