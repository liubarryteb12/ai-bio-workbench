# K40 runit 服务定义的四段式契约

落点：`tools/ops/k40/sv/{sshd,ubuntu-sshd,crond,ssh-agent}/run`（仓库镜像，真身在 k40 的 `$PREFIX/var/service/`）。
测试：`BioanalysDesktop/tests/runit_sv_contract.test.js`、`BioanalysDesktop/tests/hostkey_guard.test.js`。
自测：`tools/ops/k40/hostkey_guard_selftest.sh`（在设备上跑，见第四节）。

## 一、为什么要有这条契约

runsv 只做一件事：把 `./run` 当子进程前台监督，把它的 **fd1** 接到 `./log/run` 的 stdin
（`log/run` 就是 `exec cat >> <logfile>`）。`./run` 写 stderr 的东西，除非自己合并，
否则根本进不了日志。

2026-11-03 在 k40 上用两个临时服务做了对照实测（`errprobe_with` 带 `exec 2>&1`、
`errprobe_without` 不带，两个都写一行 stdout 与一行 stderr）：

| 服务 | 日志里的内容 |
|---|---|
| errprobe_with | `STDOUT_errprobe_with ok` + `STDERR_errprobe_with ok` |
| errprobe_without | 只有 `STDOUT_errprobe_without ok` |

所以「服务显示 run、日志一片安静」不是没事，而是 stderr 被丢掉了。上一版的 crond 与
ssh-agent 完全裸奔，sshd / ubuntu-sshd 的守卫也被迫手写 stdout 绕这个坑。

## 二、四段式模板

```
#!/data/data/com.termux/files/usr/bin/sh   ← 段1（第 1 行，必须是 Termux sh 绝对路径）
set -eu                                     ← 段1（第 2 行）
exec 2>&1                                   ← 段2（第 3 行，紧跟段1）
                                            ← 段3：幂等前置守卫（可留空）
exec <daemon> <foreground_flags>            ← 段4（最后一行，原位替换让 runsv 直接监督）
```

段2 钉在前三行的理由：runit 的日志管道在进程启动时就接好了，重定向必须发生在任何
输出之前；写到 10 行以外虽然仍生效，但代码一被复制粘贴改写就容易掉到后面去，机器断言
只认前三行。

段3 的规矩：
- 诊断一律走 stdout（段2 已经合并，不需要也不允许再写 `>&2`）。
- 前缀统一 `[guard:<svc>]`，失败打精确的层代号 `ERR_STAGE_*` 后 `exit 1`。
- 守卫必须幂等：条件不满足才动手，满足时零副作用。

四个服务当前形态：

| 服务 | 段3 守卫 | 段4 |
|---|---|---|
| sshd | host key 缺失 → `ssh-keygen -A`，失败打 `ERR_STAGE_HOSTKEY_8022` | `exec sshd -D -e` |
| ubuntu-sshd | 宿主侧判 rootfs 里的 dropbear 密钥，缺失 → proot 里跑 `dropbearkey`，失败打 `ERR_STAGE_HOSTKEY_10022` | `exec "$PREFIX/bin/proot-distro" login ubuntu -- <dropbear> -F -E -p 10022 -r ...` |
| crond | 无前置条件（留空） | `exec crond -n -s` |
| ssh-agent | 清残留 socket（`[ -S "$1" ]` 时 `rm -f`） | 函数体内 `exec ssh-agent -D -a "$1"` |

ssh-agent 的段4 是函数委托（`service_agent "$SSH_AUTH_SOCK"`），是唯一允许的例外形态。
它还需要 `PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"` 兜底，否则 `set -u` 下
`${XDG_RUNTIME_DIR:-...}` 展开会直接炸掉。

## 三、机器断言（8 条变异全红）

契约测试覆盖：四个目录都有 `run` 与 `log/run`；前三行恰为 shebang / `set -eu` /
`exec 2>&1` 且在前 10 行内；非注释代码里没有任何 `>&2`；末行是段4 的 exec 形态；
crond 段4 是 `exec crond -n -s` 且 ssh-agent 保留 `-D -a "$1"` 与残留 socket 清理；
sshd / ubuntu-sshd 守卫顺序与层代号；错误码必须用 `echo "` 打到 stdout。

