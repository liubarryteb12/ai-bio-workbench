#!/usr/bin/env bash
# deconv_visium：PRJ_DCM_BENCH_20261105 line3_spatial 适配版 NNLS 解卷积。
#
# 输入（--input 可重复；*.h5ad / 签名 *.tsv / *ortholog*.tsv 按文件名分流）：
#   1) domains/autocorr 阶段的主对象 processed/autocorr_mouse.h5ad（或 domains_mouse.h5ad）；
#   2) 细胞类型签名 TSV：Line 2 适配链产出的细胞类型平均表达谱（首列 gene_symbol 为人源
#      symbol，其余每列一个细胞类型；按 log1p 域，最大值 > 20 判为计数域并拒绝）。
#   3) 可选 mouse_human_orthologs.tsv（列 mouse_symbol,human_symbol 一类表头）。
#
# 硬性禁令：签名文件缺失/为空 → exit 2 明确失败并提示先跑 Line 2；禁止内置签名兜底。
# 物种映射：优先 ortholog 表；缺表时 symbol 大写同名精确匹配，报告如实给匹配率与未匹配数，
#   禁止假装有正式 ortholog 表。
#
# 输出：processed/deconv_mouse.h5ad（obs['celltype_nnls'] 首选类型 + 各类型比例列
#   obs['celltype_nnls_<CT>']）+ results/deconv_proportions.tsv + results/deconv_report.txt。
# 报告必写：主对比 n=1 vs 1，纤维化区 vs 正常区只能到描述级别。
# 内存：3 切片 x ~1.5 万 spot 全稀疏；NNLS 需要行块稠密化，按 1024 spot 分块，
#   块内稠密峰值 1024 x 匹配基因（实测上限 2 万）x 8B ≈ 160MB，远低于 RLIMIT 7.5GB。
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
sig_file=""
ortho_file=""
for path in "${INPUTS[@]:-}"; do
  [ -n "$path" ] || continue
  case "$path" in
    *.h5ad) h5ad_file="$path" ;;
    *ortholog*|*orthologs*) ortho_file="$path" ;;
    *.tsv) sig_file="$path" ;;
    *) echo "无法识别的输入文件: $path（需要 *.h5ad / 签名 *.tsv / *ortholog*.tsv）" >&2; exit 2 ;;
  esac
done

if [ -z "$h5ad_file" ]; then
  echo "缺少必需输入：需要 domains/autocorr 之后的 *.h5ad" >&2
  exit 2
fi
if [ ! -f "$h5ad_file" ]; then
  echo "输入文件不存在: $h5ad_file" >&2
  exit 2
fi
if [ -z "$sig_file" ]; then
  echo "缺少细胞类型签名 TSV：本适配禁止内置签名兜底。请先跑 Line 2 适配链产出 signatures.tsv（细胞类型平均表达谱，log1p 域）后 --input 传入" >&2
  exit 2
fi
if [ ! -f "$sig_file" ] || [ ! -s "$sig_file" ]; then
  echo "签名文件不存在或为空: $sig_file（禁止用域 marker 自签名静默替代）" >&2
  exit 2
fi
if [ -n "$ortho_file" ] && [ ! -f "$ortho_file" ]; then
  echo "ortholog 文件不存在: $ortho_file" >&2
  exit 2
fi

mkdir -p processed results figures
echo "step_executed=deconv_visium"
echo "bioanalys_seed=${seed}"
echo "input_h5ad=${h5ad_file}"
echo "input_signatures=${sig_file}"
echo "input_orthologs=${ortho_file:-（未提供，symbol 大写同名匹配）}"

DEC_INPUT="$h5ad_file" DEC_SIG="$sig_file" DEC_ORTHO="$ortho_file" BIOANALYS_SEED="$seed" "$PY" - <<'PYSCRIPT'
# -*- coding: utf-8 -*-
import json
import os
import sys
import time

import numpy as np
import pandas as pd
import anndata as ad
from scipy.optimize import nnls

ad.settings.allow_write_nullable_strings = False

