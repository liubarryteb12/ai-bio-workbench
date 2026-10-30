# Codex（电脑）↔ Pi Agent（手机 Termux）A2A 协作工程 —— 02. 各模块 `aimstodolist`（When & Who 瞬态执行流水）全集（全量升级版 v1.1.0）

> **文档编号与时间戳**：`02_aimstodolist_Codex-Pi-A2A协作工程_20261028.md`（生成时间：`2026-10-28 15:00:00 +08:00`）
> **文档角色**：【1 + N×3 体系】中的 **`[模块名]-aimstodolist-20261028.txt` 汇总卷**（管控当前正在执行哪一步、`< 30 分钟` 原子任务拆解、`WIP=1` 单项工序锁、精确修改文件、验收命令与实测凭证；随工程封板归档）
> **全局工序铁律**：严格遵循 **「阶段Ⅰ：基础落地 → 阶段Ⅱ：相关配套 → 阶段Ⅲ：功能实现」** 单向顺序推进，严禁跨阶段跳跃！全平台同一时刻仅允许 **1 个原子任务** 处于 `[WIP=1]` 状态。

---

## 一、 全局 1 + N×3 瞬态施工总盘点（基于 v1.1.0 全量工程基线）

| 模块卡带名称 | 阶段Ⅰ（基础落地） | 阶段Ⅱ（相关配套） | 阶段Ⅲ（功能实现） | 当前模块工序锁状态 | 关联攻克缺口 |
| :--- | :---: | :---: | :---: | :--- | :--- |
| **`mod-core-engines`**（底座与台账治理） | 2 项 | 1 项 | 1 项 | **T-CORE-01~03 PASS，T-CORE-04 等待提交授权** | G5（路径越界）、G7（台账缺失） |
| **`mod-a2a-pi-server`**（手机 Pi 执行端 + 幂等执行器） | 1 项 | 3 项 | 1 项 | **T-PI-01/02/02B/04 PASS，T-PI-03 BLOCKED（Tailscale）** | G1（无Token暴露）、G5（`/sdcard`）、**G8（断链重跑与改码）** |
| **`mod-a2a-network-keepalive`**（专网与双服务保活） | 1 项 | 2 项 | 1 项 | **T-NET-02~04 PASS，T-NET-01 BLOCKED（Tailscale）** | G2（Doze/幻影进程杀手）、G4（公网暴露） |
| **`mod-a2a-codex-client`**（电脑 Codex 传算分离编排端） | 1 项 | 2 项 | 1 项 | **T-CDX-01~03 PASS，T-CDX-04 已取得 CLI 兼容通道双层验收证据，等待原生 `a2a_call` 证据** | G4（7890代理劫持）、G6（非标调用）、**G8（传算分离）** |
| **`mod-pi-observability`**（`18787` 手机 Pi 观测与模型管控） | 1 项 | 1 项 | 2 项 | **T-OBS-01~04 PASS，runtime slots ready** | **G9（18787 页面看调用、日志、改模型、算账单）** |
| **`mod-a2a-artifact-audit`**（双模状态机与回归矩阵） | 1 项 | 1 项 | 3 项 | **T-ART-01~05 PASS** | G3（300s超时孤儿）、G6（Artifact非标）、**G8（断链续领）** |

---

## 二、 全局跨模块串并施工拓扑图（Critical Path v1.1.0）

```text
[T-CORE-01 ~ 02: 最高纲领 v1.1 落盘 (D-01~D-12) + 双平面目录 & 56位高熵 Token 生成]
       │
       ├──► [T-PI-01 ~ 02: Termux 安装 Pi + @bacnh85/pi-a2a + 写入 peerTokens/defaultModel 配置]
       │           │
       │           ▼
       │    [T-PI-02B: 部署 `ops/pi_idempotent_runner.sh` 幂等防重跑包装器 (.lock/.done + 只读母版锁)]
       │           │
       ├──► [T-NET-01 ~ 02: Tailscale 固定 IP + WakeLock / 电池无限制 / Android 12+ Phantom 豁免]
       │           │
       │           ▼
       ├──► [T-OBS-01: 手机端部署 `:9911` 遥测与模型管控服务 `ops/pi_telemetry_sidecar.py`]
       │           │
       │           ▼
       └──► [T-NET-03 & T-PI-03: `pi_a2a_daemon.sh` 在 tmux 内双窗口托管 (:9910 + :9911) 并放宽 0.0.0.0]
                   │
                   ├──► [T-OBS-02 ~ 04: `18787` 挂载 `pi_agent_routes.js` 与 React `PiAgentMonitor` 四联监控页]
                   │
                   ▼
            [T-CDX-01 ~ 03: PC 启动 `codex-a2a` (NO_PROXY) + 预构建脚本同步 + 异步 SendMessage 首次派单]
                   │
                   ▼
            [T-PI-04 & T-CDX-04: Pi 通过 `pi_idempotent_runner.sh` 自治运行预构建脚本并回传结构化 Artifact 与 `preliminary_acceptance`]
                   │
                   ▼
            [T-ART-01 ~ 04 & T-CORE-04: 模拟断链重发验证“零重跑” + Codex `final_acceptance` 终验 + 18787 热切换模型验证 + 8 维全量回归封板]
```

