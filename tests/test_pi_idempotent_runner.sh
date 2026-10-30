#!/data/data/com.termux/files/usr/bin/bash
# Idempotent runner acceptance probes (D-11). Run on the phone.
set -uo pipefail

RUNNER="${1:-$HOME/bin/pi_idempotent_runner.sh}"
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

expect_runner_error() {
  local name="$1"
  local expected="$2"
  shift 2
  local output
  output="$(bash "$RUNNER" "$@" 2>&1)" || true
  case "$output" in
    *"$expected"*) printf 'PASS %s\n' "$name" ;;
    *)
      printf 'FAIL %s expected=%s actual=%s\n' "$name" "$expected" "$output"
      failures=$((failures + 1))
      ;;
  esac
}

[ -x "$RUNNER" ] || { echo "FATAL runner missing"; exit 1; }
rm -rf "$D"; mkdir -p "$D"; cd "$D"
printf '#!/data/data/com.termux/files/usr/bin/bash\necho step_output\necho data > out.txt\n' > build.sh

expect_runner_error project_escape ERR_PATH_GUARD_PROJECT \
  --project ../escape_probe --step s1 --script ./build.sh --outputs out.txt
expect_runner_error step_escape ERR_PATH_GUARD_STEP \
  --project "$PROJ" --step ../escape --script ./build.sh --outputs out.txt
expect_runner_error script_escape ERR_PATH_GUARD_SCRIPT \
  --project "$PROJ" --step s1 --script /etc/passwd --outputs out.txt
expect_runner_error input_escape ERR_PATH_GUARD_INPUT \
  --project "$PROJ" --step s1 --script ./build.sh --inputs ../outside.tsv --outputs out.txt
expect_runner_error output_escape ERR_PATH_GUARD_OUTPUT \
  --project "$PROJ" --step s1 --script ./build.sh --outputs ../outside.txt

OUT1="$(bash "$RUNNER" --project "$PROJ" --step s1 --script ./build.sh --outputs out.txt)"
report 'fresh_run' "$(printf '%s' "$OUT1" | jq -r .idempotent_status)" 'fresh_run'
report 'changed_path_relative' "$(printf '%s' "$OUT1" | jq -r '.changed_files[0].path')" 'out.txt'
report 'fresh_preliminary_passed' "$(printf '%s' "$OUT1" | jq -r '.preliminary_acceptance.passed')" 'true'
report 'fresh_preliminary_checks' "$(printf '%s' "$OUT1" | jq -r '.preliminary_acceptance.checks | length >= 4')" 'true'

START=$(date +%s%N)
OUT2="$(bash "$RUNNER" --project "$PROJ" --step s1 --script ./build.sh --outputs out.txt)"
END=$(date +%s%N)
MS=$(( (END - START) / 1000000 ))
report 'reused_status' "$(printf '%s' "$OUT2" | jq -r .idempotent_status)" 'reused_done_checkpoint'
report 'reused_preliminary_passed' "$(printf '%s' "$OUT2" | jq -r '.preliminary_acceptance.passed')" 'true'
if [ "$MS" -lt 500 ]; then
  echo "PASS reuse_latency ${MS}ms"
else
  echo "FAIL reuse_latency ${MS}ms >= 500ms"
  failures=$((failures + 1))
fi

printf 'tampered\n' > out.txt
OUT3="$(bash "$RUNNER" --project "$PROJ" --step s1 --script ./build.sh --outputs out.txt)"
report 'tampered_output_forces_rerun' "$(printf '%s' "$OUT3" | jq -r .idempotent_status)" 'fresh_run'
report 'tampered_output_restored' "$(cat out.txt)" 'data'

mkdir -p .step_initrace.lock.d
printf 'sentinel\n' > .step_initrace.lock.d/initializing
printf '#!/data/data/com.termux/files/usr/bin/bash\nsleep 1\necho data > initrace.txt\n' > initrace.sh
bash "$RUNNER" --project "$PROJ" --step initrace --script ./initrace.sh --outputs initrace.txt >/dev/null 2>&1 &
INITRACE_PID=$!
sleep 0.2
if [ -f .step_initrace.lock.d/initializing ]; then
  echo 'PASS fresh_empty_lock_preserved'
else
  echo 'FAIL fresh_empty_lock_preserved'
  failures=$((failures + 1))
fi
wait "$INITRACE_PID"
report 'fresh_empty_lock_recovers' "$(cat initrace.txt)" 'data'

rm -rf .step_slow.done .step_slow.lock.d
printf '#!/data/data/com.termux/files/usr/bin/bash\nsleep 3\necho data > out.txt\n' > slow.sh
bash "$RUNNER" --project "$PROJ" --step slow --script ./slow.sh --outputs out.txt >/dev/null 2>&1 &
BGPID=$!
LOCK_SEEN=no
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if [ -d .step_slow.lock.d ]; then LOCK_SEEN=yes; break; fi
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

rm -rf .step_termguard.done .step_termguard.lock.d term-child.pid term-output.txt
printf '#!/data/data/com.termux/files/usr/bin/bash\necho $$ > term-child.pid\nsleep 30\necho late > term-output.txt\n' > termguard.sh
bash "$RUNNER" --project "$PROJ" --step termguard --script ./termguard.sh --outputs term-output.txt >/dev/null 2>&1 &
TERM_RUNNER_PID=$!
TERM_CHILD_PID=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if [ -s term-child.pid ]; then
    TERM_CHILD_PID="$(cat term-child.pid)"
    break
  fi
  sleep 0.1
