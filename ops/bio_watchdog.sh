#!/data/data/com.termux/files/usr/bin/bash
# bio_watchdog.sh: Termux 侧服务自愈看护（由 runit 监管，常驻循环）
#
# 存在理由：2026-10-14 实测发现 Termux 掉线时 Wake Locks=0，且 crontab 里的 tick.sh
# 只做取件、不检查服务；runit 服务 crash 后无人拉起。本脚本补上这两个缺口。
#
# 职责：
#   1. 每分钟重申 termux-wake-lock（幂等，重复调用无副作用），防 CPU 休眠冻结进程
#   2. 每分钟检查 runit 四个服务，非 run 状态立即 sv up
#
# 不做什么：不做 ssh 容器探测。`k40-ubuntu` 是 Windows 侧 ~/.ssh/config 的别名，
# Termux 内不存在（2026-10-18 实测 `Could not resolve hostname`），照抄会导致
# 每分钟误判并反复 `sv restart ubuntu-sshd`，把正常容器打断。容器存活由 runsv
# 监管 ubuntu-sshd 的 run 脚本负责，不需要外部探测。
#
# 边界：本脚本只能治「服务 crash」与「唤醒锁丢失」。若 Termux 进程本身被系统杀掉，
# 本脚本随之消失，恢复只能靠 Termux:Boot 开机脚本或 MIUI 自启动放行。
export PREFIX=/data/data/com.termux/files/usr
export HOME=/data/data/com.termux/files/home
export PATH="$PREFIX/bin:$PREFIX/bin/applets:$PATH"
export SVDIR="$PREFIX/var/service"

LOG="$HOME/p_actions/logs/watchdog.log"
mkdir -p "$(dirname "$LOG")" 2>/dev/null

say() { printf '[%s] %s\n' "$(date '+%F %T')" "$*" >>"$LOG" 2>/dev/null; }

# 日志超过 256 KB 截断，保留尾部 64 KB
if [ -f "$LOG" ] && [ "$(wc -c <"$LOG")" -gt 262144 ]; then
  tail -c 65536 "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  say '日志已截断（保留尾部 64 KB）'
fi

say "=== watchdog start (pid $$) ==="

SERVICES="sshd crond ssh-agent ubuntu-sshd"

while true; do
  # 1) 唤醒锁：Termux 侧幂等，已持有时不会重复计数
  termux-wake-lock 2>/dev/null || true

  # 2) 服务自愈
  for svc in $SERVICES; do
    [ -d "$SVDIR/$svc" ] || continue
    state=$(sv status "$svc" 2>/dev/null | head -1)
    case "$state" in
      run:*) ;;
      *)
        say "service $svc 非运行态 -> sv up  [$state]"
        sv up "$svc" >/dev/null 2>&1 || say "sv up $svc 失败"
        ;;
    esac
  done

  sleep 60
done
