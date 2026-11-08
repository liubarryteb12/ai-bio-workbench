#!/usr/bin/env bash
# export_signatures：L2 注释产物 -> L3 解卷积签名表（signatures.tsv）。
# 用法：--input <annotated.h5ad> --input <norm.h5ad> --output <signatures.tsv>
set -euo pipefail

seed="${BIOANALYS_SEED:-UNSET}"
if [ "$seed" = "UNSET" ]; then
  echo "BIOANALYS_SEED 未注入（引擎契约：seed 必须注入）" >&2
  exit 3
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

annotated_file=""; norm_file=""
for path in "${INPUTS[@]:-}"; do
  [ -n "$path" ] || continue
  case "$path" in
    *annotated*.h5ad) annotated_file="$path" ;;
    *norm*.h5ad) norm_file="$path" ;;
    *) echo "无法识别的输入文件: $path（需要 *annotated*.h5ad 与 *norm*.h5ad）" >&2; exit 2 ;;
  esac
done
[ -n "$annotated_file" ] && [ -n "$norm_file" ] || { echo "缺少必需输入（annotated='$annotated_file' norm='$norm_file'）" >&2; exit 2; }
[ -f "$annotated_file" ] && [ -f "$norm_file" ] || { echo "输入文件不存在" >&2; exit 2; }

out_file="${OUTPUTS[0]:-results/signatures.tsv}"
mkdir -p "$(dirname "$out_file")"

PY="${BIO_PY:-/root/venvs/bio-py/bin/python3}"
[ -x "$PY" ] || { echo "python 解释器不存在或不可执行: $PY（可用 BIO_PY 覆盖）" >&2; exit 2; }

echo "step_executed=export_signatures"
echo "bioanalys_seed=$seed"
echo "input_annotated=$annotated_file"
echo "input_norm=$norm_file"
echo "output_signatures=$out_file"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANNOTATED_FILE="$annotated_file" NORM_FILE="$norm_file" SIG_OUT="$out_file" BIOANALYS_SEED="$seed" \
  "$PY" "$HERE/export_signatures.py"