done
if [ -n "$TERM_CHILD_PID" ]; then
  kill -TERM "$TERM_RUNNER_PID" 2>/dev/null || true
  wait "$TERM_RUNNER_PID" 2>/dev/null || true
  sleep 0.3
  if kill -0 "$TERM_CHILD_PID" 2>/dev/null; then
    echo "FAIL term_reaps_child child_pid=$TERM_CHILD_PID"
    failures=$((failures + 1))
    kill -TERM -- "-$TERM_CHILD_PID" 2>/dev/null || kill -TERM "$TERM_CHILD_PID" 2>/dev/null || true
  else
    echo 'PASS term_reaps_child'
  fi
  if [ ! -d .step_termguard.lock.d ]; then
    echo 'PASS term_releases_lock'
  else
    echo 'FAIL term_releases_lock'
    failures=$((failures + 1))
  fi
else
  echo 'FAIL term_child_started'
  failures=$((failures + 1))
  kill -TERM "$TERM_RUNNER_PID" 2>/dev/null || true
  wait "$TERM_RUNNER_PID" 2>/dev/null || true
fi

rm -rf .step_killguard.done .step_killguard.lock.d kill-count.txt kill-result.txt
printf '#!/data/data/com.termux/files/usr/bin/bash\ncount=$(cat kill-count.txt 2>/dev/null || echo 0)\necho $((count + 1)) > kill-count.txt\nsleep 2\necho data > kill-result.txt\n' > killguard.sh
bash "$RUNNER" --project "$PROJ" --step killguard --script ./killguard.sh --outputs kill-result.txt >/dev/null 2>&1 &
KILL_RUNNER_PID=$!
KILL_CHILD_PID=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if [ -f .step_killguard.lock.d/owner.json ]; then
    KILL_CHILD_PID="$(jq -r '.child_pid // ""' .step_killguard.lock.d/owner.json 2>/dev/null || true)"
    [ -n "$KILL_CHILD_PID" ] && break
  fi
  sleep 0.1
done
if [ -n "$KILL_CHILD_PID" ]; then
  kill -KILL "$KILL_RUNNER_PID" 2>/dev/null || true
  wait "$KILL_RUNNER_PID" 2>/dev/null || true
  KILL_ATTACH_OUT="$(bash "$RUNNER" --project "$PROJ" --step killguard --script ./killguard.sh --outputs kill-result.txt 2>/dev/null || true)"
  report 'sigkill_runner_attaches_child' "$(printf '%s' "$KILL_ATTACH_OUT" | jq -r '.idempotent_status // ""' 2>/dev/null || true)" 'attached_running_lock'
  report 'sigkill_runner_single_execution' "$(cat kill-count.txt 2>/dev/null || echo 0)" '1'
else
  echo 'FAIL sigkill_child_started'
  failures=$((failures + 1))
  kill -KILL "$KILL_RUNNER_PID" 2>/dev/null || true
  wait "$KILL_RUNNER_PID" 2>/dev/null || true
fi

rm -rf .step_pngbad.done .step_pngbad.lock.d .step_pnggood.done .step_pnggood.lock.d truncated.png valid.png
printf '#!/data/data/com.termux/files/usr/bin/bash\nprintf "\\211PNG\\r\\n\\032\\n0000" > truncated.png\n' > pngbad.sh
PNG_BAD_OUT="$(bash "$RUNNER" --project "$PROJ" --step pngbad --script ./pngbad.sh --outputs truncated.png 2>/dev/null || true)"
report 'truncated_png_exit' "$(printf '%s' "$PNG_BAD_OUT" | jq -r '.exit_code // ""')" '6'
report 'truncated_png_preliminary_passed' "$(printf '%s' "$PNG_BAD_OUT" | jq -r '.preliminary_acceptance.passed')" 'false'
[ ! -f .step_pngbad.done ] && echo 'PASS truncated_png_no_done' || { echo 'FAIL truncated_png_no_done'; failures=$((failures + 1)); }
printf '#!/data/data/com.termux/files/usr/bin/bash\nprintf "\\211PNG\\r\\n\\032\\n\\000\\000\\000\\000IEND\\256B\\140\\202" > valid.png\n' > pnggood.sh
PNG_GOOD_OUT="$(bash "$RUNNER" --project "$PROJ" --step pnggood --script ./pnggood.sh --outputs valid.png 2>/dev/null || true)"
report 'valid_png_exit' "$(printf '%s' "$PNG_GOOD_OUT" | jq -r '.exit_code // ""')" '0'

rm -rf .step_utf8.done .step_utf8.lock.d
printf '#!/data/data/com.termux/files/usr/bin/bash\nprintf "中%%.0s" {1..400}\necho\n' > utf8.sh
UTF8_OUT="$(bash "$RUNNER" --project "$PROJ" --step utf8 --script ./utf8.sh --outputs out.txt 2>/dev/null || true)"
UTF8_LEN="$(printf '%s' "$UTF8_OUT" | jq -r '.stdout_summary | length' 2>/dev/null || echo invalid)"
report 'utf8_summary_length' "$UTF8_LEN" '320'

SHA1="$(sha256sum build.sh | awk '{print $1}')"
[ -r build.sh ] && [ -w build.sh ] && WRITABLE=yes || WRITABLE=no
report 'script_readonly' 'no' "$WRITABLE"
echo "script_sha256=$SHA1"

if [ "$failures" -gt 0 ]; then
  echo "PI_IDEM_PROBE_FAIL failures=$failures"
  exit 1
fi
echo 'PI_IDEM_PROBE_OK'
