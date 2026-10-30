# Codex（电脑）↔ Pi Agent（手机 Termux）A2A 协作工程 —— 03. 各模块 `aims落地`（How & Architecture 持久态工程底座）全集（全量升级版 v1.1.0）

> **文档编号与时间戳**：`03_aims落地_Codex-Pi-A2A协作工程_20261028.md`（生成时间：`2026-10-28 15:00:00 +08:00`）
> **文档角色**：【1 + N×3 体系】中的 **`[模块名]-aims落地-20261028.txt` 汇总卷**（持久态工程底座：定义物理目录与插座映射、完整生产级配置文件、可直接落盘运行的守护与幂等防重跑执行脚本、手机端 `:9911` 遥测 Sidecar、`18787` 后端路由模块、A2A v1.0 JSON-RPC 2.0 全方法报文契约、断链续领轮询器以及 8 维自动化回归测试套件。即便 `aimstodolist` 归档销毁，任何工程师或 Agent 仅凭此文档即可 100% 重建整套系统）

---

## 一、`mod-a2a-pi-server-aims落地-20261028.txt`（手机 Termux 执行端 + 幂等防重跑执行底座）

### 1.1 手机端物理目录结构与路径隔离红线（D-08 & D-11）
手机 Termux 端所有配置与工作区严格限制在原生 `ext4`/`f2fs` 文件系统（`/data/data/com.termux/files/home/`，即 `$HOME`，以及容器算力根 `/mnt/ssd/bio_data/`）内，**严禁将工作区建在 `/sdcard` 或 `/storage/emulated/0`**：

```text
/data/data/com.termux/files/home/ ($HOME)
├── .pi/
│   └── agent/
│       ├── settings.json                       # 【核心配置】默认模型 + @bacnh85/pi-a2a Server 鉴权配置
│       ├── SYSTEM_PROMPT_STRICT_RUNNER.md      # 【新增：D-11】Pi 严格执行者系统提示词契约（禁改母版源码）
│       ├── transcripts/                        # 【审计落盘】childTranscripts 子任务轨迹与 Token 账单（保留7天）
│       └── logs/
│           └── pi_a2a_daemon.log               # 守护进程与双端口 (:9910/:9911) 自愈巡检日志
├── bin/
│   ├── pi_termux_bootstrap.sh                  # 阶段Ⅰ：Termux 环境与 Pi + A2A 扩展一键初始化脚本
│   ├── pi_a2a_daemon.sh                        # 阶段Ⅱ：WakeLock + 安全校验 + tmux 双窗口托管 (:9910 & :9911)
│   ├── pi_idempotent_runner.sh                 # 【核心新增：攻克 G8】防断链重跑幂等执行包装器 (.lock / .done / 日志削峰)
│   └── pi_telemetry_sidecar.py                 # 【核心新增：攻克 G9】:9911 遥测、日志流与模型热切换 Sidecar 服务
└── workspace/                                  # 【唯一合法执行工作区根】
    └── projects/
        └── <project_id>/                       # 接收 Codex 预构建脚本与数据的独立项目沙箱
            ├── bin/                            # 电脑同步过来的只读预构建脚本 (chmod a-w)
            ├── system_logs/                    # pi_idempotent_runner.sh 重定向的完整运行日志
            ├── .step_<step_id>.lock            # 运行中 PID 互斥锁（防断链重发导致双进程并发踩踏）
            └── .step_<step_id>.done            # 完成态幂等检查点（含脚本+产物 SHA256 与缓存 Artifact）
```

### 1.2 `~/.pi/agent/settings.json` 生产级完整配置（含默认模型设定与 A2A Server）
基于 `@bacnh85/pi-a2a` 官方键规范与 `18787` 模型管控需求，以下配置同时满足 **D-03（零信任 Token 绑定锁）**、**D-05（移动端并发防 OOM 锁）**、**D-06（300s 阻塞窗口）** 与 **D-12（可热切换的默认模型配置）**：

```json
{
  "defaultProvider": "zai",
  "defaultModel": "glm-5.3-flash",
  "thinkingLevel": "high",
  "temperature": 0.2,
  "a2a": {
    "server": {
      "enabled": true,
      "port": 9910,
      "portFallback": 10,
      "host": "0.0.0.0",
      "agentName": "pi-termux-executor",
      "peerTokens": {
        "codex": "a2a_sec_8f9a2e3b1c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d"
      },
      "trustedPeers": [
        "codex"
      ],
      "allowAllUsers": false,
      "maxConcurrent": 2,
      "replyTimeoutSec": 300,
      "childTranscripts": true,
      "childTranscriptRetentionDays": 7,
      "rateLimitPerMin": 30
    },
    "timeouts": {
      "send": 360000,
      "stream": 120000
    }
  }
}
```

### 1.3 手机端幂等防重跑执行包装器（唯一真源：`ops/pi_idempotent_runner.sh`）

本节只定义接口契约，不再复制实现正文。实现、错误码和自校验以 `ops/pi_idempotent_runner.sh` 为唯一真源，生产部署路径为 `$HOME/bin/pi_idempotent_runner.sh`。

