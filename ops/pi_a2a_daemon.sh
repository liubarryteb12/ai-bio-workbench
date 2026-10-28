#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

SESSION_NAME="pi-a2a"
SETTINGS_FILE="$HOME/.pi/agent/settings.json"
WORKSPACE_ROOT="$HOME/workspace/projects"
LOG_DIR="$HOME/.pi/agent/logs"
LOG_FILE="$LOG_DIR/pi_a2a_daemon.log"
PROBE_URL="http://127.0.0.1:9910/.well-known/agent-card.json"

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

if [ "$HOST_VAL" = "0.0.0.0" ] && [ "${#CODEX_TOKEN}" -lt 32 ]; then
  die 2 "ERR_SECURITY_BIND: 0.0.0.0 requires high entropy codex peer token"
fi

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock
  log "INFO wake_lock_held"
else
  log "WARN termux-wake-lock unavailable"
fi

start_server() {
  tmux send-keys -t "$SESSION_NAME" "cd '$WORKSPACE_ROOT' && pi" C-m
  sleep 4
  tmux send-keys -t "$SESSION_NAME" "/a2a-server start" C-m
  sleep 3
}

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  log "INFO tmux_session_exists"
else
  log "INFO creating tmux session $SESSION_NAME"
  tmux new-session -d -s "$SESSION_NAME" -c "$WORKSPACE_ROOT"
  start_server
fi

probe() {
  curl --noproxy '*' -fsS --max-time 5 "$PROBE_URL" >/dev/null 2>&1
}

if probe; then
  log "PASS a2a_server_ready host=$HOST_VAL port=$PORT_VAL"
else
  log "WARN first probe failed, retrying"
  start_server
  if probe; then
    log "PASS a2a_server_ready_after_retry"
  else
    die 1 "ERR_SERVER_NOT_READY"
  fi
fi

monitor_loop() {
  while true; do
    if probe; then
      :
    else
      log "WARN probe failed, restarting server"
      start_server
      if probe; then
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