---

## 三、 分模块 `aimstodolist` 原子任务流水单（严格按「基础落地 → 相关配套 → 功能实现」排序）

### 3.1 `mod-core-engines-aimstodolist-20261028.txt`

```text
================================================================================
mod-core-engines-aimstodolist-20261028.txt
================================================================================
【当前模块工序锁】：WIP=1（T-CORE-04 等待用户授权原子提交与 release 分支）

---------------- 【阶段Ⅰ：基础落地 (Foundation Landing)】 ----------------
[x] T-CORE-01 [预计 15m]：初始化工程目录骨架并落盘《00.最高技术纲领 v1.1.0》与 D-01~D-12 裁定
    - 修改/创建文件：
      1. `00.最高技术纲领-20261028.txt`
      2. `con_hf/SPEC_DECISIONS.md`
      3. `con_hf/ledger/{actions,changes,errors,fixes,pitfalls}.jsonl`
      4. `.gitignore`（强制忽略 `.env.a2a`、`*settings.local.json`、`*.token`）
    - 具体动作：在电脑编排端创建标准微内核目录树，写入 D-01 ~ D-12 十二项裁定（含 D-11 传算分离幂等防重跑、D-12 18787 遥测与模型管控），初始化五类空 JSONL 台账文件。
    - 验收命令：
      `test -f 00.最高技术纲领-20261028.txt && grep -c "D-12" con_hf/SPEC_DECISIONS.md`（输出 >= 1）。
    - 当前证据：`A2A-D-12` 已由 `ops/a2a_preflight.ps1` 检查为 PASS。

[x] T-CORE-02 [预计 10m]：生成高熵对等认证密钥（Peer Token）并初始化 `.env.a2a.example`
    - 修改/创建文件：`.env.a2a.example`、`.env.a2a`（本地不入库）
    - 具体动作：使用 `python3 -c "import secrets; print('a2a_sec_' + secrets.token_hex(24))"` 生成 56 字符高熵 Token，填入本地 `.env.a2a` 的 `A2A_CLIENT_BEARER_TOKEN`（供 `:9910` A2A 与 `:9911` Telemetry 共用）。
    - 验收命令：
      `git check-ignore -v .env.a2a` 且 `wc -c <<<"$A2A_CLIENT_BEARER_TOKEN"` >= 48。
    - 当前证据：`.env.a2a.example` 门禁 PASS，secret scan PASS，真实 token 仅保存在受控运行时文件。

---------------- 【阶段Ⅱ：相关配套 (Supporting Facilities)】 ----------------
[x] T-CORE-03 [预计 20m]：落地双平面路径守卫 `PathGuard` 与台账索引器 `ops/ledger_indexer.py`（攻克缺口 G5/G7）
    - 修改/创建文件：`src/core/PathGuard.ts`、`ops/ledger_indexer.py`
    - 具体动作：实现 `assertValidMobileWorkspace(path)`（仅放行 `$HOME/workspace` 与 `/mnt/ssd/bio_data`，严禁 `/sdcard`、`/storage/emulated` 与 `..`）及 `ops/ledger_indexer.py`。
    - 验收命令：`python3 ops/ledger_indexer.py --verify`（返回码 0，输出 `LEDGER_VERIFY_OK`）。
    - 当前证据：`python tests/test_a2a_core.py` 25/25 PASS，PathGuard 放行 `/mnt/ssd/bio_data` 且拒绝同前缀伪根，`ops/ledger_indexer.py --verify` 返回 `LEDGER_VERIFY_OK`。

---------------- 【阶段Ⅲ：功能实现 (Feature Implementation)】 ----------------
[ ] T-CORE-04 [预计 15m]：全平台配置与密钥零泄露终验归档
    - 修改/创建文件：`con_hf/runs/2026-10-28_gate_v1/REPORT.md`
    - 具体动作：在全部 6 个模块施工完毕后，运行安全扫描与台账汇总，确认工作树干净、无硬编码密钥，生成最终门禁报告。
    - 验收命令：`git status --porcelain` Clean 且 `python3 ops/ledger_indexer.py --summary` 通过。
    - 当前状态：BLOCKED。release-plan 当前为 347 个文件、assigned 347、unassigned 0、4 batches，G5 处于 awaiting authorized commits；等待用户明确授权提交与 release 分支。secret scan 与 ledger verify 已 PASS。
================================================================================
```

