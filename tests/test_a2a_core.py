#!/usr/bin/env python3
"""A2A Core unit tests. Run from the deployed tests directory."""

from __future__ import annotations

import json
import hashlib
import os
import re
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
        "import { SlotManager } from './SlotManager.mjs';"
        "import { DeliverableCollector } from './DeliverableCollector.mjs';"
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

    def test_path_guard_allows_container_bio_data_root_without_prefix_leakage(self) -> None:
        result = self.path_guard(
            "const out = [\n"
            "  guard.isAllowed('/mnt/ssd/bio_data'),\n"
            "  guard.isAllowed('/mnt/ssd/bio_data/PRJ_K40_SMOKE/outputs/result.tsv'),\n"
            "  guard.isAllowed('/mnt/ssd/bio_data_evil/result.tsv')\n"
            "];\nconsole.log(JSON.stringify(out));"
        )
        self.assertEqual(result, "[true,true,false]")

    def test_path_guard_rejects_forbidden_paths(self) -> None:
        result = self.path_guard(
            "const bad = [\n"
            "  '/sdcard/workspace',\n"
            "  '/storage/emulated/0/workspace',\n"
            "  '/storage/self/primary/workspace',\n"
            "  '/etc/passwd',\n"
            "  'projects/../../etc/passwd',\n"
            "  '/data/data/com.termux/files/home/workspace/../etc/passwd'\n"
            "].map((p) => { try { guard.assertAllowed(p); return false; } catch (e) { return true; } });\n"
            "console.log(JSON.stringify(bad));"
        )
        self.assertEqual(result, "[true,true,true,true,true,true]")

    def test_path_guard_scope_resolution_returns_exit_2_for_traversal(self) -> None:
        result = self.path_guard(
            "const out = guard.resolveSafePath('DATA', '../../etc/passwd');\n"
            "console.log(JSON.stringify({\n"
            "  exitCode: out.exitCode,\n"
            "  resolvedPath: out.resolvedPath,\n"
            "  violationReason: out.violationReason\n"
            "}));"
        )
        parsed = json.loads(result)
        self.assertEqual(parsed["exitCode"], 2)
        self.assertEqual(parsed["resolvedPath"], "")
        self.assertTrue(parsed["violationReason"])

    def test_path_guard_project_root_accepts_both_runtime_roots(self) -> None:
        result = self.path_guard(
            "const paths = ["
            "guard.assertWithinProjectRoot('/data/data/com.termux/files/home/workspace/projects/demo/results/a.tsv', 'demo'),"
            "guard.assertWithinProjectRoot('/mnt/ssd/bio_data/projects/demo/results/a.tsv', 'demo')"
            "]; console.log(JSON.stringify(paths));"
        )
        self.assertEqual(
            json.loads(result),
            [
                "/data/data/com.termux/files/home/workspace/projects/demo/results/a.tsv",
                "/mnt/ssd/bio_data/projects/demo/results/a.tsv",
            ],
        )

    def test_path_guard_project_root_rejects_cross_project_and_traversal(self) -> None:
        result = self.path_guard(
            "const bad = ["
            "'/mnt/ssd/bio_data/projects/other/results/a.tsv',"
            "'/mnt/ssd/bio_data/projects/demo/../other/a.tsv'"
            "].map((p) => { try { guard.assertWithinProjectRoot(p, 'demo'); return false; } catch { return true; } }); console.log(JSON.stringify(bad));"
        )
        self.assertEqual(json.loads(result), [True, True])

    def test_path_guard_project_root_requires_strict_posix_boundaries(self) -> None:
        result = self.path_guard(
            "const bad = ["
            "'projects/demo/results/a.tsv',"
            "'/mnt/ssd/bio_data/projects/demo/results\\\\..\\\\other/a.tsv',"
            "'/mnt/ssd/bio_data/projects/demo/result.tsv\\u0000.txt',"
            "'/sdcard/projects/demo/results/a.tsv',"
            "'/mnt/ssd/bio_data_evil/projects/demo/results/a.tsv',"
            "'/mnt/ssd/bio_data/projects/demo_evil/results/a.tsv'"
            "].map((p) => { try { guard.assertWithinProjectRoot(p, 'demo'); return false; } catch { return true; } });\n"
            "const ids = ['../demo', 'demo/other', ' ', '..', 'demo..']"
            ".map((id) => { try { guard.assertWithinProjectRoot('/mnt/ssd/bio_data/projects/demo/a.tsv', id); return false; } catch { return true; } });\n"
            "console.log(JSON.stringify({bad, ids}));"
        )
        self.assertEqual(json.loads(result), {
            "bad": [True, True, True, True, True, True],
            "ids": [True, True, True, True, True],
        })

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

    def test_ledger_store_append_record_syncs_sha256_index(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = json.dumps(tmp)
            result = run_node(
                f"const store = new LedgerStore({root});\n"
                "store.appendRecord('actions', { task: 'index-probe' });\n"
                "console.log(JSON.stringify(store.readIndex()));"
            )
            index = json.loads(result)
            ledger_file = Path(tmp) / "actions.jsonl"
            expected_sha = hashlib.sha256(ledger_file.read_bytes()).hexdigest()
            self.assertEqual(index["streams"]["actions"]["path"], "actions.jsonl")
            self.assertEqual(index["streams"]["actions"]["lineCount"], 1)
            self.assertEqual(index["streams"]["actions"]["sha256"], expected_sha)
            self.assertTrue((Path(tmp) / "INDEX.json").is_file())

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

    def test_capability_bus_query_returns_deeply_frozen_read_only_data(self) -> None:
        result = run_node(
            "const bus = new CapabilityBus();\n"
            "bus.registerCapability('mod-reader', {\n"
            "  capabilityId: 'summary.read',\n"
            "  version: '1.0.0',\n"
            "  executeReadOnly: async () => ({ nested: { values: [1, 2, 3] } })\n"
            "});\n"
            "const out = await bus.query('summary.read', { batchId: 'b1' });\n"
            "let mutationBlocked = false;\n"
            "try { out.data.nested.values.push(4); } catch { mutationBlocked = true; }\n"
            "console.log(JSON.stringify({\n"
            "  exitCode: out.exitCode,\n"
            "  values: out.data.nested.values,\n"
            "  dataFrozen: Object.isFrozen(out.data),\n"
            "  nestedFrozen: Object.isFrozen(out.data.nested),\n"
            "  valuesFrozen: Object.isFrozen(out.data.nested.values),\n"
            "  mutationBlocked\n"
            "}));"
        )
        self.assertEqual(
            json.loads(result),
            {
                "exitCode": 0,
                "values": [1, 2, 3],
                "dataFrozen": True,
                "nestedFrozen": True,
                "valuesFrozen": True,
                "mutationBlocked": True,
            },
        )

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
            self.assertEqual(manifests[0]["modId"], "mod-test")

    def test_mod_loader_accepts_imported_manifest_objects(self) -> None:
        result = run_node(
            "const loader = new ModLoader([]);\n"
            "const [loaded] = loader.loadManifestObjects([{\n"
            "  modId:'mod-imported', displayName:'Imported', version:'1.0.0', state:'ready',\n"
            "  stageOrder:'feature', plane:'cross-plane', enginesRequired:[],\n"
            "  configPaths:[], verificationScripts:[], capabilitiesProvided:[],\n"
            "  capabilitiesConsumed:[], dbStores:[], artifacts:[],\n"
            "  slots:[{slotId:'workbench.selfcheck-cards',order:1,title:'Imported slot',renderAdapter:()=>({kind:'panel'})}],\n"
            "  initialize:async()=>0, teardown:async()=>0\n"
            "}]);\n"
            "console.log(JSON.stringify({modId:loaded.modId,state:loaded.state,title:loaded.slots[0].title}));"
        )
        self.assertEqual(
            json.loads(result),
            {"modId": "mod-imported", "state": "ready", "title": "Imported slot"},
        )

    def test_mod_loader_degrades_manifest_when_sample_artifact_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as data_tmp:
            mod_dir = Path(tmp) / "mod-missing-artifact"
            mod_dir.mkdir()
            manifest = {
                "id": "mod-missing-artifact",
                "name": "Missing Artifact",
                "version": "1.0.0",
                "stageOrder": "feature",
                "plane": "cross-plane",
                "enginesRequired": [],
                "configPaths": [],
                "verificationScripts": [],
                "capabilitiesProvided": [],
                "capabilitiesConsumed": [],
                "state": "ready",
                "slots": [],
                "artifacts": [{
                    "lines": ["src/mod.ts:1-2"],
                    "analysis_step": "sample.step",
                    "produces": "SAMPLE_OUTPUT",
                    "output_glob": "outputs/*.tsv",
                    "source_sha256": "a" * 64,
                    "preview_sha256": "b" * 64,
                    "sample_project_output": "outputs/missing.tsv",
                }],
            }
            (mod_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            root = json.dumps(tmp)
            data_root = json.dumps(data_tmp)
            result = run_node(
                f"const loader = new ModLoader([{root}], {{ dataRoot: {data_root} }});\n"
                "const [loaded] = loader.loadAll();\n"
                "console.log(JSON.stringify({ modId: loaded.modId, state: loaded.state }));"
            )
            self.assertEqual(
                json.loads(result),
                {"modId": "mod-missing-artifact", "state": "degraded"},
            )

    def test_mod_loader_degrades_manifest_when_preview_hash_is_wrong(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as data_tmp:
            mod_dir = Path(tmp) / "mod-wrong-preview"
            mod_dir.mkdir()
            output = Path(data_tmp) / "outputs" / "sample.tsv"
            output.parent.mkdir()
            output.write_text("actual\n", encoding="utf-8")
            manifest = {
                "id": "mod-wrong-preview",
                "name": "Wrong Preview",
                "version": "1.0.0",
                "stageOrder": "feature",
                "plane": "cross-plane",
                "enginesRequired": [],
                "configPaths": [],
                "verificationScripts": [],
                "capabilitiesProvided": [],
                "capabilitiesConsumed": [],
                "state": "ready",
                "slots": [],
                "artifacts": [{
                    "lines": ["src/mod.ts:1-2"],
                    "analysis_step": "sample.step",
                    "produces": "SAMPLE_OUTPUT",
                    "output_glob": "outputs/*.tsv",
                    "source_sha256": "a" * 64,
                    "preview_sha256": "b" * 64,
                    "sample_project_output": "outputs/sample.tsv",
                }],
            }
            (mod_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            root = json.dumps(tmp)
            data_root = json.dumps(data_tmp)
            result = run_node(
                f"const loader = new ModLoader([{root}], {{ dataRoot: {data_root} }});\n"
                "const [loaded] = loader.loadAll();\n"
                "console.log(JSON.stringify({ modId: loaded.modId, state: loaded.state }));"
            )
            self.assertEqual(
                json.loads(result),
                {"modId": "mod-wrong-preview", "state": "degraded"},
            )

    def test_mod_loader_degrades_manifest_when_source_hash_is_wrong(self) -> None:
        with (
            tempfile.TemporaryDirectory() as tmp,
            tempfile.TemporaryDirectory() as data_tmp,
            tempfile.TemporaryDirectory() as source_tmp,
        ):
            mod_dir = Path(tmp) / "mod-wrong-source"
            mod_dir.mkdir()
            output = Path(data_tmp) / "outputs" / "sample.tsv"
            output.parent.mkdir()
            output_bytes = b"actual\n"
            output.write_bytes(output_bytes)
            source = Path(source_tmp) / "src" / "mod.ts"
            source.parent.mkdir()
            source.write_text("export const value = 1;\n", encoding="utf-8")
            manifest = {
                "id": "mod-wrong-source",
                "name": "Wrong Source",
                "version": "1.0.0",
                "stageOrder": "feature",
                "plane": "cross-plane",
                "enginesRequired": [],
                "configPaths": [],
                "verificationScripts": [],
                "capabilitiesProvided": [],
                "capabilitiesConsumed": [],
                "state": "ready",
                "slots": [],
                "artifacts": [{
                    "lines": ["src/mod.ts:1-2"],
                    "analysis_step": "sample.step",
                    "produces": "SAMPLE_OUTPUT",
                    "output_glob": "outputs/*.tsv",
                    "source_sha256": "a" * 64,
                    "preview_sha256": hashlib.sha256(output_bytes).hexdigest(),
                    "sample_project_output": "outputs/sample.tsv",
                }],
            }
            (mod_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            root = json.dumps(tmp)
            data_root = json.dumps(data_tmp)
            source_root = json.dumps(source_tmp)
            result = run_node(
                f"const loader = new ModLoader([{root}], {{ dataRoot: {data_root}, sourceRoot: {source_root} }});\n"
                "const [loaded] = loader.loadAll();\n"
                "console.log(JSON.stringify({ modId: loaded.modId, state: loaded.state }));"
            )
            self.assertEqual(
                json.loads(result),
                {"modId": "mod-wrong-source", "state": "degraded"},
            )

    def test_mod_loader_records_degradation_in_error_ledger(self) -> None:
        with (
            tempfile.TemporaryDirectory() as tmp,
            tempfile.TemporaryDirectory() as data_tmp,
            tempfile.TemporaryDirectory() as ledger_tmp,
        ):
            mod_dir = Path(tmp) / "mod-ledger"
            mod_dir.mkdir()
            manifest = {
                "id": "mod-ledger",
                "name": "Ledger Degrade",
                "version": "1.0.0",
                "stageOrder": "feature",
                "plane": "cross-plane",
                "enginesRequired": [],
                "configPaths": [],
                "verificationScripts": [],
                "capabilitiesProvided": [],
                "capabilitiesConsumed": [],
                "state": "ready",
                "slots": [],
                "artifacts": [{
                    "lines": ["src/mod.ts:1-2"],
                    "analysis_step": "sample.step",
                    "produces": "SAMPLE_OUTPUT",
                    "output_glob": "outputs/*.tsv",
                    "source_sha256": "a" * 64,
                    "preview_sha256": "b" * 64,
                    "sample_project_output": "outputs/missing.tsv",
                }],
            }
            (mod_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            result = run_node(
                f"const loader = new ModLoader([{json.dumps(tmp)}], "
                f"{{ dataRoot: {json.dumps(data_tmp)}, ledgerRoot: {json.dumps(ledger_tmp)} }});\n"
                "loader.loadAll();\n"
                "console.log(JSON.stringify({}));"
            )
            self.assertEqual(json.loads(result), {})
            errors = (Path(ledger_tmp) / "errors.jsonl").read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(errors), 1)
            record = json.loads(errors[0])
            self.assertEqual(record["modId"], "mod-ledger")
            self.assertEqual(record["state"], "degraded")
            index = json.loads((Path(ledger_tmp) / "INDEX.json").read_text(encoding="utf-8"))
            self.assertEqual(index["streams"]["errors"]["lineCount"], 1)

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

    def test_security_audit_scans_code_and_skips_env_or_docs(self) -> None:
        sys.path.insert(0, str(ENGINE_DIR))
        try:
            from security_audit import scan_repository

            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                token = "a2a_sec_" + "a" * 48
                (root / ".env").write_text(f"A2A_TOKEN={token}\n", encoding="utf-8")
                (root / "README.md").write_text(f"example: {token}\n", encoding="utf-8")
                (root / "settings.json").write_text(
                    json.dumps({"peerToken": token}),
                    encoding="utf-8",
                )
                findings = scan_repository(root)
            self.assertEqual(
                [(item["path"], item["pattern"]) for item in findings],
                [("settings.json", "A2A_PEER_TOKEN")],
            )
        finally:
            sys.path.remove(str(ENGINE_DIR))

    def test_slot_manager_orders_and_degrades_empty_slots(self) -> None:
        result = run_node(
            "const slots = new SlotManager();\n"
            "slots.register('mod-z', [{slotId:'workspace.main',order:20,title:'Z',renderAdapter:()=> 'z'}]);\n"
            "slots.register('mod-a', [{slotId:'workspace.main',order:10,title:'A',renderAdapter:()=> 'a'}]);\n"
            "const ordered = slots.list('workspace.main').map((x) => x.title);\n"
            "const empty = slots.renderPlan().find((x) => x.slotId === 'inspector.panel').empty;\n"
            "slots.unregister('mod-a');\n"
            "const after = slots.list('workspace.main').map((x) => x.title);\n"
            "console.log(JSON.stringify({ordered, empty, after}));"
        )
        self.assertEqual(json.loads(result), {"ordered": ["A", "Z"], "empty": True, "after": ["Z"]})

    def test_slot_manager_supports_pi_observability_workbench_slots(self) -> None:
        result = run_node(
            "const slots = new SlotManager();\n"
            "slots.register('mod-pi-observability', [\n"
            "  {slotId:'workbench.selfcheck-cards',order:500,title:'Pi status',renderAdapter:()=> 'status'},\n"
            "  {slotId:'workbench.studio-preview',order:500,title:'Pi monitor',renderAdapter:()=> 'monitor'}\n"
            "]);\n"
            "console.log(JSON.stringify({\n"
            "  status: slots.list('workbench.selfcheck-cards').map((x) => x.title),\n"
            "  preview: slots.list('workbench.studio-preview').map((x) => x.title)\n"
            "}));"
        )
        self.assertEqual(
            json.loads(result),
            {"status": ["Pi status"], "preview": ["Pi monitor"]},
        )

    def test_deliverable_collector_verifies_real_file_sha256(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            payload = b"artifact-v1\n"
            (Path(tmp) / "out.tsv").write_bytes(payload)
            sha = hashlib.sha256(payload).hexdigest()
            root = json.dumps(tmp)
            result = run_node(
                f"const collector = new DeliverableCollector({root});\n"
                "const mods = [{modId:'mod-a', state:'ready', artifacts:[{\n"
                "  lines:['src/a.ts:1-2'], analysis_step:'step_1', produces:'table',\n"
                "  output_glob:'out.tsv', source_sha256:'a'.repeat(64), preview_sha256:" + json.dumps(sha) + ",\n"
                "  sample_project_output:'out.tsv'\n"
                "}]}];\n"
                "const out = collector.collectVerified(mods);\n"
                "console.log(JSON.stringify(out.map((x) => ({modId:x.modId, size:x.sizeBytes, sha:x.actualSha256}))));"
            )
            self.assertEqual(json.loads(result), [{"modId": "mod-a", "size": len(payload), "sha": sha}])

    def test_deliverable_collector_blocks_missing_or_tampered_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = json.dumps(tmp)
            base = (
                f"const collector = new DeliverableCollector({root});\n"
                "const artifact = {lines:['src/a.ts:1'],analysis_step:'s',produces:'table',output_glob:'out.tsv',source_sha256:'a'.repeat(64),preview_sha256:'b'.repeat(64),sample_project_output:'out.tsv'};\n"
            )
            missing = run_node(
                base
                + "try { collector.collectVerified([{modId:'m',state:'ready',artifacts:[artifact]}]); console.log('ALLOWED'); }\n"
                + "catch (e) { console.log(e.message.split(':')[0]); }"
            )
            self.assertEqual(missing, "ERR_ARTIFACT_FILE_MISSING")

            (Path(tmp) / "out.tsv").write_bytes(b"tampered\n")
            mismatch = run_node(
                base
                + "try { collector.collectVerified([{modId:'m',state:'ready',artifacts:[artifact]}]); console.log('ALLOWED'); }\n"
                + "catch (e) { console.log(e.message.split(':')[0]); }"
            )
            self.assertEqual(mismatch, "ERR_ARTIFACT_SHA256_MISMATCH")

            traversal = run_node(
                f"const collector = new DeliverableCollector({root});\n"
                "const artifact = {lines:['x'],analysis_step:'s',produces:'table',output_glob:'../out.tsv',source_sha256:'a'.repeat(64),preview_sha256:'b'.repeat(64),sample_project_output:'../out.tsv'};\n"
                "try { collector.collectVerified([{modId:'m',state:'ready',artifacts:[artifact]}]); console.log('ALLOWED'); }\n"
                "catch (e) { console.log(e.message.split(':')[0]); }"
            )
            self.assertEqual(traversal, "ERR_ARTIFACT_OUTPUT_PATH_UNSAFE")

            skipped = run_node(
                base
                + "console.log(JSON.stringify(collector.collectVerified([{modId:'m',state:'degraded',artifacts:[artifact]}])));"
            )
            self.assertEqual(skipped, "[]")

    def test_deliverable_collector_blocks_source_hash_drift(self) -> None:
        with (
            tempfile.TemporaryDirectory() as data_tmp,
            tempfile.TemporaryDirectory() as source_tmp,
        ):
            payload = b"artifact-v1\n"
            (Path(data_tmp) / "out.tsv").write_bytes(payload)
            source = Path(source_tmp) / "src" / "a.ts"
            source.parent.mkdir()
            source.write_text("export const artifact = 1;\n", encoding="utf-8")
            preview_sha = hashlib.sha256(payload).hexdigest()
            result = run_node(
                f"const collector = new DeliverableCollector({json.dumps(data_tmp)}, {{ sourceRoot: {json.dumps(source_tmp)} }});\n"
                "const artifact = {lines:['src/a.ts:1-2'],analysis_step:'s',produces:'table',output_glob:'out.tsv',source_sha256:'a'.repeat(64),preview_sha256:"
                + json.dumps(preview_sha)
                + ",sample_project_output:'out.tsv'};\n"
                "try { collector.collectVerified([{modId:'m',state:'ready',artifacts:[artifact]}]); console.log('ALLOWED'); }\n"
                "catch (e) { console.log(e.message.split(':')[0]); }"
            )
            self.assertEqual(result, "ERR_ARTIFACT_SOURCE_SHA256_MISMATCH")

    def test_mod_manifest_has_single_definition(self) -> None:
        definitions = []
        repo = HERE.parent
        for path in (repo / "src").rglob("*.ts"):
            text = path.read_text(encoding="utf-8")
            if re.search(r"export\s+(?:interface|type)\s+ModManifest\b", text):
                definitions.append(path.relative_to(repo).as_posix())
        self.assertEqual(definitions, ["src/core/types.ts"])

    def test_every_mod_manifest_uses_the_canonical_contract(self) -> None:
        missing = {}
        required = [
            "modId:",
            "displayName:",
            "state:",
            "dbStores:",
            "initialize:",
            "teardown:",
        ]
        for path in (HERE.parent / "src" / "mods").glob("*/manifest.ts"):
            text = path.read_text(encoding="utf-8")
            absent = [field for field in required if field not in text]
            if absent:
                missing[path.parent.name] = absent
        self.assertEqual(missing, {})


if __name__ == "__main__":
    unittest.main()
