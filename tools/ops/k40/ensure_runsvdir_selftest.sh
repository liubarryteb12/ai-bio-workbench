#!/data/data/com.termux/files/usr/bin/bash
# tools/ops/k40/ensure_runsvdir_selftest.sh
# 校验 tools/ops/k40/ensure_runsvdir.sh：端口探活、runsvdir 分类计数、main() 结构。
# 用法：bash tools/ops/k40/ensure_runsvdir_selftest.sh [脚本路径]
# 原理：PREFIX 与 PROC_DIR 指到临时目录，用 fixture 的 cmdline 冒充进程表，
#       用 shim 冒充 bash（/dev/tcp 探活）与 sv（服务状态），断言函数返回值；
#       SELFTEST_SOURCE_ONLY=1 引入目标脚本，再用哨兵证明主流程没有被执行。
set -u

TARGET=${1:-$(cd "$(dirname "$0")" && pwd)/ensure_runsvdir.sh}
[ -f "$TARGET" ] || { echo "SELFTEST_FAIL: 找不到 $TARGET"; exit 1; }

# 临时目录失败时直接判红：降级到固定路径会污染设备 /tmp，且失败后的结果不可信。
TMP_ROOT=${TMPDIR:-${PREFIX:-/data/data/com.termux/files/usr}/tmp}
[ -d "$TMP_ROOT" ] || TMP_ROOT=/tmp
T=$(mktemp -d "$TMP_ROOT/ers.XXXXXX" 2>/dev/null) || { echo "SELFTEST_FAIL: mktemp -d 不可用（TMP_ROOT=$TMP_ROOT），无法隔离 fixture"; exit 1; }
mkdir -p "$T/prefix/bin" "$T/prefix/var/service" "$T/prefix/var/log" "$T/prefix/tmp" "$T/proc" || {
  echo "SELFTEST_FAIL: 无法建立 fixture 目录 $T"; exit 1; }
trap 'rm -rf "$T"' EXIT
FAILED=0
OKS=0

ok()  { OKS=$((OKS+1)); echo "ok   $1"; }
bad() { FAILED=1; echo "FAIL $1: $2"; }
eq()  { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "期望 [$3]，实得 [$2]"; fi; }

# ── shim：bash 只用于 /dev/tcp 探活，端口通不通由 $SELFTEST_PORT_FLAG 文件控制 ──
cat > "$T/prefix/bin/bash" <<'SHIM'
#!/bin/sh
[ -f "$SELFTEST_PORT_FLAG" ] && exit 0
exit 1
SHIM
# ── shim：sv 一律报 run（健康判据里只用到 ubuntu-sshd 那一行）──
cat > "$T/prefix/bin/sv" <<'SHIM'
#!/bin/sh
echo "run: fake (pid 1) 1s; run: log: (pid 2) 1s"
exit 0
SHIM
# ── 哨兵 shim：一旦被调用就留痕，用来证明 source 时主流程没有跑 ──
for name in setsid sshd flock; do
  cat > "$T/prefix/bin/$name" <<SHIM
#!/bin/sh
echo "$0 $*" >> "$T/sentinel_$name"
exit 0
SHIM
  chmod 755 "$T/prefix/bin/$name"
done
chmod 755 "$T/prefix/bin/bash" "$T/prefix/bin/sv"

export PREFIX="$T/prefix"
export SVDIR="$PREFIX/var/service"
export PROC_DIR="$T/proc"
export SELFTEST_PORT_FLAG="$T/port_up"
export SELFTEST_SOURCE_ONLY=1
: > "$SELFTEST_PORT_FLAG"

# 重置 fixture：一个健康监督进程 + 一个 flock 包装行 + 一个野生态
fixture_reset() {
  rm -rf "$PROC_DIR"/[0-9]* 2>/dev/null || true
  mkdir -p "$PROC_DIR/111" "$PROC_DIR/112" "$PROC_DIR/201"
  printf '%s\0' "$PREFIX/bin/runsvdir" "-P" "$SVDIR" > "$PROC_DIR/111/cmdline"
  printf '%s\0' "$PREFIX/bin/flock" "-n" "$PREFIX/var/run/lock" "$PREFIX/bin/runsvdir" "-P" "$SVDIR" > "$PROC_DIR/112/cmdline"
  printf '%s\0' "$PREFIX/bin/runsvdir" "$PREFIX/bin/runsvdir" "$SVDIR" > "$PROC_DIR/201/cmdline"
}
fixture_reset

