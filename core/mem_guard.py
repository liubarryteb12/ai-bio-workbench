#!/usr/bin/env python3
"""
core/mem_guard.py
运行在 K40 proot 容器内部的 Python 进程内存安全辅助库。

规约（2026-11-14 修正）：
  严禁将 RLIMIT_AS 设为 7.5GB！
  OpenBLAS、PyTorch、Scanpy 导入时会 mmap 巨量虚拟地址空间（VIRT 动辄 8~14GB），
  若虚存设为 7.5GB 会导致正常导入即报 MemoryError 假死。
  真正的 7.5GB 物理常驻内存（RSS）硬限制由 k40_mem_watchdog.sh 监控进程树强制执行。
  本模块将 RLIMIT_AS 设为 16GB 宽松保底（仅防失控死循环分配），并提供 RSS 查询辅助。
"""
import os
import sys

def get_current_rss_kb():
    """读取当前进程 VmRSS (单位: kB)。"""
    try:
        with open("/proc/self/status", "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    parts = line.split()
                    if len(parts) >= 2:
                        return int(parts[1])
    except Exception:
        pass
    return 0

def enforce_memory_guard():
    """应用层虚拟内存保底设置（16GB 保底，防死循环）。

    D4/A4 验证态模式：BIO_VALIDATION_MODE=1 时物理内存红线收到 3.5GB
    （autonomy_policy.validation.memory_gb 默认值），只用于
    run_validation 的干跑/抽样验证，不用于生产全量执行。
    """
    validation_mode = os.environ.get("BIO_VALIDATION_MODE", "0") == "1"
    if validation_mode:
        limit_gb = float(os.environ.get("BIO_VALIDATION_MEM_LIMIT_GB", "3.5"))
    else:
        limit_gb = float(os.environ.get("BIO_MEM_LIMIT_GB", "7.5"))
    as_ceiling_gb = float(os.environ.get("BIO_VIRT_LIMIT_GB", "16.0"))
    as_ceiling_bytes = int(as_ceiling_gb * 1024 * 1024 * 1024)

    try:
        import resource
        # RLIMIT_AS 设为 16GB 保底防死循环，不卡 7.5GB 以防误杀 OpenBLAS/mmap
        resource.setrlimit(resource.RLIMIT_AS, (as_ceiling_bytes, as_ceiling_bytes))
    except Exception as e:
        sys.stderr.write(f"[MEM_GUARD_DEBUG] 系统不支持或无法设置 RLIMIT_AS: {e}\n")

    mode_label = "验证态" if validation_mode else "生产态"
    sys.stderr.write(
        f"[MEM_GUARD_INIT] {mode_label}进程物理内存红线: {limit_gb:.1f}GB (由外部 watchdog 监控 VmRSS)，"
        f"虚拟内存保底上限: {as_ceiling_gb:.1f}GB\n"
    )

if __name__ == "__main__":
    enforce_memory_guard()
    rss_kb = get_current_rss_kb()
    print(f"Current VmRSS: {rss_kb} kB ({rss_kb / 1024:.2f} MB)")
