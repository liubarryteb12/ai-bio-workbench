#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env.a2a"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

: "${CODEX_WORKSPACE_ROOT:=$PROJECT_ROOT}"
: "${A2A_HOST:=127.0.0.1}"
: "${A2A_PORT:=8000}"
: "${PI_A2A_PORT:=9910}"
: "${PI_A2A_ENDPOINT:=}"

if [ -z "$PI_A2A_ENDPOINT" ]; then
  if [ "${PI_TAILSCALE_IP:-}" = "" ]; then
    printf 'FATAL ERR_MISSING_ENDPOINT: set PI_TAILSCALE_IP or PI_A2A_ENDPOINT\n' >&2
    exit 2
  fi
  PI_A2A_ENDPOINT="http://${PI_TAILSCALE_IP}:${PI_A2A_PORT}"
fi

: "${A2A_CLIENT_BEARER_TOKEN:?must set A2A_CLIENT_BEARER_TOKEN}"

if [ "$A2A_HOST" != "127.0.0.1" ] && [ "$A2A_HOST" != "localhost" ]; then
  printf 'FATAL ERR_CODEX_HOST: Codex inbound host must remain 127.0.0.1, got %s\n' "$A2A_HOST" >&2
  exit 2
fi

export NO_PROXY="127.0.0.1,localhost,100.64.0.0/10,${PI_TAILSCALE_IP:-},${NO_PROXY:-}"
export no_proxy="$NO_PROXY"
export PI_A2A_ENDPOINT

case "$NO_PROXY" in
  *100.64.0.0/10*) ;;
  *) printf 'FATAL ERR_NO_PROXY: Tailscale CIDR missing\n' >&2; exit 2 ;;
esac

if [ -z "${A2A_BEARER_TOKEN:-}" ]; then
  A2A_BEARER_TOKEN="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
  export A2A_BEARER_TOKEN
fi

echo "[+] probing Pi Agent Card at $PI_A2A_ENDPOINT"
curl --noproxy '*' -fsS --max-time 5 "$PI_A2A_ENDPOINT/.well-known/agent-card.json" | jq -e '.name' >/dev/null

echo "[+] starting codex-a2a serve on $A2A_HOST:$A2A_PORT"
exec codex-a2a serve
