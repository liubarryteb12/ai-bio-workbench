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

## 尚未迁移的部分

`ops/06_deploy_scripts.ps1` 目前仍用 ssh/scp 做脚本同步。
要完全脱离 ssh，需要把它改成「stdin 写入 + chmod + sha256 校验」，
校验口径可沿用现有的字节校验逻辑。这是后续项，未在本轮实施。
