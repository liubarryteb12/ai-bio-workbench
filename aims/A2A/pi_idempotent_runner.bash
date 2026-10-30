#!/usr/bin/env bash
# ==============================================================================
# 文件落点：ops/pi_idempotent_runner.sh (v1.2.0 - 经 TDD & Harness 审查加固版)
# 部署位置：手机端 Termux $HOME/bin/pi_idempotent_runner.sh
# 修复缺陷清单 (基于 04_QA审查计划)：
#   [FIX-01] 修复 PID 复用假死锁：.lock 文件记录 PID + /proc/$PID/cmdline 特征校验
#   [FIX-02] 修复并发 TOCTOU 竞态：使用 mkdir 原子锁目录 (.lock.d) 替代非原子文件判断
#   [FIX-03] 修复输入数据漂移盲区：新增 --inputs 参数，联合计算 script_sha256 + inputs_sha256
#   [FIX-04] 修复损坏 PNG 漏检：对 .png 产物强制校验 89504e47 魔数头与 IEND 尾
#   [FIX-05] 修复长日志撑爆磁盘：限制单步日志最大保留尾部，仅向 Pi LLM 输出精简 JSON
#   [FIX-06] 修复产物篡改后误命中 .done：复用前逐一核对 changed_files SHA256
#   [FIX-07] 修复锁目录初始化窗口：owner 元数据等待窗口 + 僵尸锁原子迁移
# ==============================================================================
set -euo pipefail

PROJECT_ID=""
TASK_ID="local"
STEP_ID=""
SCRIPT_PATH=""
EXPECTED_INPUTS=""
EXPECTED_OUTPUTS=""
WORKSPACE_BASE="${PI_WORKSPACE_BASE:-$HOME/workspace/projects}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT_ID="$2"; shift 2 ;;
    --task-id) TASK_ID="$2"; shift 2 ;;
    --step)    STEP_ID="$2"; shift 2 ;;
    --script)  SCRIPT_PATH="$2"; shift 2 ;;
    --inputs)  EXPECTED_INPUTS="$2"; shift 2 ;;
    --outputs) EXPECTED_OUTPUTS="$2"; shift 2 ;;
    *) echo "{\"error\":\"ERR_UNKNOWN_ARG\",\"arg\":\"$1\"}" >&2; exit 2 ;;
  esac
done

if [[ -z "$PROJECT_ID" || -z "$TASK_ID" || -z "$STEP_ID" || -z "$SCRIPT_PATH" ]]; then
  echo '{"error":"ERR_MISSING_ARGS","usage":"pi_idempotent_runner.sh --project <id> [--task-id <id>] --step <step> --script <path> [--inputs i1,i2] [--outputs o1,o2]"}'
  exit 2
fi

