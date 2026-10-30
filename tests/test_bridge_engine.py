#!/usr/bin/env python3
"""Bridge engine command guard, phantom, precision and hash tests."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
BUILD = HERE / ".bridge_build"


def run_node(script: str) -> dict:
    wrapper = (
        "import {\n"
        "  BridgeEngineImpl, REQUIRED_PHANTOM_MAX, assertSafeCommand, formatFloat17, assertSameHash\n"
        "} from './src/engines/bridge-engine/implementation.mjs';\n"
        "import { MockBridgeAdapter, ChildProcessBridgeAdapter, K40SshBridgeAdapter } from './src/engines/bridge-engine/adapters.mjs';\n"
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
    )
    if result.returncode != 0:
        raise AssertionError(result.stdout + result.stderr)
    return json.loads(result.stdout)


class BridgeEngineTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        result = subprocess.run(
            ["node", str(HERE / "bridge_engine_compile.cjs")],
            cwd=REPO,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            raise AssertionError(result.stdout + result.stderr)

    def test_command_guard(self) -> None:
        result = run_node(
            "const safe = (() => { try { assertSafeCommand('echo ok'); return true; } catch { return false; } })();\n"
            "const denied = ['find /', 'ps aux', 'grep -r x .', 'cat /sdcard/x', 'qemu-system-aarch64']\n"
            "  .map((cmd) => { try { assertSafeCommand(cmd); return 'ALLOWED'; } catch (e) { return e.message.split(':')[0]; } });\n"
            "return {safe,denied};"
        )
        self.assertTrue(result["safe"])
        self.assertEqual(result["denied"], [
            "ERR_BRIDGE_FIND_FORBIDDEN",
            "ERR_BRIDGE_PS_FORBIDDEN",
            "ERR_BRIDGE_GREP_R_FORBIDDEN",
            "ERR_BRIDGE_FUSE_PATH_FORBIDDEN",
            "ERR_BRIDGE_QEMU_FORBIDDEN",
        ])

    def test_forbidden_command_and_phantom_guard_return_exit_2(self) -> None:
        result = run_node(
            "const engine = new BridgeEngineImpl(new MockBridgeAdapter(), {phantomMaxProcesses:REQUIRED_PHANTOM_MAX});\n"
            "const forbidden = await engine.invokeRemote({command:'find /'});\n"
            "const phantom = await new BridgeEngineImpl(new MockBridgeAdapter(), {phantomMaxProcesses:1})\n"
            "  .invokeRemote({command:'echo ok'});\n"
            "return {forbidden,phantom};"
        )
        self.assertEqual(result["forbidden"]["exitCode"], 2)
        self.assertIn("ERR_BRIDGE_FIND_FORBIDDEN", result["forbidden"]["stderr"])
        self.assertEqual(result["phantom"]["exitCode"], 2)
        self.assertIn("ERR_BRIDGE_PHANTOM_LIMIT", result["phantom"]["stderr"])

    def test_mock_and_real_child_process_adapters(self) -> None:
        result = run_node(
            "const mock = await new BridgeEngineImpl(new MockBridgeAdapter({stdout:'MOCK_BRIDGE'}), {phantomMaxProcesses:REQUIRED_PHANTOM_MAX})\n"
            "  .invokeRemote({command:'echo safe'});\n"
            "const real = await new BridgeEngineImpl(new ChildProcessBridgeAdapter(), {phantomMaxProcesses:REQUIRED_PHANTOM_MAX})\n"
            "  .invokeRemote({command:'echo REAL_BRIDGE'});\n"
            "return {mock,real};"
        )
        self.assertEqual(result["mock"]["exitCode"], 0)
        self.assertEqual(result["mock"]["stdout"], "MOCK_BRIDGE")
        self.assertEqual(result["real"]["exitCode"], 0)
        self.assertIn("REAL_BRIDGE", result["real"]["stdout"])

    def test_timeout_returns_exit_1(self) -> None:
        result = run_node(
            "const engine = new BridgeEngineImpl(new MockBridgeAdapter({delayMs:50}), {phantomMaxProcesses:REQUIRED_PHANTOM_MAX,defaultTimeoutMs:10});\n"
            "return engine.invokeRemote({command:'echo safe'});"
        )
        self.assertEqual(result["exitCode"], 1)
        self.assertTrue(result["timedOut"])
        self.assertIn("ERR_BRIDGE_TIMEOUT", result["stderr"])

    def test_unknown_phantom_limit_fails_closed(self) -> None:
        result = run_node(
            "let called = false;\n"
            "const adapter = {invoke: async () => { called = true; return {exitCode:0,stdout:'bad',stderr:''}; }};\n"
            "const result = await new BridgeEngineImpl(adapter).invokeRemote({command:'echo safe'});\n"
            "return {result,called};"
        )
        self.assertEqual(result["result"]["exitCode"], 2)
        self.assertEqual(result["result"]["stderr"], "ERR_BRIDGE_LIMIT_UNKNOWN")
        self.assertFalse(result["called"])

    def test_float17_and_hash_alignment(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source.sh"
            same = Path(tmp) / "same.sh"
            different = Path(tmp) / "different.sh"
            source.write_bytes(b"echo bridge\n")
            same.write_bytes(b"echo bridge\n")
            different.write_bytes(b"echo other\n")
            result = run_node(
                f"const float17 = formatFloat17(0.1);\n"
                f"const same = (() => {{ try {{ assertSameHash({json.dumps(str(source))},{json.dumps(str(same))}); return 'SAME'; }} catch (e) {{ return e.message; }} }})();\n"
                f"const diff = (() => {{ try {{ assertSameHash({json.dumps(str(source))},{json.dumps(str(different))}); return 'ALLOWED'; }} catch (e) {{ return e.message.split(':')[0]; }} }})();\n"
                "return {float17,same,diff};"
            )
            self.assertEqual(result["float17"], "0.10000000000000001")
            self.assertEqual(result["same"], "SAME")
            self.assertEqual(result["diff"], "ERR_BRIDGE_HASH_MISMATCH")

    @unittest.skipUnless(shutil.which("ssh"), "ssh client unavailable")
    def test_real_k40_ssh_adapter_executes_remote_probe(self) -> None:
        result = run_node(
            "const engine = new BridgeEngineImpl(new K40SshBridgeAdapter({host:'k40'}), "
            "{phantomMaxProcesses:REQUIRED_PHANTOM_MAX,defaultTimeoutMs:20000});\n"
            "return engine.invokeRemote({command:'printf K40_SSH_OK'});"
        )
        self.assertEqual(result["exitCode"], 0, result)
        self.assertIn("K40_SSH_OK", result["stdout"])


if __name__ == "__main__":
    unittest.main()
