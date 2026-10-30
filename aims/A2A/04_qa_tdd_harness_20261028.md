# Codex（电脑）↔ Pi Agent（手机 Termux）A2A 协作工程 —— 04. 全生命周期缺陷审查、TDD 与 Test Harness 工程规范

> **文档编号与时间戳**：`04_QA与TDD_Harness全维审查计划与缺陷根治规范_20261028.md`（生成时间：`2026-10-28 16:00:00 +08:00` / 配套版本：`v1.2.1-qa-hardened`）
> **文档地位**：【1 + N×3 文档驱动工程体系】中的 **“质量保障、防崩审查与自动化验证总纲（QA & TDD Harness Charter）”**
> **适用读者**：既适合零基础开发者快速建立大厂级工程直觉（附“大白话工程词典”），又可直接作为 AI Agent 执行端（Codex / Pi）的强制自检准入规范。

---

## 第一部分：给零基础开发者的“大白话工程规范词典”（补全你可能不知道的专业概念）

你提到“**TDD 设计、Harness 设计**”，这两个词抓得非常准！在跨设备（电脑 + 手机）、跨进程（Node.js + Python + R + Shell）、跨网络（Tailscale 虚拟网）的复杂系统里，光靠“写完代码手动点一下看看报不报错”是绝对不够的。以下是为你补全的 **6 个核心工程利器**（用大白话翻译）：

| 专业术语 | 大白话解释（它到底是什么？） | 在我们这套“电脑 Codex ↔ 手机 Pi”系统里解决什么问题？ |
| :--- | :--- | :--- |
| **1. TDD（Test-Driven Development，测试驱动开发）** | **“先写验房标准，再盖房子”**。不是先把脚本写完再去试，而是**先写一段必报错的测试代码**（比如故意传一个 `/sdcard` 非法路径，断言脚本必须返回错误码 `3`），然后再去写业务代码让测试变绿（**红 $\rightarrow$ 绿 $\rightarrow$ 重构**）。 | 防止 AI Agent 写代码时“漏掉边界条件”或“自以为写对了”。每一条安全红线（D-01~D-12）都必须对应一条自动化测试断言。 |
| **2. Test Harness（测试夹具 / 自动化仿真底座）** | **“飞机风洞实验室 / 汽车碰撞假人台”**。手机可能没开机、没联网，或者跑一次真实生信分析要 40 分钟；**Harness 就是在本地电脑沙箱里造一个“虚拟手机环境”**，花 8 秒钟就能把断网、并发、假死、改模型等几十种极端情况全自动跑一遍。 | 我们专门为你构建了 `a2a_master_harness.py`：哪怕手机没连上，也能在 8 秒内模拟手机目录、模拟并发抢锁、模拟伪造 PNG、模拟 `:9911` 遥测服务并完成验收。 |
| **3. Fault Injection / Chaos Testing（故障注入 / 混沌工程）** | **“故意拔网线、故意塞坏数据、故意伪造僵尸锁”**。正常情况下能跑通不算本事，故意制造灾难（比如脚本跑一半断网、生成一张只有半截的损坏图片、或者进程被强杀留下死锁文件），看系统能不能自己恢复。 | 专门检验你的核心诉求：**“断网不重跑、坏图不放行、僵尸锁自动清理、脚本被篡改立即熔断”**。 |
| **4. Contract Testing（契约测试 / Schema 门禁）** | **“双方签字画押的快递单格式检查”**。电脑 Codex 和手机 Pi 交互的 JSON 报文、`settings.json` 配置、`18787` 页面接口，一旦某一方改了字段名（比如把 `exit_code` 写成 `code`），整个链路就会瘫痪。 | 强制校验所有 JSON 输入输出必须严丝合缝符合预定格式（Schema），少一个字段当场报错拦截。 |
| **5. Idempotency & TOCTOU Guard（幂等性与防并发竞态）** | **“电梯按钮按 1 次和狂按 10 次，电梯只来 1 趟”**。**幂等（Idempotency）**就是同一个任务发 1 次和因断网重发 5 次，结果完全一样且只真正计算 1 次；**TOCTOU** 是指两个请求在同一毫秒到达时“同时看到没锁，结果起了两个进程”的漏洞。 | 确保 40 分钟的重型任务绝对不会因为网络抖动被启动两遍，也不会把手机 8GB 内存撑爆。 |
| **6. Static Gate & Observability（静态门禁与可观测性）** | **“上路前的年检（静态门禁） + 驾驶室仪表盘（可观测性）”**。代码还没运行前，先用工具检查有没有语法错误、有没有把密钥写死在代码里；运行起来后，在 `18787` 页面能实时看到心跳、日志和账单。 | 通过 `bash -n`、`node --check`、`py_compile`、`npm run build` 提前消灭低级语法错误，通过 React `PiAgentMonitor` 消灭“黑盒盲跑”。 |