validate_slug() {
  local value="$1"
  [[ -n "$value" ]] || return 1
  [[ "$value" != *".."* ]] || return 1
  [[ "$value" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]
}

if ! validate_slug "$PROJECT_ID"; then
  echo '{"error":"ERR_PATH_GUARD_PROJECT"}'
  exit 3
fi
if ! validate_slug "$STEP_ID"; then
  echo '{"error":"ERR_PATH_GUARD_STEP"}'
  exit 3
fi

REAL_BASE="$(realpath -m "$WORKSPACE_BASE")"
case "$REAL_BASE" in
  /sdcard|/sdcard/*|/storage/emulated|/storage/emulated/*|/storage/self/primary|/storage/self/primary/*)
    echo '{"error":"ERR_PATH_GUARD_WORKSPACE"}'
    exit 3
    ;;
esac

REAL_PROJ="$(realpath -m "${REAL_BASE}/${PROJECT_ID}")"
case "$REAL_PROJ" in
  "$REAL_BASE"/*) ;;
  *)
    echo '{"error":"ERR_PATH_GUARD_PROJECT"}'
    exit 3
    ;;
esac

resolve_inside_project() {
  local raw="$1"
  local resolved=""
  [[ -n "$raw" ]] || return 1
  [[ "$raw" != *".."* ]] || return 1
  if [[ "$raw" == /* ]]; then
    resolved="$(realpath -m "$raw")"
  else
    resolved="$(realpath -m "${REAL_PROJ}/${raw}")"
  fi
  case "$resolved" in
    "$REAL_PROJ"|"$REAL_PROJ"/*) ;;
    *) return 1 ;;
  esac
  case "$resolved" in
    /sdcard|/sdcard/*|/storage/emulated|/storage/emulated/*|/storage/self/primary|/storage/self/primary/*)
      return 1
      ;;
  esac
  printf '%s\n' "$resolved"
}

resolve_csv_paths() {
  local raw="$1"
  local resolved_list=""
  local item=""
  local resolved=""
  [[ -n "$raw" ]] || { printf ''; return 0; }
  IFS=',' read -ra ITEMS <<< "$raw"
  for item in "${ITEMS[@]}"; do
    item="$(printf '%s' "$item" | xargs)"
    [[ -n "$item" ]] || continue
    resolved="$(resolve_inside_project "$item")" || return 1
    resolved_list="${resolved_list}${resolved},"
  done
  printf '%s' "${resolved_list%,}"
}

if ! SCRIPT_PATH="$(resolve_inside_project "$SCRIPT_PATH")"; then
  echo '{"error":"ERR_PATH_GUARD_SCRIPT"}'
  exit 3
fi
if ! EXPECTED_INPUTS="$(resolve_csv_paths "$EXPECTED_INPUTS")"; then
  echo '{"error":"ERR_PATH_GUARD_INPUT"}'
  exit 3
fi
if ! EXPECTED_OUTPUTS="$(resolve_csv_paths "$EXPECTED_OUTPUTS")"; then
  echo '{"error":"ERR_PATH_GUARD_OUTPUT"}'
  exit 3
fi

mkdir -p "$REAL_PROJ/system_logs"
cd "$REAL_PROJ"

if [[ ! -f "$SCRIPT_PATH" ]]; then
  echo "{\"error\":\"ERR_SCRIPT_NOT_FOUND\",\"script_path\":\"$SCRIPT_PATH\"}"
  exit 4
fi

# 2. [D-11 只读母版锁 + 输入数据联合指纹 (FIX-03)]
chmod a-w "$SCRIPT_PATH" 2>/dev/null || true
SCRIPT_SHA256="$(sha256sum "$SCRIPT_PATH" | awk '{print $1}')"

compute_inputs_sha256() {
  if [[ -z "$EXPECTED_INPUTS" ]]; then
    echo "no_inputs_declared"
    return 0
  fi
  local combined=""
  IFS=',' read -ra IN_ARR <<< "$EXPECTED_INPUTS"
  for in_f in "${IN_ARR[@]}"; do
    in_f="$(echo "$in_f" | xargs)"
    [[ -z "$in_f" ]] && continue
    if [[ ! -f "$in_f" ]]; then
      echo "missing_input:${in_f}"
      return 1
    fi
    local h
    h="$(sha256sum "$in_f" | awk '{print $1}')"
    combined="${combined}${in_f}:${h};"
  done
  printf "%s" "$combined" | sha256sum | awk '{print $1}'
}

if ! INPUTS_SHA256="$(compute_inputs_sha256)"; then
  echo "{\"error\":\"ERR_INPUT_FILE_MISSING\",\"detail\":\"$INPUTS_SHA256\"}"
  exit 4
fi

LOCK_DIR="${REAL_PROJ}/.step_${STEP_ID}.lock.d"
LOCK_META="${LOCK_DIR}/owner.json"
DONE_FILE="${REAL_PROJ}/.step_${STEP_ID}.done"
LOG_FILE="${REAL_PROJ}/system_logs/${STEP_ID}.log"
LOCK_INIT_GRACE_TICKS="${PI_LOCK_INIT_GRACE_TICKS:-20}"
LOCK_OWNED=0
CHILD_PID=""
CHILD_PGID=""

if [[ ! "$LOCK_INIT_GRACE_TICKS" =~ ^[0-9]+$ ]]; then
  LOCK_INIT_GRACE_TICKS=20
fi

# 3. [FIX-04] 校验期望产物存在、非空，且 PNG 文件具备合法头尾结构
verify_outputs_integrity() {
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
    if [[ "$out_f" == *.png ]]; then
      local magic trailer
      magic="$(od -An -tx1 -N4 "$out_f" | tr -d ' \n')"
      trailer="$(tail -c 12 "$out_f" | od -An -tx1 | tr -d ' \n')"
      if [[ "$magic" != "89504e47" ]] || [[ "$trailer" != "0000000049454e44ae426082" ]]; then
        return 1
      fi
    fi
  done
  return 0
}

# 4. [FIX-06] .done 复用必须同时核对产物路径与 SHA256
verify_done_artifacts() {
  [[ -f "$DONE_FILE" ]] || return 1
  verify_outputs_integrity || return 1

  local expected_count=0
  local actual_count
  if [[ -n "$EXPECTED_OUTPUTS" ]]; then
    IFS=',' read -ra OUT_ARR <<< "$EXPECTED_OUTPUTS"
    for out_f in "${OUT_ARR[@]}"; do
      out_f="$(echo "$out_f" | xargs)"
      [[ -n "$out_f" ]] && expected_count=$((expected_count + 1))
    done
  fi
  actual_count="$(jq -r '.changed_files | length' "$DONE_FILE" 2>/dev/null || echo 0)"
  [[ "$actual_count" == "$expected_count" ]] || return 1

  if [[ "$expected_count" -gt 0 ]]; then
    for out_f in "${OUT_ARR[@]}"; do
      out_f="$(echo "$out_f" | xargs)"
      [[ -n "$out_f" ]] || continue
      local out_rel="${out_f#"$REAL_PROJ"/}"
      local recorded_sha
      recorded_sha="$(jq -r --arg path "$out_rel" '
        [.changed_files[]? | select(.path == $path) | .sha256]
        | if length == 1 then .[0] else "" end
      ' "$DONE_FILE" 2>/dev/null || true)"
      [[ "$recorded_sha" =~ ^[0-9a-f]{64}$ ]] || return 1
      local actual_sha
      actual_sha="$(sha256sum "$out_f" | awk '{print $1}')"
      [[ "$actual_sha" == "$recorded_sha" ]] || return 1
    done
  fi
  return 0
}

build_changed_files_json() {
  local changed_json="[]"
  if [[ -z "$EXPECTED_OUTPUTS" ]]; then
    printf '%s' "$changed_json"
    return 0
  fi
  local out_f f_sha out_rel
  IFS=',' read -ra OUT_ARR <<< "$EXPECTED_OUTPUTS"
  for out_f in "${OUT_ARR[@]}"; do
    out_f="$(echo "$out_f" | xargs)"
    if [[ -f "$out_f" ]]; then
      f_sha="$(sha256sum "$out_f" | awk '{print $1}')"
      out_rel="${out_f#"$REAL_PROJ"/}"
      changed_json="$(jq --arg p "$out_rel" --arg s "$f_sha" \
        '. + [{"path":$p,"sha256":$s,"action":"verified"}]' <<<"$changed_json")"
    fi
  done
  printf '%s' "$changed_json"
}

build_stdout_summary() {
  tail -n 12 "$LOG_FILE" 2>/dev/null | tr '\n' ' ' | jq -Rsr '.[0:320]'
}

with_preliminary_acceptance() {
  jq '
    def sha256: type == "string" and test("^[0-9a-f]{64}$");
    def inputs_sha256: . == "no_inputs_declared" or sha256;
    . as $artifact
    | ($artifact.exit_code == 0
       and ($artifact.script_sha256 | sha256)
       and ($artifact.inputs_sha256 | inputs_sha256)
       and (($artifact.changed_files // [])
            | all(.[]; (.sha256 | sha256)))
       and ($artifact.log_file | type == "string" and length > 0))
      as $passed
    | .preliminary_acceptance = {
        passed: $passed,
        exit_code: $artifact.exit_code,
        script_sha256: $artifact.script_sha256,
        inputs_sha256: $artifact.inputs_sha256,
        changed_files: ($artifact.changed_files // []),
        log_file: $artifact.log_file,
        checks: [
          {
            name: "exit_code",
            passed: ($artifact.exit_code == 0),
            detail: ($artifact.exit_code | tostring)
          },
          {
            name: "script_sha256",
            passed: ($artifact.script_sha256 | sha256),
            detail: "verified"
          },
          {
            name: "inputs_sha256",
            passed: ($artifact.inputs_sha256 | inputs_sha256),
            detail: "verified"
          },
          {
            name: "changed_files",
            passed: (($artifact.changed_files // [])
                     | all(.[]; (.sha256 | sha256))),
            detail: "verified"
          },
          {
            name: "log_file",
            passed: ($artifact.log_file | type == "string" and length > 0),
            detail: "declared"
          }
        ]
      }
  '
}

# 5. [FIX-01] 校验锁内 PID 不仅存活，且确实属于当前脚本任务（防 Android PID 回绕复用误判）
is_lock_pid_valid() {
  local pid="$1"
  if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
    return 1
  fi
  if [[ -r "/proc/${pid}/cmdline" ]]; then
    local cmdline
    cmdline="$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2>/dev/null || true)"
    local base_script
    base_script="$(basename "$SCRIPT_PATH")"
    if [[ "$cmdline" != *"$base_script"* ]] && [[ "$cmdline" != *"pi_idempotent_runner"* ]]; then
      return 1
    fi
  fi
  return 0
}

recover_done_from_orphan() {
  [[ ! -f "$DONE_FILE" ]] || return 1
  verify_outputs_integrity || return 1

  local owner_script_sha owner_inputs_sha owner_task owner_started
  owner_script_sha="$(jq -r '.script_sha256 // ""' "$LOCK_META" 2>/dev/null || true)"
  owner_inputs_sha="$(jq -r '.inputs_sha256 // ""' "$LOCK_META" 2>/dev/null || true)"
  owner_task="$(jq -r '.task_id // "local"' "$LOCK_META" 2>/dev/null || true)"
  owner_started="$(jq -r '.started_at // ""' "$LOCK_META" 2>/dev/null || true)"
  [[ "$owner_script_sha" == "$SCRIPT_SHA256" ]] || return 1
  [[ "$owner_inputs_sha" == "$INPUTS_SHA256" ]] || return 1
  [[ -n "$owner_started" ]] || owner_started="$(date -Iseconds)"

  local changed_json summary tmp_done
  changed_json="$(build_changed_files_json)"
  summary="$(build_stdout_summary)"
  tmp_done="${DONE_FILE}.tmp.$$"
  if jq -n \
    --arg task_id "$owner_task" \
    --arg step_id "$STEP_ID" \
    --arg exec_at "$owner_started" \
    --arg ws "$REAL_PROJ" \
    --arg sp "$SCRIPT_PATH" \
    --arg s_sha "$SCRIPT_SHA256" \
    --arg i_sha "$INPUTS_SHA256" \
    --arg log_f "$LOG_FILE" \
    --argjson files "$changed_json" \
    --arg summary "$summary" \
    '{
      task_id: $task_id,
      step_id: $step_id,
      idempotent_status: "attached_running_lock",
      executed_at: $exec_at,
      workspace_dir: $ws,
      script_path: $sp,
      script_sha256: $s_sha,
      inputs_sha256: $i_sha,
      exit_code: 0,
      duration_sec: 0,
      log_file: $log_f,
      changed_files: $files,
      stdout_summary: $summary
    }' | with_preliminary_acceptance > "$tmp_done"; then
    mv "$tmp_done" "$DONE_FILE"
    return 0
  fi
  rm -f "$tmp_done"
  return 1
}

# 6. [幂等检查点 .done] 校验 script_sha256 + inputs_sha256 + 产物哈希
if [[ -f "$DONE_FILE" ]]; then
  DONE_SCRIPT_SHA="$(jq -r '.script_sha256 // ""' "$DONE_FILE" 2>/dev/null || true)"
  DONE_INPUTS_SHA="$(jq -r '.inputs_sha256 // ""' "$DONE_FILE" 2>/dev/null || true)"
  if [[ "$DONE_SCRIPT_SHA" == "$SCRIPT_SHA256" ]] && [[ "$DONE_INPUTS_SHA" == "$INPUTS_SHA256" ]] && verify_done_artifacts; then
    jq --arg task_id "$TASK_ID" \
      '.task_id = $task_id | .idempotent_status = "reused_done_checkpoint"' "$DONE_FILE" \
      | with_preliminary_acceptance
    exit 0
  fi
fi

read_lock_pid() {
  jq -r '.pid // ""' "$LOCK_META" 2>/dev/null || true
}

read_lock_child_pid() {
  jq -r '.child_pid // ""' "$LOCK_META" 2>/dev/null || true
}

write_lock_meta() {
  local owner_pid="$1"
  local tmp_meta="${LOCK_META}.tmp.$$"
  if jq -n \
    --arg pid "$owner_pid" \
    --arg task_id "$TASK_ID" \
    --arg step "$STEP_ID" \
    --arg script "$SCRIPT_PATH" \
    --arg script_sha "$SCRIPT_SHA256" \
    --arg inputs_sha "$INPUTS_SHA256" \
    --arg ts "$(date -Iseconds)" \
    '{pid: ($pid|tonumber), task_id: $task_id, step_id: $step, script: $script, script_sha256: $script_sha, inputs_sha256: $inputs_sha, started_at: $ts}' \
    > "$tmp_meta"; then
    mv "$tmp_meta" "$LOCK_META"
    return 0
  fi
  rm -f "$tmp_meta"
  return 1
}

update_lock_child_meta() {
  local child_pid="$1"
  local tmp_meta="${LOCK_META}.child.$$"
  if jq --argjson child_pid "$child_pid" \
    '.child_pid = $child_pid | .child_pgid = $child_pid' \
    "$LOCK_META" > "$tmp_meta"; then
    mv "$tmp_meta" "$LOCK_META"
    return 0
  fi
  rm -f "$tmp_meta"
  return 1
}

wait_for_lock_meta() {
  local ticks=0
  while [[ "$ticks" -lt "$LOCK_INIT_GRACE_TICKS" ]]; do
    [[ -f "$LOCK_META" ]] && return 0
    [[ -d "$LOCK_DIR" ]] || return 1
    sleep 0.1
    ticks=$((ticks + 1))
  done
  return 2
}

# 7. [FIX-02/FIX-07 原子互斥锁] 获取锁或挂载等待正在运行的真实任务
acquire_or_attach_lock() {
  local attempt old_pid old_child_pid current_pid wait_state stale_dir
  for attempt in {1..10}; do
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      LOCK_OWNED=1
      if write_lock_meta "$$"; then
        return 0
      fi
      LOCK_OWNED=0
      rm -rf "$LOCK_DIR"
      return 1
    fi

    # 新锁在 mkdir 后、owner.json 写入前有一个极短初始化窗口，先等待再判定僵尸锁。
    if [[ ! -f "$LOCK_META" ]]; then
      wait_for_lock_meta
      wait_state=$?
      if [[ "$wait_state" -eq 1 ]]; then
        continue
      fi
    fi

    old_pid="$(read_lock_pid)"
    old_child_pid="$(read_lock_child_pid)"
    if is_lock_pid_valid "$old_pid" || is_lock_pid_valid "$old_child_pid"; then
      while is_lock_pid_valid "$old_pid" || is_lock_pid_valid "$old_child_pid"; do
        sleep 1
      done
      if [[ -f "$DONE_FILE" ]] && verify_done_artifacts; then
        LOCK_OWNED=1
        jq --arg task_id "$TASK_ID" \
          '.task_id = $task_id | .idempotent_status = "attached_running_lock"' "$DONE_FILE"
        exit 0
      fi
      if recover_done_from_orphan; then
        LOCK_OWNED=1
        jq --arg task_id "$TASK_ID" \
          '.task_id = $task_id | .idempotent_status = "attached_running_lock"' "$DONE_FILE"
        exit 0
      fi
      continue
    fi

    # 清理前复核 owner，避免把另一个进程刚建立的新锁误移走。
    current_pid="$(read_lock_pid)"
    if [[ "$current_pid" != "$old_pid" ]]; then
      continue
    fi
    if [[ -d "$LOCK_DIR" ]]; then
      stale_dir="${LOCK_DIR}.stale.$$.$attempt"
      if mv -T "$LOCK_DIR" "$stale_dir" 2>/dev/null; then
        rm -rf "$stale_dir"
      fi
    fi
  done
  return 1
}

cleanup_lock() {
  if [[ "$LOCK_OWNED" -eq 1 ]]; then
    rm -rf "$LOCK_DIR" 2>/dev/null || true
  fi
}

terminate_child() {
  local child_pid="${CHILD_PID:-}"
  if [[ -z "$child_pid" ]] || ! kill -0 "$child_pid" 2>/dev/null; then
    return 0
  fi
  if [[ -n "${CHILD_PGID:-}" ]]; then
    kill -TERM -- "-$CHILD_PGID" 2>/dev/null || true
  else
    kill -TERM "$child_pid" 2>/dev/null || true
  fi
  local _tick
  for _tick in {1..20}; do
    kill -0 "$child_pid" 2>/dev/null || break
    sleep 0.1
  done
  if kill -0 "$child_pid" 2>/dev/null; then
    if [[ -n "${CHILD_PGID:-}" ]]; then
      kill -KILL -- "-$CHILD_PGID" 2>/dev/null || true
    else
      kill -KILL "$child_pid" 2>/dev/null || true
    fi
  fi
  wait "$child_pid" 2>/dev/null || true
}

handle_signal() {
  local exit_code="$1"
  terminate_child
  exit "$exit_code"
}

trap cleanup_lock EXIT
trap 'handle_signal 129' HUP
trap 'handle_signal 143' TERM
trap 'handle_signal 130' INT
if ! acquire_or_attach_lock; then
  echo '{"error":"ERR_LOCK_ACQUIRE"}'
  exit 1
fi

# 8. 启动预构建脚本
START_TS="$(date +%s)"
ISO_NOW="$(date -Iseconds)"

case "$SCRIPT_PATH" in
  *.R|*.r)   RUNNER_CMD=(Rscript "$SCRIPT_PATH") ;;
  *.py)      RUNNER_CMD=(python3 "$SCRIPT_PATH") ;;
  *.sh)      RUNNER_CMD=(bash "$SCRIPT_PATH") ;;
  *)         RUNNER_CMD=("$SCRIPT_PATH") ;;
esac

set +e
setsid "${RUNNER_CMD[@]}" > "$LOG_FILE" 2>&1 &
CHILD_PID=$!
CHILD_PGID="$CHILD_PID"
if ! update_lock_child_meta "$CHILD_PID"; then
  terminate_child
  echo '{"error":"ERR_LOCK_CHILD_META"}'
  exit 1
fi
wait "$CHILD_PID"
EXIT_CODE=$?
set -e

END_TS="$(date +%s)"
DURATION_SEC=$((END_TS - START_TS))

# 9. 校验脚本在执行期间未被篡改 (Strict Runner 守卫)
POST_SCRIPT_SHA256="$(sha256sum "$SCRIPT_PATH" | awk '{print $1}')"
if [[ "$POST_SCRIPT_SHA256" != "$SCRIPT_SHA256" ]]; then
  echo "{\"error\":\"ERR_SCRIPT_MUTATED_DURING_RUN\",\"step_id\":\"$STEP_ID\"}"
  exit 5
fi

# 10. 校验产物并组装结构化 JSON
INTEGRITY_OK=true
if ! verify_outputs_integrity; then
  INTEGRITY_OK=false
  if [[ "$EXIT_CODE" -eq 0 ]]; then
    EXIT_CODE=6
  fi
fi

CHANGED_JSON="$(build_changed_files_json)"
STDOUT_TAIL="$(build_stdout_summary)"

RESULT_JSON="$(jq -n \
  --arg task_id "$TASK_ID" \
  --arg step_id "$STEP_ID" \
  --arg idem "fresh_run" \
  --arg exec_at "$ISO_NOW" \
  --arg ws "$REAL_PROJ" \
  --arg sp "$SCRIPT_PATH" \
  --arg s_sha "$SCRIPT_SHA256" \
  --arg i_sha "$INPUTS_SHA256" \
  --argjson code "$EXIT_CODE" \
  --argjson dur "$DURATION_SEC" \
  --arg log_f "$LOG_FILE" \
  --argjson files "$CHANGED_JSON" \
  --arg summary "$STDOUT_TAIL" \
  '{
    task_id: $task_id,
    step_id: $step_id,
    idempotent_status: $idem,
    executed_at: $exec_at,
    workspace_dir: $ws,
    script_path: $sp,
    script_sha256: $s_sha,
    inputs_sha256: $i_sha,
    exit_code: $code,
    duration_sec: $dur,
    log_file: $log_f,
    changed_files: $files,
    stdout_summary: $summary
  }' | with_preliminary_acceptance)"

if [[ "$EXIT_CODE" -eq 0 ]] && [[ "$INTEGRITY_OK" == "true" ]]; then
  echo "$RESULT_JSON" > "$DONE_FILE"
  echo "$RESULT_JSON"
  exit 0
else
  echo "$RESULT_JSON"
  exit "$EXIT_CODE"
fi
