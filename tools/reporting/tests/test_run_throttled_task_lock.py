#!/usr/bin/env python3
"""run_throttled_task.sh 幂等锁静态断言（P3-03 第一批）。

行为验证（活锁主挡下 exit 4、死锁主回收）在
BioanalysDesktop/tests/wrapper_exec_modes.test.js 复用 makeHarness 用真实 bash 跑；
这里只钉文本，任何机器都能跑。
"""

import unittest
from pathlib import Path

WRAPPER = Path(__file__).resolve().parents[1] / "run_throttled_task.sh"


class RunThrottledTaskLockTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = WRAPPER.read_text(encoding="utf-8")

    def test_lock_section_present(self):
        self.assertIn("# --- 幂等锁", self.text)
        # 逻辑键默认 line+step，可由 BIO_LOCK_KEY 注入项目维度；不用 task_id 派生
        self.assertIn('LOCK_KEY_RAW="${BIO_LOCK_KEY:-${LINE_ID}_${STEP_NAME}}"', self.text)
        self.assertIn("tr -c 'A-Za-z0-9._-' '_'", self.text)
        self.assertIn('LOCK_DIR="/mnt/ssd/bio_data/system_logs/_locks"', self.text)

    def test_default_on_with_escape_hatch(self):
        self.assertIn("BIO_IDEMPOTENT_LOCK:-1", self.text)

    def test_busy_path_exits_4(self):
        # exit 4 = 锁语义专用码，与母版退出码约定（0/1/2/3）不冲突
        self.assertIn("ALREADY_RUNNING", self.text)
        self.assertRegex(self.text, r"exit 4")

    def test_stale_owner_reclaimed(self):
        self.assertIn("STALE_LOCK", self.text)
        self.assertIn('kill -0 "$holder_pid"', self.text)

    def test_release_via_exit_trap(self):
        # set -e 中途失败也要放锁：释放走 EXIT trap，不靠顺序代码
        self.assertRegex(self.text, r"trap .*cleanup_wrapper_lock.* EXIT")

    def test_lock_waits_before_busy_reject(self):
        # 同前缀排队执行（引擎侧重发换新随机尾，前缀不变），撞锁先等再拒
        self.assertIn("BIO_LOCK_WAIT_SECONDS:-1200", self.text)
        self.assertIn("BIO_LOCK_POLL_SECONDS:-10", self.text)

    def test_no_crlf(self):
        self.assertNotIn(b"\r", WRAPPER.read_bytes(), "CR 会让 bash 数值比较退化（坑 #103）")


if __name__ == "__main__":
    unittest.main()
