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

更进一步，**健康的 runsvdir 会把 argv 里的 `-P` 自己改写掉**：实测 pid 26563 的
`/proc/26563/cmdline` 是 `.../bin/runsvdir|.../var/service|`，没有 `-P`。所以判据不能要求
` -P <SVDIR>` 存在，而要看 argv 的位置：argv0 是 runsvdir（基名或全路径），且
`$3 == "-P"` 与 `$4 == SVDIR`（未改写）或 `$3 == SVDIR`（已改写）；如果 `$3` 又是
`.../runsvdir`，那是 argv0 被复制的野生态，跳过。第一版要求 ` -P ` 子串，健康设备上
`runsvdir_count` 恒为 0，判定报 `ERR_STAGE_RUNSV` 假红。

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

`want down` 要单独归一化成 `down_pending`（第三个状态，既不是 run 也不是 down）：`sv down`
发了 TERM，runsv 在等进程退出，此时 stat 是 `run, got TERM, want down`。只取逗号前一段会把它
读成 `run`，而现场 10022 还在监听、dropbear 子进程还在跑（详见第六节），于是「停止请求被吞掉」
这件事被读成「一切正常」。归一化规则：先 `first="${state%%,*}"`，命中 `*"want down"*` 就改写
成 `down_pending`；`want up` 仍算 `run`（进程还在，服务在恢复路上）。

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

## 五、复合诊断标志与已断时长（4 Argon 第二十轮）

五层判据回答「断在哪一层」，但有两类现场它答不出来，因为每一层单独看都「正常」：

| 现象 | 单层判据怎么说 | 真实含义 |
|---|---|---|
| 服务 stat 是 `run`，端口却不在听 | 监督层 pass、端口层 fail | 服务名存实亡（缺 host key 时 dropbear 反复退出、runsv 反复重启） |
| 服务 stat 不是 `run`，端口却在听 | 监督层 fail | 监督树与真实进程脱钩（容器 daemon 逃出 runsv 的管辖） |
| 服务 `want down`，进程不退 | 若把 `want down` 归一成 run，则全层 pass | 停止请求被吞（proot 包装进程收了 TERM，容器里的子进程不受管） |

所以判定里加一条**与层序无关**的交叉校验 `detectServicePortAnomalies()`：拿每个服务的 stat 与它
对应端口的监听事实做异或，命中就产出 `anomalies`，并以 ` ; ` 接在 `detail` 后面。代号：

- `ANOMALY_RUN_NO_LISTEN`：服务 run 但端口没在听；
- `ANOMALY_DOWN_STILL_LISTEN`：服务非 run（含 `down_pending`）但端口还在听；
- `ANOMALY_STOP_IGNORED`：服务 `down_pending` 且端口仍在听，即 TERM 没送达到真正干活的进程。

两张对照表只覆盖会监听 TCP 的两个服务（`sshd:8022`、`ubuntu-sshd:10022`）。`crond` 与
`ssh-agent` 不监听端口，硬凑进去只会制造假异常。

**anomalies 不进层代号**：它不改变五层判据的结论，层代号仍是第一个失败层。也就是说
`status`、`code` 与 `anomalies` 是三件独立的事实，读的人自己组合；把它们压成一个「总体结论」
会丢掉「哪一层是真的断」这条信息。

### 已断时长：last_ok_ts 与 down_duration_sec

`status: fail` 只说明「现在不通」，不说明「断了多久」。断了 10 秒和断了 3 小时，处置完全不同。
所以 `readHeartbeat()` 的三个返回路径（隧道失败、解析失败、正常）都补两个字段：

| 字段 | ok 时 | fail 时 |
|---|---|---|
| `last_ok_ts` | 本次时间戳 | 上一次全通的时间戳，从未全通则 `null` |
| `down_duration_sec` | `0` | `now - last_ok_ts`，从未全通则 `null` |

两个 `null` 是刻意的：真实值未知时伪造 `0` 或 `1970` 会让人以为「刚断」或「远古就断」，
而事实是「这个进程从没见它通过」。

