# Codex（电脑）↔ Pi Agent（手机 Termux）A2A 协作工程 —— 01. 各模块 `aims-总目标`（What & Why 阶段性业务契约）全集（全量升级版 v1.1.0）

> **文档编号与时间戳**：`01_aims_Codex-Pi-A2A协作工程_20261028.md`（生成时间：`2026-10-28 15:00:00 +08:00`）
> **文档角色**：【1 + N×3 体系】中的 **`[模块名]-aims-总目标-20261028.txt` 汇总卷**（定义每个模块的业务定位、负面清单、三阶段目标、边界规格 Specs & Edge Cases、完成定义 DoD 与验收台账）
> **覆盖范围**：1 个微内核底座模块（`mod-core-engines`）+ 5 个可插拔业务模块（`mod-a2a-pi-server`、`mod-a2a-codex-client`、`mod-a2a-network-keepalive`、`mod-a2a-artifact-audit`、`mod-pi-observability`）

---

## 模块零：`mod-core-engines-aims-总目标-20261028.txt`（微内核底座、四大共享引擎与全局台账治理）

### 1. 模块定位（What & Why）
构建对上层业务任务“完全无知”的微内核宿主底座（`src/core/`）与四大共享能力引擎（`a2a-rpc-engine`、`transport-keepalive-engine`、`artifact-sync-engine`、`security-audit-engine`），统一管理双平面路径守卫（`PathGuard`）、`SPEC_DECISIONS.md`（D-01~D-12）裁定录以及双层五类追加式 JSONL 台账（攻克缺口 G5、G7）。

### 2. 负面清单（Anti-Goals）
* 严禁在 `src/core/` 或 `src/engines/` 中硬编码具体的手机 IP 地址或明文 Bearer Token。
* 严禁允许任何指向 `/sdcard`、`/storage/emulated` 或包含 `..` 路径穿越的工作区路径通过 `PathGuard` 校验。
* 严禁将人工/Agent 工程台账（`con_hf/ledger/*.jsonl`）与 Pi 运行时子会话日志（`~/.pi/agent/transcripts/`）混写在同一目录。

### 3. 三阶段业务目标与边界规格（Specs & Edge Cases）
* **阶段Ⅰ（基础落地）**：锁定 `00.最高技术纲领-20261028.txt` 与 `con_hf/SPEC_DECISIONS.md`（D-01~D-12）；完成双平面工作区目录骨架初始化与 `.gitignore` 密钥防泄漏守卫。
* **阶段Ⅱ（相关配套）**：实现 `PathGuard` 合法根校验器、`security-audit-engine` 的配置文件静态扫描器（拦截无 Token 的 `0.0.0.0` 绑定与弱 Token），以及 `ops/ledger_indexer.py` 台账聚合校验工具。
* **阶段Ⅲ（功能实现）**：实现 `ModLoader` 与 `SlotManager` 对全部 5 个业务模块 `manifest.ts` 的动态挂载与健康自检汇总，生成全平台环境自检报告。

### 4. 完成定义（DoD）与验收台账
| 验收项编号 | 验收判据（DoD） | 边界条件与异常判据 | 目标状态 |
| :--- | :--- | :--- | :--- |
| `DOD-CORE-01` | `con_hf/SPEC_DECISIONS.md` 完整收录 D-01 ~ D-12 且被索引器识别 | 缺失任一裁定编号即判 FAIL | **PASS** |
| `DOD-CORE-02` | `PathGuard` 100% 拦截 `/sdcard/project`、`../outside` 等非法路径 | 单元测试覆盖 12 种越界路径注入全部抛出 `ERR_PATH_GUARD` | **PASS** |
| `DOD-CORE-03` | Git 仓库工作树零明文 Token 泄露扫描（`security-audit-engine`） | 扫描全部受控文件，若匹配 `a2a_sec_` 真实密钥在非 `.env` 文件中立即判 FAIL | **PASS** |
| `DOD-CORE-04` | `ops/ledger_indexer.py --verify` 校验五类 `.jsonl` 格式与时间戳合法 | 空行、非法 JSON 或缺失 ISO 8601 时间戳即判 FAIL | **PASS** |

