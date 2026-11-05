#!/usr/bin/env bash
# domains_visium：PRJ_DCM_BENCH_20261105 line3_spatial 适配版空间域聚类。
#
# 输入：qc_visium.sh 产物 spatial_qc_mouse.h5ad（*.h5ad 自动识别）。
# 输出：processed/domains_mouse.h5ad + results/domain_markers.tsv + results/domains_report.txt
#
# 方法：每样本独立 squidpy spatial_neighbors 建空间图（generic 像素坐标）
#   → log1p + HVG(2000) + PCA(50) + leiden(resolution=0.6, igraph, n_iterations=2)。
# resolution 写死 0.6 的理由：三张切片只需粗结构域（LV 游离壁/室间隔/纤维化区），
# 0.6 量级给每样本约 4~8 域；更高会把域切碎、降低 marker 统计功效。
# 域编号样本命名空间隔离（<sample>_d<k>），与母版 spatial_domains 同风格。
#
# 输出契约（对齐下游 autocorr/deconv/localization）：
#   obs['leiden']（样本内编号）、obs['domain']（<sample>_d<k> 全局唯一）、
#   obs['lognorm' 相关 uns['lognorm']/uns['normalization'] 台账、uns['domains']；
#   results/domain_markers.tsv（每域 top10 marker，列 domain/sample_id/rank/ensembl_id/gene_symbol）。
# 报告明确写：域解剖命名是人工解读，脚本只给编号域与 marker 证据。
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
    *) echo "无法识别的输入文件: $path（需要 *.h5ad，qc_visium 产物）" >&2; exit 2 ;;
  esac
done
if [ -z "$h5ad_file" ]; then
  echo "缺少必需输入：需要 qc_visium 产物 spatial_qc_mouse.h5ad" >&2
  exit 2
fi
if [ ! -f "$h5ad_file" ]; then
  echo "输入文件不存在: $h5ad_file" >&2
  exit 2
fi

mkdir -p processed results figures
echo "step_executed=domains_visium"
echo "bioanalys_seed=${seed}"
echo "input_qc=${h5ad_file}"

DOM_INPUT="$h5ad_file" BIOANALYS_SEED="$seed" "$PY" - <<'PYSCRIPT'
# -*- coding: utf-8 -*-
import inspect
import json
import os
import sys
import time
from collections import Counter

import numpy as np
import pandas as pd
import scipy.sparse as sp
import scanpy as sc
import anndata as ad

try:
    import squidpy as sq
except ImportError as exc:
    sys.stderr.write("domains_visium 依赖 squidpy，导入失败: %s\n" % exc)
    sys.exit(1)

ad.settings.allow_write_nullable_strings = False

# --- 写死参数（回写报告）---
RESOLUTION = 0.6
N_PCS = 50
N_HVG = 2000
MARKER_TOP = 10
SQ_K = 6

def fail(message):
    sys.stderr.write("domains_visium 自校验失败: %s\n" % message)
    sys.stderr.flush()
    sys.exit(1)

def log(message):
    print(message, flush=True)

def _filter_kwargs(func, wanted):
    sig = inspect.signature(func).parameters
    return {k: v for k, v in wanted.items() if k in sig}

def sq_spatial_graph(sub):
    """样本内建空间邻接图；返回 (conn_key, dist_key)。

    squidpy 各版本参数名不同（n_neighors 是上游笔误保留名；transform/delimiter
    在部分版本不存在），按实际签名裁剪传参，缺一个就报 TypeError 全家崩。"""
    fn = sq.gr.spatial_neighbors
    kwargs = _filter_kwargs(fn, {"coord_type": "generic", "n_neighors": SQ_K,
                                 "n_neighbors": SQ_K, "n_rings": 1,
                                 "key_added": "spatial_neighbors"})
    params = inspect.signature(fn).parameters
    if "adata" in params:
        fn(sub, **kwargs)
    else:
        fn(**kwargs)  # 少数版本只吃全局 adata？不存在则下面 obsp 检查兜住
    entry = sub.uns.get("spatial_neighbors") or {}
    ckey = entry.get("conn_key")
    dkey = entry.get("dist_key")
    if not ckey or ckey not in sub.obsp:
        ckey = "spatial_connectivities" if "spatial_connectivities" in sub.obsp else "connectivities"
    if not dkey or dkey not in sub.obsp:
        dkey = "spatial_distances" if "spatial_distances" in sub.obsp else "distances"
    if ckey not in sub.obsp:
        fail("squidpy 建图后 obsp 无连接矩阵（keys=%s）" % list(sub.obsp.keys()))
    return ckey, dkey

src = os.environ["DOM_INPUT"]
seed = int(os.environ["BIOANALYS_SEED"])
a = ad.read_h5ad(src)

for key in ["spatial", "samples", "qc", "seed", "gene_id_type"]:
    if key not in a.uns:
        fail("输入缺少 uns['%s']（不是 qc_visium 产物？）" % key)
for col in ["sample_id", "condition", "condition_class", "group"]:
    if col not in a.obs.columns:
        fail("输入缺少 obs['%s']" % col)
if str(a.uns["seed"]) != str(seed):
    fail("输入 uns['seed'] 与本次 seed 不一致")

samples = list(a.uns["samples"])
if "lognorm" not in a.uns:
    a.layers["counts"] = a.X.copy()
    sc.pp.normalize_total(a, target_sum=1e4)
    sc.pp.log1p(a)
    a.uns["lognorm"] = json.dumps({"method": "normalize_total_1e4+log1p", "seed": seed})
    a.uns["normalization"] = a.uns["lognorm"]

leiden_local = np.empty(a.n_obs, dtype=object)
domain_global = np.empty(a.n_obs, dtype=object)
stats = {}