---

## 第二部分：针对当前框架的“三代问题（现存 / 潜在 / 未来）”全维深度审查清单

我们对前几轮构建的全套脚本（`pi_idempotent_runner.sh`、`pi_telemetry_sidecar.py`、`pi_agent_routes.js`、`a2a_client_poller.py`、React `PiAgentMonitor`）执行了多轮严苛的代码级 TDD 审查，**累计揪出并修复 21 个极其隐蔽的“现存代码漏洞”**，同时梳理出 **6 个运行期潜在隐患** 与 **4 个未来演进瓶颈**：

### 2.1 【第一层：现存漏洞审查】多轮审查中揪出并修复的 21 个真实 Bug

| 漏洞编号 | 所在文件与位置 | 漏洞现象与触发机理（为什么之前没发现？） | v1.2.0 根治方案（已写入最新代码并通过 Harness 验证） |
| :--- | :--- | :--- | :--- |
| **`BUG-01`<br>输入数据漂移盲区<br>(Input Drift)** | `pi_idempotent_runner.sh`<br>检查 `.done` 逻辑 | **致命逻辑漏口**：旧版只检查了“脚本文件的 SHA256 没变”且“输出文件存在”，就直接复用 `.done` 跳过执行！如果脚本一行没改，但**上游输入数据表（如 `expr_genes.tsv`）换成了新病人的数据**，旧版会直接返回旧病人的缓存结果！ | 新增 `--inputs "a.tsv,b.tsv"` 参数与 `compute_inputs_sha256()` 函数：将所有输入文件的 SHA256 合并计算为 `inputs_sha256` 写入 `.done`。**只要脚本或任一输入数据发生 1 字节变化，立即自动失效缓存重新计算**（见 `HARNESS-02`）。 |
| **`BUG-02`<br>Android PID 回绕复用导致假死锁** | `pi_idempotent_runner.sh`<br>检查 `.lock` 逻辑 | **移动端特有坑位**：旧版仅靠 `kill -0 $OLD_PID` 判断锁内进程是否存活。在 Android/Linux 上 PID 最大默认 32768 会循环复用；若上次手机断电重启残留了 `.lock`（比如 `PID=4120`），重启后恰好另一个系统进程分到了 `4120`，脚本就会**永远卡死等待一个毫不相干的进程**！ | 新增 `is_lock_pid_valid()` 函数：不仅检查 `kill -0 $PID`，还读取 `/proc/$PID/cmdline` 核对该进程的命令行是否真的包含当前脚本名；若不匹配，判定为“僵尸锁/PID 复用”，立即自动清理并抢锁运行（见 `HARNESS-03`）。 |
| **`BUG-03`<br>毫秒级并发抢锁竞态 (TOCTOU)** | `pi_idempotent_runner.sh`<br>创建 `.lock` 逻辑 | **并发踩踏漏洞**：旧版先用 `if [[ -f "$LOCK_FILE" ]]` 判断，再后台启动进程写锁。若网络抖动导致两个请求在 10 毫秒内先后到达，两者都会看到“没锁”，从而**同时启动两个 R/Python 大任务撑爆手机内存**！ | 废除普通文件判断，改用操作系统内核级原子的 **`mkdir "$LOCK_DIR"`（目录创建在 POSIX 下绝对原子）**，抢锁成功者跑任务 (`fresh_run`)，后到者自动挂载等待 (`attached_running_lock`)（见 `HARNESS-04`）。 |
| **`BUG-04`<br>半截/损坏 PNG 图片蒙混过关** | `pi_idempotent_runner.sh`<br>`verify_outputs` | **假成功漏检**：旧版只用 `[[ -s "$out_f" ]]` 检查文件大小 $>0$。如果 R 绘图时因字体缺失或内存不足崩溃，生成了一个 2KB 的报错残片文件，大小也 $>0$，旧版会误判成功并写入 `.done`！ | 升级为 `verify_outputs_integrity()`：凡是 `.png` 后缀产物，强制用 `od -An -tx1 -N4` 校验文件头前 4 字节魔数必须严格等于 `89504e47`（`\x89PNG`），否则强制判为失败（退出码 `6`）且严禁生成 `.done`（见 `HARNESS-05`）。 |
| **`BUG-05`<br>脚本被异常篡改后仍写 `.done`** | `pi_idempotent_runner.sh`<br>执行后置检查 | **Strict Runner 铁律防线**：万一脚本内部带有自修改逻辑，或 Pi Agent 强行 `chmod u+w` 篡改了预构建脚本，必须防止脏结果污染检查点。 | 在脚本执行前后分别计算 `SCRIPT_SHA256` 与 `POST_SCRIPT_SHA256`；一旦发现不一致，立即阻断写入 `.done` 并以退出码 `5` 返回 `ERR_SCRIPT_MUTATED_DURING_RUN`（见 `HARNESS-06`）。 |
| **`BUG-06`<br>执行中断退出未清理锁目录** | `pi_idempotent_runner.sh`<br>信号捕获 | **异常退出残留**：若包装器自身收到 `SIGTERM`/`SIGINT` 中断，锁目录可能残留在磁盘上。 | 注册 `trap cleanup_lock EXIT` 钩子，确保无论正常结束还是异常退出，本进程持有的锁目录 `100%` 自动释放。 |
| **`BUG-07`<br>A2A 脱敏误伤 task_id** | `@bacnh85/pi-a2a 0.8.0`<br>`extensions/lib/security.ts` | 上游正则 `/sk-[A-Za-z0-9_-]{16,}/` 会匹配 `task-live-...` 中间的 `sk-live-...`，把合法任务号改写成 `task-[redacted]`，导致 Artifact 对账字段失真。 | 使用 `ops/patch_pi_a2a_security.sh --apply` 将正则改为只匹配非字母数字边界后的 `sk-` token。补丁支持 `--check`，升级扩展后必须重新检查并在需要时重新应用。 |
| **`BUG-08`<br>skip 被门禁误判为 PASS** | `ops/a2a_preflight.ps1`<br>`Test-PythonSuite` | Windows 本机没有 `bash` 时，安全补丁单测输出 `OK (skipped=2)`，旧解析器只检查 `OK`，把两条未执行测试计成 `2/2 PASS`。 | 解析 `skipped=N`，关键测试默认要求 `N=0`。Pi A2A 安全补丁测试改在 `k40-ubuntu` Linux 计算面实跑，门禁详情必须同时记录 `ran`、`skipped` 与执行主机。 |
| **`BUG-09`<br>正常 live skip 被门禁误判为 FAIL** | `ops/a2a_preflight.ps1`<br>`a2a-e2e-contract-tests` | 契约模式曾把 `LivePhoneTests` 类级 skip 按失败处理。 | 契约模式门禁按实际类级计数，允许 1 个 live 类 skip；真实 live 验收使用 `--mode live`，当前 12/12 PASS。 |
| **`BUG-10`<br>隐藏父目录触发静默空部署** | `ops/deploy-k40-termux.sh`<br>`for source_file in "$SOURCE"/**/*` | 旧逻辑用绝对源路径匹配 `*/.*`，当暂存目录位于 `.cache/` 时，所有正常文件都被当作隐藏文件跳过，输出 `DEPLOY_OK copied=0`，手机仍运行旧 runner。 | 先计算 `relative`，再按相对路径排除 `README.md` 与隐藏路径；`tests/test_deploy_k40_termux.sh` 新增 hidden-parent 红灯用例，当前 12/12 PASS。 |
| **`BUG-11`<br>Artifact 产物路径绝对与相对契约不一致** | `ops/pi_idempotent_runner.sh`<br>`CHANGED_JSON` | Runner 返回绝对 `changed_files[].path`，校验器要求路径相对 `workspace_dir`，导致 live test_03 在幂等产物上失败。 | Runner 输出去除 `$REAL_PROJ/` 前缀的相对路径，新增 `changed_path_relative` 探针；live 回归 12/12 PASS。 |
| **`BUG-12`<br>Artifact 输入漂移字段缺失** | `artifact_validator.py`<br>`REQUIRED_FIELDS` | 校验器未要求 `inputs_sha256`，RPC 文本提取器还会把缺失时间戳补成当前时间、把缺失耗时补成 0，导致输入漂移和元数据缺失可能被错误放行。 | `inputs_sha256` 改为必填，只接受 `no_inputs_declared` 或小写 64 位 SHA256；RPC 提取器要求完整 Step ID、幂等状态、脚本哈希、输入哈希、耗时和日志路径，缺失即拒绝；Artifact 测试 15/15 PASS。 |
| **`BUG-13`<br>二进制 CR/NUL 被误判 CRLF 且权限错误** | `ops/deploy-k40-termux.sh`<br>CRLF 检测与 chmod | 合法 PNG 含有 CR/NUL 字节时会被文本 CRLF 门禁拒绝；同时所有非 README 文件曾被设为 755，TSV、PNG 获得错误可执行位。 | 先按已知二进制扩展和 NUL 扫描识别二进制，二进制保留原始字节并跳过文本 CRLF 转换，统一设 644；脚本与 shebang 文件设 755；部署器 12/12 PASS。 |
| **`BUG-14`<br>固定测试项目复用旧 `.done` 造成假通过** | `tests/test_e2e_a2a_pipeline.py`<br>`IdempotentRunnerTests` | live 测试复用持久项目，并接受第一次运行结果为 `fresh_run` 或 `reused_done_checkpoint`，旧检查点可能让测试在没有真实执行时通过。 | 使用独立项目 `a2a_e2e_probe`，每次 setUp 重置项目，首次结果强制断言 `fresh_run`，随后再断言 `reused_done_checkpoint` 和 Artifact 合法。 |
| **`BUG-15`<br>AIMS 内 Harness 根路径层级错误** | `aims/A2A/a2a_master_harness.py`<br>`REPO_ROOT` | 副本使用 `parents[1]` 时解析到 `aims/`，导致该文件无法按 AIMS 声明独立运行，双份 Harness 的一致性未被真实验证。 | 改为 `parents[2]`，在 Termux 分别执行两份 Harness，当前均为 7/7 PASS。 |
| **`BUG-16`<br>Artifact workspace 路径穿越** | `artifact_validator.py`<br>`_validate_workspace` | `PurePosixPath` 保留 `..`，旧逻辑只做字符串前缀判断，`workspace_dir` 含 `..` 时可绕过声明根；下游按该伪根拼接相对产物路径会落到工作区外。 | 显式拒绝 `workspace_dir` parts 中的 `..`，新增 `workspace_traversal` 红灯用例；Artifact 测试当前 `15/15 PASS`。 |
| **`BUG-17`<br>runner 信号生命周期缺口** | `pi_idempotent_runner.sh`<br>TERM 与 SIGKILL 路径 | TERM 只退出 runner 时 child 仍可能运行；runner 被 SIGKILL 后，下一次调用只看到旧 PID 已死便重跑，可能造成双进程和重复计算。 | 子任务用 `setsid` 独立进程组启动；TERM、INT、HUP 整组回收 child；`owner.json` 记录 `child_pid/child_pgid`，新调用等待仍存活 child，并在产物有效时恢复 `.done`。生产探针覆盖 `term_reaps_child`、`term_releases_lock`、`sigkill_runner_attaches_child` 与 `sigkill_runner_single_execution`。 |
| **`BUG-18`<br>尾部 NUL 二进制误判** | `deploy-k40-termux.sh`<br>`has_nul_byte` | 旧逻辑只扫描前 8192 字节，NUL 首现在窗口之后的二进制会被当文本，可能触发误导性 CRLF 拒绝。 | 改为全文件 NUL 扫描，新增 `tail_nul_binary_preserved` 夹具；部署器测试当前 `12/12 PASS`。 |
| **`BUG-19`<br>ASCII 线缆体积低估** | `artifact_validator.py`<br>`_validate_json_size` | 旧门禁按 `ensure_ascii=False` 计算体积，非 ASCII JSON-RPC 转义后的真实线缆可能更大，4 MB 上限可被低估。 | 改用 `ensure_ascii=True` 的最坏线缆形态计算，新增超大非 BMP 字符红灯用例。 |
| **`BUG-20`<br>UTF-8 摘要截断** | `pi_idempotent_runner.sh`<br>`stdout_summary` | `cut -c` 按字节截断，CJK 日志可能切在多字节字符中间，产生非法 UTF-8 JSON。 | 改为 `jq -Rsr '.[0:320]'` 按字符切片，新增 `utf8_summary_length=320` 生产探针。 |
| **`BUG-21`<br>PNG 只有魔数头校验** | `pi_idempotent_runner.sh`<br>`verify_outputs_integrity` | 仅校验 `89504e47` 头时，保留合法头但被截断的 PNG 仍会被当成功产物。 | 同时校验 PNG 头与 IEND 尾 `0000000049454e44ae426082`，截断 PNG 返回退出码 `6` 且不写 `.done`。 |