调用接口：

```bash
pi_idempotent_runner.sh \
  --project <project_id> \
  [--task-id <task_id>] \
  --step <step_id> \
  --script <project-relative-or-absolute-path> \
  [--inputs <csv>] \
  [--outputs <csv>]
```

**路径与只读契约**

- `project_id` 与 `step_id` 只接受 `[A-Za-z0-9][A-Za-z0-9._-]*`，拒绝 `..`。
- 工作根、脚本、输入和输出均解析到项目目录内部，并拒绝 `/sdcard`、`/storage/emulated` 与 `/storage/self/primary`。
- 预构建脚本在运行前执行 `chmod a-w`，运行前后各计算一次 SHA256。脚本在运行期间变化时返回 `ERR_SCRIPT_MUTATED_DURING_RUN`，不写 `.done`。

**幂等与完整性契约**

- `.step_<step_id>.done` 必须同时满足以下条件才可复用：
  - `script_sha256` 与当前脚本一致。
  - `inputs_sha256` 与当前输入联合哈希一致。无输入时固定为 `no_inputs_declared`。
  - `changed_files` 的数量、相对路径和 64 位 SHA256 与当前期望产物一致。
  - 产物非空。PNG 必须同时具备 `89504e47` 魔数头和 `0000000049454e44ae426082` IEND 尾。
- 有效命中时返回 `idempotent_status=reused_done_checkpoint`，验收门槛为 `0.5s`。
- 产物被篡改、截断或输入变化时，旧 `.done` 自动失效并重新执行。

**并发、信号与恢复契约**

- 原子锁使用目录 `.step_<step_id>.lock.d`，元数据写入 `owner.json`。
- `owner.json` 记录 runner `pid`、`task_id`、`step_id`、脚本路径、`script_sha256`、`inputs_sha256`、`started_at`，child 启动后补充 `child_pid` 与 `child_pgid`。
- PID 存活判断同时核对 `/proc/<pid>/cmdline`，防止 Android/Linux PID 回绕后误把无关进程当锁持有者。
- child 通过 `setsid` 启动。TERM、INT、HUP 到达 runner 时，向整个 child 进程组发送 TERM，超时后发送 KILL。
- runner 被 SIGKILL 后，新调用发现 child 仍存活时挂载等待，不启动第二个计算进程。child 结束且产物有效时，从 owner 元数据恢复 `.done` 并返回 `attached_running_lock`。
- 初始化窗口、僵尸锁迁移和锁清理均以 `owner.json` 复核为准，避免 TOCTOU 竞态。

**日志与 Artifact 契约**

- 完整 stdout/stderr 重定向到 `system_logs/<step_id>.log`。
- `stdout_summary` 取最后 12 行并压平，再用 `jq -Rsr '.[0:320]'` 按 UTF-8 字符截取 320 字符，禁止按字节截断。
- 成功 Artifact 至少包含 `task_id`、`step_id`、`idempotent_status`、`executed_at`、`workspace_dir`、`script_path`、`script_sha256`、`inputs_sha256`、`exit_code`、`duration_sec`、`log_file`、`changed_files`、`stdout_summary`。
- 只有 `exit_code=0` 且产物完整性通过时才写 `.done`。

**退出码契约**

- `0`：执行成功或有效命中幂等检查点。
- `1`：锁获取或内部自校验失败。
- `2`：参数错误。
- `3`：路径守卫失败。
- `4`：脚本或输入文件缺失。
- `5`：脚本在执行期间被修改。
- `6`：产物完整性校验失败。

### 1.4 手机端 Pi Agent “Strict Runner（严格执行者）”系统提示词契约
文件落点：`~/.pi/agent/SYSTEM_PROMPT_STRICT_RUNNER.md`

```markdown
# Role: Pi Autonomous Strict Runner (A2A Worker Node)

你运行在手机端 Termux 算力环境中，作为电脑端 Codex 的受控执行节点（Strict Runner）。请严格遵守以下铁律：
1. **统一通过幂等包装器执行**：凡收到运行预构建脚本（`.R` / `.py` / `.sh`）的任务，一律调用 `$HOME/bin/pi_idempotent_runner.sh --project <id> --task-id <task_id> --step <step> --script <path> --inputs <csv> --outputs <csv>`，严禁直接裸跑耗时脚本。
2. **严禁擅自修改预构建母版源码**：电脑端下发的构建脚本受 SHA256 对账保护（包含固定随机种子 `20261013` 与视觉规范 `tip.length = 0`）。若脚本运行返回非 0 退出码，**严禁自行修改 `.R`/`.py` 源码尝试蒙混过关**，必须使用 runner 返回的结构化 JSON，必要时只读取 `system_logs/<step>.log` 最后 12 行并封装进 Artifact 返回给 Codex 诊断。
3. **禁止读取海量日志原文**：不要使用 `cat` 读取完整的 `.log` 或 `.tsv` 大文件以免消耗 Token，仅使用 `pi_idempotent_runner.sh` 输出的结构化 JSON 摘要作为最终回复。
4. **必须提交初步验收**：任务结束时返回 `preliminary_acceptance`，逐项列出验收命令、实际退出码、脚本与输入哈希、产物路径与哈希、日志路径和 `passed` 结果。自然语言总结只能作为补充，不能替代结构化初验。
```

