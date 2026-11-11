#!/usr/bin/env bash
# localization_visium：PRJ_DCM_BENCH_20261105 line3_spatial 适配版靶基因空间定位。
#
# 输入（--input 可重复）：
#   *.h5ad：deconv/domains 阶段主对象；
#   靶基因清单 *.txt：一行一个 gene_symbol（# 起注释）；缺失或为空 exit 2 明确失败；
#   可选 *domain_markers*.tsv：给每个靶基因标注它是哪些域的上调 marker。
#
# 输出：processed/localization_mouse.h5ad（obs['target_gene_expr']=清单首个命中靶基因表达，
#   全部靶基因逐域/逐样本均值见 tsv；uns['localization'] 台账）
#   + results/target_localization.tsv + results/localization_report.txt
#   + figures/l3_20_<gene>_<sample>.png（300dpi：lowres 组织图底 + spot 圆点表达色阶）。
# 配色用规范三色（低 #BEBEBE 灰 → 高 #EE0000 暖红）。
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
targets_file=""
markers_file=""
for path in "${INPUTS[@]:-}"; do
  [ -n "$path" ] || continue
  case "$path" in
    *.h5ad) h5ad_file="$path" ;;
    *domain_markers*) markers_file="$path" ;;
    *.txt) targets_file="$path" ;;
    *) echo "无法识别的输入文件: $path（需要 *.h5ad / 靶基因 *.txt / *domain_markers*.tsv）" >&2; exit 2 ;;
  esac
done

if [ -z "$h5ad_file" ]; then
  echo "缺少必需输入：需要 *.h5ad（deconv/domains 产物）" >&2
  exit 2
fi
if [ ! -f "$h5ad_file" ]; then
  echo "输入文件不存在: $h5ad_file" >&2
  exit 2
fi
if [ -z "$targets_file" ] || [ ! -f "$targets_file" ] || [ ! -s "$targets_file" ]; then
  echo "缺少 L1 靶基因清单（--input target_genes.txt，一行一基因）：缺失或为空即失败，不静默跳过" >&2
  exit 2
fi

mkdir -p processed results figures
echo "step_executed=localization_visium"
echo "bioanalys_seed=${seed}"
echo "input_h5ad=${h5ad_file}"
echo "input_targets=${targets_file}"
echo "input_markers=${markers_file:-（未提供，跳过域 marker 归属标注）}"

LOC_INPUT="$h5ad_file" LOC_TARGETS="$targets_file" LOC_MARKERS="$markers_file" BIOANALYS_SEED="$seed" "$PY" - <<'PYSCRIPT'
# -*- coding: utf-8 -*-
import json
import os
import sys
import time

import numpy as np
import pandas as pd
import anndata as ad
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap

ad.settings.allow_write_nullable_strings = False

START = time.time()
UP_COLOR = "#EE0000"
LOW_COLOR = "#BEBEBE"
MAX_TARGETS = 12
REPORT_PREFIX = "l3_20"
FIG_DPI = 300

def fail(message):
    sys.stderr.write("localization_visium 自校验失败: %s\n" % message)
    sys.stderr.flush()
    sys.exit(1)

def log(message):
    print(message, flush=True)

src = os.environ["LOC_INPUT"]
targets_path = os.environ["LOC_TARGETS"]
markers_path = os.environ.get("LOC_MARKERS", "")
seed = os.environ["BIOANALYS_SEED"]

targets = []
with open(targets_path, "r", encoding="utf-8") as fh:
    for line in fh:
        t = line.split("#")[0].strip()
        if t:
            targets.append(t)
if not targets:
    fail("靶基因清单解析后为空: %s" % targets_path)
if len(targets) > MAX_TARGETS:
    log("WARN 靶基因 %d 超上限 %d：前 %d 个出图，全部基因进 tsv 统计" % (len(targets), MAX_TARGETS, MAX_TARGETS))

a = ad.read_h5ad(src)
for col in ["domain", "sample_id"]:
    if col not in a.obs.columns:
        fail("输入缺少 obs['%s']" % col)
if "gene_symbol" not in a.var.columns or "spatial" not in a.obsm:
    fail("输入缺 var['gene_symbol'] 或 obsm['spatial']")

sym_to_idx = {}
for i, s in enumerate(a.var["gene_symbol"].astype(str).tolist()):
    sym_to_idx.setdefault(s.upper(), i)

marker_domains = {}
if markers_path and os.path.isfile(markers_path):
    mk = pd.read_csv(markers_path, sep="\t")
    if {"domain", "gene_symbol"} <= set(mk.columns):
        for d, g in zip(mk["domain"].astype(str), mk["gene_symbol"].astype(str)):
            marker_domains.setdefault(g.upper(), set()).add(d)

Xcsr = a.X.tocsr()
dom = a.obs["domain"].astype(str).to_numpy()
samp = a.obs["sample_id"].astype(str).to_numpy()
samples = list(a.uns["samples"])
has_moran = "moran_I" in a.var.columns
moran_rank = None
if has_moran:
    moran_rank = pd.Series(a.var["moran_I"].to_numpy(dtype=float)).rank(ascending=False, na_option="bottom")

