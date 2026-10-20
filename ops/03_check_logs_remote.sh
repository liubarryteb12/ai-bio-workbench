#!/usr/bin/env bash
# ops/03_check_logs_remote.sh — 台账 JSON 隔离与合法性校验（服务器侧执行）
#
# 校验 /mnt/ssd/bio_data/system_logs/ 下的任务台账 JSON：
#   [1] line_id 必须是 line1_bulk / line2_scrna / line3_spatial 之一
#   [2] project_id 必须合法（缺省视为 default，兼容迁移前的历史台账）
#   [3] io_files.input/output 路径不得跨线（只能本项目本线 / public_references / system_logs）
#   [4] io_files 路径中的项目段必须与 project_id 一致（跨项目引用即违规）
#   [5] io_files.output 不得写 public_references（那是只读共享区）
#   [6] checkpoint_status=passed 时 environment.random_seed 必须有值（否则不可复现）
#
# 用法（PC 侧一条命令）：
#   ssh k40-ubuntu 'bash -s' < ops/03_check_logs_remote.sh
# 或手动传到服务器后：
#   bash ops/03_check_logs_remote.sh [日志目录]
#
# 退出码：0 = 全部合法；1 = 有违规或目录缺失

set -u

LOGS_DIR="${1:-/mnt/ssd/bio_data/system_logs}"

if [ ! -d "$LOGS_DIR" ]; then
  echo "[logs] FAIL 目录不存在: $LOGS_DIR"
  echo "       （外挂 SSD 未挂载或路径不符，先解决数据面再校验台账）"
  exit 1
fi

shopt -s nullglob
json_files=("$LOGS_DIR"/*.json)
shopt -u nullglob

if [ "${#json_files[@]}" -eq 0 ]; then
  echo "[logs] SKIP 无 JSON 文件: $LOGS_DIR"
  exit 0
fi

fail=0
for f in "${json_files[@]}"; do
  out=$(python3 - "$f" <<'PY'
import json, re, sys

path = sys.argv[1]
LINES = ("line1_bulk", "line2_scrna", "line3_spatial")
DEFAULT_PROJECT = "default"
problems = []

try:
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
except Exception as exc:
    print(f"[logs:{path.split('/')[-1]}] FAIL JSON 解析失败: {exc}")
    sys.exit(2)

line_id = data.get("line_id")
if line_id not in LINES:
    problems.append(f"line_id 非法: {line_id!r}")

# project_id 缺省视为 default（兼容迁移前的历史台账）；提供则必须合法
project_id = data.get("project_id")
if project_id is None:
    project_id = DEFAULT_PROJECT
elif not (isinstance(project_id, str)
          and re.fullmatch(r"[A-Za-z0-9._-]{1,64}", project_id)
          and not project_id.startswith(".")):
    problems.append(f"project_id 非法: {project_id!r}")
    project_id = DEFAULT_PROJECT

status = data.get("status")
checkpoint = data.get("checkpoint_status")
env = data.get("environment") or {}

if checkpoint == "passed" and env.get("random_seed") is None:
    problems.append("checkpoint_status=passed 但 environment.random_seed 为空（步骤不可复现）")

def classify(p):
    norm = "/" + p.replace("\\", "/").strip("/") + "/"
    if "/public_references/" in norm:
        return "public"
    if "/system_logs/" in norm:
        return "logs"
    for l in LINES:
        if f"/{l}/" in norm:
            return l
    return None

def extract_project(p):
    # .../projects/<project>/... 返回 <project>，旧结构（无 /projects/）返回 None
    norm = "/" + p.replace("\\", "/").strip("/") + "/"
    marker = "/projects/"
    idx = norm.find(marker)
    if idx < 0:
        return None
    rest = norm[idx + len(marker):]
    return rest.split("/")[0] or None

io = data.get("io_files") or {}
for direction in ("input", "output"):
    for p in io.get(direction) or []:
        owner = classify(p)
        if owner is None:
            problems.append(f"io_files.{direction} 路径不在任何合法根下: {p}")
            continue
        if owner != "public" and owner != "logs" and line_id and owner != line_id:
            problems.append(f"io_files.{direction} 跨线: {p} 属于 {owner}，但 line_id={line_id}")
        if direction == "output" and owner == "public":
            problems.append(f"io_files.output 不得写 public_references（只读共享区）: {p}")
        path_project = extract_project(p)
        if path_project is not None and path_project != project_id:
            problems.append(f"io_files.{direction} 跨项目: {p} 属于项目 {path_project}，但 project_id={project_id}")

name = path.split("/")[-1]
if problems:
    for p in problems:
        print(f"[logs:{name}] VIOLATION {p}")
    sys.exit(1)
else:
    print(f"[logs:{name}] OK project_id={project_id} line_id={line_id} status={status}")
    sys.exit(0)
PY
)
  rc=$?
  if [ "$rc" -ne 0 ]; then fail=1; fi
  [ -n "$out" ] && printf '%s\n' "$out"
done

echo ""
if [ "$fail" -ne 0 ]; then
  echo "总体 = FAIL"
  exit 1
else
  echo "总体 = PASS"
  exit 0
fi
