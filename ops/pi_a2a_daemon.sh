#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

SESSION_NAME="pi-a2a"
SETTINGS_FILE="$HOME/.pi/agent/settings.json"
WORKSPACE_ROOT="$HOME/workspace/projects"
LOG_DIR="$HOME/.pi/agent/logs"
LOG_FILE="$LOG_DIR/pi_a2a_daemon.log"
PROBE_URL="http://127.0.0.1:9910/.well-known/agent-card.json"
SERVER_WAIT_SECONDS=30
PROVIDER_KEY_FILE="$HOME/.pi/agent/.provider_key"
PROVIDER_NAME_FILE="$HOME/.pi/agent/.provider_name"
PROVIDER_MODEL_FILE="$HOME/.pi/agent/.provider_model"
PROVIDER_BASE_URL_FILE="$HOME/.pi/agent/.provider_base_url"
MODEL_A="glm-5.3-flash"
MODEL_B="deepseek-v4.1-flash"
THINKING_LEVEL="high"
DEFAULT_BASE_URL="https://api.deepseek.com/v1"

mkdir -p "$WORKSPACE_ROOT" "$LOG_DIR"

log() {
  printf '[%s] %s\n' "$(date -Iseconds)" "$1" | tee -a "$LOG_FILE"
}

die() {
  printf '[%s] FATAL %s\n' "$(date -Iseconds)" "$2" >&2
  exit "$1"
}

