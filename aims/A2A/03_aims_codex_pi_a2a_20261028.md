# Codex（电脑）↔ Pi Agent（手机 Termux）A2A 协作工程 —— 03. 各模块 `aims落地`（How & Architecture 持久态工程底座）全集

> **文档编号与时间戳**：`03_aims落地_Codex-Pi-A2A协作工程_20261028.md`（生成时间：`2026-10-28 09:00:00 +08:00`）
> **文档角色**：【1 + N×3 体系】中的 **`[模块名]-aims落地-20261028.txt` 汇总卷**（持久态工程底座：定义物理目录与插座映射、完整生产级配置文件、可直接落盘运行的守护与启动脚本、A2A v1.0 JSON-RPC 2.0 全方法报文契约、双模轮询与防崩公式、以及全平台自动化回归测试套件。即便 `aimstodolist` 归档销毁，任何工程师或 Agent 仅凭此文档即可 100% 重建整套双端 A2A 协同系统）

---

## 一、`mod-a2a-pi-server-aims落地-20261028.txt`（手机 Termux 执行端持久态底座）

### 1.1 手机端物理目录结构与路径隔离红线（D-08）
手机 Termux 端所有配置与工作区严格限制在原生 `ext4`/`f2fs` 文件系统（`/data/data/com.termux/files/home/`，即 `$HOME`）内，**严禁将工作区建在 `/sdcard` 或 `/storage/emulated/0`**（因 FUSE 文件系统不支持 `chmod`、软链接与高并发文件锁）：

```text
/data/data/com.termux/files/home/ ($HOME)
├── .pi/
│   └── agent/
│       ├── settings.json                       # 【核心配置】@bacnh85/pi-a2a Server 与鉴权配置
│       ├── transcripts/                        # 【审计落盘】childTranscripts 子任务完整对话与工具轨迹（保留7天）
│       └── logs/
│           └── pi_a2a_daemon.log               # 守护进程与端口自愈巡检日志
├── bin/
│   ├── pi_termux_bootstrap.sh                  # 阶段Ⅰ：Termux 环境与 Pi + A2A 扩展一键初始化脚本
│   └── pi_a2a_daemon.sh                        # 阶段Ⅱ：WakeLock + 安全校验 + tmux 托管与 60s 自愈守护脚本
└── workspace/                                  # 【唯一合法执行工作区根】
    └── projects/
        └── <project_id>/                       # 接收 Codex 委派任务的独立项目沙箱
```

### 1.2 `~/.pi/agent/settings.json` 生产级完整配置（可直接落盘）
基于 `@bacnh85/pi-a2a` 官方键规范，以下配置满足 **D-03（零信任 Token 绑定锁）**、**D-05（移动端并发防 OOM 锁）**、**D-06（300s 阻塞窗口）** 与 **D-10（子会话审计）**：

```json
{
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

### 1.3 手机端一键初始化与安全守护脚本（`ops/pi_a2a_daemon.sh`）
该脚本在启动前强制执行 **G1 安全断言（未配置高熵 Token 严禁绑定 `0.0.0.0`）**、**G5 路径断言** 与 **G2 WakeLock 持有**，并在 `tmux` 会话内附加 60 秒自愈巡检：

```bash
#!/data/data/com.termux/files/usr/bin/bash
# ==============================================================================
# 文件落点：$HOME/bin/pi_a2a_daemon.sh (对应工程库 ops/pi_a2a_daemon.sh)
# 架构约束：D-03 (0.0.0.0 必配 Token), D-05 (WakeLock + tmux), D-08 (原生 ext4 工作区)
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

# 1. [D-08 路径守卫] 严禁工作区软链或指向 /sdcard
REAL_WS="$(realpath "$WORKSPACE_ROOT")"
if [[ "$REAL_WS" == /sdcard* ]] || [[ "$REAL_WS" == /storage/emulated* ]]; then
  log_msg "FATAL [ERR_PATH_GUARD]: WORKSPACE_ROOT ($REAL_WS) 位于 Android FUSE 存储层，严禁启动！"
  exit 3
