#!/data/data/com.termux/files/usr/bin/bash
# ensure_runsvdir.sh —— K40 Termux 宿主面幂等点火器
#
# 2026-11-01 第三版（按 4 Argon 第三轮破局方案重构）。相对前两版的关键修正：
#
# 1. **严禁 pkill sshd**（Argon 模式一：控制面重建与数据面解耦）。
#    前两版为了清除端口占用者会杀 sshd，结果把自己正在用的 ssh 会话一起杀掉，
#    链路整体断掉、只能靠 run-as 人工救回。现在只回收 runsvdir 与 runsv 监督进程，
#    承载会话的 sshd 一律不动；若端口已被旧 sshd 占用，新 sshd 由 run 脚本等待接管。
#
# 2. **绝不 rm -rf supervise/**（Argon 第二点）。
#    supervise/ok 与 control 是 runsv 用 mkfifo 创建的 FIFO 管道。
#    runas_app（run-as）SELinux 域禁止 create fifo_file，所以一旦删掉就再也建不回来；
#    保留它们，退化到 run-as 域时 open 已存在的 FIFO 仍被允许。
#    只清 supervise/lock 这个普通文件。
#
# 3. **锁只绑 runsvdir 本体**（Argon 第一点）。
#    旧版 exec 9>锁 后把 runsvdir 挂后台，fd 9 被整棵子树（runsv/sshd/dropbear）继承，
#    导致：runsvdir 秒退但子进程还活着时锁不释放；单杀 runsvdir 后新实例永远拿不到锁。
#    现在用 flock -n 直接包裹 runsvdir 自身，锁随 runsvdir 退出即释放。
#
# 4. **15 秒死人开关**（Argon 模式三）。
#    任何重建动作执行前先挂一个独立看门狗：15 秒后若 8022 仍无监听，就裸起一个 sshd 保底，
#    避免重建翻车后陷入失联死局（这正是前几轮反复发生的场景）。
#
# 用法：bash tools/ops/k40/ensure_runsvdir.sh           幂等点火
#       bash tools/ops/k40/ensure_runsvdir.sh --status  只报状态
# 退出码：0 已就绪 / 1 点火后仍不健康 / 2 环境前置缺失
set -uo pipefail

PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PREFIX
export PATH="$PREFIX/bin:$PATH"
export SVDIR="${SVDIR:-$PREFIX/var/service}"
export LOGDIR="$PREFIX/var/log"
export HOME="${HOME:-/data/data/com.termux/files/home}"

LOCK_FILE="$PREFIX/var/run/runsvdir.singleton.lock"
PID_FILE="$LOCK_FILE.pid"
SERVICES="sshd crond ssh-agent ubuntu-sshd pi-a2a"
# 进程表位置（自测脚本指向 fixture 目录，生产恒为 /proc）
PROC_DIR="${PROC_DIR:-/proc}"
mkdir -p "$PREFIX/var/run" "$LOGDIR"

# 计数：不依赖 ps（容器 P-29 红线），遍历 /proc/*/cmdline
count_runsv() {
  local n=0 f argv0
  for f in "$PROC_DIR"/[0-9]*/cmdline; do
    [ -r "$f" ] || continue
    argv0=$(tr '\0' '\n' < "$f" 2>/dev/null | head -n 1)
    case "${argv0##*/}" in
      runsv) n=$((n+1)) ;;
    esac
  done
  echo "$n"
}

port_listening() {
  # 2026-11-03 实测修正：Android 10 起 app uid 读 /proc/net/tcp 与 /proc/self/net/tcp
  # 一律 Permission denied（ssh 与 adb run-as 两个入口都一样），旧版这里恒返回 1，
  # 导致 healthy() 永远为假：快判从不短路、每次点火都走破坏性重建，死人开关也恒触发。
  # 改用同 netns 内的 TCP connect 探测（bash 才有 /dev/tcp，脚本本身是 bash）。
  "$PREFIX/bin/bash" -c "exec 3<>/dev/tcp/127.0.0.1/$1" >/dev/null 2>&1
}

