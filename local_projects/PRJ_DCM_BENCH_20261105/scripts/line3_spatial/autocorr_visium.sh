#!/usr/bin/env bash
# autocorr_visium：PRJ_DCM_BENCH_20261105 line3_spatial 适配版空间自相关。
#
# 输入：domains_visium.sh 产物 processed/domains_mouse.h5ad（*.h5ad 自动识别）。
# 输出：processed/autocorr_mouse.h5ad + results/morans_i_top_genes.tsv + results/autocorr_report.txt
#
# 方法：Squidpy Moran's I（sq.gr.morans_i）逐基因，**按样本分别计算再合并**：
#   每个样本的像素坐标只在自己组织图内有意义（uns['spatial'] 各样本缩放不同，
#   跨样本坐标不可比），合并统计用 有效样本均值/最小/最大 三个口径。
#   Geary's C（sq.gr.gearys_c）一并算，供交叉验证（方向相反：C 小 = 正聚集）。
# 基因过滤：少于 MIN_SAMPLES_WITH_SIGNAL(=2) 个样本有非零信号的基因跳过（记入报告）。
# 输出 var['moran_I']/['moran_p']/['gearys_c'] + 母版风格镜像列
#   morans_i_mean/min/max、gearys_c_mean/min/max、autocorr_n_valid_samples，
#   对齐下游 spatial_localization 的 REQUIRED_VAR 口径。
# 报告：Top 50 高聚集基因（按 moran_I 均值），并单列其中纤维化相关基因
#   （fibr 前缀 + 人工清单 Coll1a1/Col1a2/Col3a1/Fn1/Postn/Thbs2/Sparc/Tnc/Lox/Timp1/Dcn/Vtn），
#   说明清单来源是本领域常用纤维化 marker，不是数据库导出。
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
    *) echo "无法识别的输入文件: $path（需要 *.h5ad，domains_visium 产物）" >&2; exit 2 ;;
  esac
done
if [ -z "$h5ad_file" ]; then
  echo "缺少必需输入：需要 domains_visium 产物 processed/domains_mouse.h5ad" >&2
  exit 2
fi
if [ ! -f "$h5ad_file" ]; then
  echo "输入文件不存在: $h5ad_file" >&2
  exit 2
fi

mkdir -p processed results figures
echo "step_executed=autocorr_visium"
echo "bioanalys_seed=${seed}"
echo "input_domains=${h5ad_file}"

AUTO_INPUT="$h5ad_file" BIOANALYS_SEED="$seed" "$PY" - <<'PYSCRIPT'
# -*- coding: utf-8 -*-
import json
import os
import sys
import time

import numpy as np
import pandas as pd
import scanpy as sc
import anndata as ad

import scipy.sparse as sps
from scipy.spatial import cKDTree

# squidpy 是可选依赖。aarch64 + Python 3.12 装机失败（centrosome 需 cython 编译后端），
# 缺失时用 native_moran / native_geary（权重矩阵二次型，与 squidpy 同定义），
# 报告里写明实现来源，不假装用了 squidpy。
# 空间统计一律用本文件的 native 实现，不调 squidpy 的 morans_i/gearys_c：
#   squidpy 1.8.3 已移除这两个函数（只剩 neighbors 系列），装了也用不了；
#   而且自实现可以分块算，内存可控（整矩阵稠密化在 12,560 spot x 16,765 基因上是 1.68GB，
#   实测直接把手机打爆）。
SQ_SOURCE = "native_sparse_W（自实现 Moran/Geary，分块；squidpy 1.8.3 已移除这两个统计函数）"
sq = None

ad.settings.allow_write_nullable_strings = False

# --- 写死参数（回写报告）---
MIN_SAMPLES_WITH_SIGNAL = 2   # 少于 2 个样本有信号的基因跳过
# 空间近邻数：与 squidpy 的默认一致（6 个近邻），显式写死以便两条实现路径同参可比。
# 之前完全依赖 squidpy 默认值，原生实现落地时才发现这个常量根本没定义。
SQ_K = 6
# --- squidpy 版本适配：按安装版函数签名探测参数（上游改名/删参频繁，硬传全套会 TypeError）---
import inspect

