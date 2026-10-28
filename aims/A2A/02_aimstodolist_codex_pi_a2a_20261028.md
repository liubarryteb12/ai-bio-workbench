# Codex（电脑）↔ Pi Agent（手机 Termux）A2A 协作工程 —— 02. 各模块 `aimstodolist`（When & Who 瞬态执行流水）全集

> **文档编号与时间戳**：`02_aimstodolist_Codex-Pi-A2A协作工程_20261028.md`（生成时间：`2026-10-28 09:00:00 +08:00`）
> **文档角色**：【1 + N×3 体系】中的 **`[模块名]-aimstodolist-20261028.txt` 汇总卷**（管控当前正在执行哪一步、`< 30 分钟` 原子任务拆解、`WIP=1` 单项工序锁、精确修改文件、验收命令与实测凭证；随工程封板归档）
> **全局工序铁律**：严格遵循 **「阶段Ⅰ：基础落地 → 阶段Ⅱ：相关配套 → 阶段Ⅲ：功能实现」** 单向顺序推进，严禁跨阶段跳跃！全平台同一时刻仅允许 **1 个原子任务** 处于 `[WIP=1]` 状态。

---

## 一、 全局 1 + N×3 瞬态施工总盘点（基于 2026-10-28 工程基线）

| 模块卡带名称 | 阶段Ⅰ（基础落地） | 阶段Ⅱ（相关配套） | 阶段Ⅲ（功能实现） | 当前模块工序锁状态 | 关联攻克缺口 |
| :--- | :---: | :---: | :---: | :--- | :--- |
| **`mod-core-engines`**（底座与台账治理） | 2 项 | 1 项 | 1 项 | **阶段Ⅰ 优先启动 (`[WIP=1]` 于 `T-CORE-01`)** | G5（路径越界）、G7（台账缺失） |
| **`mod-a2a-pi-server`**（手机 Pi 执行端） | 1 项 | 2 项 | 1 项 | 待 `T-CORE-02` 完成后接棒 (`WIP=0`) | G1（无Token暴露）、G5（`/sdcard` 隔离） |
| **`mod-a2a-network-keepalive`**（专网与保活） | 1 项 | 2 项 | 1 项 | 与 Pi 阶段Ⅱ协同推进 (`WIP=0`) | G2（Doze/幻影进程杀手）、G4（公网暴露） |
| **`mod-a2a-codex-client`**（电脑 Codex 编排端） | 1 项 | 2 项 | 1 项 | 待手机端远程可达后接棒 (`WIP=0`) | G4（7890代理劫持）、G6（非标调用） |
| **`mod-a2a-artifact-audit`**（双模状态机与验收） | 1 项 | 1 项 | 2 项 | 阶段Ⅲ总装闭环终验 (`WIP=0`) | G3（300s超时孤儿）、G6（Artifact非标） |

---

## 二、 全局跨模块串并施工拓扑图（Critical Path）

```text
[T-CORE-01 ~ 02: 最高纲领落盘 + 双平面目录 & Token 生成]
       │
       ├──► [T-PI-01: Termux 安装 Pi + @bacnh85/pi-a2a + 127.0.0.1 探活]
       │           │
       │           ▼
       │    [T-PI-02: 写入 peerTokens 鉴权配置 + childTranscripts]
       │           │
       ├──► [T-NET-01 ~ 02: Tailscale 组网固定 IP + WakeLock/电池无限制/Phantom 豁免]
       │           │
       │           ▼
       └──► [T-NET-03 & T-PI-03: tmux 守护启动 + 安全放宽 0.0.0.0 + 远程 Agent Card 达标]
                   │
                   ▼
            [T-CDX-01 ~ 02: 安装 codex-a2a + NO_PROXY 注入 + 本地 127.0.0.1:8000 启动]
                   │
                   ▼
            [T-CDX-03: CLI `codex-a2a call` 首次跨网 SendMessage 联通 & 401 负向拦截验证]
                   │
                   ▼
            [T-PI-04 & T-CDX-04: Codex 会话自主 `a2a_call` 驱动 Pi 产生物理文件并回传结构化 Artifact]
                   │
                   ▼
            [T-ART-01 ~ 04 & T-CORE-04: 异步 GetTask/CancelTask 轮询验证 + 15m 息屏压测 + 全量回归封板]
```

