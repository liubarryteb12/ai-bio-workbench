#!/usr/bin/env python3
"""Template studio master/adapt/render vertical slice tests."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
BUILD = HERE / ".template_studio_build"
MASTER = REPO / "src" / "mods" / "mod-template-studio" / "templates" / "bar_template.py"


def run_node(script: str) -> dict:
    wrapper = (
        "import { TemplateStudioAdapter } from './src/mods/mod-template-studio/implementation.mjs';\n"
        "import { ComputeEngineImpl } from './src/engines/compute-engine/implementation.mjs';\n"
        "import { ChildProcessComputeAdapter } from './src/engines/compute-engine/adapters.mjs';\n"
        "import { manifest } from './src/mods/mod-template-studio/manifest.mjs';\n"
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


class TemplateStudioTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        result = subprocess.run(
            ["node", str(HERE / "template_studio_compile.cjs")],
            cwd=REPO,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            raise AssertionError(result.stdout + result.stderr)

    def test_master_adapt_and_real_render(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            masters = root / "templates"
            adapt = root / "adapt"
            masters.mkdir()
            shutil.copy2(MASTER, masters / "bar_template.py")
            master = masters / "bar_template.py"
            before = hashlib.sha256(master.read_bytes()).hexdigest()
            output = root / "out.png"
            result = run_node(
                f"const guard = {{assertWithinProjectRoot: (target) => target}};\n"
                f"const studio = new TemplateStudioAdapter({json.dumps(str(masters))},{json.dumps(str(adapt))}, new ComputeEngineImpl(new ChildProcessComputeAdapter()), {{pathGuard:guard}});\n"
                f"return studio.renderTemplate({{templateId:'bar_template',projectId:'demo',title:'Template Real',values:[1,2,3,4],outputPath:{json.dumps(str(output))},seed:20261013}});"
            )
            self.assertTrue(output.exists())
            self.assertGreater(result["artifact"]["pixelVariance"], 0)
            self.assertEqual(len(result["artifact"]["sha256"]), 64)
            adapted = Path(result["adaptedPath"])
            self.assertTrue(adapted.exists())
            self.assertIn(f"# Master-SHA256: {before}", adapted.read_text(encoding="utf-8").splitlines()[0])
            self.assertEqual(hashlib.sha256(master.read_bytes()).hexdigest(), before)
            self.assertEqual(result["masterSha256"], before)
            self.assertEqual(result["artifact"]["width"], 320)
            self.assertEqual(result["artifact"]["height"], 240)

    def test_invalid_template_id_and_missing_master(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            masters = root / "templates"
            adapt = root / "adapt"
            masters.mkdir()
            output = root / "bad.png"
            result = run_node(
                f"const guard = {{assertWithinProjectRoot: (target) => target}};\n"
                f"const studio = new TemplateStudioAdapter({json.dumps(str(masters))},{json.dumps(str(adapt))}, new ComputeEngineImpl(new ChildProcessComputeAdapter()), {{pathGuard:guard}});\n"
                f"const invalid = await studio.renderTemplate({{templateId:'../bad',projectId:'demo',title:'x',values:[],outputPath:{json.dumps(str(output))},seed:1}}).then(()=> 'ALLOWED').catch((e)=>e.message.split(':')[0]);\n"
                f"const missing = await studio.renderTemplate({{templateId:'nope',projectId:'demo',title:'x',values:[],outputPath:{json.dumps(str(output))},seed:1}}).then(()=> 'ALLOWED').catch((e)=>e.message.split(':')[0]);\n"
                "return {invalid,missing,slots:manifest.slots.map((s)=>s.slotId)};"
            )
            self.assertEqual(result["invalid"], "ERR_TEMPLATE_ID_INVALID")
            self.assertEqual(result["missing"], "ERR_TEMPLATE_MASTER_MISSING")
            self.assertEqual(result["slots"], ["workspace.main", "inspector.panel"])

    def test_project_id_and_output_boundary_are_checked_before_writes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            masters = root / "templates"
            adapt = root / "adapt"
            masters.mkdir()
            shutil.copy2(MASTER, masters / "bar_template.py")
            unsafe_output = root / "outside" / "bad.png"
            safe_output = root / "safe.png"
            result = run_node(
                "const guard = {assertWithinProjectRoot: (target, projectId) => {\n"
                "  if (!projectId) throw new Error('ERR_PATH_GUARD_PROJECT_ID_INVALID');\n"
                "  if (target.includes('outside')) throw new Error('ERR_PATH_GUARD_PROJECT_OUTSIDE_ROOT');\n"
                "  return target;\n"
                "}};\n"
                f"const studio = new TemplateStudioAdapter({json.dumps(str(masters))},{json.dumps(str(adapt))}, new ComputeEngineImpl(new ChildProcessComputeAdapter()), {{pathGuard:guard}});\n"
                f"const missing = await studio.renderTemplate({{templateId:'bar_template',title:'x',values:[1],outputPath:{json.dumps(str(safe_output))},seed:1}}).then(()=> 'ALLOWED').catch((e)=>e.message.split(':')[0]);\n"
                f"const unsafe = await studio.renderTemplate({{templateId:'bar_template',projectId:'demo',title:'x',values:[1],outputPath:{json.dumps(str(unsafe_output))},seed:1}}).then(()=> 'ALLOWED').catch((e)=>e.message.split(':')[0]);\n"
                "return {missing,unsafe};"
            )
            self.assertEqual(result["missing"], "ERR_TEMPLATE_PROJECT_ID_MISSING")
            self.assertEqual(result["unsafe"], "ERR_PATH_GUARD_PROJECT_OUTSIDE_ROOT")
            self.assertFalse(safe_output.exists())
            self.assertFalse(unsafe_output.exists())
            self.assertFalse(adapt.exists())


if __name__ == "__main__":
    unittest.main()
