"""bio_memory_guard.py：进程级内存软熔断头

生产默认 7.5GB，单任务可通过 BIO_MEM_LIMIT_GB 覆盖，硬上限 8.0GB。
超限进程被 OS 拒绝分配而非无限吃内存拖垮整个容器。proot 容器本身无
cgroup 硬限，此模块用 RLIMIT_AS 做用户态封顶。

用法：
  from bio_memory_guard import enable_memory_guard
  enable_memory_guard()  # 在 import numpy/scanpy 之前调用
"""
import os
import sys
import resource

DEFAULT_LIMIT_GB = 7.5
MAX_LIMIT_GB = 8.0
MEM_LIMIT_ENV = "BIO_MEM_LIMIT_GB"


def resolve_memory_limit_gb(env=None) -> float:
    """解析 BIO_MEM_LIMIT_GB：默认 7.5，超过 8.0 截断，非法值回落默认。"""
    source = os.environ if env is None else env
    raw = str(source.get(MEM_LIMIT_ENV, "") or "").strip()
    if not raw:
        return DEFAULT_LIMIT_GB
    try:
        value = float(raw)
    except (TypeError, ValueError):
        print(
            "[memory_guard] WARNING: %s=%r 不是数字，按默认 %.1f GB"
            % (MEM_LIMIT_ENV, raw, DEFAULT_LIMIT_GB),
            file=sys.stderr,
        )
        return DEFAULT_LIMIT_GB
    if value <= 0:
        print(
            "[memory_guard] WARNING: %s=%r 必须大于 0，按默认 %.1f GB"
            % (MEM_LIMIT_ENV, raw, DEFAULT_LIMIT_GB),
            file=sys.stderr,
        )
        return DEFAULT_LIMIT_GB
    if value > MAX_LIMIT_GB:
        print(
            "[memory_guard] WARNING: %s=%r 超过硬上限，按 %.1f GB"
            % (MEM_LIMIT_ENV, raw, MAX_LIMIT_GB),
            file=sys.stderr,
        )
        return MAX_LIMIT_GB
    return value


def enable_memory_guard(max_gb: float = None):
    """设置进程虚拟内存上限（RLIMIT_AS）。

    红米 K40 骁龙 870 + 12GB LPDDR5，生产默认 7.5GB，单任务最高 8.0GB。
    """
    if max_gb is None:
        max_gb = resolve_memory_limit_gb()
    else:
        try:
            max_gb = float(max_gb)
        except (TypeError, ValueError):
            max_gb = DEFAULT_LIMIT_GB
        if max_gb <= 0:
            max_gb = DEFAULT_LIMIT_GB
        max_gb = min(max_gb, MAX_LIMIT_GB)
    try:
        max_bytes = int(max_gb * 1024 * 1024 * 1024)
        # RLIMIT_AS 限制进程虚拟内存地址空间总量
        resource.setrlimit(resource.RLIMIT_AS, (max_bytes, max_bytes))
        print("[memory_guard] RLIMIT_AS set to %.2f GB" % max_gb, file=sys.stderr)
    except (ValueError, OSError, resource.error) as e:
        # proot 下 setrlimit 可能不支持，降级为软提醒而非硬失败
        print("[memory_guard] WARNING: setrlimit failed (%s), "
              "falling back to no hard limit" % str(e)[:80], file=sys.stderr)
