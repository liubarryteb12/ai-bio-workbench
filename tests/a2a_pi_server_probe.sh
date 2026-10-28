#!/data/data/com.termux/files/usr/bin/bash
# Prove that Pi auto-starts its A2A server from settings before any model call.
set -euo pipefail

SESSION_NAME="pi-a2a-probe"
SETTINGS_FILE="$HOME/.pi/agent/settings.json"
TOKEN_FILE="$HOME/.pi/agent/.peer_token"
WORKSPACE_ROOT="$HOME/workspace/projects"
PROBE_URL="http://127.0.0.1:9910/.well-known/agent-card.json"
CARD_TIMEOUT_SECONDS=30
WRONG_TOKEN="unauthorized-probe-token"

die() {
  local code="$1"
  shift
  printf 'PI_A2A_SERVER_PROBE_FAIL code=%s reason=%s\n' "$code" "$*" >&2
  exit "$code"
}

log() {
  printf 'PROBE %s\n' "$1"
}

cleanup() {
  tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
  rm -f "$card_file" "$body_file" 2>/dev/null || true
}

for tool in tmux curl jq; do
  command -v "$tool" >/dev/null 2>&1 || die 2 "ERR_TOOL_MISSING:$tool"
done

if [ ! -f "$SETTINGS_FILE" ]; then
  die 2 "ERR_CONFIG_MISSING:$SETTINGS_FILE"
fi

if [ ! -f "$TOKEN_FILE" ]; then
  die 2 "ERR_TOKEN_FILE_MISSING:$TOKEN_FILE"
fi

PEER_TOKEN="$(cat "$TOKEN_FILE")"
if [ "${#PEER_TOKEN}" -lt 48 ]; then
  die 2 "ERR_TOKEN_TOO_SHORT:${#PEER_TOKEN}"
fi

CONFIG_OK="$(jq -r '
  if
    .a2a.server.enabled == true
    and .a2a.server.host == "127.0.0.1"
    and .a2a.server.port == 9910
    and .a2a.server.allowAllUsers == false
    and .a2a.server.maxConcurrent == 2
    and ((.a2a.server.peerTokens.codex // "") | length) >= 48
  then "yes" else "no" end
' "$SETTINGS_FILE")"
if [ "$CONFIG_OK" != "yes" ]; then
  die 2 "ERR_CONFIG_GUARD_FAILED"
fi

if curl --noproxy '*' -fsS --max-time 2 "$PROBE_URL" >/dev/null 2>&1; then
  die 1 "ERR_PORT_ALREADY_SERVING:9910"
fi

if [ -n "${PI_PROVIDER_ENV:-}" ]; then
  case "$PI_PROVIDER_ENV" in
    *[!A-Z0-9_]* | [0-9]* | "" )
      die 2 "ERR_PROVIDER_ENV_MALFORMED"
      ;;
  esac
  if [ -z "${!PI_PROVIDER_ENV:-}" ]; then
    die 2 "ERR_PROVIDER_KEY_UNSET:$PI_PROVIDER_ENV"
  fi
fi

if [ -n "${PI_PROVIDER_ENV:-}" ]; then
  tmux new-session -d -s "$SESSION_NAME" -c "$WORKSPACE_ROOT" -x 220 -y 50 \
    -e "$PI_PROVIDER_ENV=${!PI_PROVIDER_ENV}"
else
  tmux new-session -d -s "$SESSION_NAME" -c "$WORKSPACE_ROOT" -x 220 -y 50
fi
tmux send-keys -t "$SESSION_NAME" \
  "cd '$WORKSPACE_ROOT' && exec pi" C-m

card_file="$(mktemp)"
body_file="$(mktemp)"
trap cleanup EXIT

deadline=$((SECONDS + CARD_TIMEOUT_SECONDS))
card_ok=0
while [ "$SECONDS" -lt "$deadline" ]; do
  if curl --noproxy '*' -fsS --max-time 3 "$PROBE_URL" >"$card_file" 2>/dev/null; then
    card_ok=1
    break
  fi
  sleep 3
done

if [ "$card_ok" -ne 1 ]; then
  die 1 "ERR_AGENT_CARD_TIMEOUT"
fi

if ! jq -e '
  (.name | type == "string" and length > 0)
  and (.capabilities | type == "object")
  and (.skills | type == "array" and length > 0)
' "$card_file" >/dev/null; then
  die 1 "ERR_AGENT_CARD_INVALID"
fi

post_status() {
  local auth_header="${1:-}"
  if [ -n "$auth_header" ]; then
    curl --noproxy '*' -sS -o "$body_file" -w '%{http_code}' \
      -X POST -H 'Content-Type: application/json' -H "Authorization: $auth_header" \
      --data '{"jsonrpc":"2.0","id":1,"method":"message/send","params":{}}' \
      'http://127.0.0.1:9910/'
  else
    curl --noproxy '*' -sS -o "$body_file" -w '%{http_code}' \
      -X POST -H 'Content-Type: application/json' \
      --data '{"jsonrpc":"2.0","id":1,"method":"message/send","params":{}}' \
      'http://127.0.0.1:9910/'
  fi
}

UNAUTH_STATUS="$(post_status "")"
WRONG_STATUS="$(post_status "Bearer $WRONG_TOKEN")"

case "$UNAUTH_STATUS" in
  401|403) ;;
  *) die 1 "ERR_UNAUTH_POST_STATUS:$UNAUTH_STATUS" ;;
esac

case "$WRONG_STATUS" in
  401|403) ;;
  *) die 1 "ERR_WRONG_TOKEN_POST_STATUS:$WRONG_STATUS" ;;
esac

log "agent_card=ok"
log "unauthenticated_post_status=$UNAUTH_STATUS"
log "wrong_token_post_status=$WRONG_STATUS"
printf 'PI_A2A_SERVER_PROBE_OK\n'