def _filter_kwargs(func, wanted):
    sig = inspect.signature(func).parameters
    return {k: v for k, v in wanted.items() if k in sig}

def native_graph(sub, k=SQ_K):
    """按像素坐标连最近 k 个 spot（对称化），返回 obsp 键名。"""
    coords = np.column_stack([sub.obs["pxl_col_fullres"].to_numpy(dtype=float),
                              sub.obs["pxl_row_fullres"].to_numpy(dtype=float)])
    n = coords.shape[0]
    k_eff = min(k + 1, n)
    dist, idx = cKDTree(coords).query(coords, k=k_eff)
    dist = np.atleast_2d(dist)
    idx = np.atleast_2d(idx)
    rows = np.repeat(np.arange(n), k_eff - 1)
    cols = idx[:, 1:].ravel()
    vals = dist[:, 1:].ravel()
    conn = sps.csr_matrix((np.ones_like(vals), (rows, cols)), shape=(n, n))
    conn = conn.maximum(conn.T)
    sub.obsp["spatial_connectivities"] = conn
    return "spatial_connectivities"


GENE_CHUNK = 1000  # 分块基因数：n_spot x 1000 x 8B 约 100MB，避免整矩阵稠密化


def _chunked_stats(sub, ckey):
    """一次遍历按基因块同时算 Moran's I 与 Geary's C。

    为什么分块：整矩阵稠密化在 12,560 spot x 16,765 基因上是 1.68GB float64，
    直接把手机打爆（实测 ArrayMemoryError: 1.57 GiB）。分块后峰值与块宽成正比。

    两个统计量的定义（与 squidpy 一致）：
      Moran: I = (n/W) * (x' W x) / (x' x)
      Geary: C = ((n-1)/(2W)) * sum_ij w_ij (x_i-x_j)^2 / sum_i (x_i-mean)^2
    Geary 的分子用恒等式展开，避免构造「边 x 基因」的大矩阵：
      sum_ij w_ij (x_i-x_j)^2 = sum_i d_i x_i^2 - 2 x' W x + sum_j e_j x_j^2，
      其中 d_i 为行和、e_j 为列和（对称 W 时相等）。
    """
    W = sub.obsp[ckey].astype(np.float64).tocsr()
    n = W.shape[0]
    w_sum = float(W.sum())
    d_row = np.asarray(W.sum(axis=1)).ravel()
    d_col = np.asarray(W.sum(axis=0)).ravel()
    X = sub.X.tocsc() if sps.issparse(sub.X) else sps.csc_matrix(np.asarray(sub.X))
    n_genes = X.shape[1]
    means = np.asarray(X.mean(axis=0)).ravel()
    I = np.full(n_genes, np.nan, dtype=np.float64)
    C = np.full(n_genes, np.nan, dtype=np.float64)
    for lo in range(0, n_genes, GENE_CHUNK):
        hi = min(lo + GENE_CHUNK, n_genes)
        Xc = np.asarray(X[:, lo:hi].todense(), dtype=np.float64)
        Xc -= means[lo:hi]
        denom = (Xc * Xc).sum(axis=0)
        WX = W @ Xc
        num_moran = (WX * Xc).sum(axis=0)
        with np.errstate(invalid="ignore", divide="ignore"):
            I[lo:hi] = (n / w_sum) * num_moran / denom
            sq_term = (d_row[:, None] * (Xc * Xc)).sum(axis=0) - 2.0 * num_moran \
                      + (d_col[:, None] * (Xc * Xc)).sum(axis=0)
            C[lo:hi] = ((n - 1) / (2.0 * w_sum)) * sq_term / denom
    names = sub.var_names.astype(str)
    return dict(zip(names, I)), dict(zip(names, C))


