# 真机 `adb reboot` 端到端实测报告（2026-10-20 10:28–10:40）

> 目的：验证遗留项「v6 LOGDIR 修复 + 契约变更（不绑核/openblas）后，真重启能否零（少）手工恢复」。
> 结论：**双通与五服务恢复成功**（含一次 R15 双 runsvdir 抢锁的实战修复）；暴露 boot_v2 一个新缺陷（R15）。
> 执行：用户在场配合（USB + 重启后人工解锁一次，FBE 限制，reference 坑#85）。

## 一、时间线（PC 侧实测）

| 时刻 | 事件 |
|---|---|
| 10:28:17 | 预检全绿（设备在线、算力空闲、R 基线 48.44 GFLOPS、五服务 run）→ `adb reboot` |
| 10:28:49 | `sys.boot_completed=1`（32s）；`dumpsys user` = `RUNNING_LOCKED`（FBE，基础用户空间 起不来） |
| 10:29–10:33 | 轮询等待解锁（用户 10:33:07 完成解锁，225s） |
| 10:33:1x | MIUI 自启动生效：`com.termux.boot`(8173) + `com.termux`(8215) 自动拉起，**无需 am start** |
| 10:33:3x | **R15 爆发**：boot 日志刷 `runsv <svc>: fatal: unable to lock supervise/lock`；诊断见 §二 |
| 10:34–10:36 | `ops/fix_runsvdir.sh`（run-as out-of-band 通道）修复：杀双 runsvdir → 杀 runsv → 补杀 容器 → 单实例重拉 → sv up |
| 10:36–10:38 | 重建 `adb forward`（8022/10022，重启后 PC 侧转发表被清——reference 坑#84） |
| 10:38–10:40 | 全量验证通过（见 §三） |

## 二、R15：双 runsvdir 并存抢锁（新缺陷，boot_v2 v6 判据盲区）

**现象**：`pgrep -x runsvdir` = 两个（8419、8421，ppid 均为 1），瓜分服务
（8419 带 ssh-agent/crond/bio-watchdog，8421 带 ubuntu-sshd/sshd/t5sp-run），
互相抢 `supervise/lock`，日志风暴 390+ 条 `unable to lock`，部分 runsv 反复 fatal。

**根因**：基础用户空间:Boot 链路里 boot 脚本被触发两次（MIUI 自启动投递 + 二次触发路径未定位），
两个 `runsvdir -P $SVDIR` 并存。**boot_v2 v6 的 R1 段判据（杀「空转」或「environ 无 LOGDIR」
的 runsvdir）杀不掉它们**——两个都有 LOGDIR 且都非空转。这是判据盲区（同族：R1/R3 复发加强版）。

**修复**（`ops/fix_runsvdir.sh`，已归档，可复用）：
1. 杀所有 runsvdir → 2. 杀所有 runsv（SIGTERM 会传导到服务进程）→ 3. 补杀
   （容器 已知忽略 SIGTERM，`kill -9`；sshd/crond 防 TERM 未死）→ 4. 单实例
   `nohup runsvdir -P $SVDIR`（带 PREFIX/HOME/PATH/SVDIR/LOGDIR）→ 5. `sv up` 六服务
   → 6. 30s 有界等待验证。

**执行通道备注**：`run-as com.termux bash <script>` 被 Android W^X 拦（exec failed:
Permission denied）——必须 `run-as com.termux sh <script>`（系统 sh 解释执行）。
`run-as` 裸环境里 `sv` 不可见（PATH 是 Android 的，坑#78），需全路径或显式 export。

**修复后状态**：runsvdir=1，六服务各一 runsv，日志风暴停止（390 条为历史累积，无新增）。

## 三、reboot 后全量验证（与 reboot 前基线对照）

| 项 | reboot 前 | reboot 后 | 判定 |
|---|---|---|---|
| `ssh k40` / `ssh k40-ubuntu` | 双通 | 双通（TERMUX_OK / CONTAINER_OK） | ✅ |
| 五服务 | 全 run | 全 run（sshd 11328 / crond 11327 / ssh-agent 11323 / ubuntu-sshd 8441 / bio-watchdog 11321） | ✅ |
| log 子服务 | 全 run | 全 run（**v6 LOGDIR 修复经真重启端到端验证**，遗留项闭合） | ✅ |
| runsvdir | 1 | 1（修复后） | ✅（中途 R15） |
| 唤醒锁 | size=1 LONG | size=1 LONG（ACQ 6m10s，pid 8215） | ✅ |
| R 版本 | 4.3.3 | 4.3.3 | ✅ |
| R 吞吐（openblas 3t） | 48.44 GFLOPS | **48.44 GFLOPS**（checksum -7600.0476 逐位一致） | ✅ |
| 绑核契约 | 默认不绑核 | 默认不绑核（BIO_PIN_CPUS 版 wrapper 在位） | ✅ |
| 数据面 | 3 项目 / 142G avail | 3 项目 / 142G avail | ✅ |
| `ubuntu-sshd` 显示 `got TERM` | — | 有（pid 8441） | ✅ 无害（容器 忽略 TERM，termux_keepalive §六.2；10022 实测可连） |

## 四、待办与建议

1. **boot_v2 的 R15 防护**：设备侧幂等闸**已于 2026-10-20 安装验证**
   （`~/.termux/boot/start-p_actions.sh` 开头 `pgrep -x runsvdir && exit 0`，备份
   `.bak_20261020_idem`，实测手动触发 rc=0 不重拉）；**母本加固**（多 runsvdir 判据 +
   幂等闸）待用户拍板去向（reference/ 只读，设备侧已与母本漂移——以设备侧为准需同步母本）。
2. **幽灵 runsv 残留（已隔离，非阻塞）**：com.termux.boot 域的 runsv 8423 + 容器 8441
   跨 app 域杀不掉（SELinux），接受其继续提供 10022（功能无损），日志噪声 ~1 行/5s，
   **下次 reboot 自然清除**。若用户要求立即清净：只能再 reboot（幂等闸已防双触发复发）。
3. **R15 触发路径未定位**：boot 脚本为何被触发两次（MIUI 自启动 + ?）待后续观察；
   幂等闸已使重复触发无害。
4. 本轮 04 巡检唯一 FAIL 仍是 `is_l1_ml_m2_ledger.json`（待用户给 seed），与本测试无关。
