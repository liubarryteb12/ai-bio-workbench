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

RSCRIPT_BIN="${BIOANALYS_RSCRIPT:-/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript}"
THERMAL_ROOT="${BIO_THERMAL_ROOT:-/sys/class/thermal}"
THERMAL_HOT_C="${BIO_THERMAL_HOT_C:-90}"
THERMAL_COOL_C="${BIO_THERMAL_COOL_C:-78}"
THERMAL_POLL_SECONDS="${BIO_THERMAL_POLL_SECONDS:-30}"

TASK_ID="$1"
LINE_ID="$2"
STEP_NAME="$3"
LANG_SPEC="$4"
SCRIPT_PATH="$5"
shift 5
SCRIPT_ARGS="$*"

# --- 幂等锁（P3-03 第一批，2026-11-01）：同逻辑步骤键的重复执行互斥 ---
# 逻辑键默认 <line_id>_<step_name>（如 line2_scrna_scenic_tf）。不用 task_id 派生：
# 引擎 id 形如 task_<epoch>_<rand>，重发必然换 epoch 与尾段，按 id 判重挡不住真重复。
# 需要项目维度时引擎侧导出 BIO_LOCK_KEY='<project>:<line>:<step>' 覆盖默认键。
# 跨项目同步骤会互斥串行（键不含项目时的保守代价，不产生错账）。
# 同键撞锁先排队（最长 BIO_LOCK_WAIT_SECONDS），等满了仍被占才拒（exit 4），
# 双击提交这类自然串行化，不误伤合法排队。
# 持锁主死活用 kill -0 判：pid 已死 = 崩溃残留的死锁，回收接管；pid 复用概率
# 在本场景可接受（误判死锁的代价是排队互斥退化为并发，不会双写台账）。
# 释放走 EXIT trap：set -e 中途失败也要放，靠顺序代码会在门禁/热节流出口漏锁。
# 抢占用 noclobber 重定向原子创建，不依赖 flock/util-linux（Termux proot 不保证有）。
# 紧急回滚：BIO_IDEMPOTENT_LOCK=0 整体跳过。exit 4 是锁互斥专用码，与母版
# 0/1/2/3 约定（docs/coding-standards.md 退出码表）不冲突。
BIO_IDEMPOTENT_LOCK="${BIO_IDEMPOTENT_LOCK:-1}"
BIO_LOCK_WAIT_SECONDS="${BIO_LOCK_WAIT_SECONDS:-1200}"
BIO_LOCK_POLL_SECONDS="${BIO_LOCK_POLL_SECONDS:-10}"
LOCK_KEY_RAW="${BIO_LOCK_KEY:-${LINE_ID}_${STEP_NAME}}"
LOCK_KEY=$(printf '%s' "$LOCK_KEY_RAW" | tr -c 'A-Za-z0-9._-' '_')
# 锁命名空间（2026-11-02，黄金冒烟隔离设计）：生产锁在 _locks/，smoke 命名空间
# 落 _locks_smoke/——冒烟与生产队列物理隔离，互不撞锁；同时跳过启动热节流冷却
# （冒烟是秒级只读小任务，不该吃 60s 降温等待）。锁语义本身（幂等/回收/PGID）
# 两边完全一致：冒烟测的就是包装器真链路，不许旁路。
BIO_LOCK_NAMESPACE="${BIO_LOCK_NAMESPACE:-prod}"
if [ "$BIO_LOCK_NAMESPACE" = "prod" ]; then
    LOCK_DIR="/mnt/ssd/bio_data/system_logs/_locks"
else
    NS=$(printf '%s' "$BIO_LOCK_NAMESPACE" | tr -c 'A-Za-z0-9._-' '_')
    LOCK_DIR="/mnt/ssd/bio_data/system_logs/_locks_${NS}"
