"""bio_memory_guard.py：Python 脚本级 7.5GB 软熔断头

重度计算脚本入口处调用 enable_memory_guard(7.5)，超限进程被 OS SIGKILL
而非无限吃内存拖垮整个容器。proot 容器本身无 cgroup 硬限，此模块用
RLIMIT_AS 做用户态封顶。

用法：
  from bio_memory_guard import enable_memory_guard
  enable_memory_guard(7.5)  # 在 import numpy/scanpy 之前调用
"""
import os
import sys
import resource


def enable_memory_guard(max_gb: float = 7.5):
    """设置进程虚拟内存上限（RLIMIT_AS）。

    红米 K40 骁龙 870 + 12GB LPDDR5，容器分配约 8GB。
    封顶 7.5GB 留 0.5GB 给 SSH/crond/系统进程，防 OOM 拖垮底座。
    """
    try:
        max_bytes = int(max_gb * 1024 * 1024 * 1024)
        # RLIMIT_AS 限制进程虚拟内存地址空间总量
        resource.setrlimit(resource.RLIMIT_AS, (max_bytes, max_bytes))
        print("[memory_guard] RLIMIT_AS set to %.1f GB" % max_gb, file=sys.stderr)
    except (ValueError, OSError, resource.error) as e:
        # proot 下 setrlimit 可能不支持，降级为软提醒而非硬失败
        print("[memory_guard] WARNING: setrlimit failed (%s), "
              "falling back to no hard limit" % str(e)[:80], file=sys.stderr)