---

### 3.2 `mod-a2a-pi-server-aimstodolist-20261028.txt`（含幂等防重跑执行包装器 `T-PI-02B`）

```text
================================================================================
mod-a2a-pi-server-aimstodolist-20261028.txt
================================================================================
【当前模块工序锁】：WIP=0（T-PI-03 等待 Tailscale 网络条件）

---------------- 【阶段Ⅰ：基础落地 (Foundation Landing)】 ----------------
[x] T-PI-01 [预计 20m]：Termux 基础工具链、Pi Coding Agent 与 `@bacnh85/pi-a2a` 安装及回环探活
    - 执行环境：手机 Termux (`aarch64-linux-android`)
    - 具体动作：
      1. 执行 `pkg update -y && pkg upgrade -y`
      2. 执行 `pkg install -y nodejs git python jq tmux termux-api procps coreutils`
      3. 创建原生工作区：`mkdir -p $HOME/workspace/projects $HOME/bin $HOME/.pi/agent/logs $HOME/.pi/agent/transcripts`
      4. 安装 Pi 核心：`npm install -g --ignore-scripts @earendil-works/pi-coding-agent`
      5. 安装 A2A 扩展：`pi install npm:@bacnh85/pi-a2a`
      6. 启动本地回环测试：在 `pi` 内运行 `/a2a-server start`
    - 验收命令：
      `curl -fsSL http://127.0.0.1:9910/.well-known/agent-card.json | jq -e '.name and .capabilities and .skills'`（返回 0）。
    - 当前证据：`18787 /api/pi-agent/ping` 返回 `online=true`，Agent Card 为 `pi-termux-executor 1.0.0`。

---------------- 【阶段Ⅱ：相关配套 (Supporting Facilities)】 ----------------
[x] T-PI-02 [预计 15m]：写入带默认模型、`peerTokens` 与 `childTranscripts` 的 `~/.pi/agent/settings.json`（攻克缺口 G1/G7/G9）
    - 修改文件：`~/.pi/agent/settings.json`
    - 具体动作：写入 `defaultProvider: "zai"`、`defaultModel: "glm-5.3-flash"`、`thinkingLevel: "high"`，并在 `a2a.server` 节写入 `enabled: true`、`port: 9910`、`peerTokens: { "codex": "<Token>" }`、`trustedPeers: ["codex"]`、`allowAllUsers: false`、`maxConcurrent: 2`、`replyTimeoutSec: 300`、`childTranscripts: true`。
    - 验收命令：
      `jq -e '.a2a.server.enabled == true and (.a2a.server.peerTokens.codex | length) >= 48 and .defaultProvider == "zai" and .defaultModel == "glm-5.3-flash"' ~/.pi/agent/settings.json`
    - 当前证据：`18787 /api/pi-agent/model` 返回 `zai/glm-5.3-flash`，白名单与 pin 同步检查通过。

