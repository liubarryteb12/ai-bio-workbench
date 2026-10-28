#!/data/data/com.termux/files/usr/bin/bash
# Seed the production a2a block into ~/.pi/agent/settings.json.
# The real peer token is read from the 0600 runtime file, never from git.
set -euo pipefail

TOKEN_FILE="$HOME/.pi/agent/.peer_token"
SETTINGS_FILE="$HOME/.pi/agent/settings.json"

if [ ! -f "$TOKEN_FILE" ]; then
  printf 'FATAL ERR_TOKEN_FILE_MISSING: %s\n' "$TOKEN_FILE" >&2
  exit 2
fi

chmod 600 "$TOKEN_FILE"
TOKEN="$(cat "$TOKEN_FILE")"
if [ "${#TOKEN}" -lt 48 ]; then
  printf 'FATAL ERR_TOKEN_TOO_SHORT: %s chars\n' "${#TOKEN}" >&2
  exit 2
fi

A2A_PEER_TOKEN="$TOKEN" SETTINGS_FILE="$SETTINGS_FILE" python3 <<'PY'
import json
import os

settings_file = os.environ["SETTINGS_FILE"]
token = os.environ["A2A_PEER_TOKEN"]

with open(settings_file, encoding="utf-8") as handle:
    config = json.load(handle)

if not isinstance(config, dict):
    raise SystemExit("FATAL ERR_SETTINGS_NOT_OBJECT")

# Replace only the owned server block so configured peers and discovery survive.
a2a = config.setdefault("a2a", {})
if not isinstance(a2a, dict):
    raise SystemExit("FATAL ERR_A2A_BLOCK_NOT_OBJECT")

a2a["server"] = {
    "enabled": True,
    "host": "127.0.0.1",
    "port": 9910,
    "portFallback": 10,
    "agentName": "pi-termux-executor",
    "peerTokens": {"codex": token},
    "trustedPeers": ["codex"],
    "allowAllUsers": False,
    "maxConcurrent": 2,
    "replyTimeoutSec": 300,
    "childTranscripts": True,
    "childTranscriptRetentionDays": 7,
    "rateLimitPerMin": 30,
}
a2a["timeouts"] = {"send": 360000, "stream": 120000}

temporary_file = settings_file + ".tmp"
with open(temporary_file, "w", encoding="utf-8", newline="\n") as handle:
    json.dump(config, handle, indent=2, ensure_ascii=False)
    handle.write("\n")
    handle.flush()
    os.fsync(handle.fileno())

os.replace(temporary_file, settings_file)
PY

jq -e '
  .a2a.server.enabled == true
  and .a2a.server.host == "127.0.0.1"
  and .a2a.server.allowAllUsers == false
  and .a2a.server.maxConcurrent == 2
  and (.a2a.server.peerTokens.codex | length) >= 48
' "$SETTINGS_FILE" >/dev/null

printf 'PI_SETTINGS_SEEDED host=%s port=%s token_len=%s\n' \
  "$(jq -r '.a2a.server.host' "$SETTINGS_FILE")" \
  "$(jq -r '.a2a.server.port' "$SETTINGS_FILE")" \
  "$(jq -r '.a2a.server.peerTokens.codex | length' "$SETTINGS_FILE")"