### 1.5 Codex -> Pi -> Codex 双层验收任务单

Codex 与 Pi 的主执行通道是 A2A 直连。`18787` 只用于观测、模型切换和人工派发，不进入正式任务的执行链。每个正式任务使用以下任务单结构：

```json
{
  "task_id": "task-<unique-id>",
  "objective": "一句话说明要完成的可验证目标",
  "workspace_dir": "$HOME/workspace/projects/<project>",
  "script_path": "scripts/run.py",
  "inputs": ["data/input.tsv"],
  "outputs": ["results/result.tsv"],
  "acceptance_commands": [
    "python3 scripts/self_check.py --input data/input.tsv --output results/result.tsv"
  ],
  "preliminary_acceptance": {
    "passed": true,
    "exit_code": 0,
    "script_sha256": "<64-hex>",
    "inputs_sha256": "no_inputs_declared",
    "changed_files": [
      {
        "path": "results/result.tsv",
        "sha256": "<64-hex>",
        "action": "created"
      }
    ],
    "log_file": "$HOME/workspace/projects/<project>/system_logs/run.log",
    "checks": [
      {
        "name": "output_nonempty",
        "passed": true,
        "detail": "result.tsv size > 0"
      }
    ]
  },
  "final_acceptance": {
    "passed": true,
    "verifier": "codex",
    "verified_at": "2026-10-29T00:00:00+08:00",
    "modification_scope": "within_workspace",
    "exit_code": 0,
    "script_sha256": "<64-hex>",
    "inputs_sha256": "no_inputs_declared",
    "changed_files": [
      {
        "path": "results/result.tsv",
        "sha256": "<64-hex>",
        "action": "created"
      }
    ],
    "log_file": "$HOME/workspace/projects/<project>/system_logs/run.log",
    "checks": [
      {
        "name": "codex_independent_verification",
        "passed": true,
        "detail": "hash and command checks passed"
      }
    ]
  },
  "max_tool_calls": 15,
  "timeout_sec": 300
}
```

执行顺序：

1. Codex 先同步脚本和数据，再通过 `a2a_call` 直接发送任务单。
2. Pi 调用 `pi_idempotent_runner.sh` 执行，生成 `preliminary_acceptance` 和结构化 Artifact。
3. Codex 读取初步验收报告，独立核对 `exit_code`、`script_sha256`、`inputs_sha256`、`changed_files`、产物存在性和验收命令结果。
4. Codex 生成 `final_acceptance`，两层都通过才标记任务完成。
5. 失败时 Codex 基于 Artifact 和日志创建新任务，先调用 `GetTask` 或 `CancelTask` 确认旧任务状态，再决定是否重派。

`workspace_dir` 必须是 Pi 运行时实际可见的路径。K40 容器内的任务需要提供 Termux 可见的包装脚本，或先明确切换到容器执行环境，不能把容器专属路径直接当作 Termux 路径。

### 1.6 手机端双服务常驻守护脚本（`ops/pi_a2a_daemon.sh`，同时托管 `:9910` 与 `:9911`）