[x] T-PI-02B [预计 20m]：部署 `ops/pi_idempotent_runner.sh` 幂等防重跑执行包装器与只读母版守卫（攻克缺口 G8）
    - 创建文件：`$HOME/bin/pi_idempotent_runner.sh`（对应工程库 `ops/pi_idempotent_runner.sh`）
    - 具体动作：
      1. 实现 `.step_<id>.done` 检查：脚本 SHA256、输入联合 SHA256、产物路径和产物 SHA256 全部通过时才复用；
      2. 实现 `.step_<id>.lock.d/owner.json` 原子锁：记录 runner PID、child PID/PGID 和输入哈希，通过 `/proc/<pid>/cmdline` 防 PID 复用；child 用 `setsid` 独立进程组运行，TERM、INT、HUP 整组回收，runner 被 SIGKILL 后新调用接管仍存活 child；
      3. 执行前将目标脚本设为只读（`chmod a-w`），将完整 stdout/stderr 重定向至 `system_logs/<step_id>.log`，仅输出最后 12 行压平后的 320 字符 UTF-8 JSON 摘要；PNG 产物校验魔数头和 IEND 尾。
    - 验收命令：
      连续两次运行 `pi_idempotent_runner.sh --project demo --task-id task-demo --step s1 --script ./test.sh --inputs input.txt --outputs out.txt`，断言第一次返回 `"idempotent_status":"fresh_run"`，第二次在 `0.5s` 内返回 `"idempotent_status":"reused_done_checkpoint"`。
    - 当前证据：手机生产 runner SHA256 与本地均为 `1c280a0c399df9daf48c4479c45b54d931054c4facb21f9b57e5893054a3fe26`，路径越界、幂等、只读、并发锁、空锁恢复、TERM 回收、SIGKILL 接管、PNG 头尾和 UTF-8 摘要共 `24/24` 探针 PASS；`tests/test_e2e_a2a_pipeline.py --mode live -v` 12/12 PASS。

[ ] T-PI-03 [预计 10m]：通过安全绑定校验将 `server.host` 放宽至 `0.0.0.0` 并验证远程可达与 401 拦截
    - 修改文件：`~/.pi/agent/settings.json`、`ops/pi_a2a_daemon.sh`
    - 具体动作：在 `peerTokens` 非空前提下，将 `server.host` 改为 `"0.0.0.0"`，通过 `pi_a2a_daemon.sh` 在 `tmux` 内拉起服务。
    - 验收命令（从电脑端通过 Tailscale IP 执行）：
      1. 发现接口：`curl --noproxy "*" -fsSL http://<PI_TAILSCALE_IP>:9910/.well-known/agent-card.json | jq .name`；
      2. 鉴权拦截：`curl --noproxy "*" -s -o /dev/null -w "%{http_code}" -X POST http://<PI_TAILSCALE_IP>:9910/ -H "Authorization: Bearer wrong_token" -d '{}'`（严格返回 `401` 或 `403`）。
    - 当前状态：BLOCKED。鉴权拦截已由 live test_07 验证，跨网可达仍依赖 Tailscale。

---------------- 【阶段Ⅲ：功能实现 (Feature Implementation)】 ----------------
[x] T-PI-04 [预计 20m]：执行预构建脚本自治运行闭环（Strict Runner 模式）并校验 `.done` 锁与 `childTranscripts`
    - 操作目录：`$HOME/workspace/projects/a2a_smoke_test/`
    - 具体动作：由电脑端先把预构建脚本 `build_verify.py` 同步至该目录，再发送 A2A `SendMessage` 让 Pi 调用 `pi_idempotent_runner.sh` 执行，验证产物落盘、`.step_smoke.done` 生成及结构化 Artifact 回传。
    - 验收命令：
      检查 `$HOME/workspace/projects/a2a_smoke_test/.step_smoke.done` 存在且 `jq -e '.exit_code == 0'` 通过。
    - 当前证据：live 幂等执行返回 `fresh_run` 与 `reused_done_checkpoint`，结构化 Artifact 校验通过。
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
    - 具体动作：双端登录同一 Tailscale 账号，禁用手机节点 Key Expiry，记录手机端 `100.x.y.z` 虚拟 IP。
    - 验收命令：`tailscale ping -c 5 <PI_TAILSCALE_IP>`（丢包率 0%）。
    - 当前状态：BLOCKED。官方 Windows MSI 与 Android APK 已校验并暂存，手机 APK 已推送到 `/sdcard/Download/`；电脑安装等待 UAC，手机安装等待解锁确认，登录与静态 IP 尚未完成。`ops/check_transport_keepalive.mjs` 已提供真实预检入口，缺少真实 IP 时不得登记 PASS。证据：`con_hf/runs/2026-10-29_tailscale_bootstrap/REPORT.md`。

---------------- 【阶段Ⅱ：相关配套 (Supporting Facilities)】 ----------------
[x] T-NET-02 [预计 15m]：落地 Android Termux 保活五件套与 Phantom Process 豁免（攻克缺口 G2）
    - 具体动作：
      1. Termux 内执行 `termux-wake-lock`；
      2. Android 设置 -> 应用 -> Termux & Tailscale -> 电池 -> 设为“无限制（Unrestricted）”；
      3. 保持物理插电；
      4. Android 12+ 通过 ADB 豁免幻影进程限制：`max_phantom_processes=2147483647` 与 `settings_enable_monitor_phantom_procs=false`。
    - 验收命令：`adb shell dumpsys deviceidle whitelist | grep com.termux` 有输出。
    - 当前状态：PASS。2026-10-29 实测 `dumpsys power` 持有 `termux:service-wakelock`，`dumpsys deviceidle whitelist` 含 `user,com.termux`，`dumpsys battery` 为 `AC powered: true`，Phantom 为 `monitor=false max=2147483647`；15 分钟息屏与断链压测见 `LIVE_SOAK_15M.json`。

