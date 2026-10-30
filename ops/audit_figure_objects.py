#!/usr/bin/env python3
"""Inspect editable Python figure objects for single-plot layout regressions."""

from __future__ import annotations

import argparse
import json
import pickle
from pathlib import Path


def _artist_box(artist, renderer):
    try:
        if not artist.get_visible():
            return None
        if hasattr(artist, "get_text") and not artist.get_text().strip():
            return None
        box = artist.get_window_extent(renderer=renderer)
    except Exception:
        return None
    return box if box.width > 0 and box.height > 0 else None


def inspect_figure(fig: object, name: str) -> dict:
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    fig_box = fig.bbox
    axes = list(fig.axes)
    issues: list[str] = []
    observations: list[str] = []
    for index, ax in enumerate(axes):
        position = ax.get_position()
        if position.x0 < 0 or position.y0 < 0 or position.x1 > 1 or position.y1 > 1:
            issues.append(f"axes{index} outside figure position={tuple(round(v, 3) for v in position.bounds)}")
        title = ax.get_title()
        if title.strip():
            issues.append(f"axes{index} has non-empty title: {title!r}")
        for label in list(ax.get_xticklabels()) + list(ax.get_yticklabels()):
            if label.get_rotation() not in (0, 360):
                issues.append(f"axes{index} rotated tick label: {label.get_text()!r} {label.get_rotation():g} deg")
        artists = [
            *list(ax.get_xticklabels()),
            *list(ax.get_yticklabels()),
            ax.xaxis.label,
            ax.yaxis.label,
            *list(ax.texts),
        ]
        legend = ax.get_legend()
        if legend is not None:
            artists.append(legend)
        for artist in artists:
            box = _artist_box(artist, renderer)
            if box is None:
                continue
            if box.x0 < -1 or box.y0 < -1 or box.x1 > fig_box.width + 1 or box.y1 > fig_box.height + 1:
                text = artist.get_text().replace("\n", " ")[:32] if hasattr(artist, "get_text") else "<legend>"
                issues.append(
                    f"axes{index} artist outside canvas: {text!r} "
                    f"bbox={tuple(round(v, 1) for v in box.extents)}"
                )
    return {
        "figure": name,
        "axes_count": len(axes),
        "canvas_px": [round(fig_box.width, 1), round(fig_box.height, 1)],
        "issues": issues,
        "observations": observations,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-dir", required=True)
    parser.add_argument("--manifest", default="")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    root = Path(args.contract_dir).resolve()
    manifest_path = Path(args.manifest).resolve() if args.manifest else root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    results = []
    for entry in manifest.get("figures", []):
        if entry.get("object_kind") != "pkl":
            continue
        png = root / entry["canonical_output"]
        object_path = Path(f"{png.with_suffix('')}_plot.pkl")
        with object_path.open("rb") as handle:
            fig = pickle.load(handle)
        results.append(inspect_figure(fig, entry["template_id"]))
    if args.json:
        print(json.dumps({"figures": results}, ensure_ascii=False, indent=2))
    else:
        for result in results:
            print(f"[{'FAIL' if result['issues'] else 'PASS'}] {result['figure']} axes={result['axes_count']}")
            for issue in result["issues"]:
                print(f"  - {issue}")
    return 1 if any(result["issues"] for result in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
