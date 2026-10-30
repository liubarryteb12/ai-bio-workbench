#!/usr/bin/env python3
"""Compute engine tests with mock and real child-process adapters."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
BUILD = HERE / ".compute_build"


def run_node(script: str) -> dict:
    wrapper = (
        "import { ComputeEngineImpl } from './src/engines/compute-engine/implementation.mjs';\n"
        "import { MockComputeAdapter, ChildProcessComputeAdapter, BridgeComputeAdapter } from './src/engines/compute-engine/adapters.mjs';\n"
        "import { BridgeEngineImpl, REQUIRED_PHANTOM_MAX } from './src/engines/bridge-engine/implementation.mjs';\n"
        "import { K40SshBridgeAdapter } from './src/engines/bridge-engine/adapters.mjs';\n"
        "const out = await (async () => {\n"
        + script
        + "\n})();\nconsole.log(JSON.stringify(out));"
    )
    result = subprocess.run(
        ["node", "--input-type=module", "-e", wrapper],
        cwd=BUILD,
        capture_output=True,
        text=True,
        timeout=30,
        env={key: value for key, value in os.environ.items() if key != "BIO_MAX_THREADS"},
    )
    if result.returncode != 0:
        raise AssertionError(result.stdout + result.stderr)
    return json.loads(result.stdout)


class ComputeEngineTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        result = subprocess.run(
            ["node", str(HERE / "compute_engine_compile.cjs")],
            cwd=REPO,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            raise AssertionError(result.stdout + result.stderr)

    def test_missing_seed_returns_exit_3(self) -> None:
        result = run_node(
            "const engine = new ComputeEngineImpl(new MockComputeAdapter());\n"
            "return engine.runTask({taskId:'t',lineId:'line1_bulk',step:'s',argv:['node','-e','console.log(1)']});"
        )
        self.assertEqual(result["exitCode"], 3)
        self.assertEqual(result["stderr"], "ERR_COMPUTE_SEED_MISSING")

    def test_mock_adapter_success_and_nonzero_normalization(self) -> None:
        result = run_node(
            "const engine = new ComputeEngineImpl(new MockComputeAdapter({stdout:'ok',exitCode:7}));\n"
            "return engine.runTask({taskId:'t',lineId:'line1_bulk',step:'s',argv:['x'],seed:20261013});"
        )
        self.assertEqual(result["exitCode"], 1)
        self.assertEqual(result["stdout"], "ok")

    def test_real_child_process_adapter_success(self) -> None:
        result = run_node(
            "const engine = new ComputeEngineImpl(new ChildProcessComputeAdapter());\n"
            "return engine.runTask({taskId:'t',lineId:'line1_bulk',step:'s',argv:[process.execPath,'-e','console.log(\"REAL_OK\")'],seed:20261013});"
        )
        self.assertEqual(result["exitCode"], 0)
        self.assertIn("REAL_OK", result["stdout"])
        self.assertFalse(result["timedOut"])

    def test_timeout_and_batch_mode_boundary(self) -> None:
        result = run_node(
            "const timeout = await new ComputeEngineImpl(new MockComputeAdapter({delayMs:50}), {interactiveMs:10,batchMs:100})\n"
            "  .runTask({taskId:'t',lineId:'line1_bulk',step:'s',argv:['x'],seed:20261013,mode:'interactive'});\n"
            "const batch = await new ComputeEngineImpl(new MockComputeAdapter({delayMs:50}), {interactiveMs:10,batchMs:100})\n"
            "  .runTask({taskId:'t2',lineId:'line1_bulk',step:'s2',argv:['x'],seed:20261013,mode:'batch'});\n"
            "return {timeout,batch};"
        )
        self.assertEqual(result["timeout"]["exitCode"], 1)
        self.assertTrue(result["timeout"]["timedOut"])
        self.assertEqual(result["batch"]["exitCode"], 0)
        self.assertFalse(result["batch"]["timedOut"])

    def test_invalid_argv_returns_exit_2(self) -> None:
        result = run_node(
            "const engine = new ComputeEngineImpl(new MockComputeAdapter());\n"
            "return engine.runTask({taskId:'t',lineId:'line1_bulk',step:'s',argv:[],seed:20261013});"
        )
        self.assertEqual(result["exitCode"], 2)
        self.assertEqual(result["stderr"], "ERR_COMPUTE_ARGV_INVALID")

    def test_default_workers_are_three_and_environment_is_normalized(self) -> None:
        result = run_node(
            "const seen = []; const adapter = {run: async (request) => { seen.push(request); return {exitCode:0,stdout:'ok',stderr:''}; }};\n"
            "const result = await new ComputeEngineImpl(adapter).runTask({taskId:'t',lineId:'line1_bulk',step:'s',argv:['x'],seed:20261013});\n"
            "return {result, request: seen[0]};"
        )
        self.assertEqual(result["result"]["workers"], 3)
        self.assertEqual(result["request"]["workers"], 3)
        self.assertEqual(result["request"]["env"]["BIO_MAX_THREADS"], "3")
        self.assertEqual(result["request"]["env"]["OMP_NUM_THREADS"], "3")
        self.assertEqual(result["request"]["env"]["OPENBLAS_NUM_THREADS"], "3")
        self.assertEqual(result["request"]["env"]["MKL_NUM_THREADS"], "3")
        self.assertEqual(result["request"]["env"]["NUMEXPR_NUM_THREADS"], "3")

    def test_process_environment_override_is_used(self) -> None:
        result = run_node(
            "process.env.BIO_MAX_THREADS = '5';\n"
            "const seen = []; const adapter = {run: async (request) => { seen.push(request); return {exitCode:0,stdout:'ok',stderr:''}; }};\n"
            "const result = await new ComputeEngineImpl(adapter).runTask({taskId:'t',lineId:'line1_bulk',step:'s',argv:['x'],seed:20261013,workers:5});\n"
            "return {result, request: seen[0]};"
        )
        self.assertEqual(result["result"]["workers"], 5)
        self.assertEqual(result["request"]["workers"], 5)
        self.assertEqual(result["request"]["env"]["OMP_NUM_THREADS"], "5")
        self.assertEqual(result["request"]["env"]["OPENBLAS_NUM_THREADS"], "5")
        self.assertEqual(result["request"]["env"]["MKL_NUM_THREADS"], "5")
        self.assertEqual(result["request"]["env"]["NUMEXPR_NUM_THREADS"], "5")

    def test_request_environment_override_takes_precedence(self) -> None:
        result = run_node(
            "process.env.BIO_MAX_THREADS = '5';\n"
            "const seen = []; const adapter = {run: async (request) => { seen.push(request); return {exitCode:0,stdout:'ok',stderr:''}; }};\n"
            "const result = await new ComputeEngineImpl(adapter).runTask({taskId:'t',lineId:'line1_bulk',step:'s',argv:['x'],seed:20261013,workers:7,env:{BIO_MAX_THREADS:'7'}});\n"
            "return {result, request: seen[0]};"
        )
        self.assertEqual(result["result"]["workers"], 7)
        self.assertEqual(result["request"]["workers"], 7)
        self.assertEqual(result["request"]["env"]["OMP_NUM_THREADS"], "7")
        self.assertEqual(result["request"]["env"]["OPENBLAS_NUM_THREADS"], "7")
        self.assertEqual(result["request"]["env"]["MKL_NUM_THREADS"], "7")
        self.assertEqual(result["request"]["env"]["NUMEXPR_NUM_THREADS"], "7")

    def test_invalid_thread_override_returns_exit_2(self) -> None:
        result = run_node(
            "const engine = new ComputeEngineImpl(new MockComputeAdapter());\n"
            "return engine.runTask({taskId:'t',lineId:'line1_bulk',step:'s',argv:['x'],seed:20261013,env:{BIO_MAX_THREADS:'0'}});"
        )
        self.assertEqual(result["exitCode"], 2)
        self.assertEqual(result["stderr"], "ERR_COMPUTE_BIO_MAX_THREADS_INVALID")

    def test_workers_must_match_resolved_thread_count(self) -> None:
        result = run_node(
            "const engine = new ComputeEngineImpl(new MockComputeAdapter());\n"
            "return engine.runTask({taskId:'t',lineId:'line1_bulk',step:'s',argv:['x'],seed:20261013,workers:4});"
        )
        self.assertEqual(result["exitCode"], 2)
        self.assertEqual(result["stderr"], "ERR_COMPUTE_WORKERS_MISMATCH")

    def test_failed_execution_removes_declared_partial_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            partial = Path(tmp) / "partial.tsv"
            partial.write_text("half-written\n", encoding="utf-8")
            result = run_node(
                "const guard = {assertWithinProjectRoot: (target) => target};\n"
                "const engine = new ComputeEngineImpl(new MockComputeAdapter({exitCode:7,stderr:'FAILED'}), {}, guard);\n"
                "return engine.runTask({taskId:'t',lineId:'line1_bulk',step:'s',argv:['x'],seed:20261013,"
                f"projectId:'demo',cleanupPaths:[{json.dumps(str(partial))}]}});"
            )
            self.assertEqual(result["exitCode"], 1)
            self.assertFalse(partial.exists())

    def test_unsafe_cleanup_path_blocks_adapter_and_deletion(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            outside = Path(tmp) / "outside.tsv"
            inside = Path(tmp) / "inside.tsv"
            outside.write_text("outside\n", encoding="utf-8")
            inside.write_text("inside\n", encoding="utf-8")
            result = run_node(
                "let called = false;\n"
                "const adapter = {run: async () => { called = true; return {exitCode:7,stdout:'',stderr:'FAILED'}; }};\n"
                "const guard = {assertWithinProjectRoot: (target, projectId) => {\n"
                "  if (projectId !== 'demo' || !target.startsWith('/safe/demo/')) throw new Error('ERR_PATH_GUARD_PROJECT_OUTSIDE_ROOT');\n"
                "  return target;\n"
                "}};\n"
                "const engine = new ComputeEngineImpl(adapter, {}, guard);\n"
                f"const result = await engine.runTask({{taskId:'t',lineId:'line1_bulk',step:'s',argv:['x'],seed:20261013,projectId:'demo',cleanupPaths:['/safe/demo/ok.tsv',{json.dumps(str(outside))}]}});\n"
                "return {result,called};"
            )
            self.assertEqual(result["result"]["exitCode"], 2)
            self.assertEqual(result["result"]["stderr"], "ERR_COMPUTE_CLEANUP_PATH_UNSAFE")
            self.assertFalse(result["called"])
            self.assertTrue(outside.exists())
            self.assertTrue(inside.exists())

    def test_cleanup_paths_require_project_id_before_adapter(self) -> None:
        result = run_node(
            "let called = false;\n"
            "const adapter = {run: async () => { called = true; return {exitCode:0,stdout:'ok',stderr:''}; }};\n"
            "const guard = {assertWithinProjectRoot: (target) => target};\n"
            "const engine = new ComputeEngineImpl(adapter, {}, guard);\n"
            "const result = await engine.runTask({taskId:'t',lineId:'line1_bulk',step:'s',argv:['x'],seed:20261013,cleanupPaths:['/safe/demo/a.tsv']});\n"
            "return {result,called};"
        )
        self.assertEqual(result["result"]["exitCode"], 2)
        self.assertEqual(result["result"]["stderr"], "ERR_COMPUTE_PROJECT_ID_MISSING")
        self.assertFalse(result["called"])

    @unittest.skipUnless(shutil.which("ssh"), "ssh client unavailable")
    def test_real_k40_bridge_compute_adapter_executes_detached_task(self) -> None:
        result = run_node(
            "const bridge = new BridgeEngineImpl(new K40SshBridgeAdapter({host:'k40'}), "
            "{phantomMaxProcesses:REQUIRED_PHANTOM_MAX,defaultTimeoutMs:20000});\n"
            "const engine = new ComputeEngineImpl(new BridgeComputeAdapter(bridge));\n"
            "return engine.runTask({taskId:'k40-live',lineId:'line1_bulk',step:'smoke',"
            "argv:['printf','K40_COMPUTE_OK'],seed:20261013,workers:3,mode:'interactive'});"
        )
        self.assertEqual(result["exitCode"], 0, result)
        self.assertIn("K40_COMPUTE_OK", result["stdout"])


if __name__ == "__main__":
    unittest.main()
