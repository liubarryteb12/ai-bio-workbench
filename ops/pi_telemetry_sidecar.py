#!/usr/bin/env python3
"""Pi Agent telemetry sidecar: read-only call ledger, logs and model pinning.

Listens on 127.0.0.1:9911 by default and shares the A2A peer token for auth.
Data sources are the real on-device paths verified on K40:
  - ~/.pi/agent/a2a_sessions/*.jsonl (call transcripts with usage blocks)
  - ~/.pi/agent/logs/pi_a2a_daemon.log
  - ~/.pi/agent/.provider_{name,model} pin files (the daemon's model SSOT)
"""

from __future__ import annotations

import glob
import json
import os
import subprocess
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

HOME = os.path.expanduser("~")
AGENT_DIR = os.path.join(HOME, ".pi", "agent")
SETTINGS_PATH = os.path.join(AGENT_DIR, "settings.json")
SESSIONS_DIR = os.path.join(AGENT_DIR, "a2a_sessions")
DAEMON_LOG_PATH = os.path.join(AGENT_DIR, "logs", "pi_a2a_daemon.log")
PROVIDER_NAME_FILE = os.path.join(AGENT_DIR, ".provider_name")
PROVIDER_MODEL_FILE = os.path.join(AGENT_DIR, ".provider_model")
SIDE_PORT = int(os.environ.get("PI_TELEMETRY_PORT", "9911"))

ALLOWED_MODELS = [
    {"provider": "deepseek", "model": "deepseek-v4.1-flash"},
    {"provider": "zai", "model": "glm-5.3-flash"},
]
MODEL_PROVIDER = {m["model"]: m["provider"] for m in ALLOWED_MODELS}


def _read_pin(path: str) -> str:
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.read().strip() or "unknown"
    except OSError:
        return "unknown"


def verify_token(headers) -> bool:
    try:
        with open(SETTINGS_PATH, encoding="utf-8") as handle:
            config = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return False
    expected = (
        config.get("a2a", {}).get("server", {}).get("peerTokens", {}).get("codex", "")
    )
    if not expected or len(expected) < 32:
        return False
    return headers.get("Authorization", "") == f"Bearer {expected}"


def parse_session(path: str) -> dict:
    task_id = os.path.basename(path).rsplit("_task-", 1)[-1].replace(".jsonl", "")
    started = ""
    model = "unknown"
    thinking = ""
    t_in = t_out = t_reasoning = t_cache = 0
    t_cost = 0.0
    tools = 0
    last_text = ""
    prompt = ""
    try:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not started and event.get("timestamp"):
                    started = event["timestamp"]
                if event.get("type") != "message":
                    continue
                message = event.get("message", {})
                if message.get("model"):
                    model = message["model"]
                if message.get("thinkingLevel"):
                    thinking = message["thinkingLevel"]
                usage = message.get("usage") or {}
                t_in += int(usage.get("input", 0))
                t_out += int(usage.get("output", 0))
                t_reasoning += int(usage.get("reasoning", 0))
                t_cache += int(usage.get("cacheRead", 0))
                cost = usage.get("cost") or {}
                t_cost += float(cost.get("total", 0) or 0)
                content = message.get("content")
                if not isinstance(content, list):
                    continue
                for part in content:
                    if part.get("type") == "text" and part.get("text"):
                        last_text = str(part["text"])[:180]
                    if part.get("type") == "toolCall":
                        tools += 1
                    if message.get("role") == "user" and part.get("type") == "text":
                        prompt = str(part.get("text", ""))[:140]
    except OSError:
        pass
    stat = os.stat(path)
    return {
        "file": os.path.basename(path),
        "task_id": task_id,
        "started_at": started,
        "duration_sec": max(0, round(stat.st_mtime - stat.st_ctime, 1)),
        "model": model,
        "thinking_level": thinking,
        "input_tokens": t_in,
        "output_tokens": t_out,
        "reasoning_tokens": t_reasoning,
        "cache_tokens": t_cache,
        "cost_usd": round(t_cost, 6),
        "tool_calls": tools,
        "prompt": prompt,
        "last_text": last_text,
    }