---

## 三、 分模块 `aimstodolist` 原子任务流水单（严格按「基础落地 → 相关配套 → 功能实现」排序）

### 3.1 `mod-core-engines-aimstodolist-20261028.txt`

```text
================================================================================
mod-core-engines-aimstodolist-20261028.txt
================================================================================
【当前模块工序锁】：WIP=1（正在执行 T-CORE-01：落盘最高技术纲领与 D-01~D-10 裁定录）

---------------- 【阶段Ⅰ：基础落地 (Foundation Landing)】 ----------------
[ ] T-CORE-01 [WIP=1] [预计 15m]：初始化工程目录骨架并落盘《00.最高技术纲领》与 D-01~D-10 裁定
    - 修改/创建文件：
      1. `00.最高技术纲领-20261028.txt`
      2. `con_hf/SPEC_DECISIONS.md`
      3. `con_hf/ledger/{actions,changes,errors,fixes,pitfalls}.jsonl`
      4. `.gitignore`（强制忽略 `.env.a2a`、`*settings.local.json`、`*.token`）
    - 具体动作：在电脑编排端创建标准微内核目录树（`src/{core,engines,mods}`、`ops`、`tests`、`con_hf`），写入 D-01 ~ D-10 十项裁定，初始化五类空 JSONL 台账文件。
    - 验收命令：
      `test -f 00.最高技术纲领-20261028.txt && grep -c "D-10" con_hf/SPEC_DECISIONS.md`（输出 >= 1）。

[ ] T-CORE-02 [预计 10m]：生成高熵对等认证密钥（Peer Token）并初始化 `.env.a2a.example`
    - 修改/创建文件：`.env.a2a.example`、`.env.a2a`（本地不入库）
    - 具体动作：使用 `python3 -c "import secrets; print('a2a_sec_' + secrets.token_hex(24))"` 生成 56 字符高熵 Token，填入本地 `.env.a2a` 的 `A2A_CLIENT_BEARER_TOKEN`，同时生成脱敏模板 `.env.a2a.example`。
    - 验收命令：
      `git check-ignore -v .env.a2a`（确认被 gitignore 拦截）且 `wc -c <<<"$A2A_CLIENT_BEARER_TOKEN"` >= 48。

---------------- 【阶段Ⅱ：相关配套 (Supporting Facilities)】 ----------------
[ ] T-CORE-03 [预计 20m]：落地双平面路径守卫 `PathGuard` 与台账索引器 `ops/ledger_indexer.py`（攻克缺口 G5/G7）
    - 修改/创建文件：`src/core/PathGuard.ts`、`ops/ledger_indexer.py`
    - 具体动作：实现 `assertValidMobileWorkspace(path)`（拦截 `/sdcard`、`/storage/emulated` 与 `..`）及 `ops/ledger_indexer.py`（校验五类 JSONL 台账格式并生成 `con_hf/INDEX.json`）。
    - 验收命令：`python3 ops/ledger_indexer.py --verify`（返回码 0，输出 `LEDGER_VERIFY_OK`）。

---------------- 【阶段Ⅲ：功能实现 (Feature Implementation)】 ----------------
[ ] T-CORE-04 [预计 15m]：全平台配置与密钥零泄露终验归档
    - 修改/创建文件：`con_hf/runs/2026-10-28_gate_v1/REPORT.md`
    - 具体动作：在全部模块施工完毕后，运行安全扫描与台账汇总，确认工作树干净、无硬编码密钥，生成最终门禁报告。
    - 验收命令：`git status --porcelain` Clean 且 `python3 ops/ledger_indexer.py --summary` 通过。
================================================================================
```

---

### 3.2 `mod-a2a-pi-server-aimstodolist-20261028.txt`

