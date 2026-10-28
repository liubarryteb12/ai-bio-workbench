# Codex（电脑）↔ Pi Agent（手机 Termux）A2A 协作工程 —— 01. 各模块 `aims-总目标`（What & Why 阶段性业务契约）全集

> **文档编号与时间戳**：`01_aims_Codex-Pi-A2A协作工程_20261028.md`（生成时间：`2026-10-28 09:00:00 +08:00`）
> **文档角色**：【1 + N×3 体系】中的 **`[模块名]-aims-总目标-20261028.txt` 汇总卷**（定义每个模块的业务定位、负面清单、三阶段目标、边界规格 Specs & Edge Cases、完成定义 DoD 与验收台账）
> **覆盖范围**：1 个微内核底座模块（`mod-core-engines`）+ 4 个可插拔业务模块（`mod-a2a-pi-server`、`mod-a2a-codex-client`、`mod-a2a-network-keepalive`、`mod-a2a-artifact-audit`）

---

## 模块零：`mod-core-engines-aims-总目标-20261028.txt`（微内核底座、四大共享引擎与全局台账治理）

### 1. 模块定位（What & Why）
构建对上层业务任务“完全无知”的微内核宿主底座（`src/core/`）与四大共享能力引擎（`a2a-rpc-engine`、`transport-keepalive-engine`、`artifact-sync-engine`、`security-audit-engine`），统一管理双平面路径守卫（`PathGuard`）、`SPEC_DECISIONS.md`（D-01~D-10）裁定录以及双层五类追加式 JSONL 台账（攻克缺口 G5、G7）。

### 2. 负面清单（Anti-Goals）
* 严禁在 `src/core/` 或 `src/engines/` 中硬编码具体的手机 IP 地址或明文 Bearer Token。
* 严禁允许任何指向 `/sdcard`、`/storage/emulated` 或包含 `..` 路径穿越的工作区路径通过 `PathGuard` 校验。
* 严禁将人工/Agent 工程台账（`con_hf/ledger/*.jsonl`）与 Pi 运行时子会话日志（`~/.pi/agent/transcripts/`）混写在同一目录。

### 3. 三阶段业务目标与边界规格（Specs & Edge Cases）
* **阶段Ⅰ（基础落地）**：锁定 `00.最高技术纲领-20261028.txt` 与 `con_hf/SPEC_DECISIONS.md`（D-01~D-10）；完成双平面工作区目录骨架初始化与 `.gitignore` 密钥防泄漏守卫。
* **阶段Ⅱ（相关配套）**：实现 `PathGuard` 四类合法根校验器、`security-audit-engine` 的配置文件静态扫描器（拦截无 Token 的 `0.0.0.0` 绑定与弱 Token），以及 `ops/ledger_indexer.py` 台账聚合校验工具。
* **阶段Ⅲ（功能实现）**：实现 `ModLoader` 对 4 个业务模块 `manifest.ts` 的动态挂载与健康自检汇总，生成全平台五维环境自检报告（网络连通、Token 熵值、工作区权限、代理豁免、台账完整性）。

### 4. 完成定义（DoD）与验收台账
| 验收项编号 | 验收判据（DoD） | 边界条件与异常判据 | 目标状态 |
| :--- | :--- | :--- | :--- |
| `DOD-CORE-01` | `con_hf/SPEC_DECISIONS.md` 完整收录 D-01 ~ D-10 且被索引器识别 | 缺失任一裁定编号即判 FAIL | **PASS** |
| `DOD-CORE-02` | `PathGuard` 100% 拦截 `/sdcard/project`、`../outside` 等非法路径 | 单元测试覆盖 12 种越界路径注入全部抛出 `ERR_PATH_GUARD` | **PASS** |
| `DOD-CORE-03` | Git 仓库工作树零明文 Token 泄露扫描（`security-audit-engine`） | 扫描全部受控文件，若匹配 `a2a_sec_` 真实密钥在非 `.env` 文件中立即判 FAIL | **PASS** |
| `DOD-CORE-04` | `ops/ledger_indexer.py --verify` 校验五类 `.jsonl` 格式与时间戳合法 | 空行、非法 JSON 或缺失 ISO 8601 时间戳即判 FAIL | **PASS** |

---

## 模块一：`mod-a2a-pi-server-aims-总目标-20261028.txt`（手机 Termux Pi Agent A2A 执行端卡带）

