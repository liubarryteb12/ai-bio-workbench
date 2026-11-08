#!/usr/bin/env bash
# qc_nuclei：PRJ_DCM_BENCH_20261105 line2_scrna 项目内适配步 2（细胞核 QC）。
#
# 为什么项目内写而不动母版 qc_cells：母版阈值绑定上一研究（GSE254707 Smart-seq2 皮肤全细胞）：
#   nCount_RNA > 50000、nFeature_RNA > 1500、ERCC 比例 < 0.15，且硬要求 var['ercc'] 有真实 spike-in。
# 本线是 10x 3' v3 snRNA-seq：核内 mRNA 少，母版下限会滤掉几乎全部细胞；nFeature 1500 下限对核过高；
# ERCC 在本数据集不存在（无 spike-in，恒 0）。换成核转录组常规口径（2026-11-05 定稿，写死不随结果调整）：
#   nFeature 200..6000（双向区间）、pct_mito < 20（MT- 前缀基因占库比例；核悬液本底高于单细胞）、
#   基因 min_cells=3。
#
# doublet 处置：默认不做。理由：10x 通道无 CIM-seq 式 doublet 标注（obs['class'] 恒 singlet），
# 本线 envs/manifest 无核悬液 doublet 评分工具，不新增依赖。处置口径写进
# uns['qc_doublet_disposition'] 与报告，风险（双核事件残留）写进 limitation_note。
#
# 输入：--input *.h5ad（步 1 ingest_10x 产物 scrna_counts.h5ad，必需）
# 产物：processed/scrna_qc.h5ad + processed/qc_cell_metrics.tsv + processed/qc_report.txt
#   同名 --output 优先；否则进第一个 --output 的目录；再否则当前目录（引擎 cwd=processed/）。
#
# 输出补齐部署母版下游（normalize_hvg / integrate_harmony / cluster_umap）的 REQUIRED 清单：
#   obs 9 列：donor/diagnosis/region/group/class/plate/well/celltype_paper/seurat_cluster_paper
#     （三母版只查列在位与 class!=doublet，本步全满足；annotate_celltypes 母版会因
#      celltype_paper=NA 失败，该步由项目内 annotate_cardiac.sh 替换，见报告 annotate_note）
#   var['ercc'] 保留（全 False；normalize_hvg 按它剔 spike-in，剔 0 条并如实记录）
#   uns：qc_thresholds / qc_doublet_disposition / qc_source_h5ad / seed（整数）
#   另加 scanpy 常用列 nCount_RNA/nFeature_RNA/pct_counts_mt 与 n_counts/n_genes 别名，便于人工复核。
#
# 自校验（任一不过 fail() exit 1，不落盘）：输入契约（obs/var/uns 必备项）、整数非负、
# computed 列与矩阵重算对账、阈值判定与保留集合一致、每组每供体至少 1 个保留细胞
# （不静默清空分组）、保留细胞 pct_mito 全部低于阈值、基因过滤后 >= 2001（下游 HVG 2000 可选出）、
# 输出 obs/var/uns 契约逐项在位。
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

h5ad_file=""
for path in "${INPUTS[@]:-}"; do
  [ -n "$path" ] || continue
  case "$path" in
    *.h5ad) h5ad_file="$path" ;;
    *) echo "无法识别的输入文件: $path（需要 *.h5ad，即步 1 ingest_10x 产物）" >&2; exit 2 ;;
  esac
done
if [ -z "$h5ad_file" ]; then
  echo "缺少必需输入：scrna_counts.h5ad（步 1 产物）未提供" >&2
  exit 2
fi
if [ ! -f "$h5ad_file" ]; then
  echo "输入文件不存在: $h5ad_file" >&2
  exit 2
fi

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

H5AD_OUT="$(out_path scrna_qc.h5ad)"
METRICS_OUT="$(out_path qc_cell_metrics.tsv)"
REPORT_OUT="$(out_path qc_report.txt)"
rm -f "$H5AD_OUT" "$METRICS_OUT" "$REPORT_OUT"

echo "step_executed=qc_nuclei"
echo "bioanalys_seed=${seed}"
echo "input_h5ad=${h5ad_file}"

H5AD_FILE="$h5ad_file" BIOANALYS_SEED="$seed" \
H5AD_OUT="$H5AD_OUT" METRICS_OUT="$METRICS_OUT" REPORT_OUT="$REPORT_OUT" \
"$BIO_PY" - <<'PYSCRIPT'
import hashlib
import os
import sys
import time

import numpy as np
import pandas as pd
import anndata as ad

