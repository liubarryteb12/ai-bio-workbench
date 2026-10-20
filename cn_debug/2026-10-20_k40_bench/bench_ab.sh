#!/bin/bash
# bench_ab.sh — A（不绑核+3线程） vs B（4,5,6+3线程，aims契约）交替验证
# 动机：首轮顺序跑存在温度顺序效应（A 先跑凉、B 后跑热），A 领先 47% 不能全归因绑核。
# 交替 3 轮让温度在两配置间均匀分布；并行温度监控。
set -u
DIR=/root/bio_workbench/_bench
OUT="$DIR/bench_ab.csv"
echo "round,order,cpus,threads,wall_s" > "$OUT"
nohup bash "$DIR/watch_thermal.sh" 240 "$DIR/thermal_ab.csv" >/dev/null 2>&1 &
WATCH_PID=$!

run_one() {
  local tag=$1 cpus=$2 round=$3
  local line wall
  local -a envs=(OMP_NUM_THREADS=3 OPENBLAS_NUM_THREADS=3
                 MKL_NUM_THREADS=3 NUMEXPR_NUM_THREADS=3 VECLIB_MAXIMUM_THREADS=3)
  if [ "$cpus" = none ]; then
    line=$(env "${envs[@]}" python3 "$DIR/bench_py.py" --cpus none --threads 3 --tag "$tag" --round "$round" 2>&1)
  else
    line=$(taskset -c "$cpus" env "${envs[@]}" python3 "$DIR/bench_py.py" --cpus "$cpus" --threads 3 --tag "$tag" --round "$round" 2>&1)
  fi
  echo "$line" >> "$DIR/bench_ab_raw.log"
  wall=$(printf '%s\n' "$line" | grep -o 'wall=[0-9.]*' | head -1 | cut -d= -f2)
  [ -z "$wall" ] && wall="ERR"
  echo "$round,$tag,$cpus,3,$wall"
  echo "$round,$tag,$cpus,3,$wall" >> "$OUT"
}

: > "$DIR/bench_ab_raw.log"
for round in 1 2 3; do
  run_one A none "$round"
  sleep 8
  run_one B 4,5,6 "$round"
  sleep 8
done
kill "$WATCH_PID" 2>/dev/null
echo "AB_DONE"
