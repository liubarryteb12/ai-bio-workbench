#!/data/data/com.termux/files/usr/bin/bash
# Launch Pi without placing provider secrets in a process command line.
set -euo pipefail

MODEL="${1:-}"
THINKING="${2:-high}"
AGENT_DIR="$HOME/.pi/agent"
PROVIDER="$(cat "$AGENT_DIR/.provider_name" 2>/dev/null || printf unknown)"
KEY_FILE="$AGENT_DIR/.provider_keys/$PROVIDER"

if [ ! -s "$KEY_FILE" ] && [ "$PROVIDER" = "zai" ]; then
  KEY_FILE="$AGENT_DIR/.provider_key"
fi

case "$MODEL" in
  glm-5.3-flash|deepseek-v4.1-flash) ;;
  *) printf 'FATAL ERR_MODEL_NOT_ALLOWED: %s\n' "$MODEL" >&2; exit 2 ;;
esac

case "$THINKING" in
  low|medium|high) ;;
  *) printf 'FATAL ERR_THINKING_LEVEL_INVALID: %s\n' "$THINKING" >&2; exit 2 ;;
esac

if [ ! -s "$KEY_FILE" ]; then
  printf 'FATAL ERR_PROVIDER_KEY_MISSING: provider=%s\n' "$PROVIDER" >&2
  exit 2
fi

chmod 600 "$KEY_FILE"
export A2A_PROVIDER_KEY="$(cat "$KEY_FILE")"
exec pi --model "$MODEL" --thinking "$THINKING"
