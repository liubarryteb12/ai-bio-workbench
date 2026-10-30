#!/usr/bin/env python3
"""Ed25519 signed packlet sync engine tests."""

from __future__ import annotations

import json
import hashlib
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
BUILD = HERE / ".sync_build"


def run_node(script: str) -> dict:
    wrapper = (
        "import * as crypto from 'node:crypto';\n"
        "import { SyncEngineImpl } from './src/engines/sync-engine/implementation.mjs';\n"
        "import { MemoryPackletStore, FilePackletStore } from './src/engines/sync-engine/adapters.mjs';\n"
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


class SyncEngineTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        result = subprocess.run(
            ["node", str(HERE / "sync_engine_compile.cjs")],
            cwd=REPO,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            raise AssertionError(result.stdout + result.stderr)

    def test_roundtrip_and_chunking(self) -> None:
        result = run_node(
            "const keys = crypto.generateKeyPairSync('ed25519');\n"
            "const priv = keys.privateKey.export({type:'pkcs8',format:'pem'});\n"
            "const pub = keys.publicKey.export({type:'spki',format:'pem'});\n"
            "const data = Buffer.alloc(1024 * 1024 + 10, 7);\n"
            "const engine = new SyncEngineImpl({chunkSize:512 * 1024});\n"
            "const pack = await engine.packSigned(data, priv);\n"
            "const out = await engine.unpackVerified(pack, pub);\n"
            "return {chunks:pack.chunks.length,total:pack.totalBytes,equal:out.equals(data),root:pack.rootSha256};"
        )
        self.assertEqual(result["chunks"], 3)
        self.assertEqual(result["total"], 1024 * 1024 + 10)
        self.assertTrue(result["equal"])
        self.assertEqual(len(result["root"]), 64)

    def test_root_sha256_is_hash_of_chunk_digests(self) -> None:
        result = run_node(
            "const keys = crypto.generateKeyPairSync('ed25519');\n"
            "const priv = keys.privateKey.export({type:'pkcs8',format:'pem'});\n"
            "const engine = new SyncEngineImpl({chunkSize:4});\n"
            "const pack = await engine.packSigned(Buffer.from('abcdefghij'), priv);\n"
            "return {root:pack.rootSha256,chunkHashes:pack.chunks.map((chunk)=>chunk.sha256)};"
        )
        chunk_hashes = [bytes.fromhex(value) for value in result["chunkHashes"]]
        expected_root = hashlib.sha256(b"".join(chunk_hashes)).hexdigest()
        self.assertEqual(result["root"], expected_root)

    def test_tamper_and_wrong_key_fail_closed(self) -> None:
        result = run_node(
            "const keys = crypto.generateKeyPairSync('ed25519');\n"
            "const priv = keys.privateKey.export({type:'pkcs8',format:'pem'});\n"
            "const pub = keys.publicKey.export({type:'spki',format:'pem'});\n"
            "const other = crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'});\n"
            "const engine = new SyncEngineImpl({chunkSize:8});\n"
            "const pack = await engine.packSigned(Buffer.from('abcdefghijklmnop'), priv);\n"
            "const badChunk = structuredClone(pack); badChunk.chunks[0].dataBase64 = Buffer.from('XXXX').toString('base64');\n"
            "let chunkError = ''; try { await engine.unpackVerified(badChunk, pub); } catch (e) { chunkError = e.message.split(':')[0]; }\n"
            "const badManifest = structuredClone(pack); badManifest.chunks[0].sha256 = 'a'.repeat(64);\n"
            "let manifestError = ''; try { await engine.unpackVerified(badManifest, pub); } catch (e) { manifestError = e.message.split(':')[0]; }\n"
            "let keyError = ''; try { await engine.unpackVerified(pack, other); } catch (e) { keyError = e.message.split(':')[0]; }\n"
            "return {chunkError,manifestError,keyError};"
        )
        self.assertEqual(result["chunkError"], "ERR_SYNC_CHUNK_HASH_MISMATCH")
        self.assertEqual(result["manifestError"], "ERR_SYNC_SIGNATURE_INVALID")
        self.assertEqual(result["keyError"], "ERR_SYNC_SIGNATURE_INVALID")

    def test_memory_and_file_packlet_stores(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = run_node(
                "const keys = crypto.generateKeyPairSync('ed25519');\n"
                "const priv = keys.privateKey.export({type:'pkcs8',format:'pem'});\n"
                "const pub = keys.publicKey.export({type:'spki',format:'pem'});\n"
                "const engine = new SyncEngineImpl({chunkSize:4});\n"
                "const pack = await engine.packSigned(Buffer.from('store-roundtrip'), priv);\n"
                f"const memory = new MemoryPackletStore(); await memory.write('p1', pack); const p1 = await memory.read('p1');\n"
                f"const file = new FilePackletStore({json.dumps(tmp)}); await file.write('p2', pack); const p2 = await file.read('p2');\n"
                "const a = await engine.unpackVerified(p1,pub); const b = await engine.unpackVerified(p2,pub);\n"
                "return {memory:a.toString(),file:b.toString()};"
            )
            self.assertEqual(result["memory"], "store-roundtrip")
            self.assertEqual(result["file"], "store-roundtrip")


if __name__ == "__main__":
    unittest.main()