def collect_usage(limit: int = 40) -> dict:
    os.makedirs(SESSIONS_DIR, exist_ok=True)
    files = sorted(
        glob.glob(os.path.join(SESSIONS_DIR, "*.jsonl")),
        key=os.path.getmtime,
        reverse=True,
    )
    calls = []
    by_model: dict[str, dict] = {}
    totals = {"total_calls": 0, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}
    for path in files[:limit]:
        call = parse_session(path)
        calls.append(call)
        bucket = by_model.setdefault(call["model"], {
            "provider": MODEL_PROVIDER.get(call["model"], "unknown"),
            "model": call["model"],
            "calls": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "cost_usd": 0.0,
        })
        bucket["calls"] += 1
        bucket["input_tokens"] += call["input_tokens"]
        bucket["output_tokens"] += call["output_tokens"]
        bucket["cost_usd"] = round(bucket["cost_usd"] + call["cost_usd"], 6)
        totals["input_tokens"] += call["input_tokens"]
        totals["output_tokens"] += call["output_tokens"]
        totals["cost_usd"] += call["cost_usd"]
    totals["total_calls"] = len(files)
    totals["cost_usd"] = round(totals["cost_usd"], 6)
    return {
        "totals": totals,
        "by_model": list(by_model.values()),
        "recent_calls": calls,
    }


def current_model() -> dict:
    model = _read_pin(PROVIDER_MODEL_FILE)
    provider = _read_pin(PROVIDER_NAME_FILE)
    if provider == "unknown":
        provider = MODEL_PROVIDER.get(model, "unknown")
    return {"provider": provider, "model": model, "thinking_level": "high"}


def hardware_health() -> dict:
    mem = "unknown"
    try:
        raw = subprocess.check_output(["free", "-m"], text=True, timeout=3)
        for line in raw.splitlines():
            if line.startswith("Mem:"):
                parts = line.split()
                mem = f"{parts[2]}/{parts[1]} MB"
                break
    except (OSError, subprocess.SubprocessError):
        pass
    tmux_alive = subprocess.run(
        ["tmux", "has-session", "-t", "pi-a2a"],
        capture_output=True,
        timeout=3,
    ).returncode == 0
    return {"memory": mem, "tmux_session_alive": tmux_alive, "battery": "unavailable (no perm from ssh/proot)"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # noqa: A002 - silence default logging
        pass

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802 - stdlib naming
        if not verify_token(self.headers):
            return self._json(401, {"ok": False, "error": "ERR_UNAUTHORIZED"})
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path == "/api/telemetry/overview":
            usage = collect_usage(limit=40)
            return self._json(200, {
                "ok": True,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                "agent": {
                    "name": "pi-termux-executor",
                    "a2a_port": 9910,
                    "telemetry_port": SIDE_PORT,
                },
                "current_model": current_model(),
                "allowed_models": ALLOWED_MODELS,
                "hardware": hardware_health(),
                "usage": usage["totals"],
                "usage_by_model": usage["by_model"],
                "recent_calls": usage["recent_calls"],
            })
        if parsed.path == "/api/telemetry/logs":
            tail_n = min(500, max(10, int(query.get("tail", ["120"])[0])))
            task_file = query.get("task_file", [""])[0].strip()
            if task_file:
                safe = os.path.basename(task_file)
                target = os.path.join(SESSIONS_DIR, safe)
            else:
                target = DAEMON_LOG_PATH
            try:
                raw = subprocess.check_output(
                    ["tail", "-n", str(tail_n), target], text=True, errors="replace", timeout=5,
                )
                lines = raw.splitlines()
            except (OSError, subprocess.SubprocessError):
                lines = []
            return self._json(200, {"ok": True, "source": os.path.basename(target), "lines": lines})
        return self._json(404, {"ok": False, "error": "Not found"})

    def do_POST(self):  # noqa: N802 - stdlib naming
        if not verify_token(self.headers):
            return self._json(401, {"ok": False, "error": "ERR_UNAUTHORIZED"})
        if self.path != "/api/telemetry/model":
            return self._json(404, {"ok": False, "error": "Not found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        except (json.JSONDecodeError, ValueError):
            return self._json(400, {"ok": False, "error": "ERR_BAD_JSON"})
        provider = str(body.get("provider", "")).strip()
        model = str(body.get("model", "")).strip()
        if not any(m["provider"] == provider and m["model"] == model for m in ALLOWED_MODELS):
            return self._json(400, {"ok": False, "error": "ERR_MODEL_NOT_IN_WHITELIST"})
        # Model SSOT is the daemon pin files; restart the daemon to apply.
        with open(PROVIDER_NAME_FILE, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(provider + "\n")
        with open(PROVIDER_MODEL_FILE, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(model + "\n")
        os.chmod(PROVIDER_NAME_FILE, 0o600)
        os.chmod(PROVIDER_MODEL_FILE, 0o600)
        subprocess.Popen(
            ["bash", os.path.join(HOME, "bin", "pi_a2a_daemon.sh")],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        return self._json(200, {"ok": True, "current_model": current_model()})


def main() -> int:
    server = HTTPServer(("127.0.0.1", SIDE_PORT), Handler)
    print(f"[pi-telemetry-sidecar] listening on 127.0.0.1:{SIDE_PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
