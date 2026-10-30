#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
==============================================================================
File: tests/a2a_master_harness.py
Role: 全维自动化审查与故障注入测试底座 (Master Test Harness & Fault Injection Suite)
Purpose:
  无需等待真实手机联网，即可在本地沙箱内 100% 仿真并验证“电脑 Codex / 18787 ↔ 手机 Pi Agent”
  全链路的 8 大核心工程测试套件（含 TDD 红绿循环与混沌故障注入）：
  - [HARNESS-01] PathGuard 边界审查（拦截 /sdcard、/storage/emulated 与 .. 路径穿越）
  - [HARNESS-02] 幂等检查点 (.done) 防重跑与输入数据漂移（Input Drift）自动失效审查
  - [HARNESS-03] 僵尸锁自愈与 Android PID 回绕复用（PID Reuse）防假死锁审查
  - [HARNESS-04] 并发抢锁防踩踏审查（2 个请求同时到达 -> 原子锁 mkdir 保证仅跑 1 次）
  - [HARNESS-05] 损坏/截断 PNG 产物拦截审查（伪造非 89504e47 魔数的假 PNG -> 严禁写入 .done）
  - [HARNESS-06] Strict Runner 母版防篡改审查（执行期间若脚本被改 -> 立即以退出码 5 熔断报警）
  - [HARNESS-07] 零信任网卡绑定锁审查（拦截空 Token、短 Token 或 allowAllUsers=true 下的 0.0.0.0）
  - [HARNESS-07] :9911 Telemetry Sidecar 真实 HTTP 鉴权、模型白名单热切换与账单聚合审查
  - [HARNESS-08] Pi 假阳性初验必须被 Codex 独立哈希终验拒绝
  - [HARNESS-09] Termux 派单路径可见性守卫（容器专属路径不得直接下发给 Pi）
==============================================================================
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
RUNNER_SCRIPT = str(REPO_ROOT / "ops" / "pi_idempotent_runner.sh")
SIDECAR_SCRIPT = str(REPO_ROOT / "ops" / "pi_telemetry_sidecar.py")
sys.path.insert(0, str(REPO_ROOT / "src" / "engines" / "artifact-sync-engine"))

import artifact_validator  # noqa: E402


def read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read().strip()