```bash
#!/data/data/com.termux/files/usr/bin/bash
# ==============================================================================
# 文件落点：$HOME/bin/pi_a2a_daemon.sh (对应工程库 ops/pi_a2a_daemon.sh)
# 作用：校验 D-03/D-08 安全红线，获取 WakeLock，并在 tmux 会话中同时托管：
#       - Window 0 (a2a-server): Pi Agent A2A Server (:9910)
#       - Window 1 (telemetry):  pi_telemetry_sidecar.py (:9911, 供 18787 页面观测与改模型)
# ==============================================================================
set -euo pipefail

SESSION_NAME="pi-a2a"
SETTINGS_FILE="$HOME/.pi/agent/settings.json"
WORKSPACE_ROOT="$HOME/workspace/projects"
LOG_DIR="$HOME/.pi/agent/logs"
LOG_FILE="$LOG_DIR/pi_a2a_daemon.log"

mkdir -p "$WORKSPACE_ROOT" "$LOG_DIR"

log_msg() {
  printf "[%s] %s\n" "$(date -Iseconds)" "$1" | tee -a "$LOG_FILE"
}

# 1. [D-08 路径守卫]
REAL_WS="$(realpath "$WORKSPACE_ROOT")"
if [[ "$REAL_WS" == /sdcard* ]] || [[ "$REAL_WS" == /storage/emulated* ]]; then
  log_msg "FATAL [ERR_PATH_GUARD]: WORKSPACE_ROOT ($REAL_WS) 位于 Android FUSE 层，严禁启动！"
  exit 3
fi

# 2. [D-03 零信任绑定守卫]
if [[ ! -f "$SETTINGS_FILE" ]]; then
  log_msg "FATAL [ERR_CONFIG_MISSING]: 找不到 $SETTINGS_FILE"
  exit 1
fi

ENABLED="$(jq -r '.a2a.server.enabled // false' "$SETTINGS_FILE")"
HOST_VAL="$(jq -r '.a2a.server.host // "127.0.0.1"' "$SETTINGS_FILE")"
PORT_VAL="$(jq -r '.a2a.server.port // 9910' "$SETTINGS_FILE")"
ALLOW_ALL="$(jq -r '.a2a.server.allowAllUsers // false' "$SETTINGS_FILE")"
CODEX_TOKEN="$(jq -r '.a2a.server.peerTokens.codex // ""' "$SETTINGS_FILE")"

if [[ "$ENABLED" != "true" ]] || [[ "$ALLOW_ALL" == "true" ]]; then
  log_msg "FATAL [ERR_SECURITY_CONFIG]: enabled!=true 或 allowAllUsers==true"
  exit 2
fi

if [[ "$HOST_VAL" == "0.0.0.0" ]] && [[ "${#CODEX_TOKEN}" -lt 32 ]]; then
  log_msg "FATAL [ERR_SECURITY_BIND]: host=0.0.0.0 但 peerTokens.codex 长度不足 32 位，拒绝启动！"
  exit 2
fi

# 3. [D-05 保活底座]
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock
  log_msg "INFO: termux-wake-lock 已持有。"
fi

# 4. 启动 tmux 双窗口（Window 0: :9910 A2A Server, Window 1: :9911 Telemetry Sidecar）
if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  log_msg "INFO: 创建 tmux 会话 '$SESSION_NAME' 并拉起 :9910 A2A 与 :9911 Telemetry..."
  tmux new-session -d -s "$SESSION_NAME" -n "a2a-server" -c "$WORKSPACE_ROOT"
  tmux send-keys -t "${SESSION_NAME}:a2a-server" "cd '$WORKSPACE_ROOT' && pi" C-m
  sleep 4
  tmux send-keys -t "${SESSION_NAME}:a2a-server" "/a2a-server start" C-m

  tmux new-window -t "$SESSION_NAME" -n "telemetry" -c "$WORKSPACE_ROOT"
  tmux send-keys -t "${SESSION_NAME}:telemetry" "python3 $HOME/bin/pi_telemetry_sidecar.py" C-m
  sleep 2
fi

log_msg "PASS: 双服务已在 tmux 会话 '$SESSION_NAME' 内就绪 (:9910 A2A & :9911 Telemetry)。"
```

---

## 二、`mod-pi-observability-aims落地-20261028.txt`（BioanalysDesktop `18787` 手机 Pi 观测与模型管控底座 —— 攻克 G9）

