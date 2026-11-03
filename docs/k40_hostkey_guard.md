# K40 host key 守卫

一句话：两个 runit 服务的 `run` 脚本在启动前检查自己的 host key，缺了就地生成，不缺就跳过。
没有它，密钥一丢（Termux 前缀重装、proot 容器重建），服务会「显示 run 但端口永不监听」。

## 1. 故障形态（实测）

| 服务 | 缺 key 时的行为 | 实测证据 |
|---|---|---|
| Termux sshd | sshd 立即退出（no hostkeys available），runit 反复重启，8022 不监听 | OpenSSH 行为，2026-11-03 记录 |
| 容器 dropbear | 打印 `Failed loading <path>` + `Early exit: No hostkeys available. 'dropbear -R' may be useful or run dropbearkey.`，exit 1，10022 不监听 | `dropbear-static-20261027 -F -E -p 10099 -r <missing> -s`，exit_seen=1 |

两者都是**静默故障**：`sv status` 一直显示 run，只有日志尾部那一行错误，跟「设备重启后要靠 adb 手工点火」同类。

## 2. 写法

`ops/k40/sv/sshd/run`

```sh
HOST_KEY=/data/data/com.termux/files/usr/etc/ssh/ssh_host_ed25519_key
if [ ! -f "$HOST_KEY" ]; then
  echo "[sshd] host key missing -> ssh-keygen -A"
  /data/data/com.termux/files/usr/bin/ssh-keygen -A 2>&1
  [ -f "$HOST_KEY" ] || echo "[sshd] ssh-keygen -A failed, 8022 将不可达"
fi
exec sshd -D -e 2>&1
```

`ops/k40/sv/ubuntu-sshd/run`（密钥在容器里，宿主侧只做判断，生成再进容器）

```sh
ROOTFS="$PREFIX/var/lib/proot-distro/containers/ubuntu/rootfs"
HOST_KEY="$ROOTFS/etc/dropbear/dropbear_ed25519_host_key"
if [ ! -f "$HOST_KEY" ]; then
  echo "[ubuntu-sshd] host key missing -> dropbearkey"
  "$PREFIX/bin/proot-distro" login ubuntu -- \
    /usr/bin/dropbearkey -t ed25519 -f /etc/dropbear/dropbear_ed25519_host_key 2>&1
  [ -f "$HOST_KEY" ] || echo "[ubuntu-sshd] dropbearkey failed, 10022 将不可达"
fi
```

三个设计点：

- **判断在宿主侧、生成在容器内**。宿主看的是 proot 容器根的绝对路径 `$PREFIX/var/lib/proot-distro/containers/ubuntu/rootfs`（本机没有 `installed-rootfs` 这个目录，写错就成了永远为真的空判断）。
- **生成后复查**。`|| echo ... failed` 只对最后一条命令生效，容易假绿；改成生成后再 `[ -f ]` 判一次，失败一定留痕。
- **诊断走 stdout**，理由见下一节。

## 3. runit 的 log/run 只收 fd1

本机 `sv/<service>/log/run` 是 `exec cat >> <file>`，服务进程的 stdout 进管道，stderr 直接丢。
探针实证（临时服务 hktest，脚本同时打 stdout 与 stderr）：日志里只有 `HKTEST_STDOUT ok`，`HKTEST_STDERR ok` 计数为 0。

所以第一版守卫生成的密钥是成功的，但 `>&2` 的告警行在日志里完全没有，事后无法从日志判断守卫是否跑过。
修正后每次生成都会在日志留两行，可直接 grep。

## 4. 真机红绿（2026-11-03，k40）

容器侧做了完整演练（备份原钥匙 → 删 → 拉起 → 复原）：

| 步骤 | 结果 |
|---|---|
| 备份 `$PREFIX/tmp/dropbear_key_backup` | sha256 `2b52cba9…f3cc` |
| 删 `rootfs/etc/dropbear/dropbear_ed25519_host_key` 后重启服务 | 日志出现 `[ubuntu-sshd] host key missing -> dropbearkey` 与 `Generating 256 bit ed25519 key…` |
| 新密钥 | sha256 `e596c564…`（与旧钥不同，说明真生成了） |
| 端口 | 10022 在检查窗口内 UP，`sv status` run，pid 换新 |
| 复原原钥并重启 | sha256 回到 `2b52cba9…f3cc`，10022 仍 UP，`sshd`/`ubuntu-sshd` 均 run |

密钥存在时守卫是纯 no-op：先做一次普通重启，`ssh_host_ed25519_key` 的 mtime 保持 Oct 26 16:18 不变。

Termux sshd 侧**没有**做删钥演练：8022 是通往设备的唯一通道（容器的 10022 也要从宿主转发），删钥演练一旦失败就只能靠 adb 救场。改用 shim 自测覆盖同一条分支，见下一节。

## 5. 自测脚本

`ops/k40/hostkey_guard_selftest.sh`，在设备上跑（不碰生产密钥）：

```sh
sh ops/k40/hostkey_guard_selftest.sh "$PREFIX/var/service"
# 末行 SELFTEST_PASS 即全绿，exit 0；任一断言失败则 SELFTEST_FAIL，exit 1
```

做法：把两个 `run` 脚本复制到 `mktemp -d` 出来的临时目录，密钥路径换成临时路径、末尾 `exec` 换成 `echo EXEC_REACHED`，再用 PATH shim 冒充 `ssh-keygen` 与 `proot-distro`。覆盖七类断言 x 两个服务：

1. 缺 key 打印告警
2. 缺 key 调用生成命令（并核对参数：`dropbearkey -t ed25519 -f /etc/dropbear/dropbear_ed25519_host_key`）
3. 缺 key 之后仍继续启动（`EXEC_REACHED`）
4. 缺 key 之后密钥文件确实出现
5. 有 key 时**不**调用生成命令
6. 有 key 时仍继续启动
7. 生成失败（shim 返回 1 且不落文件）时打印失败行

## 6. 代价与边界

- **生成即轮换**：新 host key 会改指纹，客户端 `known_hosts` 要同步更新。这是恢复可达性应付的代价，脚本只在文件缺失时动手，正常运行与重启不碰密钥。
- **`ssh-keygen -A` 会顺带补齐新算法密钥**：本机 OpenSSH 10 会额外生成 `ssh_host_mldsa44_ed25519_key`。守卫只要求 ed25519 存在，所以「只缺 MLDSA」不会触发生成，sshd 照常起。演练后把这类顺带产物删掉，保持设备状态与演练前一致。
- **契约由测试钉住**：`BioanalysDesktop/tests/hostkey_guard.test.js` 四条断言，覆盖两个脚本的守卫位置顺序、`-r` 与生成路径一致、以及「诊断不许写 stderr」。五条变异全部判红（守卫条件取反、`-r` 路径改成 other_key、告警改走 stderr、生成命令换成 `true`、ubuntu 守卫条件取反）。
