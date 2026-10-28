#!/data/data/com.termux/files/usr/bin/bash
# Inject the Pi model provider credential from the environment into the tmux
# session that hosts the A2A server. The key never lands in git or in a log.
set -euo pipefail

SESSION_NAME="pi-a2a"
LOG_DIR="$HOME/.pi/agent/logs"
LOG_FILE="$LOG_DIR/pi_a2a_daemon.log"

mkdir -p "$LOG_DIR"

log() {
  printf '[%s] %s\n' "$(date -Iseconds)" "$1" | tee -a "$LOG_FILE"
}

if [ -z "${PI_PROVIDER_ENV:-}" ]; then
  log "FATAL ERR_PROVIDER_ENV_UNSET: PI_PROVIDER_ENV must name the key variable"
  exit 2
fi

if [ -z "${!PI_PROVIDER_ENV:-}" ]; then
  log "FATAL ERR_PROVIDER_KEY_UNSET: $PI_PROVIDER_ENV is empty"
  exit 2
fi

if [ "${#PI_PROVIDER_ENV}" -gt 64 ]; then
  log "FATAL ERR_PROVIDER_ENV_TOO_LONG"
  exit 2
fi

if ! printf '%s' "$PI_PROVIDER_ENV" | grep -Eq '^[A-Z][A-Z0-9_]*$'; then
  log "FATAL ERR_PROVIDER_ENV_MALFORMED: must match ^[A-Z][A-Z0-9_]*$"
  exit 2
fi

if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  log "FATAL ERR_TMUX_SESSION_MISSING: $SESSION_NAME"
  exit 1
fi

# Only the variable name reaches the log; the value stays inside tmux.
log "INFO exporting $PI_PROVIDER_ENV into tmux session $SESSION_NAME"
tmux set-environment -t "$SESSION_NAME" "$PI_PROVIDER_ENV" "${!PI_PROVIDER_ENV}"
log "PASS provider_env_injected variable=$PI_PROVIDER_ENV"