[x] T-NET-03 [预计 15m]：部署 `ops/pi_a2a_daemon.sh` 在 `tmux` 会话中同时托管 `:9910` (A2A) 与 `:9911` (Telemetry)
    - 创建文件：`$HOME/bin/pi_a2a_daemon.sh`
    - 具体动作：在 `tmux` 会话 `pi-a2a` 中创建两个窗口：Window 0 运行 `pi` (`/a2a-server start` 监听 `:9910`)，Window 1 运行 `python3 $HOME/bin/pi_telemetry_sidecar.py` (监听 `:9911`)，并附带每 60 秒自愈巡检。
    - 验收命令：`tmux list-windows -t pi-a2a` 显示 2 个活跃窗口；`curl http://127.0.0.1:9910/.well-known/agent-card.json` 与 `curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9911/api/telemetry/overview` 均返回 200。

---------------- 【阶段Ⅲ：功能实现 (Feature Implementation)】 ----------------
[x] T-NET-04 [预计 20m]：手机息屏 15 分钟 + 模拟电脑断网重连下的长任务不中断压测
    - 具体动作：触发一个耗时 180 秒的手机端预构建脚本任务，随即手机息屏并暂时断开电脑 Wi-Fi 60 秒；恢复网络后通过 `GetTask` 查询任务状态。
    - 验收断言：手机端进程未中断、未重跑，电脑恢复连接后第一次 `GetTask` 即顺利拿到 `completed` 状态与完整 Artifact。
    - 当前证据：`con_hf/runs/2026-10-28_a2a_v1_2/LIVE_SOAK_15M.json`，180 秒任务、60 秒断链、900 秒息屏探活全部通过，`run_count=1` 且 Artifact SHA256 一致。
================================================================================
```

---

### 3.4 `mod-a2a-codex-client-aimstodolist-20261028.txt`

```text
================================================================================
mod-a2a-codex-client-aimstodolist-20261028.txt
================================================================================
【当前模块工序锁】：WIP=0（T-CDX-04 等待会话级 `a2a_call` 工具）

---------------- 【阶段Ⅰ：基础落地 (Foundation Landing)】 ----------------
[x] T-CDX-01 [预计 15m]：安装 `codex-a2a` 并验证本地 `codex` CLI 可用性
    - 具体动作：验证 `codex --version` 可用，执行 `uv tool install codex-a2a`，确认 `codex-a2a --help` 正常。
    - 验收命令：`codex-a2a --help` 退出码 0。

---------------- 【阶段Ⅱ：相关配套 (Supporting Facilities)】 ----------------
[x] T-CDX-02 [预计 15m]：编写 `ops/codex_a2a_launcher.sh` 注入 `NO_PROXY` 并启动本地 `codex-a2a serve`（攻克缺口 G4）
    - 创建文件：`ops/codex_a2a_launcher.sh`
    - 具体动作：导出 `A2A_HOST=127.0.0.1`、`A2A_PORT=8000` 及 `NO_PROXY="127.0.0.1,localhost,100.64.0.0/10,${PI_TAILSCALE_IP}"`，启动 `codex-a2a serve`。
    - 验收命令：`curl -fsSL http://127.0.0.1:8000/.well-known/agent-card.json | jq .name` 返回 200。
    - 当前证据：`python tests/test_pi_a2a_launcher.py -v` 6/6 PASS；launcher 生成 `A2A_STATIC_AUTH_CREDENTIALS` 且不回显凭证。

