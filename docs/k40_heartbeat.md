# K40 零 SSH 健康快照

第 4 Argon 第十九轮 Q2 的落地件：链路断了以后，从 Windows 侧仍要能答出「断在哪一层」，
而且不能依赖那条已经断掉的链路本身。

## 一、要解决的问题

原有链路自检（`server/link.js`）四段探测全靠 ssh：

| 段 | 判据 | 依赖 |
|---|---|---|
| 设备在线 | adb devices 里有序列号 | adb |
| forward 在位 | adb forward --list | adb |
| Termux 底座 | ssh k40 echo TERMUX_OK | 8022 |
| 容器 | ssh k40-ubuntu echo CONTAINER_OK | 10022 |

这几段共享一个盲区：**8022 挂了，前三段都还「能跑」，但答案全是超时**。实际上断因有四种
完全不同的形态，从 Windows 侧的报错看起来一模一样：

1. adb 隧道断了（USB 掉线、adb server 重启）
2. runsvdir 死了或某个服务被 `sv down` 停住（`sv status` 显示 run 是另一回事）
3. 8022 的 host key 丢了，sshd 反复退出
4. 容器的 10022 或 /mnt/ssd 挂载出问题

结论：需要一条**不经过 sshd、不经过 TCP 端口**的观测通道。

## 二、通道：adb exec-out run-as

Termux 包是可调试的（`dumpsys package com.termux | grep flags` 含 `DEBUGGABLE`），
所以 `adb exec-out run-as com.termux ...` 能以 app uid（10283）读私有目录、执行脚本：

```
adb -s 3a3e1f52 exec-out run-as com.termux sh -c "sh files/usr/bin/k40_heartbeat.sh"
{"schema":"k40_heartbeat/v2","ts":1793694009,"runsvdir_count":1,"sshd_8022_listen":1,
 "dropbear_10022_listen":1,"ssd_writable":1,"port_probe":"tcp-connect",
 "svc_sshd":"run","svc_ubuntu_sshd":"run","svc_crond":"run","svc_ssh_agent":"run"}
```

run-as 的 cwd 是 `/data/data/com.termux`，所以脚本路径写成 `files/usr/bin/...`。
Windows 侧入口在 `server/heartbeat.js` 的 `readHeartbeat()`，路由是 `GET /api/k40/heartbeat`
（可带 `?serial=` 覆盖默认序列号）。

设备侧脚本是 `ops/k40/heartbeat.sh`（部署到 `$PREFIX/bin/k40_heartbeat.sh`），
默认输出一行 JSON，`--write <path>` 时原子写文件（tmp + `mv -f`）。

## 三、五条实测改判（都是设计之初没想到的）

### 1. `/proc/net/tcp` 读不到
原方案查 `:1F56`（8022）与 `:2726`（10022）加状态 `0A`。实测 Termux app uid 访问
`/proc/net/tcp` 与 `/proc/self/net/tcp` 都是 `Permission denied`（Android 10 起限制）。
改用 `bash -c 'exec 3<>/dev/tcp/127.0.0.1/8022'` 连接探测：sshd 与探针同 uid 同 netns，
能连上就等于在监听，没有别的解释。代价是每次探测会在 sshd 日志留一行
`Connection closed by 127.0.0.1 port NNNNN [preauth]`（10022 侧两行），所以脚本按需执行、
不常驻。

### 2. `/mnt/ssd` 在 Termux 侧不存在
容器内的 `/mnt/ssd` 是容器内 tmpfs `/mnt` 下的目录，宿主侧真实路径是
`$PREFIX/var/lib/proot-distro/containers/ubuntu/rootfs/mnt/ssd/bio_data`（同一块
`/dev/block/dm-40`）。所以 `ssd_writable` 探宿主侧那条路径的 `[ -w ]`：零 I/O，
只读挂载会让 access 直接失败，正好是我们要的信号。