```text
================================================================================
mod-a2a-pi-server-aimstodolist-20261028.txt
================================================================================
【当前模块工序锁】：WIP=0（排在 T-CORE-02 完成后立即接棒）

---------------- 【阶段Ⅰ：基础落地 (Foundation Landing)】 ----------------
[ ] T-PI-01 [预计 20m]：Termux 基础工具链、Pi Coding Agent 与 `@bacnh85/pi-a2a` 安装及回环探活
    - 执行环境：手机 Termux (`aarch64-linux-android`)
    - 具体动作：
      1. 执行 `pkg update -y && pkg upgrade -y`
      2. 执行 `pkg install -y nodejs git python jq tmux termux-api procps`
      3. 创建原生工作区：`mkdir -p $HOME/workspace/projects $HOME/.pi/agent`
      4. 安装 Pi 核心：`npm install -g --ignore-scripts @earendil-works/pi-coding-agent`
      5. 安装 A2A 扩展：`pi install npm:@bacnh85/pi-a2a`
      6. 启动本地回环测试：在 `pi` 内运行 `/a2a-server start`
    - 验收命令：
      `pi --version` 输出正常版本号；
      `curl -fsSL http://127.0.0.1:9910/.well-known/agent-card.json | jq -e '.name and .capabilities and .skills'`（返回 0 且打印合法 JSON）。

---------------- 【阶段Ⅱ：相关配套 (Supporting Facilities)】 ----------------
[ ] T-PI-02 [预计 15m]：写入带 `peerTokens` 与 `childTranscripts` 的生产级 `~/.pi/agent/settings.json`（攻克缺口 G1/G7）
    - 修改文件：`~/.pi/agent/settings.json`
    - 具体动作：
      1. 先保持 `host: "127.0.0.1"`，写入 `enabled: true`、`port: 9910`、`peerTokens: { "codex": "<T-CORE-02生成的Token>" }`、`trustedPeers: ["codex"]`、`allowAllUsers: false`、`maxConcurrent: 2`、`replyTimeoutSec: 300`、`childTranscripts: true`；
      2. 重启 Pi 验证配置自动加载且 `/a2a-server` 自动随实例启动。
    - 验收命令：
      `jq -e '.a2a.server.enabled == true and (.a2a.server.peerTokens.codex | length) >= 48 and .a2a.server.allowAllUsers == false' ~/.pi/agent/settings.json`

[ ] T-PI-03 [预计 10m]：通过安全绑定校验将 `server.host` 放宽至 `0.0.0.0` 并验证远程可达与 401 拦截
    - 修改文件：`~/.pi/agent/settings.json`、`ops/pi_a2a_daemon.sh`
    - 具体动作：在 `peerTokens` 已验证非空的前提下，将 `server.host` 改为 `"0.0.0.0"`，通过 `ops/pi_a2a_daemon.sh` 在 `tmux` 内重启服务。
    - 验收命令（从电脑端通过 Tailscale IP 执行）：
      1. 发现接口：`curl -fsSL http://<PI_TAILSCALE_IP>:9910/.well-known/agent-card.json | jq .name`（返回 `"pi-executor"`）；
      2. 鉴权拦截：`curl -s -o /dev/null -w "%{http_code}" -X POST http://<PI_TAILSCALE_IP>:9910/ -H "Content-Type: application/json" -H "Authorization: Bearer wrong_token" -d '{"jsonrpc":"2.0","id":1,"method":"SendMessage"}'`（严格返回 `401` 或 `403`）。

---------------- 【阶段Ⅲ：功能实现 (Feature Implementation)】 ----------------
[ ] T-PI-04 [预计 20m]：执行最小真实工作区 Task 闭环并校验结构化 Artifact 与 `childTranscripts`
    - 操作文件：`$HOME/workspace/projects/a2a_smoke_test/`
    - 具体动作：接收电脑端发来的 `SendMessage` 指令，在 `$HOME/workspace/projects/a2a_smoke_test/` 下创建 `probe.py`、运行测试、计算 SHA256，并在响应 Artifact 中回传结构化 JSON 摘要。
    - 验收命令：
      手机端检查 `ls -la ~/.pi/agent/transcripts/` 存在最新会话记录；`$HOME/workspace/projects/a2a_smoke_test/probe.py` 真实存在且哈希与回传 Artifact 一致。
================================================================================
```

---

### 3.3 `mod-a2a-network-keepalive-aimstodolist-20261028.txt`

```text
================================================================================
mod-a2a-network-keepalive-aimstodolist-20261028.txt
================================================================================
【当前模块工序锁】：WIP=0（与 mod-a2a-pi-server 阶段Ⅱ协同推进）

