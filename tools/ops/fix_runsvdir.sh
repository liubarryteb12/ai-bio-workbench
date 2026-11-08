#!/data/data/com.termux/files/usr/bin/bash
# fix_runsvdir.sh — 双 runsvdir 抢锁修复（2026-10-20 reboot 实测暴露的 R15）
# 场景：Termux:Boot 触发两次 → 两个 runsvdir -P 并存 → 瓜分服务 + supervise/lock 抢锁风暴
# 策略：杀双 runsvdir → 杀 runsv（runsv 收 TERM 会停服务）→ 补杀不响应 TERM 的（proot 已知忽略）
#       → 单实例 runsvdir -P 重拉 → sv up 全部 → 有界等待验证
# 通道：run-as（不依赖 sshd，修复期间 8022/10022 瞬断可接受）
export PREFIX=/data/data/com.termux/files/usr
export HOME=/data/data/com.termux/files/home
export PATH="$PREFIX/bin:$PREFIX/bin/applets:$PATH"
export SVDIR="$PREFIX/var/service"
export LOGDIR="$PREFIX/var/log"
LOG="$PREFIX/var/log/boot-p_actions.log"
say() { printf '[%s] %s\n' "$(date '+%F %T')" "$*" >> "$LOG" 2>/dev/null; }

say "=== fix_runsvdir start (pid $$) — R15 双 runsvdir 抢锁修复 ==="

# 1. 杀所有 runsvdir
for p in $(pgrep -x runsvdir 2>/dev/null); do
    kill "$p" 2>/dev/null && say "killed runsvdir $p"
done
sleep 1

# 2. 杀所有 runsv（SIGTERM：runsv 会转发 TERM 给服务进程后退出）
for p in $(pgrep -x runsv 2>/dev/null); do
    kill "$p" 2>/dev/null && say "killed runsv $p"
done
sleep 2

# 3. 补杀：proot 已知忽略 SIGTERM（termux_keepalive §六.2）；sshd/crond 防 TERM 未死
for p in $(pgrep -f "proot/loader" 2>/dev/null); do
    kill -9 "$p" 2>/dev/null && say "kill -9 proot $p"
done
for p in $(pgrep -x sshd 2>/dev/null); do
    kill -9 "$p" 2>/dev/null && say "kill -9 sshd $p"
done
for p in $(pgrep -x crond 2>/dev/null); do
    kill -9 "$p" 2>/dev/null && say "kill -9 crond $p"
done
sleep 1

# 4. 单实例重拉（带完整环境，与 boot 脚本 v6 一致）
nohup runsvdir -P "$SVDIR" >>"$LOG" 2>&1 &
say "runsvdir -P restarted pid=$!"
sleep 3

# 5. sv up 全部服务（含 log 子服务）
for s in ubuntu-sshd sshd crond ssh-agent bio-watchdog t5sp-run; do
    sv up "$s" >/dev/null 2>&1
    [ -d "$SVDIR/$s/log" ] && sv up "$s/log" >/dev/null 2>&1
done

# 6. 有界等待关键服务（30s）
i=0
while [ "$i" -lt 30 ]; do
    ok=1
    for s in sshd crond ssh-agent ubuntu-sshd bio-watchdog; do
        state=$(sv status "$s" 2>/dev/null | head -1)
        case "$state" in run:*) ;; *) ok=0 ;; esac
    done
    [ "$ok" = "1" ] && break
    i=$((i + 1)); sleep 1
done
say "fix_runsvdir done after ${i}s: $(sv status sshd crond ssh-agent ubuntu-sshd bio-watchdog 2>/dev/null | tr '\n' ' ')"
say "runsvdir count now: $(pgrep -x runsvdir | wc -l)"
say "=== fix_runsvdir end ==="