---

## 模块一：`mod-a2a-pi-server-aims-总目标-20261028.txt`（手机 Termux Pi Agent A2A 执行端 + 幂等防重跑执行器卡带）

### 1. 模块定位（What & Why）
在手机 Android Termux 环境中部署、加固并运行 Pi Coding Agent 与 `@bacnh85/pi-a2a` 扩展（`:9910`），配合本地幂等防重跑执行包装器（`ops/pi_idempotent_runner.sh`），使手机成为一个 **符合 A2A v1.0 标准、具备强 Token 认证、遵循“Strict Runner（只跑已构建脚本、不乱改源码）”约束、且在网络断链时具备 `.lock`/`.done` 断点防重跑能力的自治执行节点**（彻底攻克缺口 G1、G5、G8）。

### 2. 负面清单（Anti-Goals）
* 严禁在未配置 `server.peerTokens` 或 `allowAllUsers: true` 的情况下将 `server.host` 设为 `0.0.0.0`（禁区 1）。
* 严禁在安装 `@earendil-works/pi-coding-agent` 时省略 `--ignore-scripts` 参数。
* 严禁将 `maxConcurrent` 设置为 $> 2$（防止移动端内存溢出触发 Android LMKD 杀进程）。
* **严禁 Pi Agent 擅自修改电脑端同步过来的预构建 `.R`/`.py` 脚本源码（禁区 7 / D-11）**。
* **严禁绕过 `pi_idempotent_runner.sh` 直接裸跑长耗时脚本，严禁将成千上万行原始控制台 stdout 直接塞入 Pi Agent 的 LLM 上下文**。

### 3. 三阶段业务目标与边界规格（Specs & Edge Cases）
* **阶段Ⅰ（基础落地）**：
  1. 在 Termux 中安装 `nodejs`、`git`、`python`、`jq`、`tmux`、`termux-api`、`procps`；
  2. 执行 `npm install -g --ignore-scripts @earendil-works/pi-coding-agent` 与 `pi install npm:@bacnh85/pi-a2a`；
  3. 在默认 `127.0.0.1:9910` 下启动 `/a2a-server start`，本机 `curl http://127.0.0.1:9910/.well-known/agent-card.json` 返回合法 A2A v1.0 Agent Card JSON。
* **阶段Ⅱ（相关配套）**：
  1. 在 `~/.pi/agent/settings.json` 中写入完整 `a2a` 配置节与默认模型配置（`defaultProvider`、`defaultModel`、`thinkingLevel`、`peerTokens.codex`、`maxConcurrent: 2`、`replyTimeoutSec: 300`、`childTranscripts: true`）；
  2. 部署 **`ops/pi_idempotent_runner.sh`（幂等防重跑执行包装器）**：
     * 执行前计算脚本 SHA256 与输入联合 SHA256（无输入时记录 `no_inputs_declared`），并将预构建脚本锁定为只读；
     * 检查 `.step_<id>.done`：仅当脚本哈希、输入哈希、产物路径和产物 SHA256 全部匹配时才复用，目标在 `0.5s` 内输出 `idempotent_status: "reused_done_checkpoint"`；
     * 检查 `.step_<id>.lock.d/owner.json`：同时核对 runner PID 与 child PID/PGID，并通过 `/proc/<pid>/cmdline` 防止 PID 复用误判。任务运行中收到断链重发时挂载等待，输出 `idempotent_status: "attached_running_lock"`；
     * 子任务通过 `setsid` 独立进程组运行，TERM、INT、HUP 回收整个进程组；runner 被 SIGKILL 后，新调用接管仍存活的 child，并在产物有效时恢复 `.done`；
     * 将全量 stdout/stderr 重定向至 `system_logs/<step_id>.log`，仅将最后 12 行压平并按 UTF-8 字符截取 320 字符的 JSON 摘要。
* **阶段Ⅲ（功能实现）**：
  1. 响应来自电脑 Codex 的 JSON-RPC 2.0 `SendMessage` 请求，调用 `pi_idempotent_runner.sh` 跑通预构建脚本，生成 `.done` 检查点并将结构化 `Artifact` 回传；
  2. 模拟网络中断后 Codex 重复发送同一 `SendMessage` 或调用 `GetTask`，验证手机端命中 `.lock`/`.done` 实现 **100% 零重跑**。

