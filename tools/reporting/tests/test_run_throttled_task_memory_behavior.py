#!/usr/bin/env python3
"""run_throttled_task.sh 内存门禁行为冒烟。

用真实 bash 跑改写后的包装器，验证宿主测试面能跳过 Linux 专属余量门禁，
正常执行到任务体。真机 Linux 面的余量判据由静态断言与设备实测覆盖。
"""

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

OPS_ROOT = Path(__file__).resolve().parents[2] / "ops"
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
    root = Path(tempfile.mkdtemp(prefix="wrapper-memory-")).as_posix()
    (Path(root) / "system_logs").mkdir(parents=True, exist_ok=True)
    text = WRAPPER.read_text(encoding="utf-8")
    patched = (
        text.replace("/mnt/ssd/bio_data", root)
        .replace('bash "${BIO_STORAGE_GUARD', ': "${BIO_STORAGE_GUARD', 1)
        .replace("/etc/profile.d/bio_limits.sh", root + "/no_such_bio_limits.sh")
        .replace("nice -n 10 ionice -c 2 -n 4 ", "")
    )
    script = Path(root) / "wrapper.sh"
    script.write_text(patched, encoding="utf-8")
    return root, str(script)


@unittest.skipIf(BASH is None, "宿主无 bash 解释器")
class WrapperMemoryBehaviorTest(unittest.TestCase):
    def test_host_smoke_runs_with_non_linux_skip(self):
        root, script = make_harness()
        try:
            env = {
                **os.environ,
                "BIO_EXEC_CMD": "echo SMOKE_OK",
                "BIO_WRAPPER_LEDGER": "0",
                "BIO_IDEMPOTENT_LOCK": "0",
                "BIO_MEM_LIMIT_GB": "8.0",
            }
            res = subprocess.run(
                [BASH, script, "mem_t1", "line1_bulk", "mem_probe", "self", "/tmp/master.sh"],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                env=env, timeout=60,
            )
            self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
            self.assertIn("MEMORY_HEADROOM_SKIPPED", res.stdout)
            self.assertTrue(
                "RLIMIT_AS_SET" in res.stdout or "RLIMIT_AS_UNAVAILABLE" in res.stdout,
                res.stdout + res.stderr,
            )
            log = Path(root) / "system_logs" / "mem_t1.log"
            self.assertTrue(log.exists(), "任务日志未落盘")
            self.assertIn("SMOKE_OK", log.read_text(encoding="utf-8"))
        finally:
            shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
