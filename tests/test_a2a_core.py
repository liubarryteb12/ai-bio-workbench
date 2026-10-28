#!/usr/bin/env python3
"""A2A Core unit tests. Run from the deployed tests directory."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
BUILD_DIR = HERE / ".build"
ENGINE_DIR = HERE.parent / "src" / "engines" / "security-audit-engine"


def run_node(script: str) -> str:
    """Run a snippet against the compiled .mjs modules through an ESM wrapper."""
    wrapper = (
        "import { PathGuard } from './PathGuard.mjs';"
        "import { LedgerStore } from './LedgerStore.mjs';"
        "import { CapabilityBus } from './CapabilityBus.mjs';"
        "import { ModLoader } from './ModLoader.mjs';"
        + script
    )
    result = subprocess.run(
        ["node", "--input-type=module", "-e", wrapper],
        cwd=BUILD_DIR,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


class A2ACoreTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        result = subprocess.run(
            ["node", str(HERE / "a2a_core_compile.cjs")],
            cwd=HERE.parent,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise AssertionError("A2A core compile failed:\n" + result.stdout + result.stderr)
        self_home = os.environ.get("HOME", "/root")
        cls.guard = {"home": "/data/data/com.termux/files/home"}

    def path_guard(self, script: str) -> str:
        home = json.dumps(self.guard["home"])
        return run_node(
            f"const guard = new PathGuard({home});\n"
            + script
        )

    def test_path_guard_allows_mobile_workspace_and_agent_roots(self) -> None:
        result = self.path_guard(
            "const ok = [\n"
            "  guard.isAllowed('/data/data/com.termux/files/home/workspace/projects/demo'),\n"
            "  guard.isAllowed('/data/data/com.termux/files/home/.pi/agent/settings.json'),\n"
            "  guard.isAllowed('projects/demo'),\n"
            "];\nconsole.log(JSON.stringify(ok));"
        )
        self.assertEqual(result, "[true,true,true]")

    def test_path_guard_rejects_forbidden_paths(self) -> None:
        result = self.path_guard(
            "const bad = [\n"
            "  '/sdcard/workspace',\n"
            "  '/storage/emulated/0/workspace',\n"
            "  '/etc/passwd',\n"
            "  'projects/../../etc/passwd',\n"
            "  '/data/data/com.termux/files/home/workspace/../etc/passwd'\n"
            "].map((p) => { try { guard.assertAllowed(p); return false; } catch (e) { return true; } });\n"
            "console.log(JSON.stringify(bad));"
        )
        self.assertEqual(result, "[true,true,true,true,true]")

    def test_ledger_store_supports_five_categories(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = json.dumps(tmp)
            result = run_node(
                f"const store = new LedgerStore({root});\n"
                "store.append('actions', { task: 'probe' });\n"
                "store.append('changes', { files: ['probe.py'] });\n"
                "store.append('errors', { code: 'E_TEST' });\n"
                "store.append('fixes', { code: 'F_TEST' });\n"
                "store.append('pitfalls', { note: 'check CRLF' });\n"
                "console.log(JSON.stringify(store.read('actions')));"
            )
            self.assertEqual(json.loads(result), [{"task": "probe"}])

    def test_ledger_store_rejects_unknown_category(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = json.dumps(tmp)
            result = run_node(
                f"const store = new LedgerStore({root});\n"
                "try { store.append('unknown', {}); console.log('ALLOWED'); }\n"
                "catch (e) { console.log('REJECTED'); }"
            )
            self.assertEqual(result, "REJECTED")

    def test_capability_bus_registers_and_publishes(self) -> None:
        result = run_node(
            "const bus = new CapabilityBus();\n"
            "bus.registerCapability({ id: 'cap.test', ownerModule: 'mod-test', version: '1.0.0' });\n"
            "let seen = 0;\n"
            "bus.subscribe('cap.test', () => { seen += 1; });\n"
            "const count = bus.publish({ type: 'cap.test', payload: { ok: true } });\n"
            "console.log(JSON.stringify({ capability: bus.requireCapability('cap.test').ownerModule, seen, count }));"
        )
        self.assertEqual(json.loads(result), {"capability": "mod-test", "seen": 1, "count": 1})

    def test_capability_bus_rejects_missing_capability(self) -> None:
        result = run_node(
            "const bus = new CapabilityBus();\n"
            "try { bus.requireCapability('missing'); console.log('ALLOWED'); }\n"
            "catch (e) { console.log('REJECTED'); }"
        )
        self.assertEqual(result, "REJECTED")

    def test_mod_loader_loads_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            mod_dir = Path(tmp) / "mod-test"
            mod_dir.mkdir()
            manifest = {
                "id": "mod-test",
                "name": "Test Module",
                "version": "1.0.0",
                "stageOrder": "foundation",
                "plane": "mobile-termux",
                "enginesRequired": ["security-audit-engine"],
                "configPaths": [],
                "verificationScripts": [],
                "capabilitiesProvided": ["cap.test"],
                "capabilitiesConsumed": [],
            }
            (mod_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            root = json.dumps(tmp)
            result = run_node(
                f"const loader = new ModLoader([{root}]);\n"
                "console.log(JSON.stringify(loader.loadAll()));"
            )
            manifests = json.loads(result)
            self.assertEqual(len(manifests), 1)
            self.assertEqual(manifests[0]["id"], "mod-test")

    def test_security_audit_rejects_unsafe_binding(self) -> None:
        sys.path.insert(0, str(ENGINE_DIR))
        try:
            from security_audit import validate_settings

            good = {
                "a2a": {
                    "server": {
                        "enabled": True,
                        "host": "0.0.0.0",
                        "peerTokens": {"codex": "f" * 48},
                        "trustedPeers": ["codex"],
                        "allowAllUsers": False,
                        "maxConcurrent": 2,
                    }
                }
            }
            self.assertEqual(validate_settings(good), [])

            bad = json.loads(json.dumps(good))
            bad["a2a"]["server"]["peerTokens"] = {}
            self.assertIn("ERR_PEER_TOKENS_REQUIRED_FOR_0_0_0_0", validate_settings(bad))

            bad = json.loads(json.dumps(good))
            bad["a2a"]["server"]["allowAllUsers"] = True
            self.assertIn("ERR_ALLOW_ALL_FORBIDDEN", validate_settings(bad))

            bad = json.loads(json.dumps(good))
            bad["a2a"]["server"]["maxConcurrent"] = 3
            self.assertIn("ERR_MAX_CONCURRENT_ABOVE_2", validate_settings(bad))
        finally:
            sys.path.remove(str(ENGINE_DIR))


if __name__ == "__main__":
    unittest.main()