### 3. `ps` 给出的命令名有两种形态
经 ssh 跑时 `ps -A -o args` 给完整路径（`.../bin/runsvdir -P ...`），经 adb run-as 跑时
只给基名（`runsvdir -P ...`）。只认一种形态会把 `runsvdir_count` 报成 0（实测踩过）。
现在的匹配同时接受 `$2 == "runsvdir"` 与 `$2 ~ /\/bin\/runsvdir$/`。

### 4. 不能 grep 整行的 `bin/runsvdir -P`
flock 包装进程的整行里也含这个串：

```
12790 flock -n .../runsvdir.singleton.lock .../runsvdir -P .../var/service
12792 .../bin/runsvdir -P .../var/service          <- 真想数的
30753 .../bin/runsvdir .../bin/runsvdir .../var/service   <- 一条无 -P 的野生重复进程
```

第一版 `grep -c "bin/runsvdir -P $SVDIR"` 得出 3，把 flock 与野生进程都算进去了。
改成「命令名是 runsvdir（基名或全路径）且含 ` -P <SVDIR>`」后为 1。

野生 30753 是历史残留：它的服务目录参数其实是 `bin/runsvdir` 文件本身，不监督任何真服务，
ppid 为 1。它不影响判据（已排除），但存在于进程表里，清理前先确认它没有子进程。

### 5. `supervise/stat` 不只有状态词
执行过 `sv down` / `sv up` 之后，stat 文件的内容是
`run, got TERM, want down` 这种带逗号的瞬时描述。整行照抄会让判定把 `run` 当成「非 run」。
现在取逗号前那一段并去掉空白；`down` 时读到 `down`。

## 四、判据：五层，第一层失败即停

判定在 `server/heartbeat.js` 的 `evaluateHeartbeat()`（纯函数，时间可注入）。

| 顺序 | 层 | 判据 | 失败代号 |
|---|---|---|---|
| 0 | fresh | `now - ts <= 180s` | `ERR_HEARTBEAT_STALE` |
| 1 | runsvdir | `runsvdir_count == 1` 且四个服务 stat 全是 `run` | `ERR_STAGE_RUNSV` |
| 2 | port_8022 | `sshd_8022_listen == 1` | `ERR_STAGE_PORT_8022` |
| 3 | port_10022 | `dropbear_10022_listen == 1` | `ERR_STAGE_PORT_10022` |
| 4 | ssd_writable | `ssd_writable == 1` | `ERR_STAGE_MNT_RO` |

- **第一层失败即停**：下游失败多半是上游的后果，一起报会掩盖根因。
- **只报代号，不自愈**：这条通道只做记录与定性。设备侧不做 `sv restart`，Windows 侧也不做
  自动重启（Q1 裁定：盲目自愈会掩盖根因、制造 flapping、打穿闪存寿命）。
- 服务非 run 归在监督层并**点名服务**（例如 `非 run 服务: crond`）。真正的「服务 run 但端口不监听」
  （缺 host key 时 dropbear 反复退出）会落到端口层代号，这才是它该有的位置。
- 读不懂也分类：`ERR_HEARTBEAT_UNREADABLE`（adb 通过但输出里没有 JSON，多半 run-as 不可用）、
  `ERR_HEARTBEAT_INVALID`（schema / 字段不符）、`ERR_STAGE_TUNNEL`（adb 本身执行失败）。

## 五、真机红绿（2026-11-03，k40 实测）

| 场景 | 操作 | 心跳输出 |
|---|---|---|
| 全绿 | 无 | `runsvdir_count=1`，四服务 `run`，两端口 1，ssd 1 |
| 服务层红 | `sv down $PREFIX/var/service/crond` | `svc_crond:"down"`，其余不变；恢复 `sv up` 后回到 `run` |
| 端口层红 | `sv down ubuntu-sshd` 后杀掉 dropbear 进程 | `dropbear_10022_listen:0` + `svc_ubuntu_sshd:"down"`；此通道仍然可读（正是它的目的） |
| 恢复 | `sv up ubuntu-sshd` | 6 秒内 `10022 UP`，容器 ssh 正常 |
| 陈旧 | 只把「现在」拨后 600 秒（不动设备） | `ERR_HEARTBEAT_STALE`，且只报 fresh 一层 |