### 4. 完成定义（DoD）与验收台账
| 验收项编号 | 验收判据（DoD） | 边界条件与异常判据 | 目标状态 |
| :--- | :--- | :--- | :--- |
| `DOD-PI-01` | 本地与跨网 `GET /.well-known/agent-card.json` 返回 HTTP 200 且包含完整能力清单 | 缺失字段或返回非 200 状态码判 FAIL | **PASS（当前跨端路径为 ADB forward；Tailscale 跨网验收仍由 DOD-NET-01 单独管理）** |
| `DOD-PI-02` | 鉴权铁闸测试：无 Header、空 Bearer、错误 Token 请求 `POST /` 100% 返回 401/403 | 任何未授权请求进入 `working` 状态即判 FAIL | **PASS（live test_07，错误 Token 返回 401/403）** |
| `DOD-PI-03` | 幂等防重跑验证（攻克 G8）：同一 `step_id` 连续触发两次，第二次耗时 $< 0.5\text{s}$ 且返回 `reused_done_checkpoint` | 第二次重新执行底层耗时脚本判 FAIL | **PASS** |
| `DOD-PI-04` | 并发锁挂载验证（攻克 G8）：任务运行中模拟断链重发，第二个请求自动挂载等待原 runner/child 而非新建子进程 | 出现两个相同脚本 PID 同时运行判 FAIL | **PASS** |
| `DOD-PI-05` | Strict Runner 只读与日志削峰验证：预构建脚本 SHA256 零变化，完整日志落盘且回传 JSON 摘要 $< 4\text{KB}$，`stdout_summary` 不超过 320 个 UTF-8 字符 | 脚本被篡改、摘要非法 UTF-8 或全量日志塞爆上下文判 FAIL | **PASS** |
| `DOD-PI-06` | Pi 初步验收报告：任务结束时回传 `preliminary_acceptance`，包含 `passed`、`exit_code`、`script_sha256`、`inputs_sha256`、`changed_files`、`log_file` 和逐项检查结果 | 缺少结构化字段，或只返回自然语言“已完成”判 FAIL | **ADOPTED（待下一轮真实任务证据）** |

---

## 模块二：`mod-a2a-codex-client-aims-总目标-20261028.txt`（电脑 Codex `codex-a2a` 传算分离编排与出站调用卡带）

### 1. 模块定位（What & Why）
在本地电脑上通过 `codex-a2a` 为 Codex CLI/Agent 注入符合 A2A v1.0 规范的 **出站任务委派能力（`a2a_call` 工具与 `codex-a2a call` CLI）**，配合电脑端确定性文件同步脚本，形成 **“电脑写代码/传文件 ──► 派发 A2A 任务单 ──► 手机 Pi 自治运行构建内容 ──► 电脑验收 Artifact”** 的完整闭环（攻克缺口 G4、G6、G8）。

### 2. 负面清单（Anti-Goals）
* 严禁将电脑侧 `A2A_HOST` 设为 `0.0.0.0`（电脑侧入站面仅允许绑定 `127.0.0.1:8000`）。
* 严禁在未设置 `CODEX_WORKSPACE_ROOT` 或未配置 `NO_PROXY` 代理豁免的情况下启动 `codex-a2a serve`。
* **严禁通过 A2A JSON-RPC 报文直接发送大体积数据文件或长篇源码字符串（必须先走文件同步通道落盘，再发 A2A 执行指令）**。