# ── 0. source 只加载函数：主流程不许被执行 ──
# shellcheck disable=SC1090
. "$TARGET"
if [ "$(type -t main 2>/dev/null)" = "function" ]; then ok "source 后 main 是函数"; else bad "main 结构" "未见 main() 函数定义"; fi
if [ -f "$T/sentinel_setsid" ] || [ -f "$T/sentinel_sshd" ] || [ -f "$T/sentinel_flock" ]; then
  bad "source 触发了主流程" "$(ls "$T"/sentinel_* 2>/dev/null | tr '\n' ' ')"
else
  ok "source 未执行任何点火/回收动作"
fi

# ── 1. classify_runsvdir_argv：三种真实形态 ──
eq "监督形态归类" "$(classify_runsvdir_argv "$PREFIX/bin/runsvdir" "$PREFIX/bin/runsvdir -P $SVDIR ")" "supervising"
eq "野生态归类（无 -P，第二段也是 runsvdir）" \
   "$(classify_runsvdir_argv "$PREFIX/bin/runsvdir" "$PREFIX/bin/runsvdir $PREFIX/bin/runsvdir $SVDIR ")" "stray"
eq "flock 包装行归类（argv0 是 flock）" \
   "$(classify_runsvdir_argv "$PREFIX/bin/flock" "$PREFIX/bin/flock -n $PREFIX/var/run/lock $PREFIX/bin/runsvdir -P $SVDIR ")" "other"
eq "真实健康形态（runsvdir 改写 argv，-P 消失）" \
   "$(classify_runsvdir_argv "$PREFIX/bin/runsvdir" "$PREFIX/bin/runsvdir $SVDIR ")" "supervising"

# ── 2. 计数：fixture 里 1 个监督 + 1 个 flock + 1 个野生态 ──
eq "监督实例计数" "$(count_supervising_runsvdir)" "1"
eq "野生态计数" "$(count_stray_runsvdir)" "1"
eq "野生态 pid 列表" "$(stray_pids | tr '\n' ',')" "201,"

mkdir -p "$PROC_DIR/113"
printf '%s\0' "$PREFIX/bin/runsvdir" "-P" "$SVDIR" > "$PROC_DIR/113/cmdline"
eq "双监督实例计数" "$(count_supervising_runsvdir)" "2"
eq "双监督下野生态计数" "$(count_stray_runsvdir)" "1"
fixture_reset
mkdir -p "$PROC_DIR/202"
printf '%s\0' "$PREFIX/bin/runsvdir" "$SVDIR" > "$PROC_DIR/202/cmdline"
eq "无 -P 形态也计入监督实例（设备真身）" "$(count_supervising_runsvdir)" "2"
eq "无 -P 形态不算野生态" "$(count_stray_runsvdir)" "1"
fixture_reset

# ── 3. 端口探活：只认 /dev/tcp 的结果 ──
rm -f "$SELFTEST_PORT_FLAG"
if port_listening 8022; then bad "端口不通时应为假" "port_listening 返回 0"; else ok "端口不通判假"; fi
: > "$SELFTEST_PORT_FLAG"
if port_listening 8022; then ok "端口通判真"; else bad "端口通时应为真" "port_listening 返回非 0"; fi

# ── 4. healthy：监督实例=1 + 端口通 + ubuntu-sshd 在 run ──
if healthy; then ok "健康态判真（野生态不影响）"; else bad "健康态判真" "healthy 返回非 0"; fi
mkdir -p "$PROC_DIR/114"
printf '%s\0' "$PREFIX/bin/runsvdir" "-P" "$SVDIR" > "$PROC_DIR/114/cmdline"
if healthy; then bad "双监督应判不健康" "healthy 返回 0"; else ok "双监督判不健康"; fi
fixture_reset
rm -f "$SELFTEST_PORT_FLAG"
if healthy; then bad "端口不通应判不健康" "healthy 返回 0"; else ok "端口不通判不健康"; fi
: > "$SELFTEST_PORT_FLAG"
rm -rf "$PROC_DIR"/[0-9]*
if healthy; then bad "零监督应判不健康" "healthy 返回 0"; else ok "零监督判不健康"; fi
fixture_reset

