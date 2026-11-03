#!/data/data/com.termux/files/usr/bin/sh
# ops/k40/hostkey_guard_selftest.sh
# 校验 ops/k40/sv/{sshd,ubuntu-sshd}/run 的 host key 守卫分支，全程不触碰生产密钥。
# 用法：sh ops/k40/hostkey_guard_selftest.sh [sv 目录]（默认取脚本同级 sv）
# 原理：把 run 脚本复制到临时目录，密钥路径换临时路径、末尾 exec 换 echo EXEC_REACHED，
#       再用 PATH shim 冒充 ssh-keygen / proot-distro，断言三条分支：
#       缺 key 生成一次、有 key 不生成、生成失败有告警。
set -u

SVDIR=${1:-$(cd "$(dirname "$0")" && pwd)/sv}
TERMUX=/data/data/com.termux/files/usr
T=$(mktemp -d 2>/dev/null) || T="$TERMUX/tmp/hkg.$$"
mkdir -p "$T/bin" "$T/tmp"
trap 'rm -rf "$T"' EXIT
FAILED=0

check() {
  if grep -q -- "$2" "$3" 2>/dev/null; then echo "ok   $1"; else echo "FAIL $1: 未见 [$2]"; FAILED=1; fi
}
check_absent() {
  if grep -q -- "$2" "$3" 2>/dev/null; then echo "FAIL $1: 不该出现 [$2]"; FAILED=1; else echo "ok   $1"; fi
}
check_file() {
  if [ -f "$2" ]; then echo "ok   $1"; else echo "FAIL $1: 缺文件 $2"; FAILED=1; fi
}

cat > "$T/bin/ssh-keygen" <<'SHIM'
#!/bin/sh
echo "ssh-keygen $*" >> "$CALLS"
[ "$MODE" = fail ] && exit 1
mkdir -p "$(dirname "$FAKE_KEY")"
printf 'generated\n' > "$FAKE_KEY"
SHIM
cat > "$T/bin/proot-distro" <<'SHIM'
#!/bin/sh
echo "proot-distro $*" >> "$CALLS"
[ "$MODE" = fail ] && exit 1
mkdir -p "$(dirname "$FAKE_KEY")"
printf 'generated\n' > "$FAKE_KEY"
SHIM
chmod 755 "$T/bin/ssh-keygen" "$T/bin/proot-distro"

export CALLS="$T/calls.log" MODE=ok
export SHIMPATH="$T/bin:/usr/bin:/bin"
export PATH="$T/bin:$PATH"
export FAKE_KEY="$T/etc/ssh/ssh_host_ed25519_key"

prepare() { # prepare <run 脚本> <输出> <根替换前> <根替换后>
  awk '/^exec /{print "echo EXEC_REACHED"; print "exit 0"; next} {print}' "$1" > "$2.raw"
  sed -e "s#$3#$4#g" \
      -e "s#^export PATH=.*#export PATH=\"$SHIMPATH\"#" \
      -e "s#^ROOTFS=.*#ROOTFS=\"$T/rootfs\"#" \
      -e "s#^export HOME=.*#export HOME=\"$T\"#" \
      -e "s#^export TMPDIR=.*#export TMPDIR=\"$T/tmp\"#" \
      -e "s#\"\$PREFIX/bin/proot-distro\"#proot-distro#g" \
      -e "s#$TERMUX/bin/##g" \
      "$2.raw" > "$2"
  rm -f "$2.raw"
  chmod 755 "$2"
}

echo "== sshd/run"
prepare "$SVDIR/sshd/run" "$T/sshd.sh" "$TERMUX/etc/ssh" "$T/etc/ssh"
rm -rf "$T/etc"; : > "$CALLS"
sh "$T/sshd.sh" > "$T/out.a" 2>&1
check  "缺 key 打印告警"      "host key missing" "$T/out.a"
check  "缺 key 调 ssh-keygen" "ssh-keygen -A"    "$CALLS"
check  "缺 key 后仍启动"      "EXEC_REACHED"     "$T/out.a"
check_file "缺 key 已生成"    "$T/etc/ssh/ssh_host_ed25519_key"

: > "$CALLS"
sh "$T/sshd.sh" > "$T/out.b" 2>&1
check_absent "有 key 不生成"  "ssh-keygen"  "$CALLS"
check        "有 key 仍启动"  "EXEC_REACHED" "$T/out.b"

rm -rf "$T/etc"; : > "$CALLS"; MODE=fail
sh "$T/sshd.sh" > "$T/out.c" 2>&1
check "生成失败有告警" "ssh-keygen -A failed" "$T/out.c"
MODE=ok

echo "== ubuntu-sshd/run"
export FAKE_KEY="$T/rootfs/etc/dropbear/dropbear_ed25519_host_key"
prepare "$SVDIR/ubuntu-sshd/run" "$T/ub.sh" "$TERMUX/var/lib/proot-distro/containers/ubuntu/rootfs" "$T/rootfs"
rm -rf "$T/rootfs"; : > "$CALLS"
sh "$T/ub.sh" > "$T/out.d" 2>&1
check  "缺 key 打印告警"       "host key missing"  "$T/out.d"
check  "缺 key 调 dropbearkey" "dropbearkey -t ed25519 -f /etc/dropbear/dropbear_ed25519_host_key" "$CALLS"
check  "缺 key 后仍启动"       "EXEC_REACHED"      "$T/out.d"
check_file "缺 key 已生成"     "$T/rootfs/etc/dropbear/dropbear_ed25519_host_key"

: > "$CALLS"
sh "$T/ub.sh" > "$T/out.e" 2>&1
check_absent "有 key 不生成"   "dropbearkey"  "$CALLS"
check        "有 key 仍启动"   "EXEC_REACHED" "$T/out.e"

rm -rf "$T/rootfs"; : > "$CALLS"; MODE=fail
sh "$T/ub.sh" > "$T/out.f" 2>&1
check "生成失败有告警" "dropbearkey failed" "$T/out.f"
MODE=ok

if [ "$FAILED" -eq 0 ]; then echo "SELFTEST_PASS"; else echo "SELFTEST_FAIL"; fi
exit "$FAILED"