# Termux 保活机制（K40 底座面）

> 版本：v1.0（2026-10-18）
> 适用：红米 K40（M2012K11AC，MIUI V816 / Android 13）上的 Termux 底座
> 关联：`ops/bio_watchdog.sh`、`~/.termux/boot/start-p_actions.sh`、`~/.termux/boot/start-sshd.sh`

## 一、掉线根因（2026-10-18 实测）

Termux 掉线时 `dumpsys power` 显示 **`Wake Locks: size=0`**，即进程没有持有唤醒锁。
CPU 休眠后 Termux 被冻结，runit 的四个服务随之停摆，表现为：

- `adb forward` 端口仍在监听（映射表还在）
- 但 SSH 连接立即被关闭：`Connection closed by 127.0.0.1 port 10022 / 8022`
- `pidof com.termux` 为空

补充事实：开机脚本里本来就写了 `termux-wake-lock`，但**手动拉起（`am start`）不走 Termux:Boot**，
所以手动恢复后唤醒锁仍为 0，容易再次掉线。

## 二、五层防护（当前全部就位）

| 层 | 措施 | 当前状态 | 谁维护 |
|---|---|---|---|
| 1 | MIUI 自启动允许 | Termux、Termux:Boot 均在允许列表 | 系统设置 |
| 2 | MIUI 省电策略 | **无限制**（不采取任何限制措施） | 系统设置 |
| 3 | Android 电池优化白名单 | `dumpsys deviceidle whitelist` 含 com.termux / com.termux.boot | 系统设置 |
| 4 | 唤醒锁常驻 | `termux-wake-lock`，`Wake Locks: size=1`，标记 LONG | `bio_watchdog.sh` 每分钟重申 |
| 5 | 服务自愈 | `bio-watchdog` 由 runit 监管，每分钟检查 4 个服务并 `sv up` | `ops/bio_watchdog.sh` |

补充：`standby bucket = 10 (ACTIVE)`、`RUN_ANY_IN_BACKGROUND = allow`，均已是最好档位。

## 三、bio-watchdog 服务

**位置**：`$PREFIX/var/service/bio-watchdog/run` → `~/p_actions/bin/bio_watchdog.sh`
**日志**：`~/p_actions/logs/watchdog.log`（超过 256 KB 截断，保留尾部 64 KB）

职责只有两条：

1. 每分钟调用 `termux-wake-lock`（幂等，已持有时不重复计数）
2. 每分钟检查 `sshd` / `crond` / `ssh-agent` / `ubuntu-sshd`，非 `run:` 状态立即 `sv up`

**刻意不做容器 ssh 探测**：`k40-ubuntu` 是 Windows 侧 `~/.ssh/config` 的别名，Termux 内不存在。
首版照抄该别名导致每 5 分钟误判并反复 `sv restart ubuntu-sshd`，见踩坑台账 #134。

**操作**：

```bash
export PREFIX=/data/data/com.termux/files/usr
export SVDIR="$PREFIX/var/service"
sv status bio-watchdog
sv restart bio-watchdog
tail -20 ~/p_actions/logs/watchdog.log
```

**已知设计边界（2026-10-20 实测，勿再踩）**：bio-watchdog **没有 log 子服务**
（日志走自带的 `~/p_actions/logs/watchdog.log`）。`sv status bio-watchdog/log` 报
`unable to change to service directory` 是**无害现象，不要手动补 `log/run`**——
runsvdir 运行中不热扫描新服务目录，补了也没有 runsv 接管，只会让 boot 脚本的
`[ -d "$SVDIR/$s/log" ] && sv up` 守卫每次触发 warning。2026-10-20 曾误补后回退
（删掉 `$SVDIR/bio-watchdog/log` 即恢复，主服务零影响）。同理，运行中给任何服务
新增/删除子目录都不会被 runsvdir 感知，改服务树必须重启 runsvdir（会断全链，
需预约窗口）。

## 四、开机自启

`~/.termux/boot/start-p_actions.sh` 已把 `bio-watchdog` 加入显式 `sv up` 列表（两处循环）。
原文件备份为 `start-p_actions.sh.bak_20261018_watchdog`。

启动链：

```
开机 → Termux:Boot 触发 ~/.termux/boot/*.sh
     → start-sshd.sh 获取唤醒锁 + sv up sshd
     → start-p_actions.sh 拉起 runsvdir，sv up 5 个服务（含 bio-watchdog）
     → bio-watchdog 每分钟重申唤醒锁并自愈服务
```

## 五、验证方法

```powershell
# 1. 唤醒锁
adb shell "dumpsys power | grep -E 'Wake Locks|termux:service'"

# 2. 五个服务
ssh k40 'export PREFIX=/data/data/com.termux/files/usr; export SVDIR=$PREFIX/var/service; sv status sshd crond ssh-agent ubuntu-sshd bio-watchdog'

# 3. 容器
ssh -p 10022 root@127.0.0.1 'echo CONTAINER_OK'
```

实测记录（2026-10-18）：

- 唤醒锁：`PARTIAL_WAKE_LOCK 'termux:service-wakelock' ... LONG`，持续 9 分 37 秒
- 五服务全 `run`
- 故障注入 1：`kill -9` crond 主进程 → runsv 5 秒内重启
- 故障注入 2：`sv down crond` → bio-watchdog 49 秒内 `sv up`，日志留痕
- 容器：`CONTAINER_OK`

## 六、边界与残余风险

1. **Termux 进程被系统杀掉**：watchdog 随之消失，只能靠 Termux:Boot（开机）或用户手动打开。
   当前五层防护已把该概率压到很低，但无法归零。
2. **proot 忽略 SIGTERM**：`sv restart ubuntu-sshd` 后 `sv status` 会显示 `got TERM`，
   但进程仍存活（`State: S`，10022 可连）。这是无害标记，**不要据此反复重启**。
3. **手动拉起不触发 boot 脚本**：用 `am start` 恢复后，需手动执行一次 `termux-wake-lock`，
   否则回到无锁状态。watchdog 起来后会在一分钟内补上。
4. **强制停止应用**：MIUI 的「结束运行」会清掉所有 Termux 进程，任何应用内机制都无法自愈。

## 七、掉线后的恢复步骤

```powershell
# 1. 确认设备在线
adb devices

# 2. 拉起 Termux（会触发 boot 脚本，含唤醒锁）
adb shell "am start -n com.termux/com.termux.app.TermuxActivity"

# 3. 等待 5 到 8 秒后验证
ssh -o BatchMode=yes -p 8022 127.0.0.1 'echo TERMUX_OK'
ssh -o BatchMode=yes -p 10022 root@127.0.0.1 'echo CONTAINER_OK'
```

若 `am start` 后仍不通，检查 `adb forward --list` 两条映射是否在位，缺则重建：
`adb forward tcp:8022 tcp:8022`、`adb forward tcp:10022 tcp:10022`。