# 监督实例判据（2026-11-03 第二版实测修正）：
# 真在监督的实例，/proc/<pid>/cmdline 是 "runsvdir <SVDIR>"，**不带 -P**
#   （runsvdir 启动后会改写自己的 argv，-P 被吃掉）。第一版要求 argv 里出现
#   " -P <SVDIR>"，于是把健康实例也判成野生态：--status 报「监督实例数: 0」，
#   而四个服务全是 run。
# 真正的野生态是 argv 里 runsvdir 出现两次的那条：
#   "runsvdir /data/data/com.termux/files/usr/bin/runsvdir <SVDIR>"
#   （ppid 1，不监督任何服务，子进程全是 [linker64] <defunct>）。
# 所以判据改成：argv 里引用本 SVDIR，且第二个 token 的基名不是 runsvdir。
is_runsvdir_argv0() {
  case "${1##*/}" in runsvdir) return 0 ;; *) return 1 ;; esac
}

# 野生态形态：第二个 token 的基名仍是 runsvdir（重复启动产生的孤儿）
is_duplicated_runsvdir_argv() {
  local rest first
  rest=${1#"$2"}
  # shellcheck disable=SC2086
  set -- $rest
  first=${1:-}
  case "${first##*/}" in runsvdir) return 0 ;; *) return 1 ;; esac
}

supervises_svdir() {
  case "$1" in *"$SVDIR"*) return 0 ;; *) return 1 ;; esac
}

# 纯判定：给人造 argv 分类，自测脚本直接调它（不依赖真实进程表）。
# $1=argv0（可含路径），$2=完整 argv（NUL 已换成空格）
classify_runsvdir_argv() {
  is_runsvdir_argv0 "$1" || { echo other; return 0; }
  is_duplicated_runsvdir_argv "$2" "$1" && { echo stray; return 0; }
  supervises_svdir "$2" && echo supervising || echo stray
}

count_supervising_runsvdir() {
  local n=0 f argv0 args
  for f in "$PROC_DIR"/[0-9]*/cmdline; do
    [ -r "$f" ] || continue
    argv0=$(tr '\0' '\n' < "$f" 2>/dev/null | head -n 1) || continue
    is_runsvdir_argv0 "$argv0" || continue
    args=$(tr '\0' ' ' < "$f" 2>/dev/null) || continue
    [ "$(classify_runsvdir_argv "$argv0" "$args")" = supervising ] || continue
    n=$((n+1))
  done
  echo "$n"
}

count_stray_runsvdir() {
  local n=0 f argv0 args
  for f in "$PROC_DIR"/[0-9]*/cmdline; do
    [ -r "$f" ] || continue
    argv0=$(tr '\0' '\n' < "$f" 2>/dev/null | head -n 1) || continue
    is_runsvdir_argv0 "$argv0" || continue
    args=$(tr '\0' ' ' < "$f" 2>/dev/null) || continue
    [ "$(classify_runsvdir_argv "$argv0" "$args")" = stray ] || continue
    n=$((n+1))
  done
  echo "$n"
}

stray_pids() {
  local f argv0 args pid
  for f in "$PROC_DIR"/[0-9]*/cmdline; do
    [ -r "$f" ] || continue
    argv0=$(tr '\0' '\n' < "$f" 2>/dev/null | head -n 1) || continue
    is_runsvdir_argv0 "$argv0" || continue
    args=$(tr '\0' ' ' < "$f" 2>/dev/null) || continue
    [ "$(classify_runsvdir_argv "$argv0" "$args")" = stray ] || continue
    pid=$(basename "$(dirname "$f")" 2>/dev/null) || continue
    case "$pid" in ''|*[!0-9]*) continue ;; esac
    echo "$pid"
  done
}

status_report() {
  local s
  for s in $SERVICES; do
    printf '%s: ' "$s"
    sv status "$s" 2>&1 | head -1
  done
  echo "runsvdir 监督实例数: $(count_supervising_runsvdir)（应为 1）"
  echo "runsvdir 野生态: $(count_stray_runsvdir)（不监督任何服务；应为 0，见 --reap-stray）"
  echo "runsv 监督进程数: $(count_runsv)"
}

healthy() {
  # 健康三条件：恰好一个 runsvdir 在跑；8022 有人监听（不管是不是当前 runsv 起的，
  # 旧 sshd 占着端口也算连通）；ubunt-sshd 在 run 保证容器面可用。
  # 「sshd 在 run」不是硬条件：旧 sshd 占着 8022 时新 runsv 会等待接管，
  # 此时 sv 显示 down 但链路是好的（2026-11-01 实测的正常形态）。
  [ "$(count_supervising_runsvdir)" = "1" ] || return 1
  port_listening 8022 || return 1
  sv status ubuntu-sshd 2>&1 | head -1 | grep -q '^run' || return 1
  return 0
}