记忆只存在进程内（`livenessStore`），**不落盘**：落盘会让设备侧多一个写入方，等于给要观测的
对象再加一个可能坏掉的东西。代价是 DSH 服务重启后 `down_duration_sec` 回到 `null`，直到下一次
全通把 `last_ok_ts` 重新立起来。

### 自检降级调心跳

`/api/selfcheck` 的第 5 盏灯（链路）在 `overall != pass` 时，额外调一次 `readHeartbeat()`，把
`{status, code, detail, last_ok_ts, down_duration_sec, anomalies}` 挂到 `heartbeat` 字段，并给
`diagnostic_endpoint: /api/k40/heartbeat`。

- 全绿时**一次都不调**：心跳会跑 adb 与两次 TCP 探测，而全绿时它提供不了新信息；
- 心跳自己抛错只降级为「只给端点提示」，不改链路灯结论（观测器坏了不能把链路判成坏）；
- 判 fail 时 `detail` 末尾追加 `heartbeat=<代号>`，让人一眼看到「链路灯说坏，心跳说是哪层坏」。

## 六、真机红绿（2026-11-03，k40 实测）

| 场景 | 操作 | 心跳输出 |
|---|---|---|
| 全绿 | 无 | `runsvdir_count=1`，四服务 `run`，两端口 1，ssd 1 |
| 服务层红 | `sv down $PREFIX/var/service/crond` | `svc_crond:"down"`，其余不变；恢复 `sv up` 后回到 `run` |
| 端口层红 | `sv down ubuntu-sshd` 后杀掉 dropbear 进程 | `dropbear_10022_listen:0` + `svc_ubuntu_sshd:"down"`；此通道仍然可读（正是它的目的） |
| 停止被吞 | `sv down $PREFIX/var/service/ubuntu-sshd`，不杀进程 | `svc_ubuntu_sshd:"down_pending"`、`dropbear_10022_listen:1`、`anomalies:["ANOMALY_STOP_IGNORED:ubuntu-sshd"]`、层代号 `ERR_STAGE_RUNSV` |
| 计数假红修正 | 部署改过 awk 判据的新脚本 | 修前 `runsvdir_count=0` + `ERR_STAGE_RUNSV`（四服务全 run、两端口都在听），修后 `runsvdir:1` + `status:ok` |
| 时长 | 同一次进程内先跑全通、再跑失败 | `last_ok_ts` 保留上次全通秒数、`down_duration_sec` 变正数；从未全通时两者都是 `null` |
| 恢复 | `sv up ubuntu-sshd` | 6 秒内 `10022 UP`，容器 ssh 正常 |
| 陈旧 | 只把「现在」拨后 600 秒（不动设备） | `ERR_HEARTBEAT_STALE`，且只报 fresh 一层 |

服务层红这条还暴露了一个运维事实：`sv down ubuntu-sshd` 之后 stat 显示
`run, got TERM, want down` 而 10022 **仍在监听**，说明 runsv 的 TERM 落在 proot 包装进程上，
容器里的 dropbear 子进程不受它管。要让 10022 真停，得 `sv down` 再杀掉 dropbear 进程本身。

## 七、为什么按需执行，不常驻

曾部署过 runit 服务 `k40-heartbeat` 每 60 秒写一次 `$PREFIX/var/log/k40_heartbeat.json`，随后撤掉：

- 常驻写盘是全年十万次量级的 I/O，而收益只是让文件「新一点」；
- 多一个服务就多一个会被 runsv 监督失败的东西，观测器自己成了故障源；
- 按需执行零常驻开销、永远最新：有人问的时候才花一次进程启动（实测 adb 全链路约 0.3 秒）。

设备上的 `$PREFIX/var/service/k40-heartbeat` 已删除，仓库里也不保留该服务目录。

## 八、测试与变异