服务层红这条还暴露了一个运维事实：`sv down ubuntu-sshd` 之后 stat 显示
`run, got TERM, want down` 而 10022 **仍在监听**，说明 runsv 的 TERM 落在 proot 包装进程上，
容器里的 dropbear 子进程不受它管。要让 10022 真停，得 `sv down` 再杀掉 dropbear 进程本身。

## 六、为什么按需执行，不常驻

曾部署过 runit 服务 `k40-heartbeat` 每 60 秒写一次 `$PREFIX/var/log/k40_heartbeat.json`，随后撤掉：

- 常驻写盘是全年十万次量级的 I/O，而收益只是让文件「新一点」；
- 多一个服务就多一个会被 runsv 监督失败的东西，观测器自己成了故障源；
- 按需执行零常驻开销、永远最新：有人问的时候才花一次进程启动（实测 adb 全链路约 0.3 秒）。

设备上的 `$PREFIX/var/service/k40-heartbeat` 已删除，仓库里也不保留该服务目录。

## 七、测试与变异

- `BioanalysDesktop/tests/heartbeat.test.js`：18 条，覆盖解析（噪声、schema、缺字段、
  ts、服务名）、判定（五层全通、陈旧、第一层即停、各层代号）、通道（adb 抛错、参数逐项钉死、
  分不清「通道通」与「读得懂」）。
- `BioanalysDesktop/tests/diagnostics_routes_contract.test.js`：新增 4 条路由契约（ok/serial/
  层代号提示/抛错回 500），并把「四条路由命中返回 true」改成五条。
- 变异 10 条全红：JSON 只认第一行、去 ts 校验、未知布尔默认 0、服务缺失默认 run、去陈旧判定、
  层序反转、报最后一层、adb 丢 serial、路由恒 ok、hint 丢层代号。跑法见
  `.tmp/mutate_heartbeat.mjs`（临时脚本，不随仓库走）。

第一个版本 `M1 JSON 只认第一行` 是**绿的**：测试里的噪声只有一条 `{"noise":true}`，
正向扫一遍仍能找到真样本。修法是把测试改成「先有一条旧样本（runsvdir_count=3）、后面才是
本次的」，并把「取最后一行」写成断言，变异随即转红。这类假绿只有真去变异才看得见。

## 八、手工用法

```bash
# Windows 侧（不经 ssh）
adb -s 3a3e1f52 exec-out run-as com.termux sh -c "sh files/usr/bin/k40_heartbeat.sh"

# 设备侧，直接跑
sh $PREFIX/bin/k40_heartbeat.sh

# 落盘一份（可选定时任务读它）
sh $PREFIX/bin/k40_heartbeat.sh --write $PREFIX/var/log/k40_heartbeat.json

# 接口
curl http://127.0.0.1:18787/api/k40/heartbeat
```

部署（改完脚本后）：

```bash
adb push ops/k40/heartbeat.sh /data/local/tmp/k40_heartbeat.sh
adb shell "run-as com.termux cp /data/local/tmp/k40_heartbeat.sh files/usr/bin/k40_heartbeat.sh"
adb shell "run-as com.termux chmod 755 files/usr/bin/k40_heartbeat.sh"
```

## 九、边界

- 只回答「现在这一层通不通」，不回答「为什么」：代号的 detail 只带现场数值，根因仍要人去查日志。
- `runsvdir_count == 1` 是硬判据。如果哪天确实需要两条监督进程（例如并行跑两套服务目录），
  这条会误报，届时要改判据而不是改现场。
- 每次读都会产生 sshd/ubuntu-sshd 各若干行日志（见第三节第 1 条），高频轮询会放大日志体积；
  建议由人按需触发，或至少 5 分钟以上间隔。
- run-as 依赖 Termux 包可调试（DEBUGGABLE）。Termux 正式版一直是可调试的，但如果换成
  不可调试的构建，这条通道会整体失效，届时只能退回 ssh 观测。
