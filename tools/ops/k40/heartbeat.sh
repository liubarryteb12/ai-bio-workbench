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

# supervise/stat 里除了状态词还有「期望状态」：
#   "run"                        稳态，正常
#   "run, got TERM, want up"     刚收到重启请求，目的是继续跑，按 run 算
#   "run, got TERM, want down"   TERM 已发出、期望停止，进程却没退（proot 不转发信号）
# 逗号前那一段单独看会把第三种报成正常的 run，恰恰掩盖了「停止请求被吞」。
# 因此这里归一化：只有期望向下时才降级成 down_pending，期望向上仍算 run。
# （2026-11-03 实测：sv down ubuntu-sshd 后 stat 一直是 "run, got TERM, want down"，
#  dropbear 与 10022 都还在，端口照旧在听。）
svc_stat() {
  state=""
  if [ -r "$SVDIR/$1/supervise/stat" ]; then
    state=$(head -n 1 "$SVDIR/$1/supervise/stat" 2>/dev/null | tr -d '\r')
    first="${state%%,*}"
    case "$state" in
      *"want down"*) first=down_pending ;;
    esac
    state=$(printf '%s' "$first" | tr -d ' \t')
  fi
  printf '%s' "${state:-unknown}"
}

listening_8022=$(json_bool port_listen 8022)
listening_10022=$(json_bool port_listen 10022)
# pi agent 的 A2A server 监听 9910。它不参与链路四段的分级判定（链路只看 sshd 两条），
# 但「sv 说 run 而端口没听」是真实故障形态，必须能被交叉校验抓到。
listening_pi9910=$(json_bool port_listen 9910)
ssd_writable=$(json_bool test -w "$ROOTFS/mnt/ssd/bio_data")
# 只数真正的监督进程。三种形态都实测过（2026-11-03）：
#   26563 runsvdir /data/.../usr/var/service          健康实例，runsvdir 启动后把 argv 改写掉了 -P
#   12792 /data/.../usr/bin/runsvdir -P .../var/service 经 ssh 的 ps 给完整路径，且还没被改写
#   30753 /data/.../usr/bin/runsvdir /data/.../bin/runsvdir .../var/service
#                                                     野生态：argv0 被复制一份，不监督任何服务
# 早先只认 ' -P <SVDIR>' 子串，结果在健康设备上数到 0，整盏灯报 ERR_STAGE_RUNSV（假红）。
# 不能 grep 整行：flock 包装行（flock -n .../runsvdir.singleton.lock .../runsvdir -P ...）
# 的整行里也含这个串，会把 1 数成 2。所以判据落在 argv 位置上，而不是整行匹配。
runsvdir_count=$(ps -A -o pid,args 2>/dev/null \
  | awk -v sv="$SVDIR" '
      $2 == "runsvdir" || $2 ~ /\/bin\/runsvdir$/ {
        if ($3 ~ /\/runsvdir$/) next                 # 野生态：argv0 被复制
        if ($3 == "-P" && $4 == sv) { n += 1; next }   # 未改写形态
        if ($3 == sv) { n += 1 }                      # 已改写形态
      }
      END { print n + 0 }')
[ -n "$runsvdir_count" ] || runsvdir_count=0
ts=$(date +%s)

line=$(printf '{"schema":"k40_heartbeat/v2","ts":%s,"runsvdir_count":%s,"sshd_8022_listen":%s,"dropbear_10022_listen":%s,"pi_9910_listen":%s,"ssd_writable":%s,"port_probe":"tcp-connect","svc_sshd":"%s","svc_ubuntu_sshd":"%s","svc_crond":"%s","svc_ssh_agent":"%s","svc_pi_a2a":"%s"}' \
  "$ts" "$runsvdir_count" "$listening_8022" "$listening_10022" "$listening_pi9910" "$ssd_writable" \
  "$(svc_stat sshd)" "$(svc_stat ubuntu-sshd)" "$(svc_stat crond)" "$(svc_stat ssh-agent)" "$(svc_stat pi-a2a)")

if [ "${1:-}" = "--write" ]; then
  tmp="$LOG_PATH.tmp.$$"
  mkdir -p "$(dirname "$LOG_PATH")"
  printf '%s\n' "$line" > "$tmp"
  mv -f "$tmp" "$LOG_PATH"
else
  printf '%s\n' "$line"
fi
