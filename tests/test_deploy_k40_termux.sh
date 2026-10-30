#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${1:-}"
if [ -z "$SCRIPT" ] || [ ! -x "$SCRIPT" ]; then
  printf 'usage: test_deploy_k40_termux.sh <deploy-script>\n' >&2
  exit 2
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILS=0

report() {
  if [ "$2" = "$3" ]; then
    printf 'PASS %s\n' "$1"
  else
    printf 'FAIL %s expected=%s actual=%s\n' "$1" "$3" "$2"
    FAILS=$((FAILS + 1))
  fi
}

SRC="$TMP/src"
DST="$TMP/dst"
mkdir -p "$SRC"
printf '#!/usr/bin/env bash\necho deploy_ok\n' > "$SRC/a.sh"
printf 'ignored\n' > "$SRC/README.md"
printf '#!/usr/bin/env bash\necho dry\n' > "$SRC/dry.sh"
printf 'gene\tlogFC\nTP53\t2.4\n' > "$SRC/expr.tsv"
printf '\211PNG\r\n\032\n\000\001\002\r\003' > "$SRC/plot.png"
{
  head -c 8192 /dev/zero | tr '\000' 'A'
  printf '\000\r'
} > "$SRC/tail-binary.bin"
bash "$SCRIPT" --source "$SRC" --target "$DST" >/dev/null
report 'source_hash' "$(sha256sum "$SRC/a.sh" | awk '{print $1}')" "$(sha256sum "$DST/a.sh" | awk '{print $1}')"
[ -x "$DST/a.sh" ] && report 'executable' yes yes || report 'executable' no yes
[ ! -x "$DST/expr.tsv" ] && report 'data_not_executable' yes yes || report 'data_not_executable' no yes
[ ! -x "$DST/plot.png" ] && report 'binary_not_executable' yes yes || report 'binary_not_executable' no yes
report 'binary_cr_preserved' "$(sha256sum "$SRC/plot.png" | awk '{print $1}')" "$(sha256sum "$DST/plot.png" | awk '{print $1}')"
report 'tail_nul_binary_preserved' "$(sha256sum "$SRC/tail-binary.bin" | awk '{print $1}')" "$(sha256sum "$DST/tail-binary.bin" | awk '{print $1}')"
[ ! -e "$DST/README.md" ] && report 'readme_excluded' yes yes || report 'readme_excluded' no yes

DRY="$TMP/dry-dst"
bash "$SCRIPT" --source "$SRC" --target "$DRY" --dry-run >/dev/null
[ ! -e "$DRY/a.sh" ] && report 'dry_run_no_copy' yes yes || report 'dry_run_no_copy' no yes

HIDDEN_SRC="$TMP/.cache/deploy/src"
HIDDEN_DST="$TMP/.cache/deploy/dst"
mkdir -p "$HIDDEN_SRC"
printf '#!/usr/bin/env bash\necho hidden_parent_ok\n' > "$HIDDEN_SRC/hidden-parent.sh"
bash "$SCRIPT" --source "$HIDDEN_SRC" --target "$HIDDEN_DST" >/dev/null
[ -x "$HIDDEN_DST/hidden-parent.sh" ] && report 'hidden_parent_not_excluded' yes yes || report 'hidden_parent_not_excluded' no yes

printf '#!/usr/bin/env bash\r\necho bad\r\n' > "$SRC/bad.sh"
set +e
OUT="$(bash "$SCRIPT" --source "$SRC" --target "$TMP/crlf" 2>&1)"
CODE=$?
set -e
report 'crlf_exit' "$CODE" 1
case "$OUT" in
  *ERR_DEPLOY_SOURCE_CRLF*) report 'crlf_code' yes yes ;;
  *) report 'crlf_code' no yes ;;
esac

set +e
bash "$SCRIPT" --bad-arg >/dev/null 2>&1
CODE=$?
set -e
report 'unknown_arg' "$CODE" 2

if [ "$FAILS" -gt 0 ]; then
  printf 'DEPLOY_GATE_TEST_FAIL failures=%d\n' "$FAILS"
  exit 1
fi
printf 'DEPLOY_GATE_TEST_OK\n'
