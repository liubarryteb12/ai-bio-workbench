#!/usr/bin/env python3
"""Tests for the reproducible Pi A2A outbound-redaction patch."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "ops" / "patch_pi_a2a_security.sh"
OLD_PATTERN = '[/sk-[A-Za-z0-9_-]{16,}/g, "sk-[redacted]"]'
NEW_PATTERN = '[/(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}/g, "sk-[redacted]"]'


@unittest.skipUnless(shutil.which("bash"), "bash is required")
class PiA2ASecurityPatchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.package_dir = Path(self.temp_dir.name) / "extensions" / "lib"
        self.package_dir.mkdir(parents=True)
        self.security_file = self.package_dir / "security.ts"
        self.security_file.write_text(
            "const REDACTION_PATTERNS = [\n"
            "  {0},\n"
            "];\n".format(OLD_PATTERN),
            encoding="utf-8",
        )

    def _run(self, mode: str) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env["PI_A2A_PACKAGE_DIR"] = str(self.package_dir)
        return subprocess.run(
            ["bash", str(SCRIPT), mode],
            check=False,
            capture_output=True,
            text=True,
            env=env,
            timeout=15,
        )

    def test_apply_is_atomic_and_idempotent(self) -> None:
        first = self._run("--apply")
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertIn("PI_A2A_SECURITY_PATCH=applied", first.stdout)
        text = self.security_file.read_text(encoding="utf-8")
        self.assertIn(NEW_PATTERN, text)
        self.assertNotIn(OLD_PATTERN, text)

        second = self._run("--apply")
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertIn("already_applied", second.stdout)
        self.assertEqual(
            self.security_file.read_text(encoding="utf-8"),
            text,
        )

    def test_check_rejects_pending_or_unknown_patch(self) -> None:
        pending = self._run("--check")
        self.assertEqual(pending.returncode, 1)
        self.assertIn("PI_A2A_SECURITY_PATCH=pending", pending.stdout)

        self.security_file.write_text("export const value = 1;\n", encoding="utf-8")
        unknown = self._run("--check")
        self.assertEqual(unknown.returncode, 2)
        self.assertIn("ERR_SECURITY_PATTERN_UNKNOWN", unknown.stderr)


if __name__ == "__main__":
    unittest.main()
