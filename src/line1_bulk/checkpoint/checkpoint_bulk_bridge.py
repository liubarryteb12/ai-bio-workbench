#!/usr/bin/env bash
set -euo pipefail

checkpoint_name="checkpoint_bulk_bridge"
echo "step_executed=${checkpoint_name}"

export LC_ALL=C.UTF-8
export OMP_NUM_THREADS=3
export OPENBLAS_NUM_THREADS=3
export MKL_NUM_THREADS=3

input_path=""
seed_override=""
from_lang=""
to_lang=""
stage="post-dimred"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --input)
      if [ "$#" -lt 2 ] || [ -z "$2" ]; then
        echo "[BRIDGE FAIL] 参数 --input 缺少路径" >&2
        exit 2
      fi
      input_path="$2"
      shift 2
      ;;
    --from)
      if [ "$#" -lt 2 ] || [ -z "$2" ]; then
        echo "[BRIDGE FAIL] 参数 --from 缺少语言" >&2
        exit 2
      fi
      from_lang="$2"
      shift 2
      ;;
    --to)
      if [ "$#" -lt 2 ] || [ -z "$2" ]; then
        echo "[BRIDGE FAIL] 参数 --to 缺少语言" >&2
        exit 2
      fi
      to_lang="$2"
      shift 2
      ;;
    --stage)
      if [ "$#" -lt 2 ] || [ -z "$2" ]; then
        echo "[BRIDGE FAIL] 参数 --stage 缺少阶段" >&2
        exit 2
      fi
      stage="$2"
      shift 2
      ;;
    --seed)
      if [ "$#" -lt 2 ] || [ -z "$2" ]; then
        echo "[BRIDGE FAIL] 参数 --seed 缺少整数值" >&2
        exit 2
      fi
      seed_override="$2"
      shift 2
      ;;
    *)
      echo "[BRIDGE FAIL] 未知参数: $1" >&2
      exit 2
      ;;
  esac
done

if [ -z "$input_path" ]; then
  echo "[BRIDGE FAIL] 缺少必填参数 --input" >&2
  if [ -z "$from_lang" ] || [ -z "$to_lang" ]; then
    echo "[BRIDGE FAIL] 缺少必填参数 --from 与 --to（语言方向必须显式声明）" >&2
    exit 2
  fi
  exit 2
fi

case "$from_lang" in
  Python|R) ;;
  *)
    echo "[BRIDGE FAIL] 未知 --from: $from_lang（仅 Python / R）" >&2
    exit 2
    ;;
esac

case "$to_lang" in
  Python|R) ;;
  *)
    echo "[BRIDGE FAIL] 未知 --to: $to_lang（仅 Python / R）" >&2
    exit 2
    ;;
esac

case "$stage" in
  post-dimred|pre-dimred) ;;
  *)
    echo "[BRIDGE FAIL] 未知 --stage: $stage（仅 post-dimred / pre-dimred）" >&2
    exit 2
    ;;
esac

seed_value="${seed_override:-${BIOANALYS_SEED:-}}"
if [ -z "$seed_value" ]; then
  echo "BIOANALYS_SEED 未注入（引擎契约：seed 必须注入）" >&2
  exit 3
fi
if [[ ! "$seed_value" =~ ^-?[0-9]+$ ]]; then
  echo "BIOANALYS_SEED 不是整数: $seed_value" >&2
  exit 3
fi

if [ ! -f "$input_path" ]; then
  echo "[BRIDGE FAIL] 输入文件不存在: $input_path" >&2
  exit 2
fi

case "$input_path" in
  *.csv|*.tsv)
    CHECKPOINT_INPUT="$input_path" python3 - <<'PYSCRIPT'
import csv
import math
import os
import re
import sys

MISSING_VALUES = {"", "na", "n/a", "nan", "null", "none", "."}
GSM_PATTERN = re.compile(r"^GSM[0-9]+$", re.IGNORECASE)
NAMED_BARCODE_PATTERN = re.compile(r"^barcode(?:[_-].+)?$", re.IGNORECASE)
TENX_BARCODE_PATTERN = re.compile(r"^[ACGTN]{8,}(?:-[0-9]+)?$", re.IGNORECASE)


def fail(message):
    sys.stderr.write("[BRIDGE FAIL] line1_bulk %s\n" % message)
    sys.stderr.flush()
    sys.exit(1)


def is_sample_name(value):
    return bool(
        GSM_PATTERN.fullmatch(value)
        or NAMED_BARCODE_PATTERN.fullmatch(value)
        or TENX_BARCODE_PATTERN.fullmatch(value)
    )


def is_missing(value):
    return value.strip().lower() in MISSING_VALUES


input_path = os.environ["CHECKPOINT_INPUT"]
# 分隔符按首行内容探测，不按扩展名硬判：实际数据里 .csv 存 tab 分隔
# 或 .tsv 存逗号分隔都常见，按扩展名切会把整行当成一列。
with open(input_path, "r", encoding="utf-8-sig", newline="") as probe:
    first_line = probe.readline()
tab_count = first_line.count("\t")
comma_count = first_line.count(",")
if tab_count == 0 and comma_count == 0:
    fail("无法探测分隔符：首行既无 tab 也无逗号")
