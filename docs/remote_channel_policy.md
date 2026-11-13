# 远程通道策略：ADB 单通道

## 结论

日常执行统一走 **ADB 单通道**。SSH 配置、备用链路文档与相关契约已封存到
`_archive/ssh_retired_20261111/`，恢复方式见该目录 `RESTORE.md`。
应用入口、工单 schema、运维脚本与前端均不暴露 SSH 开关。

通道选择只看可用性，不看偏好：

| 通道 | 依赖 | 节点侧故障时 |
|---|---|---|
| adb | 系统 adbd，独立于应用进程 | 仍可用 |
| sshd | 应用内服务加端口转发 | 应用进程结束即断，转发也会丢 |

`adb kill-server` 之后端口转发会清空，SSH 报 `Connection refused`，而 ADB 通道照常工作。
这是选择单通道的直接原因。

## 产品服务端通道

产品服务端（`BioanalysDesktop/server/remote_exec.js`）的
`runRemote` / `runRemoteRaw` / `runRemoteStrict` 固定走 ADB：

- `BIO_COMPUTE_ADAPTER` 未设置或设为 `adb`：ADB，adb 不可用直接报错；
- `BIO_COMPUTE_ADAPTER=mock`：测试或离线演示，仍受 `BIO_ALLOW_MOCK_COMPUTE=1` 门禁约束；
- `BIO_COMPUTE_ADAPTER=ssh`：已封存，启动时 fail-closed 并指向恢复手册；
- 其它值：执行时 fail-closed，不静默改走任何通道。

`tools/ops/adb_exec.ps1` 固定 `-Transport adb`，不接受 `-Transport ssh`。

## 怎么用

```powershell
# 在 Linux 容器里执行（分析命令用这个）
pwsh -File tools/ops/adb_exec.ps1 -Level container -Command 'python3 -c "print(6*7)"'

# 在节点基础用户空间执行
pwsh -File tools/ops/adb_exec.ps1 -Level host -Command 'id -un'

# 跑本地脚本（内容经 stdin 送入，避开引号转义）
pwsh -File tools/ops/adb_exec.ps1 -Level container -ScriptPath .tmp/step.sh
```

`-Transport` 取值固定为 `adb`，失败即报错。无 `auto` 回落路径。
退出码透传远端命令的退出码，可直接用于判据。

## 权限边界

- 参考适配器面向 Android 设备，`adb shell` 默认身份不一定能读取应用私有目录；
- 可调试的应用可用平台的 `run-as` 或等价机制，以应用身份执行；
- 再经容器入口命令进入 Linux 容器，脚本先落到容器临时目录；
- 全程无需 root。

具体路径、用户空间前缀与容器名由 `docs/COMPUTE_INTERFACE.md` 的环境变量配置。

## 两个常见坑

1. **here-string 末尾不含换行**：`@'...'@` 拼下一行命令会粘成一句，
   实测报 `export: --: not a valid identifier`。拼接时必须显式补 `[char]10`。
2. **端口转发会丢**：`adb kill-server` 或设备重连后转发清空，需要按需重建。

## 文件传输

- 文本脚本一律走标准输入，不用 push。
- 大二进制不适合经 stdin 传，应在节点侧生成或使用专用传输函数。
- 新增文件传输入口统一使用 `BioanalysDesktop/server/adb_transfer.js` 的
  `pushFile` / `pullFile`，默认走 ADB，并用 sha256 回执核验。

## 服务端统一分流

产品服务端把 ADB 分流通一收敛到 `BioanalysDesktop/server/proc.js`：

- `runRemote` / `runRemoteRaw` / `runRemoteStrict` 默认直接调用 `adbRaw`；
- 既有同步、异步与流式 argv 保留为测试兼容形态；
- `BIO_COMPUTE_ADAPTER=mock` 继续只用于测试或离线演示，并在进程接缝前短路；
- 未知适配器在真正执行时 fail closed，不自动回落到任何通道。

`tools/ops/adb_exec.ps1` 是唯一 ADB 执行器。部署类 PowerShell 脚本统一通过它执行，
不在产品服务端内部另起默认链路。
