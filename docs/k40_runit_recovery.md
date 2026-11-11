# K40 Termux 宿主面 runit 故障根因与恢复手册

> 2026-11-01 实测结论。本文件记录**已验证的事实**，不写推测。
> 相关：ledger/pitfalls_ledger.md P-23/P-26，技术债 5.3。

## 一、已验证的根因链（按实测顺序）

### 1. 双实例 runsvdir 是状态错乱的直接原因
- 现象：`sv status <svc>` 报 `runsv not running` 或 `unable to open supervise/ok`，但端口实际在监听。
- 实测：`/proc/*/cmdline` 里同时存在多个 `runsvdir`，各自拉起一套 `runsv`，互相争抢 `supervise/`。
- 触发源：每开一个 adb shell / ssh 会话，`$PREFIX/etc/profile.d/start-services.sh` 就会试着拉起一次。
- **判据**：`count_runsvdir`（只看 argv[0] 的 basename）必须恒等于 1。用整串 grep 'runsvdir' 会把 shell 自身数进来（实测假阳性到 4）。

### 2. `run-as com.termux` 的 SELinux 域无法 mkfifo
- 实测：`supervise/control` 与 `supervise/ok` 是 `mkfifo()` 出来的 FIFO（`ls -la` 显示 `p` 前缀）。
- 在 `run-as` 域下创建会出现 `Permission denied`；在**正常 ssh 会话**（继承 Termux 的 untrusted_app 域）下创建成功。
- **推论**：清理脚本绝不能 `rm -rf supervise/`。一旦删掉 FIFO，退化到 run-as 域就再也建不回来。只允许删 `supervise/lock` 这类普通文件。

### 3. `runsv` 在 Android 私有存储上锁 `supervise/lock` 失败
- 实测日志：`runsv sshd: fatal: unable to lock supervise/lock: temporary failure`。
- 与 `svlogd` 的 `unable to lock directory: temporary failure` 同源：Android `app_data_file` 上 flock 语义受限。
- 试过把 `lock` 改成 FIFO：报错变为 `unable to open supervise/lock: device not configured`，**方向错误，lock 必须保持普通文件**。
- **结论**：在 Termux 上指望 `runsvdir` + `runsv` 完整监督 sshd 不可靠。实际可用的形态是：主服务靠独立进程存活（`sh start-sshd.sh` 裸起 sshd、`proot-distro login` 裸起 dropbear），runit 只负责 log 子服务。

### 4. 破坏性运维会自断链路
- 实测：为重建而 `pkill sshd` 会把正在承载当前 ssh 会话的 sshd 一起杀掉，8022 与 10022 同时断，只能靠 `run-as bash start-sshd.sh` 人工救回。
- **铁律**：修复监督树只杀 `runsvdir` 与 `runsv`，**绝不 pkill sshd**；重建前先挂 15 秒死人开关。

## 二、实测有效的恢复命令（按顺序）

```bash
# 1) 恢复 Termux 底座 sshd（唯一可靠的人工救回手段）
#    经 adb，不依赖现有 ssh 链路：
adb shell "run-as com.termux /data/data/com.termux/files/usr/bin/bash \
  /data/data/com.termux/files/home/.termux/boot/start-sshd.sh"

# 2) 恢复容器面 dropbear（8022 通了之后）
ssh k40 'nohup $PREFIX/bin/proot-distro login ubuntu -- \
  /mnt/ssd/bio_data/bin/dropbear-static-20261027 \
  -F -E -p 10022 -r /etc/dropbear/dropbear_ed25519_host_key -s \
  >$PREFIX/tmp/ub.log 2>&1 </dev/null &'

# 3) 验链路
ssh k40 'echo BASE_OK' && ssh k40-ubuntu 'echo CONTAINER_OK'
```

## 三、已落地仓库的资产

| 文件 | 作用 |
|---|---|
| `tools/ops/k40/sv/{sshd,crond,ssh-agent,ubuntu-sshd}/{run,log/run}` | 8 个 runit 服务定义，log/run 带 10MB 轮转 |
| `tools/ops/k40/ensure_runsvdir.sh` | 幂等点火（flock 单实例 + 快判短路 + 15 秒死人开关 + 绝不杀 sshd） |

## 四、尚未解决（交接给下一轮）

1. `runsv` 锁 `supervise/lock` 失败属 Android 存储层限制，**runit 完整监督 sshd 在 Termux 上不可行**；需裁定是否改为「裸进程 + 轻量看门狗」模型。
2. `$PREFIX/etc/profile.d/start-services.sh` 仍会在每次登录时尝试拉起 runsvdir，需按 Argon 建议收口到 `ensure_runsvdir.sh`。
3. 设备重启后仍需人工执行第二节第 1 条才能恢复 8022，尚未实现全自动。

