#!/usr/bin/env python3
"""Validate plot artifacts without recursive directory traversal."""

import argparse
import glob
import hashlib
import os
import sys

from PIL import Image


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_png(path):
    try:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            image.load()
            width, height = image.size
        if width <= 0 or height <= 0:
            return False, width, height, "invalid PNG dimensions"
        return True, width, height, "PIL verify+load passed"
    except Exception as exc:
        return False, None, None, f"PIL verify+load failed: {type(exc).__name__}: {exc}"


def inspect_pdf(path):
    with open(path, "rb") as handle:
        header = handle.read(5)
    if header != b"%PDF-":
        return False, None, None, "invalid PDF header"
    return True, None, None, "header only; full PDF validation not performed"


def collect(root, patterns):
    found = []
    for pattern in patterns:
        for path in glob.glob(os.path.join(root, pattern)):
            if os.path.isfile(path):
                found.append(os.path.abspath(path))
    return sorted(set(found))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--pattern", action="append", default=[])
    parser.add_argument("--expected", action="append", default=[])
    args = parser.parse_args()

    patterns = args.pattern or [
        "*.png",
        "*.pdf",
        "outputs/*.png",
        "outputs/*.pdf",
        "figures/*.png",
        "figures/*.pdf",
    ]
    files = collect(args.root, patterns)
    missing = []
    for pattern in args.expected:
        if not glob.glob(os.path.join(args.root, pattern)):
            missing.append(pattern)

    rows = ["file\ttype\tsize_bytes\tsha256\tvalid\twidth\theight\tdetail"]
    invalid = 0
    for path in files:
        extension = os.path.splitext(path)[1].lower()
        if extension == ".png":
            valid, width, height, detail = inspect_png(path)
            file_type = "png"
        elif extension == ".pdf":
            valid, width, height, detail = inspect_pdf(path)
            file_type = "pdf"
        else:
            valid, width, height, detail = False, None, None, "unsupported extension"
            file_type = extension.lstrip(".") or "unknown"
        if not valid:
            invalid += 1
        status = "PASS" if valid and extension == ".png" else ("HEADER_OK" if valid else "FAIL")
        rows.append(
            "\t".join(
                [
                    os.path.relpath(path, args.root).replace(os.sep, "/"),
                    file_type,
                    str(os.path.getsize(path)),
                    sha256(path),
                    status,
                    "" if width is None else str(width),
                    "" if height is None else str(height),
                    detail,
                ]
            )
        )

    for pattern in missing:
        rows.append(
            "\t".join([pattern, "missing", "0", "", "FAIL", "", "", "expected artifact absent"])
        )

    os.makedirs(os.path.dirname(os.path.abspath(args.report)), exist_ok=True)
    with open(args.report, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(rows) + "\n")

    print(f"artifacts={len(files)} invalid={invalid} missing_expected={len(missing)}")
    if files:
        for path in files:
            print(os.path.relpath(path, args.root).replace(os.sep, "/"))
    if invalid or missing:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
