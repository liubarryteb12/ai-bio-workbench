#!/usr/bin/env bash
# annotate_cardiac：scrna_clustered.h5ad -> scrna_annotated.h5ad（心脏大类注释）。
# 替代全局母版 annotate_celltypes（其 marker 集是 14 类皮肤免疫）。
# 打分口径与理由见 annotate_cardiac.py 头部；本文件只做参数解析与解释器选择，
# 保证「一个含义一个真源」：逻辑全部在 .py，本 .sh 不内嵌代码副本。
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
    *) echo "无法识别的输入文件: $path（需要 *.h5ad，即 cluster 产物）" >&2; exit 2 ;;
  esac
done
[ -n "$h5ad_file" ] || { echo "缺少必需输入 scrna_clustered.h5ad" >&2; exit 2; }
[ -f "$h5ad_file" ] || { echo "输入文件不存在: $h5ad_file" >&2; exit 2; }

PY="${BIO_PY:-/root/venvs/bio-py/bin/python3}"
[ -x "$PY" ] || { echo "python 解释器不存在或不可执行: $PY（可用 BIO_PY 覆盖）" >&2; exit 2; }

echo "step_executed=annotate_cardiac"
echo "bioanalys_seed=$seed"
echo "input_h5ad=$h5ad_file"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
H5AD_FILE="$h5ad_file" BIOANALYS_SEED="$seed" "$PY" "$HERE/annotate_cardiac.py"