### 3. 三阶段业务目标与边界规格（Specs & Edge Cases）
* **阶段Ⅰ（基础落地）**：确认电脑端 `codex` CLI 可用，安装 `codex-a2a`，在 `127.0.0.1:8000` 启动 `codex-a2a serve` 并验证本地 Agent Card。
* **阶段Ⅱ（相关配套）**：编写 `ops/codex_a2a_launcher.sh`，自动加载 `.env.a2a` 并强制导出 `NO_PROXY="127.0.0.1,localhost,100.64.0.0/10,<PI_TAILSCALE_IP>"`；固化 **《Codex -> Pi Strict Runner 任务单派发模板》**。任务单必须同时声明 `preliminary_acceptance` 和 `final_acceptance`，并明确 Codex 直接走 A2A，`18787` 只负责观测与人工管控。
* **阶段Ⅲ（功能实现）**：在 Codex 会话中完成“同步预构建脚本 $\rightarrow$ 调用 `a2a_call` 触发手机端 `pi_idempotent_runner.sh` $\rightarrow$ 断网重连后通过 `GetTask` 拿回结构化 Artifact $\rightarrow$ Codex 独立完成最终验收”的全流程实测。

### 4. 完成定义（DoD）与验收台账
| 验收项编号 | 验收判据（DoD） | 边界条件与异常判据 | 目标状态 |
| :--- | :--- | :--- | :--- |
| `DOD-CDX-01` | `codex-a2a serve` 启动后 `http://127.0.0.1:8000/.well-known/agent-card.json` 返回 200 且仅监听回环网卡 | 若 `0.0.0.0:8000` 暴露在局域网则判 FAIL | **PASS** |
| `DOD-CDX-02` | 开启本地系统代理（`:7890`）场景下，`codex-a2a call` 依然 100% 直连手机 Tailscale IP 成功 | 出现 `502 Bad Gateway` 即判 FAIL | **BLOCKED：双端 Tailscale 未安装，当前仅验证 ADB forward 路径** |
| `DOD-CDX-03` | Codex 会话按“传算分离”准则派发预构建脚本执行任务，不把 Codex 自身卡在远程 Shell 上 | Codex 退化为逐条跑远程 bash 命令判 FAIL | **PASS** |
| `DOD-CDX-04` | Codex 直接通过 A2A 派发任务，读取 Pi 的 `preliminary_acceptance` 后，独立完成 `final_acceptance` | Codex 只接受自然语言报告，或跳过哈希、退出码、产物和测试复核判 FAIL | **ADOPTED（待真实会话级 `a2a_call` 证据）** |

---

## 模块三：`mod-a2a-network-keepalive-aims-总目标-20261028.txt`（Tailscale 专网与 Android 常驻保活卡带）

### 1. 模块定位（What & Why）
为手机 Termux 侧的 `:9910`（A2A Server）与 `:9911`（Telemetry Sidecar）双服务提供 **加密跨网可达性（Tailscale WireGuard 虚拟专网）** 与 **工业级 Android 进程防杀保活底座（WakeLock + Doze 豁免 + Phantom Process 扩容 + tmux 双服务守护自愈）**（彻底攻克缺口 G2、G4）。

### 2. 负面清单（Anti-Goals）
* 严禁依赖 Android 默认后台调度策略（未持有 `termux-wake-lock` 的节点一律视为不可用）。
* 严禁在路由器上对 `9910` 或 `9911` 端口配置公网端口映射或 DMZ。
* 严禁在 SSH 裸终端中直接前台运行 `pi` 或 `pi_telemetry_sidecar.py`。

### 3. 三阶段业务目标与边界规格（Specs & Edge Cases）
* **阶段Ⅰ（基础落地）**：电脑与手机双端加入同一 Tailscale 网络，锁定静态虚拟 IP（`100.x.y.z`），双端 `tailscale ping` 延迟 $< 50\text{ms}$。
* **阶段Ⅱ（相关配套）**：启用 `termux-wake-lock`、Android 电池“无限制”、Android 12+ Phantom Process 限制豁免，并通过 `ops/pi_a2a_daemon.sh` 在 `tmux` 会话 `pi-a2a` 中同时托管 `:9910` 与 `:9911` 两个窗口。
* **阶段Ⅲ（功能实现）**：手机息屏静置 15 分钟且期间模拟电脑端断网重连，验证手机端正在执行的任务不中断、`:9910` 与 `:9911` 探针 100% 存活。

