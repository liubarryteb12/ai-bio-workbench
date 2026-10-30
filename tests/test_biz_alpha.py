#!/usr/bin/env python3
"""mod-biz-alpha integer cents, conservation and allocation tests."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
BUILD = HERE / ".biz_alpha_build"


def run_node(script: str) -> dict:
    wrapper = (
        "import { BizAlphaAdapter } from './src/mods/mod-biz-alpha/implementation.mjs';\n"
        "import { manifest } from './src/mods/mod-biz-alpha/manifest.mjs';\n"
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


class BizAlphaTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        result = subprocess.run(
            ["node", str(HERE / "biz_alpha_compile.cjs")],
            cwd=REPO,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            raise AssertionError(result.stdout + result.stderr)

    def test_10000_cents_and_one_cent_largest_remainder(self) -> None:
        result = run_node(
            "const e=(id,d,c)=>({entryId:id,logicalDate:'2026-10-29',categoryCode:'food',memoText:'m',debitCents:d,creditCents:c});\n"
            "const buckets=[{bucketId:'a',weightBps:3333},{bucketId:'b',weightBps:3333},{bucketId:'c',weightBps:3334}];\n"
            "const big=await new BizAlphaAdapter().reconcileAndAllocate('b1','2026-10-29',[e('d',10000,0),e('c',0,10000)],buckets);\n"
            "const one=await new BizAlphaAdapter().reconcileAndAllocate('b2','2026-10-29',[e('d',1,0),e('c',0,1)],buckets);\n"
            "return {big:big.report.allocations,one:one.report.allocations};"
        )
        self.assertEqual(sum(result["big"].values()), 10000)
        self.assertEqual(result["big"], {"a": 3333, "b": 3333, "c": 3334})
        self.assertEqual(sum(result["one"].values()), 1)
        self.assertEqual(result["one"], {"a": 0, "b": 0, "c": 1})

    def test_float_negative_and_unsafe_integer_rejected(self) -> None:
        result = run_node(
            "const e=(d)=>({entryId:'e',logicalDate:'2026-10-29',categoryCode:'x',memoText:'m',debitCents:d,creditCents:0});\n"
            "const buckets=[{bucketId:'a',weightBps:10000}];\n"
            "const run=(d)=>new BizAlphaAdapter().reconcileAndAllocate('b','2026-10-29',[e(d)],buckets).then((r)=>r.exitCode);\n"
            "return {float:await run(12.34),negative:await run(-1),unsafe:await run(Number.MAX_SAFE_INTEGER+1)};"
        )
        self.assertEqual(result, {"float": 2, "negative": 2, "unsafe": 2})

    def test_imbalance_and_bad_weight_sum_rejected(self) -> None:
        result = run_node(
            "const e=(id,d,c)=>({entryId:id,logicalDate:'2026-10-29',categoryCode:'x',memoText:'m',debitCents:d,creditCents:c});\n"
            "const imbalance=await new BizAlphaAdapter().reconcileAndAllocate('b','2026-10-29',[e('d',100,0),e('c',0,99)],[{bucketId:'a',weightBps:10000}]);\n"
            "const weights=await new BizAlphaAdapter().reconcileAndAllocate('b','2026-10-29',[e('d',100,0),e('c',0,100)],[{bucketId:'a',weightBps:9999}]);\n"
            "return {imbalance:imbalance.exitCode,weights:weights.exitCode};"
        )
        self.assertEqual(result["imbalance"], 1)
        self.assertEqual(result["weights"], 2)

    def test_max_safe_integer_boundary(self) -> None:
        result = run_node(
            "const e=(id,d,c)=>({entryId:id,logicalDate:'2026-10-29',categoryCode:'x',memoText:'m',debitCents:d,creditCents:c});\n"
            "const max=Number.MAX_SAFE_INTEGER;\n"
            "const r=await new BizAlphaAdapter().reconcileAndAllocate('max','2026-10-29',[e('d',max,0),e('c',0,max)],[{bucketId:'a',weightBps:10000}]);\n"
            "return {exit:r.exitCode,total:r.report.totalVolumeCents,allocation:r.report.allocations.a};"
        )
        self.assertEqual(result["exit"], 0)
        self.assertEqual(result["total"], 9007199254740991)
        self.assertEqual(result["allocation"], 9007199254740991)

    def test_report_write_and_summary_capability(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = run_node(
                "const e=(id,d,c)=>({entryId:id,logicalDate:'2026-10-29',categoryCode:'food',memoText:'m',debitCents:d,creditCents:c});\n"
                f"const adapter=new BizAlphaAdapter({json.dumps(tmp)});\n"
                "const r=await adapter.reconcileAndAllocate('daily1','2026-10-29',[e('d',1200,0),e('c',0,1200)],[{bucketId:'food',weightBps:10000}]);\n"
                "const summary=adapter.getConsumptionSummary('daily1');\n"
                "return {exit:r.exitCode,total:summary.totalVolumeCents,slots:manifest.slots.map((s)=>s.slotId),"
                "cap:manifest.capabilitiesProvided.map((item)=>item.capabilityId)};"
            )
            self.assertEqual(result["exit"], 0)
            self.assertEqual(result["total"], 1200)
            self.assertEqual(result["slots"], ["workspace.main", "inspector.panel"])
            self.assertIn("bizAlpha.getConsumptionSummary", result["cap"])
            report = Path(tmp) / "alpha-reports" / "reconciled-daily1.json"
            self.assertTrue(report.exists())
            payload = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(payload["totalVolumeCents"], 1200)


if __name__ == "__main__":
    unittest.main()
