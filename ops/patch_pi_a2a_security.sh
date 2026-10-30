#!/usr/bin/env bash
# Patch @bacnh85/pi-a2a's broad sk- redaction pattern.
#
# The upstream pattern matches the "sk-" substring inside task IDs such as
# "task-live-...", which corrupts otherwise valid Artifact task_id fields.
# The replacement only matches an sk- token at a non-alphanumeric boundary.
set -euo pipefail

MODE="${1:---check}"
PACKAGE_DIR="${PI_A2A_PACKAGE_DIR:-$HOME/.pi/agent/npm/node_modules/@bacnh85/pi-a2a/extensions/lib}"
SECURITY_FILE="$PACKAGE_DIR/security.ts"
OLD_PATTERN='[/sk-[A-Za-z0-9_-]{16,}/g, "sk-[redacted]"]'
NEW_PATTERN='[/(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}/g, "sk-[redacted]"]'

if [ ! -f "$SECURITY_FILE" ]; then
  printf 'ERR_SECURITY_FILE_MISSING: %s\n' "$SECURITY_FILE" >&2
  exit 2
fi

case "$MODE" in
  --check)
    if grep -Fq "$NEW_PATTERN" "$SECURITY_FILE"; then
      printf 'PI_A2A_SECURITY_PATCH=applied file=%s\n' "$SECURITY_FILE"
      exit 0
    fi
    if grep -Fq "$OLD_PATTERN" "$SECURITY_FILE"; then
      printf 'PI_A2A_SECURITY_PATCH=pending file=%s\n' "$SECURITY_FILE"
      exit 1
    fi
    printf 'ERR_SECURITY_PATTERN_UNKNOWN: %s\n' "$SECURITY_FILE" >&2
    exit 2
    ;;
  --apply)
    python3 - "$SECURITY_FILE" "$OLD_PATTERN" "$NEW_PATTERN" <<'PY'
import os
import stat
import sys
import tempfile

path, old, new = sys.argv[1:4]
with open(path, encoding="utf-8") as handle:
    text = handle.read()

if new in text:
    print("PI_A2A_SECURITY_PATCH=already_applied")
    raise SystemExit(0)
if old not in text:
    print("ERR_SECURITY_PATTERN_UNKNOWN", file=sys.stderr)
    raise SystemExit(2)

updated = text.replace(old, new, 1)
mode = stat.S_IMODE(os.stat(path).st_mode)
fd, temporary = tempfile.mkstemp(prefix=".security.", suffix=".tmp", dir=os.path.dirname(path))
try:
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(updated)
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary, mode)
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)

print("PI_A2A_SECURITY_PATCH=applied")
PY
    ;;
  *)
    printf 'ERR_UNKNOWN_ARG: %s (use --check or --apply)\n' "$MODE" >&2
    exit 2
    ;;
esac
