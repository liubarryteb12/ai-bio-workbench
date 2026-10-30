#!/usr/bin/env python3
"""Audit figure spec v1.1.0 (03出图规范) compliance for a figures dir."""

from __future__ import annotations

import argparse
import json
import os
import struct
import sys

from audit_figure_visual import audit_visual

SPEC = {
    "min_dpi": 299.0,
    "min_font_pt": 5.0,
    "font_pt": 7,
    "allowed_width_mm": (58, 88, 89, 130, 180, 183),
    "width_tolerance_mm": 1.25,
    "pixel_tolerance": 15,
    "forbidden_colors": {"#FF0000", "#00FF00"},
}

STATIC_RULE_LABELS = {
    "tight_bbox",
    "tick_rotation_45",
    "thin_line",
    "rainbow_colormap",
    "red_green_colors",
    "legend_frame",
    "legend_position",
    "scrna_rasterization",
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
    results = {
        "dir": fig_dir,
        "figures": [],
        "pass": 0,
        "fail": 0,
        "warn": 0,
        "unavailable": 0,
    }
    for fname in sorted(os.listdir(fig_dir)):
        if not fname.endswith(".png"):
            continue
        path = os.path.join(fig_dir, fname)
        entry = {"file": fname, "issues": []}
        render_entry = audit_visual(path, entry_name=fname)
        entry["evidence_type"] = "rendered"
        entry["visual_status"] = render_entry["status"]
        entry["visual_issues"] = render_entry["issues"]
        entry["visual_unavailable"] = render_entry["unavailable"]
        try:
            header = read_png_header(path)
            width_px = header["width_px"]
            height_px = header["height_px"]
            dpi_x = header["dpi"]
            entry["size_px"] = [width_px, height_px]
            entry["dpi"] = dpi_x
            width_mm_exact = width_px / dpi_x * 25.4 if dpi_x else 0
            width_mm = round(width_mm_exact) if dpi_x else 0
            entry["width_mm"] = width_mm
            canonical_width = min(
                SPEC["allowed_width_mm"],
                key=lambda value: abs(value - width_mm_exact),
            )
            width_delta = abs(width_mm_exact - canonical_width)
            expected_px = round(canonical_width / 25.4 * dpi_x) if dpi_x else 0

            if dpi_x < SPEC["min_dpi"]:
                entry["issues"].append(f"DPI={dpi_x} < {SPEC['min_dpi']}")
            if dpi_x >= SPEC["min_dpi"] and width_delta > SPEC["width_tolerance_mm"]:
                entry["issues"].append(
                    f"width_mm={width_mm_exact:.2f} not one of "
                    f"{'/'.join(str(value) for value in SPEC['allowed_width_mm'])}"
                )
            if (
                dpi_x >= SPEC["min_dpi"]
                and width_delta <= SPEC["width_tolerance_mm"]
                and abs(width_px - expected_px) > SPEC["pixel_tolerance"]
            ):
                entry["issues"].append(
                    f"width_px={width_px} does not match {canonical_width} mm "
                    f"at {dpi_x:g} dpi (expected {expected_px})"
                )
        except Exception as exc:
            entry["issues"].append(f"read_error: {exc}")
        if entry["issues"] or entry["visual_issues"]:
            results["fail"] += 1
            entry["status"] = "FAIL"
        elif entry["visual_unavailable"]:
            results["unavailable"] += 1
            entry["status"] = "UNAVAILABLE"
        else:
            results["pass"] += 1
            entry["status"] = "PASS"
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
        print(f"SUMMARY: pass={result['pass']} fail={result['fail']} "
              f"unavailable={result['unavailable']}")
    return 0 if result["fail"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