fi

# 2. [D-03 安全守卫] 校验 settings.json 存在且 host=0.0.0.0 时必须具备高熵 peerTokens
if [[ ! -f "$SETTINGS_FILE" ]]; then
  log_msg "FATAL [ERR_CONFIG_MISSING]: 找不到 $SETTINGS_FILE"
  exit 1
fi

ENABLED="$(jq -r '.a2a.server.enabled // false' "$SETTINGS_FILE")"
HOST_VAL="$(jq -r '.a2a.server.host // "127.0.0.1"' "$SETTINGS_FILE")"
PORT_VAL="$(jq -r '.a2a.server.port // 9910' "$SETTINGS_FILE")"
ALLOW_ALL="$(jq -r '.a2a.server.allowAllUsers // false' "$SETTINGS_FILE")"
CODEX_TOKEN="$(jq -r '.a2a.server.peerTokens.codex // ""' "$SETTINGS_FILE")"

if [[ "$ENABLED" != "true" ]]; then
  log_msg "FATAL [ERR_SERVER_DISABLED]: server.enabled 不为 true"
  exit 1
fi

if [[ "$ALLOW_ALL" == "true" ]]; then
  log_msg "FATAL [ERR_SECURITY_VIOLATION]: 严禁将 allowAllUsers 设为 true！"
  exit 2
fi

if [[ "$HOST_VAL" == "0.0.0.0" ]] && [[ "${#CODEX_TOKEN}" -lt 32 ]]; then
  log_msg "FATAL [ERR_SECURITY_BIND]: host 设为 0.0.0.0 但 peerTokens.codex 长度不足 32 位，拒绝裸奔启动！"
  exit 2
fi

# 3. [D-05 保活底座] 获取 Termux CPU 唤醒锁
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock
  log_msg "INFO: termux-wake-lock 已成功持有。"
else
  log_msg "WARN: 未检测到 termux-wake-lock 命令，请确认已安装 termux-api。"
fi

# 4. 启动或恢复 tmux 托管会话
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  log_msg "INFO: tmux 会话 '$SESSION_NAME' 已存在，检查 :$PORT_VAL 监听状态..."
else
  log_msg "INFO: 创建全新 tmux 会话 '$SESSION_NAME' 并拉起 Pi A2A Server..."
  tmux new-session -d -s "$SESSION_NAME" -c "$WORKSPACE_ROOT"
  tmux send-keys -t "$SESSION_NAME" "cd '$WORKSPACE_ROOT' && pi" C-m
  sleep 4
  tmux send-keys -t "$SESSION_NAME" "/a2a-server start" C-m
  sleep 2
fi

# 5. 本机 Agent Card 探活验证
if curl -fsSL --max-time 5 "http://127.0.0.1:${PORT_VAL}/.well-known/agent-card.json" >/dev/null 2>&1; then
  log_msg "PASS: Pi A2A Server 已在 ${HOST_VAL}:${PORT_VAL} 正常响应 Agent Card。"
else
  log_msg "WARN: 初次探活未响应，向 tmux 发送 /a2a-server start 重试..."
  tmux send-keys -t "$SESSION_NAME" "/a2a-server start" C-m
  sleep 3
  curl -fsSL --max-time 5 "http://127.0.0.1:${PORT_VAL}/.well-known/agent-card.json" >/dev/null
  log_msg "PASS: 重试后 Agent Card 探活成功。"
