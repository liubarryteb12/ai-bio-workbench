#!/usr/bin/env bash
# normalize_hvg_adapt：scrna_qc.h5ad -> processed/scrna_norm.h5ad（分块归一化 + HVG）。
# 替代全局母版 normalize_hvg：母版调 sc.pp.normalize_total，其 np.repeat 临时数组
# 在本数据规模（nnz 2.1 亿）下顶破 7.5GB RLIMIT（k40 实测 _ArrayMemoryError 802 MiB）。
# 口径不变（target_sum=1e4 + log1p + seurat HVG 2000），只改内存实现。
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
    *) echo "无法识别的输入文件: $path（需要 *.h5ad，即 qc 产物）" >&2; exit 2 ;;
  esac
done
[ -n "$h5ad_file" ] || { echo "缺少必需输入 scrna_qc.h5ad" >&2; exit 2; }
[ -f "$h5ad_file" ] || { echo "输入文件不存在: $h5ad_file" >&2; exit 2; }

PY="${BIO_PY:-/root/venvs/bio-py/bin/python3}"
[ -x "$PY" ] || { echo "python 解释器不存在或不可执行: $PY（可用 BIO_PY 覆盖）" >&2; exit 2; }

echo "step_executed=normalize_hvg_adapt"
echo "bioanalys_seed=$seed"
echo "input_h5ad=$h5ad_file"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
H5AD_FILE="$h5ad_file" BIOANALYS_SEED="$seed" "$PY" "$HERE/normalize_hvg_adapt.py"