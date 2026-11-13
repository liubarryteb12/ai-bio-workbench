#!/usr/bin/env python3
"""run_throttled_task.sh 内存门禁静态断言。

行为验证要真起容器进程，这里只钉文本契约：环境变量名、默认值、上限、
余量标记与退出码。任何机器都能跑。
"""

import unittest
from pathlib import Path

WRAPPER = Path(__file__).resolve().parents[2] / "ops" / "run_throttled_task.sh"


class RunThrottledTaskMemoryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = WRAPPER.read_text(encoding="utf-8")

    def test_env_var_is_single_source(self):
        self.assertIn('MEM_LIMIT_RAW="${BIO_MEM_LIMIT_GB:-}"', self.text)
        self.assertIn('export BIO_MEM_LIMIT_GB="$MEM_LIMIT_GB"', self.text)

    def test_production_default_and_cap(self):
        self.assertIn("MEM_LIMIT_DEFAULT_GB=7.5", self.text)
        self.assertIn("MEM_LIMIT_MAX_GB=8.0", self.text)
        self.assertIn('BIO_MEM_HEADROOM_GB:-1.0', self.text)

    def test_prestart_headroom_gate(self):
        self.assertIn("MemAvailable", self.text)
        self.assertIn("SwapFree", self.text)
        self.assertIn("MEMORY_HEADROOM_OK", self.text)
        self.assertIn("INSUFFICIENT_MEMORY_HEADROOM", self.text)
        self.assertIn("MEMORY_HEADROOM_SKIPPED", self.text)
        self.assertIn("TASK_REFUSED", self.text)
        self.assertIn("exit 5", self.text)

    def test_process_level_limit_is_inherited(self):
        self.assertIn("ulimit -v", self.text)
        self.assertIn("RLIMIT_AS_SET", self.text)

    def test_ledger_uses_resolved_value(self):
        self.assertIn('"memory_limit_gb": $MEM_LIMIT_GB', self.text)

    def test_no_crlf(self):
        self.assertNotIn(b"\r", WRAPPER.read_bytes(), "CR 会让 bash 数值比较退化（坑 #103）")


if __name__ == "__main__":
    unittest.main()
