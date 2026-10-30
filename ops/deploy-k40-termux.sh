#!/usr/bin/env bash
set -euo pipefail

SOURCE=""
TARGET=""
DRY_RUN=0

usage() {
  printf 'usage: deploy-k40-termux.sh --source <dir> --target <dir> [--dry-run]\n' >&2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --source) SOURCE="${2:-}"; shift 2 ;;
    --target) TARGET="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) printf 'ERR_DEPLOY_UNKNOWN_ARG: %s\n' "$1" >&2; exit 2 ;;
  esac
done

if [ -z "$SOURCE" ] || [ -z "$TARGET" ]; then
  usage
  exit 2
fi
if [ ! -d "$SOURCE" ]; then
  printf 'ERR_DEPLOY_SOURCE_NOT_DIR: %s\n' "$SOURCE" >&2
  exit 2
fi
if [ ! -d "$TARGET" ] && [ "$DRY_RUN" -eq 0 ]; then
  mkdir -p "$TARGET"
fi

shopt -s globstar nullglob
COPIED=0

has_nul_byte() {
  local count
  count="$(LC_ALL=C tr -cd '\000' < "$1" | wc -c)"
  [ "$count" -gt 0 ]
}

is_known_binary() {
  local relative="$1"
  local extension="${relative##*.}"
  extension="$(printf '%s' "$extension" | tr '[:upper:]' '[:lower:]')"
  case "$extension" in
    png|jpg|jpeg|gif|tif|tiff|pdf|zip|gz|bz2|xz|tar|rds|rda|h5|hdf5|h5ad|parquet|bam|bai|bw|bigwig|xls|xlsx|docx|pptx|woff|woff2|ttf|otf)
      return 0
      ;;
  esac
  return 1
}

is_binary_file() {
  local source_file="$1"
  local relative="$2"
  is_known_binary "$relative" || has_nul_byte "$source_file"
}

is_script_file() {
  local target_file="$1"
  local relative="$2"
  local extension="${relative##*.}"
  extension="$(printf '%s' "$extension" | tr '[:upper:]' '[:lower:]')"
  case "$extension" in
    sh|bash|py|r|pl|rb|js|mjs|cjs) return 0 ;;
  esac
  [ "$(head -c 2 "$target_file" 2>/dev/null || true)" = '#!' ]
}

for source_file in "$SOURCE"/**/*; do
  [ -f "$source_file" ] || continue
  relative="${source_file#"$SOURCE"/}"
  case "$relative" in
    README.md|*/README.md) continue ;;
    .*|*/.*) continue ;;
  esac
  binary=0
  if is_binary_file "$source_file" "$relative"; then
    binary=1
  else
    if [ "$(LC_ALL=C tr -cd '\r' < "$source_file" | wc -c)" -gt 0 ]; then
      printf 'ERR_DEPLOY_SOURCE_CRLF: %s\n' "$source_file" >&2
      exit 1
    fi
  fi
  target_file="$TARGET/$relative"
  if [ "$DRY_RUN" -eq 1 ]; then
    printf 'DRY_RUN %s -> %s\n' "$relative" "$target_file"
    continue
  fi
  mkdir -p "$(dirname "$target_file")"
  cp "$source_file" "$target_file"
  if [ "$binary" -eq 0 ]; then
    if command -v dos2unix >/dev/null 2>&1; then
      dos2unix "$target_file" >/dev/null 2>&1
    else
      sed -i 's/\r$//' "$target_file"
    fi
  fi
  if [ "$binary" -eq 0 ] && is_script_file "$target_file" "$relative"; then
    chmod 755 "$target_file"
    test -x "$target_file" || {
      printf 'ERR_DEPLOY_NOT_EXECUTABLE: %s\n' "$relative" >&2
      exit 1
    }
  else
    chmod 644 "$target_file"
  fi
  source_hash="$(sha256sum "$source_file" | awk '{print $1}')"
  target_hash="$(sha256sum "$target_file" | awk '{print $1}')"
  if [ "$source_hash" != "$target_hash" ]; then
    printf 'ERR_DEPLOY_HASH_MISMATCH: %s\n' "$relative" >&2
    exit 1
  fi
  COPIED=$((COPIED + 1))
done

printf 'DEPLOY_OK source=%s target=%s copied=%d dry_run=%d\n' "$SOURCE" "$TARGET" "$COPIED" "$DRY_RUN"