# pandas 3 与 2 的 infer_string 默认值不同，写 obs 字符串列会崩，显式关掉（坑 #107）。
ad.settings.allow_write_nullable_strings = False

START = time.time()

# 核转录组阈值（写死，2026-11-05 定稿；调整阈值 = 新项目决策，不在脚本里热切换）。
NFEATURE_MIN = 200          # 检出基因数下限（含 ERCC 语义位，本数据无 spike-in）
NFEATURE_MAX = 6000         # 上限：核悬液极高检出数多为破碎核/多核事件与背景污染
PCT_MITO_MAX = 20.0         # MT- 基因计数占库百分比上限（核悬液宽松于单细胞的 5-10 常规线）
GENE_MIN_CELLS = 3          # 基因在保留细胞中的表达细胞数下限
MIN_GENES_AFTER = 2001      # 输出基因数下限（normalize_hvg 要选 2000 HVG，需留余量）

REQUIRED_OBS = ["donor", "diagnosis", "region", "group", "class", "plate", "well",
                "ncount_computed", "nfeature_computed", "ercc_fraction_computed",
                "celltype_paper", "seurat_cluster_paper"]
DOWNSTREAM_REQUIRED = ["donor", "diagnosis", "region", "group", "class", "plate", "well",
                       "celltype_paper", "seurat_cluster_paper"]
REQUIRED_UNS = ["region_to_group", "seed", "source_counts_tar", "source_gpl_soft", "grouping_check"]


def fail(message):
    sys.stderr.write("qc_nuclei 自校验失败: %s\n" % message)
    sys.stderr.flush()
    sys.exit(1)


def log(message):
    print(message, flush=True)


def count_dict(series):
    return {str(name): int(count) for name, count in series.value_counts().items()}


h5ad_file = os.environ["H5AD_FILE"]
seed = os.environ["BIOANALYS_SEED"]
try:
    seed_int = int(seed)
except ValueError:
    fail("BIOANALYS_SEED 不是整数: %s" % seed)

adata = ad.read_h5ad(h5ad_file)
log("loaded cells=%d genes=%d" % adata.shape)

# --- 1. 输入契约：必须是步 1 产物（防喂错文件）---
missing_obs = [c for c in REQUIRED_OBS if c not in adata.obs.columns]
if missing_obs:
    fail("输入 h5ad 缺少 obs 列 %s（不是 ingest_10x 产物？）" % missing_obs)
for col in ["ercc", "gene_symbol"]:
    if col not in adata.var.columns:
        fail("输入 h5ad 缺少 var['%s']（不是 ingest_10x 产物？）" % col)
missing_uns = [k for k in REQUIRED_UNS if k not in adata.uns]
if missing_uns:
    fail("输入 h5ad 缺少 uns 键 %s（不是 ingest_10x 产物？）" % missing_uns)
if not np.issubdtype(adata.X.dtype, np.integer):
    fail("输入 X dtype %s 非整数" % adata.X.dtype)
if adata.X.data.size and adata.X.data.min() < 0:
    fail("输入矩阵含负计数")

X = adata.X.tocsr()
ercc_mask = adata.var["ercc"].to_numpy(dtype=bool)
symbols_upper = pd.Index(adata.var["gene_symbol"].astype(str)).str.upper()
mito_mask = np.asarray(symbols_upper.str.startswith("MT-")) & ~ercc_mask
log("mito_genes=%d ercc_genes=%d" % (int(mito_mask.sum()), int(ercc_mask.sum())))
if int(mito_mask.sum()) == 0:
    fail("MT- 前缀基因 0 个：gene_symbol 口径异常，pct_mito 无法计算")

# --- 2. 每细胞指标（从矩阵重算，判定唯一口径）---
ncount = np.asarray(X.sum(axis=1)).ravel().astype(np.int64)
nfeature = np.asarray((X > 0).sum(axis=1)).ravel().astype(np.int64)
mito_count = np.asarray(X[:, mito_mask].sum(axis=1)).ravel().astype(np.int64)
ercc_count = np.asarray(X[:, ercc_mask].sum(axis=1)).ravel().astype(np.int64)
pct_mito = np.where(ncount > 0, 100.0 * mito_count / np.maximum(ncount, 1), 0.0)

# 与步 1 computed 列对账（口径漂移即失败）
if not np.array_equal(ncount, adata.obs["ncount_computed"].to_numpy(dtype=np.int64) + ercc_count):
    fail("ncount 口径不一致：矩阵重算 != ncount_computed + ercc_count")