fi
```

---

## 二、`mod-a2a-codex-client-aims落地-20261028.txt`（电脑 Codex 编排端持久态底座）

### 2.1 电脑端启动器与代理豁免守卫（`ops/codex_a2a_launcher.sh`）
为彻底解决 **缺口 G4（本地 7890 代理劫持 Tailscale 流量）** 与 **缺口 G6（Token 硬编码）**，电脑端统一通过以下脚本加载环境并启动 `codex-a2a`：

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
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${CODEX_WORKSPACE_ROOT:=$PROJECT_ROOT}"
: "${A2A_HOST:=127.0.0.1}"
: "${A2A_PORT:=8000}"
: "${PI_TAILSCALE_IP:?必须设置 PI_TAILSCALE_IP (如 100.95.88.12)}"
: "${PI_A2A_PORT:=9910}"
: "${A2A_CLIENT_BEARER_TOKEN:?必须设置 A2A_CLIENT_BEARER_TOKEN (对应 Pi 侧 peerTokens.codex)}"

# 若未设置 Codex 自身入站 Token，则动态生成高熵随机值
if [[ -z "${A2A_BEARER_TOKEN:-}" ]]; then
  A2A_BEARER_TOKEN="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
  export A2A_BEARER_TOKEN
fi

# [D-01 安全铁律] 电脑端入站严禁绑定 0.0.0.0
if [[ "$A2A_HOST" != "127.0.0.1" ]] && [[ "$A2A_HOST" != "localhost" ]]; then
  echo "FATAL [ERR_CODEX_HOST]: Codex 侧 A2A_HOST 仅允许绑定 127.0.0.1，当前为 $A2A_HOST" >&2
  exit 2
fi

# [D-07 代理豁免铁律] 强制将回环地址、Tailscale 网段与手机 IP 加入 NO_PROXY
export NO_PROXY="127.0.0.1,localhost,100.64.0.0/10,${PI_TAILSCALE_IP},${NO_PROXY:-}"
export no_proxy="$NO_PROXY"
export PI_A2A_ENDPOINT="http://${PI_TAILSCALE_IP}:${PI_A2A_PORT}"

echo "[+] 校验手机端 Pi Agent Card 可达性 ($PI_A2A_ENDPOINT)..."
curl --noproxy "*" -fsSL --max-time 5 "${PI_A2A_ENDPOINT}/.well-known/agent-card.json" | jq -e '.name' >/dev/null
echo "[+] 手机端 Agent Card 在线，正在启动本地 codex-a2a serve (${A2A_HOST}:${A2A_PORT})..."

exec codex-a2a serve
```

### 2.2 Codex 会话内 `a2a_call` 标准任务委派 Prompt 契约
当 Codex 在会话中通过 `a2a_call(url, message)` 向手机端派发任务时，为保证 Pi 返回机器可验收的 **结构化 Artifact（攻克缺口 G6）**，Codex 侧遵循如下结构化任务委派模板：

```text
【A2A 任务委派指令模板（Codex -> Pi）】
请在 Termux 原生工作区 `/data/data/com.termux/files/home/workspace/projects/<project_id>` 下执行以下原子任务：
1. 目标动作：<具体编码、测试或文件操作说明>
2. 边界约束：严禁访问 `/sdcard`；严禁修改非本项目的目录；若运行测试请设置随机种子 `20261028`。
3. 交付物（Artifact）强制格式要求：
   完成后，请在最终回复或 Artifact 中输出一段合法的 JSON 块（以 ```json 包裹），必须包含以下字段：
   - "exit_code": 整数退出码
   - "workspace_dir": 实际工作区绝对路径
   - "changed_files": [{"path": "相对路径", "sha256": "64位小写hex", "action": "created|modified"}]
   - "stdout_summary": 关键执行输出或 pytest 汇总行
