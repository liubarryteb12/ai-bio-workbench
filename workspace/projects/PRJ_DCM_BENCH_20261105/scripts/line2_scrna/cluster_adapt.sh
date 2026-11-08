#!/usr/bin/env bash
# cluster_adapt：scrna_integrated.h5ad -> processed/scrna_clustered.h5ad（邻居图/UMAP/leiden）。
# 替代全局母版 cluster_umap：母版的「大簇单一供体<=50%」绝对门按上一研究形态定，
# 在本数据的三个发育层（胎心/儿童对照/儿童 DCM）上会系统性误判。改以「校正后供体混合度
# 不低于校正前」的对照门为主判据，逐簇绝对占比如实留痕。详见 cluster_adapt.py 头部。
set -euo pipefail

seed="${BIOANALYS_SEED:-UNSET}"
if [ "$seed" = "UNSET" ]; then
  echo "BIOANALYS_SEED 未注入（引擎契约：seed 必须注入）" >&2
  exit 3
fi

declare -a INPUTS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --input) INPUTS+=("$2"); shift 2 ;;
    --output) shift 2 ;;
    --seed) shift 2 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

h5ad_file=""
for path in "${INPUTS[@]:-}"; do
  [ -n "$path" ] || continue
  case "$path" in
    *.h5ad) h5ad_file="$path" ;;
    *) echo "无法识别的输入文件: $path（需要 *.h5ad，即 integrate 产物）" >&2; exit 2 ;;
  esac
done
[ -n "$h5ad_file" ] || { echo "缺少必需输入 scrna_integrated.h5ad" >&2; exit 2; }
[ -f "$h5ad_file" ] || { echo "输入文件不存在: $h5ad_file" >&2; exit 2; }

PY="${BIO_PY:-/root/venvs/bio-py/bin/python3}"
[ -x "$PY" ] || { echo "python 解释器不存在或不可执行: $PY（可用 BIO_PY 覆盖）" >&2; exit 2; }

echo "step_executed=cluster_adapt"
echo "bioanalys_seed=$seed"
echo "input_h5ad=$h5ad_file"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
H5AD_FILE="$h5ad_file" BIOANALYS_SEED="$seed" "$PY" "$HERE/cluster_adapt.py"