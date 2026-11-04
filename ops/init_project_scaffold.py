#!/usr/bin/env python3
"""Initialize one self-contained local project without overwriting user files."""

import argparse
import datetime
import json
import os
import re
import sys
from pathlib import Path

from local_project_workspace import (
    LEDGER_NAMES,
    LINES,
    REPO_ROOT,
    SCHEMA_VERSION,
    WorkspaceError,
    assert_no_symlink,
    ensure_directory,
    ensure_empty_file,
    ensure_json_file,
    safe_path,
    sanitize_project_id,
    workspace_root,
)


SYNC_DIRS = ("inbox", "outbox")
TICKET_PATTERN = re.compile(r"[A-Za-z0-9._-]{1,80}")
QA_ROOT = REPO_ROOT / "artifacts" / "project_scaffold_tests"


def extra_allowed_roots():
    """从环境变量读「本次运行显式信任的额外根」。

    为什么需要它：测试要在并发下互不干扰，必须每次用进程独有的根目录
    （artifacts/project_scaffold_tests_<pid>_<rand>）。但 workspace_root 的白名单
    只认固定的 QA_ROOT，于是隔离后的根会被判越界、退出码 2。
    这里不放宽默认白名单，只增加一条**显式**通道：谁要额外根，谁自己用环境变量声明。
    """
    raw = os.environ.get("BIO_SCAFFOLD_ALLOWED_ROOTS", "")
    roots = []
    for part in raw.split(os.pathsep):
        part = part.strip()
        if part:
            roots.append(Path(part).resolve())
    return tuple(roots)


def validate_ticket(ticket):
    if ticket is None:
        return None
    value = str(ticket).strip()
    if not value or not TICKET_PATTERN.fullmatch(value):
        raise WorkspaceError("invalid ticket id: %r" % (ticket,))
    return value


def local_now():
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def project_payload(project_id, line, ticket_id):
    return {
        "schema_version": SCHEMA_VERSION,
        "project_id": project_id,
        "ticket_id": ticket_id,
        "name": project_id,
        "line": line,
        "lines": list(LINES),
        "created_at": local_now(),
    }


def index_payload(project_id):
    return {
        "schema_version": SCHEMA_VERSION,
        "project_id": project_id,
        "generated_at": local_now(),
        "path_map": {
            "data": "data",
            "figures": "figures",
            "figure_adapt": "figures/adapt",
            "deliverables": "deliverables",
            "debug": "debug",
            "ledger": "ledger",
        },
        "artifact_counts": {
            "data": 0,
            "figures": 0,
            "deliverables": 0,
            "debug": 0,
        },
        "ledger_summary": {},
    }


def read_project_meta(path, project_id, line):
    try:
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, UnicodeError, json.JSONDecodeError) as cause:
        raise WorkspaceError("corrupt project.json: %s (%s)" % (path, cause))
    if not isinstance(payload, dict):
        raise WorkspaceError("project.json is not an object: %s" % path)
    disk_id = payload.get("project_id", payload.get("id"))
    if disk_id != project_id:
        raise WorkspaceError(
            "project_id mismatch: existing=%s requested=%s" % (disk_id, project_id)
        )
    disk_line = payload.get("line")
    if disk_line is not None and disk_line != line:
        raise WorkspaceError(
            "project line mismatch: existing=%s requested=%s" % (disk_line, line)
        )
    return payload


def read_actions(path):
    records = []
    if not path.exists():
        return records
    try:
        with path.open("r", encoding="utf-8") as handle:
            for line_number, raw_line in enumerate(handle, 1):
                value = raw_line.strip()
                if not value:
                    continue
                record = json.loads(value)
                if not isinstance(record, dict):
                    raise WorkspaceError(
                        "invalid actions record: %s:%d" % (path, line_number)
                    )
                records.append(record)
    except (OSError, UnicodeError, json.JSONDecodeError) as cause:
        raise WorkspaceError("corrupt actions ledger: %s (%s)" % (path, cause))
    return records


def next_action_id(records, date_value):
    pattern = re.compile(r"ACT-%s-(\d+)$" % re.escape(date_value))
    sequence = 0
    for record in records:
        value = record.get("id")
        if not isinstance(value, str):
            continue
        match = pattern.fullmatch(value)
        if match:
            sequence = max(sequence, int(match.group(1)))
    return "ACT-%s-%03d" % (date_value, sequence + 1)


def append_jsonl(path, payload):
    assert_no_symlink(path)
    prefix = b""
    if path.exists() and path.stat().st_size > 0:
        with path.open("rb") as handle:
            handle.seek(-1, os.SEEK_END)
            if handle.read(1) != b"\n":
                prefix = b"\n"
    data = prefix + (
        json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n"
    ).encode("utf-8")
    descriptor = os.open(path, os.O_APPEND | os.O_CREAT | os.O_WRONLY, 0o644)
    try:
        remaining = memoryview(data)
        while remaining:
            written = os.write(descriptor, remaining)
            if written <= 0:
                raise OSError("short write while appending JSONL")
            remaining = remaining[written:]
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def ensure_init_action(path, project_id, line, ticket_id):
    records = read_actions(path)
    for record in records:
        if (
            record.get("type") == "action"
            and record.get("kind") == "init"
            and record.get("project") == project_id
            and record.get("line") == line
        ):
            return False

    now = datetime.datetime.now().astimezone()
    evidence = ["local_projects/%s" % project_id]
    if ticket_id:
        evidence.append(ticket_id)
    record = {
        "id": next_action_id(records, now.strftime("%Y%m%d")),
        "ts": now.isoformat(timespec="seconds"),
        "type": "action",
        "kind": "init",
        "project": project_id,
        "line": line,
        "step": None,
        "title": "初始化项目自包含目录",
        "detail": "创建本地项目标准目录、治理文件与双层五类 JSONL 台账。",
        "evidence": evidence,
        "refs": [],
    }
    append_jsonl(path, record)
    return True