---

### 2.2 【第二层：潜在运行期隐患审查】平时不报错、一上强度就出事的 6 大隐患与对策

| 隐患编号 | 潜在问题场景 | 触发条件与危害 | 规范化防御对策（已纳入工程规范） |
| :--- | :--- | :--- | :--- |
| **`RISK-01`<br>孙子进程孤儿残留（Process Group Leak）** | 当电脑端调用 `CancelTask` 取消一个超时任务时，Pi 杀掉了外层 bash，但 bash 启动的底层 `Rscript` 或多进程 `python` 变成了孤儿进程继续吃满 CPU 和 4GB 内存。 | R 的 `future`/`parallel` 或 Python `multiprocessing` 会派生子进程树，单杀父 PID 杀不掉孙子进程。 | **进程组连坐清理（PGID Kill）**：启动脚本时记录进程组 ID，收到取消信号或超时信号时，使用 `kill -TERM -- -${PGID}` 连根清理整个进程树。 |
| **`RISK-02`<br>磁盘与日志慢性撑爆（Disk Exhaustion）** | 跑完几十个生信项目后，`system_logs/*.log`、`~/.pi/agent/transcripts/*.jsonl` 和中间 `.tsv` 把手机仅剩的几十 GB 空间塞满，导致所有任务报 `ENOSPC (No space left on device)`。 | 手机存储空间远小于服务器，且生信单细胞 `.h5ad` 动辄数 GB。 | **双阈值磁盘守卫**：① 在 `pi_telemetry_sidecar.py` 中实时监控可用磁盘，低于 `5 GiB` 时在 `18787` 顶部状态卡亮红灯告警；② 单步 `.log` 超过 `50 MB` 自动截断保留首尾。 |
| **`RISK-03`<br>Token 费用失控黑洞（Runaway Agent Loop）** | Pi Agent 在执行某任务时遇到奇怪报错，陷入“死循环不断重试调用工具”，一晚上跑掉几十美元 API 费用。 | 未限制单次 A2A Task 内部的最大工具调用轮数（Max Turns）与单任务费用上限。 | **单任务熔断器**：在 Pi 侧配置与 `18787` 监控台设定单次 Task 最大工具调用次数 $\le 15$ 次（正常跑 `pi_idempotent_runner.sh` 仅需 1~2 次工具调用），超出立即中止报警。 |
| **`RISK-04`<br>双端时钟漂移（Clock Skew）** | 手机长时间未同步 NTP 时间，与电脑时钟相差几分钟或跨时区（如 `-04:00` vs `+08:00`），导致 `18787` 页面计算任务耗时出现负数或日志顺序错乱。 | 跨设备时间戳直接做字符串比较或未带时区偏移。 | **全链路 ISO 8601 带时区 + 单调时钟计时**：所有耗时计算（`duration_sec`）一律在执行端本机使用单调递增时间戳差值（`END_TS - START_TS`）计算，绝不跨机器相减时间戳。 |
| **`RISK-05`<br>Tailscale IP 变更或 DERP 中继降级** | 手机切换 Wi-Fi 与 5G 移动网络瞬间，P2P 直连降级为 DERP 中继，延迟从 `18ms` 跳到 `400ms` 甚至短暂断流 5 秒。 | 若客户端连接超时设得太死（如 `< 2s`）且无重试，会误判节点离线。 | **连接韧性窗口**：`A2AClientPoller` 在 `GetTask` 轮询期间捕获单次网络超时异常不中断，按 `5s -> 10s -> 20s -> 30s` 指数退避自动重连。 |
| **`RISK-06`<br>`settings.json` 并发写入损坏** | 用户在 `18787` 网页连点两次“切换模型”，而 Pi 自身也在读写 `settings.json`，导致 JSON 文件写出一半被截断变空。 | 直接 `open(SETTINGS_PATH, 'w')` 覆盖写是非原子的。 | **POSIX 原子替换写盘**：先写入同目录临时文件 `settings.json.tmp` 并校验 JSON 合法，再调用 `os.replace(tmp, SETTINGS_PATH)` 原子替换（已在 `pi_telemetry_sidecar.py` 中实现）。 |