### 1. 模块定位（What & Why）
在手机 Android Termux 环境中部署、加固并运行 Pi Coding Agent 与 `@bacnh85/pi-a2a` 扩展，使手机成为一个 **符合 A2A v1.0 标准、具备强 Token 认证、并发受控（`maxConcurrent: 2`）、可自主在 `$HOME/workspace/` 内执行编码/测试任务并回传结构化 Artifact 的执行节点**（彻底攻克缺口 G1、G5）。

### 2. 负面清单（Anti-Goals）
* 严禁在未配置 `server.peerTokens` 或 `allowAllUsers: true` 的情况下将 `server.host` 设为 `0.0.0.0`（禁区 1）。
* 严禁在安装 `@earendil-works/pi-coding-agent` 时省略 `--ignore-scripts` 参数（防止 Termux aarch64 下原生二进制编译钩子报错中断）。
* 严禁将 `maxConcurrent` 设置为 $> 2$（防止移动端内存溢出触发 Android LMKD 杀进程）。
* 严禁配置任何出站 Peer 去反向呼叫电脑端 Codex（禁区 3）。

### 3. 三阶段业务目标与边界规格（Specs & Edge Cases）
* **阶段Ⅰ（基础落地）**：
  1. 在 Termux 中安装 `nodejs`、`git`、`python`、`jq`、`tmux`、`termux-api`；
  2. 执行 `npm install -g --ignore-scripts @earendil-works/pi-coding-agent` 与 `pi install npm:@bacnh85/pi-a2a`；
  3. 在默认 `127.0.0.1:9910` 下启动 `/a2a-server start`，本机 `curl http://127.0.0.1:9910/.well-known/agent-card.json` 返回合法 A2A v1.0 Agent Card JSON。
* **阶段Ⅱ（相关配套）**：
  1. 在 `~/.pi/agent/settings.json` 中写入完整 `a2a` 配置节：启用 `server.enabled: true`、注入 48 位高熵 `peerTokens.codex`、锁定 `trustedPeers: ["codex"]`、`allowAllUsers: false`、`maxConcurrent: 2`、`replyTimeoutSec: 300`、`childTranscripts: true`；
  2. 通过安全校验脚本验证 `peerTokens` 非空后，将 `server.host` 切换为 `"0.0.0.0"`，并在 `$HOME/workspace/` 初始化隔离工作区。
* **阶段Ⅲ（功能实现）**：
  1. 响应来自电脑 Codex 的 JSON-RPC 2.0 `SendMessage` 请求，正确校验 `Authorization: Bearer <token>`（无 Token 或错 Token 立即返回 `401/403`）；
  2. 在 `$HOME/workspace/` 内自主完成文件创建、代码修改、pytest/shell 执行，并将执行摘要、文件 SHA256 与 Diff 封装为 A2A `Artifact` 返回；
  3. 自动在 `~/.pi/agent/transcripts/` 下生成每次委派任务的完整子会话审计日志。

### 4. 完成定义（DoD）与验收台账
| 验收项编号 | 验收判据（DoD） | 边界条件与异常判据 | 目标状态 |
| :--- | :--- | :--- | :--- |
| `DOD-PI-01` | 本地与跨网 `GET /.well-known/agent-card.json` 返回 HTTP 200 且包含 `name`、`url`、`capabilities`、`skills` | 缺失字段或返回非 200 状态码判 FAIL | **PASS** |
| `DOD-PI-02` | 鉴权铁闸测试：无 Header、空 Bearer、错误 Token 请求 `POST /` 100% 拒绝 | 任何未授权请求进入 `working` 状态即判严重安全事故（FAIL） | **PASS** |
| `DOD-PI-03` | 最小 Task 真实闭环：接收指令在 `$HOME/workspace/` 生成文件并回传 Artifact | 文件未落盘或返回体 `result.task.artifacts` 为空判 FAIL | **PASS** |
| `DOD-PI-04` | 子任务审计落盘：`childTranscripts` 目录生成对应任务的完整交互轨迹 | 无审计日志生成或保留期配置未生效判 FAIL | **PASS** |

---

## 模块二：`mod-a2a-codex-client-aims-总目标-20261028.txt`（电脑 Codex `codex-a2a` 编排与出站调用卡带）

### 1. 模块定位（What & Why）
在本地电脑上通过 `codex-a2a` 为 Codex CLI/Agent 注入符合 A2A v1.0 规范的 **出站任务委派能力（`a2a_call` 工具与 `codex-a2a call` CLI）**，使 Codex 能够根据任务性质自主决定将移动端任务委派给手机 Pi，并基于回传的 Artifact 进行验收与下一步决策（攻克缺口 G4、G6）。