fi
LOCK_FILE=""
cleanup_wrapper_lock() {
    # 只删自己持有的锁：死锁回收后锁属主已换人，trap 不能把人家的锁删掉
    if [ -n "$LOCK_FILE" ] && [ -f "$LOCK_FILE" ] && grep -q "^$$\$" "$LOCK_FILE" 2>/dev/null; then
        rm -f -- "$LOCK_FILE"
    fi
}
if [ "$BIO_IDEMPOTENT_LOCK" = "1" ]; then
    mkdir -p "$LOCK_DIR"
    LOCK_FILE="$LOCK_DIR/${LOCK_KEY}.lock"
    LOCK_WAITED=0
    while :; do
        if ( set -o noclobber; printf '%s\n%s\n' "$$" "$(awk '{ sub(/^[0-9]+ \([^)]*\) /, ""); print $3 }' /proc/$$/stat 2>/dev/null)" > "$LOCK_FILE" ) 2>/dev/null; then
            echo "[wrapper] $(date -u +%Y-%m-%dT%H:%M:%SZ) LOCK_ACQUIRED key=$LOCK_KEY pid=$$"
            break
        fi
        holder_pid=$(head -n 1 "$LOCK_FILE" 2>/dev/null | tr -d '[:space:]' || echo "")
        holder_pgid=$(sed -n '2p' "$LOCK_FILE" 2>/dev/null | tr -d '[:space:]' || echo "")
        case "$holder_pid" in
            ""|*[!0-9]*) holder_pid="" ;;
        esac
        if [ -n "$holder_pid" ] && ! kill -0 "$holder_pid" 2>/dev/null; then
            echo "[wrapper] $(date -u +%Y-%m-%dT%H:%M:%SZ) STALE_LOCK key=$LOCK_KEY holder=$holder_pid 已退出，回收接管"
            # 盲点一修复（2026-11-01）：包装器死了，其派生的 R/Python 进程组可能还活着
            # （ssh 断连未广播 SIGHUP / 宿主机超时只杀了本机 ssh 客户端）。锁失效但算力
            # 仍被孤儿占用：按锁里记录的 PGID 收尾。pgid != 当前候选主自己的组才动手，
            # 且 TERM 后 2 秒 KILL 兜底；杀不动就放弃（组可能已散或 pid 已复用）。
            # 代价口径：不探测组内存活（ps/遍历 /proc 都撞 P-29 禁令），直接对旧 PGID 发
            # TERM→2s→KILL；打到空组是 no-op，pgid 恰被复用的概率与 pid 复用同级（上文已论证可接受）。
            if [ -n "$holder_pgid" ] && [ "$holder_pgid" -gt 0 ] 2>/dev/null && [ "$holder_pgid" != "$$" ]; then
                echo "[wrapper] $(date -u +%Y-%m-%dT%H:%M:%SZ) STALE_LOCK key=$LOCK_KEY 收尾残留进程组 pgid=$holder_pgid"
                kill -TERM -"$holder_pgid" 2>/dev/null || true
                sleep 2
                kill -KILL -"$holder_pgid" 2>/dev/null || true
            fi
            rm -f -- "$LOCK_FILE"
            continue
        fi
        if [ "$LOCK_WAITED" -ge "$BIO_LOCK_WAIT_SECONDS" ]; then
            echo "[wrapper] $(date -u +%Y-%m-%dT%H:%M:%SZ) ALREADY_RUNNING key=$LOCK_KEY holder=${holder_pid:-unknown} waited=${LOCK_WAITED}s，拒绝重复执行"
            LOCK_FILE=""
            exit 4
        fi
        echo "[wrapper] $(date -u +%Y-%m-%dT%H:%M:%SZ) LOCK_WAIT key=$LOCK_KEY holder=${holder_pid:-unknown} waited=${LOCK_WAITED}s poll=${BIO_LOCK_POLL_SECONDS}s"
        sleep "$BIO_LOCK_POLL_SECONDS"
        LOCK_WAITED=$((LOCK_WAITED + BIO_LOCK_POLL_SECONDS))
    done