delimiter = "\t" if tab_count >= comma_count else ","

try:
    with open(input_path, "r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.reader(handle, delimiter=delimiter, strict=True))
except UnicodeDecodeError as exc:
    fail("表格不是 UTF-8 文本（%s）" % exc)
except csv.Error as exc:
    fail("表格无法解析（%s）" % exc)

if not rows:
    fail("表格为空")

header = rows[0]
data_rows = rows[1:]
if len(header) < 2:
    fail("列数不足：需要首列基因名和至少一个样本列，实际 %d 列" % len(header))
if not data_rows:
    fail("行数不足：表头之外没有基因行")

gene_column_name = header[0].strip()
if not gene_column_name:
    fail("首列表头为空，无法确认基因键")

sample_names = [value.strip() for value in header[1:]]
if any(not value for value in sample_names):
    fail("存在空的样本列名")
if len(set(sample_names)) != len(sample_names):
    fail("样本列名重复")

invalid_sample_names = [
    value for value in sample_names if not is_sample_name(value)
]
if invalid_sample_names:
    fail(
        "样本列名缺少 GSM 或 barcode 标识（%d/%d，示例: %s）"
        % (
            len(invalid_sample_names),
            len(sample_names),
            ", ".join(invalid_sample_names[:3]),
        )
    )

expected_width = len(header)
gene_names = []
all_na_rows = []
numeric_gene_names = 0

for line_number, row in enumerate(data_rows, start=2):
    if len(row) != expected_width:
        fail(
            "第 %d 行列数不一致：期望 %d，实际 %d"
            % (line_number, expected_width, len(row))
        )

    gene_name = row[0].strip()
    if not gene_name:
        fail("第 %d 行首列基因名为空" % line_number)
    gene_names.append(gene_name)
    if gene_name.replace(".", "", 1).isdigit():
        numeric_gene_names += 1

    values = [value.strip() for value in row[1:]]
    if all(is_missing(value) for value in values):
        all_na_rows.append(gene_name)

    for sample_name, value in zip(sample_names, values):
        if is_missing(value):
            continue
        try:
            number = float(value)
        except ValueError:
            fail(
                "第 %d 行样本 %s 不是数值: %s"
                % (line_number, sample_name, value)
            )
        if not math.isfinite(number):
            fail(
                "第 %d 行样本 %s 含非有限数值: %s"
                % (line_number, sample_name, value)
            )

if len(set(gene_names)) != len(gene_names):
    fail("首列基因名存在重复")

if numeric_gene_names > len(gene_names) * 0.5:
    fail(
        "首列超过半数是数字索引（%d/%d），疑似矩阵方向反转或基因名未映射"
        % (numeric_gene_names, len(gene_names))
    )

if all_na_rows:
    fail(
        "存在全 NA 行（%d 行，示例: %s）"
        % (len(all_na_rows), ", ".join(all_na_rows[:3]))
    )

first_column_sample_like = sum(
    1 for gene_name in gene_names if is_sample_name(gene_name)
)
if first_column_sample_like > len(gene_names) * 0.5:
    fail(
        "首列超过半数是样本 ID（%d/%d），矩阵方向疑似反转为样本行基因列"
        % (first_column_sample_like, len(gene_names))
    )

print(
    "[BRIDGE OK] line1_bulk gene names: %d, numeric=%d"
    % (len(gene_names), numeric_gene_names)
)
print(
    "[BRIDGE OK] line1_bulk matrix shape: genes=%d x samples=%d"
    % (len(gene_names), len(sample_names))
)
print(
    "[BRIDGE OK] line1_bulk sample names: %d, GSM/barcode prefixed"
    % len(sample_names)
)
print("[BRIDGE OK] line1_bulk all-NA rows: 0")
print("[BRIDGE OK] line1_bulk CSV/TSV bridge assertions passed")
PYSCRIPT
    exit 0
    ;;
  *.h5ad|*.rds)
    ;;
  *)
    echo "[BRIDGE FAIL] line1_bulk 不支持的文件格式（需 .csv/.tsv/.h5ad/.rds）: $input_path" >&2
    exit 1
    ;;
esac

engine_path="${BRIDGE_ENGINE:-/mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py}"
if [ ! -f "$engine_path" ] || [ ! -r "$engine_path" ] || ! command -v python3 >/dev/null 2>&1; then
  echo "[BRIDGE SKIP] $checkpoint_name 桥接引擎不可达: $engine_path"
  exit 0
fi

set +e
engine_output="$(
  python3 "$engine_path" \
    --input "$input_path" \
    --from "$from_lang" \
    --to "$to_lang" \
    --stage "$stage" 2>&1
)"
engine_rc=$?
set -e

if [ -n "$engine_output" ]; then
  printf '%s\n' "$engine_output"
fi

if [ "$engine_rc" -eq 0 ]; then
  echo "[BRIDGE OK] $checkpoint_name 引擎四项断言通过（$from_lang -> $to_lang, stage=$stage）"
  exit 0
fi

echo "[BRIDGE FAIL] $checkpoint_name 引擎校验失败（退出码 $engine_rc）" >&2
exit "$engine_rc"