### 4. 完成定义（DoD）与验收台账
| 验收项编号 | 验收判据（DoD） | 边界条件与异常判据 | 目标状态 |
| :--- | :--- | :--- | :--- |
| `DOD-NET-01` | 电脑通过 Tailscale IP 连续 10 次探测 `:9910` 与 `:9911`，成功率 100%，平均 RTT $< 60\text{ms}$ | 任一次超时或丢包判 FAIL | **BLOCKED：双端 Tailscale 未安装，真实 Tailscale IP 未取得** |
| `DOD-NET-02` | 手机锁屏息屏静置 15 分钟后，`:9910` 与 `:9911` 立即响应，后台长任务零中断 | 息屏后连接被拒绝或进程被杀判 FAIL | **PASS（ADB forward 路径，LIVE_SOAK_15M；2026-10-29 保活四项实测）** |
| `DOD-NET-03` | `tmux detach` 或断开 SSH 后，`pi-a2a` 会话内的 A2A Server 与 Telemetry Sidecar 均保持存活 | 任一服务随终端退出而终止判 FAIL | **PASS** |

---

## 模块四：`mod-a2a-artifact-audit-aims-总目标-20261028.txt`（双模状态机、断链续领与结构化 Artifact 验收卡带）

### 1. 模块定位（What & Why）
管理 A2A v1.0 任务的完整生命周期状态机（`submitted -> working -> completed / failed / canceled`），实现 **异步立即返回（`returnImmediately: true`）+ 断链重连后 `GetTask` 状态续领 + 结构化 Artifact 哈希对账**，并提供覆盖全平台的自动化回归测试矩阵（彻底攻克缺口 G3、G6、G8）。

### 2. 负面清单（Anti-Goals）
* 严禁在同步请求或网络闪断后不经 `GetTask` 查询就直接重发破坏性写指令。
* 严禁接受缺少 `exit_code`、`script_sha256`、`changed_files` 哈希列表的口语化回复作为验收凭证。

### 3. 三阶段业务目标与边界规格（Specs & Edge Cases）
* **阶段Ⅰ（基础落地）**：固化 `SendMessage`（含 `returnImmediately`）、`GetTask`、`CancelTask` 的 JSON-RPC 2.0 报文契约与 `StructuredExecutionArtifact` Schema。
* **阶段Ⅱ（相关配套）**：实现 `A2AClientPoller`（支持本地持久化 `active_task_id.json`，即使电脑端进程重启也能凭 `task_id` 调 `GetTask` 续领手机端执行结果）与 `ArtifactValidator`。`ArtifactValidator` 同时校验 Pi 的 `preliminary_acceptance` 和 Codex 的 `final_acceptance`，两者通过才允许任务进入完成态。
* **阶段Ⅲ（功能实现）**：建成包含 8 大维度的自动化回归测试脚本 `tests/test_e2e_a2a_pipeline.py`，一键验证安全锁、路径锁、幂等锁、断链续领、双层验收与遥测接口。

### 4. 完成定义（DoD）与验收台账
| 验收项编号 | 验收判据（DoD） | 边界条件与异常判据 | 目标状态 |
| :--- | :--- | :--- | :--- |
| `DOD-ART-01` | 结构化 Artifact 校验：必须包含 `idempotent_status`、`exit_code: 0`、`script_sha256` 及产物 64 位 SHA256 | 字段缺失或哈希不匹配判 FAIL | **PASS** |
| `DOD-ART-02` | 断链续领验证：派发异步任务后断开客户端连接，待任务完成后凭 `task_id` 调用 `GetTask` 成功拿回完整 Artifact | 断链后丢失任务状态或触发重跑判 FAIL | **PASS** |
| `DOD-ART-03` | 运行 `python3 tests/test_e2e_a2a_pipeline.py` 全部回归断言 100% PASS | 任一测试项报错即判 FAIL | **PASS（contract 8/8，允许 1 个 live 类 skip；live 12/12，含 test_05-08 与路径越界契约）** |
| `DOD-ART-04` | 双层验收状态机：Pi 提交 `preliminary_acceptance`，Codex 生成独立 `final_acceptance`；任何一层失败都保持任务未完成 | 缺少任一层，或 Codex 直接复用 Pi 的 `passed=true` 判 FAIL | **PASS（poller 7/7，artifact 24/24，live 1/1）** |
| `DOD-ART-05` | 异步任务状态机：`SendMessage` 默认立即返回，`GetTask` 可续领，终态统一归一化并保留 `remote_state`，`CancelTask` 可回收运行中任务 | 终态大小写不兼容后继续轮询、丢失远端原始状态，或取消结果无法读回判 FAIL | **PASS（Node 19/19；completed `task-29397fdbcca0471c`；canceled `task-a48fe1e057bb4885`）** |