if not np.array_equal(nfeature, adata.obs["nfeature_computed"].to_numpy(dtype=np.int64) +
                      np.asarray((X[:, ercc_mask] > 0).sum(axis=1)).ravel().astype(np.int64)):
    fail("nfeature 口径不一致：矩阵重算 != nfeature_computed + ercc 检出数")
log("computed 列口径一致 OK")

# --- 3. 阈值判定 ---
fail_nfeature_low = nfeature < NFEATURE_MIN
fail_nfeature_high = nfeature > NFEATURE_MAX
fail_mito = pct_mito >= PCT_MITO_MAX
qc_pass = ~(fail_nfeature_low | fail_nfeature_high | fail_mito)
is_doublet = (adata.obs["class"].astype(str) == "doublet").to_numpy()
kept = qc_pass & ~is_doublet
log("fail_nfeature_low=%d fail_nfeature_high=%d fail_mito=%d qc_pass=%d doublet=%d kept=%d"
    % (fail_nfeature_low.sum(), fail_nfeature_high.sum(), fail_mito.sum(),
       qc_pass.sum(), is_doublet.sum(), kept.sum()))

reason_parts = []
for i in range(adata.shape[0]):
    parts = []
    if is_doublet[i]:
        parts.append("doublet")
    if fail_nfeature_low[i]:
        parts.append("nfeature<%d" % NFEATURE_MIN)
    if fail_nfeature_high[i]:
        parts.append("nfeature>%d" % NFEATURE_MAX)
    if fail_mito[i]:
        parts.append("pct_mito>=%.1f" % PCT_MITO_MAX)
    reason_parts.append("+".join(parts))
fail_reason = np.array(reason_parts, dtype=object)

# --- 4. 基因过滤：保留细胞中表达细胞数 >= GENE_MIN_CELLS ---
gene_ncells = np.asarray((X[kept] > 0).sum(axis=0)).ravel()
gene_keep = gene_ncells >= GENE_MIN_CELLS
log("gene_filter min_cells>=%d kept=%d dropped=%d (mito kept=%d, ercc kept=%d)"
    % (GENE_MIN_CELLS, int(gene_keep.sum()), int((~gene_keep).sum()),
       int((gene_keep & mito_mask).sum()), int((gene_keep & ercc_mask).sum())))

# --- 5. 自校验（落盘前）---
if kept.sum() == 0:
    fail("QC 后无细胞保留")
if int(gene_keep.sum()) < MIN_GENES_AFTER:
    fail("QC 后基因数 %d < %d，下游 HVG 2000 无法选出" % (int(gene_keep.sum()), MIN_GENES_AFTER))
for col in ["group", "donor"]:
    for value, total in adata.obs[col].value_counts().items():
        kept_in = int(((adata.obs[col] == value).to_numpy() & kept).sum())
        if kept_in == 0:
            fail("%s=%s 的细胞被全部滤掉（%d 个），不允许静默清空分组" % (col, value, total))
if not np.array_equal(kept, qc_pass & ~is_doublet):
    fail("保留集合与阈值判定逻辑不一致")
kept_matrix = X[kept][:, gene_keep]
if kept_matrix.data.size and kept_matrix.data.min() < 0:
    fail("输出矩阵存在负计数")
kept_mito_max = float(pct_mito[kept].max())
if kept_mito_max >= PCT_MITO_MAX:
    fail("保留细胞里仍有 pct_mito >= %.1f 的细胞" % PCT_MITO_MAX)
for col in DOWNSTREAM_REQUIRED:
    if col not in adata.obs.columns:
        fail("下游母版 required obs 列缺失: %s" % col)
log("self_check 保留集合/分组非空/基因数下限/无负值/MT 上限/下游契约 OK")

# --- 6. 落盘 h5ad ---
out = adata[kept][:, gene_keep].copy()
knc = ncount[kept]
knf = nfeature[kept]
kmito = mito_count[kept]
kpct = pct_mito[kept]
kercc = ercc_count[kept]
out.obs["nCount_RNA"] = knc
out.obs["nFeature_RNA"] = knf
out.obs["n_counts"] = knc
out.obs["n_genes"] = knf
out.obs["pct_counts_mt"] = kpct
out.obs["mito_count"] = kmito
out.obs["ncount_computed"] = (knc - kercc).astype(np.int64)
out.obs["nfeature_computed"] = (knf - np.asarray(
    (X[kept][:, ercc_mask] > 0).sum(axis=1)).ravel().astype(np.int64)).astype(np.int64)