---------------- 【阶段Ⅰ：基础落地 (Foundation Landing)】 ----------------
[ ] T-NET-01 [预计 10m]：电脑与手机双端 Tailscale 组网并锁定静态 CGNAT 虚拟 IP
    - 具体动作：在电脑与手机上登录同一 Tailscale 网络，在管理台禁用手机节点 Key Expiry，记录手机端 `100.x.y.z` 虚拟 IP。
    - 验收命令：`tailscale ping -c 5 <PI_TAILSCALE_IP>`（5/5 pong，直接 P2P 或低延迟 DERP，丢包率 0%）。

---------------- 【阶段Ⅱ：相关配套 (Supporting Facilities)】 ----------------
[ ] T-NET-02 [预计 15m]：落地 Android Termux 保活五件套与 Phantom Process 豁免（攻克缺口 G2）
    - 执行环境：手机 Termux + ADB
    - 具体动作：
      1. Termux 内执行 `termux-wake-lock`（确认通知栏显示 `TermuxWakeLock held`）；
      2. Android 设置 -> 应用 -> Termux & Tailscale -> 电池 -> 设为“无限制（Unrestricted）”；
      3. 连接电源适配器保持插电状态；
      4. （Android 12+ 必做）通过 ADB 执行幻影进程限制豁免：
         `adb shell "/system/bin/device_config set_sync_disabled_for_tests persistent && /system/bin/device_config put activity_manager max_phantom_processes 2147483647 && settings put global settings_enable_monitor_phantom_procs false"`
    - 验收命令：`adb shell dumpsys deviceidle whitelist | grep com.termux` 有输出。

[ ] T-NET-03 [预计 15m]：部署 `ops/pi_a2a_daemon.sh` 实现 `tmux` 托管与 60s 端口自愈巡检
    - 创建文件：`$HOME/bin/pi_a2a_daemon.sh`
    - 具体动作：编写并启动 `tmux` 会话 `pi-a2a`，内嵌守护循环：若检测到 `127.0.0.1:9910` 无响应则自动重拉 Pi A2A Server 并记入本地日志。
    - 验收命令：`tmux ls | grep pi-a2a` 存在；执行 `tmux detach` 退出终端后，从电脑 `curl http://<PI_TAILSCALE_IP>:9910/.well-known/agent-card.json` 仍返回 200。

---------------- 【阶段Ⅲ：功能实现 (Feature Implementation)】 ----------------
[ ] T-NET-04 [预计 20m]：手机息屏静置 15 分钟后台存活压测与网络切换韧性验证
    - 具体动作：按下手机电源键息屏，静置 15 分钟；期间电脑端每 3 分钟发起一次 Agent Card 探测与轻量 `SendMessage` 探针。
    - 验收命令：`python3 tests/test_e2e_a2a_pipeline.py --keepalive-probe`（连续探测 100% 200 OK，无 Connection Reset）。
================================================================================
```

---

### 3.4 `mod-a2a-codex-client-aimstodolist-20261028.txt`

```text
================================================================================
mod-a2a-codex-client-aimstodolist-20261028.txt
================================================================================
【当前模块工序锁】：WIP=0（排在 T-PI-03 完成后接棒）

---------------- 【阶段Ⅰ：基础落地 (Foundation Landing)】 ----------------
[ ] T-CDX-01 [预计 15m]：安装 `codex-a2a` 并验证本地 `codex` CLI 可用性
    - 执行环境：本地电脑（PC）
    - 具体动作：
      1. 验证 `codex --version` 正常输出且模型认证有效；
      2. 执行 `uv tool install codex-a2a`（或 `pipx install codex-a2a`）；
      3. 验证 `codex-a2a --help` 包含 `serve` 与 `call` 子命令。
    - 验收命令：`codex-a2a --help` 退出码 0。