### 2.1 手机端 `:9911` 遥测与模型热切换服务（`ops/pi_telemetry_sidecar.py`）
该服务运行在手机端 `tmux` 的 `telemetry` 窗口中，与 `:9910` 共用 `~/.pi/agent/settings.json` 中的 `peerTokens.codex` 密钥，向 `18787` 服务端提供调用历史、双流日志、模型热切换与 Token 账单：

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
文件落点：手机端 $HOME/bin/pi_telemetry_sidecar.py (对应工程库 ops/pi_telemetry_sidecar.py)
监听端口：9911（强制校验 settings.json 中的 peerTokens.codex）
"""
import glob
import json
import os
import shutil
import subprocess
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

HOME = os.path.expanduser("~")
SETTINGS_PATH = os.path.join(HOME, ".pi", "agent", "settings.json")
TRANSCRIPTS_DIR = os.path.join(HOME, ".pi", "agent", "transcripts")
DAEMON_LOG_PATH = os.path.join(HOME, ".pi", "agent", "logs", "pi_a2a_daemon.log")
SIDE_PORT = int(os.environ.get("PI_TELEMETRY_PORT", "9911"))

ALLOWED_MODELS = [
    {"provider": "zai", "model": "glm-5.3-flash", "input_price_per_1m": 0.0, "output_price_per_1m": 0.0},
    {"provider": "deepseek", "model": "deepseek-v4.1-flash", "input_price_per_1m": 0.0, "output_price_per_1m": 0.0},
]


def load_settings() -> dict:
    if not os.path.exists(SETTINGS_PATH):
        return {}
    with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def verify_bearer_token(headers) -> bool:
    cfg = load_settings()
    expected = cfg.get("a2a", {}).get("server", {}).get("peerTokens", {}).get("codex", "")
    if not expected or len(expected) < 32:
        return False
    return headers.get("Authorization", "") == f"Bearer {expected}"


def collect_transcripts_and_usage(limit: int = 40) -> dict:
    os.makedirs(TRANSCRIPTS_DIR, exist_ok=True)
    files = sorted(glob.glob(os.path.join(TRANSCRIPTS_DIR, "*.jsonl")), key=os.path.getmtime, reverse=True)
    price_map = {m["model"]: m for m in ALLOWED_MODELS}
    calls, usage_by_model = [], {}
    total_in, total_out, total_cache, total_cost = 0, 0, 0, 0.0

    for fpath in files[:limit]:
        task_id = os.path.basename(fpath).replace(".jsonl", "")
        stat = os.stat(fpath)
        t_in, t_out, t_cache, t_cost = 0, 0, 0, 0.0
        model_used, provider_used, state = "glm-5.3-flash", "zai", "completed"
        prompt_preview, artifact_summary, tool_calls_count = "", "", 0

        try:
            with open(fpath, "r", encoding="utf-8") as f:
                for line in f:
                    if not line.strip():
                        continue
                    evt = json.loads(line)
                    model_used = evt.get("model", model_used)
                    provider_used = evt.get("provider", provider_used)
                    state = evt.get("state", state)
                    if evt.get("role") == "user" and not prompt_preview and evt.get("content"):
                        prompt_preview = str(evt["content"])[:140]
                    elif evt.get("role") == "assistant" and evt.get("content"):
                        artifact_summary = str(evt["content"])[:180]
                    if evt.get("type") == "tool_use" or evt.get("tool_calls"):
                        tool_calls_count += 1
                    u = evt.get("usage", {})
                    t_in += int(u.get("inputTokens", u.get("input_tokens", 0)))
                    t_out += int(u.get("outputTokens", u.get("output_tokens", 0)))
                    t_cache += int(u.get("cacheReadTokens", 0))
                    t_cost += float(u.get("cost", 0.0))
        except Exception:
            state = "failed"

        if t_cost == 0.0 and (t_in > 0 or t_out > 0):
            pm = price_map.get(model_used, {"input_price_per_1m": 0.0, "output_price_per_1m": 0.0})
            t_cost = (t_in / 1e6) * pm["input_price_per_1m"] + (t_out / 1e6) * pm["output_price_per_1m"]

        total_in += t_in
        total_out += t_out
        total_cache += t_cache
        total_cost += t_cost

        b = usage_by_model.setdefault(
            model_used,
            {"provider": provider_used, "model": model_used, "calls": 0, "input_tokens": 0, "output_tokens": 0, "cache_tokens": 0, "cost_usd": 0.0},
        )
        b["calls"] += 1
        b["input_tokens"] += t_in
        b["output_tokens"] += t_out
        b["cache_tokens"] += t_cache
        b["cost_usd"] = round(b["cost_usd"] + t_cost, 4)

        calls.append({
            "task_id": task_id,
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(stat.st_mtime)),
            "duration_sec": max(1.0, round(stat.st_mtime - stat.st_ctime, 1)),
            "provider": provider_used,
            "model": model_used,
            "state": state,
            "tool_calls": tool_calls_count,
            "input_tokens": t_in,
            "output_tokens": t_out,
            "cache_tokens": t_cache,
            "cost_usd": round(t_cost, 4),
            "prompt": prompt_preview,
            "artifact_summary": artifact_summary,
        })

    return {
        "totals": {"total_calls": len(files), "input_tokens": total_in, "output_tokens": total_out, "cache_tokens": total_cache, "cost_usd": round(total_cost, 4)},
        "by_model": list(usage_by_model.values()),
        "recent_calls": calls,
    }


class PiTelemetryHandler(BaseHTTPRequestHandler):
    def _send_json(self, status_code: int, payload: dict):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if not verify_bearer_token(self.headers):
            return self._send_json(401, {"ok": False, "error": "ERR_UNAUTHORIZED"})
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)

        if parsed.path == "/api/telemetry/overview":
            cfg = load_settings()
            srv = cfg.get("a2a", {}).get("server", {})
            tele = collect_transcripts_and_usage(limit=40)
            return self._send_json(200, {
                "ok": True,
                "agent": {"name": srv.get("agentName", "pi-termux-executor"), "a2a_port": srv.get("port", 9910), "max_concurrent": srv.get("maxConcurrent", 2)},
                "current_model": {
                    "provider": cfg.get("defaultProvider", "zai"),
                    "model": cfg.get("defaultModel", "glm-5.3-flash"),
                    "thinking_level": cfg.get("thinkingLevel", "high"),
                    "temperature": cfg.get("temperature", 0.2),
                },
                "allowed_models": ALLOWED_MODELS,
                "usage": tele["totals"],
                "usage_by_model": tele["by_model"],
                "recent_calls": tele["recent_calls"],
            })

        if parsed.path == "/api/telemetry/logs":
            tail_n = min(500, max(10, int(qs.get("tail", ["120"])[0])))
            task_id = qs.get("task_id", [""])[0].strip()
            target = os.path.join(TRANSCRIPTS_DIR, f"{os.path.basename(task_id)}.jsonl") if task_id else DAEMON_LOG_PATH
            if not os.path.exists(target):
                return self._send_json(200, {"ok": True, "source": os.path.basename(target), "lines": []})
            out = subprocess.check_output(["tail", "-n", str(tail_n), target], text=True, errors="replace")
            return self._send_json(200, {"ok": True, "source": os.path.basename(target), "lines": out.splitlines()})

        return self._send_json(404, {"ok": False, "error": "Not found"})

    def do_POST(self):
        if not verify_bearer_token(self.headers):
            return self._send_json(401, {"ok": False, "error": "ERR_UNAUTHORIZED"})
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length).decode("utf-8")) if length > 0 else {}

        if self.path == "/api/telemetry/model":
            provider, model = body.get("provider", ""), body.get("model", "")
            thinking = body.get("thinking_level", "medium")
            temperature = float(body.get("temperature", 0.2))
            max_conc = min(2, max(1, int(body.get("max_concurrent", 2))))
            if not any(m["provider"] == provider and m["model"] == model for m in ALLOWED_MODELS):
                return self._send_json(400, {"ok": False, "error": "ERR_MODEL_NOT_IN_WHITELIST"})

            cfg = load_settings()
            cfg["defaultProvider"] = provider
            cfg["defaultModel"] = model
            cfg["thinkingLevel"] = thinking
            cfg["temperature"] = temperature
            cfg.setdefault("a2a", {}).setdefault("server", {})["maxConcurrent"] = max_conc
            tmp_path = SETTINGS_PATH + ".tmp"
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(cfg, f, indent=2, ensure_ascii=False)
            os.replace(tmp_path, SETTINGS_PATH)
            return self._send_json(200, {"ok": True, "current_model": {"provider": provider, "model": model, "thinking_level": thinking}})

        return self._send_json(404, {"ok": False, "error": "Not found"})


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", SIDE_PORT), PiTelemetryHandler).serve_forever()
```

### 2.2 BioanalysDesktop `18787` 服务端代理路由模块（`BioanalysDesktop/server/pi_agent_routes.js`）
在 `BioanalysDesktop/server/index.js` 中引入并调用 `registerPiAgentRoutes(app)`，即可为 `18787` 页面提供零 Token 暴露、绕过 `7890` 代理的后端接口：

```javascript
// 文件落点：BioanalysDesktop/server/pi_agent_routes.js
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PI_TAILSCALE_IP = process.env.PI_TAILSCALE_IP || '100.95.88.12';
const PI_A2A_PORT = Number(process.env.PI_A2A_PORT || 9910);
const PI_TELEMETRY_PORT = Number(process.env.PI_TELEMETRY_PORT || 9911);
const A2A_CLIENT_TOKEN = process.env.A2A_CLIENT_BEARER_TOKEN || '';
const WORKSPACE_ROOT = process.env.CODEX_WORKSPACE_ROOT || process.cwd();

function appendLedgerAction(actionType, detailObj) {
  try {
    const ledgerDir = path.join(WORKSPACE_ROOT, 'con_hf', 'ledger');
    fs.mkdirSync(ledgerDir, { recursive: true });
    const entry = {
      id: `act_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      timestamp: new Date().toISOString(),
      module: 'mod-pi-observability',
      action: actionType,
      details: detailObj,
    };
    fs.appendFileSync(path.join(ledgerDir, 'actions.jsonl'), JSON.stringify(entry) + '\n', 'utf8');
  } catch (_e) {}
}

function requestPiNode({ port, reqPath, method = 'GET', bodyObj = null, timeoutMs = 8000 }) {
  return new Promise((resolve, reject) => {
    const payload = bodyObj ? Buffer.from(JSON.stringify(bodyObj), 'utf8') : null;
    const req = http.request(
      {
        hostname: PI_TAILSCALE_IP,
        port,
        path: reqPath,
        method,
        agent: false, // 强制直连，绕过本地 7890 系统代理 (D-07)
        timeout: timeoutMs,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${A2A_CLIENT_TOKEN}`,
          ...(payload ? { 'Content-Length': payload.length } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 500, data: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') });
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('PI_REQUEST_TIMEOUT')));
    if (payload) req.write(payload);
    req.end();
  });
}

export function registerPiAgentRoutes(app) {
  app.get('/api/pi-agent/overview', async (_req, res) => {
    const t0 = Date.now();
    try {
      const [cardRes, teleRes] = await Promise.all([
        requestPiNode({ port: PI_A2A_PORT, reqPath: '/.well-known/agent-card.json', timeoutMs: 5000 }),
        requestPiNode({ port: PI_TELEMETRY_PORT, reqPath: '/api/telemetry/overview', timeoutMs: 6000 }),
      ]);
      res.status(200).json({
        ok: true,
        online: cardRes.status === 200 && teleRes.status === 200,
        rtt_ms: Date.now() - t0,
        tailscale_ip: PI_TAILSCALE_IP,
        agent_card: cardRes.data,
        telemetry: teleRes.data,
      });
    } catch (err) {
      res.status(502).json({ ok: false, online: false, error: err.message });
    }
  });

  app.get('/api/pi-agent/logs', async (req, res) => {
    try {
      const qs = new URLSearchParams({ tail: String(req.query?.tail || '120'), task_id: String(req.query?.task_id || '') }).toString();
      const out = await requestPiNode({ port: PI_TELEMETRY_PORT, reqPath: `/api/telemetry/logs?${qs}` });
      res.status(out.status).json(out.data);
    } catch (err) {
      res.status(502).json({ ok: false, error: err.message, lines: [] });
    }
  });

  app.post('/api/pi-agent/model', async (req, res) => {
    try {
      const out = await requestPiNode({ port: PI_TELEMETRY_PORT, reqPath: '/api/telemetry/model', method: 'POST', bodyObj: req.body });
      if (out.status === 200) appendLedgerAction('pi_agent_model_switch', req.body);
      res.status(out.status).json(out.data);
    } catch (err) {
      res.status(502).json({ ok: false, error: err.message });
    }
  });
}
```

---

## 三、`mod-a2a-codex-client` 与 `mod-a2a-artifact-audit` 持久态底座（含断链状态续领）

### 3.1 电脑端启动器与代理豁免守卫（`ops/codex_a2a_launcher.sh`）

```bash
#!/usr/bin/env bash
# ==============================================================================
# 文件落点：ops/codex_a2a_launcher.sh
# 架构约束：D-01 (codex-a2a), D-07 (NO_PROXY 豁免 Tailscale 网段), D-10 (环境变量注入)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env.a2a"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

: "${CODEX_WORKSPACE_ROOT:=$PROJECT_ROOT}"
: "${A2A_HOST:=127.0.0.1}"
: "${A2A_PORT:=8000}"
: "${PI_TAILSCALE_IP:?必须设置 PI_TAILSCALE_IP (如 100.95.88.12)}"
: "${PI_A2A_PORT:=9910}"
: "${A2A_CLIENT_BEARER_TOKEN:?必须设置 A2A_CLIENT_BEARER_TOKEN}"

if [[ "$A2A_HOST" != "127.0.0.1" ]] && [[ "$A2A_HOST" != "localhost" ]]; then
  echo "FATAL [ERR_CODEX_HOST]: Codex 侧 A2A_HOST 仅允许绑定 127.0.0.1" >&2
  exit 2
fi

export NO_PROXY="127.0.0.1,localhost,100.64.0.0/10,${PI_TAILSCALE_IP},${NO_PROXY:-}"
export no_proxy="$NO_PROXY"
export PI_A2A_ENDPOINT="http://${PI_TAILSCALE_IP}:${PI_A2A_PORT}"

curl --noproxy "*" -fsSL --max-time 5 "${PI_A2A_ENDPOINT}/.well-known/agent-card.json" | jq -e '.name' >/dev/null
exec codex-a2a serve
```

### 3.2 支持“断链状态持久化与续领”的双模客户端（`src/engines/a2a-rpc-engine/a2a_client_poller.py`）
当电脑端派发任务后哪怕发生网络断开或本地进程重启，只要凭持久化的 `active_task.json` 中的 `task_id` 调用 `resume_or_dispatch()`，即可直接通过 `GetTask` 续领手机端正在跑或已跑完的结果，**绝不触发二次重跑**：

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
文件落点：src/engines/a2a-rpc-engine/a2a_client_poller.py
功能：支持断链持久化续领 (Resume-on-Reconnect) 的 A2A v1.0 双模客户端
"""
import json
import os
import time
import uuid
import urllib.request
from typing import Dict, Any, Optional