fi
# --- 进程组自清（盲点一，2026-11-01）---
# setsid 起来的 detached 包装器自己是组长：退出时把整组（bash -c -> nice/ionice ->
# Rscript/python3 及其线程组）一起收尾，杜绝「包装器已死、R 还在后台吃满 CPU」的孤儿态。
# 前台模式（非组长）绝不做组杀：那时 $$ 的组属于 sshd 会话，误杀会掀掉连接本身。
cleanup_wrapper_pgroup() {
    # 组杀只在显式 detached 场景做（引擎 setsid nohup 下发时置 BIO_DETACHED=1）：
    # 那时包装器是组长，退出时把整组（bash -c -> nice/ionice -> R/Python）收尾，
    # 杜绝「包装器已死、R 还在后台吃满 CPU」的孤儿态。
    # 双保险判据=置位标记+组长：测试 harness 里 $$ 可能恰好也是组长（不同 spawn
    # 上下文的进程组归属不一致），单靠 $$==pgid 会误杀自己的会话组，把 EXIT trap
    # 打成自信号循环（2026-11-01 实测：wrapper_exec_modes 5 条 60s 卡死）。
    [ "${BIO_DETACHED:-0}" = "1" ] || return 0
    my_pgid=$(awk '{ sub(/^[0-9]+ \([^)]*\) /, ""); print $3 }' /proc/$$/stat 2>/dev/null)
    if [ -n "$my_pgid" ] && [ "$my_pgid" = "$$" ]; then
        # 组杀命中自己：先对 TERM/INT/HUP 置忽略，防自信号重入 trap
        trap '' TERM INT HUP
        kill -TERM -"$$" 2>/dev/null || true
        sleep 2
        kill -KILL -"$$" 2>/dev/null || true
    fi
    return 0
}
# 两段收尾都必须跑：先放锁（cleanup_wrapper_lock 自带 LOCK_FILE 空值保护，
# BIO_IDEMPOTENT_LOCK=0 时是 no-op），再组自清。内联成一条 EXIT trap——
# tools/reporting/tests/test_run_throttled_task_lock.py 钉的就是"释放走 trap .*cleanup_wrapper_lock.* EXIT"。
trap 'cleanup_wrapper_lock || true; cleanup_wrapper_pgroup || true' EXIT
trap 'cleanup_wrapper_lock || true; cleanup_wrapper_pgroup || true; exit 143' HUP INT TERM

# 前置门禁
bash "${BIO_STORAGE_GUARD:-/mnt/ssd/bio_data/ops/check_storage_and_isolation.sh}" "$LINE_ID" "$SCRIPT_PATH"

# source 全局线程封顶（proot 下 profile.d 可能不存在，容错）
if [ -f /etc/profile.d/bio_limits.sh ]; then
    source /etc/profile.d/bio_limits.sh || true
fi

# --- 启动前热节流门禁（WP-1.3）---
# 读取所有可用 thermal_zone，取最高温度。原始值通常为毫摄氏度，也兼容摄氏度。
thermal_max_c() {
    local sensor raw value temperature max_value=""
    for sensor in "$THERMAL_ROOT"/thermal_zone*/temp; do
        [ -r "$sensor" ] || continue
        raw=$(tr -d '[:space:]' < "$sensor" 2>/dev/null || true)
        case "$raw" in
            ""|*[!0-9.-]*) continue ;;
        esac
        value=$(awk -v raw="$raw" 'BEGIN {
            value = raw + 0
            if (value >= 1000) value = value / 1000
            if (value > 0 && value < 150) printf "%.1f", value
        }')
        [ -n "$value" ] || continue
        if [ -z "$max_value" ] || awk -v current="$value" -v max="$max_value" 'BEGIN { exit !(current > max) }'; then
            max_value="$value"
        fi
    done
    printf '%s\n' "$max_value"
}

INITIAL_TEMP_C=$(thermal_max_c)
POST_COOLDOWN_TEMP_C="$INITIAL_TEMP_C"
THERMAL_WAIT_SECONDS=0
if [ -z "$INITIAL_TEMP_C" ]; then
    echo "[wrapper] $(date -u +%Y-%m-%dT%H:%M:%SZ) THERMAL_UNKNOWN root=$THERMAL_ROOT 温度不可读，跳过冷却门禁"
elif [ "${BIO_LOCK_NAMESPACE:-prod}" != "prod" ]; then
    # 冒烟命名空间跳过热冷却（秒级只读小任务，撞不上生产负载），但温度照记进台账
    echo "[wrapper] $(date -u +%Y-%m-%dT%H:%M:%SZ) THERMAL_SKIP namespace=${BIO_LOCK_NAMESPACE} current=${INITIAL_TEMP_C}C"
