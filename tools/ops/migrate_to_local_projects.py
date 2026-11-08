#!/usr/bin/env python3
"""Migrate legacy Markdown ledgers and project assets into local_projects."""

import argparse
import datetime
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

from local_project_workspace import (
    WorkspaceError,
    atomic_write_text,
    read_jsonl,
    safe_path,
    scaffold,
    workspace_root,
)


SCHEMA_VERSION = 1
LEDGER_DIR = "con_hf/ledger"
LEDGER_NAMES = ("actions", "changes", "errors", "fixes", "pitfalls")
PITFALL_SOURCE = "con_hf/pitfalls_ledger.md"
OPS_SOURCE = "con_hf/ops_ledger.md"
FIGURE_SOURCE = "outputs/figures"
LEGACY_PROJECT_ROOT = "outputs"


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def append_jsonl(path, records):
    """Append validated records without rewriting existing bytes."""
    payload = "".join(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n" for record in records)
    parent = path.parent
    parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(payload)
        handle.flush()


def read_text_lines(path):
    try:
        with path.open("r", encoding="utf-8", newline="") as handle:
            text = handle.read()
    except (OSError, UnicodeError) as cause:
        raise WorkspaceError("cannot read ledger source: %s (%s)" % (path, cause))
    if "\r" in text:
        raise WorkspaceError("ledger source uses CRLF: %s" % path)
    return text.splitlines()


def pitfalls_records(root):
    source = safe_path(root, PITFALL_SOURCE)
    lines = read_text_lines(source)
    headings = []
    pattern = re.compile(r"^#{2,3}\s+(P-\d{2})\s+(.+)$")
    for line_number, line in enumerate(lines, 1):
        match = pattern.match(line)
        if match:
            headings.append((match.group(1), match.group(2).strip(), line_number))
    records = []
    for index, (record_id, title, start) in enumerate(headings):
        end = headings[index + 1][2] - 1 if index + 1 < len(headings) else len(lines)
        body = "\n".join(lines[start - 1:end]).rstrip()
        records.append({
            "id": record_id,
            "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "type": "pitfall",
            "kind": "markdown_migration",
            "title": title,
            "detail": body,
            "evidence": [PITFALL_SOURCE],
            "refs": [],
            "status": "open",
            "source": {
                "file": PITFALL_SOURCE,
                "sha256": sha256_file(source),
                "line_start": start,
                "line_end": end,
                "raw_markdown": body,
            },
        })
    if not records:
        raise WorkspaceError("no pitfall entries found in %s" % PITFALL_SOURCE)
    return records


def ops_records(root):
    source = safe_path(root, OPS_SOURCE)
    lines = read_text_lines(source)
    starts = [index for index, line in enumerate(lines, 1) if line.startswith("- ")]
    records = []
    sequence_by_date = {}
    for index, start in enumerate(starts):
        end = starts[index + 1] - 1 if index + 1 < len(starts) else len(lines)
        raw = "\n".join(lines[start - 1:end]).strip()
        parts = [part.strip() for part in raw[2:].split("|")]
        if len(parts) < 7:
            raise WorkspaceError("ops ledger row does not have expected columns: %s:%d" % (OPS_SOURCE, start))
        ts, status, target, consistency, drift, image, remainder = parts[:7]
        match = re.match(r"^(.+)T\d{2}:\d{2}:\d{2}", ts)
        date_key = match.group(1).replace("-", "") if match else datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d")
        sequence_by_date[date_key] = sequence_by_date.get(date_key, 0) + 1
        record_id = "OPS-%s-%03d" % (date_key, sequence_by_date[date_key])
        records.append({
            "id": record_id,
            "ts": ts,
            "type": "action",
            "kind": "sync",
            "title": "运维同步 %s" % status,
            "detail": raw,
            "status": status,
            "target": target,
            "consistency": consistency,
            "drift": drift,
            "image": image,
            "files": remainder,
            "evidence": [OPS_SOURCE],
            "refs": [],
            "source": {
                "file": OPS_SOURCE,
                "sha256": sha256_file(source),
                "line_start": start,
                "line_end": end,
                "raw_markdown": raw,
            },
        })
    if not records:
        raise WorkspaceError("no ops ledger entries found in %s" % OPS_SOURCE)
    return records


def migrate_ledgers(root):
    ledger_dir = safe_path(root, LEDGER_DIR)
    ledger_dir.mkdir(parents=True, exist_ok=True)
    for name in LEDGER_NAMES:
        path = ledger_dir / (name + ".jsonl")
        if not path.exists():
            atomic_write_text(path, "")

    existing_pitfalls = {record["id"] for record in read_jsonl(safe_path(ledger_dir, "pitfalls.jsonl"))}
    pitfall_payload = pitfalls_records(root)
    missing_pitfalls = [record for record in pitfall_payload if record["id"] not in existing_pitfalls]
    if missing_pitfalls:
        append_jsonl(safe_path(ledger_dir, "pitfalls.jsonl"), missing_pitfalls)

    existing_actions = {record["id"] for record in read_jsonl(safe_path(ledger_dir, "actions.jsonl"))}
    ops_payload = ops_records(root)
    missing_actions = [record for record in ops_payload if record["id"] not in existing_actions]
    if missing_actions:
        append_jsonl(safe_path(ledger_dir, "actions.jsonl"), missing_actions)

    required_pitfalls = {record["id"] for record in pitfall_payload if record["id"] >= "P-01" and record["id"] <= "P-29"}
    preserved = existing_pitfalls | set(required_pitfalls)
    required_ids = {record["id"] for record in pitfall_payload if record["id"] in required_pitfalls}
    if not required_ids <= preserved:
        raise WorkspaceError("pitfall source entries missing after migration: %s" % sorted(required_ids - preserved))
    return {
        "ok": True,
        "command": "ledger",
        "pitfalls_source_entries": len(pitfall_payload),
        "pitfalls_appended": len(missing_pitfalls),
        "actions_source_entries": len(ops_payload),
        "actions_appended": len(missing_actions),
        "preserved_ids": sorted(preserved),
    }


def migrate_project_assets(root, project_id):
    project_root = safe_path(safe_path(root, "local_projects"), project_id)
    scaffold(root, project_id)
    legacy_project = safe_path(root, "%s/%s" % (LEGACY_PROJECT_ROOT, project_id))
    figure_root = safe_path(root, FIGURE_SOURCE)
    sources = [legacy_project if project_id != "default" else figure_root]
    legacy_deliverables = safe_path(root, "deliverables/%s" % project_id)
    if legacy_deliverables.is_dir():
        sources.append(legacy_deliverables)
    copy_plan = []
    for source in sources:
        if not source.exists() or not source.is_dir():
            raise WorkspaceError("migration source is missing: %s" % source)
        for path in source.rglob("*"):
            if path.is_symlink():
                raise WorkspaceError("migration source contains symlink: %s" % path)
            if not path.is_file():
                continue
            rel = path.relative_to(source)
            destination = mapped_destination(project_root, source, rel, project_id)
            copy_plan.append((path, destination, "%s/%s" % (source.name, str(rel).replace("\\", "/"))))

    copied = []
    for source_path, destination, source_key in copy_plan:
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.is_symlink():
            raise WorkspaceError("destination is a symlink: %s" % destination)
        if destination.exists():
            if not destination.is_file() or sha256_file(source_path) != sha256_file(destination):
                raise WorkspaceError("destination differs from source: %s" % destination)
        else:
            shutil.copy2(source_path, destination)
        copied.append({
            "source": source_key,
            "destination": str(destination.relative_to(root)).replace("\\", "/"),
            "sha256": sha256_file(source_path),
            "size": source_path.stat().st_size,
        })

    source_stats = [item for item in copied]
    if len(source_stats) != len(copy_plan):
        raise WorkspaceError("copy count mismatch: expected=%d copied=%d" % (len(copy_plan), len(source_stats)))
    return {
        "ok": True,
        "command": "projects",
        "project_id": project_id,
        "source_file_count": len(copy_plan),
        "copied_file_count": len(copied),
        "source_total_bytes": sum(item["size"] for item in source_stats),
        "manifest_entries": copied,
    }


def mapped_destination(project_root, source, relative, project_id):
    if source.parent.name == "deliverables":
        return project_root / "deliverables" / relative
    if source.name == "figures":
        parts = relative.parts
        if len(parts) >= 2 and parts[0] in ("line1_bulk", "line2_scrna", "line3_spatial"):
            return project_root / "figures" / parts[0] / Path(*parts[1:])
        return project_root / "figures" / relative
    if source.name == project_id:
        parts = relative.parts
        if len(parts) < 2:
            raise WorkspaceError("legacy asset path lacks a line directory: %s" % relative)
        line = parts[0]
        if line not in ("line1_bulk", "line2_scrna", "line3_spatial"):
            raise WorkspaceError("unsupported line directory: %s" % line)
        if len(parts) < 3:
            raise WorkspaceError("legacy asset path lacks a category directory: %s" % relative)
        category = parts[1]
        if category == "figures":
            return project_root / "figures" / line / Path(*parts[2:])
        if category in ("results", "processed", "raw_data"):
            return project_root / "data" / line / category / Path(*parts[2:])
        if category == "deliverables":
            return project_root / "deliverables" / line / Path(*parts[2:])
        if category == "debug":
            return project_root / "debug" / line / Path(*parts[2:])
        raise WorkspaceError("unsupported legacy asset category: %s" % category)
    raise WorkspaceError("unsupported migration source: %s" % source)


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True))


def build_parser():
    parser = argparse.ArgumentParser(description="Migrate legacy ledgers and project assets.")
    parser.add_argument("--root", required=True)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("ledger")
    project_parser = subparsers.add_parser("projects")
    project_parser.add_argument("--project-id", required=True)
    return parser


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        root = workspace_root(args.root)
        if args.command == "ledger":
            payload = migrate_ledgers(root)
        else:
            payload = migrate_project_assets(root, args.project_id)
        emit(payload)
        return 0
    except WorkspaceError as cause:
        emit({"ok": False, "error": str(cause)})
        return 2


if __name__ == "__main__":
    sys.exit(main())