out.obs["ercc_fraction_computed"] = np.where(knc > 0, kercc / np.maximum(knc, 1), 0.0)
out.obs["qc_status"] = np.where(fail_reason[kept] == "", "pass", fail_reason[kept])
out.var["n_cells_expressing"] = gene_ncells[gene_keep]
out.var["mito"] = mito_mask[gene_keep]
# var['ercc'] 全 False 保留：normalize_hvg 按它剔 spike-in（剔 0 条并如实记录）
out.uns["qc_thresholds"] = {
    "nfeature_min": NFEATURE_MIN,
    "nfeature_max": NFEATURE_MAX,
    "pct_mito_max": PCT_MITO_MAX,
    "gene_min_cells": GENE_MIN_CELLS,
    "ncount_min": 0,
    "note": "核转录组口径（10x 3' v3 snRNA-seq）。母版 qc_cells 的 nCount>50000/nFeature>1500/"
            "ERCC<0.15 是 Smart-seq2 全细胞口径，对本数据不适用；替换为 nFeature 200-6000 + pct_mt<20。",
}
out.uns["qc_doublet_disposition"] = "not_tested_no_doublet_caller_in_env"
out.uns["qc_doublet_note"] = ("10x 通道无 CIM-seq 式 doublet 标注，obs['class'] 恒 singlet；"
                              "本线 envs/manifest 无核悬液 doublet 评分工具，不新增依赖，默认不做。"
                              "风险：双核事件残留可能形成虚假中间态簇，见报告 limitation_note。")
out.uns["qc_source_h5ad"] = h5ad_file
out.uns["qc_mito_definition"] = "var['gene_symbol'] 大写前缀 MT-（var_names 是 Ensembl ID）"
out.uns["qc_mito_genes_kept"] = int((gene_keep & mito_mask).sum())
out.uns["qc_ercc_genes_kept"] = int((gene_keep & ercc_mask).sum())
out.uns["seed"] = seed_int
out.write_h5ad(H5AD_OUT)

# --- 7. 全细胞指标表（含被剔除者，可审计）---
metrics = pd.DataFrame({
    "cell_id": adata.obs_names.astype(str),
    "sample": adata.obs["donor"].astype(str).to_numpy(),
    "gsm": (adata.obs["gsm"].astype(str).to_numpy()
            if "gsm" in adata.obs.columns else np.full(adata.shape[0], "NA", dtype=object)),
    "donor": adata.obs["donor"].astype(str).to_numpy(),
    "diagnosis": adata.obs["diagnosis"].astype(str).to_numpy(),
    "group": adata.obs["group"].astype(str).to_numpy(),
    "region": adata.obs["region"].astype(str).to_numpy(),
    "class": adata.obs["class"].astype(str).to_numpy(),
    "nfeature": nfeature,
    "ncount": ncount,
    "mito_count": mito_count,
    "pct_mito": np.round(pct_mito, 6),
    "ercc_count": ercc_count,
    "fail_nfeature_low": fail_nfeature_low,
    "fail_nfeature_high": fail_nfeature_high,
    "fail_mito": fail_mito,
    "qc_pass": qc_pass,
    "is_doublet": is_doublet,
    "kept": kept,
    "fail_reason": fail_reason,
})
metrics.to_csv(METRICS_OUT, sep="\t", index=False)

kept_frame = pd.DataFrame({
    "group": adata.obs["group"].astype(str).to_numpy()[kept],
    "donor": adata.obs["donor"].astype(str).to_numpy()[kept],
    "nfeature": knf, "ncount": knc, "pct_mito": kpct,
})