---

### 2.3 【第三层：未来演进风险审查】当业务扩大 10 倍时会遇到的 4 个架构演进问题

1. **多项目/多分析线同时派单的排队饥饿问题（Task Queue Starvation）**：
   * **现状**：手机端 `maxConcurrent: 2`，若同时派发 2 个 40 分钟的 Line 2 单细胞虚拟敲除任务，后续 5 秒就能跑完的 Line 1 画图任务会被堵死 40 分钟。
   * **演进方案**：在 `18787` 编排侧区分 **快车道（Fast Lane，预估 $< 60\text{s}$ 的出图/探针任务，占用槽位 1）** 与 **重型车道（Heavy Lane，耗时 $> 60\text{s}$ 的计算任务，占用槽位 2）**，保证快任务永远有 1 个并发槽可用。
2. **多台手机/算力节点横向扩展（Multi-Worker Pool）**：
   * **演进方案**：当你未来有第 2 台、第 3 台闲置安卓手机（如多台 K40）时，`18787` 的 `pi_agent_routes.js` 只需将单机 `PI_TAILSCALE_IP` 升级为节点池数组 `PI_WORKER_POOL`，按各节点 `:9911/api/telemetry/overview` 返回的 `active_calls` 与内存余量自动负载均衡派单。
3. **A2A 协议版本与扩展升级漂移（Protocol Version Pinning）**：
   * **演进方案**：在 `pi_termux_bootstrap.sh` 与 `uv tool install` 中锁定 `@bacnh85/pi-a2a` 与 `codex-a2a` 的精确版本号，升级前必须先跑一遍 `a2a_master_harness.py` 全绿才允许上生产。
