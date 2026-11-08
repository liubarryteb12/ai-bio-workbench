#!/bin/bash
# reconcile 探针真实链路验证：不用 mock，真 SSH + 真 base64 stdin + 真哨兵解析
set -euo pipefail

SYSTEM_LOGS=/mnt/ssd/bio_data/system_logs
SENTINEL=RECONCILE_END
TASK_ID=probe_realtest_$(date -u +%Y%m%dT%H%M%SZ)
MARKER_PATH="$SYSTEM_LOGS/_running/${TASK_ID}.json"
EXISTING_FILE=/mnt/ssd/bio_data/projects/default/line2_scrna/processed/annotate_report.txt
MISSING_FILE=/mnt/ssd/bio_data/projects/default/line2_scrna/processed/definitely_not_here_xyz.tsv

echo "=== case1: 无标记 + 产物全存在 ==="
printf '%s\0' "$EXISTING_FILE" | base64 -w0 > /tmp/c1.b64
CMD1="if [ -f '$MARKER_PATH' ]; then printf 'RUNNING\n'; else printf 'NOT_RUNNING\n'; fi; base64 -d | while IFS= read -r -d '' path; do if [ -e \"\$path\" ]; then printf 'PRESENT\n'; else printf 'MISSING\n'; fi; done; printf '$SENTINEL\n'"
OUT1=$(echo "not_used" >/dev/null; ssh -o BatchMode=yes -o ConnectTimeout=10 k40-ubuntu "$CMD1" < /tmp/c1.b64)
echo "$OUT1"

echo "=== case2: 无标记 + 产物缺失 ==="
printf '%s\0' "$MISSING_FILE" | base64 -w0 > /tmp/c2.b64
OUT2=$(ssh -o BatchMode=yes -o ConnectTimeout=10 k40-ubuntu "$CMD1" < /tmp/c2.b64)
echo "$OUT2"

echo "=== case3: 造标记 + 产物全存在 ==="
mkdir -p "$SYSTEM_LOGS/_running"
cat > "$MARKER_PATH" <<EOF
{"task_id": "$TASK_ID", "status": "running", "note": "reconcile real link test"}
EOF
OUT3=$(ssh -o BatchMode=yes -o ConnectTimeout=10 k40-ubuntu "$CMD1" < /tmp/c1.b64)
echo "$OUT3"
echo "marker_created=$MARKER_PATH"

echo "=== case4: 清理标记后复测 ==="
rm -f "$MARKER_PATH"
OUT4=$(ssh -o BatchMode=yes -o ConnectTimeout=10 k40-ubuntu "$CMD1" < /tmp/c1.b64)
echo "$OUT4"

echo "=== case5: 空产物列表 ==="
: | base64 -w0 > /tmp/c5.b64
OUT5=$(ssh -o BatchMode=yes -o ConnectTimeout=10 k40-ubuntu "$CMD1" < /tmp/c5.b64)
echo "$OUT5"

echo "=== verdict ==="
check() { if [ "$1" = "$2" ]; then echo "PASS $3"; else echo "FAIL $3: got [$1] want [$2]"; fi; }
check "$(echo "$OUT1" | head -1)" "NOT_RUNNING" "case1_marker_signal"
check "$(echo "$OUT1" | sed -n '2p')" "PRESENT" "case1_present_signal"
check "$(echo "$OUT1" | tail -1)" "$SENTINEL" "case1_sentinel"
check "$(echo "$OUT2" | sed -n '2p')" "MISSING" "case2_missing_signal"
check "$(echo "$OUT3" | head -1)" "RUNNING" "case3_running_signal"
check "$(echo "$OUT4" | head -1)" "NOT_RUNNING" "case4_after_cleanup"
check "$(echo "$OUT5" | wc -l | tr -d ' ')" "2" "case5_empty_list_lines"
rm -f /tmp/c1.b64 /tmp/c2.b64 /tmp/c5.b64
