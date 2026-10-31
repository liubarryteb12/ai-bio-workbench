#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
File: 01_mobile_compute/runtime/pi_telemetry_sidecar.py
Purpose: Redmi K40 硬件遥测、电池热熔断 (SIGSTOP/SIGCONT) 与 Tailscale 心跳同步守护进程
"""
import glob
import json
import os
import signal
import time
import urllib.request
from typing import Dict, List, Optional

SERVER_HUB_URL = os.environ.get("BIO_HUB_HEARTBEAT_URL", "http://100.64.0.1:18787/api/v1/a2a/heartbeat")
WORK_ROOT = os.environ.get("BIO_WORK_ROOT", "/var/lib/bio_workspace")
NODE_ID = os.environ.get("BIO_NODE_ID", "k40-ubuntu-node01")

# 热熔断水位线（摄氏度）：超过 43.0°C 挂起生信进程组，冷却至 39.0°C 以下恢复执行
BATTERY_TEMP_PAUSE_C = 43.0
BATTERY_TEMP_RESUME_C = 39.0

SIGSTOP = getattr(signal, "SIGSTOP", None)
SIGCONT = getattr(signal, "SIGCONT", None)


def read_battery_temp_c() -> float:
    """读取 Android / Linux sysfs 电池温度（通常单位为 0.1°C 或 0.001°C）"""
    candidates = [
        "/sys/class/power_supply/battery/temp",
        "/sys/class/thermal/thermal_zone0/temp",
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                raw = float(open(path, "r").read().strip())
                if raw > 1000:
                    return round(raw / 1000.0, 1)
                if raw > 100:
                    return round(raw / 10.0, 1)
                return round(raw, 1)
            except Exception:
                pass
    return 35.0


def read_mem_available_mb() -> float:
    """读取 /proc/meminfo 中的 MemAvailable (MB)"""
    try:
        with open("/proc/meminfo", "r") as f:
            for line in f:
                if line.startswith("MemAvailable:"):
                    kb = int(line.split()[1])
                    return round(kb / 1024.0, 1)
    except Exception:
        pass
    return 4096.0


def find_active_lock_pgids() -> List[int]:
    """扫描工作目录下所有活动的 .lock 文件，获取计算进程组 PGID"""
    pgids = []
    for lock_path in glob.glob(os.path.join(WORK_ROOT, "**", "*.lock"), recursive=True):
        try:
            pgid = int(open(lock_path, "r").read().strip())
            pgids.append(pgid)
        except Exception:
            pass
    return pgids


class ThermalCircuitBreaker:
    def __init__(self) -> None:
        self.is_paused = False
        self.throttle_count = 0

    def enforce(self, temp_c: float, pgids: List[int]) -> str:
        if not self.is_paused and temp_c >= BATTERY_TEMP_PAUSE_C:
            if hasattr(os, "killpg") and SIGSTOP is not None:
                for pgid in pgids:
                    try:
                        os.killpg(pgid, SIGSTOP)
                    except (ProcessLookupError, PermissionError):
                        pass
            self.is_paused = True
            self.throttle_count += 1
            return "THROTTLED_PAUSED"

        if self.is_paused and temp_c <= BATTERY_TEMP_RESUME_C:
            if hasattr(os, "killpg") and SIGCONT is not None:
                for pgid in pgids:
                    try:
                        os.killpg(pgid, SIGCONT)
                    except (ProcessLookupError, PermissionError):
                        pass
            self.is_paused = False
            return "RESUMED_ACTIVE"

        return "PAUSED" if self.is_paused else "NORMAL"


def collect_completed_triads() -> List[Dict]:
    """收集本地已完成 (.done) 但尚未被服务端确认归档的 Triad 摘要"""
    ready = []
    for done_path in glob.glob(os.path.join(WORK_ROOT, "**", "*.done"), recursive=True):
        triad_path = done_path[:-5] + ".triad.json"
        synced_flag = done_path + ".synced"
        if os.path.exists(triad_path) and not os.path.exists(synced_flag):
            try:
                ready.append({
                    "done_path": done_path,
                    "triad": json.load(open(triad_path, "r", encoding="utf-8"))
                })
            except Exception:
                pass
    return ready


def main_loop(interval_sec: int = 10) -> None:
    breaker = ThermalCircuitBreaker()
    # 强制绕过系统代理直连 Tailscale
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    while True:
        temp_c = read_battery_temp_c()
        avail_mb = read_mem_available_mb()
        active_pgids = find_active_lock_pgids()
        thermal_state = breaker.enforce(temp_c, active_pgids)
        unsynced = collect_completed_triads()

        payload = {
            "node_id": NODE_ID,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "battery_temp_c": temp_c,
            "mem_available_mb": avail_mb,
            "thermal_state": thermal_state,
            "throttle_count": breaker.throttle_count,
            "active_jobs_count": len(active_pgids),
            "completed_triads": [item["triad"] for item in unsynced],
        }

        try:
            req = urllib.request.Request(
                SERVER_HUB_URL,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with opener.open(req, timeout=5) as resp:
                if resp.status == 200:
                    resp_data = json.loads(resp.read().decode("utf-8"))
                    acked_steps = set(resp_data.get("acked_step_ids", []))
                    for item in unsynced:
                        if item["triad"].get("step_id") in acked_steps:
                            open(item["done_path"] + ".synced", "w").write("OK")
        except Exception:
            # 断网期间静默容错，本地计算继续自治推进
            pass

        time.sleep(interval_sec)


if __name__ == "__main__":
    main_loop()
