# Termux 保活机制（K40 底座面）

> 版本：v1.1（2026-10-27）
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
`unable to change to service directory` 是**无害现象，不要手动补 `log/run`**:
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

## 八、proot 15 秒 abort 的操作纪律（P-29，2026-10-23 实测）

**根因一句话**：`ubuntu-sshd` 的 proot 每 15 秒 abort 的充分条件是 **ssh 连接流**，
不是 `/tmp` 堆积（P-28 已推翻），也不是计算负载。

### 实测依据

- 停掉本机 runner、静默 3 分钟，abort 计数 202 → 202 **零增长**，同时远端 Python 任务
  仍在正常推进 → 与计算负载无关。
- 同一份日志里两段 abort 之间有 15 分 27 秒零 abort 窗口，窗口内十余次单发 ssh 均未触发；
  窗口结束于 08:10:09，其前 71 秒出现 **12 个并发 Accepted** → 并发连接是触发点。

### 纪律（所有碰 k40-ubuntu 的脚本和人肉命令都适用）

1. **禁止并发 ssh 到 `k40-ubuntu`。** 任何批量探测（md5 比对、逐文件检查、台账清单）
   必须在**单条 ssh 里**用 `;` 或换行拼完，不要起 N 个 ssh 进程。
   `cn_debug/lib/chain_runner.mjs` 的 `probeLiveness()` 就是这个形态。
2. **轮询间隔不小于 60 秒。** 10 秒间隔等于每分钟 6 次连接，会把 abort 环一直喂着，
   20-40 分钟的重步骤必然被周期性拖死。库常量 `POLL_INTERVAL_MS` 已设为 60000。
3. **ssh 重试最多 2 次。** 3 次重试在 abort 循环里等于多打一整轮连接。
4. **下发长任务前先确认容器安静。** 观察 60 秒无新增 abort 再下发，否则任务刚起步就被拖死。
5. **排障时容器内仍禁用 `find` / `ps` / `pgrep` / `grep -r` / `du` / `ls -R`**（P-23），
   这是另一条独立的触发路径，与连接流无关。

### ControlMaster 连接复用：本机不可用（已试过，别再试）

2026-10-23 实测：`ControlMaster=auto` + `ControlPersist` 在**本机 OpenSSH for Windows 9.5 上
走不通**。文件形式的 `ControlPath` 与命名管道形式（`\\.\pipe\...`）都报同一错误：

```text
getsockname failed: Not a socket
Read from remote host 127.0.0.1: Unknown error
```

替代方案已落地为 `cn_debug/lib/chain_runner.mjs` 的 `sshBatch()`：把 N 条远端命令经
base64 合成**一次** ssh 执行，连接数恒为 1，与命令数无关。实测一次连接跑完 9 条
md5 比对只用 519ms（原来是 9 次 ssh）。

（base64 传输同时绕开 PowerShell 展开 `$` / `<` / 引号的问题:这个坑当天踩了三次。）

### 自检命令

```powershell
# 当前 abort 累计次数（单文件内计数，svlogd 轮转会重置，比较必须在同一文件内）
adb shell 'run-as com.termux sh -c "grep -c assertion /data/data/com.termux/files/usr/var/log/ubuntu-sshd/current"'

# 当前 proot 存活时长：超过 60 秒且持续增长即视为安静
adb shell 'ps -eo pid,etime,args | grep "[p]root --kill" | head -1 | cut -c1-30'
```

### WP-1.3 实现落点

- `ops/bio_limits.sh`：线程固定为 3，母版不得再覆盖。
- `ops/layout_autoload/sitecustomize.py`：Python 启动即设置 `RLIMIT_AS=7.5GB`。
- `ops/layout_autoload/Rprofile`：R 启动即设置 data.table 3 线程、future 2 worker 与 6GiB globals 上限。
- `ops/run_throttled_task.sh`：启动前读取 thermal zones，温度达到 90C 时每 30 秒复测，低于 78C 才启动任务。
- `BioanalysDesktop/server/task.js` 与 `server/run.js`：长步骤用 `setsid nohup`，状态文件每 60 秒单次轮询。
- `server/audit.js`：任务命令中出现 `find`、`ps`、`grep -r`、`pgrep`、`pkill` 时直接拒绝。