START = time.time()
NNLS_CHUNK = 1024  # spot 分块稠密化上限（内存防线）

def fail(message):
    sys.stderr.write("deconv_visium 自校验失败: %s\n" % message)
    sys.stderr.flush()
    sys.exit(1)

def log(message):
    print(message, flush=True)

src = os.environ["DEC_INPUT"]
sig_path = os.environ["DEC_SIG"]
ortho_path = os.environ.get("DEC_ORTHO", "")
seed = os.environ["BIOANALYS_SEED"]

a = ad.read_h5ad(src)
for key in ["spatial", "samples", "domains", "qc", "seed"]:
    if key not in a.uns:
        fail("输入缺少 uns['%s']（不是 domains 之后的对象？）" % key)
for col in ["domain", "sample_id"]:
    if col not in a.obs.columns:
        fail("输入缺少 obs['%s']" % col)
if "gene_symbol" not in a.var.columns:
    fail("输入缺少 var['gene_symbol']")

# --- 签名读取与形态校验 ---
sig = pd.read_csv(sig_path, sep="\t")
celltypes = [c for c in sig.columns[1:]]
if not celltypes:
    fail("签名 TSV 除首列外没有细胞类型列: %s" % sig_path)
sig = sig.rename(columns={sig.columns[0]: "gene_symbol"})[["gene_symbol"] + celltypes]
sig["gene_symbol"] = sig["gene_symbol"].astype(str).str.strip()
if sig[celltypes].isna().to_numpy().any():
    fail("签名含 NaN")
max_val = float(sig[celltypes].to_numpy().max())
if max_val > 20:
    fail("签名最大值 %.1f > 20，疑似原始计数域；请上游先 log1p 归一再导出（本脚本按 log 域处理，不静默换口径）" % max_val)
if sig["gene_symbol"].duplicated().any():
    fail("签名 gene_symbol 重复")

# --- 物种映射 ---
map_mode = ""
m2h = {}
if ortho_path:
    ot = pd.read_csv(ortho_path, sep="\t")
    lower = {c.lower(): c for c in ot.columns}
    mc = next((lower[k] for k in ("mouse_symbol", "mouse", "symbol_mouse") if k in lower), None)
    hc = next((lower[k] for k in ("human_symbol", "human", "symbol_human") if k in lower), None)
    if mc and hc:
        pairs = ot[[mc, hc]].dropna()
        m2h = {str(x).strip().upper(): str(y).strip().upper() for x, y in
               zip(pairs[mc].tolist(), pairs[hc].tolist())}
        map_mode = "ortholog_table:%s" % os.path.basename(ortho_path)
    else:
        log("WARN ortholog 表头无法识别（%s），回退 symbol 同名匹配" % list(ot.columns))
if not m2h:
    map_mode = "symbol_exact_upper（无正式 ortholog 表：同名精确匹配，匹配率如实报告）"

sym_u = a.var["gene_symbol"].astype(str).str.strip().str.upper()
mapped = sym_u.map(lambda s: m2h.get(s, s)) if m2h else sym_u
sig_pos = {s: i for i, s in enumerate(sig["gene_symbol"].str.upper().tolist())}
gi_list, sj_list = [], []
for idx in range(a.n_vars):
    si = sig_pos.get(mapped.iloc[idx])
    if si is not None:
        gi_list.append(idx)
        sj_list.append(si)
gi = np.asarray(gi_list, dtype=int)
sj = np.asarray(sj_list, dtype=int)
n_matched = int(gi.size)
if n_matched < 50:
    fail("签名与矩阵 symbol 匹配基因数 %d < 50（物种映射或 symbol 口径不对，NNLS 无意义）" % n_matched)
match_rate = n_matched / a.n_vars
log("map_mode=%s matched=%d/%d rate=%.3f" % (map_mode, n_matched, a.n_vars, match_rate))

