#!/usr/bin/env bash
# 08_migrate_to_projects.sh — 数据面迁移：顶层三线 -> projects/<项目>/
#
# 背景：数据面引入"项目"维度后，顶层平铺的三线（line1_bulk/line2_scrna/line3_spatial）
# 要迁入 projects/default/；脚本 bin/ 与环境声明 envs/ 提到顶层全局（所有项目共用一份）。
#
# 做法与安全：
#   - 用 mv（同分区 rename，秒级完成，不复制数据）；不做全量 cp 备份（22G 级数据复制慢且无必要）。
#   - 迁移前打印每线文件数与总字节，迁移后逐线比对（projects/<项目>/<线> + bin/<线> + envs/<线> 合计）。
#   - 幂等：projects/default 已存在且顶层三线已不在时，直接报 ALREADY_MIGRATED 退出 0。
#   - 旧台账路径重写：io_files 里的顶层三线路径加 projects/default 前缀，并补 project_id 字段
#     （否则迁移后旧台账的 io_files 指向不存在的路径）。
#
# 由 PC 侧入口 tools/ops/08_migrate_to_projects.ps1 调用，也可在容器内直接执行。
# 退出码：0 = 迁移完成或已迁移；1 = 校验不符；2 = 前置条件不满足。
set -euo pipefail

SSD_ROOT="${SSD_ROOT:-/mnt/ssd/bio_data}"
PROJECT="${PROJECT:-default}"
LINES=(line1_bulk line2_scrna line3_spatial)

cd "$SSD_ROOT"

# --- 幂等保护 ---
if [ -d "projects/$PROJECT" ] && [ ! -d "${LINES[0]}" ]; then
  echo "ALREADY_MIGRATED projects/$PROJECT"
  exit 0
fi

# --- 前置：三线目录必须在顶层 ---
for L in "${LINES[@]}"; do
  [ -d "$L" ] || { echo "FAIL 缺少顶层线目录: $L" >&2; exit 2; }
done

# --- 迁移前清单 ---
echo "=== BEFORE ==="
declare -A before_count before_bytes
for L in "${LINES[@]}"; do
  cnt=$(find "$L" -type f | wc -l | tr -d ' ')
  byt=$(du -sb "$L" | cut -f1)
  before_count[$L]="$cnt"
  before_bytes[$L]="$byt"
  echo "$L files=$cnt bytes=$byt"
done

# --- 建目录 ---
mkdir -p "projects/$PROJECT" bin envs

# --- 把 bin/ 与 envs/ 提到顶层（全局一份，不随项目） ---
for L in "${LINES[@]}"; do
  if [ -d "$L/bin" ]; then
    mkdir -p "bin/$L"
    find "$L/bin" -mindepth 1 -maxdepth 1 -exec mv -t "bin/$L" {} +
    rmdir "$L/bin"
    echo "moved bin/$L"
  fi
  if [ -d "$L/envs" ]; then
    mkdir -p "envs/$L"
    find "$L/envs" -mindepth 1 -maxdepth 1 -exec mv -t "envs/$L" {} +
    rmdir "$L/envs"
    echo "moved envs/$L"
  fi
done

# --- 移动线目录到项目内 ---
for L in "${LINES[@]}"; do
  mv "$L" "projects/$PROJECT/$L"
  echo "moved $L -> projects/$PROJECT/$L"
done

# --- 写项目元数据 ---
cat > "projects/$PROJECT/project.json" <<JSON
{
  "schema_version": 1,
  "project_id": "$PROJECT",
  "name": "默认项目",
  "description": "历史三线数据（迁移前直接位于 bio_data 顶层）",
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "lines": ["line1_bulk", "line2_scrna", "line3_spatial"]
}
JSON
echo "wrote projects/$PROJECT/project.json"

# --- 重写旧台账：路径加项目前缀 + 补 project_id ---
SSD_ROOT="$SSD_ROOT" PROJECT="$PROJECT" python3 - <<'PY'
import glob
import json
import os

logs_dir = os.path.join(os.environ["SSD_ROOT"], "system_logs")
project = os.environ["PROJECT"]
lines = ["line1_bulk", "line2_scrna", "line3_spatial"]
prefix_from = os.environ["SSD_ROOT"]
changed = 0
scanned = 0
for path in glob.glob(os.path.join(logs_dir, "*.json")):
    scanned += 1
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    original = json.dumps(data, sort_keys=True, ensure_ascii=False)
    if not data.get("project_id"):
        data["project_id"] = project
    io = data.get("io_files") or {}
    for direction in ("input", "output"):
        rewritten = []
        for item in io.get(direction) or []:
            text = str(item)
            for line in lines:
                text = text.replace(
                    "%s/%s/" % (prefix_from, line),
                    "%s/projects/%s/%s/" % (prefix_from, project, line),
                )
            rewritten.append(text)
        io[direction] = rewritten
    data["io_files"] = io
    if json.dumps(data, sort_keys=True, ensure_ascii=False) != original:
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
        changed += 1
print("ledger scanned=%d rewritten=%d" % (scanned, changed))
PY

# --- 迁移后校验 ---
echo "=== AFTER ==="
fail=0
for L in "${LINES[@]}"; do
  cnt=$(find "projects/$PROJECT/$L" -type f | wc -l | tr -d ' ')
  byt=$(du -sb "projects/$PROJECT/$L" | cut -f1)
  # bin/envs 已提到顶层，合计进对比
  if [ -d "bin/$L" ]; then
    cnt=$((cnt + $(find "bin/$L" -type f | wc -l | tr -d ' ')))
    byt=$((byt + $(du -sb "bin/$L" | cut -f1)))
  fi
  if [ -d "envs/$L" ]; then
    cnt=$((cnt + $(find "envs/$L" -type f | wc -l | tr -d ' ')))
    byt=$((byt + $(du -sb "envs/$L" | cut -f1)))
  fi
  echo "$L files=$cnt bytes=$byt (before files=${before_count[$L]} bytes=${before_bytes[$L]})"
  if [ "$cnt" != "${before_count[$L]}" ]; then
    echo "MISMATCH_COUNT $L" >&2
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "FAIL 迁移后文件数不一致，请人工核对" >&2
  exit 1
fi

echo "MIGRATED projects/$PROJECT"
