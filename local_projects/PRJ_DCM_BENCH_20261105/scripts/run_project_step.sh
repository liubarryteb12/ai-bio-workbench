#!/bin/bash
# 项目内适配步的串行执行器（包装器模式①：引擎只认全局 bin 母版，项目 scripts/ 走这里）。
# 保留同一套降权/幂等锁/热节流/台账契约，只是台账由包装器自己写（BIO_WRAPPER_LEDGER 默认 1）。
# 用法:
#   bash run_project_step.sh submit <line> <step> <script> <inputs csv> <outputs csv> [env KV ...]
#   bash run_project_step.sh poll  <task_id> [tail_lines]
#   bash run_project_step.sh wait  <task_id> [max_wait_sec]
set -uo pipefail
PID=PRJ_DCM_BENCH_20261105
ROOT=/mnt/ssd/bio_data/projects/$PID
WRAP=/mnt/ssd/bio_data/ops/run_throttled_task.sh
LOGS=/mnt/ssd/bio_data/system_logs
cmd="${1:-}"
case "$cmd" in
submit)
  line="$2"; step="$3"; script="$4"; inputs="$5"; outputs="$6"; shift 6
  TID="${line%%_*}_${step}_$(date +%s)"
  # 适配脚本按 <line>/ 根目录写 processed/ 与 results/（母版是引擎 cd 进 processed 后写裸文件名，
  # 两种约定不同）：这里 cwd 默认 <line>/ 根，否则会写出 processed/processed/ 的嵌套路径。
  # 跑全局母版（normalize_hvg / integrate_harmony / cluster_umap 等）时置 RUN_CWD=processed
  # 复刻引擎的 cd 语义：母版在 processed/ 里读写裸文件名。
  if [ "${RUN_CWD:-}" = "processed" ]; then
    workdir="$ROOT/$line/processed"
  else
    workdir="$ROOT/$line"
  fi
  mkdir -p "$workdir/processed" "$workdir/results" "$workdir/figures" 2>/dev/null || true
  mkdir -p "$ROOT/$line/processed" "$ROOT/$line/results" "$ROOT/$line/figures"
  args=()
  IFS=',' read -ra INS <<< "$inputs"
  for p in "${INS[@]}"; do [ -n "$p" ] && args+=(--input "$p"); done
  IFS=',' read -ra OUTS <<< "$outputs"
  for p in "${OUTS[@]}"; do [ -n "$p" ] && args+=(--output "$p"); done
  for kv in "$@"; do export "$kv"; done
  export BIOANALYS_SEED=20261105
  export BIOANALYS_PROJECT_JSON=$ROOT/project.json
  cd "$workdir"
  nohup bash "$WRAP" "$TID" "$line" "$step" bash \
    "$ROOT/$line/scripts/$script" "${args[@]}" \
    > "/tmp/$TID.submit.log" 2>&1 &
  echo "TASK_ID=$TID"
  echo "workdir=$workdir"
  ;;
poll)
  TID="$2"; n="${3:-12}"
  L="$LOGS/$TID.log"
  J="$LOGS/${TID}_ledger.json"
  if [ -f "$J" ]; then
    echo "LEDGER_DONE"
    grep -o '"status": "[a-z]*"' "$J" | head -1
    grep -o '"exit_code": [0-9-]*' "$J" | head -1 || grep -o '"checkpoint_status": "[a-z]*"' "$J" | head -1
  elif [ -f "$LOGS/_running/$TID.json" ]; then
    echo "RUNNING"
  else
    echo "NOT_STARTED_OR_LOST"
  fi
  echo "--- step log tail ---"
  [ -f "$L" ] && tail -"$n" "$L" || tail -"$n" "/tmp/$TID.submit.log" 2>/dev/null || echo "(no log)"
  ;;
wait)
  TID="$2"; max="${3:-1800}"; i=0
  while [ "$i" -lt "$max" ]; do
    if [ -f "$LOGS/${TID}_ledger.json" ]; then
      echo "DONE after ${i}s"
      cat "$LOGS/${TID}_ledger.json"
      echo
      echo "--- step log tail ---"
      tail -20 "$LOGS/$TID.log" 2>/dev/null
      exit 0
    fi
    sleep 15; i=$((i + 15))
  done
  echo "STILL_RUNNING after ${max}s"
  tail -20 "$LOGS/$TID.log" 2>/dev/null
  exit 9
  ;;
*)
  echo "用法: submit|poll|wait ..." >&2; exit 2 ;;
esac