---------------- 【阶段Ⅱ：相关配套 (Supporting Facilities)】 ----------------
[ ] T-CDX-02 [预计 15m]：编写 `ops/codex_a2a_launcher.sh` 注入 `NO_PROXY` 并启动本地 `codex-a2a serve`（攻克缺口 G4）
    - 创建文件：`ops/codex_a2a_launcher.sh`
    - 具体动作：
      1. 校验 `.env.a2a` 中 `CODEX_WORKSPACE_ROOT`、`A2A_CLIENT_BEARER_TOKEN`、`PI_A2A_ENDPOINT` 非空；
      2. 强制导出 `A2A_HOST=127.0.0.1`、`A2A_PORT=8000` 及 `NO_PROXY="127.0.0.1,localhost,100.64.0.0/10"`；
      3. 启动 `codex-a2a serve` 并验证本地 Agent Card。
    - 验收命令：`curl -fsSL http://127.0.0.1:8000/.well-known/agent-card.json | jq .name` 返回 200。

[ ] T-CDX-03 [预计 15m]：使用 CLI `codex-a2a call` 完成首次跨网络手工委派测试
    - 执行命令：
      `codex-a2a call "$PI_A2A_ENDPOINT" "Create $HOME/workspace/projects/a2a_ping.txt with content: pong_from_pi and return its sha256" --token "$A2A_CLIENT_BEARER_TOKEN"`
    - 验收断言：终端返回 JSON 包含 `status: "completed"` 及文件 `sha256` 值。

---------------- 【阶段Ⅲ：功能实现 (Feature Implementation)】 ----------------
[ ] T-CDX-04 [预计 20m]：在 Codex 交互会话中触发自主 `a2a_call` 委派与 Artifact 验收闭环
    - 具体动作：在 Codex 会话中输入自然语言指令：“请委派手机上的 Pi Agent 在 `~/workspace/projects/demo_pkg/` 下创建一个带单元测试的 Python 计算模块，运行 `pytest`，并把测试通过摘要和文件 SHA256 回传给我。”
    - 验收断言：Codex 自主调用 `a2a_call(url, message)` 工具（而非本地 bash），准确解析 Pi 回传的 Artifact 并向用户展示测试结果与文件哈希。
================================================================================
```

---

### 3.5 `mod-a2a-artifact-audit-aimstodolist-20261028.txt`

```text
================================================================================
mod-a2a-artifact-audit-aimstodolist-20261028.txt
================================================================================
【当前模块工序锁】：WIP=0（排在 T-CDX-04 完成后执行全链路终验）

---------------- 【阶段Ⅰ & Ⅱ：状态机与校验器配套】 ----------------
[ ] T-ART-01 [预计 20m]：实现长短任务双模轮询客户端 `A2ATaskPoller`（`GetTask` + `CancelTask`，攻克缺口 G3）
    - 创建文件：`src/engines/a2a-rpc-engine/a2a_client_poller.py`
    - 具体动作：实现带 Bearer Token 与 `NO_PROXY` 保障的 JSON-RPC 2.0 客户端，支持同步 `SendMessage`、超时自动转 `GetTask` 指数退避轮询（5s/10s/20s/30s）以及异常时调用 `CancelTask`。
    - 验收命令：`python3 src/engines/a2a-rpc-engine/a2a_client_poller.py --self-test` 通过。

[ ] T-ART-02 [预计 15m]：实现结构化 Artifact 校验器（攻克缺口 G6）
    - 创建文件：`src/engines/artifact-sync-engine/artifact_validator.py`
    - 具体动作：校验 Pi 回传的 Artifact 是否符合 `StructuredExecutionArtifact` 规范（含 `exit_code`、`changed_files`、64 位 hex `sha256` 且单报文 `< 4MB`）。
    - 验收命令：`python3 -m unittest tests/test_a2a_schema_and_security.py` 全绿。

---------------- 【阶段Ⅲ：端到端回归测试矩阵】 ----------------
[ ] T-ART-03 [预计 20m]：运行 6 维端到端自动化回归测试矩阵 `tests/test_e2e_a2a_pipeline.py`
    - 执行命令：`python3 tests/test_e2e_a2a_pipeline.py`
    - 验收断言：6 项测试（AgentCard 可达、401 鉴权拒绝、最小 Task 闭环、结构化 Artifact 哈希对账、异步 GetTask/超时保护、tmux 保活探针）100% PASS。
================================================================================
```
