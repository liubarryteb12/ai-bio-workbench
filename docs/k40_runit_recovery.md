# K40 Termux 宿主面 runit 故障根因与恢复手册

> 2026-11-01 实测结论。本文件记录**已验证的事实**，不写推测。
> 相关：con_hf/pitfalls_ledger.md P-23/P-26，技术债 5.3。

## 一、已验证的根因链（按实测顺序）

### 1. 双实例 runsvdir 是状态错乱的直接原因
- 现象：`sv status <svc>` 报 `runsv not running` 或 `unable to open supervise/ok`，但端口实际在监听。
- 实测：`/proc/*/cmdline` 里同时存在多个 `runsvdir`，各自拉起一套 `runsv`，互相争抢 `supervise/`。
- 触发源：每开一个 adb shell / ssh 会话，`$PREFIX/etc/profile.d/start-services.sh` 就会试着拉起一次。
- **判据**：`count_runsvdir`（只看 argv[0] 的 basename）必须恒等于 1。用整串 grep 'runsvdir' 会把 shell 自身数进来（实测假阳性到 4）。

### 2. `run-as com.termux` 的 SELinux 域无法 mkfifo
- 实测：`supervise/control` 与 `supervise/ok` 是 `mkfifo()` 出来的 FIFO（`ls -la` 显示 `p` 前缀）。
- 在 `run-as` 域下创建会出现 `Permission denied`；在**正常 ssh 会话**（继承 Termux 的 untrusted_app 域）下创建成功。
- **推论**：清理脚本绝不能 `rm -rf supervise/`。一旦删掉 FIFO，退化到 run-as 域就再也建不回来。只允许删 `supervise/lock` 这类普通文件。

### 3. `runsv` 在 Android 私有存储上锁 `supervise/lock` 失败
- 实测日志：`runsv sshd: fatal: unable to lock supervise/lock: temporary failure`。
- 与 `svlogd` 的 `unable to lock directory: temporary failure` 同源：Android `app_data_file` 上 flock 语义受限。
- 试过把 `lock` 改成 FIFO：报错变为 `unable to open supervise/lock: device not configured`，**方向错误，lock 必须保持普通文件**。
- **结论**：在 Termux 上指望 `runsvdir` + `runsv` 完整监督 sshd 不可靠。实际可用的形态是：主服务靠独立进程存活（`sh start-sshd.sh` 裸起 sshd、`proot-distro login` 裸起 dropbear），runit 只负责 log 子服务。

### 4. 破坏性运维会自断链路
- 实测：为重建而 `pkill sshd` 会把正在承载当前 ssh 会话的 sshd 一起杀掉，8022 与 10022 同时断，只能靠 `run-as bash start-sshd.sh` 人工救回。
- **铁律**：修复监督树只杀 `runsvdir` 与 `runsv`，**绝不 pkill sshd**；重建前先挂 15 秒死人开关。

## 二、实测有效的恢复命令（按顺序）

```bash
# 1) 恢复 Termux 底座 sshd（唯一可靠的人工救回手段）
#    经 adb，不依赖现有 ssh 链路：
adb shell "run-as com.termux /data/data/com.termux/files/usr/bin/bash \
  /data/data/com.termux/files/home/.termux/boot/start-sshd.sh"

# 2) 恢复容器面 dropbear（8022 通了之后）
ssh k40 'nohup $PREFIX/bin/proot-distro login ubuntu -- \
  /mnt/ssd/bio_data/bin/dropbear-static-20261027 \
  -F -E -p 10022 -r /etc/dropbear/dropbear_ed25519_host_key -s \
  >$PREFIX/tmp/ub.log 2>&1 </dev/null &'

# 3) 验链路
ssh k40 'echo BASE_OK' && ssh k40-ubuntu 'echo CONTAINER_OK'
```

## 三、已落地仓库的资产

| 文件 | 作用 |
|---|---|
| `ops/k40/sv/{sshd,crond,ssh-agent,ubuntu-sshd}/{run,log/run}` | 8 个 runit 服务定义，log/run 带 10MB 轮转 |
| `ops/k40/ensure_runsvdir.sh` | 幂等点火（flock 单实例 + 快判短路 + 15 秒死人开关 + 绝不杀 sshd） |
| `ops/k40/pi_a2a_launch.sh` | Pi A2A 启动器镜像（Termux `$HOME/bin` 落点） |

## 四、尚未解决（交接给下一轮）

1. `runsv` 锁 `supervise/lock` 失败属 Android 存储层限制，**runit 完整监督 sshd 在 Termux 上不可行**；需裁定是否改为「裸进程 + 轻量看门狗」模型。
2. `$PREFIX/etc/profile.d/start-services.sh` 仍会在每次登录时尝试拉起 runsvdir，需按 Argon 建议收口到 `ensure_runsvdir.sh`。
3. 设备重启后仍需人工执行第二节第 1 条才能恢复 8022，尚未实现全自动。