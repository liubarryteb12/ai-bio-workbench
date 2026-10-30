#!/usr/bin/env python3
"""Create and audit the self-contained local project workspace.

This tool is the K40-side contract for the planned ``local_projects/`` tree.
It never migrates legacy ``outputs/`` or ``projects/`` data.
"""

import argparse
import datetime
import json
import os
import re
import sys
import tempfile
from pathlib import Path


LINES = ("line1_bulk", "line2_scrna", "line3_spatial")
LEDGER_NAMES = ("actions", "changes", "errors", "fixes", "pitfalls")
STATUS_LEDGERS = {"errors", "fixes"}
SCHEMA_VERSION = 1
COMPATIBLE_PROJECT_SCHEMA_VERSIONS = frozenset((1, 3))
REPO_ROOT = Path(__file__).resolve().parents[1]
QA_ROOT = REPO_ROOT / "artifacts" / "local_project_workspace_tests"


class WorkspaceError(Exception):
    """A contract violation that must surface as exit code 2."""


def sanitize_project_id(value):
    """Validate a safe workspace project ID without importing server code."""
    raw = str(value or "").strip()
    if not raw or len(raw) > 64 or raw in ("", ".", "..") or raw.startswith("."):
        return None
    if not re.fullmatch(r"[A-Za-z0-9._-]+", raw):
        return None
    return raw


def assert_no_symlink(path):
    """Reject symlinked ancestors so a path cannot silently leave the workspace."""
    current = Path(path)
    for candidate in [current] + list(current.parents):
        if candidate.is_symlink():
            raise WorkspaceError("symlink path component is not allowed: %s" % candidate)


def safe_path(base, relative):
    """Resolve a workspace-relative path and reject escape or symlink escape."""
    base = Path(base).absolute()
    candidate = Path(os.path.abspath(str(Path(base) / relative)))
    try:
        candidate.relative_to(base)
    except ValueError:
        raise WorkspaceError("path escapes workspace root: %s" % relative)
    assert_no_symlink(base)
    assert_no_symlink(candidate)
    return candidate


def workspace_root(raw_root, extra_allowed_roots=()):
    if raw_root is None or not str(raw_root).strip():
        raise WorkspaceError("workspace root is required")
    raw_path = Path(str(raw_root)).expanduser()
    raw_abs = Path(os.path.abspath(str(raw_path)))
    assert_no_symlink(raw_abs)
    normalized = raw_abs.resolve(strict=False)
    assert_no_symlink(normalized)
    allowed = normalized == REPO_ROOT or normalized.is_relative_to(QA_ROOT)
    for extra_root in extra_allowed_roots:
        extra = Path(os.path.abspath(str(extra_root)))
        if normalized == extra or normalized.is_relative_to(extra):
            allowed = True
            break
    if REPO_ROOT == Path("/mnt/ssd/bio_data") and normalized.is_relative_to(
        Path("/mnt/ssd/bio_data/tmp/qa_local_workspace")
    ):
        allowed = True
    if not allowed:
        raise WorkspaceError("workspace root outside allowed workspace roots: %s" % normalized)
    if not normalized.exists() or not normalized.is_dir():
        raise WorkspaceError("workspace root does not exist or is not a directory: %s" % normalized)
    return normalized


def local_projects_dir(root):
    return safe_path(root, "local_projects")


def project_root_for(root, project_id):
    safe_id = sanitize_project_id(project_id)
    if not safe_id:
        raise WorkspaceError("invalid project_id: %r" % (project_id,))
    return safe_path(local_projects_dir(root), safe_id)


def project_path(project_root, relative):
    return safe_path(project_root, relative)


def global_ledger_dir(root):
    return safe_path(root, "con_hf/ledger")


def ensure_directory(path):
    assert_no_symlink(path)
    if path.exists() and not path.is_dir():
        raise WorkspaceError("workspace path is not a directory: %s" % path)
    path.mkdir(parents=True, exist_ok=True)


def ensure_empty_file(path, text):
    assert_no_symlink(path)
    if path.exists():
        if not path.is_file():
            raise WorkspaceError("workspace path is not a file: %s" % path)
        return False
    atomic_write_text(path, text)
    return True


def ensure_json_file(path, payload):
    assert_no_symlink(path)
    if path.exists():
        if not path.is_file():
            raise WorkspaceError("workspace path is not a file: %s" % path)
        return False
    write_json(path, payload)
    return True


def write_json(path, payload):
    atomic_write_text(
        path,
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
    )


