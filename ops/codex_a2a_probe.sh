#!/usr/bin/env bash
# Start codex-a2a on the loopback interface and verify its Agent Card.
# Credentials come from the environment only; nothing is echoed.
set -euo pipefail

RUNTIME_ROOT="${A2A_RUNTIME_ROOT:-/mnt/ssd/bio_data/a2a-runtime}"
LOG_DIR="$RUNTIME_ROOT/logs"
LOG_FILE="$LOG_DIR/codex_a2a_serve.log"
WORKSPACE_ROOT="${CODEX_WORKSPACE_ROOT:-/mnt/ssd/bio_data/a2a-gate}"
HOST="${A2A_HOST:-127.0.0.1}"
PORT="${A2A_PORT:-8000}"

mkdir -p "$LOG_DIR"

if [ -z "${A2A_STATIC_AUTH_CREDENTIALS:-}" ]; then
  printf 'FATAL ERR_AUTH_CREDENTIALS_UNSET: A2A_STATIC_AUTH_CREDENTIALS is required\n' >&2
  exit 2
fi

# Refuse to start when a previous serve is still holding the port. setsid
# detaches the process from the ssh session, so it survives the caller.
if python3 - "$HOST" "$PORT" <<'PY'
import socket
import sys

host, port = sys.argv[1], int(sys.argv[2])
probe = socket.socket()
probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    probe.bind((host, port))
except OSError:
    sys.exit(1)
finally:
    probe.close()
PY
then
  :
else
  printf 'FATAL ERR_PORT_IN_USE: %s:%s is still bound by a previous serve\n' "$HOST" "$PORT" >&2
  exit 2
fi

if [ "$HOST" != "127.0.0.1" ] && [ "$HOST" != "localhost" ]; then
  printf 'FATAL ERR_CODEX_HOST: the Codex inbound face must stay on loopback, got %s\n' "$HOST" >&2
  exit 2
fi

export A2A_HOST="$HOST"
export A2A_PORT="$PORT"
export A2A_PUBLIC_URL="http://${HOST}:${PORT}"
export CODEX_WORKSPACE_ROOT="$WORKSPACE_ROOT"

# codex-a2a resolves the CLI from PATH, so point it at the installed binary
# explicitly. The container ships no npm, so the static musl build lives here.
CODEX_CLI_BIN="${CODEX_CLI_BIN:-$RUNTIME_ROOT/bin/codex}"
if [ ! -x "$CODEX_CLI_BIN" ]; then
  printf 'FATAL ERR_CODEX_CLI_MISSING: %s is not executable\n' "$CODEX_CLI_BIN" >&2
  exit 2
fi
export CODEX_CLI_BIN

printf '[%s] starting codex-a2a on %s:%s\n' "$(date -Iseconds)" "$HOST" "$PORT"
setsid nohup "$RUNTIME_ROOT/venv/bin/codex-a2a" serve >>"$LOG_FILE" 2>&1 &

for attempt in 1 2 3 4 5 6; do
  sleep 2
  if curl --noproxy '*' -fsS --max-time 5 "http://${HOST}:${PORT}/.well-known/agent-card.json" >/tmp/.a2a_card.json 2>/dev/null; then
    if jq -e '.name' /tmp/.a2a_card.json >/dev/null 2>&1; then
      printf '[%s] agent card online name=%s\n' "$(date -Iseconds)" "$(jq -r '.name' /tmp/.a2a_card.json)"
      rm -f /tmp/.a2a_card.json
      printf 'CODEX_A2A_SERVE_OK host=%s port=%s\n' "$HOST" "$PORT"
      exit 0
    fi
  fi
  printf '[%s] probe attempt %s failed\n' "$(date -Iseconds)" "$attempt"
done

printf 'FATAL ERR_SERVE_NOT_READY: agent card unreachable after retries\n' >&2
exit 1