4. **对等密钥定期无感轮换（Zero-Downtime Token Rotation）**：
   * **演进方案**：支持在 `peerTokens` 中短暂并存主备两个键（`codex_primary`、`codex_next`），实现不停机更换高熵 Token。

---

## 第三部分：标准 TDD + Test Harness 四步开发与审查工作流（以后改任何功能都照此执行）

为了让哪怕完全没接触过软件工程的同学也能像资深架构师一样稳健迭代，我们将所有后续开发与 Bug 修复浓缩为 **“四步傻瓜式闭环（Red $\rightarrow$ Green $\rightarrow$ Fault Inject $\rightarrow$ Gate）”**：

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ 第 1 步：写红灯测试 (RED)                                                     │
│  - 在 `tests/a2a_master_harness.py` 中先写一个模拟故障的测试函数              │
│  - 例如：故意往脚本输入表追加一行新数据，断言 `.done` 缓存必须失效            │
│  - 运行 `python3 tests/a2a_master_harness.py`，确认它如预期报错 (FAIL)        │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 第 2 步：写最小修复代码 (GREEN)                                               │
│  - 修改对应的脚本或服务（如在 `pi_idempotent_runner.sh` 加入 `inputs_sha256`）│
│  - 再次运行 `python3 tests/a2a_master_harness.py`，确认报错消失 (OK)          │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 第 3 步：跑混沌故障注入套件 (FAULT INJECTION)                                 │
│  - 自动连跑 7 大破坏性测试：塞 `/sdcard`、塞假 PID、双线程抢锁、塞假 PNG、    │
│    运行中篡改脚本、发错误 Bearer Token、热切换模型                            │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 第 4 步：过静态门禁与台账归档 (STATIC GATE & LEDGER)                          │
│  - 执行一键门禁命令（检查 Shell/JS/Python/HTML 语法零错误）                   │
│  - 将本次修复记录追加至 `con_hf/ledger/fixes.jsonl`                          │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 一键全量静态门禁 + TDD Harness 审查命令（可直接复制运行）

