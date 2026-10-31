#!/usr/bin/env python3
"""Build project indexes from append-only JSONL ledgers and machine logs."""

import argparse
import datetime
import json
import sys
from pathlib import Path

from local_project_workspace import (
    LEDGER_NAMES,
    STATUS_LEDGERS,
    WorkspaceError,
    atomic_write_text,
    count_files,
    ledger_summary,
    local_projects_dir,
    project_path,
    project_root_for,
    project_roots,
    safe_path,
    workspace_root,
)


SCHEMA_VERSION = 1
INDEXER = "ops/ledger_indexer.py"
SYSTEM_LOGS_DIR = "outputs/system_logs"


def normalize_refs(record, path):
    """Normalize refs to a stable list and reject malformed link payloads."""
    refs = record.get("refs", [])
    if refs is None:
        refs = []
    if isinstance(refs, str):
        refs = [refs]
    if not isinstance(refs, list) or any(not isinstance(ref, str) or not ref.strip() for ref in refs):
        raise WorkspaceError("refs must be a list of non-empty strings: %s" % path)
    refs = [ref.strip() for ref in refs]
    unique = []
    for ref in refs:
        if ref not in unique:
            unique.append(ref)
    record["refs"] = unique
    return record


def read_ledger(path):
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
                if not isinstance(record, dict) or not isinstance(record.get("id"), str) or not record["id"].strip():
                    raise WorkspaceError(
                        "invalid JSONL record: %s:%d (id must be a non-empty string)" % (path, line_number)
                    )
                normalize_refs(record, "%s:%d" % (path, line_number))
                records.append(record)
    except (OSError, UnicodeError, json.JSONDecodeError) as cause:
        raise WorkspaceError("corrupt JSONL: %s (%s)" % (path, cause))
    return records


def aggregate_records(records):
    by_id = {}
    for record in records:
        by_id[record["id"]] = record
    return [by_id[record_id] for record_id in sorted(by_id)]


def build_issue_view(ledger_dir):
    errors = aggregate_records(read_ledger(project_path(ledger_dir, "errors.jsonl")))
    fixes = aggregate_records(read_ledger(project_path(ledger_dir, "fixes.jsonl")))
    errors_by_id = {record["id"]: record for record in errors}
    fixes_by_id = {record["id"]: record for record in fixes}
    issues = []
    for error in errors:
        linked_fixes = [
            fix
            for fix in fixes
            if fix["id"] in error["refs"] or error["id"] in fix["refs"]
        ]
        issues.append({
            "id": error["id"],
            "status": error.get("status"),
            "refs": error["refs"],
            "related_fixes": linked_fixes,
        })
    for fix in fixes:
        linked_errors = [
            error
            for error in errors
            if error["id"] in fix["refs"] or fix["id"] in error["refs"]
        ]
        issues.append({
            "id": fix["id"],
            "status": fix.get("status"),
            "refs": fix["refs"],
            "related_errors": linked_errors,
        })
    return issues


def system_log_payload(path):
    try:
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, UnicodeError, json.JSONDecodeError) as cause:
        raise WorkspaceError("corrupt machine log: %s (%s)" % (path, cause))
    if not isinstance(payload, dict) or not isinstance(payload.get("task_id"), str) or not payload["task_id"].strip():
        raise WorkspaceError("machine log requires a non-empty task_id: %s" % path)
    return payload


def scan_system_logs(root, project_id):
    log_dir = safe_path(root, SYSTEM_LOGS_DIR)
    files = []
    if log_dir.exists():
        for path in sorted(log_dir.iterdir(), key=lambda item: item.name):
            if not path.is_file() or path.is_symlink() or path.suffix != ".json":
                continue
            payload = system_log_payload(path)
            payload_project = payload.get("project_id")
            if not isinstance(payload_project, str) or not payload_project.strip():
                payload_project = "default"
            if payload_project != project_id:
                continue
            files.append({
                "file": "%s/%s" % (SYSTEM_LOGS_DIR, path.name),
                "task_id": payload["task_id"],
                "line_id": payload.get("line_id"),
                "step_name": payload.get("step_name"),
                "status": payload.get("status"),
            })
    return {
        "path": SYSTEM_LOGS_DIR,
        "count": len(files),
        "entries": files,
    }


def project_root_by_id(root, project_id):
    candidates = [path.name for path in project_roots(root)]
    if project_id not in candidates:
        raise WorkspaceError("project not found: %s" % project_id)
    return project_root_for(root, project_id)