---

## 模块五：`mod-pi-observability-aims-总目标-20261028.txt`（BioanalysDesktop `18787` 手机 Pi 观测与模型管控卡带 —— 新增模块）

### 1. 模块定位（What & Why）
在 **BioanalysDesktop (`127.0.0.1:18787`) 编排面服务端页面**中挂载可视化观测与管控中心，通过手机端 `:9911` 遥测 Sidecar（`ops/pi_telemetry_sidecar.py`）与 `18787` 后端代理路由（`BioanalysDesktop/server/pi_agent_routes.js`），让用户在 `18787` 网页上一屏实时掌控手机端 Pi Agent 的 **调用信息台账、实时运行日志（`daemon.log` + `childTranscripts`）、当前使用模型设定（支持热切换）以及 Token/成本/硬件使用情况**（彻底攻克缺口 G9）。

### 2. 负面清单（Anti-Goals）
* **严禁前端浏览器直接跨域请求手机端或将 `A2A_CLIENT_BEARER_TOKEN` 暴露在前端 HTML/JS 中（禁区 6）**——所有请求必须经由 `18787` 后端 `/api/pi-agent/*` 路由代理并在服务端注入 Token。
* **严禁允许通过网页任意输入未授权模型名称或上传明文第三方 API Key**——仅允许在手机端已配置好密钥的 `ALLOWED_MODELS` 白名单内切换 `defaultProvider`、`defaultModel`、`thinkingLevel` 与 `maxConcurrent`。
* 严禁 `18787` 后端请求手机 Tailscale IP 时走本地 `7890` 系统代理（必须显式设置 `agent: false`）。

### 3. 三阶段业务目标与边界规格（Specs & Edge Cases）
* **阶段Ⅰ（基础落地 —— 手机端 `:9911` 遥测 Sidecar）**：
  1. 在手机 Termux 部署 `ops/pi_telemetry_sidecar.py`（监听 `0.0.0.0:9911`），复用 `~/.pi/agent/settings.json` 中的 `peerTokens.codex` 进行 Bearer 鉴权；
  2. 提供 `GET /api/telemetry/overview`（汇总 Agent 配置、当前模型、硬件 RAM/电量/温度、累计 Token/费用、分模型统计与最近 40 条调用记录）、`GET /api/telemetry/logs`（读取 `pi_a2a_daemon.log` 或指定 `task_id.jsonl` 轨迹）及 `POST /api/telemetry/model`（原子更新 `settings.json` 默认模型与并发上限）。
* **阶段Ⅱ（相关配套 —— `18787` 服务端代理路由与台账联动）**：
  1. 在 `BioanalysDesktop/server/pi_agent_routes.js` 实现 `/api/pi-agent/{ping,overview,calls,logs,model,dispatch}` 接口并挂载至 `18787` 主服务；
  2. 每次在网页上切换手机端模型或派发探针任务时，自动在电脑端 `con_hf/ledger/actions.jsonl` 追加审计记录。
* **阶段Ⅲ（功能实现 —— `18787` 前端四联监控工作台插槽）**：
  1. 在 React `BioanalysDesktop/src/App.tsx` 的 `PiAgentMonitor` 集成视图中展示顶部状态卡（在线状态、当前模型、tmux、内存、A2A 可达性）；
  2. 在同一视图展示四联监控中心：① 调用信息与 Artifact 验收台账；② 守护日志与任务轨迹双流终端；③ 模型白名单热切换；④ 分模型 Token 消耗与费用统计；
  3. `mod-pi-observability` 的 `workbench.selfcheck-cards` 与 `workbench.studio-preview` 插槽声明由 `SlotManager` 契约测试覆盖，React 视图作为当前生产挂载适配器。