for s in samples:
    m = (a.obs["sample_id"] == s).to_numpy()
    sub = a[m].copy()
    ckey, dkey = sq_spatial_graph(sub)
    conn = sp.csr_matrix(sub.obsp[ckey])
    dist = sp.csr_matrix(sub.obsp[dkey])
    sc.pp.highly_variable_genes(sub, n_top_genes=min(N_HVG, sub.n_vars), flavor="seurat")
    hv = sub[:, sub.var["highly_variable"].to_numpy()].copy()
    n_pcs = int(min(N_PCS, hv.n_vars - 1, hv.n_obs - 1))
    sc.pp.pca(hv, n_comps=n_pcs, random_state=seed)
    hv.obsp["connectivities"] = conn
    hv.obsp["distances"] = dist
    hv.uns["neighbors"] = {"connectivities_key": "connectivities", "distances_key": "distances",
                           "params": {"n_neighbors": SQ_K, "method": "squidpy_spatial",
                                      "use_rep": "X_pca", "ncells": int(hv.n_obs)}}
    sc.tl.leiden(hv, resolution=RESOLUTION, random_state=seed,
                 flavor="igraph", n_iterations=2, key_added="leiden")
    labs = hv.obs["leiden"].astype(str).to_numpy()
    if labs.size != int(m.sum()):
        fail("样本 %s leiden 行数与子集不符" % s)
    leiden_local[m] = labs
    domain_global[m] = ["%s_d%s" % (s, x) for x in labs]
    mean_conn = float(np.asarray(conn.sum(axis=1)).ravel().mean())
    stats[s] = {"spots": int(m.sum()), "domains": len(set(labs)), "mean_conn_per_spot": mean_conn,
                "n_pcs": n_pcs}
    log("sample=%s spots=%d domains=%d mean_conn=%.1f" % (s, stats[s]["spots"], stats[s]["domains"], mean_conn))

if any(x is None or x == "" for x in domain_global):
    fail("存在未分域的 spot")
a.obs["leiden"] = pd.Categorical([str(x) for x in leiden_local], ordered=False)
a.obs["domain"] = pd.Categorical([str(x) for x in domain_global], ordered=False)

sc.tl.rank_genes_groups(a, groupby="domain", method="wilcoxon", n_genes=MARKER_TOP)
names = a.uns["rank_genes_groups"]["names"]
symbol_of = a.var["gene_symbol"].to_dict()
rows = []
for dom_name in names.dtype.names:
    for rank in range(MARKER_TOP):
        eid = str(names[dom_name][rank])
        rows.append({"domain": dom_name, "sample_id": dom_name.split("_d")[0], "rank": rank + 1,
                     "ensembl_id": eid, "gene_symbol": str(symbol_of.get(eid, ""))})
mk = pd.DataFrame(rows)
mk_path = os.path.join("results", "domain_markers.tsv")
mk.to_csv(mk_path, sep="\t", index=False)

dist_tab = pd.crosstab(a.obs["domain"].astype(str), a.obs["sample_id"].astype(str))
sizes = Counter(str(d) for d in a.obs["domain"].to_numpy())

a.uns["domains"] = json.dumps({
    "method": "per-sample squidpy spatial_neighbors + HVG%d + PCA%d + leiden(igraph,n_iter2)",
    "resolution": RESOLUTION, "seed": seed, "per_sample": stats,
    "n_domains_total": len(sizes), "namespace": "<sample>_d<k>",
}, ensure_ascii=False)
out_h5ad = os.path.join("processed", "domains_mouse.h5ad")
a.write_h5ad(out_h5ad)

rep = []
rep.append("step=domains_visium")
rep.append("seed=%s" % seed)
rep.append("input_qc=%s" % os.path.abspath(src))
rep.append("resolution=%.1f（写死；三切片只需粗结构域 LV 游离壁/室间隔/纤维化区，0.6 约每样本 4~8 域，更高会切碎域降低 marker 功效）" % RESOLUTION)
rep.append("method=每样本独立 squidpy spatial_neighbors(%d 邻) + HVG%d + PCA%d + leiden(igraph, n_iter=2)" % (SQ_K, N_HVG, N_PCS))
rep.append("domains_total=%d" % len(sizes))
for s in samples:
    rep.append("sample %s: spots=%d domains=%d mean_conn_per_spot=%.1f n_pcs=%d"
               % (s, stats[s]["spots"], stats[s]["domains"], stats[s]["mean_conn_per_spot"], stats[s]["n_pcs"]))
rep.append("域的解剖命名（LV wall/septum/fibrosis）是人工解读；本脚本只输出编号域（<sample>_d<k>）与每域 top%d marker 证据。" % MARKER_TOP)
for dom_name in sorted(sizes):
    row = dist_tab.loc[dom_name]
    markers = mk[mk["domain"] == dom_name]["gene_symbol"].tolist()
    rep.append("domain %s size=%d per_sample=%s top_markers=%s"
               % (dom_name, sizes[dom_name],
                  json.dumps({k: int(v) for k, v in row.items()}, ensure_ascii=False),
                  ",".join(markers[:MARKER_TOP])))
rep.append("limitation_note=resolution 固定 0.6 未做敏感性双跑；marker 为 wilcoxon top%d 非特异列表，人工命名需对照组织图；squidpy 参数按安装版签名探测" % MARKER_TOP)
rep.append("elapsed_sec=%.1f" % (time.time() - START))
rep_path = os.path.join("results", "domains_report.txt")
with open(rep_path, "w", encoding="utf-8") as fh:
    fh.write("\n".join(rep) + "\n")
log("wrote %s" % rep_path)
for line in rep:
    print(line)
PYSCRIPT

echo 'step_exit=domains_visium ok'