cmap = LinearSegmentedColormap.from_list("gray2red", [LOW_COLOR, UP_COLOR])
rows = []
missing = []
plotted = 0
for gene in targets:
    gi = sym_to_idx.get(gene.upper())
    if gi is None:
        missing.append(gene)
        continue
    col = np.asarray(Xcsr[:, gi].todense()).ravel().astype(float)
    if "target_gene_expr" not in a.obs.columns:
        a.obs["target_gene_expr"] = col
    row = {"gene_symbol": gene, "ensembl_id": str(a.var_names[gi]),
           "expressed_spots": int((col > 0).sum()),
           "mean_expr": round(float(col.mean()), 4),
           "is_domain_marker_for": ";".join(sorted(marker_domains.get(gene.upper(), set())))}
    if has_moran:
        mv = a.var["moran_I"].iloc[gi]
        row["moran_I"] = round(float(mv), 4) if np.isfinite(mv) else ""
        row["moran_rank"] = int(moran_rank.iloc[gi])
    for d in sorted(set(dom.tolist())):
        m = dom == d
        row["dom_%s_mean" % d] = round(float(col[m].mean()), 4)
    for s in samples:
        m = samp == s
        row["sample_%s_mean" % s] = round(float(col[m].mean()), 4)
    rows.append(row)

    if plotted >= MAX_TARGETS:
        continue
    for s in samples:
        entry = a.uns.get("spatial", {}).get(s)
        if not entry:
            log("WARN 样本 %s 无 uns['spatial'] 图，跳过出图" % s)
            continue
        img = np.asarray(entry["images"]["lowres"])
        sf = float(entry["scalefactors"]["tissue_lowres_scalef"])
        m = samp == s
        xy = np.asarray(a.obsm["spatial"])[m] * sf
        xy[:, 0] = np.clip(xy[:, 0], 0, img.shape[1] - 1)
        xy[:, 1] = np.clip(xy[:, 1], 0, img.shape[0] - 1)
        expr = col[m]
        pos = expr[expr > 0]
        vmax = float(np.quantile(pos, 0.99)) if pos.size else 1.0
        vmax = vmax if vmax > 0 else 1.0
        fig = plt.figure(figsize=(4.6, 4.2))
        ax = fig.add_axes([0.02, 0.20, 0.76, 0.74])
        ax.imshow(img)
        sp = ax.scatter(xy[:, 0], xy[:, 1], c=np.clip(expr, 0, vmax), s=6,
                        cmap=cmap, vmin=0, vmax=vmax, linewidths=0)
        # 标题一律纯英文：K40 容器里 matplotlib 没有中文字体，中文会渲染成方框（豆腐块）。
        # 这也符合 docs/figure_spec.md 的英文标签口径。
        ax.set_title("%s / %s | >0 expression: %d spots" % (gene, s, int((expr > 0).sum())), fontsize=8.5)
        ax.axis("off")
        cax = fig.add_axes([0.82, 0.24, 0.02, 0.66])
        cb = fig.colorbar(sp, cax=cax)
        cb.set_label("log expr (grey=low, red=high)", fontsize=6.5)
        cb.ax.tick_params(labelsize=5.5)
        cap = ("source: %s | line3 spatial | lowres x %.3f"
               " | color grey #BEBEBE -> red #EE0000 (vmax=p99 %.3f) | spots=%d") % (
               os.path.basename(src), sf, vmax, int(m.sum()))
        fig.text(0.02, 0.03, cap, fontsize=5.0, ha="left", va="bottom")
        fig.savefig(os.path.join("figures", "%s_%s_%s.png" % (REPORT_PREFIX, gene, s)), dpi=FIG_DPI)
        plt.close(fig)
    plotted += 1

if not rows:
    fail("所有靶基因都不在矩阵 var['gene_symbol']（missing=%s）" % missing[:10])
tsv = pd.DataFrame(rows)
tsv_path = os.path.join("results", "target_localization.tsv")
tsv.to_csv(tsv_path, sep="\t", index=False)

a.uns["localization"] = json.dumps({
    "targets": targets, "found": [r["gene_symbol"] for r in rows], "missing": missing,
    "figures_genes": plotted, "figure_dpi": FIG_DPI,
    "naming": "%s_<gene>_<sample>.png" % REPORT_PREFIX,
    "expr_contract": "obs['target_gene_expr'] 存清单首个命中靶基因；全部靶基因统计见 tsv",
    "seed": seed, "source_h5ad": os.path.abspath(src),
}, ensure_ascii=False)
out_h5ad = os.path.join("processed", "localization_mouse.h5ad")
a.write_h5ad(out_h5ad)

rep = []
rep.append("step=localization_visium")
rep.append("seed=%s" % seed)
rep.append("input_h5ad=%s" % os.path.abspath(src))
rep.append("targets=%s" % ",".join(targets))
rep.append("targets_found=%d missing=%d（%s；缺失如实报告不静默）" % (len(rows), len(missing), ",".join(missing) or "无"))
rep.append("figures_written=%d（%s_<gene>_<sample>.png，300dpi，lowres 底图 + spot 圆点色阶）" % (plotted * len(samples), REPORT_PREFIX))
for row in rows:
    extra = ""
    if has_moran and row.get("moran_I") != "":
        extra = " moran_I=%s rank=%s" % (row["moran_I"], row["moran_rank"])
    rep.append("gene %s: expressed_spots=%d mean=%.3f marker_for=%s%s"
               % (row["gene_symbol"], row["expressed_spots"], row["mean_expr"],
                  row["is_domain_marker_for"] or "-", extra))
rep.append("每图色阶按该样本该基因 p99 独立缩放，跨图颜色不可直接比较；横向比较用 tsv 数值")
rep.append("limitation_note=主对比 n=1 vs 1，靶基因定位差异只能描述性陈述；域是编号域，纤维化域需人工对照 marker 证据认领；obs['target_gene_expr'] 只承载首靶，全量在 tsv")
rep.append("elapsed_sec=%.1f" % (time.time() - START))
rep_path = os.path.join("results", "localization_report.txt")
with open(rep_path, "w", encoding="utf-8") as fh:
    fh.write("\n".join(rep) + "\n")
log("wrote %s" % rep_path)
for line in rep:
    print(line)
PYSCRIPT

echo 'step_exit=localization_visium ok'
