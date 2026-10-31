import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import pytest

sys.path.insert(0, os.path.abspath("01_mobile_compute/runtime"))
from pi_telemetry_sidecar import ThermalCircuitBreaker


RUNTIME_DIR = os.path.abspath("01_mobile_compute/runtime")
BASH_EXE = "D:/Git/bin/bash.exe" if os.path.exists("D:/Git/bin/bash.exe") else "bash"


def test_slice4_lf_line_endings():
    for fn in ["bio_limits.sh", "pi_idempotent_runner.sh"]:
        fp = os.path.join(RUNTIME_DIR, fn)
        assert os.path.exists(fp)
        with open(fp, "rb") as f:
            content = f.read()
        assert b"\r\n" not in content, f"{fn} must use LF line endings, found CRLF"


def test_slice4_thermal_circuit_breaker():
    breaker = ThermalCircuitBreaker()
    assert breaker.is_paused is False
    assert breaker.throttle_count == 0

    # 1. Normal temperature: 37.0°C
    state = breaker.enforce(37.0, [])
    assert state == "NORMAL"
    assert breaker.is_paused is False
    assert breaker.throttle_count == 0

    # 2. Overheat: 43.5°C >= 43.0°C -> THROTTLED_PAUSED
    state = breaker.enforce(43.5, [])
    assert state == "THROTTLED_PAUSED"
    assert breaker.is_paused is True
    assert breaker.throttle_count == 1

    # 3. Intermediate temperature: 41.0°C (hysteresis: still paused until <= 39.0°C)
    state = breaker.enforce(41.0, [])
    assert state == "PAUSED"
    assert breaker.is_paused is True

    # 4. Cooled down: 38.5°C <= 39.0°C -> RESUMED_ACTIVE
    state = breaker.enforce(38.5, [])
    assert state == "RESUMED_ACTIVE"
    assert breaker.is_paused is False
    assert breaker.throttle_count == 1


def test_slice4_runner_sdcard_rejection():
    runner_script = os.path.join(RUNTIME_DIR, "pi_idempotent_runner.sh").replace("\\", "/")
    # Passing /sdcard/test_work should trigger check_no_sdcard_path exit code 91
    cmd = [
        BASH_EXE,
        runner_script,
        "TASK-001",
        "MAN-001",
        "step_01_qc",
        "/sdcard/test_work",
        "echo",
        "should_not_run",
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    assert res.returncode == 91
    assert "00_最高纲领红线" in res.stderr or "sdcard" in res.stderr.lower()


def test_slice4_runner_idempotence():
    runner_script = os.path.join(RUNTIME_DIR, "pi_idempotent_runner.sh").replace("\\", "/")
    with tempfile.TemporaryDirectory() as tmp_dir:
        work_dir = os.path.join(tmp_dir, "work").replace("\\", "/")

        # 1. First run: should execute command, create .done and .triad.json
        cmd = [
            BASH_EXE,
            runner_script,
            "TASK-002",
            "MAN-002",
            "step_01_test",
            work_dir,
            "echo",
            "hello_slice4",
        ]
        res1 = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
        assert res1.returncode == 0
        triad1 = json.loads(res1.stdout.strip())
        assert triad1["exit_code"] == 0
        assert triad1["from_idempotent_cache"] is False
        assert os.path.exists(os.path.join(tmp_dir, "work", "step_01_test.done"))

        # 2. Second run: idempotent cache hit, should finish fast with from_idempotent_cache = True
        t0 = time.time()
        res2 = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
        elapsed = time.time() - t0
        assert res2.returncode == 0
        assert elapsed < 0.5
        triad2 = json.loads(res2.stdout.strip())
        assert triad2["from_idempotent_cache"] is True
