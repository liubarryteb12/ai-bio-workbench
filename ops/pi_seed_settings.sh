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

config["a2a"] = {
    "server": {
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
    },
    "timeouts": {"send": 360000, "stream": 120000},
}

with open(settings_file, "w", encoding="utf-8") as handle:
    json.dump(config, handle, indent=2, ensure_ascii=False)
    handle.write("\n")
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