report_lines = [
    "step=qc_nuclei",
    "seed=%s" % seed,
    "input_h5ad=%s" % h5ad_file,
    "thresholds=nFeature %d..%d（双向区间）, pct_mito<%.1f（MT- 前缀，占库百分比）, gene_min_cells>=%d"
    % (NFEATURE_MIN, NFEATURE_MAX, PCT_MITO_MAX, GENE_MIN_CELLS),
    "threshold_rationale=母版 qc_cells 的 nCount>50000 / nFeature>1500 / ERCC<0.15 是 GSE254707 "
    "Smart-seq2 全细胞口径；本线为 10x 3' v3 细胞核，核内 mRNA 少（nCount 典型 1e3~2e4），"
    "按母版阈值会滤掉几乎全部细胞，且本数据无 spike-in（ERCC 恒 0），故换核转录组常规区间阈值。"
    "阈值写死，不随结果调整。",
    "cells_before=%d genes_before=%d (mito=%d ercc=%d)"
    % (adata.shape[0], adata.shape[1], int(mito_mask.sum()), int(ercc_mask.sum())),
    "fail_nfeature_low=%d fail_nfeature_high=%d fail_mito=%d qc_pass=%d"
    % (fail_nfeature_low.sum(), fail_nfeature_high.sum(), fail_mito.sum(), qc_pass.sum()),
    "doublet_disposition=不做（默认）：10x 通道无 doublet 标注（obs['class'] 恒 singlet），"
    "本线无核悬液 doublet 评分工具且不新增依赖；uns['qc_doublet_disposition']=not_tested_no_doublet_caller_in_env。",
    "doublet_total=%d" % int(is_doublet.sum()),
    "cells_kept=%d genes_kept=%d (genes_dropped=%d, mito_kept=%d)"
    % (int(kept.sum()), int(gene_keep.sum()), int((~gene_keep).sum()), int((gene_keep & mito_mask).sum())),
    "cells_after=%d genes_after=%d" % out.shape,
    "kept_by_group=%s" % count_dict(kept_frame["group"]),
    "kept_by_donor=%s" % count_dict(kept_frame["donor"]),
    "per_sample_kept:",
]
for donor in sorted(kept_frame["donor"].unique()):
    m = kept_frame["donor"] == donor
    before = int((adata.obs["donor"].astype(str) == donor).sum())
    report_lines.append("  %s kept=%d/%d median_nfeature=%.0f median_ncount=%.0f median_pct_mito=%.3f"
                        % (donor, int(m.sum()), before,
                           float(kept_frame[m]["nfeature"].median()),
                           float(kept_frame[m]["ncount"].median()),
                           float(kept_frame[m]["pct_mito"].median())))
report_lines += [
    "kept_median_nfeature=%.0f kept_median_ncount=%.0f kept_median_pct_mito=%.3f kept_max_pct_mito=%.3f"
    % (float(kept_frame["nfeature"].median()), float(kept_frame["ncount"].median()),
       float(kept_frame["pct_mito"].median()), kept_mito_max),
    "downstream_contract=obs 9 列齐（donor/diagnosis/region/group/class/plate/well/celltype_paper/"
    "seurat_cluster_paper）、var['ercc'] 在位（全 False）、uns 三键（qc_thresholds/qc_doublet_disposition/"
    "qc_source_h5ad）+ seed 整数已写；normalize_hvg / integrate_harmony / cluster_umap 可原样跑部署母版。",
    "annotate_note=部署母版 annotate_celltypes 会因 celltype_paper=NA 失败（它要求作者注释无 NA 并做 paper 映射），"
    "注释步由项目内 annotate_cardiac.sh 替换。",
    "metrics_file=qc_cell_metrics.tsv 含全部细胞（含被剔除者）的指标与去留原因，可审计。",
    "limitation_note=1) 未做 doublet 剔除：核悬液双核/多核事件会留在主矩阵，可能形成虚假中间态簇，"
    "解释簇结构时注意；2) pct_mito<20 是核悬液宽松口径，线粒体本底与碎裂细胞残片的分离不彻底；"
    "3) Fetal 三例按设计保留（group=Fetal），不参与 DCM vs Ctrl 主对比但参与整合与聚类，"
    "其供体效应由 harmony batch=donor 吸收；4) 阈值调整属新项目决策，须重跑并留痕。",
    "elapsed_seconds=%.0f" % (time.time() - START),
    "outputs=%s, %s, %s" % (H5AD_OUT, METRICS_OUT, REPORT_OUT),
]
with open(REPORT_OUT, "w", encoding="utf-8") as fh:
    fh.write("\n".join(report_lines) + "\n")

for line in report_lines:
    log(line)

with open(H5AD_OUT, "rb") as _fh:
    _digest = hashlib.sha256(_fh.read()).hexdigest()
with open(REPORT_OUT, "a", encoding="utf-8") as _fh:
    _fh.write("scrna_qc.h5ad_sha256=%s\n" % _digest)
log("qc_nuclei_done cells=%d genes=%d elapsed=%.1fs" % (out.shape[0], out.shape[1], time.time() - START))
PYSCRIPT

# sha256 产物台账后置补登：k40 通用脚本存在才调（本地静态验证环境自然跳过）。
if [ -x "/mnt/ssd/bio_data/ops/k40_step_sha_ledger.sh" ]; then
  "/mnt/ssd/bio_data/ops/k40_step_sha_ledger.sh" "$PWD" "$(basename "$REPORT_OUT")" > /dev/null 2>>"$0.ledger.err" \
  || echo "WARN sha256 ledger backfill failed, see $0.ledger.err" >&2
fi