main() {
if [ "${1:-}" = '--status' ]; then
  status_report
  healthy && exit 0 || exit 1
fi

# --reap-stray：只回收不监督本目录的野生态 runsvdir（ppid 1、没带 -P）。
# 与重建路径分开：清理野生态不动监督树，也不碰 sshd，失败不影响链路。
if [ "${1:-}" = '--reap-stray' ]; then
  pids=$(stray_pids)
  if [ -z "$pids" ]; then
    echo '[ensure] 没有野生态 runsvdir'
    exit 0
  fi
  for pid in $pids; do
    echo "[ensure] 回收野生态 runsvdir pid=$pid"
    kill -TERM "$pid" 2>/dev/null || true
  done
  sleep 2
  for pid in $pids; do
    if [ -d "/proc/$pid" ]; then
      echo "[ensure] pid=$pid 未响应 TERM，升级 KILL"
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
  sleep 1
  echo "[ensure] 回收后野生态数: $(count_stray_runsvdir)"
  exit 0
fi

# ── 第一道防线：无锁快判。已健康就直接退出，绝不碰锁、绝不重启任何服务 ──
if healthy; then
  echo '[ensure] 已存在单个健康 runsvdir（实例数=1、sshd 在 run、8022 在听），无需干预'
  status_report
  exit 0
fi

# ── 死人开关：先挂兜底，再做破坏性动作 ──
# 15 秒后若 8022 仍无监听，裸起一个 sshd，保证任何重建翻车都不会陷入失联。
nohup sh -c "sleep 15; $PREFIX/bin/bash -c 'exec 3<>/dev/tcp/127.0.0.1/8022' >/dev/null 2>&1 || $PREFIX/bin/sshd" \
  >"$PREFIX/tmp/ensure_deadman.log" 2>&1 < /dev/null &
echo '[ensure] 已挂 15 秒死人开关（8022 无监听时裸起 sshd）'

# ── 只在确实需要时才重建监督树 ──
# 铁律：只对 runsvdir / runsv 发信号。承载当前会话的 sshd 绝对不动（Argon 模式一）。
echo '[ensure] 回收多余的 runsvdir 与 runsv 监督进程（不动 sshd）'
for f in /proc/[0-9]*/cmdline; do
  [ -r "$f" ] || continue
  pid=$(basename "$(dirname "$f")" 2>/dev/null) || continue
  [ -n "$pid" ] || continue
  # 绝不杀自己
  [ "$pid" = "$$" ] && continue
  # pid 可能在遍历期间已被回收：cmdline 读失败直接跳过（实测 line 118 报错就是这种竞态）
  argv0=$(tr '\0' '\n' < "$f" 2>/dev/null | head -n 1) || continue
  [ -n "$argv0" ] || continue
  case "${argv0##*/}" in
    runsvdir) kill -TERM "$pid" 2>/dev/null || true ;;
    runsv)    kill -TERM "$pid" 2>/dev/null || true ;;
  esac
done
sleep 3

# supervise 保留：只清 lock（普通文件），ok/control 是 mkfifo 出来的，删了 run-as 域建不回
rm -f "$SVDIR"/*/supervise/lock "$SVDIR"/*/log/supervise/lock 2>/dev/null || true
rm -f "$PREFIX/var/run/crond.pid" "$PREFIX/var/run/ssh-agent.socket" 2>/dev/null || true

# ── 唯一启动：flock 直接包裹 runsvdir 本体，锁随它退出即释放 ──
# setsid 脱离当前 ssh/adb 会话，否则会话一断进程组被 Android 一并回收。
setsid flock -n "$LOCK_FILE" "$PREFIX/bin/runsvdir" -P "$SVDIR" \
  >"$PREFIX/tmp/runsvdir.log" 2>&1 < /dev/null &
echo $! > "$PID_FILE" 2>/dev/null || true
sleep 10

echo '[ensure] 点火完成，当前状态：'
status_report

healthy || { echo '[ensure] 状态不健康，见 $PREFIX/tmp/runsvdir.log 与 $LOGDIR/*.log'; exit 1; }
echo '[ensure] OK'
exit 0
}

# 自测入口：SELFTEST_SOURCE_ONLY=1 时只加载函数与变量，绝不执行任何点火/回收动作。
# 主流程必须整段留在 main() 里：光靠「加载时 return」顶不住，一旦守卫失效就会杀掉真 runsvdir。
if [ "${SELFTEST_SOURCE_ONLY:-}" = 1 ]; then
  return 0 2>/dev/null || exit 0
fi

main "$@"
