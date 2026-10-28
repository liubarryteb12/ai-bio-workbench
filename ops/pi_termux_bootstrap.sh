#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"

log() {
  printf '[%s] [%s] %s\n' "$(date -Iseconds)" "$SCRIPT_NAME" "$1"
}

die() {
  printf '[%s] [%s] FATAL %s\n' "$(date -Iseconds)" "$SCRIPT_NAME" "$2" >&2
  exit "$1"
}

if [ "${TERMUX_VERSION:-}" = "" ]; then
  die 2 "ERR_NOT_TERMUX: script requires Termux runtime"
fi

for package in nodejs git python jq tmux termux-api procps curl; do
  if ! command -v "$package" >/dev/null 2>&1; then
    log "installing package=$package"
    pkg install -y "$package"
  fi
done

WORKSPACE_ROOT="$HOME/workspace"
PROJECTS_ROOT="$HOME/workspace/projects"
PI_CONFIG_DIR="$HOME/.pi/agent"
TRANSCRIPT_DIR="$PI_CONFIG_DIR/transcripts"
LOG_DIR="$PI_CONFIG_DIR/logs"
BIN_DIR="$HOME/bin"

mkdir -p "$PROJECTS_ROOT" "$TRANSCRIPT_DIR" "$LOG_DIR" "$BIN_DIR"

REAL_WS="$(realpath "$WORKSPACE_ROOT")"
case "$REAL_WS" in
  /sdcard|/sdcard/*|/storage/emulated|/storage/emulated/*)
    die 3 "ERR_PATH_GUARD: native workspace required, got $REAL_WS"
    ;;
esac

if [ ! -d "$REAL_WS" ]; then
  die 1 "ERR_WORKSPACE_MISSING: $REAL_WS"
fi

if [ ! -f "$PI_CONFIG_DIR/settings.json" ] && [ -f "$PI_CONFIG_DIR/settings.json.example" ]; then
  log "seeding settings from bundled example"
  cp "$PI_CONFIG_DIR/settings.json.example" "$PI_CONFIG_DIR/settings.json"
fi

if [ ! -x "$HOME/bin/pi_a2a_daemon.sh" ]; then
  die 1 "ERR_DAEMON_MISSING: install pi_a2a_daemon.sh to $HOME/bin first"
fi

log "installing Pi Coding Agent"
if command -v pi >/dev/null 2>&1; then
  log "pi already installed version=$(pi --version 2>/dev/null || printf unknown)"
else
  npm install -g --ignore-scripts @earendil-works/pi-coding-agent
fi

log "verifying package tools"
for package in nodejs git python jq tmux termux-api procps curl; do
  command -v "$package" >/dev/null 2>&1 || die 1 "ERR_TOOL_MISSING: $package"
done

log "installing A2A extension"
pi install npm:@bacnh85/pi-a2a

log "PASS bootstrap_complete workspace=$REAL_WS config=$PI_CONFIG_DIR"
