#!/usr/bin/env python3
"""Portal sync business adapter tests."""

from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
BUILD = HERE / ".portal_sync_build"


def run_node(script: str) -> dict:
    wrapper = (
        "import * as crypto from 'node:crypto';\n"
        "import { PortalSyncAdapter } from './src/mods/mod-portal-sync/implementation.mjs';\n"
        "import { manifest as portalManifest } from './src/mods/mod-portal-sync/manifest.mjs';\n"
        "import { DeliverableCollector } from './src/core/DeliverableCollector.mjs';\n"
        "import { SyncEngineImpl } from './src/engines/sync-engine/implementation.mjs';\n"
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


class PortalSyncTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        result = subprocess.run(
            ["node", str(HERE / "portal_sync_compile.cjs")],
            cwd=REPO,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            raise AssertionError(result.stdout + result.stderr)

    def test_manifest_slot_and_signed_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            payload = b"artifact-v1\n"
            artifact = Path(tmp) / "artifact.tsv"
            artifact.write_bytes(payload)
            sha = hashlib.sha256(payload).hexdigest()
            result = run_node(
                "const keys = crypto.generateKeyPairSync('ed25519');\n"
                "const priv = keys.privateKey.export({type:'pkcs8',format:'pem'});\n"
                "const pub = keys.publicKey.export({type:'spki',format:'pem'});\n"
                f"const artifact = {{lines:['src/a.ts:1'],analysis_step:'deg',produces:'table',output_glob:'artifact.tsv',source_sha256:'a'.repeat(64),preview_sha256:{json.dumps(sha)},sample_project_output:'artifact.tsv'}};\n"
                f"const mods = [{{modId:'mod-a',state:'ready',artifacts:[artifact]}}];\n"
                f"const adapter = new PortalSyncAdapter(new DeliverableCollector({json.dumps(tmp)}), new SyncEngineImpl());\n"
                "const exported = await adapter.exportSignedDeliverable({id:'p1',mods,privateKeyPem:priv});\n"
                "const imported = await adapter.importVerifiedBundle(exported.packlet,pub);\n"
                "return {slot:portalManifest.slots[0].slotId,artifacts:exported.manifest.artifacts,imported};"
            )
            self.assertEqual(result["slot"], "topbar.action")
            self.assertEqual(len(result["artifacts"]), 1)
            self.assertEqual(result["artifacts"][0]["relativePath"], "artifact.tsv")
            self.assertEqual(result["imported"]["schema_version"], "1.0")
            self.assertEqual(result["imported"]["artifacts"][0]["sha256"], sha)

    def test_non_ready_and_missing_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = run_node(
                "const keys = crypto.generateKeyPairSync('ed25519');\n"
                "const priv = keys.privateKey.export({type:'pkcs8',format:'pem'});\n"
                f"const adapter = new PortalSyncAdapter(new DeliverableCollector({json.dumps(tmp)}), new SyncEngineImpl());\n"
                "const artifact = {lines:['x'],analysis_step:'s',produces:'table',output_glob:'missing.tsv',source_sha256:'a'.repeat(64),preview_sha256:'b'.repeat(64),sample_project_output:'missing.tsv'};\n"
                "const skipped = await adapter.exportSignedDeliverable({id:'skip',mods:[{modId:'m',state:'degraded',artifacts:[artifact]}],privateKeyPem:priv});\n"
                "let missing = ''; try { await adapter.exportSignedDeliverable({id:'missing',mods:[{modId:'m',state:'ready',artifacts:[artifact]}],privateKeyPem:priv}); } catch (e) { missing = e.message.split(':')[0]; }\n"
                "return {skipped:skipped.manifest.artifacts.length,missing};"
            )
            self.assertEqual(result["skipped"], 0)
            self.assertEqual(result["missing"], "ERR_ARTIFACT_FILE_MISSING")

    def test_tampered_packlet_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            payload = b"tamper-target\n"
            (Path(tmp) / "a.tsv").write_bytes(payload)
            sha = hashlib.sha256(payload).hexdigest()
            result = run_node(
                "const keys = crypto.generateKeyPairSync('ed25519');\n"
                "const priv = keys.privateKey.export({type:'pkcs8',format:'pem'});\n"
                "const pub = keys.publicKey.export({type:'spki',format:'pem'});\n"
                f"const artifact = {{lines:['x'],analysis_step:'s',produces:'table',output_glob:'a.tsv',source_sha256:'a'.repeat(64),preview_sha256:{json.dumps(sha)},sample_project_output:'a.tsv'}};\n"
                f"const adapter = new PortalSyncAdapter(new DeliverableCollector({json.dumps(tmp)}), new SyncEngineImpl());\n"
                "const exported = await adapter.exportSignedDeliverable({id:'p',mods:[{modId:'m',state:'ready',artifacts:[artifact]}],privateKeyPem:priv});\n"
                "const bad = structuredClone(exported.packlet); bad.chunks[0].dataBase64 = Buffer.from('bad').toString('base64');\n"
                "try { await adapter.importVerifiedBundle(bad,pub); return {error:'ALLOWED'}; } catch (e) { return {error:e.message.split(':')[0]}; }"
            )
            self.assertEqual(result["error"], "ERR_SYNC_CHUNK_HASH_MISMATCH")

    def test_execution_matrix_rejects_empty_oversized_gapped_tampered_and_stale(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            payload = b"matrix-target\n"
            (Path(tmp) / "a.tsv").write_bytes(payload)
            sha = hashlib.sha256(payload).hexdigest()
            result = run_node(
                "const keys = crypto.generateKeyPairSync('ed25519');\n"
                "const priv = keys.privateKey.export({type:'pkcs8',format:'pem'});\n"
                "const pub = keys.publicKey.export({type:'spki',format:'pem'});\n"
                "const engine = new SyncEngineImpl();\n"
                f"const adapter = new PortalSyncAdapter(new DeliverableCollector({json.dumps(tmp)}), engine);\n"
                f"const artifact = {{lines:['x'],analysis_step:'s',produces:'table',output_glob:'a.tsv',source_sha256:'a'.repeat(64),preview_sha256:{json.dumps(sha)},sample_project_output:'a.tsv'}};\n"
                "const mods = [{modId:'m',state:'ready',artifacts:[artifact]}];\n"
                "let empty = ''; try { await engine.packSigned(Buffer.alloc(0),priv); } catch (e) { empty = e.message.split(':')[0]; }\n"
                "const exported = await adapter.exportSignedDeliverable({id:'matrix',mods,privateKeyPem:priv});\n"
                "const oversized = structuredClone(exported.packlet); oversized.chunkSize = 512 * 1024 + 1;\n"
                "let oversizedError = ''; try { await adapter.importVerifiedBundle(oversized,pub); } catch (e) { oversizedError = e.message.split(':')[0]; }\n"
                "const large = await engine.packSigned(Buffer.from(JSON.stringify({schema_version:'1.0',generated_at:new Date().toISOString(),artifacts:[]})),priv);\n"
                "const gapped = structuredClone(large); gapped.chunks.push({...gapped.chunks[0],index:2});\n"
                "let gapError = ''; try { await adapter.importVerifiedBundle(gapped,pub); } catch (e) { gapError = e.message.split(':')[0]; }\n"
                "const tampered = structuredClone(exported.packlet); const sig = Buffer.from(tampered.signatureBase64,'base64'); sig[0] ^= 1; tampered.signatureBase64 = sig.toString('base64');\n"
                "let signatureError = ''; try { await adapter.importVerifiedBundle(tampered,pub); } catch (e) { signatureError = e.message.split(':')[0]; }\n"
                "const staleAt = new Date(Date.now() - 25 * 60 * 60 * 1000);\n"
                "const stale = await adapter.exportSignedDeliverable({id:'stale',mods,privateKeyPem:priv,now:staleAt});\n"
                "let staleError = ''; try { await adapter.importVerifiedBundle(stale.packlet,pub); } catch (e) { staleError = e.message.split(':')[0]; }\n"
                "return {empty,oversizedError,gapError,signatureError,staleError};"
            )
            self.assertEqual(result["empty"], "ERR_SYNC_DATA_EMPTY")
            self.assertEqual(result["oversizedError"], "ERR_SYNC_CHUNK_SIZE_TOO_LARGE")
            self.assertEqual(result["gapError"], "ERR_SYNC_CHUNK_INVALID")
            self.assertEqual(result["signatureError"], "ERR_SYNC_SIGNATURE_INVALID")
            self.assertEqual(result["staleError"], "ERR_PORTAL_SYNC_BUNDLE_STALE")


if __name__ == "__main__":
    unittest.main()
