#!/usr/bin/env python3
"""Build the G3 figure matrix from the ready templates and rendered evidence."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path, PurePosixPath
from typing import Any

REPO = Path(__file__).resolve().parent.parent
TEMPLATE_REGISTRY = REPO / "src" / "figure_templates.json"
SOURCE_MANIFEST = REPO / "src" / "figure_sources" / "manifest.json"
ARTIFACT_AUDIT = (
    REPO
    / "artifacts"
    / "figure-render-20261029"
    / "evidence"
    / "artifact_audit.json"
)
PNG_ROOT = REPO / "artifacts" / "figure-render-20261029" / "outputs" / "figures"
OUTPUT = REPO / "src" / "figure_sources" / "script_plot_matrix.json"
EXPECTED_READY_TEMPLATES = 15
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
PNG_MAGIC_HEX = PNG_MAGIC.hex()
MIN_DPI = 299.0


def fail(message: str) -> None:
    raise SystemExit(f"ERR_SCRIPT_PLOT_MATRIX: {message}")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def load_json(path: Path) -> tuple[dict[str, Any], bytes]:
    if not path.is_file():
        fail(f"missing input: {path.relative_to(REPO).as_posix()}")
    raw = path.read_bytes()
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        fail(f"invalid JSON {path.relative_to(REPO).as_posix()}: {exc}")
    if not isinstance(value, dict):
        fail(f"JSON root is not an object: {path.relative_to(REPO).as_posix()}")
    return value, raw


def relative_posix(path: Path) -> str:
    return path.relative_to(REPO).as_posix()


def normalize_audit_path(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        fail("artifact audit contains an empty output_png")
    normalized = value.replace("\\", "/")
    path = PurePosixPath(normalized)
    if path.is_absolute() or ".." in path.parts:
        fail(f"unsafe artifact audit output path: {value}")
    return path.as_posix()


def inspect_png(path: Path) -> dict[str, Any]:
    if not path.is_file():
        fail(f"missing rendered PNG: {relative_posix(path)}")
    payload = path.read_bytes()
    if payload[:8] != PNG_MAGIC:
        fail(f"PNG magic mismatch: {relative_posix(path)}")
    try:
        from PIL import Image, ImageStat
    except ImportError:
        fail("Pillow is required to derive PNG variance")

    try:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            image.load()
            width, height = image.size
            dpi_value = image.info.get("dpi")
            variance = ImageStat.Stat(image.convert("RGB")).var
    except Exception as exc:
        fail(f"PNG decode failed for {relative_posix(path)}: {type(exc).__name__}: {exc}")

    if not isinstance(dpi_value, (tuple, list)) or len(dpi_value) < 2:
        fail(f"PNG DPI metadata missing: {relative_posix(path)}")
    dpi = [round(float(dpi_value[0]), 3), round(float(dpi_value[1]), 3)]
    pixel_variance = round(max(float(item) for item in variance), 6)
    if width <= 0 or height <= 0:
        fail(f"invalid PNG dimensions: {relative_posix(path)}")
    if min(dpi) < MIN_DPI:
        fail(f"PNG DPI below {MIN_DPI}: {relative_posix(path)}")
    if pixel_variance <= 0:
        fail(f"PNG pixel variance is zero: {relative_posix(path)}")

    return {
        "png_sha256": sha256_bytes(payload),
        "size_bytes": len(payload),
        "png_magic": PNG_MAGIC_HEX,
        "width": width,
        "height": height,
        "dpi": dpi,
        "pixel_variance": pixel_variance,
    }


def main() -> int:
    registry, registry_raw = load_json(TEMPLATE_REGISTRY)
    manifest, manifest_raw = load_json(SOURCE_MANIFEST)
    audit, audit_raw = load_json(ARTIFACT_AUDIT)

    templates = registry.get("templates")
    if not isinstance(templates, list):
        fail("figure_templates.templates is not a list")
    ready = [item for item in templates if item.get("deps_status") == "ready"]
    if len(ready) != EXPECTED_READY_TEMPLATES:
        fail(f"expected {EXPECTED_READY_TEMPLATES} ready templates, got {len(ready)}")

    manifest_sources = manifest.get("sources")
    if not isinstance(manifest_sources, list):
        fail("figure source manifest.sources is not a list")
    source_by_id = {item.get("template_id"): item for item in manifest_sources}
    if len(source_by_id) != len(manifest_sources):
        fail("duplicate template_id in figure source manifest")

    audit_figures = audit.get("figures")
    if not isinstance(audit_figures, list):
        fail("artifact_audit.figures is not a list")
    audit_by_id = {item.get("template_id"): item for item in audit_figures}
    if len(audit_by_id) != len(audit_figures):
        fail("duplicate template_id in artifact audit")

    ready_ids = {str(item.get("id") or "") for item in ready}
    if "" in ready_ids:
        fail("ready template contains an empty id")
    if set(source_by_id) != ready_ids:
        fail("figure source manifest does not align with ready templates")
    if set(audit_by_id) != ready_ids:
        fail("artifact audit does not align with ready templates")

    entries: list[dict[str, Any]] = []
    for template in sorted(ready, key=lambda item: str(item["id"])):
        template_id = str(template["id"])
        source_spec = source_by_id[template_id]
        audit_figure = audit_by_id[template_id]
        if audit_figure.get("status") != "PASS":
            fail(f"artifact audit is not PASS: {template_id}")

        source_value = source_spec.get("source")
        source_hash = source_spec.get("source_sha256")
        if not isinstance(source_value, str) or not isinstance(source_hash, str):
            fail(f"manifest source fields are incomplete: {template_id}")
        source_path = (REPO / source_value).resolve()
        try:
            source_path.relative_to(REPO.resolve())
        except ValueError:
            fail(f"source path escapes the repository: {template_id}")
        if not source_path.is_file():
            fail(f"source file missing: {template_id}")
        actual_source_hash = sha256_file(source_path)
        if actual_source_hash != source_hash:
            fail(f"source SHA256 mismatch: {template_id}")

        output_png = normalize_audit_path(audit_figure.get("output_png"))
        png_path = (PNG_ROOT / Path(*PurePosixPath(output_png).parts)).resolve()
        try:
            png_path.relative_to(PNG_ROOT.resolve())
        except ValueError:
            fail(f"rendered PNG escapes evidence root: {template_id}")
        png = inspect_png(png_path)

        metrics = audit_figure.get("metrics") or {}
        if metrics.get("width_px") != png["width"] or metrics.get("height_px") != png["height"]:
            fail(f"audit dimensions disagree with PNG: {template_id}")
        audit_dpi = metrics.get("dpi")
        if not isinstance(audit_dpi, (int, float)):
            fail(f"audit DPI is missing: {template_id}")
        if any(abs(value - float(audit_dpi)) > 0.01 for value in png["dpi"]):
            fail(f"audit DPI disagrees with PNG: {template_id}")

        entries.append(
            {
                "entry_id": template_id,
                "template_id": template_id,
                "name": template.get("name"),
                "template_name": template.get("name"),
                "status": "pass",
                "language": template.get("language"),
                "source_path": source_value,
                "source_sha256": source_hash,
                "png_path": f"artifacts/figure-render-20261029/outputs/figures/{output_png}",
                **png,
                "canonical_output": audit_figure.get("canonical_output"),
                "line_id": PurePosixPath(output_png).parts[0],
                "audit_status": audit_figure.get("status"),
            }
        )

    output = {
        "schema_version": 1,
        "generated_from": {
            "template_registry": relative_posix(TEMPLATE_REGISTRY),
            "source_manifest": relative_posix(SOURCE_MANIFEST),
            "artifact_audit": relative_posix(ARTIFACT_AUDIT),
            "png_root": relative_posix(PNG_ROOT),
        },
        "input_sha256": {
            "template_registry": sha256_bytes(registry_raw),
            "source_manifest": sha256_bytes(manifest_raw),
            "artifact_audit": sha256_bytes(audit_raw),
        },
        "summary": {
            "ready_templates": len(ready),
            "entries": len(entries),
            "pngs": len(entries),
            "invalid": 0,
        },
        "entries": entries,
    }
    OUTPUT.write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(
        f"script_plot_matrix=OK ready_templates={len(ready)} "
        f"entries={len(entries)} output={relative_posix(OUTPUT)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
