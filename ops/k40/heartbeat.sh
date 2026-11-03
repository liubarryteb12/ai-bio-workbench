#!/data/data/com.termux/files/usr/bin/sh
# K40 零 SSH 健康快照（4 Argon 第十九轮 Q2 裁定）
#
# 用法（通常由 Windows 侧经 adb 触发，不经 ssh）：
#   adb exec-out run-as com.termux sh -c 'sh files/usr/bin/k40_heartbeat.sh'
#   sh k40_heartbeat.sh --write <path>     原子写入，供归档
#
# 为什么用「按需执行」而不是常驻 runit 服务：
#   常驻服务意味着每秒/每分钟写闪存，全年十万次 I/O，且它自己也要被监督——多一层会死的
#   东西。按需执行只在有人问的时候干活：零常驻开销、永远是最新状态，读一次写一次文件
#   （200 字节）。这也符合 Q1「设备侧只记录，绝不自己 sv restart」。
#
# 为什么端口查 TCP connect 而不是 /proc/net/tcp：
#   Argon 建议查 /proc/net/tcp 的 :1F56/:2726，但 Android 10 起 app uid 连
#   /proc/net/tcp 与 /proc/self/net/tcp 都读不到（实测 Permission denied，2026-11-03）。
#   改用 bash 的 /dev/tcp 连接探测：sshd 与探针同 uid 同 netns，能连通即说明在监听。
#
# 四个硬指标的取法：
#   ts                     epoch 秒（与 Windows 时钟直接可比，不用本地时区字符串）
#   runsvdir_count         ps 里 'bin/runsvdir -P <SVDIR>' 的进程数（正常 1）
#   sshd_8022_listen       /dev/tcp 连 127.0.0.1:8022
#   dropbear_10022_listen  /dev/tcp 连 127.0.0.1:10022
#   ssd_writable           宿主侧 [ -w <rootfs>/mnt/ssd/bio_data ]（零 I/O；只读挂载会让 access 失败）
#   svc_*                  $PREFIX/var/service/<svc>/supervise/stat 的内容（run / down / finish）

set -eu

PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
SVDIR="$PREFIX/var/service"
ROOTFS="$PREFIX/var/lib/proot-distro/containers/ubuntu/rootfs"
LOG_PATH="$PREFIX/var/log/k40_heartbeat.json"

if [ "${1:-}" = "--write" ]; then
  [ -n "${2:-}" ] && LOG_PATH="$2"
fi

# 探测端口的连接：同 uid 同 netns，能连上就是真的在监听。用 bash 的 /dev/tcp（sh 没有）。
port_listen() {
  "$PREFIX/bin/bash" -c "exec 3<>/dev/tcp/127.0.0.1/$1" >/dev/null 2>&1
}

json_bool() {
  if "$@" >/dev/null 2>&1; then printf '1'; else printf '0'; fi
}

# supervise/stat 里的内容不只有状态词：执行过 sv down/up 后会是
# "run, got TERM, want down" 这种带逗号的瞬时描述（2026-11-03 实测）。
# 逗号前那一段才是当前状态，整行照抄会让判定把 'run' 误当成非 run。
svc_stat() {
  state=""
  if [ -r "$SVDIR/$1/supervise/stat" ]; then
    state=$(head -n 1 "$SVDIR/$1/supervise/stat" 2>/dev/null | tr -d '\r')
    state="${state%%,*}"
    state=$(printf '%s' "$state" | tr -d ' \t')
  fi
  printf '%s' "${state:-unknown}"
}

listening_8022=$(json_bool port_listen 8022)
listening_10022=$(json_bool port_listen 10022)
ssd_writable=$(json_bool test -w "$ROOTFS/mnt/ssd/bio_data")
# 只数真正的监督进程：命令名恰好是 /bin/runsvdir 且带 -P <SVDIR>。
# 不能 grep 整行 'bin/runsvdir -P'：flock 包装行（flock -n .../runsvdir.singleton.lock
# .../runsvdir -P ...）的整行里也含这个串，会把 1 数成 2（2026-11-03 实测）。
# 命令名的形态随调用方而变：经 ssh 跑时 ps 给出完整路径（.../bin/runsvdir），
# 经 adb run-as 跑时只给基名（runsvdir）——2026-11-03 实测，两种都要认。
runsvdir_count=$(ps -A -o pid,args 2>/dev/null \
  | awk -v sv="$SVDIR" '($2 == "runsvdir" || $2 ~ /\/bin\/runsvdir$/) && index($0, " -P " sv) { n += 1 } END { print n + 0 }')
[ -n "$runsvdir_count" ] || runsvdir_count=0
ts=$(date +%s)

line=$(printf '{"schema":"k40_heartbeat/v2","ts":%s,"runsvdir_count":%s,"sshd_8022_listen":%s,"dropbear_10022_listen":%s,"ssd_writable":%s,"port_probe":"tcp-connect","svc_sshd":"%s","svc_ubuntu_sshd":"%s","svc_crond":"%s","svc_ssh_agent":"%s"}' \
  "$ts" "$runsvdir_count" "$listening_8022" "$listening_10022" "$ssd_writable" \
  "$(svc_stat sshd)" "$(svc_stat ubuntu-sshd)" "$(svc_stat crond)" "$(svc_stat ssh-agent)")

if [ "${1:-}" = "--write" ]; then
  tmp="$LOG_PATH.tmp.$$"
  mkdir -p "$(dirname "$LOG_PATH")"
  printf '%s\n' "$line" > "$tmp"
  mv -f "$tmp" "$LOG_PATH"
else
  printf '%s\n' "$line"
fi