def render_project_readme(index):
    machine_logs = index["machine_logs"]
    lines = [
        "# %s" % index["project_id"],
        "",
        "> 本 README 由 `%s` 生成。" % INDEXER,
        "",
        "## 产物索引",
        "",
        "| 类别 | 文件数 |",
        "|---|---:|",
    ]
    for category in ("data", "figures", "deliverables", "debug"):
        lines.append("| %s | %d |" % (category, index["artifact_counts"].get(category, 0)))
    lines.extend(
        [
            "",
            "## 台账索引",
            "",
            "| ledger | 记录数 |",
            "|---|---:|",
        ]
    )
    for name in LEDGER_NAMES:
        lines.append("| %s | %d |" % (name, index["ledger_summary"][name]["records"]))
    lines.extend(
        [
            "",
            "## 机器台账",
            "",
            "机器日志：`outputs/system_logs/`，条目数：`%d`。" % machine_logs["count"],
            "",
            "机读索引：`INDEX.json`。",
            "",
        ]
    )
    return "\n".join(lines)


def build_project_index(root, project_id):
    project_root = project_root_by_id(root, project_id)
    ledger_dir = project_path(project_root, "ledger")
    summary = ledger_summary(ledger_dir)
    artifact_counts = {
        "data": count_files(project_path(project_root, "data")),
        "figures": count_files(project_path(project_root, "figures")),
        "deliverables": count_files(project_path(project_root, "deliverables")),
        "debug": count_files(project_path(project_root, "debug")),
    }
    index = {
        "schema_version": SCHEMA_VERSION,
        "project_id": project_id,
        "generated_by": INDEXER,
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "path_map": {
            "project": "local_projects/%s" % project_id,
            "project_json": "project.json",
            "readme": "README.md",
            "index": "INDEX.json",
            "data": "data",
            "figures": "figures",
            "deliverables": "deliverables",
            "debug": "debug",
            "ledger": "ledger",
        },
        "artifact_counts": artifact_counts,
        "ledger_summary": summary,
        "issues": build_issue_view(ledger_dir),
        "machine_logs": scan_system_logs(root, project_id),
    }
    atomic_write_text(project_path(project_root, "INDEX.json"), json.dumps(index, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    atomic_write_text(project_path(project_root, "README.md"), render_project_readme(index))
    return index


def render_global_index(indexes):
    lines = [
        "# 本地项目索引",
        "",
        "> 本文件由 `%s` 生成，禁止手改。" % INDEXER,
        "",
        "| project_id | data | figures | deliverables | debug | ledger records | machine logs |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    machine = []
    for index in indexes:
        ledger_records = sum(
            len(summary.get("aggregated", []))
            for summary in index["ledger_summary"].values()
        )
        counts = index["artifact_counts"]
        lines.append(
            "| %s | %s | %s | %s | %s | %s | %s |" % (
                index["project_id"],
                counts.get("data", 0),
                counts.get("figures", 0),
                counts.get("deliverables", 0),
                counts.get("debug", 0),
                ledger_records,
                index["machine_logs"]["count"],
            )
        )
        machine.append({
            "project_id": index["project_id"],
            "artifact_counts": index["artifact_counts"],
            "ledger_records": ledger_records,
            "machine_log_count": index["machine_logs"]["count"],
        })
    lines.extend(
        [
            "",
            "## 机读视图",
            "",
            "```json",
            json.dumps({"schema_version": SCHEMA_VERSION, "projects": machine}, ensure_ascii=False, indent=2),
            "```",
            "",
        ]
    )
    return "\n".join(lines)


def build_global_index(root, indexes):
    global_index_path = safe_path(local_projects_dir(root), "INDEX.md")
    local_projects_dir(root).mkdir(parents=True, exist_ok=True)
    atomic_write_text(global_index_path, render_global_index(indexes))
    return global_index_path


def index_workspace(root, requested_project_id=None):
    selected = [(path.name, path) for path in project_roots(root)]
    if requested_project_id and requested_project_id not in {name for name, _ in selected}:
        raise WorkspaceError("project not found: %s" % requested_project_id)
    indexes = [build_project_index(root, project_id) for project_id, _ in selected]
    global_path = build_global_index(root, indexes)
    return {
        "ok": True,
        "command": "index",
        "projects": [index["project_id"] for index in indexes],
        "global_index": global_path.relative_to(root).as_posix(),
        "ledger_status_policy": {
            name: ("last_by_id" if name in STATUS_LEDGERS else "none")
            for name in LEDGER_NAMES
        },
    }


def build_parser():
    parser = argparse.ArgumentParser(description="Index self-contained local project ledgers.")
    parser.add_argument("--root", required=True)
    subparsers = parser.add_subparsers(dest="command", required=True)
    index_parser = subparsers.add_parser("index")
    index_parser.add_argument("--project-id")
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
        payload = index_workspace(root, args.project_id)
        print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
        return 0
    except WorkspaceError as cause:
        print(json.dumps({"ok": False, "error": str(cause)}, ensure_ascii=False, sort_keys=True))
        return 2


if __name__ == "__main__":
    sys.exit(main())
