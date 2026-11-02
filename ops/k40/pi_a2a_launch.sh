#!/data/data/com.termux/files/usr/bin/bash
# ops/k40/pi_a2a_launch.sh —— K40 Termux 端 Pi A2A 启动器的仓库镜像（5.2 纳管，2026-11-01）
# 远端落点：k40:$HOME/bin/pi_a2a_launch.sh（即 /data/data/com.termux/files/home/bin/）。
# 同步方式（低频，改完手动推一次）：
#   scp -o BatchMode=yes ops/k40/pi_a2a_launch.sh k40:.pi/a2a_launch_staging.sh
#   ssh k40 'mkdir -p $HOME/bin && mv $HOME/.pi/a2a_launch_staging.sh $HOME/bin/pi_a2a_launch.sh && chmod 700 $HOME/bin/pi_a2a_launch.sh'
# 放 ops/k40/ 子目录：避开 sync_and_verify_remote.ps1 的默认同步面
# （它只同步 ops 顶层 .sh，本文件的落点在 Termux 宿主 $HOME/bin，不在容器）。
# 一致性由 server/pi_agent.js 的 ERR_LAUNCHER_MISSING 在位校验 + 模型白名单双保险兜底。
# 下面是设备现网原文（2026-11-01 抓取自 k40:$HOME/bin/pi_a2a_launch.sh）：
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
