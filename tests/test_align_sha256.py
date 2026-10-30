#!/usr/bin/env python3
"""Tests for ops/align-sha256.mjs."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "ops" / "align-sha256.mjs"


def run_align(source: Path, bin_dir: Path, *args: str) -> tuple[int, dict]:
    result = subprocess.run(
        ["node", str(SCRIPT), "--source", str(source), "--bin", str(bin_dir), *args],
        cwd=REPO,
        capture_output=True,
        text=True,
        timeout=30,
    )
    return result.returncode, json.loads(result.stdout)


class AlignSha256TestCase(unittest.TestCase):
    def test_identical_trees_pass(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "src"
            target = root / "bin"
            for base in (source, target):
                (base / "line1").mkdir(parents=True)
                (base / "line1" / "step.sh").write_text("#!/bin/bash\necho ok\n", encoding="utf-8")
                (base / "line1" / "README.md").write_text("ignored\n", encoding="utf-8")
            code, payload = run_align(source, target)
            self.assertEqual(code, 0)
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["compared"], 1)

    def test_mismatch_and_missing_fail(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "src"
            target = root / "bin"
            for base in (source, target):
                (base / "line1").mkdir(parents=True)
            (source / "line1" / "step.sh").write_text("a\n", encoding="utf-8")
            (target / "line1" / "step.sh").write_text("b\n", encoding="utf-8")
            code, payload = run_align(source, target)
            self.assertEqual(code, 1)
            self.assertEqual(payload["mismatched"][0]["file"], "line1/step.sh")

            (target / "line1" / "step.sh").unlink()
            code, payload = run_align(source, target)
            self.assertEqual(code, 1)
            self.assertEqual(payload["missing"], ["line1/step.sh"])

    def test_extra_files_fail_only_in_strict_mode(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "src"
            target = root / "bin"
            source.mkdir()
            target.mkdir()
            (source / "a.sh").write_text("a\n", encoding="utf-8")
            (target / "a.sh").write_text("a\n", encoding="utf-8")
            (target / "extra.sh").write_text("extra\n", encoding="utf-8")
            code, payload = run_align(source, target)
            self.assertEqual(code, 0)
            self.assertEqual(payload["extra"], ["extra.sh"])
            code, payload = run_align(source, target, "--strict")
            self.assertEqual(code, 1)
            self.assertFalse(payload["ok"])

    def test_missing_arguments_return_code_2(self) -> None:
        result = subprocess.run(
            ["node", str(SCRIPT)],
            cwd=REPO,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("ERR_ALIGN_MISSING_ARGS", result.stderr)


if __name__ == "__main__":
    unittest.main()