# ── 5. 静态断言 ──
CODE="$T/code_only.txt"
tr -d '\r' < "$TARGET" | grep -v '^[[:space:]]*#' > "$CODE"
if grep -q '/proc/net/tcp' "$CODE"; then
  bad "代码行残留 /proc/net/tcp" "$(grep -n '/proc/net/tcp' "$CODE" | head -1)"
else
  ok "代码行无 /proc/net/tcp（注释里的历史说明不算）"
fi
TCP_HITS=$(grep -c 'exec 3<>/dev/tcp/127.0.0.1/' "$CODE")
eq "/dev/tcp 探活出现在 2 处（端口判据 + 死人开关）" "$TCP_HITS" "2"
if grep -q '\$\$\$' "$CODE"; then bad "残留三美元自比较" "旧版写错的自身 pid 守卫"; else ok "无三美元自比较"; fi
if grep -q '\[ "$pid" = "$$" \]' "$CODE"; then ok "自身 pid 守卫用两美元"; else bad "自身 pid 守卫" "未见双美元比较"; fi
if grep -q -- "'--reap-stray'" "$CODE"; then ok "存在 --reap-stray 回收分支（整词匹配参数判定）"; else bad "--reap-stray 分支" "未见该参数"; fi

# 破坏性动作必须落在 main() 之内：判据是行号顺序，main 调用必须是最后一个代码行。
MAIN_DEF=$(grep -n '^main() {' "$CODE" | head -1 | cut -d: -f1)
SETSID_LINE=$(grep -n 'setsid flock' "$CODE" | head -1 | cut -d: -f1)
KILL_LINE=$(grep -n 'kill -TERM "$pid"' "$CODE" | head -1 | cut -d: -f1)
MAIN_CALL=$(grep -n '^main "$@"' "$CODE" | head -1 | cut -d: -f1)
CODE_LINES=$(grep -n . "$CODE" | tail -1 | cut -d: -f1)
if [ -n "$MAIN_DEF" ] && [ -n "$SETSID_LINE" ] && [ "$MAIN_DEF" -lt "$SETSID_LINE" ]; then
  ok "setsid 启动在 main() 内（定义行 $MAIN_DEF < 启动行 $SETSID_LINE）"
else
  bad "setsid 启动归属" "main 定义行 [$MAIN_DEF]，setsid 行 [$SETSID_LINE]"
fi
if [ -n "$MAIN_DEF" ] && [ -n "$KILL_LINE" ] && [ "$MAIN_DEF" -lt "$KILL_LINE" ]; then
  ok "kill 循环在 main() 内（定义行 $MAIN_DEF < 回收行 $KILL_LINE）"
else
  bad "kill 循环归属" "main 定义行 [$MAIN_DEF]，kill 行 [$KILL_LINE]"
fi
if [ -n "$MAIN_CALL" ] && [ "$MAIN_CALL" = "$CODE_LINES" ]; then
  ok "main 调用是最后一个代码行"
else
  bad "main 调用位置" "main 调用行 [$MAIN_CALL]，代码总行 [$CODE_LINES]"
fi
GUARD_LINE=$(grep -n 'SELFTEST_SOURCE_ONLY' "$CODE" | head -1 | cut -d: -f1)
if [ -n "$GUARD_LINE" ] && [ -n "$MAIN_CALL" ] && [ "$GUARD_LINE" -lt "$MAIN_CALL" ]; then
  ok "自测守卫在 main 调用之前"
else
  bad "自测守卫位置" "守卫行 [$GUARD_LINE]，main 调用行 [$MAIN_CALL]"
fi

echo "-----"
if [ "$FAILED" = 0 ]; then
  echo "SELFTEST_PASS ok=$OKS"
  exit 0
fi
echo "SELFTEST_FAIL ok=$OKS"
exit 1