def scaffold(root, project_id, line, ticket_id):
    safe_id = sanitize_project_id(project_id)
    if not safe_id:
        raise WorkspaceError("invalid project_id: %r" % (project_id,))
    if line not in LINES:
        raise WorkspaceError("invalid line: %r" % (line,))
    safe_ticket = validate_ticket(ticket_id)

    projects_dir = safe_path(root, "local_projects")
    ensure_directory(projects_dir)
    project_root = safe_path(projects_dir, safe_id)
    if project_root.exists() and project_root.is_symlink():
        raise WorkspaceError("project root is a symlink: %s" % project_root)
    ensure_directory(project_root)

    created = []
    for name in ("data", "figures", "deliverables", "debug", "ledger"):
        path = safe_path(project_root, name)
        if not path.exists():
            ensure_directory(path)
            created.append(name)

    for project_line in LINES:
        for subdir in ("processed", "results"):
            relative = "data/%s/%s" % (project_line, subdir)
            path = safe_path(project_root, relative)
            if not path.exists():
                ensure_directory(path)
                created.append(relative)
        relative = "figures/%s" % project_line
        path = safe_path(project_root, relative)
        if not path.exists():
            ensure_directory(path)
            created.append(relative)
    adapt_path = safe_path(project_root, "figures/adapt")
    if not adapt_path.exists():
        ensure_directory(adapt_path)
        created.append("figures/adapt")

    meta_path = safe_path(project_root, "project.json")
    if meta_path.exists():
        read_project_meta(meta_path, safe_id, line)
    elif ensure_json_file(meta_path, project_payload(safe_id, line, safe_ticket)):
        created.append("project.json")

    if ensure_empty_file(
        safe_path(project_root, "handoff.md"),
        "# 项目交接\n\n- 项目背景：\n- 当前进度：\n- 已知坑：\n- 下一步：\n",
    ):
        created.append("handoff.md")
    if ensure_empty_file(
        safe_path(project_root, "README.md"),
        "# 项目索引\n\n"
        "- 机器元数据：project.json\n"
        "- 数据入口：data/<line>/{processed,results}\n"
        "- 真实图件：figures/<line>\n"
        "- 模板派生副本：figures/adapt\n"
        "- 交付入口：deliverables/\n"
        "- 项目台账：ledger/\n",
    ):
        created.append("README.md")
    if ensure_json_file(safe_path(project_root, "INDEX.json"), index_payload(safe_id)):
        created.append("INDEX.json")

    ledger_dir = safe_path(project_root, "ledger")
    for name in LEDGER_NAMES:
        relative = "ledger/%s.jsonl" % name
        if ensure_empty_file(safe_path(project_root, relative), ""):
            created.append(relative)

    global_ledger = safe_path(root, "con_hf/ledger")
    if not global_ledger.exists():
        ensure_directory(global_ledger)
        created.append("con_hf/ledger")
    for name in LEDGER_NAMES:
        relative = "con_hf/ledger/%s.jsonl" % name
        if ensure_empty_file(safe_path(root, relative), ""):
            created.append(relative)

    sync_root = safe_path(root, "con_hf/sync")
    if not sync_root.exists():
        ensure_directory(sync_root)
        created.append("con_hf/sync")
    for name in SYNC_DIRS:
        relative = "con_hf/sync/%s" % name
        path = safe_path(root, relative)
        if not path.exists():
            ensure_directory(path)
            created.append(relative)
    if ensure_empty_file(safe_path(root, "con_hf/sync/daemon.log"), ""):
        created.append("con_hf/sync/daemon.log")

    action_created = ensure_init_action(
        safe_path(project_root, "ledger/actions.jsonl"),
        safe_id,
        line,
        safe_ticket,
    )
    if action_created:
        created.append("ledger/actions.jsonl#init")

    return {
        "ok": True,
        "command": "init_project_scaffold",
        "root": str(root),
        "project_id": safe_id,
        "line": line,
        "ticket_id": safe_ticket,
        "created": sorted(created),
        "kept_existing": True,
    }


def build_parser():
    parser = argparse.ArgumentParser(
        description="Initialize one self-contained local project scaffold."
    )
    parser.add_argument("--root", required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--line", required=True)
    parser.add_argument("--ticket")
    return parser


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True))


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        root = workspace_root(args.root, extra_allowed_roots=(QA_ROOT,) + extra_allowed_roots())
        payload = scaffold(root, args.project, args.line, args.ticket)
        emit(payload)
        return 0
    except WorkspaceError as cause:
        emit({"ok": False, "error": str(cause)})
        return 2
    except OSError as cause:
        emit({"ok": False, "error": "filesystem error: %s" % cause})
        return 1


if __name__ == "__main__":
    sys.exit(main())
