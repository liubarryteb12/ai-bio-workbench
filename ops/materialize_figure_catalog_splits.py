#!/usr/bin/env python3

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path, PurePosixPath

from PIL import Image


EXIT_OK = 0
EXIT_VALIDATION = 1
EXIT_USAGE = 2

SPLIT_READY = "split_ready"
SPLIT_MATERIALIZED = "split_materialized"
NOT_VERIFIED = "not_verified"

CODE_CHUNK_RE = re.compile(r"(?:^|\n)#+\s*----\s*(?:cell|chunk)\s*----\s*\n?")


def _sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _sha256_text(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _split_code_cells(code):
    parts = CODE_CHUNK_RE.split(code)
    return [part.strip("\n") + "\n" for part in parts if part.strip()]


def _is_relative_to(path, parent):
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def _validate_plan(plan):
    if not isinstance(plan, dict) or not isinstance(plan.get("records"), list):
        raise ValueError("plan must contain records")
    ready_records = [
        record
        for record in plan["records"]
        if record.get("classification") == SPLIT_READY
    ]
    if not ready_records:
        raise ValueError("plan must contain at least one split_ready record")
    for record in ready_records:
        catalog_id = record.get("catalog_id")
        if not isinstance(record.get("primary_image"), dict):
            raise ValueError(f"primary image is missing: {catalog_id}")
        if record.get("candidate_figures", 0) < 1:
            raise ValueError(f"no candidate figures: {catalog_id}")
        local_path = record["primary_image"].get("local_path", "")
        pure_path = PurePosixPath(local_path)
        if pure_path.is_absolute() or ".." in pure_path.parts:
            raise ValueError(f"unsafe primary image path: {catalog_id}")


def _image_metadata(path):
    with Image.open(path) as image:
        width, height = image.size
        image.load()
    return {"width": width, "height": height, "preview_sha256": _sha256_file(path)}


def _copy_primary_preview(record, images_root, preview_path):
    source = images_root / record["primary_image"]["local_path"]
    if not source.is_file():
        raise FileNotFoundError(f"missing primary image: {source}")
    expected_hash = record["primary_image"].get("sha256")
    actual_hash = _sha256_file(source)
    if expected_hash and actual_hash != expected_hash:
        raise ValueError(f"primary image hash mismatch: {record['catalog_id']}")
    preview_path.write_bytes(source.read_bytes())
    return _image_metadata(preview_path)


def _find_ordered_local_preview(images_root, source_url, slug):
    match = re.search(r"output-(\d+)\.png$", source_url)
    if not match or not slug:
        return None
    image_index = int(match.group(1)) - 1
    candidates = sorted(images_root.glob(f"*__{slug}__{image_index}.png"))
    return candidates[0] if candidates else None


def _write_preview(record, images_root, output_root, candidate, index):
    preview_path = output_root / "previews" / f"{record['catalog_id']}__{index:02d}.png"
    preview_path.parent.mkdir(parents=True, exist_ok=True)
    source_url = candidate.get("source_image_url", "")
    slug = record.get("page_url", "").rstrip("/").rsplit("/", 1)[-1]
    local_source = _find_ordered_local_preview(images_root, source_url, slug)
    if local_source:
        primary_name = record["primary_image"]["local_path"]
        if local_source.name == primary_name:
            expected_hash = record["primary_image"].get("sha256")
            actual_hash = _sha256_file(local_source)
            if expected_hash and actual_hash != expected_hash:
                raise ValueError(
                    f"primary image hash mismatch: {record['catalog_id']}"
                )
        preview_path.write_bytes(local_source.read_bytes())
        metadata = _image_metadata(preview_path)
        metadata["preview_path"] = preview_path.relative_to(output_root).as_posix()
        metadata["preview_source"] = "ordered_local_source_image"
        return metadata
    if index == 1:
        metadata = _copy_primary_preview(record, images_root, preview_path)
        metadata["preview_path"] = preview_path.relative_to(output_root).as_posix()
        metadata["preview_source"] = "primary_image"
        return metadata
    return {
        "preview_path": None,
        "preview_sha256": None,
        "width": None,
        "height": None,
        "preview_source": "source_image_unavailable",
    }


def materialize_plan(plan, catalog_path, images_root, output_root):
    plan = {
        **plan,
        "records": [
            record
            for record in plan.get("records", [])
            if record.get("classification") == SPLIT_READY
        ],
    }
    _validate_plan(plan)
    catalog_path = Path(catalog_path)
    images_root = Path(images_root)
    output_root = Path(output_root)

    catalog_sha = plan.get("source_catalog_sha256")
    actual_catalog_sha = _sha256_file(catalog_path)
    hash_mismatch = bool(catalog_sha and actual_catalog_sha != catalog_sha)

    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    entries = {
        entry.get("catalog_id"): entry
        for entry in catalog.get("entries", [])
    }

    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "code").mkdir(parents=True, exist_ok=True)
    (output_root / "previews").mkdir(parents=True, exist_ok=True)

    records = []
    ready_records = [
        record
        for record in plan["records"]
        if record.get("classification") == SPLIT_READY
    ]
    for record in ready_records:
        catalog_id = record["catalog_id"]
        entry = entries.get(catalog_id)
        if entry is None:
            raise ValueError(f"catalog entry missing: {catalog_id}")
        code = entry.get("code", "")
        cells = _split_code_cells(code)
        image_urls = [url for url in (entry.get("img_urls") or "").split(";") if url]
        expected_count = min(len(cells), len(image_urls))
        if expected_count < 1:
            raise ValueError(
                f"no ordered code/image pair for {catalog_id}: "
                f"cells={len(cells)}, images={len(image_urls)}"
            )

        candidates = []
        for index, (cell, source_url) in enumerate(zip(cells, image_urls), 1):
            code_path = output_root / "code" / f"{catalog_id}__{index:02d}.py"
            code_path.write_text(cell, encoding="utf-8", newline="\n")
            metadata = _write_preview(
                record, images_root, output_root, {"source_image_url": source_url}, index
            )
            relative_code_path = Path("code") / code_path.name
            candidate = {
                "figure_index": index,
                "code_path": relative_code_path.as_posix(),
                "code_sha256": _sha256_text(cell),
                "source_code_sha256": entry.get("source_code_sha256"),
                "source_image_url": source_url,
                "source_page": record.get("page_url"),
                "verification": NOT_VERIFIED,
                **metadata,
            }
            candidates.append(candidate)

        records.append(
            {
                "catalog_id": catalog_id,
                "page_id": record.get("page_id"),
                "lang": record.get("lang"),
                "title": record.get("title"),
                "status": SPLIT_MATERIALIZED,
                "confidence": record.get("confidence"),
                "candidate_count": expected_count,
                "candidates": candidates,
            }
        )

    result = {
        "schema_version": 1,
        "source_plan_sha256": None,
        "source_catalog_sha256": actual_catalog_sha,
        "source_catalog_hash_mismatch": hash_mismatch,
        "summary": {
            "record_count": len(records),
            "candidate_count": sum(item["candidate_count"] for item in records),
            "verification": NOT_VERIFIED,
        },
        "records": records,
    }
    validate_result(result)
    (output_root / "split_candidates.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    (output_root / "summary.md").write_text(
        _summary_markdown(result), encoding="utf-8", newline="\n"
    )
    return result