变异反证（`node .tmp/mutate_runit.mjs`，基线绿 → 逐条变异 → 恢复）：

| 变异 | 结果 |
|---|---|
| M1 crond 去掉 `exec 2>&1` | KILLED（前三行断言） |
| M2 `exec 2>&1` 挪到第 12 行 | KILLED（前三行断言） |
| M3 sshd 告警改走 `>&2` | KILLED（无 stderr 重定向断言） |
| M4 ubuntu 丢掉 `ERR_STAGE_HOSTKEY_10022` | KILLED（层代号断言） |
| M5 `set -eu` 退化成 `set -e` | KILLED（前三行断言） |
| M6 ssh-agent 去掉 PREFIX 兜底 | KILLED（段4 语义断言） |
| M7 ubuntu 段4 的 `-r` 换成 other_key | KILLED（守卫与段4 路径一致性） |
| M8 crond 段4 丢 `-n` | KILLED（段4 语义断言） |

## 四、设备侧自测与两个假绿坑

`sh tools/ops/k40/hostkey_guard_selftest.sh $PREFIX/var/service` 在设备上跑（Windows 没有 sh，
不进 CI）。它把 run 脚本复制到 `mktemp -d` 里，把密钥路径换到临时目录、段4 的 exec 换成
`echo EXEC_REACHED`，再用 PATH shim 冒充 `ssh-keygen` 与 `proot-distro`，最后断言
21 条（两个服务 × 缺 key 生成 / 有 key 不生成 / 生成失败打层代号且 exit 1）。

第一版自测在两个地方是假绿，都是上机才暴露：

1. **哨兵替换误命中段2**。旧写法 `awk '/^exec /{...}'` 会把段2 的 `exec 2>&1` 一起换成
   哨兵，脚本第 3 行就退出，守卫段一次也没跑到。改成只替换「最后一行以 exec 开头」。
2. **PREFIX 没重定向**。sshd 的守卫用 `$PREFIX` 拼密钥路径，自测不替换 `^PREFIX=` 就会去
   读生产路径上的真钥匙，在生产设备上恒命中「有 key」分支，守卫同样变成看不见。

两条都补成了契约断言，防止再退回去。

## 五、真机部署与验证（2026-11-03）

- 四个 run 脚本推送到 `$PREFIX/var/service/<svc>/run`（chmod 755），旧版本备份在
  `$PREFIX/tmp/run_backup_<ts>/`。部署后 `sha256sum` 与仓库版本逐字节一致。
- `sv restart crond` / `sv restart ssh-agent` 后两服务 `run`，日志继续滚动。
- sshd 用 detached 方式重启（`setsid sh -c 'sleep 2; sv restart sshd'`，会切断当前 8022 会话），
  重连后 `run: sshd (pid 11653)`，日志出现 `Received signal 15; terminating.` 紧跟
  `Server listening on 0.0.0.0 port 8022.`，8022 / 10022 均监听。

## 六、两个操作陷阱（实测）

1. **`sv <verb> <name>` 必须带 SVDIR**。直接 `sv restart crond` 报
   `fail: crond: unable to change to service directory: file does not exist`，因为 `sv`
   在 SVDIR 未导出时按 `/var/service` 找；`sv status /abs/path/crond` 反而能用。
   运维脚本一律 `export SVDIR=$PREFIX/var/service`。
2. **`sv restart ubuntu-sshd` 会卡死**。runsv 对段4 的 proot 进程发 TERM，proot 不把它
   转发进容器，里面的 dropbear 继续占着 10022，服务状态永远停在
   `run: ubuntu-sshd: (pid …) got TERM`，10022 由旧进程继续服务（看起来「没断」）。
   正确姿势：先 `pkill -KILL -f 'dropbear-static-20261027 -F'`，再等 runsv 拉起新实例；
   同理，任何要断开 10022 的操作都得 detached 方式跑。

## 七、边界

- 权限位（755）不在 Windows 断言：NTFS 检出恒 644，由部署侧与 git index 保证。
- 段2 只保证「脚本自身与其 exec 的 daemon 的 stderr」并进日志；Android 侧 logcat、
  SELinux 拒绝这类内核层信息仍要去对应的日志源看。
- proot 的 TERM 不转发是容器侧的既有事实，本契约只把它写成操作陷阱，不在守卫里绕开。