def atomic_write_text(path, text):
    path = Path(path)
    assert_no_symlink(path)
    payload = text.encode("utf-8")
    descriptor = None
    tmp = None
    try:
        descriptor, tmp_name = tempfile.mkstemp(
            prefix=path.name + ".",
            suffix=".tmp",
            dir=str(path.parent),
        )
        tmp = Path(tmp_name)
        if hasattr(os, "fchmod"):
            os.fchmod(descriptor, 0o644)
        with os.fdopen(descriptor, "wb") as handle:
            descriptor = None
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        if not hasattr(os, "fchmod"):
            os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if tmp is not None and tmp.exists():
            tmp.unlink()


def read_json(path):
    assert_no_symlink(path)
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, UnicodeError, json.JSONDecodeError) as cause:
        raise WorkspaceError("corrupt JSON: %s (%s)" % (path, cause))


def project_meta_from_disk(path):
    payload = read_json(path)
    if not isinstance(payload, dict):
        raise WorkspaceError("project.json is not an object: %s" % path)
    return payload


def existing_project_id(payload):
    for key in ("project_id", "id"):
        if isinstance(payload.get(key), str) and payload[key].strip():
            return payload[key].strip()
    return None


def create_project_payload(project_id):
    return {
        "schema_version": SCHEMA_VERSION,
        "project_id": project_id,
        "name": project_id,
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "lines": list(LINES),
    }


def scaffold(root, project_id):
    safe_id = sanitize_project_id(project_id)
    if not safe_id:
        raise WorkspaceError("invalid project_id: %r" % (project_id,))

    projects_dir = local_projects_dir(root)
    project_root = safe_path(projects_dir, safe_id)
    if project_root.is_symlink():
        raise WorkspaceError("project root is a symlink: %s" % project_root)

    meta_path = project_path(project_root, "project.json")
    if meta_path.exists():
        existing = project_meta_from_disk(meta_path)
        old_id = existing_project_id(existing)
        if old_id != safe_id:
            raise WorkspaceError("project_id mismatch: existing=%s requested=%s" % (old_id, safe_id))

    created = []
    ensure_directory(project_root)
    for name in ("data", "figures", "deliverables", "debug", "ledger"):
        path = project_path(project_root, name)
        if not path.exists():
            ensure_directory(path)
            created.append(str(path.relative_to(project_root)))

    for line in LINES:
        for subdir in ("processed", "results"):
            ensure_directory(project_path(project_root, "data/%s/%s" % (line, subdir)))
        ensure_directory(project_path(project_root, "figures/%s" % line))
    ensure_directory(project_path(project_root, "figures/adapt"))

    if ensure_json_file(meta_path, create_project_payload(safe_id)):
        created.append("project.json")
    if ensure_empty_file(project_path(project_root, "handoff.md"), "# 项目交接\n\n- 下一步：\n- 已知坑：\n"):
        created.append("handoff.md")
    if ensure_empty_file(
        project_path(project_root, "README.md"),
        "# 项目索引\n\n- 台账入口：ledger/\n- 产物入口：data/ 与 figures/\n- 交付入口：deliverables/\n",
    ):
        created.append("README.md")

    ledger_dir = project_path(project_root, "ledger")
    for name in LEDGER_NAMES:
        if ensure_empty_file(ledger_dir / (name + ".jsonl"), ""):
            created.append("ledger/%s.jsonl" % name)

    empty_index = {
        "schema_version": SCHEMA_VERSION,
        "project_id": safe_id,
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "path_map": {},
        "artifact_counts": {},
        "ledger_summary": {},
    }
    if ensure_json_file(project_path(project_root, "INDEX.json"), empty_index):
        created.append("INDEX.json")

    ledger_dir = global_ledger_dir(root)
    ensure_directory(ledger_dir)
    for name in LEDGER_NAMES:
        ensure_empty_file(ledger_dir / (name + ".jsonl"), "")

    return {
        "ok": True,
        "command": "scaffold",
        "root": str(root),
        "project_id": safe_id,
        "created": sorted(created),
        "kept_existing": True,
    }


def read_jsonl(path):
    records = []
    if not path.exists():
        return records
    try:
        with path.open("r", encoding="utf-8") as handle:
            for line_number, raw_line in enumerate(handle, 1):
                line = raw_line.strip()
                if not line:
                    continue
                record = json.loads(line)
                if not isinstance(record, dict) or not isinstance(
                    record.get("id"), str
                ) or not record["id"].strip():
                    raise WorkspaceError(
                        "invalid JSONL record: %s:%d (id must be a non-empty string)"
                        % (path, line_number)
                    )
                records.append(record)
    except (OSError, UnicodeError, json.JSONDecodeError) as cause:
        raise WorkspaceError("corrupt JSONL: %s (%s)" % (path, cause))
    return records


def aggregate_jsonl(records):
    by_id = {}
    for record in records:
        by_id[record["id"]] = record
    return list(by_id.values())


