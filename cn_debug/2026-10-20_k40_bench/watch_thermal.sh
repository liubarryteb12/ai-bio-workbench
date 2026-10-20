#!/bin/bash
# watch_thermal.sh v2 <duration_sec> <out_csv>
# 每 3s 采样：全 thermal_zone 最高温 + zone 名、load1、Rscript/python3 的 CPU 分布直方图
DUR=${1:-420}
OUT=${2:-/root/bio_workbench/_bench/thermal.csv}
END=$(( $(date +%s) + DUR ))
echo "ts,tmax_milli,tmax_zone,load1,psr_hist" > "$OUT"
while [ "$(date +%s)" -lt "$END" ]; do
  ts=$(date +%s)
  tmax=0; tzone=""
  for z in /sys/class/thermal/thermal_zone*/temp; do
    v=$(cat "$z" 2>/dev/null || echo 0)
    [ -z "$v" ] && v=0
    if [ "$v" -gt "$tmax" ]; then tmax=$v; tzone=$(cat "${z%temp}type" 2>/dev/null); fi
  done
  hist=$(ps -eo psr,comm 2>/dev/null | awk '$2 ~ /^(Rscript|python3)$/ {c[$1]++} END {for (k in c) printf "c%s:%d ", k, c[k]}')
  load=$(awk '{print $1}' /proc/loadavg 2>/dev/null)
  echo "$ts,$tmax,$tzone,$load,$hist" >> "$OUT"
  sleep 3
done
