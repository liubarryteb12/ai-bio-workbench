#!/usr/bin/env python3
"""幂等锁行为测试（用真实 bash 跑改写后的包装器，只依赖 Git-Bash 可得的路径替换）。

与 wrapper_exec_modes.test.js 同款 harness：把数据根替换到临时目录、门禁置空。
死锁回收用必然死的 pid 999999 做持锁主，行为在两处一致且确定；活锁主挡下
exit 4 需要并发的活进程互证，在 K40 真机取证（台账与 handoff 记录证据号）。
"""

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

OPS_ROOT = Path(__file__).resolve().parents[1]
WRAPPER = OPS_ROOT / "run_throttled_task.sh"


def find_bash():
    for cand in (os.environ.get("BIO_BASH"), r"D:\Git\bin\bash.exe", r"D:\Git\usr\bin\bash.exe", "/bin/bash"):
        if not cand:
            continue
        try:
            if subprocess.run([cand, "-n", str(WRAPPER)], capture_output=True).returncode == 0:
                return cand
        except (OSError, subprocess.SubprocessError):
            continue
    return None


BASH = find_bash()


def make_harness():
    root = Path(tempfile.mkdtemp(prefix="wrapper-lock-")).as_posix()
    (Path(root) / "system_logs").mkdir(parents=True, exist_ok=True)
    text = WRAPPER.read_text(encoding="utf-8")
    patched = (
        text.replace("/mnt/ssd/bio_data", root)
        .replace("bash \"${BIO_STORAGE_GUARD", ": \"${BIO_STORAGE_GUARD", 1)
        .replace("/etc/profile.d/bio_limits.sh", root + "/no_such_bio_limits.sh")
        .replace("nice -n 10 ionice -c 2 -n 4 ", "")
    )
    script = Path(root) / "wrapper.sh"
    script.write_text(patched, encoding="utf-8")
    return root, str(script)


@unittest.skipIf(BASH is None, "宿主无 bash 解释器")
class WrapperLockBehaviorTest(unittest.TestCase):
    def run_wrapper(self, script, task_id, env):
        args = [BASH, script, task_id, "line1_bulk", "lock_probe", "self", "/tmp/master.sh"]
        full_env = {**os.environ, **env, "BIO_WRAPPER_LEDGER": "0"}
        return subprocess.run(args, capture_output=True, text=True, env=full_env, timeout=60)

    def test_stale_dead_owner_is_reclaimed(self):
        root, script = make_harness()
        try:
            lock_dir = Path(root) / "system_logs" / "_locks"
            lock_dir.mkdir(parents=True, exist_ok=True)
            lock = lock_dir / "line1_bulk_lock_probe.lock"
            lock.write_text("999999\n", encoding="utf-8")  # 必然不存在的持锁主
            res = self.run_wrapper(script, "lock_t1", {"BIO_EXEC_CMD": "echo LOCK_RAN"})
            self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
            self.assertIn("STALE_LOCK", res.stdout)
            self.assertIn("LOCK_ACQUIRED", res.stdout)
            self.assertFalse(lock.exists(), "任务完成后 EXIT trap 必须放锁")
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_escape_hatch_skips_lock(self):
        root, script = make_harness()
        try:
            lock_dir = Path(root) / "system_logs" / "_locks"
            lock_dir.mkdir(parents=True, exist_ok=True)
            lock = lock_dir / "line1_bulk_lock_probe.lock"
            lock.write_text("999999\n", encoding="utf-8")
            res = self.run_wrapper(
                script, "lock_t2",
                {"BIO_EXEC_CMD": "echo HATCH_OK", "BIO_IDEMPOTENT_LOCK": "0"})
            self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
            self.assertNotIn("LOCK_ACQUIRED", res.stdout)
            self.assertTrue(lock.exists(), "关闭开关时不得触碰别人的锁")
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_clean_run_acquires_and_releases(self):
        root, script = make_harness()
        try:
            res = self.run_wrapper(script, "lock_t3", {"BIO_EXEC_CMD": "echo ACQ_OK"})
            self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
            self.assertIn("LOCK_ACQUIRED key=line1_bulk_lock_probe", res.stdout)
            lock = Path(root) / "system_logs" / "_locks" / "line1_bulk_lock_probe.lock"
            self.assertFalse(lock.exists(), "成功路径必须放锁")
        finally:
            shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
