# 远程通道策略：ADB 单通道（2026-11-11 封存 SSH）

## 结论

日常执行一律走 **adb** 单通道。用户当前不使用 SSH，相关配置、备用链路文档与
契约测试已封存到 `_archive/ssh_retired_20261111/`，恢复方式见同目录 `RESTORE.md`。
应用入口、工单 schema、运维脚本与前端均不再暴露 SSH 开关。
理由不是偏好，是可用性实测：

| 通道 | 依赖 | 设备侧故障时 |
|---|---|---|
| adb | 系统 adbd（与 Termux 无关） | 仍可用 |
| sshd | 跑在 Termux 内的 dropbear + adb 端口转发 | Termux 一死即断，且 adb server 重启后转发会丢 |

2026-11-06 当天，Termux 被 Android 的 low-memory-killer 杀掉 5 次。
每次都是 **adb 还能用**，靠 `adb shell am start` 重启 Termux 才恢复；
sshd 全程不可用。

就在写这份文档时又复现一次：`adb kill-server` 之后端口转发清空，
`ssh` 报 `Connection refused`，而 adb 通道照常工作。

## 产品服务端通道

产品服务端（`BioanalysDesktop/server/remote_exec.js`）的
`runRemote` / `runRemoteRaw` / `runRemoteStrict` 固定走 ADB：

- `BIO_COMPUTE_ADAPTER` 未设置或设为 `adb`：ADB，adb 不可用直接报错；
- `BIO_COMPUTE_ADAPTER=mock`：测试或离线演示，仍受 `BIO_ALLOW_MOCK_COMPUTE=1` 门禁约束；
- `BIO_COMPUTE_ADAPTER=ssh`：已封存，启动时 fail-closed 并指向恢复手册；
- 其它值：执行时 fail-closed，不静默改走任何通道。

`ops/adb_exec.ps1` 固定 `-Transport adb`，不再接受 `-Transport ssh`。

## 怎么用

```powershell
# 在 proot ubuntu 容器里执行（分析命令用这个）
pwsh -File ops/adb_exec.ps1 -Level ubuntu -Command 'python3 -c "print(6*7)"'

# 在 Termux 用户态执行
pwsh -File ops/adb_exec.ps1 -Level termux -Command 'id -un'

# 跑本地脚本（内容经 stdin 送入，避开引号转义）
pwsh -File ops/adb_exec.ps1 -Level ubuntu -ScriptPath .tmp/step.sh

```

`-Transport` 取值固定为 `adb`（失败即报错）。无 `auto` 回落路径。

退出码透传远端命令的退出码，可直接用于判据。

## Pi Agent 退场裁定（2026-11-11）

Pi Agent 集成已于 2026-11-11 整体退场，手机侧不再有自主执行体。
主计算入口只剩 ADB 单通道加服务端 P-29 串行闸门，避免两套命令入口并存。
手机侧遗留的进程、配置目录与 runit 服务由设备维护单独回收，仓库不再提供对应脚本。

## 权限边界（实测，无需 root）

- `adb shell` 身份是 `uid=2000(shell)`，读不到 `/data/data/com.termux`；
- 该 Termux 是 debuggable，可用 `run-as com.termux` 以 Termux UID 执行；
- 再经 `proot-distro login ubuntu -- bash /tmp/xxx.sh` 进容器；
- 脚本先落到容器 rootfs 的 `/tmp`，因为 stdin 已被外层 `bash -s` 占用。

## 两个坑

1. **here-string 末尾不含换行**：`@'...'@` 拼下一行命令会粘成一句，
   实测报 `export: --: not a valid identifier`。拼接时必须显式补 `[char]10`。
2. **端口转发会丢**：`adb kill-server` / 设备重连后转发清空，
   SSH 显式特殊开关通道需按需重建。`adb_exec.ps1` 的 `Repair-Forwards` 已自动处理。

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

## 服务端统一分流

产品服务端把 ADB 分流通一收敛到 `BioanalysDesktop/server/proc.js`：

- `runRemote` / `runRemoteRaw` / `runRemoteStrict` 默认直接调用 `adbRaw`。
- 新增文件传输入口统一使用 `BioanalysDesktop/server/adb_transfer.js` 的 `pushFile` / `pullFile`，
  默认走 ADB，并用 sha256 回执核验。新增的业务路径不得直接拼 scp 命令。
- 既有同步、异步与流式 ssh / scp argv 保留为显式 SSH 特殊开关与测试兼容形态，
  避免在真实报告与探针链路上改变已验证的流式行为。
- `BIO_COMPUTE_ADAPTER=mock` 继续只用于测试或离线演示，并在进程接缝前短路。
- `BIO_COMPUTE_ADAPTER=ssh` 是特殊开关。只有显式设置时，既有 ssh / scp argv 才按原样执行，
  用于验证备用链路或处理获批的临时故障。
- 文件传输用唯一临时脚本名、base64 字节载荷与 sha256 回执校验，避免并发覆盖同一远端脚本。
- 未知适配器在真正执行时 fail closed，不自动回落到任何通道。
- 迁移顺序以“主计算入口、任务回执、新增文件传输”为先，历史同步探针保持只读兼容，
  后续按单独工单逐条迁移，不在总门禁里做一次性 argv 改写。

`ops/adb_exec.ps1` 仍是唯一 ADB 执行器。部署类 PowerShell 脚本如 `ops/06_deploy_scripts.ps1`
属于运维入口，统一通过 `ops/adb_exec.ps1 -Transport adb` 或显式 `-Transport ssh` 选择通道，
不在产品服务端内部另起一条默认链路。
