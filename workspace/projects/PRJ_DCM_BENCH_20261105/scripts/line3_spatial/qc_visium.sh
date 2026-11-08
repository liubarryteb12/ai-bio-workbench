#!/usr/bin/env bash
# qc_visium：PRJ_DCM_BENCH_20261105 line3_spatial 项目内适配 spot 级 QC。
#
# 输入：ingest_visium.sh 产物 spatial_counts_mouse.h5ad（*.h5ad 自动识别）。
# 输出：processed/spatial_qc_mouse.h5ad + processed/spot_qc_metrics.tsv + processed/qc_report.txt
#
# 口径（写死于 python 顶部常量并回写报告）：
#   n_genes_by_counts ∈ [200, 6000]（心脏 Visium spot 经验带：200 以下多为空 spot/背景，
#     6000 以上多为双 spot/破损）；
#   total_counts ∈ [500, 60000]（上限依据：同平台小鼠 Visium 心脏 spot UMI 分布 p99.9 约
#     4~5 万，60000 为保守固定值，不随分位数自适应，保证可复现）；
#   pct_mito < 25（小鼠线粒体 gene_symbol 前缀是 mt-，与人类 MT- 不同，显式大小写匹配）。
#
# 与母版差异：不做双物种分支；in_tissue=0 的空位不单独剔除（ncount=0 必被 counts 下限
#   剔除，报告里单独给 in_tissue0 对账计数）。保留下游契约列/键并做 QC 后校验。
set -euo pipefail

seed="${BIOANALYS_SEED:-UNSET}"
if [ "$seed" = "UNSET" ]; then
  echo "BIOANALYS_SEED 未注入（引擎契约：seed 必须注入）" >&2
  exit 3
fi

PY="${BIO_PY:-/root/venvs/bio-py/bin/python3}"
if [ ! -x "$PY" ]; then
  echo "python 解释器不可执行: $PY（可用 BIO_PY 覆盖）" >&2
  exit 2
fi

declare -a INPUTS=()
output_count=0
while [ $# -gt 0 ]; do
  case "$1" in
    --input) INPUTS+=("$2"); shift 2 ;;
    --output) output_count=$((output_count + 1)); shift 2 ;;
    --seed) shift 2 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

h5ad_file=""
for path in "${INPUTS[@]:-}"; do
  [ -n "$path" ] || continue
  case "$path" in
    *.h5ad) h5ad_file="$path" ;;
    *) echo "无法识别的输入文件: $path（需要 ingest_visium 产物的 *.h5ad）" >&2; exit 2 ;;
  esac
done
if [ -z "$h5ad_file" ]; then
  echo "缺少必需输入：需要 ingest_visium 产物 spatial_counts_mouse.h5ad" >&2
  exit 2
fi
if [ ! -f "$h5ad_file" ]; then
  echo "输入文件不存在: $h5ad_file" >&2
  exit 2
fi

mkdir -p processed results figures

echo "step_executed=qc_visium"
echo "bioanalys_seed=${seed}"
echo "input_counts=${h5ad_file}"

QC_INPUT="$h5ad_file" BIOANALYS_SEED="$seed" "$PY" - <<'PYSCRIPT'
# -*- coding: utf-8 -*-
import json
import os
import sys
import time

import numpy as np
import pandas as pd
import anndata as ad

ad.settings.allow_write_nullable_strings = False

START = time.time()
# --- 写死口径（回写报告）---
MIN_GENES = 200
MAX_GENES = 6000
MIN_COUNTS = 500
MAX_COUNTS = 60000   # 同平台小鼠 Visium 心脏 spot UMI p99.9 约 4~5 万，取保守固定值
MAX_PCT_MITO = 25.0
MITO_PREFIX = ("mt-", "MT-")  # 小鼠线粒体 symbol 前缀 mt-；MT- 一并匹配防注释口径差异

def fail(message):
    sys.stderr.write("qc_visium 自校验失败: %s\n" % message)
    sys.stderr.flush()
    sys.exit(1)

