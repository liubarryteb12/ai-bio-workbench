#!/data/data/com.termux/files/usr/bin/bash
# Seed the Pi models.json for the approved reasoning models through the
# user-provided OpenAI-compatible relay endpoint. The API key is referenced
# by environment variable name only; the value stays in the 0600 env file.
set -euo pipefail

MODELS_FILE="$HOME/.pi/agent/models.json"
BASE_URL_FILE="$HOME/.pi/agent/.provider_base_url"
DEFAULT_BASE_URL="${A2A_PROVIDER_BASE_URL:-}"

if [ -n "$DEFAULT_BASE_URL" ]; then
  case "$DEFAULT_BASE_URL" in
    https://*|http://*) ;;
    *) printf 'FATAL ERR_PROVIDER_BASE_URL_MALFORMED\n' >&2; exit 2 ;;
  esac
fi

if [ -s "$BASE_URL_FILE" ]; then
  DEFAULT_BASE_URL="$(tr -d '[:space:]' < "$BASE_URL_FILE")"
fi

if [ -z "$DEFAULT_BASE_URL" ]; then
  printf 'FATAL ERR_PROVIDER_BASE_URL_MISSING: set A2A_PROVIDER_BASE_URL or %s\n' "$BASE_URL_FILE" >&2
  exit 2
fi

A2A_MODELS_FILE="$MODELS_FILE" A2A_BASE_URL="$DEFAULT_BASE_URL" python3 <<'PY'
import json
import os

models_file = os.environ["A2A_MODELS_FILE"]
base_url = os.environ["A2A_BASE_URL"].rstrip("/")

config = {
    "$schema": "https://pi.dev/schemas/models.schema.json",
    "providers": {
        "a2a-relay": {
            "baseUrl": base_url,
            "api": "openai-completions",
            "apiKey": "$A2A_PROVIDER_KEY",
            "models": [
                {
                    "id": "glm-5.3-flash",
                    "name": "GLM 5.3 Flash (A2A relay)",
                    "reasoning": True,
                    "thinkingLevelMap": {"off": None, "minimal": None, "low": None, "medium": None, "high": "high"},
                },
                {
                    "id": "deepseek-v4.1-flash",
                    "name": "DeepSeek V4.1 Flash (A2A relay)",
                    "reasoning": True,
                    "thinkingLevelMap": {"off": None, "minimal": None, "low": None, "medium": None, "high": "high"},
                },
            ],
        }
    },
}

with open(models_file, "w", encoding="utf-8", newline="\n") as handle:
    json.dump(config, handle, indent=2, ensure_ascii=False)
    handle.write("\n")
PY

chmod 600 "$MODELS_FILE"
printf 'PI_MODELS_SEEDED base_url=%s models=glm-5.3-flash,deepseek-v4.1-flash\n' "$DEFAULT_BASE_URL"
