#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
File: 03_server_orchestrator/core/isolation_guard.py
Purpose: 三线物理隔离硬断言、前置算力准入筛 (Compute Sieve) 与二进制魔数终验器
"""
import hashlib
import os
from typing import Dict, List, Tuple

ALLOWED_LINES = {
    "line1_bulk": "/var/lib/bio_workspace/line1_bulk",
    "line2_scrna": "/var/lib/bio_workspace/line2_scrna",
    "line3_spatial": "/var/lib/bio_workspace/line3_spatial",
}


class IsolationViolationError(PermissionError):
    """触发三线物理隔离红线异常"""


def assert_three_line_isolation(isolation_line: str, target_paths: List[str]) -> None:
    """
    验证所有输入/输出/脚本路径严格拘束在所属产线沙箱内，严禁跨线引用或路径穿越
    """
    if isolation_line not in ALLOWED_LINES:
        raise IsolationViolationError(f"非法产线标识: {isolation_line}")

    sandbox_root = os.path.realpath(ALLOWED_LINES[isolation_line])
    other_roots = [
        os.path.realpath(p) for k, p in ALLOWED_LINES.items() if k != isolation_line
    ]

    for raw_path in target_paths:
        if ".." in raw_path.split("/"):
            raise IsolationViolationError(f"检测到路径上溯攻击 ('..'): {raw_path}")

        resolved = os.path.realpath(os.path.join(sandbox_root, raw_path.lstrip("/")))

        # 严禁触碰其他两条产线目录
        for other in other_roots:
            if resolved.startswith(other):
                raise IsolationViolationError(
                    f"跨线污染阻断: 产线 [{isolation_line}] 试图访问 [{resolved}]"
                )

        if not resolved.startswith(sandbox_root):
            raise IsolationViolationError(
                f"沙箱逃逸阻断: 路径 [{resolved}] 不在 [{sandbox_root}] 管辖范围内"
            )


def evaluate_compute_sieve(
    isolation_line: str, n_genes: int, n_cells_or_samples: int, max_ram_mb: int = 5500
) -> Dict:
    """
    前置算力筛：在派发给 Redmi K40 之前预估峰值内存，自动决定是否插入 Geometric Sketching 降采样
    """
    if isolation_line == "line1_bulk":
        est_mb = 450.0 + (n_genes * n_cells_or_samples * 64.0) / (1024.0 * 1024.0)
        return {
            "estimated_peak_mb": round(est_mb, 1),
            "downsampling_applied": False,
            "target_cell_cap": n_cells_or_samples,
            "sieve_passed": est_mb <= max_ram_mb,
        }

    # 单细胞与空间转录组内存估算
    est_mb = 1200.0 + 0.18 * n_cells_or_samples
    if est_mb > max_ram_mb or n_cells_or_samples > 20000:
        capped_cells = 15000
        adjusted_mb = 1200.0 + 0.18 * capped_cells
        return {
            "estimated_peak_mb": round(adjusted_mb, 1),
            "downsampling_applied": True,
            "target_cell_cap": capped_cells,
            "sieve_passed": True,
        }

    return {
        "estimated_peak_mb": round(est_mb, 1),
        "downsampling_applied": False,
        "target_cell_cap": n_cells_or_samples,
        "sieve_passed": True,
    }


def verify_artifact_binary_integrity(filepath: str, expected_sha256: str) -> Tuple[bool, str]:
    """
    服务端终验：核对回传文件的 SHA256 与 PNG/PDF 首尾二进制魔数
    """
    if not os.path.exists(filepath):
        return False, "FILE_NOT_FOUND"

    size = os.path.getsize(filepath)
    if size == 0:
        return False, "ZERO_BYTE_FILE"

    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    actual_sha = h.hexdigest()
    if actual_sha != expected_sha256:
        return False, f"SHA256_MISMATCH(expected={expected_sha256[:8]}, actual={actual_sha[:8]})"

    ext = os.path.splitext(filepath)[1].lower()
    with open(filepath, "rb") as f:
        head = f.read(16)
        f.seek(max(0, size - 64))
        tail = f.read(64)

    if ext == ".png":
        if size < 4096:
            return False, "PNG_TOO_SMALL_BLANK_PLOT"
        if not (head.startswith(b"\x89PNG\r\n\x1a\n") and tail.endswith(b"IEND\xaeB`\x82")):
            return False, "PNG_MAGIC_OR_IEND_CORRUPTED"

    elif ext == ".pdf":
        if size < 2048:
            return False, "PDF_TOO_SMALL"
        if not (head.startswith(b"%PDF-") and b"%%EOF" in tail):
            return False, "PDF_MAGIC_OR_EOF_CORRUPTED"

    return True, "OK"
