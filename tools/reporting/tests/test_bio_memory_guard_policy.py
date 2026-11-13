#!/usr/bin/env python3
"""BIO_MEM_LIMIT_GB 解析口径测试。

只测纯解析函数，不在测试进程里改 RLIMIT_AS：一旦把测试进程自己的地址空间
压到 7.5GB，后续 unittest 加载大量模块时会出现难定位的 MemoryError。
"""

import importlib.util
import sys
import types
import unittest
from pathlib import Path

sys.modules.setdefault(
    "resource",
    types.SimpleNamespace(RLIMIT_AS=0, setrlimit=lambda *_args: None, error=OSError),
)

MODULE_PATH = Path(__file__).resolve().parents[2] / "ops" / "bio_memory_guard.py"
SPEC = importlib.util.spec_from_file_location("bio_memory_guard", MODULE_PATH)
GUARD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GUARD)


class BioMemoryGuardPolicyTest(unittest.TestCase):
    def test_default_is_7_5(self):
        self.assertEqual(GUARD.resolve_memory_limit_gb({}), 7.5)

    def test_single_task_can_raise_to_8(self):
        self.assertEqual(GUARD.resolve_memory_limit_gb({"BIO_MEM_LIMIT_GB": "8.0"}), 8.0)

    def test_above_hard_cap_is_clamped(self):
        self.assertEqual(GUARD.resolve_memory_limit_gb({"BIO_MEM_LIMIT_GB": "9.5"}), 8.0)

    def test_invalid_and_non_positive_fall_back_to_default(self):
        self.assertEqual(GUARD.resolve_memory_limit_gb({"BIO_MEM_LIMIT_GB": "abc"}), 7.5)
        self.assertEqual(GUARD.resolve_memory_limit_gb({"BIO_MEM_LIMIT_GB": "0"}), 7.5)
        self.assertEqual(GUARD.resolve_memory_limit_gb({"BIO_MEM_LIMIT_GB": "-1"}), 7.5)

    def test_lower_value_is_kept(self):
        self.assertEqual(GUARD.resolve_memory_limit_gb({"BIO_MEM_LIMIT_GB": "6.5"}), 6.5)


if __name__ == "__main__":
    unittest.main()
