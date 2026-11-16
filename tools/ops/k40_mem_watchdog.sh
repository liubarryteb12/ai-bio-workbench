#!/usr/bin/env bash
# tools/ops/k40_mem_watchdog.sh
# 运行在 K40 proot 容器内部。
# 监控目标 PID 及其所有子进程树的累计物理常驻内存 (VmRSS)。
# 累计超过 7.5GB (7864320 kB) 主动终止目标进程树并返回 137，杜绝 Android LMK 暴杀 Termux。
set -euo pipefail

TARGET_PID="${1:-}"
MAX_RSS_KB="${2:-7864320}" # 7.5GB = 7864320 kB
CHECK_INTERVAL_SEC="${3:-1}"

if [[ -z "$TARGET_PID" ]]; then
  echo "[WATCHDOG_ERROR] 缺少目标 PID 参数" >&2
  exit 1
fi

echo "[WATCHDOG_START] 正在监控 PID $TARGET_PID (含子进程树), RSS 上限: ${MAX_RSS_KB} kB (7.5GB)"

# 收集目标 PID 及其所有后代 PID
collect_process_tree() {
  local parent="$1"
  local children
  children=$(pgrep -P "$parent" 2>/dev/null || true)
  echo "$parent"
  for child in $children; do
    collect_process_tree "$child"
  done
}

while kill -0 "$TARGET_PID" 2>/dev/null; do
  # 遍历进程树，累加 VmRSS
  ALL_PIDS=$(collect_process_tree "$TARGET_PID")
  TOTAL_RSS_KB=0

  for p in $ALL_PIDS; do
    STATUS_FILE="/proc/$p/status"
    if [[ -f "$STATUS_FILE" ]]; then
      RSS=$(grep -i "^VmRSS:" "$STATUS_FILE" 2>/dev/null | awk '{print $2}' || true)
      if [[ -n "$RSS" && "$RSS" =~ ^[0-9]+$ ]]; then
        TOTAL_RSS_KB=$((TOTAL_RSS_KB + RSS))
      fi
    fi
  done

  if [[ "$TOTAL_RSS_KB" -gt "$MAX_RSS_KB" ]]; then
    echo "[WATCHDOG_OOM_INTERCEPT] 目标进程树总 VmRSS (${TOTAL_RSS_KB} kB) 超过上限 (${MAX_RSS_KB} kB)!" >&2
    echo "[WATCHDOG_ACTION] 主动熔断目标进程树，保护 Termux 容器不被 Android LMK 杀灭..." >&2

    # 向进程树依次发送 SIGTERM -> SIGKILL
    for p in $ALL_PIDS; do
      kill -15 "$p" 2>/dev/null || true
    done
    sleep 2
    for p in $ALL_PIDS; do
      kill -9 "$p" 2>/dev/null || true
    done

    echo "[WATCHDOG_EXIT] 熔断完成，回写 Exit 137。" >&2
    exit 137
  fi

  sleep "$CHECK_INTERVAL_SEC"
done

echo "[WATCHDOG_END] 目标 PID $TARGET_PID 正常结束。"
exit 0
