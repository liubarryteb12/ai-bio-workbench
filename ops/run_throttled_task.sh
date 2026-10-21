#!/bin/bash
# run_throttled_task.sh：统一绑核降权执行包装器 + 自动台账 JSON 落盘
# 用法（两种执行体，见下方「执行体形态」）：
#   ① 脚本路径模式（手工直跑）：
#      nohup bash /mnt/ssd/bio_data/ops/run_throttled_task.sh \
#          <task_id> <line_id> <step_name> <R|Python> <script_path> [script_args...] &
#   ② 命令串模式（工作台引擎下发）：
#      BIO_EXEC_CMD='<完整命令>' BIO_WRAPPER_LEDGER=0 \
#          bash /mnt/ssd/bio_data/ops/run_throttled_task.sh \
#          <task_id> <line_id> <step_name> self <母版绝对路径> &
#
# 执行体形态（2026-10-21 新增，D-21）：
#   ① 脚本路径模式：$5 是母版绝对路径，按 LANG_SPEC 选解释器执行（手工直跑用）。
#   ② 命令串模式：env BIO_EXEC_CMD 非空时，整串交给 `bash -c` 执行；$5 此时**不参与执行**，
#      只用于门禁 check_storage_and_isolation.sh 的跨线静态扫描（传母版绝对路径）。
#      为什么需要：工作台引擎下发的命令带 --input/--output 引号与多段拼接，当成「脚本路径」
#      传进来会被 `"$SCRIPT_PATH"` 当成一个含空格的文件名（ENOENT）——这正是 throttled 分支
#      长期不可用、引擎一直绕过包装器直跑的原因（无 nice/ionice 降权、无门禁、无线程封顶）。
#   台账开关 BIO_WRAPPER_LEDGER（默认 1）：引擎自己有权威台账（server/run.js persistEntry，
#      字段含 project_id/seed），再让包装器写一份精简台账就成了双账，故引擎侧置 0。
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
if [ -n "${BIO_EXEC_CMD:-}" ]; then
    # 命令串模式：整串交给 bash -c，保证提交层写的引号、管道、&& 都按原意解析
    $AFFINITY_PIN nice -n 10 ionice -c 2 -n 4 bash -c "$BIO_EXEC_CMD" > "$LOG_FILE" 2>&1
elif [ -n "$EXEC_CMD" ]; then
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

# BIO_WRAPPER_LEDGER=0：引擎自己有权威台账（含 project_id/seed），再写一份精简台账就是双账
if [ "${BIO_WRAPPER_LEDGER:-1}" = "1" ]; then
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
else
    echo "[wrapper] BIO_WRAPPER_LEDGER=0：跳过包装器台账（由工作台引擎写权威台账，避免双账）"
fi

# 台账写成功才删运行中标记：标记残留 == 任务被中断的取证
rm -f "$RUNNING_JSON"

exit $EXIT_CODE