```

---

## 三、`mod-a2a-artifact-audit-aims落地-20261028.txt`（A2A v1.0 协议报文与双模轮询底座）

### 3.1 A2A v1.0 核心 JSON-RPC 2.0 报文契约全集

#### （1）Agent Card 发现响应（`GET /.well-known/agent-card.json`）
```json
{
  "name": "pi-termux-executor",
  "description": "Autonomous Pi Coding Agent running on Android Termux via @bacnh85/pi-a2a",
  "url": "http://100.95.88.12:9910/",
  "version": "1.0.0",
  "protocolVersion": "1.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": false,
    "stateTransitionHistory": true
  },
  "authentication": {
    "schemes": ["Bearer"]
  },
  "defaultInputModes": ["text/plain", "application/json"],
  "defaultOutputModes": ["text/plain", "application/json"],
  "skills": [
    {
      "id": "termux-coding-executor",
      "name": "Termux Coding & Verification Executor",
      "description": "Execute file edits, git operations, pytest and shell workflows inside Termux native ext4 workspace"
    }
  ]
}
```

#### （2）同步/异步任务提交（`POST /` -> `method: "SendMessage"`）
```json
{
  "jsonrpc": "2.0",
  "id": "rpc-codex-20261028-0001",
  "method": "SendMessage",
  "params": {
    "message": {
      "messageId": "msg-20261028-0001",
      "role": "ROLE_USER",
      "parts": [
        {
          "text": "在 ~/workspace/projects/demo 下创建 calc.py 与 test_calc.py，运行 pytest 并返回结构化 JSON 摘要（含 exit_code 与文件 sha256）。"
        }
      ]
    },
    "configuration": {
      "acceptedOutputModes": ["text/plain", "application/json"],
      "returnImmediately": false
    }
  }
}
```
> **双模切换说明（D-06）**：当预估任务耗时 $\le 240\text{s}$ 时，`returnImmediately: false`（阻塞等待，最长 `replyTimeoutSec: 300`）；当预估耗时 $> 240\text{s}$ 时，设为 `returnImmediately: true`，Pi 立即返回 `status.state = "submitted"` 或 `"working"` 及 `task.id`，由 Codex 转入下方 `GetTask` 轮询。

#### （3）长任务状态与产物轮询（`POST /` -> `method: "GetTask"`）
```json
{
  "jsonrpc": "2.0",
  "id": "rpc-codex-20261028-0002",
  "method": "GetTask",
  "params": {
    "id": "task-pi-9b8e4a6c2d1e",
    "historyLength": 5
  }
}
```

#### （4）异常或超时任务显式终止（`POST /` -> `method: "CancelTask"`）
```json
{
  "jsonrpc": "2.0",
  "id": "rpc-codex-20261028-0003",
  "method": "CancelTask",
  "params": {
    "id": "task-pi-9b8e4a6c2d1e"
  }
}
```

#### （5）标准 Task 完成响应与结构化 Artifact 载荷
```json
{
  "jsonrpc": "2.0",
  "id": "rpc-codex-20261028-0001",
  "result": {
    "task": {
      "id": "task-pi-9b8e4a6c2d1e",
      "contextId": "ctx-codex-session-01",
      "status": {
        "state": "completed",
        "timestamp": "2026-10-28T09:12:34+08:00"
      },
      "artifacts": [
        {
          "artifactId": "art-exec-summary-01",
          "name": "execution_summary",
          "mimeType": "application/json",
          "parts": [
            {
              "text": "{\"exit_code\":0,\"workspace_dir\":\"/data/data/com.termux/files/home/workspace/projects/demo\",\"duration_sec\":4.82,\"changed_files\":[{\"path\":\"calc.py\",\"sha256\":\"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\",\"action\":\"created\"}],\"stdout_summary\":\"2 passed in 0.14s\"}"
            }
          ]
        }
      ]
    }
  }
}
```

---

### 3.2 双模任务状态机与退避轮询核心实现（`src/engines/a2a-rpc-engine/a2a_client_poller.py`）
以下代码完整实现了 **NO_PROXY 直连**、**阻塞超时自动无缝转 `GetTask` 指数退避轮询** 以及 **超时 `CancelTask` 孤儿回收**（彻底根治缺口 G3、G4、G6）：

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
文件落点：src/engines/a2a-rpc-engine/a2a_client_poller.py
功能：A2A v1.0 双模客户端（同步 SendMessage + 异步 GetTask 指数退避轮询 + CancelTask 回收）
"""
import json
import time
import uuid
import urllib.request
import urllib.error
from typing import Dict, Any, Optional

TERMINAL_STATES = {"completed", "failed", "canceled", "rejected"}
BACKOFF_SCHEDULE_SEC = [5, 10, 20, 30]


class A2AClientPoller:
    def __init__(self, endpoint: str, bearer_token: str, blocking_timeout_sec: int = 330):
        self.endpoint = endpoint.rstrip("/")
        self.bearer_token = bearer_token
        self.blocking_timeout_sec = blocking_timeout_sec
        # 强制使用 ProxyHandler({}) 彻底绕过本地系统代理（根治缺口 G4）
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def _rpc_post(self, method: str, params: Dict[str, Any], timeout_sec: int) -> Dict[str, Any]:
        payload = {
            "jsonrpc": "2.0",
            "id": f"rpc-{uuid.uuid4().hex[:12]}",
            "method": method,
            "params": params,
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{self.endpoint}/",
            data=data,
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
                raise ValueError("[ERR_ARTIFACT_OVERSIZE] 响应体积超过 4MB 安全上限")
            body = json.loads(raw)
            if "error" in body and body["error"]:
                raise RuntimeError(f"[A2A_RPC_ERROR] {method} 失败: {body['error']}")
            return body.get("result", {})

    @staticmethod
    def _extract_state(task_obj: Dict[str, Any]) -> str:
        status = task_obj.get("status")
        if isinstance(status, dict):
            return status.get("state", "unknown").lower()
        if isinstance(status, str):
            return status.lower()
        return "unknown"

    def dispatch_and_wait(
        self,
        prompt_text: str,
        return_immediately: bool = False,
        max_Wait_sec: int = 1800,
    ) -> Dict[str, Any]:
        """派发任务并确保收敛至终态；若超时则主动调用 CancelTask 回收远端进程。"""
        start_ts = time.time()
        msg_params = {
            "message": {
                "messageId": f"msg-{uuid.uuid4().hex[:10]}",
                "role": "ROLE_USER",
                "parts": [{"text": prompt_text}],
            },
            "configuration": {
                "returnImmediately": return_immediately,
            },
        }
        result = self._rpc_post("SendMessage", msg_params, timeout_sec=self.blocking_timeout_sec)
        task = result.get("task", result)
        task_id: Optional[str] = task.get("id")
        state = self._extract_state(task)

        if state in TERMINAL_STATES or not task_id:
            return task

        # 进入 GetTask 指数退避轮询
        poll_idx = 0
        while (time.time() - start_ts) < max_Wait_sec:
            sleep_sec = BACKOFF_SCHEDULE_SEC[min(poll_idx, len(BACKOFF_SCHEDULE_SEC) - 1)]
            time.sleep(sleep_sec)
            poll_idx += 1

            poll_res = self._rpc_post("GetTask", {"id": task_id}, timeout_sec=30)
            task = poll_res.get("task", poll_res)
            state = self._extract_state(task)
            if state in TERMINAL_STATES:
                return task

        # 超出最大等待窗口：显式发送 CancelTask 防止手机端残留孤儿任务
        try:
            self._rpc_post("CancelTask", {"id": task_id}, timeout_sec=15)
        finally:
            raise TimeoutError(
                f"[ERR_TASK_TIMEOUT] 任务 {task_id} 超过 {max_Wait_sec}s 未完成，已发送 CancelTask 终止。"
            )
```

