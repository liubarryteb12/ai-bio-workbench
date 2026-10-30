#!/usr/bin/env python3
"""mod-biz-beta seed, matrix integrity and deterministic 17g output tests."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
BUILD = HERE / ".biz_beta_build"
SEEDS = [20261013, 20261014, 20261015]


def run_node(script: str) -> dict:
    wrapper = (
        "import { BizBetaAdapter } from './src/mods/mod-biz-beta/implementation.mjs';\n"
        "import { manifest } from './src/mods/mod-biz-beta/manifest.mjs';\n"
        "const out = await (async () => {\n"
        + script
        + "\n})();\nconsole.log(JSON.stringify(out));"
    )
    result = subprocess.run(
        ["node", "--input-type=module", "-e", wrapper],
        cwd=BUILD,
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode != 0:
        raise AssertionError(result.stdout + result.stderr)
    return json.loads(result.stdout)


def write_matrix(path: Path, genes: int = 40, samples: int = 12, nan: bool = False) -> None:
    header = ["gene"] + [f"S{i + 1}" for i in range(samples)]
    lines = ["\t".join(header)]
    for gene_index in range(genes):
        if gene_index < 5:
            control = [1.0 + gene_index * 0.1 + i * 0.01 for i in range(samples // 2)]
            disease = [10.0 + gene_index * 0.2 + i * 0.01 for i in range(samples - samples // 2)]
        else:
            control = [1.0 + ((gene_index * 7 + i * 3) % 5) * 0.1 for i in range(samples // 2)]
            disease = [1.0 + ((gene_index * 11 + i * 5) % 7) * 0.1 for i in range(samples - samples // 2)]
        values = control + disease
        if nan and gene_index == 0:
            values[0] = float("nan")
        lines.append("\t".join([f"G{gene_index + 1}"] + [repr(value) for value in values]))
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


class BizBetaTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        result = subprocess.run(
            ["node", str(HERE / "biz_beta_compile.cjs")],
            cwd=REPO,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            raise AssertionError(result.stdout + result.stderr)

    def test_deterministic_three_seed_intersection(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_matrix(root / "matrix.tsv")
            result = run_node(
                f"const adapter = new BizBetaAdapter({json.dumps(str(root))});\n"
                f"const spec = {{jobId:'job1',scope:'GEO_STANDARD',inputMatrixRelPath:'matrix.tsv',expectedSamples:12,expectedGenes:40,seeds:{json.dumps(SEEDS)}}};\n"
                "const a = await adapter.executeTranscriptomicsPipeline(spec);\n"
                "const b = await adapter.executeTranscriptomicsPipeline(spec);\n"
                "const digest = adapter.getAnalysisDigest('job1');\n"
                "return {a,b,digest,slots:manifest.slots.map((s)=>s.slotId),"
                "cap:manifest.capabilitiesProvided.map((item)=>item.capabilityId)};"
            )
            self.assertEqual(result["a"]["exitCode"], 0)
            self.assertEqual(result["b"]["exitCode"], 0)
            self.assertEqual(result["a"]["digest"]["outputSha256"], result["b"]["digest"]["outputSha256"])
            self.assertGreaterEqual(len(result["a"]["digest"]["robustBiomarkerSymbols"]), 5)
            self.assertTrue(set(f"G{i}" for i in range(1, 6)).issubset(result["a"]["digest"]["robustBiomarkerSymbols"]))
            self.assertIn("G1.mean_diff", result["a"]["digest"]["formattedMetrics17g"])
            self.assertEqual(len(result["a"]["digest"]["outputSha256"]), 64)
            self.assertIn("sidebar.nav", result["slots"])
            self.assertIn("bizBeta.getAnalysisDigest", result["cap"])
            out = root / result["a"]["digest"]["outputTsvRelPath"]
            self.assertTrue(out.exists())
            self.assertIn("mean_diff_17g", out.read_text(encoding="utf-8").splitlines()[0])

    def test_seed_contract_missing_and_dimension_failures(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_matrix(root / "matrix.tsv")
            result = run_node(
                f"const adapter = new BizBetaAdapter({json.dumps(str(root))});\n"
                "const base = {jobId:'j',scope:'GEO_STANDARD',inputMatrixRelPath:'matrix.tsv',expectedSamples:12,expectedGenes:40};\n"
                "const missing = await adapter.executeTranscriptomicsPipeline(base);\n"
                "const empty = await adapter.executeTranscriptomicsPipeline({...base,seeds:[]});\n"
                "const dims = await adapter.executeTranscriptomicsPipeline({...base,seeds:" + json.dumps(SEEDS) + ",expectedGenes:41});\n"
                "const traversal = await adapter.executeTranscriptomicsPipeline({...base,seeds:" + json.dumps(SEEDS) + ",inputMatrixRelPath:'../matrix.tsv'});\n"
                "return {missing,empty,dims,traversal};"
            )
            self.assertEqual(result["missing"]["exitCode"], 3)
            self.assertEqual(result["empty"]["exitCode"], 3)
            self.assertEqual(result["dims"]["exitCode"], 1, result["dims"])
            self.assertEqual(result["traversal"]["exitCode"], 2)

    def test_nan_matrix_is_rejected_without_output(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_matrix(root / "matrix.tsv", nan=True)
            result = run_node(
                f"const adapter = new BizBetaAdapter({json.dumps(str(root))});\n"
                "return adapter.executeTranscriptomicsPipeline({jobId:'nan',scope:'GEO_STANDARD',inputMatrixRelPath:'matrix.tsv',expectedSamples:12,expectedGenes:40,seeds:" + json.dumps(SEEDS) + "});"
            )
            self.assertEqual(result["exitCode"], 1, result)
            self.assertEqual(result["error"], "ERR_BETA_MATRIX_NON_FINITE")
            self.assertFalse((root / "beta-outputs" / "robust-biomarkers-nan.tsv").exists())


if __name__ == "__main__":
    unittest.main()
