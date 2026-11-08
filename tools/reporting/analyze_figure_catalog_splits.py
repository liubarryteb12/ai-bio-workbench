#!/usr/bin/env python3

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path, PurePosixPath

from PIL import Image


CATALOG_VERSION = 1
EXIT_OK = 0
EXIT_USAGE = 2
EXIT_VALIDATION = 1

SPLIT_READY = "split_ready"
NEEDS_PRIMARY_IMAGE = "needs_primary_image"
NEEDS_MANUAL_MAPPING = "needs_manual_mapping"
BLOCKED_EXTERNAL_DATA = "blocked_external_data"

PLOT_TOKENS = (
    r"plt\.show\(",
    r"plt\.figure\(",
    r"plt\.subplots\(",
    r"ggplot\(",
    r"ggsave\(",
    r"plot\(",
)
PLOT_RE = re.compile("|".join(PLOT_TOKENS))


def _split_code_blocks(code):
    markers = re.split(r"(?:^|\n)#+\s*----\s*(?:cell|chunk)\s*----", code)
    return [block.strip("\n") for block in markers if block.strip()]


def _find_local_image(images_root, page_url):
    slug = page_url.rstrip("/").rsplit("/", 1)[-1]
    if not slug:
        return None
    matches = sorted(images_root.glob(f"*__{slug}__0.png"))
    return matches[0] if matches else None


