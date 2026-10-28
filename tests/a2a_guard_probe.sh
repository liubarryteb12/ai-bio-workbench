#!/data/data/com.termux/files/usr/bin/bash
# Negative probes for the Pi daemon guards. Every probe must exit non-zero.
# Run inside Termux on the phone: bash tests/a2a_guard_probe.sh
set -uo pipefail

DAEMON="$HOME/bin/pi_a2a_daemon.sh"
SETTINGS_FILE="$HOME/.pi/agent/settings.json"
PROBE_DIR="$HOME/.pi/agent/guard_probe"

failures=0

report() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    printf 'PASS %s exit=%s\n' "$label" "$actual"
  else
    printf 'FAIL %s exit=%s expected=%s\n' "$label" "$actual" "$expected"
    failures=$((failures + 1))
  fi
}

if [ ! -x "$DAEMON" ]; then
  printf 'FATAL daemon missing or not executable: %s\n' "$DAEMON" >&2
  exit 1
fi

mkdir -p "$PROBE_DIR"
cp "$SETTINGS_FILE" "$PROBE_DIR/settings.backup.json"

restore() {
  cp "$PROBE_DIR/settings.backup.json" "$SETTINGS_FILE"
}
trap restore EXIT

# 1. allowAllUsers true must be refused with exit 2.
jq '.a2a.server.allowAllUsers = true' "$PROBE_DIR/settings.backup.json" > "$SETTINGS_FILE"
A2A_DAEMON_MODE=foreground "$DAEMON" >/dev/null 2>&1
report 'allow_all_users_refused' 2 "$?"

# 2. host 0.0.0.0 with a short token must be refused with exit 2.
jq '.a2a.server.host = "0.0.0.0" | .a2a.server.peerTokens.codex = "short"' \
  "$PROBE_DIR/settings.backup.json" > "$SETTINGS_FILE"
A2A_DAEMON_MODE=foreground "$DAEMON" >/dev/null 2>&1
report 'weak_token_bind_refused' 2 "$?"

# 3. server disabled must be refused with exit 1.
jq '.a2a.server.enabled = false' "$PROBE_DIR/settings.backup.json" > "$SETTINGS_FILE"
A2A_DAEMON_MODE=foreground "$DAEMON" >/dev/null 2>&1
report 'disabled_server_refused' 1 "$?"

restore

if [ "$failures" -gt 0 ]; then
  printf 'A2A_GUARD_PROBE_FAIL failures=%s\n' "$failures"
  exit 1
fi
printf 'A2A_GUARD_PROBE_OK\n'
