#!/usr/bin/env bash
# spatial_stats：PRJ_DCM_BENCH_20261105 line3_spatial 主对比描述性统计（建议票）。
#
# 输入：*.h5ad（deconv/domains 产物，优先用 layers['counts']）；可选 *domain_markers*.tsv（接受不使用）。
# 主对比：A_Ctrl vs D_Ctrl_HF（用户口径）；C_TTg_HF 治疗旁证只列描述数字，不入对比结论。
#
# 方法定位（诚实优先）：每基因在两样本 in-tissue spot 上比分布。n=1 vs 1，
#   spot 是伪复制不是独立重复，任何 spot 级 p 值都不得当结论。输出三件套：
#   描述统计（阳性 spot 中位/p90/检出数）、效应量（Cliff's delta + AUC + 阳性中位 log2FC）、
#   稳健性（域 jackknife：每次各侧随机丢 1 个域重算 log2FC 符号，翻转即 robust=false）。
#   不做正式检验推断，无 h5ad 写回。
#
# 输出：results/spatial_stats.tsv + results/spatial_stats_report.txt
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
    *domain_markers*) : ;;
    *) echo "无法识别的输入文件: $path（需要 *.h5ad）" >&2; exit 2 ;;
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

mkdir -p results
echo "step_executed=spatial_stats"
echo "bioanalys_seed=${seed}"
echo "input_h5ad=${h5ad_file}"

STATS_INPUT="$h5ad_file" BIOANALYS_SEED="$seed" "$PY" - <<'PYSCRIPT'
# -*- coding: utf-8 -*-
import os
import sys
import time

import numpy as np
import pandas as pd
import anndata as ad

ad.settings.allow_write_nullable_strings = False

START = time.time()
CTRL_SAMPLE = "A_Ctrl"
MODEL_SAMPLE = "D_Ctrl_HF"
TREATED_SAMPLE = "C_TTg_HF"
MIN_SPOTS_EACH = 20
TOP_EFFECT_N = 60
CLIFF_MED = 0.228
CLIFF_BIG = 0.472
JACK_DROPS = 3

def fail(message):
    sys.stderr.write("spatial_stats 自校验失败: %s\n" % message)
    sys.stderr.flush()
    sys.exit(1)

def log(message):
    print(message, flush=True)

def cliffs_delta(x, y):
    # delta = 2*AUC - 1，AUC = P(x>y) + 0.5*P(x==y)；排序扫描 O((n+m)log+n*m 上界可控)
    xs = np.sort(x)
    ys = np.sort(y)
    n, m = len(xs), len(ys)
    if n == 0 or m == 0:
        return np.nan, np.nan
    gt = float(np.searchsorted(ys, xs, side="left").sum())   # 每 x 严格大于的 y 数
    le = float(np.searchsorted(ys, xs, side="right").sum())  # x>=y 计数
    eq = le - gt
    auc = (gt + 0.5 * eq) / (n * m)
    return float(2.0 * auc - 1.0), float(auc)

seed_str = os.environ["BIOANALYS_SEED"]
rng = np.random.default_rng(int(seed_str) % (2 ** 32))
a = ad.read_h5ad(os.environ["STATS_INPUT"])
for col in ["sample_id", "domain", "in_tissue"]:
    if col not in a.obs.columns:
        fail("输入缺少 obs['%s']" % col)
if "gene_symbol" not in a.var.columns:
    fail("输入缺少 var['gene_symbol']")

counts = (a.layers["counts"] if "counts" in a.layers else a.X).tocsr()
samp = a.obs["sample_id"].astype(str).to_numpy()
dom = a.obs["domain"].astype(str).to_numpy()
intis = a.obs["in_tissue"].to_numpy() == 1
m_c = (samp == CTRL_SAMPLE) & intis
m_d = (samp == MODEL_SAMPLE) & intis
m_t = (samp == TREATED_SAMPLE) & intis
if m_c.sum() < MIN_SPOTS_EACH or m_d.sum() < MIN_SPOTS_EACH:
    fail("主对比两样本 in-tissue spot 不足: %d vs %d（最低 %d）" % (int(m_c.sum()), int(m_d.sum()), MIN_SPOTS_EACH))
log("spots ctrl=%d model=%d treated=%d" % (int(m_c.sum()), int(m_d.sum()), int(m_t.sum())))

Xc = counts[m_c]
Xd = counts[m_d]
det = np.asarray((Xc > 0).sum(axis=0)).ravel() + np.asarray((Xd > 0).sum(axis=0)).ravel()
gidx = np.where(det >= 20)[0]
log("genes_tested=%d/%d" % (gidx.size, a.n_vars))
if gidx.size < 100:
    fail("可比较基因 %d < 100（上游 QC 异常）" % gidx.size)

