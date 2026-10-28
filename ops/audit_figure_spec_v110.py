#!/usr/bin/env python3
"""Audit figure spec v1.1.0 (03出图规范) compliance for a figures dir."""

from __future__ import annotations

import argparse
import json
import os
import sys
import struct
import zlib

SPEC = {
    "min_dpi": 299.0,
    "min_font_pt": 5.0,
    "font_pt": 7,
    "single_col_mm": 88,
    "double_col_mm": 180,
    "single_col_px_min": 1040,
    "forbidden_colors": {"#FF0000", "#00FF00"},
}


def read_png_header(path: str) -> dict:
    """Minimal PNG parser: size + pHYs DPI, no third-party deps."""
    result = {"width_px": 0, "height_px": 0, "dpi": 0.0}
    with open(path, "rb") as fh:
        sig = fh.read(8)
        if sig != b"\x89PNG\r\n\x1a\n":
            raise ValueError("not a PNG")
        while True:
            header = fh.read(8)
            if len(header) < 8:
                break
            length = struct.unpack(">I", header[:4])[0]
            chunk_type = header[4:8]
            data = fh.read(length)
            fh.read(4)  # CRC
            if chunk_type == b"IHDR" and length >= 13:
                w, h = struct.unpack(">II", data[:8])
                result["width_px"] = w
                result["height_px"] = h
            elif chunk_type == b"pHYs" and length >= 9:
                ppux, ppuy, unit = struct.unpack(">IIB", data[:9])
                if unit == 1:  # metre
                    result["dpi"] = round(ppux * 0.0254, 1)
            elif chunk_type == b"IEND":
                break
    return result


def audit_dir(fig_dir: str) -> dict:
    results = {"dir": fig_dir, "figures": [], "pass": 0, "fail": 0, "warn": 0}
    for fname in sorted(os.listdir(fig_dir)):
        if not fname.endswith(".png"):
            continue
        path = os.path.join(fig_dir, fname)
        entry = {"file": fname, "issues": []}
        try:
            header = read_png_header(path)
            width_px = header["width_px"]
            height_px = header["height_px"]
            dpi_x = header["dpi"]
            entry["size_px"] = [width_px, height_px]
            entry["dpi"] = dpi_x
            width_mm = round(width_px / dpi_x * 25.4) if dpi_x else 0
            entry["width_mm"] = width_mm

            if dpi_x < SPEC["min_dpi"]:
                entry["issues"].append(f"DPI={dpi_x} < {SPEC['min_dpi']}")
            if dpi_x >= SPEC["min_dpi"] and width_px < SPEC["single_col_px_min"]:
                entry["issues"].append(f"width_px={width_px} < {SPEC['single_col_px_min']}")
            if width_mm and width_mm not in (88, 89, 180, 183):
                entry["issues"].append(f"width_mm={width_mm} not 88/89/180/183")
        except Exception as exc:
            entry["issues"].append(f"read_error: {exc}")
        if entry["issues"]:
            results["fail"] += 1
        else:
            results["pass"] += 1
            entry["issues"] = []
        results["figures"].append(entry)
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fig_dir", help="figures directory to audit")
    parser.add_argument("--json", action="store_true", help="emit machine JSON")
    args = parser.parse_args()
    if not os.path.isdir(args.fig_dir):
        print(f"ERR_DIR_NOT_FOUND: {args.fig_dir}", file=sys.stderr)
        return 2
    result = audit_dir(args.fig_dir)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=1))
    else:
        print(f"AUDIT_DIR: {result['dir']}")
        for entry in result["figures"]:
            status = "PASS" if not entry["issues"] else "FAIL"
            detail = " ".join(entry["issues"]) or "ok"
            extra = f" {entry.get('size_px', '')} {entry.get('dpi', '')}dpi" if "size_px" in entry else ""
            print(f"  [{status}] {entry['file']}{extra} {detail}")
        print(f"SUMMARY: pass={result['pass']} fail={result['fail']}")
    return 0 if result["fail"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
