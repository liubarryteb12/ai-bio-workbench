#!/usr/bin/env bash
# ==============================================================================
# File: 01_mobile_compute/runtime/pi_idempotent_runner.sh
# Purpose: 断网自治、原子 .lock/.done 检查点、日志削峰与三联 Artifact 组装器
# Usage: ./pi_idempotent_runner.sh <task_id> <manifest_id> <step_id> <work_dir> <cmd...>
# ==============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/bio_limits.sh"

TASK_ID="$1"
MANIFEST_ID="$2"
STEP_ID="$3"
STEP_WORK_DIR="$4"
shift 4
CMD_TO_RUN=("$@")

check_no_sdcard_path "${STEP_WORK_DIR}"
mkdir -p "${STEP_WORK_DIR}"

LOCK_FILE="${STEP_WORK_DIR}/${STEP_ID}.lock"
DONE_FILE="${STEP_WORK_DIR}/${STEP_ID}.done"
STDOUT_LOG="${STEP_WORK_DIR}/${STEP_ID}.stdout.log"
STDERR_LOG="${STEP_WORK_DIR}/${STEP_ID}.stderr.log"
TRIAD_JSON="${STEP_WORK_DIR}/${STEP_ID}.triad.json"

# 1. 幂等命中检查：如果 .done 已存在且 Triad 账本完整，直接秒级返回缓存产物
if [[ -f "${DONE_FILE}" ]] && [[ -f "${TRIAD_JSON}" ]]; then
    python3 -c "
import json, sys
p = '${TRIAD_JSON}'
data = json.load(open(p, 'r', encoding='utf-8'))
data['from_idempotent_cache'] = True
json.dump(data, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
"
    cat "${TRIAD_JSON}"
    exit 0
fi

# 2. 防并发冲突检查：若 .lock 存在且对应进程组仍存活，拒绝重复拉起
if [[ -f "${LOCK_FILE}" ]]; then
    OLD_PGID="$(cat "${LOCK_FILE}" 2>/dev/null || echo "")"
    if [[ -n "${OLD_PGID}" ]] && kill -0 "-${OLD_PGID}" 2>/dev/null; then
        echo "[WARN] Step ${STEP_ID} 正在运行中 (PGID=${OLD_PGID})，跳过重复派发" >&2
        exit 75
    else
        rm -f "${LOCK_FILE}"
    fi
fi

# 3. 启动独立进程组执行生信脚本，并记录开始时间与 PGID
START_TS="$(date +%s.%N 2>/dev/null || date +%s)"
if command -v setsid >/dev/null 2>&1; then
    setsid "${CMD_TO_RUN[@]}" >"${STDOUT_LOG}" 2>"${STDERR_LOG}" &
else
    "${CMD_TO_RUN[@]}" >"${STDOUT_LOG}" 2>"${STDERR_LOG}" &
fi
CHILD_PID=$!
echo "${CHILD_PID}" > "${LOCK_FILE}"

# 捕获退出信号清理残留进程组
cleanup_lock() {
    rm -f "${LOCK_FILE}"
}
trap cleanup_lock EXIT

wait "${CHILD_PID}"
EXIT_CODE=$?
END_TS="$(date +%s.%N 2>/dev/null || date +%s)"

# 4. 调用内嵌 Python 生成三联 Artifact (JSON + 削峰日志 + 产物 SHA256 与魔数初筛)
python3 - "${TASK_ID}" "${MANIFEST_ID}" "${STEP_ID}" "${STEP_WORK_DIR}" "${EXIT_CODE}" "${START_TS}" "${END_TS}" "${TRIAD_JSON}" << 'PYEOF'
import hashlib
import json
import os
import sys

task_id, manifest_id, step_id, work_dir, exit_code, start_ts, end_ts, triad_path = sys.argv[1:]
exit_code = int(exit_code)
duration = round(float(end_ts) - float(start_ts), 3)

def read_head_tail(path, max_lines=40, max_chars=4000):
    if not os.path.exists(path):
        return "", ""
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        lines = f.readlines()
    head = "".join(lines[:max_lines])[:max_chars]
    tail = "".join(lines[-max_lines:])[-max_chars:]
    return head, tail

def verify_magic(filepath):
    ext = os.path.splitext(filepath)[1].lower()
    size = os.path.getsize(filepath)
    if size == 0:
        return False
    with open(filepath, "rb") as f:
        head = f.read(16)
        f.seek(max(0, size - 64))
        tail = f.read(64)
    if ext == ".png":
        return head.startswith(b"\x89PNG\r\n\x1a\n") and tail.endswith(b"IEND\xaeB`\x82")
    if ext == ".pdf":
        return head.startswith(b"%PDF-") and (b"%%EOF" in tail)
    return True

outputs_ledger = []
for root, _, files in os.walk(work_dir):
    for fn in sorted(files):
        if fn.endswith((".lock", ".done", ".stdout.log", ".stderr.log", ".triad.json")):
            continue
        full_p = os.path.join(root, fn)
        rel_p = os.path.relpath(full_p, work_dir)
        h = hashlib.sha256()
        with open(full_p, "rb") as bf:
            for chunk in iter(lambda: bf.read(65536), b""):
                h.update(chunk)
        outputs_ledger.append({
            "relpath": rel_p,
            "sha256": h.hexdigest(),
            "size_bytes": os.path.getsize(full_p),
            "magic_valid": verify_magic(full_p)
        })

out_head, out_tail = read_head_tail(os.path.join(work_dir, f"{step_id}.stdout.log"))
_, err_tail = read_head_tail(os.path.join(work_dir, f"{step_id}.stderr.log"), max_lines=60, max_chars=6000)

triad = {
    "task_id": task_id,
    "manifest_id": manifest_id,
    "step_id": step_id,
    "node_id": os.environ.get("BIO_NODE_ID", "k40-ubuntu-node01"),
    "exit_code": exit_code,
    "from_idempotent_cache": False,
    "duration_sec": duration,
    "outputs_ledger": outputs_ledger,
    "log_digest": {
        "stdout_head": out_head,
        "stdout_tail": out_tail,
        "stderr_tail": err_tail
    }
}

with open(triad_path, "w", encoding="utf-8") as out_f:
    json.dump(triad, out_f, ensure_ascii=False, indent=2)
PYEOF

# 5. 若退出码为 0，原子写入 .done 标记
if [[ "${EXIT_CODE}" -eq 0 ]]; then
    date -u +"%Y-%m-%dT%H:%M:%SZ" > "${DONE_FILE}"
fi

cat "${TRIAD_JSON}"
exit "${EXIT_CODE}"
