#!/usr/bin/env python3
"""Static contract checks for secret-safe Pi A2A launch."""

from __future__ import annotations

import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DAEMON = REPO / "ops" / "pi_a2a_daemon.sh"
LAUNCHER = REPO / "ops" / "pi_a2a_launch.sh"
CODEX_LAUNCHER = REPO / "ops" / "codex_a2a_launcher.sh"


class PiA2ALauncherContractTestCase(unittest.TestCase):
    def test_codex_launcher_builds_static_auth_and_keeps_loopback_probes(self) -> None:
        text = CODEX_LAUNCHER.read_text(encoding="utf-8")
        self.assertIn(
            'A2A_STATIC_AUTH_CREDENTIALS="$(python3 - <<\'PY\'',
            text,
        )
        self.assertIn("A2A_CLIENT_BEARER_TOKEN", text)
        self.assertNotIn("A2A_BEARER_TOKEN", text)
        self.assertIn('[ "$A2A_HOST" != "127.0.0.1" ]', text)
        self.assertIn('*100.64.0.0/10*', text)
        self.assertIn('"$PI_A2A_ENDPOINT/.well-known/agent-card.json"', text)
        self.assertIn("exec codex-a2a serve", text)

    def test_codex_launcher_does_not_echo_static_auth(self) -> None:
        text = CODEX_LAUNCHER.read_text(encoding="utf-8")
        self.assertIn("export A2A_STATIC_AUTH_CREDENTIALS", text)
        self.assertNotIn("A2A_SESSION_TOKEN_PREFIX", text)
        for line in text.splitlines():
            if "$A2A_STATIC_AUTH_CREDENTIALS" in line:
                self.assertFalse(
                    line.lstrip().startswith(("echo", "printf")),
                    f"launcher prints static credentials: {line}",
                )

    def test_daemon_does_not_put_provider_key_on_tmux_command_line(self) -> None:
        text = DAEMON.read_text(encoding="utf-8")
        self.assertNotIn('-e "A2A_PROVIDER_KEY=', text)
        self.assertIn("pi_a2a_launch.sh", text)
        self.assertIn("exec bash '$PROVIDER_LAUNCHER'", text)

    def test_launcher_reads_key_from_private_file_and_restricts_models(self) -> None:
        text = LAUNCHER.read_text(encoding="utf-8")
        self.assertIn('KEY_FILE="$AGENT_DIR/.provider_keys/$PROVIDER"', text)
        self.assertIn('KEY_FILE="$AGENT_DIR/.provider_key"', text)
        self.assertIn('A2A_PROVIDER_KEY="$(cat "$KEY_FILE")"', text)
        self.assertIn("glm-5.3-flash|deepseek-v4.1-flash", text)
        self.assertIn("exec pi --model", text)

    def test_daemon_writes_injected_keys_to_provider_directory_and_syncs_pins(self) -> None:
        text = DAEMON.read_text(encoding="utf-8")
        self.assertIn('PROVIDER_KEY_PATH="$PROVIDER_KEYS_DIR/$PROVIDER_NAME"', text)
        self.assertIn('printf \'%s\' "$PROVIDER_VALUE" > "$PROVIDER_KEY_PATH"', text)
        self.assertIn('printf \'%s\\n\' "$PROVIDER_NAME" > "$PROVIDER_NAME_FILE"', text)
        self.assertIn('printf \'%s\\n\' "$PROVIDER_MODEL" > "$PROVIDER_MODEL_FILE"', text)
        self.assertIn('if [ "$PROVIDER_NAME" = "zai" ]; then', text)

    def test_provider_key_upload_uses_stdin(self) -> None:
        text = (REPO / "ops" / "pi_set_provider_key.ps1").read_text(encoding="utf-8")
        self.assertIn("RedirectStandardInput = $true", text)
        self.assertIn("cat >", text)
        self.assertNotIn("$escaped", text)
        self.assertNotIn("printf '%s' '$", text)


if __name__ == "__main__":
    unittest.main()