TERMINAL_STATES = {"completed", "failed", "canceled", "rejected"}
BACKOFF_SCHEDULE_SEC = [5, 10, 20, 30]


class A2AClientPoller:
    def __init__(self, endpoint: str, bearer_token: str, state_file: str = ".active_a2a_task.json"):
        self.endpoint = endpoint.rstrip("/")
        self.bearer_token = bearer_token
        self.state_file = state_file
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def _rpc_post(self, method: str, params: Dict[str, Any], timeout_sec: int = 60) -> Dict[str, Any]:
        payload = {"jsonrpc": "2.0", "id": f"rpc-{uuid.uuid4().hex[:10]}", "method": method, "params": params}
        req = urllib.request.Request(
            f"{self.endpoint}/",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": f"Bearer {self.bearer_token}",
            },
            method="POST",
        )
        with self.opener.open(req, timeout=timeout_sec) as resp:
            raw = resp.read().decode("utf-8")
            if len(raw.encode("utf-8")) > 4 * 1024 * 1024:
                raise ValueError("[ERR_ARTIFACT_OVERSIZE] 响应超过 4MB 上限")
            body = json.loads(raw)
            if body.get("error"):
                raise RuntimeError(f"[A2A_RPC_ERROR] {method}: {body['error']}")
            return body.get("result", {})

    @staticmethod
    def _extract_state(task_obj: Dict[str, Any]) -> str:
        st = task_obj.get("status")
        return (st.get("state", "unknown") if isinstance(st, dict) else str(st or "unknown")).lower()

    def poll_existing_task(self, task_id: str, max_wait_sec: int = 3600) -> Dict[str, Any]:
        """断链重连后凭 task_id 直接轮询 GetTask，无需重新发送 SendMessage。"""
        start_ts = time.time()
        poll_idx = 0
        while (time.time() - start_ts) < max_wait_sec:
            try:
                res = self._rpc_post("GetTask", {"id": task_id}, timeout_sec=30)
                task = res.get("task", res)
                state = self._extract_state(task)
                if state in TERMINAL_STATES:
                    if os.path.exists(self.state_file):
                        os.remove(self.state_file)
                    return task
            except Exception:
                # 网络闪断期间容忍异常，继续按退避窗口等待网络恢复
                pass
            sleep_s = BACKOFF_SCHEDULE_SEC[min(poll_idx, len(BACKOFF_SCHEDULE_SEC) - 1)]
            time.sleep(sleep_s)
            poll_idx += 1

        self._rpc_post("CancelTask", {"id": task_id}, timeout_sec=15)
        raise TimeoutError(f"[ERR_TASK_TIMEOUT] Task {task_id} 超时未完成，已发送 CancelTask")

    def dispatch_idempotent_step(self, project_id: str, step_id: str, script_rel: str, expected_outputs: str = "") -> Dict[str, Any]:
        """若本地存有未完结的同一 step_id 任务，直接调用 GetTask 续领；否则派发异步任务。"""
        if os.path.exists(self.state_file):
            try:
                saved = json.load(open(self.state_file, "r", encoding="utf-8"))
                if saved.get("project_id") == project_id and saved.get("step_id") == step_id and saved.get("task_id"):
                    return self.poll_existing_task(saved["task_id"])
            except Exception:
                pass

        prompt = (
            f"Execute pre-built step via idempotent wrapper:\n"
            f"$HOME/bin/pi_idempotent_runner.sh --project {project_id} --step {step_id} "
            f"--script {script_rel} --outputs '{expected_outputs}'\n"
            f"Do NOT modify the script file. Return the JSON output verbatim."
        )
        msg_params = {
            "message": {
                "messageId": f"msg-{step_id}-{uuid.uuid4().hex[:8]}",
                "role": "ROLE_USER",
                "parts": [{"text": prompt}],
            },
            "configuration": {"returnImmediately": True},
        }
        res = self._rpc_post("SendMessage", msg_params, timeout_sec=60)
        task = res.get("task", res)
        task_id: Optional[str] = task.get("id")
        state = self._extract_state(task)
        if state in TERMINAL_STATES or not task_id:
            return task

        with open(self.state_file, "w", encoding="utf-8") as f:
            json.dump({"project_id": project_id, "step_id": step_id, "task_id": task_id}, f)

        return self.poll_existing_task(task_id)