def ledger_summary(ledger_dir):
    result = {}
    for name in LEDGER_NAMES:
        path = project_path(ledger_dir, name + ".jsonl")
        if not path.exists() or not path.is_file() or path.is_symlink():
            raise WorkspaceError("missing ledger file: %s" % path)
        records = read_jsonl(path)
        aggregated = aggregate_jsonl(records)
        summary = {
            "path": "ledger/%s.jsonl" % name,
            "records": len(records),
            "aggregated": aggregated,
        }
        if name not in STATUS_LEDGERS:
            summary["status_policy"] = "none"
        result[name] = summary
    return result


def count_files(path):
    if not path.exists() or not path.is_dir():
        return 0
    total = 0
    for candidate in path.iterdir():
        if candidate.is_symlink():
            raise WorkspaceError("symlink path component is not allowed: %s" % candidate)
        if candidate.is_dir():
            total += count_files(candidate)
        elif candidate.is_file() and candidate.name != ".gitkeep":
            total += 1
    return total


def project_index(root, project_id):
    project_root = project_root_for(root, project_id)
    validate_project(root, project_id)
    meta_path = project_path(project_root, "project.json")
    meta = project_meta_from_disk(meta_path)
    disk_id = existing_project_id(meta)
    if disk_id != project_id:
        raise WorkspaceError("project_id mismatch: existing=%s requested=%s" % (disk_id, project_id))

    path_map = {
        "project": str(project_root.relative_to(root)),
        "project_json": "project.json",
        "handoff": "handoff.md",
        "readme": "README.md",
        "data": "data",
        "figures": "figures",
        "figure_adapt": "figures/adapt",
        "deliverables": "deliverables",
        "debug": "debug",
        "ledger": "ledger",
        "index": "INDEX.json",
    }
    for line in LINES:
        path_map["data/%s" % line] = "data/%s" % line
        path_map["figures/%s" % line] = "figures/%s" % line

    artifact_counts = {
        "data": count_files(project_path(project_root, "data")),
        "figures": count_files(project_path(project_root, "figures")),
        "deliverables": count_files(project_path(project_root, "deliverables")),
        "debug": count_files(project_path(project_root, "debug")),
    }
    for line in LINES:
        artifact_counts["data/%s" % line] = count_files(
            project_path(project_root, "data/%s" % line)
        )
        artifact_counts["figures/%s" % line] = count_files(
            project_path(project_root, "figures/%s" % line)
        )

    index = {
        "schema_version": SCHEMA_VERSION,
        "project_id": project_id,
        "created_at": meta.get("created_at"),
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "path_map": path_map,
        "artifact_counts": artifact_counts,
        "ledger_summary": ledger_summary(project_path(project_root, "ledger")),
    }
    write_json(project_path(project_root, "INDEX.json"), index)
    return index


def project_roots(root):
    projects_dir = local_projects_dir(root)
    if not projects_dir.exists():
        return []
    entries = []
    for child in projects_dir.iterdir():
        if child.name == "INDEX.md":
            continue
        if child.is_symlink():
            raise WorkspaceError("project workspace is a symlink: %s" % child)
        if not child.is_dir():
            raise WorkspaceError("local project workspace is not a directory: %s" % child)
        meta_path = child / "project.json"
        if not meta_path.is_file() or meta_path.is_symlink():
            raise WorkspaceError("missing project.json for %s" % child.name)
        entries.append(child)
    return sorted(entries, key=lambda item: item.name)


