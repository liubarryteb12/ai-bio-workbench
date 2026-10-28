# K40 Termux Linux Server Rebuild Plan

## Final Goal

把 Redmi K40 重建为可远程管理、可长期运行、可执行轻量 R/Python 生信任务的 Termux Linux 计算节点。

运行边界：

- 保留 Android 13 与 HyperOS。
- 使用 Termux 用户空间，不替换 Android 内核。
- 当前 Bootloader 锁定且官方解锁受限，不规划 PostmarketOS。
- 数据与运行产物不放本仓库，本仓库只保存配置、计划和轻量验收记录。

## Phase 1 Clean Termux

目标：

- 从已安装的 Termux APK 重新安装 Termux 与 Termux:Boot。
- 清空旧应用数据，得到全新 `$PREFIX` 和 HOME。
- 验证 `run-as` 可执行 Termux 内命令。

验收：

- `pkg help` 返回 0，包管理可执行。
- `$PREFIX` 位于 Termux 应用沙盒。
- HOME 下不存在旧项目文件。

## Phase 2 Base Tools

安装：

- OpenSSH
- tmux
- git
- curl
- jq
- procps
- termux-api

验收：

- `ssh -V`、`tmux -V`、`git --version`、`jq --version` 正常。
- termux-wake-lock 命令存在。

## Phase 3 Remote Access

目标：

- 建立 SSH 密钥认证。
- 通过 `adb forward tcp:8022 tcp:8022` 从 Windows 登录。
- 使用 tmux 管理长任务。

验收：

- `ssh -p 8022 <user>@127.0.0.1` 无需密码登录。
- 断开并重新连接后 tmux 会话仍存在。

## Phase 4 Persistence

目标：

- Termux:Boot 自动启动 sshd。
- termux-wake-lock 常驻。
- MIUI 自启动、省电策略和电池优化白名单设置完成。

验收：

- 重启手机后可通过 SSH 恢复登录。
- 熄屏 10 分钟后 SSH 与 tmux 仍可用。
- `dumpsys power` 显示 Termux wake lock。

## Phase 5 Python

目标：

- 在 `proot-distro` Ubuntu 24.04 容器内建立独立 Python 虚拟环境。
- 安装 NumPy、pandas、SciPy、Matplotlib。
- 跑通一个小型表达矩阵读取与统计任务。

验收：

- 所有核心包可导入。
- 示例任务退出码为 0。
- 记录耗时、峰值内存和温度。

## Phase 6 R

目标：

- 安装 R 4.5.3 到 `/opt/R/4.5.3`。
- 建立独立站点库 `/opt/R/4.5.3-site-library`。
- 通过 `ops/layout_autoload/bin/Rscript` 固定分析入口。
- 逐项验证 `limma`、`edgeR`、`DESeq2`、`clusterProfiler`。
- WGCNA 作为后续独立兼容性测试。

验收：

- `Rscript --version` 报告 R 4.5.3。
- `.libPaths()[1]` 指向 `/opt/R/4.5.3-site-library`。
- 至少一个差异分析示例完成。
- 安装失败的包记录错误和替代方案。

## Phase 7 Capacity

记录以下指标：

- 1 万乘 2 万表达矩阵的处理时间。
- 峰值内存与 zram 使用。
- CPU 温度和降频情况。
- 连续运行后的 SSH 可用性。
- 重启后的服务恢复情况。

最终定位：

- 轻量分析节点。
- 远程控制与任务调度节点。
- 在明确数据规模内运行的辅助计算节点。
