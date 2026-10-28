#!/data/data/com.termux/files/usr/bin/bash
# Negative probes for the Pi daemon guards. Every probe must exit non-zero.
# Run inside Termux on the phone: bash tests/a2a_guard_probe.sh
set -uo pipefail

DAEMON="$HOME/bin/pi_a2a_daemon.sh"
SETTINGS_FILE="$HOME/.pi/agent/settings.json"
PROBE_DIR="$HOME/.pi/agent/guard_probe"
PROVIDER_KEY_FILE="$HOME/.pi/agent/.provider_key"
PROVIDER_NAME_FILE="$HOME/.pi/agent/.provider_name"
PROVIDER_MODEL_FILE="$HOME/.pi/agent/.provider_model"

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

save_env() {
  SAVED_PROVIDER_ENV="${PI_PROVIDER_ENV:-}"
  SAVED_KEY_FILE="$PROBE_DIR/provider_key.backup"
  SAVED_NAME_FILE="$PROBE_DIR/provider_name.backup"
  SAVED_MODEL_FILE="$PROBE_DIR/provider_model.backup"
  for pair in \
    "$PROVIDER_KEY_FILE:$SAVED_KEY_FILE" \
    "$PROVIDER_NAME_FILE:$SAVED_NAME_FILE" \
    "$PROVIDER_MODEL_FILE:$SAVED_MODEL_FILE"; do
    src="${pair%%:*}"
    dst="${pair#*:}"
    if [ -f "$src" ]; then
      cp "$src" "$dst"
    else
      rm -f "$dst"
    fi
  done
}

restore_env() {
  for pair in \
    "$SAVED_KEY_FILE:$PROVIDER_KEY_FILE" \
    "$SAVED_NAME_FILE:$PROVIDER_NAME_FILE" \
    "$SAVED_MODEL_FILE:$PROVIDER_MODEL_FILE"; do
    src="${pair%%:*}"
    dst="${pair#*:}"
    if [ -f "$src" ]; then
      cp "$src" "$dst"
    else
      rm -f "$dst"
    fi
  done
  if [ -n "$SAVED_PROVIDER_ENV" ]; then
    export PI_PROVIDER_ENV="$SAVED_PROVIDER_ENV"
  else
    unset PI_PROVIDER_ENV
  fi
}

save_env
trap 'restore; restore_env' EXIT

# 4. No provider key must be refused with exit 2, never a bare pi start.
rm -f "$PROVIDER_KEY_FILE" "$PROVIDER_NAME_FILE" "$PROVIDER_MODEL_FILE"
unset PI_PROVIDER_ENV
A2A_DAEMON_MODE=foreground "$DAEMON" >/dev/null 2>&1
report 'missing_provider_refused' 2 "$?"

# 5. A provider outside the approved pair must be refused with exit 2.
printf 'sk-any-value' > "$PROVIDER_KEY_FILE"
printf 'openai' > "$PROVIDER_NAME_FILE"
chmod 600 "$PROVIDER_KEY_FILE" "$PROVIDER_NAME_FILE"
A2A_DAEMON_MODE=foreground "$DAEMON" >/dev/null 2>&1
report 'unapproved_provider_refused' 2 "$?"

# 6. A model outside the approved pair must be refused with exit 2.
printf 'sk-any-value' > "$PROVIDER_KEY_FILE"
printf 'deepseek' > "$PROVIDER_NAME_FILE"
printf 'glm-5.2' > "$PROVIDER_MODEL_FILE"
chmod 600 "$PROVIDER_KEY_FILE" "$PROVIDER_NAME_FILE" "$PROVIDER_MODEL_FILE"
A2A_DAEMON_MODE=foreground "$DAEMON" >/dev/null 2>&1
report 'unapproved_model_refused' 2 "$?"

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