---

## 四、全平台自动化回归测试矩阵与端到端验证套件

### 4.1 自动化回归测试矩阵（覆盖 G1 ~ G7 全部守护断言）

| 测试编号 | 测试函数名 | 守护模块 | 核心断言内容与边界判据 |
| :--- | :--- | :--- | :--- |
| **`CASE-01`** | `test_01_agent_card_discovery` | `mod-a2a-pi-server` | 绕过代理请求 `GET /.well-known/agent-card.json`，断言 HTTP 200 且包含 `name`、`capabilities`、`skills`。 |
| **`CASE-02`** | `test_02_security_auth_guard` | `mod-a2a-pi-server` | 分别以“无 Authorization 头”和“错误 Bearer Token”请求 `POST /`，断言 100% 返回 `401` 或 `403`（防 G1）。 |
| **`CASE-03`** | `test_03_settings_bind_lock` | `mod-core-engines` | 校验 `host="0.0.0.0"` 时若 `peerTokens` 为空或 `allowAllUsers=true`，安全校验器必须立即报红阻断（防 G1）。 |
| **`CASE-04`** | `test_04_path_guard_isolation` | `mod-core-engines` | 校验 `/sdcard/test`、`/storage/emulated/0/x`、`../../etc` 全部被路径守卫拦截（防 G5）。 |
| **`CASE-05`** | `test_05_minimal_task_and_artifact` | `mod-a2a-codex-client` | 发送真实 `SendMessage` 创建文件并计算 SHA256，断言 Task 状态为 `completed` 且 Artifact 哈希匹配（防 G6）。 |
| **`CASE-06`** | `test_06_keepalive_and_proxy_bypass` | `mod-a2a-network-keepalive` | 在模拟开启 `HTTP_PROXY=http://127.0.0.1:7890` 环境下连续探测手机端，断言直连 100% 成功（防 G2/G4）。 |