def _image_metadata(path):
    with Image.open(path) as image:
        width, height = image.size
        image.load()
    return {
        "local_path": path.name,
        "width": width,
        "height": height,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def _candidate_figures(entry, local_image):
    blocks = _split_code_blocks(entry.get("code", ""))
    plot_blocks = [block for block in blocks if PLOT_RE.search(block)]
    if not plot_blocks and PLOT_RE.search(entry.get("code", "")):
        plot_blocks = [entry.get("code", "")]
    return len(plot_blocks)


def _classify(entry, local_image, plot_count):
    blockers = []
    if entry.get("ext_data") == 1:
        return BLOCKED_EXTERNAL_DATA, ["external_data_required"], 0.2
    if not entry.get("image_url") or entry.get("n_img", 0) < 1:
        return NEEDS_PRIMARY_IMAGE, ["primary_image_missing"], 0.3
    if not local_image:
        return NEEDS_PRIMARY_IMAGE, ["local_primary_image_unmatched"], 0.4
    if plot_count <= 1 or entry.get("n_code_blocks", 0) == 1:
        blockers.append("single_plot_cell_or_ambiguous_code_cells")
    if entry.get("n_code_blocks", 0) > entry.get("n_img", 0):
        blockers.append("more_code_cells_than_images")
    if blockers:
        return NEEDS_MANUAL_MAPPING, blockers, 0.5
    return SPLIT_READY, blockers, 0.9


def analyze_catalog(catalog_path, images_root):
    catalog_path = Path(catalog_path)
    images_root = Path(images_root)
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    records = []
    for entry in catalog.get("entries", []):
        if entry.get("status") != "needs_split":
            continue
        local_image = _find_local_image(images_root, entry.get("page_url", ""))
        primary_image = _image_metadata(local_image) if local_image else None
        plot_count = _candidate_figures(entry, local_image)
        classification, blockers, confidence = _classify(
            entry, local_image is not None, plot_count
        )
        record = {
            "catalog_id": entry["catalog_id"],
            "page_id": entry.get("page_id"),
            "lang": entry.get("lang"),
            "title": entry.get("title"),
            "classification": classification,
            "confidence": confidence,
            "blockers": blockers,
            "candidate_figures": plot_count,
            "code_cells": entry.get("n_code_blocks", 0),
            "source_images": entry.get("n_img", 0),
            "page_url": entry.get("page_url"),
            "primary_image_url": entry.get("image_url"),
            "primary_image": primary_image,
        }
        records.append(record)

    counts = {
        SPLIT_READY: 0,
        NEEDS_PRIMARY_IMAGE: 0,
        NEEDS_MANUAL_MAPPING: 0,
        BLOCKED_EXTERNAL_DATA: 0,
    }
    for record in records:
        counts[record["classification"]] += 1
    plan = {
        "schema_version": CATALOG_VERSION,
        "source_catalog": str(catalog_path).replace("\\", "/"),
        "source_catalog_sha256": hashlib.sha256(
            catalog_path.read_bytes()
        ).hexdigest(),
        "summary": {
            "needs_split_total": len(records),
            "coverage_complete": True,
            "counts": counts,
        },
        "records": records,
    }
    validate_plan(plan)
    return plan


def _is_relative_to(path, parent):
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def validate_plan(plan):
    if not isinstance(plan, dict) or not isinstance(plan.get("records"), list):
        raise ValueError("plan must contain records")
    if not plan.get("records"):
        raise ValueError("plan must cover at least one record")
    allowed = {
        SPLIT_READY,
        NEEDS_PRIMARY_IMAGE,
        NEEDS_MANUAL_MAPPING,
        BLOCKED_EXTERNAL_DATA,
    }
    ids = []
    for record in plan["records"]:
        if record.get("classification") not in allowed:
            raise ValueError(f"invalid classification for {record.get('catalog_id')}")
        if not 0 <= record.get("confidence", -1) <= 1:
            raise ValueError(f"invalid confidence for {record.get('catalog_id')}")
        ids.append(record["catalog_id"])
        primary = record.get("primary_image") or {}
        local_path = primary.get("local_path")
        if local_path and PurePosixPath(local_path).is_absolute():
            raise ValueError(
                f"absolute local path in {record['catalog_id']}"
            )
        if local_path and (".." in PurePosixPath(local_path).parts):
            raise ValueError(f"path escape in {record['catalog_id']}")
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate catalog_id")
    return True

def _summary_markdown(plan):
    counts = plan["summary"]["counts"]
    total = plan["summary"]["needs_split_total"]
    lines = [
        "# Figure Catalog Split Plan",
        "",
        f"Coverage: {total}/{total} needs_split records.",
        "",
        "| Classification | Count |",
        "| --- | ---: |",
        f"| {SPLIT_READY} | {counts[SPLIT_READY]} |",
        f"| {NEEDS_PRIMARY_IMAGE} | {counts[NEEDS_PRIMARY_IMAGE]} |",
        f"| {NEEDS_MANUAL_MAPPING} | {counts[NEEDS_MANUAL_MAPPING]} |",
        f"| {BLOCKED_EXTERNAL_DATA} | {counts[BLOCKED_EXTERNAL_DATA]} |",
        "",
        "Representative blockers:",
        "",
    ]
    blockers = {}
    for record in plan["records"]:
        for blocker in record["blockers"]:
            blockers.setdefault(blocker, record["catalog_id"])
    for blocker, catalog_id in sorted(blockers.items()):
        lines.append(f"- `{blocker}`: {catalog_id}")
    lines.extend(
        [
            "",
            "Classification is a static feasibility plan. It maps ordered plot",
            "cells to ordered source images without executing the code. A",
            "split_ready record has a matched local primary image and equal",
            "code cell and source image counts. Manual review is still",
            "required before materializing a candidate.",
        ]
    )
    return "\n".join(lines) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", required=True)
    parser.add_argument("--images", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)

    workspace = Path(__file__).resolve().parents[1]
    catalog = Path(args.catalog).resolve()
    images = Path(args.images).resolve()
    output = Path(args.output).resolve()
    if not _is_relative_to(catalog, workspace) or not _is_relative_to(images, workspace):
        return EXIT_USAGE
    if not catalog.exists() or not images.exists():
        return EXIT_USAGE
    if not _is_relative_to(output, workspace):
        return EXIT_USAGE

    try:
        plan = analyze_catalog(catalog, images)
        validate_plan(plan)
    except (OSError, ValueError, json.JSONDecodeError):
        return EXIT_VALIDATION
    output.mkdir(parents=True, exist_ok=True)
    (output / "split_plan.json").write_text(
        json.dumps(plan, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    (output / "summary.md").write_text(
        _summary_markdown(plan), encoding="utf-8", newline="\n"
    )
    print(
        f"step_executed=analyze_figure_catalog_splits records={len(plan['records'])}"
    )
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
