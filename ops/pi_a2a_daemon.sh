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
MODEL_A="glm-5.3-flash"
MODEL_B="deepseek-v4.1-flash"
THINKING_LEVEL="high"

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
    case "$REQUESTED_MODEL" in
      "$MODEL_A"|"$MODEL_B") PROVIDER_MODEL="$REQUESTED_MODEL" ;;
      *) die 2 "ERR_MODEL_NOT_ALLOWED: $REQUESTED_MODEL" ;;
    esac
  fi
  chmod 600 "$PROVIDER_KEY_FILE" "$PROVIDER_NAME_FILE"
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
  log "INFO starting_pi_auto_server mode=tui session=$SESSION_NAME"
  if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    tmux kill-session -t "$SESSION_NAME"
  fi
  if [ -n "$PROVIDER_ENV_NAME" ]; then
    tmux new-session -d -s "$SESSION_NAME" -c "$WORKSPACE_ROOT" \
      -e "$PROVIDER_ENV_NAME=$PROVIDER_VALUE" \
      "cd '$WORKSPACE_ROOT' && exec pi --model '$PROVIDER_MODEL' --thinking '$THINKING_LEVEL'"
  else
    tmux new-session -d -s "$SESSION_NAME" -c "$WORKSPACE_ROOT" \
      "cd '$WORKSPACE_ROOT' && exec pi --model '$PROVIDER_MODEL' --thinking '$THINKING_LEVEL'"
  fi
}

start_server() {
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

probe() {
  curl --noproxy '*' -fsS --max-time 5 "$PROBE_URL" >/dev/null 2>&1
}

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
  while true; do
    if probe; then
      :
    else
      log "WARN probe failed, restarting pi auto-start session"
      start_server
      if wait_for_server; then
        log "PASS server_recovered"
      else
        log "ERROR server remains unavailable"
      fi
    fi
    sleep 60
  done
}

if [ "${A2A_DAEMON_MODE:-foreground}" = "monitor" ] ; then
  monitor_loop
else
  log "INFO monitor_mode=A2A_DAEMON_MODE=monitor enables 60s self-heal loop"
fi
