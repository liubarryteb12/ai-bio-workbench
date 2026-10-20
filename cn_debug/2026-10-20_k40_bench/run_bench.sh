#!/bin/bash
# run_bench.sh — 逐配置跑 R/Python 效率基准（阶段 0）
# 配置矩阵（con_hf/2026-10-20_k40_linux_adaptation_plan.md 阶段 0 B2）：
#   A:none:3   无绑核 + 3 线程   （bio_limits 登录态现状）
#   B:4,5,6:3  4,5,6  + 3 线程   （aims 契约现状）
#   C:4,6:2    4,6    + 2 线程
#   E:0-7:3    全核   + 3 线程   （对照）
#   G:none:4   无绑核 + 4 线程
#   H:6,7:2    大核+Prime + 2 线程（Prime 参与试探）
# v2：负载加大（R dgemm 1500^2x3 / py 3000^2x3），轮间 sleep 5 冷却
set -u
DIR=/root/bio_workbench/_bench
OUT="$DIR/bench_results.csv"
RAW="$DIR/bench_raw.log"
WATCH_DUR=${1:-420}

: > "$RAW"
echo "lang,tag,cpus,threads,round,wall_s" > "$OUT"
nohup bash "$DIR/watch_thermal.sh" "$WATCH_DUR" "$DIR/thermal.csv" >/dev/null 2>&1 &
WATCH_PID=$!
echo "watchdog pid=$WATCH_PID dur=${WATCH_DUR}s"

CONFIGS=(
  "A:none:3"
  "B:4,5,6:3"
  "C:4,6:2"
  "E:0-7:3"
  "G:none:4"
  "H:6,7:2"
)

run_lang() {
  local lang=$1
  local cfg tag cpus threads round line wall
  local -a envs
  for cfg in "${CONFIGS[@]}"; do
    IFS=: read -r tag cpus threads <<< "$cfg"
    for round in 1 2; do
      envs=(OMP_NUM_THREADS=$threads OPENBLAS_NUM_THREADS=$threads
            MKL_NUM_THREADS=$threads NUMEXPR_NUM_THREADS=$threads
            VECLIB_MAXIMUM_THREADS=$threads)
      if [ "$lang" = R ]; then
        if [ "$cpus" = none ]; then
          line=$(env "${envs[@]}" Rscript "$DIR/bench_r.R" --cpus none --threads "$threads" --tag "$tag" --round "$round" 2>&1)
        else
          line=$(taskset -c "$cpus" env "${envs[@]}" Rscript "$DIR/bench_r.R" --cpus "$cpus" --threads "$threads" --tag "$tag" --round "$round" 2>&1)
        fi
      else
        if [ "$cpus" = none ]; then
          line=$(env "${envs[@]}" python3 "$DIR/bench_py.py" --cpus none --threads "$threads" --tag "$tag" --round "$round" 2>&1)
        else
          line=$(taskset -c "$cpus" env "${envs[@]}" python3 "$DIR/bench_py.py" --cpus "$cpus" --threads "$threads" --tag "$tag" --round "$round" 2>&1)
        fi
      fi
      echo "$line" >> "$RAW"
      wall=$(printf '%s\n' "$line" | grep -o 'wall=[0-9.]*' | head -1 | cut -d= -f2)
      [ -z "$wall" ] && wall="ERR"
      echo "$lang,$tag,$cpus,$threads,$round,$wall"
      echo "$lang,$tag,$cpus,$threads,$round,$wall" >> "$OUT"
      sleep 5
    done
  done
}

run_lang R
run_lang Python
kill "$WATCH_PID" 2>/dev/null
echo "BENCH_DONE results=$OUT thermal=$DIR/thermal.csv"