def render_global_index(root, indexes):
    lines = [
        "# 本地项目索引",
        "",
        "> 本文件由 `ops/local_project_workspace.py` 生成，禁止手改。",
        "",
        "| project_id | data_files | figure_files | deliverable_files | debug_files | ledger_records |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    machine = []
    for index in indexes:
        counts = index["artifact_counts"]
        ledger_records = sum(
            summary.get("records", 0) for summary in index["ledger_summary"].values()
        )
        lines.append(
            "| %s | %s | %s | %s | %s | %s |"
            % (
                index["project_id"],
                counts.get("data", 0),
                counts.get("figures", 0),
                counts.get("deliverables", 0),
                counts.get("debug", 0),
                ledger_records,
            )
        )
        machine.append(
            {
                "project_id": index["project_id"],
                "path_map": index["path_map"],
                "artifact_counts": index["artifact_counts"],
                "ledger_records": ledger_records,
            }
        )
    lines.extend(
        [
            "",
            "## 机器可读视图",
            "",
            "```json",
            json.dumps({"schema_version": SCHEMA_VERSION, "projects": machine}, ensure_ascii=False, indent=2),
            "```",
            "",
        ]
    )
    text = "\n".join(lines)
    path = safe_path(local_projects_dir(root), "INDEX.md")
    atomic_write_text(path, text)
    return path


def build_index(root, requested_project_id=None):
    safe_requested_id = None
    if requested_project_id is not None:
        safe_requested_id = sanitize_project_id(requested_project_id)
        if not safe_requested_id:
            raise WorkspaceError("invalid project_id: %r" % (requested_project_id,))
    selected = [(project_path.name, project_path) for project_path in project_roots(root)]
    if safe_requested_id and safe_requested_id not in {name for name, _ in selected}:
        raise WorkspaceError("requested project not found: %s" % safe_requested_id)
    indexes = [project_index(root, project_id) for project_id, project_path in selected]
    global_path = render_global_index(root, indexes)
    return {
        "ok": True,
        "command": "index",
        "root": str(root),
        "projects": [index["project_id"] for index in indexes],
        "global_index": str(global_path.relative_to(root)),
    }


def validate_project(root, project_id):
    project_root = project_root_for(root, project_id)
    if not project_root.is_dir() or project_root.is_symlink():
        raise WorkspaceError("project root missing or symlinked: %s" % project_root)
    meta_path = project_root / "project.json"
    meta = project_meta_from_disk(meta_path)
    disk_id = existing_project_id(meta)
    if disk_id != project_id:
        raise WorkspaceError("project_id mismatch: existing=%s requested=%s" % (disk_id, project_id))
    if meta.get("schema_version") not in COMPATIBLE_PROJECT_SCHEMA_VERSIONS:
        raise WorkspaceError("project schema_version mismatch for %s" % project_id)
    if meta.get("lines") != list(LINES):
        raise WorkspaceError("project lines mismatch for %s" % project_id)
    for name in ("README.md", "handoff.md"):
        path = project_root / name
        if not path.is_file() or path.is_symlink():
            raise WorkspaceError("missing project file or symlinked file: %s" % path)
    for name in ("data", "figures", "deliverables", "debug", "ledger"):
        path = project_root / name
        if not path.exists() or not path.is_dir() or path.is_symlink():
            raise WorkspaceError("missing project directory: %s" % path)
    for line in LINES:
        for subdir in ("processed", "results"):
            path = project_root / "data" / line / subdir
            if not path.exists() or not path.is_dir() or path.is_symlink():
                raise WorkspaceError("missing project data directory: %s" % path)
        path = project_root / "figures" / line
        if not path.exists() or not path.is_dir() or path.is_symlink():
            raise WorkspaceError("missing project figure directory: %s" % path)
    path = project_root / "figures" / "adapt"
    if not path.exists() or not path.is_dir() or path.is_symlink():
        raise WorkspaceError("missing project figure adapt directory: %s" % path)
    if not (project_root / "INDEX.json").is_file():
        raise WorkspaceError("missing project INDEX.json")
    summary = ledger_summary(project_root / "ledger")
    return {
        "project_id": project_id,
        "path_map": {
            "data": "data",
            "figures": "figures",
            "deliverables": "deliverables",
            "debug": "debug",
            "ledger": "ledger",
        },
        "artifact_counts": {
            "data": count_files(project_root / "data"),
            "figures": count_files(project_root / "figures"),
            "deliverables": count_files(project_root / "deliverables"),
            "debug": count_files(project_root / "debug"),
        },
        "ledger_summary": summary,
    }


def validate(root, requested_project_id=None):
    projects = []
    if requested_project_id:
        safe_id = sanitize_project_id(requested_project_id)
        if not safe_id:
            raise WorkspaceError("invalid project_id: %r" % (requested_project_id,))
        projects.append(validate_project(root, safe_id))
    else:
        for project_path in project_roots(root):
            projects.append(validate_project(root, project_path.name))

    global_ledger = ledger_summary(global_ledger_dir(root))
    return {
        "ok": True,
        "command": "validate",
        "root": str(root),
        "projects": projects,
        "global_ledger_summary": global_ledger,
    }


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True))


def build_parser():
    parser = argparse.ArgumentParser(
        description="Scaffold, index, and validate the self-contained local workspace."
    )
    parser.add_argument("--root", required=True)
    subparsers = parser.add_subparsers(dest="command", required=True)

    scaffold_parser = subparsers.add_parser("scaffold")
    scaffold_parser.add_argument("--project-id", required=True)
    for name in ("index", "validate"):
        command_parser = subparsers.add_parser(name)
        command_parser.add_argument("--project-id")
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
        if args.command == "scaffold":
            payload = scaffold(root, args.project_id)
        elif args.command == "index":
            payload = build_index(root, args.project_id)
        elif args.command == "validate":
            payload = validate(root, args.project_id)
        else:
            raise WorkspaceError("unknown command: %s" % args.command)
        emit(payload)
        return 0
    except WorkspaceError as cause:
        emit({"ok": False, "error": str(cause)})
        return 2


if __name__ == "__main__":
    sys.exit(main())