Csc = Xc[:, gidx].tocsc()
Dsc = Xd[:, gidx].tocsc()
dom_c = np.unique(dom[m_c])
dom_d = np.unique(dom[m_d])
rows = []
for k, gi in enumerate(gidx):
    xv = np.asarray(Csc[:, k].todense()).ravel()
    yv = np.asarray(Dsc[:, k].todense()).ravel()
    px = xv[xv > 0]
    py = yv[yv > 0]
    if px.size == 0 or py.size == 0:
        continue
    med_x = float(np.median(px))
    med_y = float(np.median(py))
    lfc = float(np.log2((med_y + 1.0) / (med_x + 1.0)))
    delta, auc = cliffs_delta(px, py)
    flips = 0
    tries = 0
    for _ in range(JACK_DROPS):
        if dom_c.size == 0 or dom_d.size == 0:
            break
        dc = str(rng.choice(dom_c))
        dd = str(rng.choice(dom_d))
        sx = xv[dom[m_c] != dc]
        sy = yv[dom[m_d] != dd]
        sxp = sx[sx > 0]
        syp = sy[sy > 0]
        if sxp.size < MIN_SPOTS_EACH or syp.size < MIN_SPOTS_EACH:
            continue
        l2 = float(np.log2((np.median(syp) + 1.0) / (np.median(sxp) + 1.0)))
        tries += 1
        if abs(l2) > 0.1 and np.sign(l2) != np.sign(lfc):
            flips += 1
    label = "negligible"
    if np.isfinite(delta):
        ad_abs = abs(delta)
        label = "large" if ad_abs >= CLIFF_BIG else ("medium" if ad_abs >= CLIFF_MED else "negligible")
    rows.append({
        "ensembl_id": str(a.var_names[gi]),
        "gene_symbol": str(a.var["gene_symbol"].iloc[gi]),
        "ctrl_detect_spots": int(px.size), "model_detect_spots": int(py.size),
        "ctrl_median_pos": round(med_x, 2), "model_median_pos": round(med_y, 2),
        "ctrl_p90": round(float(np.quantile(px, 0.9)), 2),
        "model_p90": round(float(np.quantile(py, 0.9)), 2),
        "log2FC_model_over_ctrl": round(lfc, 4),
        "cliffs_delta": round(float(delta), 4) if np.isfinite(delta) else "",
        "auc": round(float(auc), 4) if np.isfinite(auc) else "",
        "effect_label": label,
        "jackknife_sign_flips": "%d/%d" % (flips, tries),
        "robust": bool(flips == 0 and tries >= 2),
    })
df = pd.DataFrame(rows)
if df.empty:
    fail("没有可比较的基因对")
absd = pd.to_numeric(df["cliffs_delta"], errors="coerce").abs()
df = df.assign(_absd=absd).sort_values("_absd", ascending=False, na_position="last")
df = df.drop(columns=["_absd"]).reset_index(drop=True)
df.to_csv(os.path.join("results", "spatial_stats.tsv"), sep="\t", index=False)

n_big = int((absd >= CLIFF_BIG).sum())
n_robust = int((df["robust"] & (pd.to_numeric(df["log2FC_model_over_ctrl"], errors="coerce").abs() >= 1)).sum())

rep = []
rep.append("step=spatial_stats")
rep.append("seed=%s" % seed_str)
rep.append("input_h5ad=%s" % os.path.abspath(os.environ["STATS_INPUT"]))
rep.append("contrast=%s vs %s（主对比）；%s 治疗旁证只列描述数字" % (CTRL_SAMPLE, MODEL_SAMPLE, TREATED_SAMPLE))
rep.append("spots: ctrl=%d model=%d treated=%d（in_tissue=1）" % (int(m_c.sum()), int(m_d.sum()), int(m_t.sum())))
rep.append("genes_tested=%d（双侧合计检出>=20）；比较基于阳性 spot 分布" % int(df.shape[0]))
rep.append("效应量=Cliff's delta（|d|>=%.3f large / >=%.3f medium，Romano 锚点，非显著性）+ 阳性中位 log2FC" % (CLIFF_BIG, CLIFF_MED))
rep.append("稳健性=域 jackknife 每侧各丢 1 域重算 log2FC 符号 %d 次；flips>0 记不稳健" % JACK_DROPS)
rep.append("")
rep.append("Top %d（按 |delta|）：" % TOP_EFFECT_N)
for r in df.head(TOP_EFFECT_N).to_dict("records"):
    rep.append("  %s %s: ctrl_med=%.1f model_med=%.1f log2FC=%+.2f delta=%s %s jackflip=%s robust=%s" % (
        r["ensembl_id"], r["gene_symbol"], r["ctrl_median_pos"], r["model_median_pos"],
        r["log2FC_model_over_ctrl"], r["cliffs_delta"], r["effect_label"],
        r["jackknife_sign_flips"], r["robust"]))
rep.append("")
rep.append("汇总：|delta|>=0.472 共 %d 基因；robust 且 |log2FC|>=1 共 %d 基因（过滤见 tsv）" % (n_big, n_robust))
rep.append("treated 描述：%s spot=%d（n=1，不进对比）" % (TREATED_SAMPLE, int(m_t.sum())))
rep.append("limitation_note=根本局限：每条件仅 1 张切片，spot 是伪复制不是独立重复；本表全部数值只做描述与排序线索，禁止把任何 spot 级差异当统计检验结论；jackknife 翻转>0 的基因解读要格外保守")
rep.append("elapsed_sec=%.1f" % (time.time() - START))
with open(os.path.join("results", "spatial_stats_report.txt"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(rep) + "\n")
log("wrote results/spatial_stats_report.txt")
for line in rep:
    print(line)
PYSCRIPT

echo 'step_exit=spatial_stats ok'
