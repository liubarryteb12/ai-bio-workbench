#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
File: 03_server_orchestrator/core/a2a_dispatcher.py
Purpose: A2A JSON-RPC 2.0 调度器、优先级队列 (PRO_URGENT > STANDARD > TRIAL) 与心跳接收器
"""
import heapq
import time
from typing import Any, Dict, List, Optional

TIER_PRIORITY = {
    "PRO_URGENT": 1,
    "STANDARD": 2,
    "TRIAL": 3,
}


class PriorityQueueManager:
    """多级算力优先级队列管理器"""

    def __init__(self) -> None:
        self._counter = 0
        self._heap: List[Any] = []

    def enqueue(self, req_id: str, tier: str, payload: Dict[str, Any]) -> None:
        prio = TIER_PRIORITY.get(tier.upper(), 2)
        self._counter += 1
        # Python heapq is a min-heap: (priority, counter, item)
        item = {
            "req_id": req_id,
            "tier": tier,
            "payload": payload,
            "enqueued_at": time.time(),
        }
        heapq.heappush(self._heap, (prio, self._counter, item))

    def dequeue(self) -> Optional[Dict[str, Any]]:
        if not self._heap:
            return None
        _, _, item = heapq.heappop(self._heap)
        return item

    def __len__(self) -> int:
        return len(self._heap)


class A2ADispatcher:
    """Tailscale A2A 调度与心跳状态机管理器"""

    def __init__(self, default_timeout_sec: int = 300) -> None:
        self.default_timeout_sec = default_timeout_sec
        self.active_tasks: Dict[str, Dict[str, Any]] = {}
        self.queue = PriorityQueueManager()

    def submit_requirement(self, req: Dict[str, Any]) -> str:
        req_id = req["req_id"]
        tier = req.get("_attribution", {}).get("tier", "STANDARD")
        self.queue.enqueue(req_id, tier, req)
        return req_id

    def register_task(self, task_id: str, manifest_id: str, timeout_sec: Optional[int] = None) -> None:
        self.active_tasks[task_id] = {
            "task_id": task_id,
            "manifest_id": manifest_id,
            "started_at": time.time(),
            "timeout_sec": timeout_sec or self.default_timeout_sec,
            "paused_duration": 0.0,
            "last_thermal_pause": None,
            "status": "RUNNING",
        }

    def process_heartbeat(self, beat_payload: Dict[str, Any]) -> Dict[str, Any]:
        thermal_state = beat_payload.get("thermal_state", "NORMAL")
        acked = []

        # 当遥测提示热挂起时，顺延所有活动任务的超时窗口
        if thermal_state == "THROTTLED_PAUSED":
            for task_id, meta in self.active_tasks.items():
                if meta["status"] == "RUNNING":
                    meta["timeout_sec"] += 10.0  # 自动顺延 10 秒超时

        for triad in beat_payload.get("completed_triads", []):
            step_id = triad.get("step_id")
            if step_id:
                acked.append(step_id)

        return {
            "ok": True,
            "acked_step_ids": acked,
            "thermal_state": thermal_state,
        }