- `BioanalysDesktop/tests/heartbeat.test.js`：31 条，覆盖解析（噪声、schema、缺字段、
  ts、服务名）、判定（五层全通、陈旧、第一层即停、各层代号）、通道（adb 抛错、参数逐项钉死、
  分不清「通道通」与「读得懂」）、复合标志（三种异常各自点名服务与端口、crond 不参与交叉校验、
  自洽组合不报、陈旧快照仍报矛盾）、时长（三态：首次成功 / 成功后再失败 / 从未成功）。
- `BioanalysDesktop/tests/heartbeat_script_contract.test.js`：4 条静态契约，钉住设备侧脚本的
  shebang 与 `set -eu`、计数判据的四个 argv 分支、`down_pending` 归一化、JSON 字段齐全与原子写、
  以及「设备侧不许自愈」（代码行里不出现 `rm -f` / `sv restart` / `sv up` / `sv down`）。
  `code()` 先滤掉注释行：注释里也有 ` -P ` 与 `want down` 字面量，混进来会造成假绿。
- `BioanalysDesktop/tests/diagnostics_routes_contract.test.js`：新增 4 条路由契约（ok/serial/
  层代号提示/抛错回 500），并把「四条路由命中返回 true」改成五条；另有 3 条判 fail 时调心跳的
  契约（调用次数、字段、诊断端点、心跳抛错不改结论）。
- 第一轮变异 10 条全红：JSON 只认第一行、去 ts 校验、未知布尔默认 0、服务缺失默认 run、去陈旧
  判定、层序反转、报最后一层、adb 丢 serial、路由恒 ok、hint 丢层代号。跑法见
  `.tmp/mutate_heartbeat.mjs`（临时脚本，不随仓库走）。
- 第二轮变异 8 条全红（`.tmp/mutate_hb.cjs`）：两个异常判定各自取反、从未全通时伪造
  `down_duration_sec=0`、全通不刷新 `last_ok_ts`、失败也把当次时间记成全通、自检全绿仍调心跳、
  失败不给诊断端点、矛盾结论不进 `detail`。
- 设备侧脚本变异 4 条全红（`.tmp/mutate_hb_script.cjs`，跑完自动还原）：去掉 `$3 == sv` 分支、
  去掉 `want down` 归一化、插入 `sv restart`、插入 `ssh` 调用。

第二条变异最初是**绿的**：把 `liveness.last_ok_ts` 改成「无条件写入」在原语义下等价（失败时
要写的值就等于旧值），所以测试看不出差别。改写成「写入当次 `testedAt`」才可观测。这类
等价变异不能当成断言有洞，换一个真能改变行为的写法再试。

第一个版本 `M1 JSON 只认第一行` 是**绿的**：测试里的噪声只有一条 `{"noise":true}`，
正向扫一遍仍能找到真样本。修法是把测试改成「先有一条旧样本（runsvdir_count=3）、后面才是
本次的」，并把「取最后一行」写成断言，变异随即转红。这类假绿只有真去变异才看得见。

## 九、手工用法

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

## 十、边界

- 只回答「现在这一层通不通」，不回答「为什么」：代号的 detail 只带现场数值，根因仍要人去查日志。
- `runsvdir_count == 1` 是硬判据。如果哪天确实需要两条监督进程（例如并行跑两套服务目录），
  这条会误报，届时要改判据而不是改现场。
- 每次读都会产生 sshd/ubuntu-sshd 各若干行日志（见第三节第 1 条），高频轮询会放大日志体积；
  建议由人按需触发，或至少 5 分钟以上间隔。
- `anomalies` 与 `last_ok_ts` 都是附加事实，不改变五层判据的结论；读的人要把 `code`（哪一层）
  与 `anomalies`（层间矛盾）分开看。
- 已断时长只在 DSH 服务进程内存里：进程重启即失忆，`down_duration_sec` 回 `null`。这是刻意的
  取舍，不落盘就不会让设备侧多一个写入方。
- run-as 依赖 Termux 包可调试（DEBUGGABLE）。Termux 正式版一直是可调试的，但如果换成
  不可调试的构建，这条通道会整体失效，届时只能退回 ssh 观测。