```bash
# 1. Shell 脚本静态语法检查
bash -n ops/pi_idempotent_runner.sh

# 2. Node.js 18787 路由 ESM 语法检查
node --input-type=module --check < BioanalysDesktop/server/pi_agent_routes.js

# 3. Python 遥测服务与客户端字节码编译检查
python3 -m py_compile ops/pi_telemetry_sidecar.py tests/a2a_master_harness.py

# 4. 18787 React 监控台构建与路由契约检查
cd BioanalysDesktop && npm run build
node --test --test-concurrency=1 tests/pi_agent_routes.test.js

# 5. 运行全自动 TDD & 故障注入测试底座 (7 大场景全自动验证)
python3 tests/a2a_master_harness.py
```

---

## 第四部分：全工程上线前 24 项黄金审查核对表（Pre-Flight Audit Checklist）

每次准备跑正式生信项目或升级双端配置前，只需按此表逐项打勾（全部为 `[x]` 即代表系统处于 100% 生产就绪态）：

- [x] **1. 路径隔离检查（G5/D-08）**：`HARNESS-01` 已验证 `/sdcard` 与 `/storage/emulated` 路径被 `ERR_PATH_GUARD` 100% 拦截。
- [x] **2. 幂等秒级复用检查（G8/D-11）**：`HARNESS-02` 已验证脚本与输入未变时，二次调用直接命中 `reused_done_checkpoint`，零重复计算。
- [x] **3. 输入数据漂移感知检查（BUG-01）**：`HARNESS-02` 已验证当 `--inputs` 数据表发生改动时，旧 `.done` 自动失效并触发重算。
- [x] **4. 僵尸锁与 PID 复用防死锁检查（BUG-02）**：`HARNESS-03` 已验证 `/proc/$PID/cmdline` 校验生效，不会因 Android PID 复用而永久挂死。
- [x] **5. 毫秒级并发抢锁防踩踏检查（BUG-03）**：`HARNESS-04` 已验证 `mkdir .lock.d` 原子互斥锁生效，并发请求仅执行 1 次底层脚本。
- [x] **6. 损坏 PNG 图像头尾拦截检查（BUG-04/BUG-21）**：`HARNESS-05` 已验证非 `89504e47` 开头或缺少 IEND 尾的损坏/截断 PNG 被拦截，绝不污染 `.done`。
- [x] **7. Strict Runner 母版防篡改检查（BUG-05）**：`HARNESS-06` 已验证执行期间若预构建脚本被修改，立即触发退出码 `5`（`ERR_SCRIPT_MUTATED_DURING_RUN`）。
- [x] **8. 零信任 Token 与 `:9911` 鉴权检查（G1/D-03）**：`HARNESS-07` 已验证无 Token 或错误 Token 请求 `:9910` / `:9911` 100% 返回 `401`。
- [x] **9. `18787` 模型白名单热切换原子性检查（G9/D-12）**：`HARNESS-07` 已验证 `POST /api/telemetry/model` 原子替换 `settings.json` 且拦截非白名单模型。
- [x] **10. 本地 `7890` 代理豁免检查（G4/D-07）**：`pi_agent_routes.js`（`agent: false`）与 Python 客户端（`ProxyHandler({})` + `NO_PROXY`）均已强制绕过系统代理。
- [x] **11. Android 保活五件套检查（G2/D-05）**：手机端 `termux-wake-lock` 持有、电池“无限制”、保持插电、`tmux` 双窗口（`a2a-server` + `telemetry`）存活、Android 12+ Phantom Process 已豁免；2026-10-29 已用 ADB 独立取证四项状态。
- [x] **12. 前端工作台零死按钮/零阻塞弹窗检查（DOD-OBS-04）**：当前 React 监控页通过前端构建与静态检查，四联视图、模型切换与派发入口按运行时实测结果登记。
- [x] **13. Pi A2A 脱敏补丁检查（BUG-07）**：`ops/patch_pi_a2a_security.sh --check` 在手机端返回 `PI_A2A_SECURITY_PATCH=applied`，且 `task-live-...` 不再被误改写。
- [x] **14. 测试跳过可见检查（BUG-08/BUG-09）**：关键 Python 测试默认要求 `skipped=0`；A2A 契约套件只允许 1 个 `LivePhoneTests` 类 skip，真实 live 套件另行以 `--mode live` 跑到 12/12 PASS。
- [x] **15. 部署空拷贝检查（BUG-10）**：部署器按相对路径判断隐藏文件，隐藏父目录测试与 CRLF、dry-run、可执行位测试全部通过。
- [x] **16. Artifact 相对路径检查（BUG-11）**：runner 产物路径必须相对 `workspace_dir`，live test_03 与 `changed_path_relative` 探针通过。
- [x] **17. Artifact workspace 穿越检查（BUG-16）**：`workspace_dir` 含 `..` 时返回 `ERR_ARTIFACT_WORKSPACE_OUTSIDE_ROOT`，不再以伪根通过校验。
- [x] **18. runner 信号生命周期检查（BUG-17）**：TERM 会回收整个 child 进程组；runner 被 SIGKILL 后新调用接管存活 child，`sigkill_runner_single_execution=1`。
- [x] **19. 尾部 NUL 二进制检查（BUG-18）**：部署器全文件扫描 NUL，`tail_nul_binary_preserved` 通过且二进制保持 644。
- [x] **20. JSON-RPC ASCII 线缆体积检查（BUG-19）**：4 MB 门禁按 `ensure_ascii=True` 计算，超大非 BMP 摘要被拒绝。
- [x] **21. UTF-8 日志摘要检查（BUG-20）**：中文长日志摘要按字符截断为 320 字符，JSON 可被 `jq` 与 Python 严格解码。
- [x] **22. PNG IEND 完整性检查（BUG-21）**：合法头尾 PNG 通过，截断 PNG 返回退出码 `6` 且不生成 `.done`。
- [x] **23. Pi 初验不得替代 Codex 终验**：`HARNESS-08` 注入“Pi 报告 passed=true 但产物哈希不一致”，Codex 终验必须拒绝，任务保持未完成。证据：`tests/test_a2a_poller_state.py` 的重复终验用例与 `tests/test_a2a_acceptance_live.py` 真机用例均 PASS。
- [x] **24. Pi 运行时路径可见性检查**：`HARNESS-09` 注入容器专属路径与 Termux 路径不一致，任务单必须在派发前拒绝或改用可见包装脚本，避免 Pi 进入无效搜索循环。证据：`test_dispatch_rejects_container_only_path_before_send` 在派发前返回 `A2A_TASK_PATH_NOT_VISIBLE`，live 任务使用 Termux 可见工作区完成。
- [x] **25. A2A 终态归一化检查（D-06）**：Pi 返回的 `TASK_STATE_COMPLETED/FAILED/CANCELED/REJECTED` 必须先归一化为小写终态，同时保留 `remote_state`。前端与路由不得直接比较大小写敏感的原生枚举。证据：`tests/a2a_state.test.js`、`tests/pi_agent_routes.test.js`，真实 completed 与 canceled 任务均可通过 `GetTask` 读回。

### 双层验收专项门禁

- Pi 的 `preliminary_acceptance` 只证明执行端完成了自检，最终完成态由 Codex 的 `final_acceptance` 决定。
- Codex 终验必须独立核对 `exit_code`、`script_sha256`、`inputs_sha256`、`changed_files`、产物存在性、验收命令结果和修改范围。
- 任务单必须声明 `workspace_dir`、`inputs`、`outputs`、`acceptance_commands`、`max_tool_calls` 和 `timeout_sec`。
- 自由对话只用于澄清和失败诊断，正式验收以 A2A Artifact 与确定性检查结果为准。