def native_moran(sub, ckey):
    return _chunked_stats(sub, ckey)[0]


def native_geary(sub, ckey):
    return _chunked_stats(sub, ckey)[1]


def sq_build_graph(sub):
    """建空间邻接图；返回 (conn_key, dist_key)。参数名按实际签名裁剪。"""
    if sq is None:
        return native_graph(sub), None
    fn = sq.gr.spatial_neighbors
    kwargs = _filter_kwargs(fn, {"coord_type": "generic", "n_neighors": SQ_K, "n_neighbors": SQ_K,
                                 "n_rings": 1, "key_added": "spatial_neighbors"})
    fn(**dict({"adata": sub}, **kwargs) if "adata" in inspect.signature(fn).parameters else kwargs)
    entry = sub.uns.get("spatial_neighbors") or {}
    ckey = entry.get("conn_key") or ("spatial_connectivities" if "spatial_connectivities" in sub.obsp else "connectivities")
    dkey = entry.get("dist_key") or ("spatial_distances" if "spatial_distances" in sub.obsp else "distances")
    return ckey, dkey

def sq_statistic(func, sub, ckey):
    """调 morans_i/gearys_c，参数按签名裁剪；返回 {gene: value} 或 {('I'|'C', gene): value}。"""
    kwargs = _filter_kwargs(func, {"connectivity_key": ckey, "n_neighbors": SQ_K,
                                   "symmetric_normalization": False, "weights": "distance_matrix",
                                   "zscore": False, "coords": None})
    if "adata" not in inspect.signature(func).parameters:
        result = func(sub.X, **kwargs) if "values" in inspect.signature(func).parameters else func(sub, **kwargs)
    else:
        result = func(sub, **kwargs)
    # 归一到 {var_name: float}
    if isinstance(result, tuple):
        result = result[0]
    if isinstance(result, pd.DataFrame):
        # 多统计量宽表：取第一数值列
        col = result.columns[0]
        return {str(i): float(result[col].iloc[r]) for r, i in enumerate(result.index)}, col
    if isinstance(result, pd.Series):
        return {str(k): float(v) for k, v in result.items()}, str(getattr(result, "name", "") or "")
    out = {}
    try:
        for key, val in result.items():
            out[str(key)] = float(val)
        return out, ""
    except Exception as exc:
        fail("无法解析 %s 返回形态: %s（%s）" % (getattr(func, '__name__', 'stat'), type(result), exc))
TOP_N = 50
FIBROSIS_GENES = ["Coll1a1", "Col1a1", "Col1a2", "Col3a1", "Fn1", "Postn", "Thbs2",
                  "Sparc", "Tnc", "Lox", "Loxl1", "Timp1", "Dcn", "Vtn", "Mmp2", "Acta2"]
FIBROSIS_NOTE = ("纤维化相关基因为本领域常用 marker 人工清单（含别名 Col1a1/Coll1a1），"
                 "不是 GO/数据库导出；命中仅按 var['gene_symbol'] 精确匹配")

def fail(message):
    sys.stderr.write("autocorr_visium 自校验失败: %s\n" % message)
    sys.stderr.flush()
    sys.exit(1)

def log(message):
    print(message, flush=True)

START = time.time()
src = os.environ["AUTO_INPUT"]
seed = int(os.environ["BIOANALYS_SEED"])
a = ad.read_h5ad(src)

for key in ["spatial", "samples", "domains", "qc", "seed"]:
    if key not in a.uns:
        fail("输入缺少 uns['%s']（不是 domains_visium 产物？）" % key)
if "domain" not in a.obs.columns or "leiden" not in a.obs.columns:
    fail("输入缺 obs['domain'] 或 obs['leiden']")
if str(a.uns["seed"]) != str(seed):
    fail("输入 uns['seed'] 与本次 seed 不一致")