## 五、2026-11-03 事故与修正（selftest 首跑打断 8022）

### 5.1 事故经过
- 给 `ensure_runsvdir.sh` 写自测脚本，做法是 `SELFTEST_SOURCE_ONLY=1` 后 `. <目标脚本>`，期望守卫 `( return 0 2>/dev/null ) || exit 0` 让脚本只加载函数。
- 设备首跑：`mktemp -d` 在 ssh 会话里不可用（`TMPDIR` 未设），脚本降级到 `$PREFIX/tmp/ers.$$` 继续跑。
- 随后 ssh 超时、`Connection lost before handshake`：`runsvdir` 与全部 `runsv` 被杀，8022 消失。
- **根因**：`source` 时守卫失效，破坏性主流程被执行。守卫用 `return` 语义，在 bash 里对「被 source 的脚本」与「子 shell」的判定不一样，属于不可靠的顶门手段；只要顶不住，脚本就把自己宿主机的监督树拆了。

### 5.2 结构修正（本次落地）
- 主流程整体挪进 `main()`，文件末尾固定三行：`if [ "${SELFTEST_SOURCE_ONLY:-}" = 1 ]; then return 0 2>/dev/null || exit 0; fi`、空行、`main "$@"`。
- source 只可能停留在函数定义区，破坏性代码没有任何「加载即执行」的入口。
- 自测里用哨兵 shim（`setsid`/`flock`/`sshd` 写入 $T/sentinel_*）证明 source 之后没有任何点火动作，替代「相信守卫」。
- `mktemp` 失败一律判红（`SELFTEST_FAIL: mktemp -d 不可用`），不再降级到固定路径。

### 5.3 恢复路径（实测）
1. `adb exec-out run-as com.termux sh -c 'HOME=... $PREFIX/bin/sshd'` 能把 8022 点回来，但 sshd 落在 **runas_app** 域；该域下 `runsvdir` 起 `runsv` 报 `fatal: unable to start runsv <svc>: access denied`，监督树建不起来。
2. 正确做法：让命令在 **Termux app 域**执行。可行通道是 `adb shell am start -n com.termux/com.termux.app.TermuxActivity` 后用 `adb shell input text` + `input keyevent 66` 在终端里敲 `bash ~/bin/boot_repair.sh`（脚本经 `adb ... run-as com.termux` 预置）。
3. 该脚本在 app 域里 `nohup setsid flock ... runsvdir -P <SVDIR> &`，随后四个服务全部 run，`ps -Z` 显示 `u:r:untrusted_app_27`。
4. 旧的 runas 域 sshd 需要单独杀掉，runit 的 sshd 才能接管 8022（`sv down/up` 绝对路径）。

### 5.4 本次新实测：runsvdir 会改写 argv，-P 消失
- 健康实例的 `/proc/<pid>/cmdline` 实测为 `runsvdir /data/data/com.termux/files/usr/var/service`（**没有 -P**），而 ps 里野生态是 `runsvdir /data/.../bin/runsvdir <SVDIR>`（runsvdir 出现两次）。
- 第一版判据要求 argv 含 ` -P <SVDIR>`，于是把健康实例判成野生态：`--status` 报「监督实例数: 0、野生态: 1」，四个服务却是 run。
- 第二版判据：argv 引用本 SVDIR，且第二个 token 的基名不是 `runsvdir`。`count_supervising_runsvdir`/`count_stray_runsvdir`/`stray_pids` 三条路径统一走 `classify_runsvdir_argv`。

### 5.5 自测与变异
- `tools/ops/k40/ensure_runsvdir_selftest.sh`：28 条断言全绿（`SELFTEST_PASS ok=28`），含「source 后 main 是函数」「source 未执行任何点火/回收动作」「无 -P 形态也计入监督实例」「setsid/kill 落在 main() 内」「main 调用是最后一个代码行」「守卫在 main 调用之前」。
- 5 个变异全部变红：删 `main "$@"`、端口探活恒真、自身 pid 守卫退回三美元、只认 argv0 基名、`--reap-stray` 改词。
- 一个假绿修正：静态断言原来用 `grep -q -- '--reap-stray'`，把 `--reap-strayX` 也算命中；改成整词 `grep -q -- "'--reap-stray'"` 后变异才红。

