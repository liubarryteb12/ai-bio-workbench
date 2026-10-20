#!/bin/bash
# wait_idle_then_bench.sh — 等算力空闲后自动跑基准（避免与真实任务抢 CPU）
# 用法: bash wait_idle_then_bench.sh [max_wait_sec]
# 空闲判据：无 Rscript/python3 进程 CPU>20%，且 1min loadavg < 0.5；轮询 20s
set -u
DIR=/root/bio_workbench/_bench
MAX_WAIT=${1:-1200}
START=$(date +%s)
while true; do
  ELAPSED=$(( $(date +%s) - START ))
  if [ "$ELAPSED" -ge "$MAX_WAIT" ]; then
    echo "IDLE_TIMEOUT after ${ELAPSED}s — 算力持续被占用，基准未跑"
    exit 2
  fi
  heavy=$(ps -eo pcpu,comm | awk '$2 ~ /^(Rscript|python3)$/ && $1+0 > 20 {n++} END {print n+0}')
  load1=$(awk '{print $1}' /proc/loadavg 2>/dev/null)
  busy=$(awk -v l="$load1" 'BEGIN {print (l+0 > 0.5) ? 1 : 0}')
  echo "[$(date +%T)] heavy=$heavy load=$load1 elapsed=${ELAPSED}s"
  if [ "$heavy" = "0" ] && [ "$busy" = "0" ]; then
    echo "IDLE_DETECTED starting bench at $(date +%T)"
    sleep 5   # 让刚退出的任务余温散掉
    break
  fi
  sleep 20
done
bash "$DIR/run_bench.sh" 420
echo "WAIT_BENCH_ALL_DONE"