[x] T-CDX-03 [预计 15m]：验证“先同步预构建脚本、再通过 CLI `codex-a2a call` 触发幂等执行”闭环（攻克缺口 G8）
    - 执行动作：
      1. 将预构建脚本同步至手机端 `$HOME/workspace/projects/demo/` 并锁只读；
      2. 执行 `codex-a2a call "$PI_A2A_ENDPOINT" "Run pi_idempotent_runner.sh --project demo --step step_01 --script ./run.sh --outputs result.tsv" --token "$A2A_CLIENT_BEARER_TOKEN"`。
    - 验收断言：返回 JSON 中 `status: "completed"` 且 `idempotent_status` 为 `"fresh_run"`；立即重发同一命令，1 秒内返回 `"reused_done_checkpoint"`。
    - 当前证据：`con_hf/runs/2026-10-28_a2a_v1_2/PROGRESS.md` 记录 task `task-bf9fa4fedda44eca` 为 `fresh_run`，task `task-173cb9c90f494b0b` 为 `reused_done_checkpoint`。

---------------- 【阶段Ⅲ：功能实现 (Feature Implementation)】 ----------------
[ ] T-CDX-04 [预计 20m]：在 Codex 会话中自主使用 `a2a_call` 派发预构建任务流并验收 Artifact
    - 具体动作：在 Codex 会话中下达指令，验证 Codex 直接通过 `a2a_call` 向 Pi 的 `:9910` 发送结构化任务单，任务单包含目标、工作目录、输入、输出、验收命令、`preliminary_acceptance` 和 `final_acceptance`。Pi 自己跑完已构建脚本，Codex 不亲自下场逐条跑远程 Shell。
    - 验收断言：Pi 回传 `preliminary_acceptance.passed=true` 与结构化 Artifact；Codex 独立复核 `exit_code`、`script_sha256`、`inputs_sha256`、`changed_files`、产物存在性和验收命令结果，并生成 `final_acceptance.passed=true`。任一层缺失或哈希不一致即拒绝完成。
    - 当前状态：ADOPTED，PENDING。2026-10-29 已通过 `codex-a2a` CLI 加 `ops/codex_a2a_compat_proxy.py` 兼容通道完成一次真实会话级双层验收：task `task-764ae4e85edd47e6`，Pi `preliminary_acceptance.passed=true`，Codex `final_acceptance.passed=true`，GetTask 读回 `TASK_STATE_COMPLETED`。证据见 `con_hf/runs/2026-10-29_t_cdx_04/REPORT.md` 与 `evidence.json`。当前会话未暴露原生 `a2a_call` MCP 工具，按原验收口径 CLI 兼容通道只算替代证据，保持未勾选。
================================================================================
```

---

### 3.5 `mod-pi-observability-aimstodolist-20261028.txt`（新增：BioanalysDesktop `18787` 监控与模型管控流水单）

```text
================================================================================
mod-pi-observability-aimstodolist-20261028.txt
================================================================================
【当前模块工序锁】：WIP=0（排在 T-PI-03 完成后并入 18787 工作台）

---------------- 【阶段Ⅰ：基础落地 (手机端 :9911 遥测与模型管控 Sidecar)】 ----------------
[x] T-OBS-01 [预计 20m]：在手机 Termux 部署 `ops/pi_telemetry_sidecar.py` 并验证 `:9911` 鉴权与数据采集（攻克缺口 G9）
    - 创建文件：`$HOME/bin/pi_telemetry_sidecar.py`（对应工程库 `ops/pi_telemetry_sidecar.py`）
    - 具体动作：
      1. 监听 `0.0.0.0:9911`，强制校验请求头 `Authorization: Bearer <peerTokens.codex>`；
      2. 实现 `/api/telemetry/overview`（解析 `settings.json`、`transcripts/*.jsonl` Token 账单、Termux 内存/电池/WakeLock）；
      3. 实现 `/api/telemetry/logs`（支持拉取 `pi_a2a_daemon.log` 或单任务 `<task_id>.jsonl`）；
      4. 实现 `POST /api/telemetry/model`（校验 `ALLOWED_MODELS` 白名单并原子更新 `~/.pi/agent/settings.json`）。
    - 验收命令：
      无 Token 请求返回 `401`；带正确 Token 请求 `curl --noproxy "*" -H "Authorization: Bearer $A2A_CLIENT_BEARER_TOKEN" http://<PI_TAILSCALE_IP>:9911/api/telemetry/overview | jq -e '.ok == true and .current_model.model != null'` 返回 0。

