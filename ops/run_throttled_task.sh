#!/bin/bash
# run_throttled_task.sh：统一绑核降权执行包装器 + 自动台账 JSON 落盘
# 用法: nohup bash /mnt/ssd/bio_data/ops/run_throttled_task.sh \
#          <task_id> <line_id> <step_name> <R|Python> <script_path> [script_args...] &
#
# 执行面策略（2026-10-20 契约变更，用户拍板）：
#   **默认不静态绑核**——实测依据 docs/k40_cpu_affinity.md §七（交替验证 3 轮每轮全胜）：
#   「不绑核 + 3 线程」比「taskset -c 4,5,6 + 3 线程」快 ~30%（Python matmul）/ 6-11%（R）。
#   机理：EAS 动态调度可上 Prime 3.19GHz，静态绑 2.42GHz 大核反而封顶单线程上限；
#   OpenBLAS NO_AFFINITY 特性也与动态调度配合更好。
#   保留 nice -n 10 + ionice -c 2 -n 4 降权（保 SSH/crond/系统交互响应）。
#   保留开关：BIO_PIN_CPUS=4,5,6 可恢复静态绑核（特殊场景用）。
# 绑核失败保护（坑 #200）：开关启用时若 taskset EINVAL（Android 动态核隔离实测可致），
#   自动降级为不绑核，不让任务因绑核失败而夭折；降级事件打 stdout 供 SSE 日志流可见。
set -e

TASK_ID="$1"
LINE_ID="$2"
STEP_NAME="$3"
LANG_SPEC="$4"
SCRIPT_PATH="$5"
shift 5
SCRIPT_ARGS="$*"

# 前置门禁
bash /mnt/ssd/bio_data/ops/check_storage_and_isolation.sh "$LINE_ID" "$SCRIPT_PATH"

# source 全局线程封顶（proot 下 profile.d 可能不存在，容错）
if [ -f /etc/profile.d/bio_limits.sh ]; then
    source /etc/profile.d/bio_limits.sh || true
fi

START_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
LOG_FILE="/mnt/ssd/bio_data/system_logs/${TASK_ID}.log"
LEDGER_JSON="/mnt/ssd/bio_data/system_logs/${TASK_ID}_ledger.json"

# --- 运行中标记（可观测性）：任务被容器 abort / 被 kill 时不会留下台账，只留这个标记 ---
# 为什么放在子目录：台账校验脚本按 system_logs/*.json 通配，标记不能混进去当台账（会被判 VIOLATION）。
# 清理纪律：正常结束在写完台账之后 rm 掉；只有异常终止才会留下，7 天后由本脚本启动时清理。
RUNNING_DIR="/mnt/ssd/bio_data/system_logs/_running"
RUNNING_JSON="$RUNNING_DIR/${TASK_ID}.json"
mkdir -p "$RUNNING_DIR"
find "$RUNNING_DIR" -maxdepth 1 -name '*.json' -mtime +7 -delete 2>/dev/null || true
cat <<RUNEOF > "$RUNNING_JSON"
{
  "task_id": "$TASK_ID",
  "line_id": "$LINE_ID",
  "step_name": "$STEP_NAME",
  "status": "running",
  "start_time": "$START_TIME",
  "wrapper_pid": $$,
  "note": "运行中标记：正常结束会删除；若残留说明任务被中断（容器 abort / kill），见 con_hf/pitfalls_ledger.md P-23"
}
RUNEOF
echo "[wrapper] 运行中标记已落盘: $RUNNING_JSON"

# 选解释器：如果传了 R/Python/bash 就用对应解释器，否则靠脚本自身 shebang
case "$LANG_SPEC" in
    R|Rscript) EXEC_CMD="Rscript" ;;
    Python|python|python3) EXEC_CMD="python3" ;;
    bash|sh) EXEC_CMD="bash" ;;
    auto|self|"") EXEC_CMD="" ;;
    *) EXEC_CMD="$LANG_SPEC" ;;
esac

# --- 绑核开关与失败降级（契约 2026-10-20：默认不绑核；BIO_PIN_CPUS 可恢复）---
BIO_PIN_CPUS="${BIO_PIN_CPUS:-}"
AFFINITY_PIN=""
AFFINITY_DESC="无绑核（EAS 动态调度，实测更快）"
if [ -n "$BIO_PIN_CPUS" ]; then
    if taskset -c "$BIO_PIN_CPUS" true 2>/dev/null; then
        AFFINITY_PIN="taskset -c $BIO_PIN_CPUS"
        AFFINITY_DESC="taskset -c $BIO_PIN_CPUS"
    else
        echo "[wrapper] $(date -u +%Y-%m-%dT%H:%M:%SZ) BIO_PIN_CPUS=$BIO_PIN_CPUS 不可用（Android 动态核隔离），降级为不绑核执行（保留 nice/ionice 降权）"
        AFFINITY_DESC="BIO_PIN_CPUS=$BIO_PIN_CPUS 不可用降级"
    fi
fi

# 核心削峰执行
set +e
if [ -n "$EXEC_CMD" ]; then
    if [ -n "$SCRIPT_ARGS" ]; then
        $AFFINITY_PIN nice -n 10 ionice -c 2 -n 4 $EXEC_CMD "$SCRIPT_PATH" $SCRIPT_ARGS > "$LOG_FILE" 2>&1
    else
        $AFFINITY_PIN nice -n 10 ionice -c 2 -n 4 $EXEC_CMD "$SCRIPT_PATH" > "$LOG_FILE" 2>&1
    fi
else
    # 靠脚本自身 shebang，只降权（默认不绑核）
    if [ -n "$SCRIPT_ARGS" ]; then
        $AFFINITY_PIN nice -n 10 ionice -c 2 -n 4 "$SCRIPT_PATH" $SCRIPT_ARGS > "$LOG_FILE" 2>&1
    else
        $AFFINITY_PIN nice -n 10 ionice -c 2 -n 4 "$SCRIPT_PATH" > "$LOG_FILE" 2>&1
    fi
fi
EXIT_CODE=$?
set -e

END_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
STATUS=$([ $EXIT_CODE -eq 0 ] && echo "completed" || echo "failed")

cat <<EOF > "$LEDGER_JSON"
{
  "task_id": "$TASK_ID",
  "line_id": "$LINE_ID",
  "step_name": "$STEP_NAME",
  "status": "$STATUS",
  "start_time": "$START_TIME",
  "end_time": "$END_TIME",
  "environment": {
    "language": "$LANG_SPEC",
    "wrapper": "$AFFINITY_DESC nice -n 10 ionice -c 2 -n 4",
    "memory_limit_gb": 7.5
  },
  "checkpoint_status": "$([ $EXIT_CODE -eq 0 ] && echo "passed" || echo "halted")",
  "error_log": "$([ $EXIT_CODE -eq 0 ] && echo "null" || echo "$LOG_FILE")"
}
EOF

# 台账写成功才删运行中标记：标记残留 == 任务被中断的取证
rm -f "$RUNNING_JSON"

exit $EXIT_CODE