REAL_WS="$(realpath "$WORKSPACE_ROOT")"
case "$REAL_WS" in
  /sdcard|/sdcard/*|/storage/emulated|/storage/emulated/*)
    die 3 "ERR_PATH_GUARD: workspace is on Android FUSE storage"
    ;;
esac

if [ ! -f "$SETTINGS_FILE" ]; then
  die 1 "ERR_CONFIG_MISSING: $SETTINGS_FILE"
fi

ENABLED="$(jq -r '.a2a.server.enabled // false' "$SETTINGS_FILE")"
HOST_VAL="$(jq -r '.a2a.server.host // "127.0.0.1"' "$SETTINGS_FILE")"
PORT_VAL="$(jq -r '.a2a.server.port // 9910' "$SETTINGS_FILE")"
ALLOW_ALL="$(jq -r '.a2a.server.allowAllUsers // false' "$SETTINGS_FILE")"
CODEX_TOKEN="$(jq -r '.a2a.server.peerTokens.codex // ""' "$SETTINGS_FILE")"

if [ "$ENABLED" != "true" ]; then
  die 1 "ERR_SERVER_DISABLED"
fi

if [ "$ALLOW_ALL" = "true" ]; then
  die 2 "ERR_SECURITY_VIOLATION: allowAllUsers must remain false"
fi

PROVIDER_ENV_NAME=""
PROVIDER_VALUE=""
PROVIDER_MODEL=""
PROVIDER_BASE_URL="$DEFAULT_BASE_URL"
if [ -n "${PI_PROVIDER_ENV:-}" ]; then
  case "$PI_PROVIDER_ENV" in
    *[!A-Z0-9_]* | [0-9]* | "" )
      die 2 "ERR_PROVIDER_ENV_MALFORMED: must match [A-Z][A-Z0-9_]*"
      ;;
  esac
  if [ -z "${!PI_PROVIDER_ENV:-}" ]; then
    die 2 "ERR_PROVIDER_KEY_UNSET: $PI_PROVIDER_ENV is empty"
  fi
  PROVIDER_ENV_NAME="$PI_PROVIDER_ENV"
  PROVIDER_VALUE="${!PI_PROVIDER_ENV}"
  case "$PROVIDER_ENV_NAME" in
    ZAI_API_KEY|ZAI_CODING_CN_API_KEY)
      PROVIDER_MODEL="$MODEL_A"
      ;;
    DEEPSEEK_API_KEY)
      PROVIDER_MODEL="$MODEL_B"
      ;;
    *)
      die 2 "ERR_PROVIDER_NOT_ALLOWED: only ZAI or DeepSeek keys may run Pi"
      ;;
  esac
elif [ -s "$PROVIDER_KEY_FILE" ] && [ -s "$PROVIDER_NAME_FILE" ]; then
  PROVIDER_NAME="$(tr -d '[:space:]' < "$PROVIDER_NAME_FILE")"
  case "$PROVIDER_NAME" in
    [a-z][a-z0-9]*)
      PROVIDER_ENV_NAME="$(printf '%s' "$PROVIDER_NAME" | tr '[:lower:]-' '[:upper:]_')_API_KEY"
      ;;
    *)
      die 2 "ERR_PROVIDER_NAME_MALFORMED: $PROVIDER_NAME"
      ;;
  esac
  PROVIDER_VALUE="$(cat "$PROVIDER_KEY_FILE")"
  case "$PROVIDER_NAME" in
    zai)
      PROVIDER_ENV_NAME="ZAI_API_KEY"
      PROVIDER_MODEL="$MODEL_A"
      ;;
    deepseek)
      PROVIDER_ENV_NAME="DEEPSEEK_API_KEY"
      PROVIDER_MODEL="$MODEL_B"
      ;;
    openai|anthropic|openrouter)
      die 2 "ERR_PROVIDER_NOT_ALLOWED: Pi is restricted to glm-5.3-flash and deepseek-v4.1-flash"
      ;;
    *)
      die 2 "ERR_PROVIDER_NAME_MALFORMED: $PROVIDER_NAME"
      ;;
  esac
  if [ -s "$PROVIDER_MODEL_FILE" ]; then
    REQUESTED_MODEL="$(tr -d '[:space:]' < "$PROVIDER_MODEL_FILE")"
    if [ "$REQUESTED_MODEL" != "$PROVIDER_MODEL" ]; then
      die 2 "ERR_MODEL_PIN_MISMATCH: file=$REQUESTED_MODEL derived=$PROVIDER_MODEL"
    fi
  fi
  chmod 600 "$PROVIDER_KEY_FILE" "$PROVIDER_NAME_FILE"
  if [ -s "$PROVIDER_BASE_URL_FILE" ]; then
    PROVIDER_BASE_URL="$(tr -d '[:space:]' < "$PROVIDER_BASE_URL_FILE")"
    case "$PROVIDER_BASE_URL" in
      https://*|http://*) ;;
      *) die 2 "ERR_PROVIDER_BASE_URL_MALFORMED" ;;
    esac
  fi
fi

if [ -n "$PROVIDER_ENV_NAME" ] && [ ! -s "$HOME/.pi/agent/models.json" ]; then
  die 2 "ERR_MODELS_JSON_MISSING: custom provider endpoint requires models.json"
fi

if [ -z "$PROVIDER_ENV_NAME" ]; then
  die 2 "ERR_PROVIDER_REQUIRED: Pi may only start with an approved model key"
fi

TRUSTED_PEERS_COUNT="$(jq -r '.a2a.server.trustedPeers | length' "$SETTINGS_FILE" 2>/dev/null || printf 0)"
if [ "$HOST_VAL" = "0.0.0.0" ]; then
  if [ "${#CODEX_TOKEN}" -lt 48 ]; then
    die 2 "ERR_SECURITY_BIND: 0.0.0.0 requires a 48+ char codex peer token"
  fi
  if [ "$TRUSTED_PEERS_COUNT" -lt 1 ]; then
    die 2 "ERR_SECURITY_BIND: 0.0.0.0 requires at least one trustedPeer"
  fi
fi

if [ "$HOST_VAL" = "0.0.0.0" ] && [ "${#CODEX_TOKEN}" -lt 32 ]; then
  die 2 "ERR_SECURITY_BIND: 0.0.0.0 requires high entropy codex peer token"
fi

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock
  log "INFO wake_lock_held"
else
  log "WARN termux-wake-lock unavailable"
fi

start_pi() {
  if [ -z "$PROVIDER_ENV_NAME" ] || [ -z "$PROVIDER_MODEL" ]; then
    die 2 "ERR_PROVIDER_REQUIRED: Pi may only start with an approved model key"
  fi
  log "INFO starting_pi_auto_server mode=tui session=$SESSION_NAME"
  if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    tmux kill-session -t "$SESSION_NAME"
  fi
  tmux new-session -d -s "$SESSION_NAME" -c "$WORKSPACE_ROOT" \
    -e "A2A_PROVIDER_KEY=$PROVIDER_VALUE" \
    "cd '$WORKSPACE_ROOT' && exec pi --model '$PROVIDER_MODEL' --thinking '$THINKING_LEVEL'"
}

probe() {
  curl --noproxy '*' -fsS --max-time 5 "$PROBE_URL" >/dev/null 2>&1
}

start_server() {
  if probe; then
    log "INFO server already healthy, skipping restart"
    return 0
  fi
  if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    start_pi
  else
    log "INFO creating tmux session $SESSION_NAME"
    tmux new-session -d -s "$SESSION_NAME" -c "$WORKSPACE_ROOT"
    start_pi
  fi
}

wait_for_server() {
  local deadline=$((SECONDS + SERVER_WAIT_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if probe; then
      return 0
    fi
    sleep 3
  done
  return 1
}

start_server

if wait_for_server; then
  log "PASS a2a_server_ready host=$HOST_VAL port=$PORT_VAL"
else
  log "WARN first auto-start probe failed, retrying"
  start_server
  if wait_for_server; then
    log "PASS a2a_server_ready_after_retry"
  else
    if tmux list-panes -t "$SESSION_NAME" -F '#{pane_dead}' 2>/dev/null | command grep -q '^1$'; then
      log "ERROR pi_process_dead session=$SESSION_NAME"
    fi
    die 1 "ERR_SERVER_NOT_READY"
  fi
fi

monitor_loop() {
  local restart_delay=60
  while true; do
    if probe; then
      restart_delay=60
      :
    else
      log "WARN probe failed, restarting pi auto-start session"
      start_server
      if wait_for_server; then
        log "PASS server_recovered"
        restart_delay=60
      else
        log "ERROR server remains unavailable"
        restart_delay=$((restart_delay * 2))
        if [ "$restart_delay" -gt 600 ]; then
          restart_delay=600
        fi
      fi
    fi
    sleep "$restart_delay"
  done
}

if [ "${A2A_DAEMON_MODE:-foreground}" = "monitor" ] ; then
  monitor_loop
else
  log "INFO monitor_mode=A2A_DAEMON_MODE=monitor enables 60s self-heal loop"
fi