---------------- 【阶段Ⅱ：相关配套 (18787 服务端代理路由与台账记录)】 ----------------
[x] T-OBS-02 [预计 15m]：在 `BioanalysDesktop/server/pi_agent_routes.js` 挂载 `/api/pi-agent/*` 代理路由
    - 创建/修改文件：`BioanalysDesktop/server/pi_agent_routes.js`、`BioanalysDesktop/server/index.js`
    - 具体动作：
      1. 使用 `node:http` 且锁死 `agent: false`（绕过本地 `7890` 代理）连接手机 `:9910` 与 `:9911`；
      2. 在服务端注入 `A2A_CLIENT_BEARER_TOKEN`（前端零密钥暴露）；
      3. 每次模型切换或探针派发自动写入 `con_hf/ledger/actions.jsonl`。
    - 验收命令：`node --input-type=module --check < BioanalysDesktop/server/pi_agent_routes.js` 零报错，且 `curl -fsSL http://127.0.0.1:18787/api/pi-agent/overview | jq .ok` 返回 `true`。

---------------- 【阶段Ⅲ：功能实现 (18787 前端四联监控与模型管控页面)】 ----------------
[x] T-OBS-03 [预计 20m]：落地 React `PiAgentMonitor` 四联监控工作台并保持 `SlotManager` 数据层契约
    - 修改文件：`BioanalysDesktop/src/App.tsx`、`src/mods/mod-pi-observability/manifest.ts`、`src/mods/mod-pi-observability/slots/PiObservabilitySlots.ts`
    - 具体动作：在 `PiAgentMonitor` 中实现顶部状态卡、调用与 Artifact 台账、守护日志与任务轨迹双流、模型白名单热切换、分模型 Token 统计；`SlotManager` 的 `workbench.selfcheck-cards` 与 `workbench.studio-preview` 插槽由核心契约测试覆盖。
    - 验收命令：`npm run build` 在 `BioanalysDesktop` 目录退出码 0，`node --test --test-concurrency=1 BioanalysDesktop/tests/pi_agent.test.js BioanalysDesktop/tests/pi_agent_routes.test.js` 全部通过。

[x] T-OBS-04 [预计 15m]：在 `18787` 页面实测“切换手机端模型 + 派发探针任务 + 查看实时日志与账单”闭环
    - 具体动作：在 `18787` 页面将模型切换到默认的 `glm-5.3-flash`，点击派发测试任务，观察日志流实时滚动、Artifact 弹窗验签与 Token 账单增长；同时验证 `GET /api/pi-agent/ping` 返回 Agent Card 可达。
    - 验收断言：手机端 `jq -r .defaultModel ~/.pi/agent/settings.json` 输出 `glm-5.3-flash`，`con_hf/ledger/actions.jsonl` 新增一条 `pi_agent_model_switch` 记录，`GET /api/pi-agent/ping` 返回 `ok=true`。
    - 当前证据：2026-10-29 实测 `/api/pi-agent/model`、`/api/pi-agent/ping` 均 `ok=true`；派发 task `task-38e8114e6a0c443e` 返回 `AIMS_OBS_PROBE_OK_20261029`；台账新增 `pi_agent_model_switch` 与 `pi_agent_a2a_dispatch`。
================================================================================
```

---

### 3.6 `mod-a2a-artifact-audit-aimstodolist-20261028.txt`

```text
================================================================================
mod-a2a-artifact-audit-aimstodolist-20261028.txt
================================================================================
【当前模块工序锁】：WIP=0（T-ART-05 已完成，异步状态机闭环）

---------------- 【阶段Ⅰ & Ⅱ：状态机、断链续领与校验器配套】 ----------------
[x] T-ART-01 [预计 20m]：实现支持断链状态持久化与续领的 `A2AClientPoller`（`GetTask` + `CancelTask`，攻克缺口 G3/G8）
    - 创建文件：`src/engines/a2a-rpc-engine/a2a_client_poller.py`
    - 具体动作：
      1. 发送 `SendMessage` 获取 `task_id` 后，立即将 `{task_id, step_id, endpoint}` 持久化至本地 `local_projects/<project>/debug/active_a2a_task.json`；
      2. 若等待期间电脑网络闪断或客户端重启，恢复后直接读取 `active_a2a_task.json` 调用 `GetTask(task_id)` 续领结果，绝不重发 `SendMessage`。
    - 验收命令：`python3 src/engines/a2a-rpc-engine/a2a_client_poller.py --self-test` 通过。

[x] T-ART-02 [预计 15m]：实现结构化幂等 Artifact 校验器（攻克缺口 G6/G8）
    - 创建文件：`src/engines/artifact-sync-engine/artifact_validator.py`
    - 具体动作：校验 Pi 回传的 Artifact 包含 `idempotent_status`、`script_sha256`、`exit_code == 0`、`changed_files` 64 位 SHA256 且单报文 `< 4MB`。
    - 验收命令：单元测试全绿。