# --- NNLS（分块稠密化）---
S_mat = sig[celltypes].to_numpy(dtype=float)[sj, :]   # matched x celltypes
Xcsr = a.X.tocsr()
P = np.zeros((a.n_obs, len(celltypes)))
failed_rows = 0
solved = 0
for lo in range(0, a.n_obs, NNLS_CHUNK):
    hi = min(lo + NNLS_CHUNK, a.n_obs)
    block = np.asarray(Xcsr[lo:hi][:, gi].todense(), dtype=float)
    for r in range(block.shape[0]):
        b = block[r]
        if not np.any(b):
            failed_rows += 1
            continue
        try:
            x, _ = nnls(S_mat, b, maxiter=3000)
        except Exception:
            failed_rows += 1
            continue
        ssum = float(x.sum())
        if ssum > 0:
            P[lo + r] = x / ssum
            solved += 1
        else:
            failed_rows += 1
if solved == 0:
    fail("NNLS 全部失败")
log("nnls solved=%d/%d zero_or_failed=%d" % (solved, a.n_obs, failed_rows))

for k, ct in enumerate(celltypes):
    a.obs["celltype_nnls_%s" % ct] = np.round(P[:, k], 4)
a.obs["celltype_nnls"] = [celltypes[int(i)] if P[r].sum() > 0 else "unknown"
                          for r, i in enumerate(np.argmax(P, axis=1))]
a.uns["deconv"] = json.dumps({
    "method": "scipy.optimize.nnls per spot on matched symbols（log 域近似线性混合）",
    "signature": os.path.abspath(sig_path), "signature_cells": celltypes,
    "map_mode": map_mode, "matched_genes": n_matched, "total_genes": int(a.n_vars),
    "match_rate": round(match_rate, 4), "unmatched_genes": int(a.n_vars - n_matched),
    "failed_rows": int(failed_rows), "seed": seed,
}, ensure_ascii=False)
out_h5ad = os.path.join("processed", "deconv_mouse.h5ad")
a.write_h5ad(out_h5ad)

# --- 逐样本逐类型比例表 ---
rows = []
for s in list(a.uns["samples"]):
    m = (a.obs["sample_id"] == s).to_numpy()
    for k, ct in enumerate(celltypes):
        v = P[m, k]
        rows.append({"sample_id": s, "celltype": ct,
                     "median_fraction": float(np.median(v)),
                     "mean_fraction": float(np.mean(v)), "spots": int(m.sum())})
prop = pd.DataFrame(rows)
prop.to_csv(os.path.join("results", "deconv_proportions.tsv"), sep="\t", index=False)

rep = []
rep.append("step=deconv_visium")
rep.append("seed=%s" % seed)
rep.append("input_h5ad=%s" % os.path.abspath(src))
rep.append("signature=%s" % os.path.abspath(sig_path))
rep.append("celltypes=%s" % ",".join(celltypes))
rep.append("map_mode=%s" % map_mode)
rep.append("matched_genes=%d/%d rate=%.1f%% unmatched=%d（未匹配如实报告，不假装正式 ortholog）"
           % (n_matched, a.n_vars, 100 * match_rate, a.n_vars - n_matched))
rep.append("nnls solved=%d/%d zero_or_failed=%d" % (solved, a.n_obs, failed_rows))
for s in list(a.uns["samples"]):
    sub = prop[prop["sample_id"] == s]
    rep.append("sample %s median_fraction: %s"
               % (s, ", ".join("%s=%.3f" % (r.celltype, r.median_fraction) for r in sub.itertuples())))
rep.append("limitation_note=主对比 n=1 vs 1：纤维化区 vs 正常区的解卷积差异只能到描述级别，无组内重复不支持推断统计；签名为人源（Line 2），跨物种 symbol 映射偏差未量化；NNLS 线性混合假设作用于 log1p 域是近似；比例列仅对 solved spot 有效，zero-row 记 unknown")
rep.append("elapsed_sec=%.1f" % (time.time() - START))
rep_path = os.path.join("results", "deconv_report.txt")
with open(rep_path, "w", encoding="utf-8") as fh:
    fh.write("\n".join(rep) + "\n")
log("wrote %s" % rep_path)
for line in rep:
    print(line)
PYSCRIPT

echo 'step_exit=deconv_visium ok'