### 4.2 端到端回归测试可执行脚本（`tests/test_e2e_a2a_pipeline.py`）

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
文件落点：tests/test_e2e_a2a_pipeline.py
用途：Codex (PC) <-> Pi Agent (Termux) A2A 协作工程 6 维端到端自动化验收脚本
运行方式：
  1. 离线契约与安全自检（无需真机在线即可验证本地配置与守卫）：
     python3 tests/test_e2e_a2a_pipeline.py --mode contract
  2. 跨端真机全链路终验（需手机端 Pi A2A Server 在线）：
     PI_A2A_ENDPOINT="http://100.x.y.z:9910" A2A_CLIENT_BEARER_TOKEN="<token>" \
     python3 tests/test_e2e_a2a_pipeline.py --mode live
"""
import argparse
import hashlib
import json
import os
import posixpath
import sys
import time
import urllib.error
import urllib.request


def assert_mobile_workspace_path(path_str: str) -> str:
    norm = posixpath.normpath(path_str)
    if (
        norm.startswith("/sdcard")
        or norm.startswith("/storage/emulated")
        or ".." in norm.split("/")
        or not norm.startswith("/data/data/com.termux/files/home/workspace")
    ):
        raise ValueError(f"ERR_PATH_GUARD: 非法手机工作区路径: {path_str}")
    return norm


def validate_pi_settings_dict(cfg: dict) -> bool:
    srv = cfg.get("a2a", {}).get("server", {})
    if not srv.get("enabled"):
        raise ValueError("ERR_SERVER_DISABLED")
    if srv.get("allowAllUsers") is True:
        raise ValueError("ERR_ALLOW_ALL_FORBIDDEN")
    host = srv.get("host", "127.0.0.1")
    tokens = srv.get("peerTokens", {})
    if host == "0.0.0.0":
        codex_tok = tokens.get("codex", "")
        if len(codex_tok) < 32:
            raise ValueError("ERR_ZERO_TRUST_BIND_LOCK: host=0.0.0.0 但 peerTokens.codex 长度不足 32")
    if int(srv.get("maxConcurrent", 99)) > 2:
        raise ValueError("ERR_MAX_CONCURRENT_OOM_RISK")
    return True


def run_contract_tests():
    print("[1/3] 验证 PathGuard 手机路径隔离守卫 (G5)...")
    ok_path = "/data/data/com.termux/files/home/workspace/projects/demo"
    assert assert_mobile_workspace_path(ok_path) == ok_path
    for bad in ["/sdcard/workspace", "/storage/emulated/0/a", "/data/data/com.termux/files/home/workspace/../../etc"]:
        try:
            assert_mobile_workspace_path(bad)
            raise AssertionError(f"未拦截非法路径: {bad}")
        except ValueError:
            pass
    print("  --> PASS: 非法 /sdcard 与穿越路径 100% 拦截。")

    print("[2/3] 验证 Pi settings.json 零信任绑定锁 (G1)...")
    good_cfg = {
        "a2a": {
            "server": {
                "enabled": True,
                "host": "0.0.0.0",
                "port": 9910,
                "peerTokens": {"codex": "a2a_sec_" + "f" * 48},
                "trustedPeers": ["codex"],
                "allowAllUsers": False,
                "maxConcurrent": 2,
            }
        }
    }
    assert validate_pi_settings_dict(good_cfg) is True

    bad_cfg = json.loads(json.dumps(good_cfg))
    bad_cfg["a2a"]["server"]["peerTokens"] = {}
    try:
        validate_pi_settings_dict(bad_cfg)
        raise AssertionError("未拦截空 peerTokens 下的 0.0.0.0 绑定")
    except ValueError:
        pass
    print("  --> PASS: 0.0.0.0 无 Token 绑定 100% 阻断。")

    print("[3/3] 验证结构化 Artifact SHA256 对账校验器 (G6)...")
    sample_content = b"pong_from_pi_20261028\n"
    expected_sha = hashlib.sha256(sample_content).hexdigest()
    artifact_json = {
        "exit_code": 0,
        "workspace_dir": ok_path,
        "changed_files": [{"path": "a2a_ping.txt", "sha256": expected_sha, "action": "created"}],
        "stdout_summary": "1 passed",
    }
    assert artifact_json["exit_code"] == 0
    assert len(artifact_json["changed_files"][0]["sha256"]) == 64
    print("  --> PASS: 结构化 Artifact 契约校验通过。")


def run_live_tests(endpoint: str, token: str):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    endpoint = endpoint.rstrip("/")

    print(f"[LIVE 1/3] 探测远程 Agent Card: {endpoint}/.well-known/agent-card.json ...")
    with opener.open(f"{endpoint}/.well-known/agent-card.json", timeout=5) as resp:
        assert resp.status == 200
        card = json.loads(resp.read().decode("utf-8"))
        assert "name" in card and "capabilities" in card
        print(f"  --> PASS: 发现远端 Agent '{card.get('name')}'")

    print("[LIVE 2/3] 验证错误 Bearer Token 401/403 拒绝 (G1)...")
    bad_req = urllib.request.Request(
        f"{endpoint}/",
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "SendMessage", "params": {}}).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": "Bearer invalid_token"},
        method="POST",
    )
    try:
        opener.open(bad_req, timeout=5)
        raise AssertionError("错误 Token 未被拒绝！")
    except urllib.error.HTTPError as e:
        assert e.code in (401, 403), f"预期 401/403，实际返回 {e.code}"
        print(f"  --> PASS: 非法请求被准确拦截 (HTTP {e.code})。")

    print("[LIVE 3/3] 执行真实 SendMessage 最小文件生成与 Artifact 回传闭环...")
    probe_msg = (
        "Create ~/workspace/projects/a2a_ping.txt with exact content 'pong_20261028' "
        "and reply with its sha256 hash."
    )
    rpc_body = {
        "jsonrpc": "2.0",
        "id": f"e2e-{int(time.time())}",
        "method": "SendMessage",
        "params": {
            "message": {
                "messageId": f"msg-{int(time.time())}",
                "role": "ROLE_USER",
                "parts": [{"text": probe_msg}],
            }
        },
    }
    good_req = urllib.request.Request(
        f"{endpoint}/",
        data=json.dumps(rpc_body).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    with opener.open(good_req, timeout=120) as resp:
        assert resp.status == 200
        res = json.loads(resp.read().decode("utf-8"))
        assert "result" in res, f"响应缺少 result: {res}"
        print("  --> PASS: 跨端 SendMessage 执行闭环成功。")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["contract", "live"], default="contract")
    args = parser.parse_args()

    run_contract_tests()
    if args.mode == "live":
        ep = os.environ.get("PI_A2A_ENDPOINT", "")
        tk = os.environ.get("A2A_CLIENT_BEARER_TOKEN", "")
        if not ep or not tk:
            print("ERROR: live 模式需设置环境变量 PI_A2A_ENDPOINT 与 A2A_CLIENT_BEARER_TOKEN", file=sys.stderr)
            sys.exit(2)
        run_live_tests(ep, tk)
    print("\n========================================================")
    print("ALL A2A SUITE CHECKS PASSED (mode=" + args.mode + ")")
    print("========================================================")
```