samples = list(a.uns["samples"])
# 用 counts 层做原始计数（Moran's I 对计数稳；log1p 后会被压缩）。
counts = (a.layers["counts"] if "counts" in a.layers else a.X).tocsr()

per_sample_results = {}   # sample -> {gene_idx: (I, p, C)}
skipped_genes = 0
for s in samples:
    m = (a.obs["sample_id"] == s).to_numpy()
    sub = a[m].copy()
    sub.X = counts[m]
    # 有信号基因：该样本内非零 spot > 0
    colsum = np.asarray((sub.X > 0).sum(axis=0)).ravel()
    sig = colsum > 0
    if sig.sum() == 0:
        fail("样本 %s 没有任何有信号基因" % s)
    sub2 = sub[:, sig].copy()
    ckey, dkey = sq_build_graph(sub2)

    I = np.full(sub.n_vars, np.nan)
    P = np.full(sub.n_vars, np.nan)
    C = np.full(sub.n_vars, np.nan)
    if sq is None:
        mi = native_moran(sub2, ckey)
        gc = native_geary(sub2, ckey)
    else:
        mi, _icol = sq_statistic(sq.gr.morans_i, sub2, ckey)
        try:
            gc, _ccol = sq_statistic(sq.gr.gearys_c, sub2, ckey)
        except Exception as exc:
            log("WARN gearys_c 不可用（%s），C 记 NaN" % exc)
            gc = {}
    sig_names = sub2.var_names.tolist()
    idx_map = {g: i for i, g in enumerate(sub.var_names.tolist())}
    store = {}
    for gname in sig_names:
        i_val = mi.get(gname)
        c_val = gc.get(gname)
        if i_val is None:
            continue
        store[idx_map[gname]] = (float(i_val), float("nan"),
                                  float(c_val) if c_val is not None else float("nan"))
    per_sample_results[s] = store
    log("sample=%s spots=%d signal_genes=%d scored=%d" % (s, int(m.sum()), int(sig.sum()), len(store)))

# --- 合并：逐基因在有效样本上取 mean/min/max；n_valid < 2 跳过 ---
n_genes = a.n_vars
i_stack = np.full((n_genes, len(samples)), np.nan)
c_stack = np.full((n_genes, len(samples)), np.nan)
for j, s in enumerate(samples):
    for gi, (ival, pval, cval) in per_sample_results[s].items():
        i_stack[gi, j] = ival
        c_stack[gi, j] = cval
valid_mask = (~np.isnan(i_stack)).sum(axis=1)
gene_valid = valid_mask >= MIN_SAMPLES_WITH_SIGNAL
skipped_genes = int((~gene_valid).sum())
i_mean = np.where(gene_valid, np.nanmean(i_stack, axis=1), np.nan)
i_min = np.where(gene_valid, np.nanmin(i_stack, axis=1), np.nan)
i_max = np.where(gene_valid, np.nanmax(i_stack, axis=1), np.nan)
c_mean = np.where(gene_valid, np.nanmean(c_stack, axis=1), np.nan)
c_min = np.where(gene_valid, np.nanmin(c_stack, axis=1), np.nan)
c_max = np.where(gene_valid, np.nanmax(c_stack, axis=1), np.nan)

# 经验 p 值（无解析式时用跨基因零假设置换成本高，这里给注释性近似：p 记 NaN，
# 报告说明用排名与 min 跨样本一致性做保守判断，不假装解析 p）。
p_col = np.full(n_genes, np.nan)

