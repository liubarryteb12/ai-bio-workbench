#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
File: 03_server_orchestrator/core/ledger_engine.py
Purpose: 双层五类追加式 JSONL 治理台账 (con_hf/ledger/*.jsonl)，带 SHA256 哈希链防篡改与跨平台文件锁
"""
import hashlib
import json
import os
import time
from typing import Any, Dict

try:
    import fcntl
except ImportError:
    fcntl = None

try:
    import msvcrt
except ImportError:
    msvcrt = None

LEDGER_CATEGORIES = {
    "tasks": "tasks.jsonl",             # 任务状态机流转记录
    "isolation": "isolation.jsonl",     # 三线物理隔离断言与越界拦截记录
    "compute": "compute.jsonl",         # K40 边缘算力耗时、内存与热熔断记录
    "audit": "audit.jsonl",             # AI 两阶段终验评分卡与自愈补丁记录
    "attribution": "attribution.jsonl", # 外包产品/营销渠道归因与 ROI 结算记录
}


class AppendOnlyLedger:
    def __init__(self, ledger_dir: str = "con_hf/ledger") -> None:
        self.ledger_dir = ledger_dir
        os.makedirs(self.ledger_dir, exist_ok=True)

    def _lock_file(self, f) -> None:
        if fcntl is not None:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        elif msvcrt is not None:
            try:
                msvcrt.locking(f.fileno(), msvcrt.LK_LOCK, 1)
            except Exception:
                pass

    def _unlock_file(self, f) -> None:
        if fcntl is not None:
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)
        elif msvcrt is not None:
            try:
                msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
            except Exception:
                pass

    def append(self, category: str, event_type: str, payload: Dict[str, Any]) -> str:
        if category not in LEDGER_CATEGORIES:
            raise ValueError(f"未知台账分类: {category}")

        filepath = os.path.join(self.ledger_dir, LEDGER_CATEGORIES[category])
        os.makedirs(os.path.dirname(filepath), exist_ok=True)

        with open(filepath, "a+", encoding="utf-8") as f:
            self._lock_file(f)
            try:
                f.seek(0, os.SEEK_END)
                pos = f.tell()
                prev_hash = "0" * 64
                if pos > 0:
                    # 读取最后一行获取上一条记录的 record_sha256
                    f.seek(max(0, pos - 4096))
                    lines = [ln.strip() for ln in f.readlines() if ln.strip()]
                    if lines:
                        try:
                            last_obj = json.loads(lines[-1])
                            prev_hash = last_obj.get("record_sha256", prev_hash)
                        except Exception:
                            pass

                record = {
                    "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "category": category,
                    "event_type": event_type,
                    "prev_record_sha256": prev_hash,
                    "payload": payload,
                }
                canonical = json.dumps(record, sort_keys=True, ensure_ascii=False)
                record_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
                record["record_sha256"] = record_hash

                f.seek(0, os.SEEK_END)
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
                f.flush()
                return record_hash
            finally:
                self._unlock_file(f)

    def verify_ledger_chain(self, category: str) -> tuple[bool, str]:
        """
        逐行校验指定分类台账的 prev_record_sha256 哈希链连续性与防篡改完整性
        """
        if category not in LEDGER_CATEGORIES:
            raise ValueError(f"未知台账分类: {category}")

        filepath = os.path.join(self.ledger_dir, LEDGER_CATEGORIES[category])
        if not os.path.exists(filepath):
            return True, "EMPTY"

        with open(filepath, "r", encoding="utf-8") as f:
            lines = [ln.strip() for ln in f.readlines() if ln.strip()]

        if not lines:
            return True, "EMPTY"

        expected_prev = "0" * 64
        for idx, line_str in enumerate(lines):
            try:
                rec = json.loads(line_str)
            except Exception as e:
                return False, f"JSON parse error at line {idx}: {e}"

            recorded_hash = rec.get("record_sha256")
            prev_hash = rec.get("prev_record_sha256")

            # 1. 检查前后哈希链连续性
            if prev_hash != expected_prev:
                return False, f"Broken chain at line {idx}: expected prev {expected_prev[:8]}, got {prev_hash[:8]}"

            # 2. 重新计算当前记录内容哈希
            calc_body = {
                "ts": rec.get("ts"),
                "category": rec.get("category"),
                "event_type": rec.get("event_type"),
                "prev_record_sha256": prev_hash,
                "payload": rec.get("payload"),
            }
            canonical = json.dumps(calc_body, sort_keys=True, ensure_ascii=False)
            calculated_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()

            if calculated_hash != recorded_hash:
                return False, f"Tampered record at line {idx}: recorded {recorded_hash[:8]} != calculated {calculated_hash[:8]}"

            expected_prev = recorded_hash

        return True, "OK"