def validate_result(result):
    if not isinstance(result, dict) or not isinstance(result.get("records"), list):
        raise ValueError("result must contain records")
    required_fields = {
        "figure_index",
        "code_path",
        "code_sha256",
        "source_image_url",
        "source_page",
        "verification",
    }
    ids = []
    for record in result["records"]:
        catalog_id = record.get("catalog_id")
        ids.append(catalog_id)
        if record.get("status") != SPLIT_MATERIALIZED:
            raise ValueError(f"invalid status: {catalog_id}")
        if record.get("candidate_count") != len(record.get("candidates", [])):
            raise ValueError(f"candidate count mismatch: {catalog_id}")
        for candidate in record["candidates"]:
            missing = required_fields - candidate.keys()
            if missing:
                raise ValueError(f"missing candidate fields for {catalog_id}: {sorted(missing)}")
            if len(candidate.get("code_sha256", "")) != 64:
                raise ValueError(f"invalid code hash for {catalog_id}")
            if candidate.get("preview_sha256") and len(candidate["preview_sha256"]) != 64:
                raise ValueError(f"invalid preview hash for {catalog_id}")
            code_path = PurePosixPath(candidate.get("code_path", ""))
            if code_path.is_absolute() or ".." in code_path.parts:
                raise ValueError(f"unsafe code path for {catalog_id}")
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate catalog_id")
    return True


def _summary_markdown(result):
    summary = result["summary"]
    lines = [
        "# Split Materialization",
        "",
        f"Records: {summary['record_count']}.",
        f"Candidates: {summary['candidate_count']}.",
        f"Verification: {summary['verification']}.",
        "",
        "This output contains static file splits only. It has not been executed",
        "on K40 and must not be treated as verified runtime output.",
        "",
        "| Catalog ID | Lang | Candidates |",
        "| --- | --- | ---: |",
    ]
    for record in result["records"]:
        lines.append(
            f"| {record['catalog_id']} | {record['lang']} | {record['candidate_count']} |"
        )
    return "\n".join(lines) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", required=True)
    parser.add_argument("--catalog", required=True)
    parser.add_argument("--images", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)

    workspace = Path(__file__).resolve().parents[1]
    plan_path = Path(args.plan).resolve()
    catalog_path = Path(args.catalog).resolve()
    images_root = Path(args.images).resolve()
    output_root = Path(args.output).resolve()

    for path in (plan_path, catalog_path, images_root, output_root):
        if not _is_relative_to(path, workspace):
            return EXIT_USAGE
    if not plan_path.is_file() or not catalog_path.is_file() or not images_root.is_dir():
        return EXIT_USAGE

    try:
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        source_plan_sha256 = _sha256_file(plan_path)
        result = materialize_plan(plan, catalog_path, images_root, output_root)
        result_path = output_root / "split_candidates.json"
        result["source_plan_sha256"] = source_plan_sha256
        result_path.write_text(
            json.dumps(result, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )
    except (OSError, ValueError, json.JSONDecodeError):
        return EXIT_VALIDATION

    print(f"step_executed=materialize_figure_catalog_splits")
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
