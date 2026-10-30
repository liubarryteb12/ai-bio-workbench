#!/usr/bin/env python3
"""Model switch persistence tests for the Pi telemetry sidecar."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SIDECAR = REPO / "ops" / "pi_telemetry_sidecar.py"


def load_sidecar():
    spec = importlib.util.spec_from_file_location("pi_telemetry_sidecar", SIDECAR)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class PiTelemetrySidecarTestCase(unittest.TestCase):
    def test_model_switch_atomically_updates_settings_and_pins(self) -> None:
        module = load_sidecar()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            settings = root / "settings.json"
            provider_pin = root / ".provider_name"
            model_pin = root / ".provider_model"
            settings.write_text(
                json.dumps(
                    {
                        "a2a": {"server": {"peerTokens": {"codex": "x" * 48}}},
                        "defaultProvider": "deepseek",
                        "defaultModel": "deepseek-v4.1-flash",
                        "thinkingLevel": None,
                    }
                ),
                encoding="utf-8",
            )
            module.SETTINGS_PATH = str(settings)
            module.PROVIDER_NAME_FILE = str(provider_pin)
            module.PROVIDER_MODEL_FILE = str(model_pin)

            module.persist_model_switch("zai", "glm-5.3-flash")

            config = json.loads(settings.read_text(encoding="utf-8"))
            self.assertEqual(config["defaultProvider"], "zai")
            self.assertEqual(config["defaultModel"], "glm-5.3-flash")
            self.assertEqual(config["thinkingLevel"], "high")
            self.assertEqual(config["temperature"], 0.2)
            self.assertEqual(config["a2a"]["server"]["peerTokens"]["codex"], "x" * 48)
            self.assertEqual(provider_pin.read_text(encoding="utf-8").strip(), "zai")
            self.assertEqual(model_pin.read_text(encoding="utf-8").strip(), "glm-5.3-flash")
            self.assertFalse((root / "settings.json.tmp").exists())
            self.assertFalse((root / ".provider_name.tmp").exists())
            self.assertFalse((root / ".provider_model.tmp").exists())


if __name__ == "__main__":
    unittest.main()
