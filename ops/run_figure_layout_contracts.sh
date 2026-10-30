#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  run_figure_layout_contracts.sh \
    --contract-dir <dir> \
    --project-json <project.json> \
    --seed <integer> \
    [--layout-root /mnt/ssd/bio_data] \
    [--python <python3>] \
    [--rscript <Rscript>] \
    [--manifest-python <python>] \
    [--verify-only]
USAGE
}

fail() {
  local code="$1"
  shift
  printf 'ERR: %s\n' "$*" >&2
  exit "$code"
}

CONTRACT_DIR=""
PROJECT_JSON=""
SEED=""
LAYOUT_ROOT="/mnt/ssd/bio_data"
PYTHON_BIN=""
RSCRIPT_BIN=""
MANIFEST_PYTHON=""
VERIFY_ONLY=0

while (($#)); do
  case "$1" in
    --contract-dir)
      [[ $# -ge 2 ]] || fail 2 "missing value for --contract-dir"
      CONTRACT_DIR="$2"
      shift 2
      ;;
    --project-json)
      [[ $# -ge 2 ]] || fail 2 "missing value for --project-json"
      PROJECT_JSON="$2"
      shift 2
      ;;
    --seed)
      [[ $# -ge 2 ]] || fail 2 "missing value for --seed"
      SEED="$2"
      shift 2
      ;;
    --layout-root)
      [[ $# -ge 2 ]] || fail 2 "missing value for --layout-root"
      LAYOUT_ROOT="$2"
      shift 2
      ;;
    --python)
      [[ $# -ge 2 ]] || fail 2 "missing value for --python"
      PYTHON_BIN="$2"
      shift 2
      ;;
    --rscript)
      [[ $# -ge 2 ]] || fail 2 "missing value for --rscript"
      RSCRIPT_BIN="$2"
      shift 2
      ;;
    --manifest-python)
      [[ $# -ge 2 ]] || fail 2 "missing value for --manifest-python"
      MANIFEST_PYTHON="$2"
      shift 2
      ;;
    --verify-only)
      VERIFY_ONLY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail 2 "unknown argument: $1"
      ;;
  esac
done

[[ -n "$CONTRACT_DIR" ]] || fail 2 "--contract-dir is required"
[[ -n "$PROJECT_JSON" ]] || fail 2 "--project-json is required"
[[ "$SEED" =~ ^[0-9]+$ ]] || fail 3 "--seed must be a non-negative integer"
[[ -d "$CONTRACT_DIR" ]] || fail 2 "contract directory not found: $CONTRACT_DIR"
[[ -f "$PROJECT_JSON" ]] || fail 2 "project JSON not found: $PROJECT_JSON"
MANIFEST="$CONTRACT_DIR/manifest.json"
[[ -f "$MANIFEST" ]] || fail 2 "manifest not found: $MANIFEST"

if [[ -z "$MANIFEST_PYTHON" ]]; then
  MANIFEST_PYTHON="$(command -v python3 || command -v python || true)"
fi
[[ -n "$MANIFEST_PYTHON" ]] || fail 2 "manifest python not found"

if [[ "$VERIFY_ONLY" -eq 0 ]]; then
  PYTHON_BIN="${PYTHON_BIN:-$LAYOUT_ROOT/ops/layout_autoload/bin/python3}"
  RSCRIPT_BIN="${RSCRIPT_BIN:-$LAYOUT_ROOT/ops/layout_autoload/bin/Rscript}"
  [[ -x "$PYTHON_BIN" ]] || fail 2 "python not executable: $PYTHON_BIN"
  [[ -x "$RSCRIPT_BIN" ]] || fail 2 "Rscript not executable: $RSCRIPT_BIN"
fi

export BIOANALYS_PROJECT_JSON="$PROJECT_JSON"
export BIOANALYS_SEED="$SEED"
export BIOANALYS_LAYOUT_LIB="$LAYOUT_ROOT/bin"
export R_PROFILE_USER="$LAYOUT_ROOT/ops/layout_autoload/Rprofile"
export PYTHONPATH="$LAYOUT_ROOT/ops/layout_autoload:$LAYOUT_ROOT/ops${PYTHONPATH:+:$PYTHONPATH}"
export MPLBACKEND="Agg"
export OMP_NUM_THREADS="${OMP_NUM_THREADS:-4}"
export OPENBLAS_NUM_THREADS="${OPENBLAS_NUM_THREADS:-4}"
export MKL_NUM_THREADS="${MKL_NUM_THREADS:-4}"

LOG_DIR="$CONTRACT_DIR/_logs"
SUMMARY="$CONTRACT_DIR/run_summary.tsv"
ROWS="$CONTRACT_DIR/_manifest_rows.tsv"
mkdir -p "$LOG_DIR"
printf 'template\tlanguage\texit_code\tquadruplet\tpng\tpdf\tobject\treport\tlog\n' > "$SUMMARY"

manifest_rows() {
  "$MANIFEST_PYTHON" - "$MANIFEST" <<'PYSCRIPT'
import json
import posixpath
import sys
from pathlib import Path

manifest_path = Path(sys.argv[1])
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
figures = manifest.get("figures")
if not isinstance(figures, list) or len(figures) != 15:
    raise SystemExit("manifest must contain exactly 15 figures")

allowed_lines = {"line1_bulk", "line2_scrna", "line3_spatial"}
allowed_objects = {"rds", "pkl"}
seen_paths = set()
rows = []
for figure in figures:
    template_id = str(figure.get("template_id") or "")
    language = str(figure.get("language") or "")
    filename = str(figure.get("filename") or "")
    line_id = str(figure.get("line_id") or "")
    canonical = str(figure.get("canonical_output") or "")
    object_kind = str(figure.get("object_kind") or "")
    if not template_id or not filename:
        raise SystemExit("template id or filename missing")
    if language not in {"r", "python"}:
        raise SystemExit(f"invalid language: {template_id}")
    if line_id not in allowed_lines:
        raise SystemExit(f"invalid line: {template_id}")
    if object_kind not in allowed_objects:
        raise SystemExit(f"invalid object kind: {template_id}")
    if canonical != posixpath.basename(canonical) or not canonical.endswith(".png"):
        raise SystemExit(f"canonical output must be a PNG basename: {template_id}")

    prefix = f"figures/{line_id}/"
    stem = canonical[:-4]
    expected = {
        "output_png": f"{prefix}{canonical}",
        "output_pdf": f"{prefix}{stem}.pdf",
        "output_object": f"{prefix}{stem}_plot.{object_kind}",
        "output_report": f"{prefix}{stem}_report.txt",
    }
    for key, expected_path in expected.items():
        actual = str(figure.get(key) or "")
        if actual != expected_path:
            raise SystemExit(f"{template_id}: {key} path drift: {actual}")
        if actual in seen_paths:
            raise SystemExit(f"{template_id}: duplicate artifact path: {actual}")
        seen_paths.add(actual)
    rows.append(
        "\t".join(
            [
                template_id,
                language,
                filename,
                expected["output_png"],
                expected["output_pdf"],
                expected["output_object"],
                expected["output_report"],
            ]
        )
    )

sys.stdout.buffer.write(("\n".join(rows) + "\n").encode("utf-8"))
PYSCRIPT
}

if ! manifest_rows > "$ROWS"; then
  fail 1 "manifest contract validation failed"
fi

manifest_count="$(wc -l < "$ROWS" | tr -d ' ')"
[[ "$manifest_count" -eq 15 ]] || fail 1 "manifest row count $manifest_count != 15"

check_quadruplet() {
  local png="$1"
  local pdf="$2"
  local object="$3"
  local report="$4"
  [[ -s "$png" && -s "$pdf" && -s "$object" && -s "$report" ]]
}

run_one() {
  local template_id="$1"
  local language="$2"
  local filename="$3"
  local png="$4"
  local pdf="$5"
  local object="$6"
  local report="$7"
  local log="$LOG_DIR/${template_id}.log"
  local rc=0
  local quadruplet="FAIL"

  if [[ "$VERIFY_ONLY" -eq 0 ]]; then
    if [[ "$language" == "python" ]]; then
      (cd "$CONTRACT_DIR" && "$PYTHON_BIN" "$filename") >"$log" 2>&1 || rc=$?
    else
      (cd "$CONTRACT_DIR" && "$RSCRIPT_BIN" --no-save --no-restore "$filename") >"$log" 2>&1 || rc=$?
    fi
  else
    log="-"
  fi

  if [[ "$rc" -eq 0 ]] && check_quadruplet \
    "$CONTRACT_DIR/$png" "$CONTRACT_DIR/$pdf" \
    "$CONTRACT_DIR/$object" "$CONTRACT_DIR/$report"; then
    quadruplet="PASS"
  fi
  printf '%s\t%s\t%d\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$template_id" "$language" "$rc" "$quadruplet" \
    "$png" "$pdf" "$object" "$report" "$log" >> "$SUMMARY"
  printf '%s rc=%d quadruplet=%s png=%s report=%s\n' \
    "$template_id" "$rc" "$quadruplet" "$png" "$report"
  return "$rc"
}

overall=0
while IFS=$'\t' read -r template_id language filename png pdf object report; do
  run_one "$template_id" "$language" "$filename" "$png" "$pdf" "$object" "$report" \
    || overall=1
done < "$ROWS"

if awk -F '\t' 'NR > 1 && ($3 != 0 || $4 != "PASS") { found=1 } END { exit(found ? 0 : 1) }' "$SUMMARY"; then
  overall=1
fi

summary_count="$(awk 'END { print NR - 1 }' "$SUMMARY")"
if [[ "$summary_count" -ne "$manifest_count" ]]; then
  printf 'ERR: manifest/run count mismatch manifest=%s summary=%s\n' \
    "$manifest_count" "$summary_count" >&2
  overall=1
fi

printf 'manifest=%s figures=%s summary=%s verify_only=%s\n' \
  "$MANIFEST" "$manifest_count" "$SUMMARY" "$VERIFY_ONLY"
exit "$overall"