```

---

## 四、全平台 8 维自动化回归测试矩阵（覆盖 G1 ~ G9 全部守护断言）

| 测试编号 | 测试函数名 | 守护模块 | 核心断言内容与边界判据 |
| :--- | :--- | :--- | :--- |
| **`CASE-01`** | `test_01_path_guard_isolation` | `mod-core-engines` | 校验 `/sdcard/test`、`/storage/emulated/0/x`、`../../etc` 全部被路径守卫拦截（防 G5）。 |
| **`CASE-02`** | `test_02_zero_trust_bind_lock` | `mod-a2a-pi-server` | 校验 `host="0.0.0.0"` 时若 `peerTokens` 为空或 `allowAllUsers=true`，安全校验器立即阻断（防 G1）。 |
| **`CASE-03`** | `test_03_idempotent_done_skip` | `mod-a2a-pi-server` | 校验 `pi_idempotent_runner.sh` 同一 `step_id` 连续运行两次，第二次在 `< 0.5s` 内直接命中 `reused_done_checkpoint`（防 G8 断链重跑）。 |
| **`CASE-04`** | `test_04_readonly_script_guard` | `mod-a2a-pi-server` | 校验预构建脚本执行前后 SHA256 严格一致且权限位锁死只读 `a-w`（防 G8 乱改源码）。 |
| **`CASE-05`** | `test_05_telemetry_auth_and_model_whitelist` | `mod-pi-observability` | 校验 `:9911` Sidecar 拒绝无 Token 请求（401），拒绝非白名单模型（400），合法模型原子更新 `settings.json`（防 G9）。 |
| **`CASE-06`** | `test_06_agent_card_discovery` | `mod-a2a-pi-server` | 绕过 `7890` 代理请求 `GET :9910/.well-known/agent-card.json`，断言 HTTP 200（防 G4）。 |
| **`CASE-07`** | `test_07_a2a_auth_rejection` | `mod-a2a-pi-server` | 错误 Bearer Token 请求 `POST :9910/` 严格返回 HTTP 401/403（防 G1）。 |
| **`CASE-08`** | `test_08_resume_on_reconnect` | `mod-a2a-artifact-audit` | 模拟异步任务派发后客户端断连，凭 `.active_a2a_task.json` 调用 `GetTask` 成功拿回结构化 Artifact（防 G3/G8）。 |
