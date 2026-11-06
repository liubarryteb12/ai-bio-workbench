# 远程通道策略：adb 为主，sshd 备用（2026-11-06）

## 结论

日常执行一律走 **adb**；sshd 只作备用。理由不是偏好，是可用性实测：

| 通道 | 依赖 | 设备侧故障时 |
|---|---|---|
| adb | 系统 adbd（与 Termux 无关） | 仍可用 |
| sshd | 跑在 Termux 内的 dropbear + adb 端口转发 | Termux 一死即断，且 adb server 重启后转发会丢 |

2026-11-06 当天，Termux 被 Android 的 low-memory-killer 杀掉 5 次。
每次都是 **adb 还能用**，靠 `adb shell am start` 重启 Termux 才恢复；
sshd 全程不可用。

就在写这份文档时又复现一次：`adb kill-server` 之后端口转发清空，
`ssh` 报 `Connection refused`，而 adb 通道照常工作。

## 怎么用

```powershell
# 在 proot ubuntu 容器里执行（分析命令用这个）
pwsh -File ops/adb_exec.ps1 -Level ubuntu -Command 'python3 -c "print(6*7)"'

# 在 Termux 用户态执行
pwsh -File ops/adb_exec.ps1 -Level termux -Command 'id -un'

# 跑本地脚本（内容经 stdin 送入，避开引号转义）
pwsh -File ops/adb_exec.ps1 -Level ubuntu -ScriptPath .tmp/step.sh

# 强制走备用通道（也用于验证 sshd 是否健康）
pwsh -File ops/adb_exec.ps1 -Level ubuntu -Transport ssh -Command 'hostname'
```

`-Transport` 取值：`auto`（默认，adb 失败回落 ssh）、`adb`（失败即报错）、`ssh`（强制备用）。

退出码透传远端命令的退出码，可直接用于判据。

## 权限边界（实测，无需 root）

- `adb shell` 身份是 `uid=2000(shell)`，读不到 `/data/data/com.termux`；
- 该 Termux 是 debuggable，可用 `run-as com.termux` 以 Termux UID 执行；
- 再经 `proot-distro login ubuntu -- bash /tmp/xxx.sh` 进容器；
- 脚本先落到容器 rootfs 的 `/tmp`，因为 stdin 已被外层 `bash -s` 占用。

## 两个坑

1. **here-string 末尾不含换行**：`@'...'@` 拼下一行命令会粘成一句，
   实测报 `export: --: not a valid identifier`。拼接时必须显式补 `[char]10`。
2. **端口转发会丢**：`adb kill-server` / 设备重连后转发清空，
   ssh 备用通道需按需重建。`adb_exec.ps1` 的 `Repair-Forwards` 已自动处理。

## 文件传输的限制

`adb push` 只能落到 `/sdcard`，而 Termux 默认**读不到** `/sdcard`
（未执行 `termux-setup-storage`，实测 `TERMUX_CANNOT_READ`）。
因此文本脚本一律走 stdin 写入，不用 push。

大二进制（如 h5ad）不适合经 stdin 传；这类文件仍在设备侧生成，不回传。


## Termux 生存能力：实测清单（2026-11-06）

设备为 Android 13（SDK 33）。逐项核对社区常提的保护措施，结论是**能开的都已经开了**：

| 措施 | 实测状态 | 怎么查 |
|---|---|---|
| Phantom process killer | 已禁用 | `settings get global settings_enable_monitor_phantom_procs` → `false` |
| phantom 进程数上限 | 已放到极大 | `device_config get activity_manager max_phantom_processes` → `2147483647` |
| 电池优化白名单 | 已加入 | `dumpsys deviceidle whitelist` → `user,com.termux` 与 `user,com.termux.boot` |
| wake lock | 已持有 | `dumpsys power` → `termux:service-wakelock ... ACQ=...` |
| oom_score_adj | 已是 -1000（最高保护） | `cat /proc/self/oom_score_adj` |
| root | 无（`su` 不存在） | `adb shell su -c id` |

**因此可以确定：Termux 被「团灭」不是上述机制触发的，而是自身峰值内存把系统逼进 LMK 区间。**
2026-11-06 当天 5 次中断，每次都能在日志里看到可用内存从数 GB 在数秒内掉到不足 1 GB。

### 无 root 条件下唯一有效的护栏：给自己设地址空间上限

非 root 进程只能**提高**自己的 oom_score_adj，不能降低，所以「调低 oom 优先级」这条路走不通。
但可以反过来做：给作业设 `ulimit -v`，让超限变成该进程的 `MemoryError`，而不是全系统内存压力。

实测（proot 内生效）：

```
ulimit -v 1500000          # 1.5 GB
python3 -c "x=bytearray(3*1024**3)"
→ MemoryError, exit=1      # 进程干净失败
→ adb get-state = device   # 设备与 Termux 均存活
```

工具里已封装成参数：

```powershell
# 重内存作业建议加护栏（推荐值见下）
pwsh -File ops/adb_exec.ps1 -Level ubuntu -MemLimitMB 2000 -ScriptPath .tmp/step.sh
```

推荐取值（按本机实测峰值）：

| 作业类型 | 建议上限 | 依据 |
|---|---|---|
| 单样本 scrublet 类 | 2000 MB | 独立作业实测峰值约 1.5 GB |
| 常规分析步骤 | 5000 MB | 输入矩阵加载 + 过滤副本峰值约 5.2 GB |
| 不确定时 | 先不给上限，但用 `adb` 通道跑，并用外部监控看可用内存 | 避免误杀合法步骤 |

### 仍然无解的部分

- **无 root**：不能改 oom_score_adj，不能调 LMK 参数，不能改 cgroup 内存限制；
- **整组回收**：Android 在极端压力下按进程组回收，单个进程的保护措施挡不住；
- 因此**根本解法是把重内存作业放到内存充足的机器上**，本机只做轻量步骤与结果核对。

## 尚未迁移的部分

`ops/06_deploy_scripts.ps1` 目前仍用 ssh/scp 做脚本同步。
要完全脱离 ssh，需要把它改成「stdin 写入 + chmod + sha256 校验」，
校验口径可沿用现有的字节校验逻辑。这是后续项，未在本轮实施。
