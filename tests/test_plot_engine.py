#!/usr/bin/env python3
"""Plot engine DPI, geometry, variance and real Pillow adapter tests."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
BUILD = HERE / ".plot_build"


def run_node(script: str) -> dict:
    wrapper = (
        "import { PlotEngineImpl } from './src/engines/plot-engine/implementation.mjs';\n"
        "import { MockPlotAdapter, BlankPlotAdapter, PillowPlotAdapter } from './src/engines/plot-engine/adapters.mjs';\n"
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


class PlotEngineTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        result = subprocess.run(
            ["node", str(HERE / "plot_engine_compile.cjs")],
            cwd=REPO,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            raise AssertionError(result.stdout + result.stderr)

    def test_mock_adapter_success(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "mock.png"
            result = run_node(
                "const engine = new PlotEngineImpl(new MockPlotAdapter(1));\n"
                f"return engine.renderMatrix({{outputPath:{json.dumps(str(out))},title:'Mock',dpi:300,significanceLines:[{{y1:1,y2:1}}]}});"
            )
            self.assertEqual(result["dpi"], 300)
            self.assertTrue(out.exists())
            self.assertEqual(len(result["sha256"]), 64)

    def test_invalid_dpi_and_non_horizontal_line(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "bad.png"
            result = run_node(
                "const engine = new PlotEngineImpl(new MockPlotAdapter(1));\n"
                "const badDpi = await engine.renderMatrix({outputPath:" + json.dumps(str(out)) + ",title:'Bad',dpi:72,significanceLines:[]})\n"
                "  .then(() => 'ALLOWED').catch((e) => e.message.split(':')[0]);\n"
                "const badLine = await engine.renderMatrix({outputPath:" + json.dumps(str(out)) + ",title:'Bad',dpi:300,significanceLines:[{y1:1,y2:2}]})\n"
                "  .then(() => 'ALLOWED').catch((e) => e.message.split(':')[0]);\n"
                "return {badDpi,badLine};"
            )
            self.assertEqual(result["badDpi"], "ERR_PLOT_DPI_NOT_300")
            self.assertEqual(result["badLine"], "ERR_PLOT_SIGNIFICANCE_NOT_HORIZONTAL")

    def test_blank_output_is_deleted(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "blank.png"
            result = run_node(
                "const engine = new PlotEngineImpl(new BlankPlotAdapter());\n"
                f"return engine.renderMatrix({{outputPath:{json.dumps(str(out))},title:'Blank',dpi:300,significanceLines:[{{y1:2,y2:2}}]}})\n"
                "  .then(() => ({error:'ALLOWED'})).catch((e) => ({error:e.message.split(':')[0], exists: " + json.dumps(str(out)) + " ? null : null}));"
            )
            self.assertEqual(result["error"], "ERR_PLOT_VARIANCE_ZERO")
            self.assertFalse(out.exists())

    def test_real_pillow_adapter_renders_nonblank_png(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "real.png"
            result = run_node(
                "const engine = new PlotEngineImpl(new PillowPlotAdapter());\n"
                f"return engine.renderMatrix({{outputPath:{json.dumps(str(out))},title:'Real Plot',dpi:300,values:[1,2,3,4],significanceLines:[{{y1:40,y2:40}}]}});"
            )
            self.assertEqual(result["dpi"], 300)
            self.assertEqual(result["width"], 320)
            self.assertEqual(result["height"], 240)
            self.assertGreater(result["pixelVariance"], 0)
            self.assertTrue(out.exists())


if __name__ == "__main__":
    unittest.main()
