#!/usr/bin/env bash
# ==============================================================================
# 文件落点：ops/pi_idempotent_runner.sh (部署至手机端 Termux: $HOME/bin/pi_idempotent_runner.sh)
# 架构约束：D-11（传算分离、.lock/.done 幂等断点防重跑、只读母版保护、日志削峰）
# ==============================================================================
set -euo pipefail

PROJECT_ID=""
STEP_ID=""
SCRIPT_PATH=""
EXPECTED_OUTPUTS=""
WORKSPACE_BASE="${PI_WORKSPACE_BASE:-$HOME/workspace/projects}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT_ID="$2"; shift 2 ;;
    --step)    STEP_ID="$2"; shift 2 ;;
    --script)  SCRIPT_PATH="$2"; shift 2 ;;
    --outputs) EXPECTED_OUTPUTS="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$PROJECT_ID" || -z "$STEP_ID" || -z "$SCRIPT_PATH" ]]; then
  echo '{"error":"ERR_MISSING_ARGS","usage":"pi_idempotent_runner.sh --project <id> --step <step> --script <path> [--outputs a,b]"}'
  exit 2
fi

PROJECT_DIR="${WORKSPACE_BASE}/${PROJECT_ID}"
REAL_PROJ="$(realpath -m "$PROJECT_DIR")"

if [[ "$REAL_PROJ" == /sdcard* ]] || [[ "$REAL_PROJ" == /storage/emulated* ]]; then
  echo "{\"error\":\"ERR_PATH_GUARD\",\"workspace_dir\":\"$REAL_PROJ\"}"
  exit 3
fi

mkdir -p "$REAL_PROJ/system_logs"
cd "$REAL_PROJ"

if [[ ! -f "$SCRIPT_PATH" ]]; then
  echo "{\"error\":\"ERR_SCRIPT_NOT_FOUND\",\"script_path\":\"$SCRIPT_PATH\"}"
  exit 4
fi

chmod a-w "$SCRIPT_PATH" 2>/dev/null || true
SCRIPT_SHA256="$(sha256sum "$SCRIPT_PATH" | awk '{print $1}')"

LOCK_FILE="${REAL_PROJ}/.step_${STEP_ID}.lock"
DONE_FILE="${REAL_PROJ}/.step_${STEP_ID}.done"
LOG_FILE="${REAL_PROJ}/system_logs/${STEP_ID}.log"

verify_outputs_exist() {
  if [[ -z "$EXPECTED_OUTPUTS" ]]; then
    return 0
  fi
  IFS=',' read -ra OUT_ARR <<< "$EXPECTED_OUTPUTS"
  for out_f in "${OUT_ARR[@]}"; do
    out_f="$(echo "$out_f" | xargs)"
    [[ -z "$out_f" ]] && continue
    if [[ ! -s "$out_f" ]]; then
      return 1
    fi
  done
  return 0
}

if [[ -f "$DONE_FILE" ]]; then
  DONE_SCRIPT_SHA="$(jq -r '.script_sha256 // ""' "$DONE_FILE" 2>/dev/null || true)"
  if [[ "$DONE_SCRIPT_SHA" == "$SCRIPT_SHA256" ]] && verify_outputs_exist; then
    jq '.idempotent_status = "reused_done_checkpoint"' "$DONE_FILE"
    exit 0
  fi
fi

if [[ -f "$LOCK_FILE" ]]; then
  OLD_PID="$(cat "$LOCK_FILE" 2>/dev/null || true)"
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    while kill -0 "$OLD_PID" 2>/dev/null; do
      sleep 2
    done
    if [[ -f "$DONE_FILE" ]]; then
      jq '.idempotent_status = "attached_running_lock"' "$DONE_FILE"
      exit 0
    fi
  fi
  rm -f "$LOCK_FILE"
fi

START_TS="$(date +%s)"
ISO_NOW="$(date -Iseconds)"

case "$SCRIPT_PATH" in
  *.R|*.r)   RUNNER_CMD=(Rscript "$SCRIPT_PATH") ;;
  *.py)      RUNNER_CMD=(python3 "$SCRIPT_PATH") ;;
  *.sh)      RUNNER_CMD=(bash "$SCRIPT_PATH") ;;
  *)         RUNNER_CMD=("$SCRIPT_PATH") ;;
esac

set +e
"${RUNNER_CMD[@]}" > "$LOG_FILE" 2>&1 &
CHILD_PID=$!
echo "$CHILD_PID" > "$LOCK_FILE"
wait "$CHILD_PID"
EXIT_CODE=$?
set -e

rm -f "$LOCK_FILE"
END_TS="$(date +%s)"
DURATION_SEC=$((END_TS - START_TS))

POST_SCRIPT_SHA256="$(sha256sum "$SCRIPT_PATH" | awk '{print $1}')"
if [[ "$POST_SCRIPT_SHA256" != "$SCRIPT_SHA256" ]]; then
  echo "{\"error\":\"ERR_SCRIPT_MUTATED_DURING_RUN\",\"step_id\":\"$STEP_ID\"}"
  exit 5
fi

CHANGED_JSON="[]"
if [[ -n "$EXPECTED_OUTPUTS" ]]; then
  IFS=',' read -ra OUT_ARR <<< "$EXPECTED_OUTPUTS"
  for out_f in "${OUT_ARR[@]}"; do
    out_f="$(echo "$out_f" | xargs)"
    if [[ -f "$out_f" ]]; then
      f_sha="$(sha256sum "$out_f" | awk '{print $1}')"
      CHANGED_JSON="$(jq --arg p "$out_f" --arg s "$f_sha" '. + [{"path":$p,"sha256":$s,"action":"verified"}]' <<<"$CHANGED_JSON")"
    fi
  done
fi

STDOUT_TAIL="$(tail -n 10 "$LOG_FILE" 2>/dev/null | tr '\n' ' ' | cut -c 1-300)"

RESULT_JSON="$(jq -n \
  --arg step_id "$STEP_ID" \
  --arg idem "fresh_run" \
  --arg exec_at "$ISO_NOW" \
  --arg ws "$REAL_PROJ" \
  --arg sp "$SCRIPT_PATH" \
  --arg s_sha "$SCRIPT_SHA256" \
  --argjson code "$EXIT_CODE" \
  --argjson dur "$DURATION_SEC" \
  --arg log_f "$LOG_FILE" \
  --argjson files "$CHANGED_JSON" \
  --arg summary "$STDOUT_TAIL" \
  '{
    step_id: $step_id,
    idempotent_status: $idem,
    executed_at: $exec_at,
    workspace_dir: $ws,
    script_path: $sp,
    script_sha256: $s_sha,
    exit_code: $code,
    duration_sec: $dur,
    log_file: $log_f,
    changed_files: $files,
    stdout_summary: $summary
  }')"

if [[ "$EXIT_CODE" -eq 0 ]] && verify_outputs_exist; then
  echo "$RESULT_JSON" > "$DONE_FILE"
  echo "$RESULT_JSON"
  exit 0
else
  echo "$RESULT_JSON"
  exit "$EXIT_CODE"
fi