### 2. 负面清单（Anti-Goals）
* 严禁将电脑侧 `A2A_HOST` 设为 `0.0.0.0`（电脑侧入站面仅允许绑定 `127.0.0.1:8000` 用于本地健康探针）。
* 严禁在未设置 `CODEX_WORKSPACE_ROOT` 或未配置 `NO_PROXY` 代理豁免的情况下启动 `codex-a2a serve`（防止 7890 代理劫持 Tailscale 流量）。
* 严禁在 `a2a_call` 提示词中下达模糊不清、无验收标准、无目标路径的口语指令（必须遵循结构化委派模板）。

### 3. 三阶段业务目标与边界规格（Specs & Edge Cases）
* **阶段Ⅰ（基础落地）**：
  1. 确认电脑端 `codex` CLI 已安装且模型 Provider 正常可用；
  2. 执行 `uv tool install codex-a2a` 完成适配器安装；
  3. 在 `127.0.0.1:8000` 启动 `codex-a2a serve`，验证本地 Agent Card 可达。
* **阶段Ⅱ（相关配套）**：
  1. 编写 `ops/codex_a2a_launcher.sh`，自动加载 `.env.a2a` 中的 `A2A_CLIENT_BEARER_TOKEN`、`PI_A2A_ENDPOINT` 并强制设置 `NO_PROXY="127.0.0.1,localhost,100.64.0.0/10"`；
  2. 使用 `codex-a2a call http://<Pi-Tailscale-IP>:9910 "ping" --token "$A2A_CLIENT_BEARER_TOKEN"` 打通首次跨网络手工 CLI 调用。
* **阶段Ⅲ（功能实现）**：
  1. 在 Codex 会话中，当用户提出跨端任务需求时，Codex 自主选择调用 `a2a_call(url, message)` 工具向手机 Pi 派发任务；
  2. 自动解析返回的 `Task` 状态与 `Artifact` 内容，校验目标文件 SHA256 与退出码，向用户输出结构化验收结论。

### 4. 完成定义（DoD）与验收台账
| 验收项编号 | 验收判据（DoD） | 边界条件与异常判据 | 目标状态 |
| :--- | :--- | :--- | :--- |
| `DOD-CDX-01` | `codex-a2a serve` 启动后 `http://127.0.0.1:8000/.well-known/agent-card.json` 返回 200 且仅监听回环网卡 | 若 `0.0.0.0:8000` 暴露在局域网则判 FAIL | **PASS** |
| `DOD-CDX-02` | 开启本地系统代理（如 `:7890`）场景下，`codex-a2a call` 依然 100% 直连手机 Tailscale IP 成功 | 出现 `502 Bad Gateway` 或代理转发痕迹即判 FAIL | **PASS** |
| `DOD-CDX-03` | Codex 会话自主触发 `a2a_call` 委派编码/测试任务，并准确读取 Artifact 完成验收汇报 | Codex 误在电脑本地 Shell 执行手机任务即判 FAIL | **PASS** |

---

## 模块三：`mod-a2a-network-keepalive-aims-总目标-20261028.txt`（Tailscale 专网与 Android 常驻保活卡带）

### 1. 模块定位（What & Why）
为手机 Termux 侧的 A2A Server 提供 **加密跨网可达性（Tailscale WireGuard 虚拟专网）** 与 **工业级 Android 进程防杀保活底座（WakeLock + Doze 豁免 + Phantom Process 扩容 + tmux 守护自愈）**，确保手机在息屏、后台切换及跨 Wi-Fi/蜂窝网络场景下始终对 Codex 保持高可用（彻底攻克缺口 G2、G4）。

### 2. 负面清单（Anti-Goals）
* 严禁依赖 Android 默认后台调度策略（未持有 `termux-wake-lock` 的节点一律视为不可用）。
* 严禁在路由器上对 `9910` 端口配置公网端口映射（Port Forwarding）或 DMZ。
* 严禁在 SSH 裸终端中直接前台运行 `pi`（一旦 SSH 断开即收到 `SIGHUP` 终止，必须运行于 `tmux` 会话内）。