def log(message):
    print(message, flush=True)

src = os.environ["QC_INPUT"]
seed = os.environ["BIOANALYS_SEED"]
a = ad.read_h5ad(src)

# --- 输入契约 ---
REQUIRED_OBS = ["barcode", "sample_id", "gsm", "species", "platform_id", "strain",
                "condition", "condition_class", "group", "tissue", "in_tissue",
                "array_row", "array_col", "pxl_row_fullres", "pxl_col_fullres",
                "ncount", "nfeature"]
missing_obs = [c for c in REQUIRED_OBS if c not in a.obs.columns]
if missing_obs:
    fail("输入缺少 obs 列 %s（不是 ingest_visium 产物？）" % missing_obs)
for key in ["spatial", "samples", "seed", "gene_id_type", "genome", "grouping_check"]:
    if key not in a.uns:
        fail("输入缺少 uns['%s']" % key)
if "spatial" not in a.obsm:
    fail("输入缺少 obsm['spatial']")
if "gene_symbol" not in a.var.columns:
    fail("输入缺少 var['gene_symbol']")
if str(a.uns.get("seed", "")) != seed:
    fail("输入 uns['seed']=%s 与本次 seed=%s 不一致" % (a.uns.get("seed"), seed))

# --- QC 指标 ---
X = a.X.tocsr()
kn = np.asarray(X.sum(axis=1)).ravel().astype(float)
kf = np.diff(X.indptr).astype(float)
symbols = a.var["gene_symbol"].astype(str).to_numpy()
mito_mask = np.zeros(len(symbols), dtype=bool)
used_prefix = []
for p in MITO_PREFIX:
    m = np.char.startswith(symbols.astype("U"), p)
    if m.any():
        mito_mask |= m
        used_prefix.append(p)
mito_counts = (np.asarray(X[:, mito_mask].sum(axis=1)).ravel().astype(float)
               if mito_mask.any() else np.zeros(a.n_obs))
pct_mito = np.divide(mito_counts, kn, out=np.zeros_like(mito_counts), where=kn > 0) * 100.0
a.obs["total_counts"] = kn
a.obs["n_genes_by_counts"] = kf
a.obs["pct_mito"] = pct_mito
if not mito_mask.any():
    log("WARN 未命中任何线粒体基因（前缀 %s），pct_mito 恒 0" % list(MITO_PREFIX))

keep = ((kf >= MIN_GENES) & (kf <= MAX_GENES)
        & (kn >= MIN_COUNTS) & (kn <= MAX_COUNTS)
        & (pct_mito < MAX_PCT_MITO))
kept = a[keep].copy()

# --- 逐样本 before/after 与剔除原因（原因可多重命中，分别计数）---
per_sample = []
for s in list(a.uns["samples"]):
    m = (a.obs["sample_id"] == s).to_numpy()
    k = m & keep
    if int(k.sum()) == 0:
        fail("样本 %s QC 后无剩余 spot" % s)
    row = {
        "sample": s,
        "before": int(m.sum()),
        "kept": int(k.sum()),
        "dropped": int((m & ~keep).sum()),
        "genes_low": int((m & (kf < MIN_GENES)).sum()),
        "genes_high": int((m & (kf > MAX_GENES)).sum()),
        "counts_low": int((m & (kn < MIN_COUNTS)).sum()),
        "counts_high": int((m & (kn > MAX_COUNTS)).sum()),
        "mito_high": int((m & (pct_mito >= MAX_PCT_MITO)).sum()),
        "in_tissue0_dropped": int((m & ~keep & (a.obs["in_tissue"].to_numpy() == 0)).sum()),
    }
    per_sample.append(row)
    log("sample=%s before=%d kept=%d dropped=%d" % (s, row["before"], row["kept"], row["dropped"]))

# --- QC 后契约校验 ---
obs_samples = set(kept.obs["sample_id"].unique().tolist())
if obs_samples != set(kept.uns["samples"]):
    fail("QC 后 uns['samples'] 与 obs sample_id 不一致")
