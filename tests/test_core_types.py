#!/usr/bin/env python3
"""Strict TypeScript gate for the K40 microkernel, engines and mods."""

from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TSC = REPO / "BioanalysDesktop" / "node_modules" / "typescript" / "bin" / "tsc"


class CoreTypeScriptTestCase(unittest.TestCase):
    @unittest.skipUnless(TSC.is_file() and shutil.which("node"), "TypeScript or Node unavailable")
    def test_core_engines_and_mods_pass_strict_typecheck(self) -> None:
        result = subprocess.run(
            ["node", str(TSC), "-p", str(REPO / "tsconfig.core.json")],
            cwd=REPO,
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