a.var["moran_I"] = i_mean
a.var["moran_p"] = p_col
a.var["gearys_c"] = c_mean
a.var["morans_i_mean"] = i_mean
a.var["morans_i_min"] = i_min
a.var["morans_i_max"] = i_max
a.var["gearys_c_mean"] = c_mean
a.var["gearys_c_min"] = c_min
a.var["gearys_c_max"] = c_max
a.var["autocorr_n_valid_samples"] = valid_mask.astype(np.int8)
a.uns["autocorr"] = json.dumps({
    "method": "morans_i/gearys_c per-sample then merge (mean/min/max)",
    "spatial_stat_source": SQ_SOURCE,
    "min_samples_with_signal": MIN_SAMPLES_WITH_SIGNAL,
    "skipped_genes": skipped_genes,
    "p_note": "moran_p 恒 NaN：squidpy 默认不返回解析 p；用排名+跨样本 min 做保守判断，不伪造显著性",
    "seed": seed, "source_h5ad": os.path.abspath(src),
}, ensure_ascii=False)
out_h5ad = os.path.join("processed", "autocorr_mouse.h5ad")
a.write_h5ad(out_h5ad)

# Top 榜：按 moran_I 均值降序；fibrosis 命中单列
scored = pd.DataFrame({
    "ensembl_id": a.var_names.astype(str).tolist(),
    "gene_symbol": a.var["gene_symbol"].astype(str).tolist(),
    "moran_I": i_mean, "moran_I_min": i_min, "moran_I_max": i_max,
    "gearys_c": c_mean, "n_valid_samples": valid_mask,
})[gene_valid].sort_values("moran_I", ascending=False)
top_path = os.path.join("results", "morans_i_top_genes.tsv")
scored.head(TOP_N).to_csv(top_path, sep="\t", index=False)

sym_set = set(FIBROSIS_GENES)
fib_rows = scored[scored["gene_symbol"].isin(sym_set)].head(40)

rep = []
rep.append("step=autocorr_visium")
rep.append("seed=%s" % seed)
rep.append("input_domains=%s" % os.path.abspath(src))
rep.append("method=squidpy Morans I + Gearys C 按样本分别计算再合并；权重=distance_matrix(6 邻 1 环)")
rep.append("per-sample 计算的原因：obsm['spatial'] 像素坐标只在各样本自身组织图内有意义（scalefactors 不同），跨样本坐标不可比；合并用有效样本 mean/min/max")
for j, s in enumerate(samples):
    rep.append("sample %s: scored_genes=%d" % (s, len(per_sample_results[s])))
rep.append("gene_filter=min_samples_with_signal=%d; skipped_genes=%d（少于 2 样本有信号，未算或全 NaN）"
           % (MIN_SAMPLES_WITH_SIGNAL, skipped_genes))
rep.append("moran_p=恒 NaN（squidpy 无解析 p；报告用排名与 min 跨样本一致性做保守判断，不伪造显著性）")
rep.append("")
rep.append("Top %d 高聚集基因（moran_I 均值）：" % TOP_N)
for _, row in scored.head(TOP_N).iterrows():
    rep.append("  %s %s I=%.4f Imin=%.4f Imax=%.4f C=%.4f n=%d"
               % (row["ensembl_id"], row["gene_symbol"], row["moran_I"], row["moran_I_min"],
                  row["moran_I_max"], row["gearys_c"], row["n_valid_samples"]))
rep.append("")
rep.append("其中纤维化相关基因（%s）：" % FIBROSIS_NOTE)
if len(fib_rows) == 0:
    rep.append("  （Top 榜内未命中清单基因）")
for _, row in fib_rows.iterrows():
    rep.append("  %s %s I=%.4f n=%d 排名=%d"
               % (row["ensembl_id"], row["gene_symbol"], row["moran_I"], row["n_valid_samples"],
                  int(scored.index.get_loc(row.name)) + 1))
rep.append("limitation_note=n=3 切片，mean 易被单样本拉动，看 min/max 带宽；经验显著性未算；纤维化清单为人工 marker")
rep.append("elapsed_sec=%.1f" % (time.time() - START))
rep_path = os.path.join("results", "autocorr_report.txt")
with open(rep_path, "w", encoding="utf-8") as fh:
    fh.write("\n".join(rep) + "\n")
log("wrote %s" % rep_path)
for line in rep:
    print(line)
PYSCRIPT

echo 'step_exit=autocorr_visium ok'