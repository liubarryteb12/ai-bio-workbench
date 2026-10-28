#!/data/data/com.termux/files/usr/bin/bash
# Idempotent runner acceptance probes (D-11). Run on the phone.
set -uo pipefail

RUNNER="$HOME/bin/pi_idempotent_runner.sh"
PROJ="a2a_idem_probe"
D="$HOME/workspace/projects/$PROJ"
failures=0

report() {
  if [ "$2" = "$3" ]; then
    printf 'PASS %s\n' "$1"
  else
    printf 'FAIL %s expected=%s actual=%s\n' "$1" "$3" "$2"
    failures=$((failures + 1))
  fi
}

[ -x "$RUNNER" ] || { echo "FATAL runner missing"; exit 1; }
rm -rf "$D"; mkdir -p "$D"; cd "$D"
printf '#!/data/data/com.termux/files/usr/bin/bash\necho step_output\necho data > out.txt\n' > build.sh

OUT1="$(bash "$RUNNER" --project "$PROJ" --step s1 --script ./build.sh --outputs out.txt)"
report 'fresh_run' "$(printf '%s' "$OUT1" | jq -r .idempotent_status)" 'fresh_run'

START=$(date +%s%N)
OUT2="$(bash "$RUNNER" --project "$PROJ" --step s1 --script ./build.sh --outputs out.txt)"
END=$(date +%s%N)
MS=$(( (END - START) / 1000000 ))
report 'reused_status' "$(printf '%s' "$OUT2" | jq -r .idempotent_status)" 'reused_done_checkpoint'
if [ "$MS" -lt 500 ]; then
  echo "PASS reuse_latency ${MS}ms"
else
  echo "FAIL reuse_latency ${MS}ms >= 500ms"
  failures=$((failures + 1))
fi

rm -f .step_slow.done .step_slow.lock
printf '#!/data/data/com.termux/files/usr/bin/bash\nsleep 3\necho data > out.txt\n' > slow.sh
bash "$RUNNER" --project "$PROJ" --step slow --script ./slow.sh --outputs out.txt >/dev/null 2>&1 &
BGPID=$!
LOCK_SEEN=no
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if [ -f .step_slow.lock ]; then LOCK_SEEN=yes; break; fi
  sleep 0.1
done
if [ "$LOCK_SEEN" = yes ]; then
  echo "PASS lock_present"
else
  echo "FAIL lock_present"
  failures=$((failures + 1))
fi
wait "$BGPID"
[ -f .step_slow.done ] && echo "PASS done_after_run" || { echo "FAIL done_after_run"; failures=$((failures + 1)); }

SHA1="$(sha256sum build.sh | awk '{print $1}')"
[ -r build.sh ] && [ -w build.sh ] && WRITABLE=yes || WRITABLE=no
report 'script_readonly' 'no' "$WRITABLE"
echo "script_sha256=$SHA1"

if [ "$failures" -gt 0 ]; then
  echo "PI_IDEM_PROBE_FAIL failures=$failures"
  exit 1
fi
echo 'PI_IDEM_PROBE_OK'