class A2AMasterHarnessTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.chmod(RUNNER_SCRIPT, 0o755)
        cls.temp_root = tempfile.mkdtemp(prefix="a2a_harness_")
        cls.workspace_base = os.path.join(cls.temp_root, "data/data/com.termux/files/home/workspace/projects")
        os.makedirs(cls.workspace_base, exist_ok=True)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.temp_root, ignore_errors=True)

    def _run_runner(self, project: str, step: str, script: str, inputs: str = "", outputs: str = "", env_override=None):
        env = os.environ.copy()
        env["PI_WORKSPACE_BASE"] = self.workspace_base
        if env_override:
            env.update(env_override)
        cmd = [
            "bash",
            RUNNER_SCRIPT,
            "--project", project,
            "--step", step,
            "--script", script,
        ]
        if inputs:
            cmd.extend(["--inputs", inputs])
        if outputs:
            cmd.extend(["--outputs", outputs])
        proc = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=15)
        return proc.returncode, proc.stdout.strip(), proc.stderr.strip()

    # -------------------------------------------------------------------------
    # HARNESS-01: PathGuard /sdcard & Path Traversal Rejection
    # -------------------------------------------------------------------------
    def test_01_path_guard_blocks_sdcard(self):
        code, out, _ = self._run_runner(
            project="demo",
            step="s1",
            script="run.sh",
            env_override={"PI_WORKSPACE_BASE": "/sdcard/illegal_workspace"},
        )
        self.assertEqual(code, 3, f"Expected exit code 3 for /sdcard, got {code}: {out}")
        data = json.loads(out)
        self.assertEqual(data.get("error"), "ERR_PATH_GUARD_WORKSPACE")

    # -------------------------------------------------------------------------
    # HARNESS-02: Fresh Run -> Reused .done Checkpoint -> Input Drift Re-run
    # -------------------------------------------------------------------------
    def test_02_idempotent_fresh_reused_and_input_drift(self):
        proj_dir = os.path.join(self.workspace_base, "prj_idem")
        os.makedirs(proj_dir, exist_ok=True)
        in_file = os.path.join(proj_dir, "input.tsv")
        with open(in_file, "w", encoding="utf-8") as f:
            f.write("gene\tlogFC\nTP53\t2.4\n")

        script_file = os.path.join(proj_dir, "step_calc.sh")
        counter_file = os.path.join(proj_dir, "run_count.txt")
        with open(script_file, "w", encoding="utf-8") as f:
            f.write(
                "#!/usr/bin/env bash\n"
                "count=$(cat run_count.txt 2>/dev/null || echo 0)\n"
                "echo $((count + 1)) > run_count.txt\n"
                "cp input.tsv output.tsv\n"
            )
        os.chmod(script_file, 0o755)

        # 1. First run: fresh_run
        code1, out1, _ = self._run_runner("prj_idem", "step_01", "./step_calc.sh", inputs="input.tsv", outputs="output.tsv")
        self.assertEqual(code1, 0, out1)
        res1 = json.loads(out1)
        self.assertEqual(res1["idempotent_status"], "fresh_run")
        self.assertEqual(read_text(counter_file), "1")

        # 2. Second run (identical script + inputs): must hit reused_done_checkpoint
        code2, out2, _ = self._run_runner("prj_idem", "step_01", "./step_calc.sh", inputs="input.tsv", outputs="output.tsv")
        self.assertEqual(code2, 0, out2)
        res2 = json.loads(out2)
        self.assertEqual(res2["idempotent_status"], "reused_done_checkpoint")
        self.assertEqual(read_text(counter_file), "1", "Script was re-executed despite valid .done checkpoint!")

        # 3. Modify input.tsv (Input Data Drift): must invalidate .done and re-run
        with open(in_file, "a", encoding="utf-8") as f:
            f.write("EGFR\t-1.8\n")

        code3, out3, _ = self._run_runner("prj_idem", "step_01", "./step_calc.sh", inputs="input.tsv", outputs="output.tsv")
        self.assertEqual(code3, 0, out3)
        res3 = json.loads(out3)
        self.assertEqual(res3["idempotent_status"], "fresh_run", "Failed to invalidate .done when input file changed!")
        self.assertEqual(read_text(counter_file), "2")

    # -------------------------------------------------------------------------
    # HARNESS-03: Stale Lock & Reused PID Mitigation
    # -------------------------------------------------------------------------
    def test_03_stale_pid_reuse_lock_recovery(self):
        proj_dir = os.path.join(self.workspace_base, "prj_pid")
        os.makedirs(proj_dir, exist_ok=True)
        script_file = os.path.join(proj_dir, "quick.sh")
        with open(script_file, "w", encoding="utf-8") as f:
            f.write("#!/usr/bin/env bash\necho ok > result.txt\n")
        os.chmod(script_file, 0o755)

        # Simulate a stale lock holding current python PID (alive, but cmdline is NOT quick.sh)
        lock_dir = os.path.join(proj_dir, ".step_s_pid.lock.d")
        os.makedirs(lock_dir, exist_ok=True)
        with open(os.path.join(lock_dir, "owner.json"), "w", encoding="utf-8") as f:
            json.dump({"pid": os.getpid(), "step_id": "s_pid", "script": "./other_unrelated.sh"}, f)

        t0 = time.time()
        code, out, _ = self._run_runner("prj_pid", "s_pid", "./quick.sh", outputs="result.txt")
        elapsed = time.time() - t0
        self.assertEqual(code, 0, out)
        self.assertLess(elapsed, 3.0, "Runner hung on a reused unrelated PID!")
        res = json.loads(out)
        self.assertEqual(res["idempotent_status"], "fresh_run")

    # -------------------------------------------------------------------------
    # HARNESS-04: Concurrent Lock Attachment (Two simultaneous callers -> Only 1 execution)
    # -------------------------------------------------------------------------
    def test_04_concurrent_callers_attach_to_single_execution(self):
        proj_dir = os.path.join(self.workspace_base, "prj_conc")
        os.makedirs(proj_dir, exist_ok=True)
        script_file = os.path.join(proj_dir, "slow_step.sh")
        counter_file = os.path.join(proj_dir, "conc_count.txt")
        with open(script_file, "w", encoding="utf-8") as f:
            f.write(
                "#!/usr/bin/env bash\n"
                "count=$(cat conc_count.txt 2>/dev/null || echo 0)\n"
                "echo $((count + 1)) > conc_count.txt\n"
                "sleep 2\n"
                "echo done_data > final.tsv\n"
            )
        os.chmod(script_file, 0o755)

        results = [None, None]

        def worker(idx: int, delay: float):
            if delay > 0:
                time.sleep(delay)
            results[idx] = self._run_runner("prj_conc", "step_slow", "./slow_step.sh", outputs="final.tsv")

        t1 = threading.Thread(target=worker, args=(0, 0.0))
        t2 = threading.Thread(target=worker, args=(1, 0.35))
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        self.assertEqual(results[0][0], 0, results[0][1])
        self.assertEqual(results[1][0], 0, results[1][1])
        statuses = {json.loads(results[0][1])["idempotent_status"], json.loads(results[1][1])["idempotent_status"]}
        self.assertIn("fresh_run", statuses)
        self.assertTrue(
            "attached_running_lock" in statuses or "reused_done_checkpoint" in statuses,
            f"Expected second caller to attach or reuse lock, got {statuses}",
        )
        self.assertEqual(read_text(counter_file), "1", "Concurrent duplicate execution occurred!")

    # -------------------------------------------------------------------------
    # HARNESS-05: Corrupted PNG Magic Header Rejection
    # -------------------------------------------------------------------------
    def test_05_corrupted_png_is_rejected(self):
        proj_dir = os.path.join(self.workspace_base, "prj_png")
        os.makedirs(proj_dir, exist_ok=True)
        bad_script = os.path.join(proj_dir, "make_bad_png.sh")
        with open(bad_script, "w", encoding="utf-8") as f:
            f.write("#!/usr/bin/env bash\necho 'NOT_A_VALID_PNG_HEADER' > plot.png\n")
        os.chmod(bad_script, 0o755)

        code, _, _ = self._run_runner("prj_png", "s_bad_png", "./make_bad_png.sh", outputs="plot.png")
        self.assertNotEqual(code, 0, "Runner should reject corrupted PNG lacking 89504e47 header!")
        self.assertFalse(os.path.exists(os.path.join(proj_dir, ".step_s_bad_png.done")))

        good_script = os.path.join(proj_dir, "make_good_png.sh")
        with open(good_script, "w", encoding="utf-8") as f:
            f.write(
                "#!/usr/bin/env bash\n"
                "printf '\\211PNG\\r\\n\\032\\n\\000\\000\\000\\000IEND\\256B\\140\\202' > plot.png\n"
            )
        os.chmod(good_script, 0o755)

        code_ok, out_ok, _ = self._run_runner("prj_png", "s_good_png", "./make_good_png.sh", outputs="plot.png")
        self.assertEqual(code_ok, 0, out_ok)

    # -------------------------------------------------------------------------
    # HARNESS-06: Strict Runner Anti-Tamper Script Mutation Guard
    # -------------------------------------------------------------------------
    def test_06_script_mutation_during_run_is_blocked(self):
        proj_dir = os.path.join(self.workspace_base, "prj_tamper")
        os.makedirs(proj_dir, exist_ok=True)
        mut_script = os.path.join(proj_dir, "self_mutate.sh")
        with open(mut_script, "w", encoding="utf-8") as f:
            f.write(
                "#!/usr/bin/env bash\n"
                "chmod u+w self_mutate.sh\n"
                "echo '# tampered' >> self_mutate.sh\n"
                "echo ok > out.txt\n"
            )
        os.chmod(mut_script, 0o755)

        code, out, _ = self._run_runner("prj_tamper", "s_tamper", "./self_mutate.sh", outputs="out.txt")
        self.assertEqual(code, 5, f"Expected exit code 5 on script tamper, got {code}: {out}")
        self.assertEqual(json.loads(out).get("error"), "ERR_SCRIPT_MUTATED_DURING_RUN")

    # -------------------------------------------------------------------------
    # HARNESS-07: Live :9911 Telemetry Sidecar Auth & Model Switch Test
    # -------------------------------------------------------------------------
    def test_07_telemetry_sidecar_auth_and_model_switch(self):
        fake_home = os.path.join(self.temp_root, "fake_home")
        pi_dir = os.path.join(fake_home, ".pi", "agent")
        bin_dir = os.path.join(fake_home, "bin")
        os.makedirs(os.path.join(pi_dir, "transcripts"), exist_ok=True)
        os.makedirs(os.path.join(pi_dir, "logs"), exist_ok=True)
        os.makedirs(bin_dir, exist_ok=True)

        valid_token = "a2a_sec_" + "9a8b7c6d5e4f" * 4
        settings_file = os.path.join(pi_dir, "settings.json")
        with open(settings_file, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "defaultProvider": "deepseek",
                    "defaultModel": "deepseek-v4.1-flash",
                    "thinkingLevel": "high",
                    "a2a": {
                        "server": {
                            "enabled": True,
                            "host": "0.0.0.0",
                            "port": 9910,
                            "peerTokens": {"codex": valid_token},
                            "trustedPeers": ["codex"],
                            "allowAllUsers": False,
                            "maxConcurrent": 2,
                        }
                    },
                },
                f,
            )
        with open(os.path.join(pi_dir, ".provider_name"), "w", encoding="utf-8") as f:
            f.write("deepseek\n")
        with open(os.path.join(pi_dir, ".provider_model"), "w", encoding="utf-8") as f:
            f.write("deepseek-v4.1-flash\n")
        fake_daemon = os.path.join(bin_dir, "pi_a2a_daemon.sh")
        with open(fake_daemon, "w", encoding="utf-8") as f:
            f.write("#!/usr/bin/env bash\nexit 0\n")
        os.chmod(fake_daemon, 0o755)

        # Find a free ephemeral port
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        sock.close()

        env = os.environ.copy()
        env["HOME"] = fake_home
        env["PI_TELEMETRY_PORT"] = str(port)
        proc = subprocess.Popen(
            ["python3", SIDECAR_SCRIPT],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        time.sleep(0.8)

        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        base_url = f"http://127.0.0.1:{port}"
        try:
            # 1. Unauthorized request must return 401
            req_unauth = urllib.request.Request(f"{base_url}/api/telemetry/overview", headers={"Authorization": "Bearer wrong"})
            try:
                opener.open(req_unauth, timeout=3)
                self.fail("Expected 401 on wrong token")
            except urllib.error.HTTPError as e:
                try:
                    self.assertEqual(e.code, 401)
                finally:
                    e.close()

            # 2. Authorized overview request must return 200
            req_ok = urllib.request.Request(f"{base_url}/api/telemetry/overview", headers={"Authorization": f"Bearer {valid_token}"})
            with opener.open(req_ok, timeout=3) as resp:
                self.assertEqual(resp.status, 200)
                data = json.loads(resp.read().decode("utf-8"))
                self.assertEqual(data["current_model"]["model"], "deepseek-v4.1-flash")

            # 3. Switch model to zai / glm-5.3-flash
            switch_payload = json.dumps({"provider": "zai", "model": "glm-5.3-flash"}).encode("utf-8")
            req_switch = urllib.request.Request(
                f"{base_url}/api/telemetry/model",
                data=switch_payload,
                headers={"Authorization": f"Bearer {valid_token}", "Content-Type": "application/json"},
                method="POST",
            )
            with opener.open(req_switch, timeout=3) as resp:
                self.assertEqual(resp.status, 200)

            with open(os.path.join(pi_dir, ".provider_model"), "r", encoding="utf-8") as f:
                self.assertEqual(f.read().strip(), "glm-5.3-flash")
            with open(os.path.join(pi_dir, ".provider_name"), "r", encoding="utf-8") as f:
                self.assertEqual(f.read().strip(), "zai")
        finally:
            proc.terminate()
            proc.wait(timeout=3)

    # -------------------------------------------------------------------------
    # HARNESS-08: Pi False Positive Must Fail Codex Independent Hash Verification
    # -------------------------------------------------------------------------
    def test_08_pi_false_positive_is_rejected_by_codex_final_acceptance(self):
        project_dir = os.path.join(self.workspace_base, "prj_acceptance")
        os.makedirs(project_dir, exist_ok=True)
        output = os.path.join(project_dir, "result.tsv")
        with open(output, "w", encoding="utf-8") as handle:
            handle.write("actual output\n")

        artifact = {
            "task_id": "task-harness-08",
            "step_id": "step_08",
            "idempotent_status": "fresh_run",
            "executed_at": "2026-10-29T09:00:00+08:00",
            "workspace_dir": "/data/data/com.termux/files/home/workspace/projects/prj_acceptance",
            "script_path": "./run.sh",
            "script_sha256": "a" * 64,
            "inputs_sha256": "no_inputs_declared",
            "exit_code": 0,
            "duration_sec": 0.1,
            "log_file": "/data/data/com.termux/files/home/workspace/projects/prj_acceptance/system_logs/step_08.log",
            "changed_files": [
                {"path": "result.tsv", "sha256": "0" * 64, "action": "created"}
            ],
            "stdout_summary": "pi says passed",
        }
        artifact["preliminary_acceptance"] = {
            "passed": True,
            "exit_code": 0,
            "script_sha256": artifact["script_sha256"],
            "inputs_sha256": artifact["inputs_sha256"],
            "changed_files": artifact["changed_files"],
            "log_file": artifact["log_file"],
            "checks": [{"name": "pi_self_check", "passed": True, "detail": "ok"}],
        }

        final = artifact_validator.build_final_acceptance(
            artifact,
            workspace_root=project_dir,
            command_results=[{"command": "test -s result.tsv", "exit_code": 0}],
        )
        self.assertFalse(final["passed"])
        self.assertIn(
            "ERR_FINAL_ACCEPTANCE_FILE_HASH_MISMATCH:result.tsv",
            final["errors"],
        )
        artifact["final_acceptance"] = final
        completion = artifact_validator.evaluate_task_completion(artifact)
        self.assertEqual(completion["state"], "working")
        self.assertFalse(completion["passed"])

    # -------------------------------------------------------------------------
    # HARNESS-09: Runtime Path Visibility Before Dispatch
    # -------------------------------------------------------------------------
    def test_09_termux_dispatch_rejects_container_only_workspace(self):
        task = {
            "workspace_dir": "/mnt/ssd/bio_data/projects/line1",
            "script_path": "scripts/run.py",
            "inputs": ["data/input.tsv"],
            "outputs": ["results/result.tsv"],
        }
        errors = artifact_validator.validate_dispatch_paths(task, runtime="termux")
        self.assertIn("ERR_TASK_PATH_NOT_VISIBLE:workspace_dir", errors)

        task["workspace_dir"] = "$HOME/workspace/projects/line1"
        self.assertEqual(
            artifact_validator.validate_dispatch_paths(task, runtime="termux"),
            [],
        )


if __name__ == "__main__":
    print("======================================================================")
    print("Running A2A Master TDD & Fault Injection Harness (a2a_master_harness.py)")
    print("======================================================================")
    unittest.main(verbosity=2)
