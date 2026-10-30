#!/usr/bin/env python3
"""Contract checks for the mod-pi-observability manifest."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MANIFEST = REPO / "src" / "mods" / "mod-pi-observability" / "manifest.ts"

REQUIRED_ASSETS = [
    "BioanalysDesktop/server/pi_agent.js",
    "BioanalysDesktop/server/pi_agent_routes.js",
    "BioanalysDesktop/tests/pi_agent.test.js",
    "BioanalysDesktop/tests/pi_agent_routes.test.js",
    "BioanalysDesktop/src/App.tsx",
    "ops/pi_telemetry_sidecar.py",
]


class PiObservabilityManifestTestCase(unittest.TestCase):
    def test_manifest_links_executable_verification_and_real_assets(self) -> None:
        text = MANIFEST.read_text(encoding="utf-8")
        self.assertIn("modId: 'mod-pi-observability'", text)
        self.assertIn("state: 'ready'", text)
        self.assertIn("slots: [selfcheckSlot, previewSlot]", text)
        self.assertIn("piObservability.overview", text)
        slot_text = (
            REPO / "src" / "mods" / "mod-pi-observability" / "slots" / "PiObservabilitySlots.ts"
        ).read_text(encoding="utf-8")
        self.assertIn("workbench.selfcheck-cards", slot_text)
        self.assertIn("workbench.studio-preview", slot_text)
        for asset in REQUIRED_ASSETS:
            self.assertTrue((REPO / asset).is_file(), asset)

        match = re.search(r"verificationScripts:\s*\[(.*?)\]", text, re.S)
        self.assertIsNotNone(match)
        verification_block = match.group(1)
        for entry in [
            "BioanalysDesktop/tests/pi_agent.test.js",
            "BioanalysDesktop/tests/pi_agent_routes.test.js",
            "tests/test_mod_pi_observability.py",
            "ops/pi_telemetry_sidecar.py",
        ]:
            self.assertIn(entry, verification_block)
        self.assertNotIn("BioanalysDesktop/server/pi_agent.js", verification_block)
        self.assertNotIn("BioanalysDesktop/src/App.tsx", verification_block)


if __name__ == "__main__":
    unittest.main()