### 5.6 10022 被占的根因：跨 SELinux 域的孤儿 proot
- 现象：`sv status ubuntu-sshd` 长期 `down`，容器日志反复 `Failed listening on '10022': Error listening: Address in use`；但 `/dev/tcp/127.0.0.1/10022` 能连、能读到 `SSH-2.0-dropbear_2022.83`，说明有个活着的 dropbear 占着端口。
- 从 ssh（app 域）`ps` 看不到它，于是先误判成「陈旧 socket」。经 `adb shell 'ps -A -o PID,PPID,ARGS'` 全量列进程才看到：`16376 proot ...`（ppid 1，孤儿）与 `16384 dropbear-static-20261027 -F -E -p 10022 ...`，是此前手工拉起容器 SSH 留下的残骸。
- `ps -AZ` 给出决定性证据：16376/16384 的 label 是 `u:r:runas_app:s0:c27,c257,c512,c768`，而 runsvdir 26563 是 `u:r:untrusted_app_27:s0:...`。
- **app 域 kill runas_app 域进程会被 SELinux 静默拒绝**：`kill -TERM 16384 16376 2>/dev/null` 返回 0 但进程不动（错误被 `2>/dev/null` 吞掉，看起来像成功）。正确通道是 `adb shell 'run-as com.termux kill -9 <pid>'`，杀完 runsv 立刻拉起新的 proot（pid 29640，ppid 26564），`sv status` 转 `run`，`ssh k40-ubuntu` 恢复。
- 判据沉淀：端口层诊断遇到「端口在听、进程看不到」，不要当成陈旧 socket，先 `adb shell ps -AZ` 看域；跨域残骸只能经 `adb run-as` 清理。同理，手工用 `run-as` 点火起的服务会落在 runas_app 域，后续维护（kill、runsv 监督）都会被域边界挡住，**手工救急只应作为临时态**。

### 5.7 CI 侧契约测试与变异（无需真机）
- 新增 `BioanalysDesktop/tests/ensure_runsvdir_contract.test.js`（6 条），全部是静态契约，Windows 上也能跑：
  - 主流程整段在 `main()` 内：`main() {` < 三个破坏性动作 < `main "$@"`，`main "$@"` 是最后一个代码行，且只出现一次；禁止退回旧的 `( return 0 … ) || exit 0` 写法。
  - 端口探活只走 `/dev/tcp`：代码里不许出现 `/proc/net/tcp`，`/dev/tcp/127.0.0.1/` 恰好两处，死人开关必须把探测与 `$PREFIX/bin/sshd` 串在一条命令链上。
  - 判据三形态：`is_duplicated_runsvdir_argv`、`supervises_svdir`、分类器三种输出；三个计数器必须复用 `classify_runsvdir_argv`，监督/野生态各自按 `= supervising`/`= stray` 判定。
  - `healthy()` 只认「单个监督实例 + 8022 在听 + 容器面在 run」，不许把野生态算进来；脚本里不许出现 `pkill` 与 `rm -rf …supervise`。
  - 自身 pid 守卫用精确的 `[ "$pid" = "$$" ]`（禁 `$$$`）；`--reap-stray` 整词比较，回收路径 TERM 后 KILL。
  - 自测脚本存在、带 `SELFTEST_PASS ok=` 计数哨兵、三个哨兵 shim、`mktemp -d` 判红文案、`PROC_DIR` 指向 fixture。
- 变异反证 8/8 全红：破坏性动作挪出 `main()`、死人开关不探端口、监督计数不走 classify、`healthy()` 改数 `count_runsvdir`、自身 pid 守卫回三美元、自测降级固定路径、野生态判据恒假、`healthy()` 里混入 `count_stray_runsvdir`。
- 两个变异手法坑：
  1. `String.replace` 的**字符串 replacement 里 `$$` 会被折叠成一个 `$`**，于是「`$$` → `$$$`」的变异实际写出了原文，脚本报 NOOP 而不是 RED。一律改用函数式 replacement。
  2. 变异必须打在断言真正覆盖的那段代码里：第一次把 `count_stray_runsvdir` 塞进了 `main()` 而不是 `healthy()`，测试自然抓不到，读起来像「断言有洞」，其实是变异没落在目标区域。
  3. 函数体切片不能用固定窗口（`+900` 字符），窗口溢出到下一个函数会把邻居代码算成自己的契约：`count_supervising_runsvdir` 的变异一度被 `count_stray_runsvdir` 里的 classify 命中而假绿。改成「`name() {` 到紧随的独占 `}` 行」。