### 3. 三阶段业务目标与边界规格（Specs & Edge Cases）
* **阶段Ⅰ（基础落地）**：电脑与手机双端安装并登录同一 Tailscale 账号，分配固定虚拟 IP（`100.x.y.z`），双端 `tailscale ping` 延迟 $< 50\text{ms}$ 且零丢包。
* **阶段Ⅱ（相关配套）**：
  1. 在 Termux 中启用 `termux-wake-lock`；
  2. 在 Android 系统设置中将 Termux 与 Tailscale 的电池优化均设为“无限制（Unrestricted）”；
  3. 对 Android 12+ 设备执行 Phantom Process 阈值豁免；
  4. 部署 `ops/pi_a2a_daemon.sh`，在命名 `tmux` 会话 `pi-a2a` 中托管服务，并提供每 60 秒一次的本地端口自愈巡检。
* **阶段Ⅲ（功能实现）**：执行息屏 15 分钟高压保活测试与网络切换韧性测试，验证电脑端对 `:9910/.well-known/agent-card.json` 的连续探测 100% 成功。

### 4. 完成定义（DoD）与验收台账
| 验收项编号 | 验收判据（DoD） | 边界条件与异常判据 | 目标状态 |
| :--- | :--- | :--- | :--- |
| `DOD-NET-01` | 电脑通过 Tailscale IP 连续 10 次请求 Pi Agent Card，成功率 100%，平均 RTT $< 60\text{ms}$ | 任一次请求超时（$> 3\text{s}$）或丢包判 FAIL | **PASS** |
| `DOD-NET-02` | 手机锁屏息屏静置 15 分钟后，电脑端发起 `a2a_call` 立即响应，无冷启动挂死 | 息屏后连接被拒绝或超时判 FAIL | **PASS** |
| `DOD-NET-03` | `tmux detach` 断开终端或杀掉 SSH 连接后，`pi-a2a` 会话与 `:9910` 监听保持 100% 存活 | 终端断开导致服务中断判 FAIL | **PASS** |

---

## 模块四：`mod-a2a-artifact-audit-aims-总目标-20261028.txt`（双模状态机、结构化 Artifact 验收与回归测试卡带）

### 1. 模块定位（What & Why）
管理 A2A v1.0 任务的完整生命周期状态机（`submitted -> working -> completed / failed / canceled / input-required`），解决超过 300s 长任务的异步轮询（`GetTask`）与超时中止（`CancelTask`）问题，并强制校验 Pi 回传的结构化 Artifact 与全链路自动化回归测试矩阵（彻底攻克缺口 G3、G6、G7）。

### 2. 负面清单（Anti-Goals）
* 严禁在同步 `SendMessage` 满 300s 超时后不经 `GetTask` 查询就直接重发相同写任务（防止并发踩踏）。
* 严禁接受无退出码、无文件哈希验证的纯口语化回复作为编码任务的最终验收凭证。
* 严禁通过 JSON-RPC 响应体直接内联传输 $> 4\text{MB}$ 的大体积二进制文件。

### 3. 三阶段业务目标与边界规格（Specs & Edge Cases）
* **阶段Ⅰ（基础落地）**：固化短任务同步阻塞（$\le 240\text{s}$）与长任务异步轮询（`GetTask` + `CancelTask`）的 JSON-RPC 2.0 报文契约。
* **阶段Ⅱ（相关配套）**：实现客户端 `A2ATaskPoller`（支持指数退避轮询与超时优雅取消）与 `ArtifactValidator`（校验 `exit_code === 0` 及目标文件 SHA256）。
* **阶段Ⅲ（功能实现）**：建成包含 6 大维度的端到端自动化回归测试脚本 `tests/test_e2e_a2a_pipeline.py`（覆盖 Agent Card、401 鉴权拦截、最小写文件闭环、结构化 Artifact 校验、超时/异步轮询行为、保活探针），实现一键全绿验签。

### 4. 完成定义（DoD）与验收台账
| 验收项编号 | 验收判据（DoD） | 边界条件与异常判据 | 目标状态 |
| :--- | :--- | :--- | :--- |
| `DOD-ART-01` | 结构化 Artifact 校验：回传结果必须包含合法的 `exit_code`、文件相对路径与 64 位 SHA256 | 缺少哈希或哈希与文件内容不符判 FAIL | **PASS** |
| `DOD-ART-02` | 超时与异步轮询保护：模拟 $> 300\text{s}$ 或异步任务，客户端通过 `GetTask` 正常收敛至 `completed` 或通过 `CancelTask` 干净中止 | 客户端无限挂起或产生孤儿进程判 FAIL | **PASS** |
| `DOD-ART-03` | 运行 `python3 tests/test_e2e_a2a_pipeline.py` 6 项核心回归断言 100% PASS | 任一测试项报错或跳过即判 FAIL | **PASS** |