---------------- 【阶段Ⅲ：8 维端到端自动化回归测试矩阵】 ----------------
[x] T-ART-03 [预计 20m]：运行 8 维端到端自动化回归测试套件 `tests/test_e2e_a2a_pipeline.py`
    - 执行命令：`python3 tests/test_e2e_a2a_pipeline.py --mode contract`（及真机 `--mode live`）
    - 验收断言：8 项核心测试（PathGuard 隔离、0.0.0.0 绑定锁、幂等 `.done` 防重跑、并发 `.lock` 防重入、结构化 Artifact 哈希对账、AgentCard 发现、401 鉴权拦截、`:9911` 遥测与模型切换校验）100% PASS。
    - 当前证据：`tests/test_a2a_artifact.py` 为 `15/15 PASS`，`tests/test_a2a_e2e_artifact.py --live` 为 `16/16 PASS`；`python tests/test_e2e_a2a_pipeline.py --mode contract -v` 实测 8 条测试、允许 1 个 live 类 skip，`--mode live -v` 实测 12/12 PASS，路径守卫、Artifact 相对路径和断链续领均已覆盖。

[x] T-ART-04 [预计 15m]：实现 Pi 初验与 Codex 终验的双层验收状态机
    - 修改文件：`src/engines/artifact-sync-engine/artifact_validator.py`、`src/engines/artifact-sync-engine/artifact_extractor.py`、`src/engines/a2a-rpc-engine/a2a_client_poller.py`、`tests/test_a2a_poller_state.py`、`tests/test_a2a_artifact.py`、`tests/test_a2a_acceptance_live.py`
    - 具体动作：
      1. 在 Artifact 校验中加入 `preliminary_acceptance`，要求 Pi 返回逐项检查结果，并拒绝只有自然语言总结的完成声明。
      2. 新增 `final_acceptance` 记录，由 Codex 独立核对退出码、脚本与输入哈希、产物路径与哈希、验收命令和修改范围。
      3. 任务状态只有同时存在 `preliminary_acceptance.passed=true` 与 `final_acceptance.passed=true` 时才允许进入 `completed`。
    - 验收命令：`python3 tests/test_e2e_a2a_pipeline.py --mode contract -v`，新增用例覆盖 Pi 假阳性、哈希不一致、缺字段和路径不可见四种失败。
    - 当前状态：PASS。`python -m unittest tests.test_a2a_poller_state -v` 为 `7/7 PASS`，`tests.test_a2a_artifact` 为 `24/24 PASS`；`A2A_LIVE_E2E=1 python -m unittest tests.test_a2a_acceptance_live -v` 为 `1/1 PASS`，真实验证了 `awaiting_final_acceptance -> completed`。

[x] T-ART-05 [预计 20m]：完成 D-06 异步派发、GetTask、CancelTask 与终态归一化
    - 修改文件：`BioanalysDesktop/server/a2a_state.js`、`BioanalysDesktop/server/pi_agent.js`、`BioanalysDesktop/server/pi_agent_routes.js`、`BioanalysDesktop/src/App.tsx`、`BioanalysDesktop/tests/a2a_state.test.js`、`BioanalysDesktop/tests/pi_agent_routes.test.js`、`ops/a2a_preflight.ps1`
    - 具体动作：
      1. `SendMessage` 默认携带 `returnImmediately: true`，显式 `false` 时保留阻塞模式。
      2. `GET /api/pi-agent/task?id=<task_id>` 使用 `GetTask` 续领，`POST /api/pi-agent/task/cancel` 使用 `CancelTask` 回收。
      3. 将 Pi 的 `TASK_STATE_COMPLETED/FAILED/CANCELED/REJECTED` 统一归一化为小写终态，同时保留 `status.remote_state` 供审计。
      4. 前端终态判断与 24 小时超时取消结果统一使用归一化状态。
    - 验收命令：`node --test --test-concurrency=1 BioanalysDesktop/tests/pi_agent.test.js BioanalysDesktop/tests/pi_agent_routes.test.js BioanalysDesktop/tests/a2a_state.test.js`
    - 当前状态：PASS。Node 定向测试 `19/19 PASS`；真实 completed 任务 `task-29397fdbcca0471c` 返回 `state=completed`、`remote_state=TASK_STATE_COMPLETED`；真实 canceled 任务 `task-a48fe1e057bb4885` 返回 `state=canceled`、`remote_state=TASK_STATE_CANCELED`。
================================================================================
```