if set(kept.uns["spatial"].keys()) != obs_samples:
    fail("QC 后 uns['spatial'] 样本集与 obs 不一致")
for c in REQUIRED_OBS + ["total_counts", "n_genes_by_counts", "pct_mito"]:
    if c not in kept.obs.columns:
        fail("QC 后丢了 obs 列 %s" % c)

kept.uns["qc"] = json.dumps({
    "min_genes": MIN_GENES, "max_genes": MAX_GENES,
    "min_counts": MIN_COUNTS, "max_counts": MAX_COUNTS,
    "max_pct_mito": MAX_PCT_MITO, "mito_prefix_used": used_prefix,
    "seed": seed, "source_h5ad": os.path.abspath(src), "per_sample": per_sample,
}, ensure_ascii=False)
kept.layers["counts"] = kept.X.copy()
out_h5ad = os.path.join("processed", "spatial_qc_mouse.h5ad")
kept.write_h5ad(out_h5ad)
log("wrote %s spots=%d genes=%d" % (out_h5ad, kept.n_obs, kept.n_vars))

metrics = pd.DataFrame({
    "spot_barcode": kept.obs_names.tolist(),
    "sample_id": kept.obs["sample_id"].to_numpy(),
    "group": kept.obs["group"].to_numpy(),
    "condition": kept.obs["condition"].to_numpy(),
    "condition_class": kept.obs["condition_class"].to_numpy(),
    "barcode": kept.obs["barcode"].to_numpy(),
    "array_row": kept.obs["array_row"].to_numpy(),
    "array_col": kept.obs["array_col"].to_numpy(),
    "total_counts": kept.obs["total_counts"].to_numpy(),
    "n_genes_by_counts": kept.obs["n_genes_by_counts"].to_numpy(),
    "pct_mito": kept.obs["pct_mito"].to_numpy(),
})
metrics_path = os.path.join("processed", "spot_qc_metrics.tsv")
metrics.to_csv(metrics_path, sep="\t", index=False)

rep = []
rep.append("step=qc_visium")
rep.append("seed=%s" % seed)
rep.append("input_counts=%s" % os.path.abspath(src))
rep.append("thresholds: n_genes_by_counts=[%d,%d]; total_counts=[%d,%d]; pct_mito<%.1f"
           % (MIN_GENES, MAX_GENES, MIN_COUNTS, MAX_COUNTS, MAX_PCT_MITO))
rep.append("counts_upper_basis=同平台小鼠 Visium 心脏 spot UMI p99.9 量级(4~5万)取保守固定 60000；不随分位自适应，保证可复现")
rep.append("mito_prefix_used=%s（小鼠为 mt-；MT- 一并匹配）" % (",".join(used_prefix) if used_prefix else "无命中"))
for row in per_sample:
    rep.append("sample %s: before=%d kept=%d dropped=%d genes_low=%d genes_high=%d counts_low=%d counts_high=%d mito_high=%d in_tissue0_dropped=%d"
               % (row["sample"], row["before"], row["kept"], row["dropped"], row["genes_low"], row["genes_high"],
                  row["counts_low"], row["counts_high"], row["mito_high"], row["in_tissue0_dropped"]))
rep.append("total_before=%d total_after=%d" % (a.n_obs, kept.n_obs))
rep.append("limitation_note=QC 阈值写死无项目级自适应；in_tissue=0 空点由 counts 下限兜住并单独对账；剔除原因可多重命中，分别计数不求和")
rep.append("elapsed_sec=%.1f" % (time.time() - START))
rep_path = os.path.join("processed", "qc_report.txt")
with open(rep_path, "w", encoding="utf-8") as fh:
    fh.write("\n".join(rep) + "\n")
log("wrote %s" % rep_path)
for line in rep:
    print(line)
PYSCRIPT

echo 'step_exit=qc_visium ok'