elif awk -v current="$INITIAL_TEMP_C" -v hot="$THERMAL_HOT_C" 'BEGIN { exit !(current >= hot) }'; then
    echo "[wrapper] $(date -u +%Y-%m-%dT%H:%M:%SZ) THERMAL_COOLDOWN start=${INITIAL_TEMP_C}C hot=${THERMAL_HOT_C}C target_below=${THERMAL_COOL_C}C poll=${THERMAL_POLL_SECONDS}s"
    while [ -n "$POST_COOLDOWN_TEMP_C" ] && awk -v current="$POST_COOLDOWN_TEMP_C" -v cool="$THERMAL_COOL_C" 'BEGIN { exit !(current >= cool) }'; do
        sleep "$THERMAL_POLL_SECONDS"
        THERMAL_WAIT_SECONDS=$((THERMAL_WAIT_SECONDS + THERMAL_POLL_SECONDS))
        POST_COOLDOWN_TEMP_C=$(thermal_max_c)
        if [ -z "$POST_COOLDOWN_TEMP_C" ]; then
            echo "[wrapper] $(date -u +%Y-%m-%dT%H:%M:%SZ) THERMAL_SENSOR_LOST 冷却期间温度不可读，拒绝启动任务"
            exit 1
        fi
        echo "[wrapper] $(date -u +%Y-%m-%dT%H:%M:%SZ) THERMAL_COOLDOWN current=${POST_COOLDOWN_TEMP_C}C waited=${THERMAL_WAIT_SECONDS}s"
    done
    echo "[wrapper] $(date -u +%Y-%m-%dT%H:%M:%SZ) THERMAL_READY current=${POST_COOLDOWN_TEMP_C}C waited=${THERMAL_WAIT_SECONDS}s"
fi

START_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
LOG_FILE="/mnt/ssd/bio_data/system_logs/${TASK_ID}.log"
LEDGER_JSON="${BIO_WRAPPER_LEDGER_PATH:-/mnt/ssd/bio_data/system_logs/${TASK_ID}_ledger.json}"

# --- 运行中标记（可观测性）：任务被容器 abort / 被 kill 时不会留下台账，只留这个标记 ---
# 为什么放在子目录：台账校验脚本按 system_logs/*.json 通配，标记不能混进去当台账（会被判 VIOLATION）。
# 清理纪律：正常结束在写完台账之后 rm 掉；只有异常终止才会留下，7 天后由本脚本启动时清理。
RUNNING_DIR="/mnt/ssd/bio_data/system_logs/_running"
RUNNING_JSON="$RUNNING_DIR/${TASK_ID}.json"
mkdir -p "$RUNNING_DIR"
now_epoch=$(date +%s)
for stale_marker in "$RUNNING_DIR"/*.json; do
    [ -f "$stale_marker" ] || continue
    marker_mtime=$(stat -c %Y "$stale_marker" 2>/dev/null || echo "$now_epoch")
    if [ $((now_epoch - marker_mtime)) -gt 604800 ]; then
        rm -f -- "$stale_marker"
    fi
done
cat <<RUNEOF > "$RUNNING_JSON"
{
  "task_id": "$TASK_ID",
  "line_id": "$LINE_ID",
  "step_name": "$STEP_NAME",
  "status": "running",
  "start_time": "$START_TIME",
  "wrapper_pid": $$,
  "wrapper_pgid": "$(awk '{ sub(/^[0-9]+ \([^)]*\) /, ""); print $3 }' /proc/$$/stat 2>/dev/null)",
  "note": "运行中标记：正常结束会删除；若残留说明任务被中断（容器 abort / kill），见 ledger/pitfalls_ledger.md P-23"
}
RUNEOF
echo "[wrapper] 运行中标记已落盘: $RUNNING_JSON"

# 选解释器：如果传了 R/Python/bash 就用对应解释器，否则靠脚本自身 shebang
case "$LANG_SPEC" in
    R|Rscript) EXEC_CMD="$RSCRIPT_BIN" ;;
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
    "memory_limit_gb": 7.5,
    "thermal": {
      "initial_temp_c": ${INITIAL_TEMP_C:-null},
      "post_cooldown_temp_c": ${POST_COOLDOWN_TEMP_C:-null},
      "cooldown_seconds": $THERMAL_WAIT_SECONDS,
      "hot_threshold_c": "$THERMAL_HOT_C",
      "cool_threshold_c": "$THERMAL_COOL_C"
    }
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
