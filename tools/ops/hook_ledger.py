#!/usr/bin/env python3
"""Append a sha256 ledger call to line2 and line3 step scripts.

The 39 step scripts in these two lines use three different tail shapes, so an
in-place rewrite of the report block would need three separate adapters. This
tool takes the simpler route: append one guarded call to the standalone
k40_step_sha_ledger.sh right after the existing done marker, so the ledger is
produced by the same run without touching the original logic.

The appended call is wrapped in a feature check, so scripts stay runnable even
if the helper is absent. Idempotent.
"""
import io
import os
import re
import shutil
import sys

LINES = {
    "line2_scrna": "/mnt/ssd/bio_data/bin/line2_scrna",
    "line3_spatial": "/mnt/ssd/bio_data/bin/line3_spatial",
}
HELPER = "/mnt/ssd/bio_data/tools/ops/k40_step_sha_ledger.sh"
MARKER = "k40_step_sha_ledger.sh"

APPEND_TEMPLATE = """
# sha256 产物台账后置补登：复用独立脚本，写法与其余步骤解耦。
if [ -x "{helper}" ]; then
  "{helper}" "{outdir}" "{report}" > /dev/null 2>&1 || true
fi
"""


def outdir_var(src):
    """Return the output directory expression, without surrounding quotes.

    The template adds its own quoting, so returning an already-quoted string
    would produce doubled quotes in the generated hook.
    """
    for pattern in (
        r'OUTDIR="([^"]+)"',
        r'outdir="([^"]+)"',
        r'OUT_DIR="([^"]+)"',
        r'OUT="([^"]+)"',
    ):
        m = re.search(pattern, src)
        if m:
            return m.group(1)
    if "BIOANALYS_OUTPUT" in src:
        return "${BIOANALYS_OUTPUT:-$PWD}"
    if "QC_OUTDIR" in src:
        return "${QC_OUTDIR:-$PWD}"
    return "$PWD"


def report_name(path, src):
    """Find the report filename this step writes."""
    step = os.path.basename(path)
    names = re.findall(r'open\("([^"]*_report\.txt)"', src)
    if names:
        return names[0]
    names = re.findall(r'([A-Za-z0-9_]+_report\.txt)', src)
    if names:
        return names[0]
    return "%s_report.txt" % step


def patch(path):
    with io.open(path, "r", encoding="utf-8", newline="") as fh:
        src = fh.read()

    if MARKER in src:
        return "ALREADY_PATCHED", None

    block = APPEND_TEMPLATE.format(
        helper=HELPER,
        outdir=outdir_var(src),
        report=report_name(path, src),
    )

    # The heredoc terminator PYSCRIPT ends the python body. Anything placed
    # before it is fed to python3 as code, so the bash hook goes AFTER it.
    stripped = src.rstrip("\n")
    new_src = stripped + "\n" + block
    return "PATCHED", new_src


def main():
    patched = 0
    already = 0
    skipped = []
    for line, directory in sorted(LINES.items()):
        if not os.path.isdir(directory):
            continue
        for entry in sorted(os.listdir(directory)):
            path = os.path.join(directory, entry)
            if not os.path.isfile(path) or ".bak_" in entry:
                continue
            if not os.access(path, os.X_OK):
                continue
            status, new_src = patch(path)
            if status == "ALREADY_PATCHED":
                already += 1
                continue
            if status != "PATCHED":
                skipped.append("%s/%s:%s" % (line, entry, status))
                continue
            backup = path + ".bak_20261025_ledger_hook"
            if not os.path.exists(backup):
                shutil.copy2(path, backup)
            with io.open(path, "w", encoding="utf-8", newline="") as fh:
                fh.write(new_src)
            os.chmod(path, 0o755)
            patched += 1
            print("HOOKED %s/%s" % (line, entry))

    print("SUMMARY hooked=%d already=%d skipped=%d" % (patched, already, len(skipped)))
    for item in skipped:
        print("SKIP %s" % item)
    return 0


if __name__ == "__main__":
    sys.exit(main())