### 4. 完成定义（DoD）与验收台账
| 验收项编号 | 验收判据（DoD） | 边界条件与异常判据 | 目标状态 |
| :--- | :--- | :--- | :--- |
| `DOD-OBS-01` | 手机端 `:9911` Sidecar 鉴权守卫：无 Token 或错 Token 请求 `/api/telemetry/*` 100% 返回 `401` | 未授权可读取日志或改模型即判 FAIL | **PASS** |
| `DOD-OBS-02` | `18787` 服务端 `GET /api/pi-agent/overview` 在开启 `7890` 代理环境下仍正常聚合 `:9910` 与 `:9911` 数据 | 被代理劫持返回 502 或泄露 Token 判 FAIL | **PASS** |
| `DOD-OBS-03` | 在 `18787` 页面切换模型并点击保存后，手机端 `~/.pi/agent/settings.json` 原子更新且新任务按新模型计费 | 配置文件损坏或非白名单模型写入成功判 FAIL | **PASS（settings.json 与 pin 原子同步，真实派发 task-38e8114e6a0c443e）** |
| `DOD-OBS-04` | React `PiAgentMonitor` 通过 `npm run build`，四联视图、模型切换、派发弹窗与日志切换由 Node 路由测试覆盖 | 存在失效按钮、阻塞弹窗、构建错误或路由测试失败判 FAIL | **PASS** |

## 2026-10-29 门禁复核

- `pwsh -NoProfile -File ops/a2a_preflight.ps1`：`PASS_WITH_WARNINGS`，`113 PASS / 2 WARN / 0 FAIL`。
- 两条 WARN 仅对应 Tailscale 未安装和真实 Tailscale IP 未配置，ADB forward 证据未登记为 Tailscale 验收。
- `/api/runtime/slots` 返回 10 个 `ready` 模块；`mod-pi-observability` 的 `workbench.selfcheck-cards` 与 `workbench.studio-preview` 两个插槽均非空。
- `T-CDX-02` launcher 契约测试 `6/6 PASS`；`T-CDX-04` 仍需真实会话级 `a2a_call` 工具证据。

## 2026-10-29 A2A Hardening Closure

- `PathGuard` 同时放行容器算力根 `/mnt/ssd/bio_data`，继续拒绝同前缀伪根和所有越界路径；`tests/test_a2a_core.py` 为 `25/25 PASS`。
- `ops/pi_idempotent_runner.sh` 已部署到手机生产路径，本地与远端 SHA256 均为 `1c280a0c399df9daf48c4479c45b54d931054c4facb21f9b57e5893054a3fe26`，生产探针 `24/24 PASS`。
- Runner 新增 TERM、INT、HUP 子进程组回收；runner 被 SIGKILL 后，新调用会等待仍存活的 child，并在产物完整时恢复 `.done`，不再重复执行。
- Runner 的 PNG 完整性校验从魔数头扩展为魔数头加 IEND 尾，截断 PNG 返回退出码 `6` 且不写 `.done`；日志摘要改为按 UTF-8 字符截断 320 字符。
- `ops/deploy-k40-termux.sh` 已修复隐藏父目录静默空部署、尾部 NUL 二进制误判和错误可执行位，部署器测试 `12/12 PASS`。
- Artifact 校验器拒绝 `workspace_dir` 中的 `..`，4 MB 门禁按 JSON-RPC ASCII 线缆形态计算；`tests/test_a2a_artifact.py` 为 `15/15 PASS`，`tests/test_a2a_e2e_artifact.py --live` 为 `16/16 PASS`。
- Artifact `changed_files[].path` 统一为相对 `workspace_dir` 的路径，`tests/test_e2e_a2a_pipeline.py --mode live -v` 为 `12/12 PASS`。
- `tests/a2a_master_harness.py` 与 `aims/A2A/a2a_master_harness.py` 已在 K40 Termux 分别实跑，均为 `7/7 PASS`。
- 本轮新增并关闭六类缺陷：workspace 路径穿越、runner 信号生命周期、部署器尾部 NUL、ASCII 线缆体积、UTF-8 摘要截断、PNG IEND 完整性。
