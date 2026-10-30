#!/usr/bin/env python3
"""Extract structured runner artifacts from A2A JSON-RPC task replies."""

from __future__ import annotations

import json
import re
from pathlib import PurePosixPath


def _require_text_match(text: str, pattern: str) -> str:
    match = re.search(pattern, text, flags=re.MULTILINE)
    if match is None:
        raise ValueError("ERR_ARTIFACT_TEXT_FIELD_MISSING")
    return match.group(1)


def _match_optional_text(text: str, pattern: str) -> str | None:
    match = re.search(pattern, text)
    if match is None:
        return None
    return match.group(1)


def _common_posix_parent(file_paths: list[PurePosixPath]) -> PurePosixPath:
    parents = [file_path.parent for file_path in file_paths]
    if all(parent == parents[0] for parent in parents[1:]):
        return parents[0]

    common_parts: list[str] = []
    for parts in zip(*(parent.parts for parent in parents)):
        if any(part != parts[0] for part in parts[1:]):
            break
        common_parts.append(parts[0])
    return PurePosixPath(*common_parts)


def _relative_to_workspace(
    file_path: PurePosixPath,
    workspace_dir: PurePosixPath,
) -> str:
    return file_path.relative_to(workspace_dir).as_posix()


def _extract_structured_artifact(text: str) -> dict | None:
    decoder = json.JSONDecoder()
    required = {"task_id", "step_id", "script_sha256", "changed_files"}
    for match in re.finditer(r"\{", text):
        try:
            value, _ = decoder.raw_decode(text[match.start():])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and required.issubset(value):
            return value
    return None


def extract_artifact_from_rpc(result: dict) -> dict:
    """Convert text artifacts in an A2A result into a validator artifact."""
    task = result.get("task") if isinstance(result, dict) else None
    if not isinstance(task, dict):
        raise ValueError("ERR_NO_TASK")

    artifacts = task.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        raise ValueError("ERR_NO_ARTIFACT")

    texts = []
    for artifact in artifacts[0].get("parts", []):
        text = artifact.get("text")
        if isinstance(text, str):
            texts.append(text)
    if not texts:
        raise ValueError("ERR_NO_TEXT_PART")
    text = "\n".join(texts)

    structured = _extract_structured_artifact(text)
    if structured is not None:
        return structured

    file_anchors = list(re.finditer(r"^-?\s*File:", text, flags=re.MULTILINE))
    if not file_anchors:
        raise ValueError("ERR_ARTIFACT_TEXT_FIELD_MISSING")

    records = []
    for index, anchor in enumerate(file_anchors):
        record_end = (
            file_anchors[index + 1].start()
            if index + 1 < len(file_anchors)
            else len(text)
        )
        records.append(text[anchor.start():record_end])
    parsed_records = []
    for record in records:
        file_text = _require_text_match(
            record,
            r"File:\s*`?([^,`\n]+?)`?\s*(?=$|,)",
        )
        content = _match_optional_text(
            record,
            (
                r"Content:\s*`?([^\n`]*?)`?\s*"
                r"(?:\+\s*trailing newline[^\n]*)?\s*(?=$|,)"
            ),
        )
        sha256 = _require_text_match(
            record,
            r"SHA256:\s*`?([0-9a-f]{64})`?",
        )
        exit_code_text = _match_optional_text(
            record,
            r"Exit code:\s*`?(\d+)`?",
        )
        parsed_records.append(
            {
                "file_path": PurePosixPath(file_text),
                "content": content,
                "sha256": sha256,
                "exit_code": exit_code_text,
            }
        )

    exit_code_text = next(
        (
            parsed["exit_code"]
            for parsed in parsed_records
            if parsed["exit_code"] is not None
        ),
        None,
    )
    if exit_code_text is None:
        raise ValueError("ERR_ARTIFACT_TEXT_FIELD_MISSING")
    try:
        exit_code = int(exit_code_text)
    except ValueError as exc:
        raise ValueError("ERR_ARTIFACT_EXIT_CODE_MALFORMED") from exc

    file_paths = [parsed["file_path"] for parsed in parsed_records]
    workspace_path = _common_posix_parent(file_paths)
    task_id = task.get("id")
    if not isinstance(task_id, str) or not task_id.strip():
        raise ValueError("ERR_ARTIFACT_TEXT_FIELD_MISSING")

    status = task.get("status")
    timestamp = status.get("timestamp") if isinstance(status, dict) else None
    if not isinstance(timestamp, str) or not timestamp.strip():
        raise ValueError("ERR_ARTIFACT_TEXT_FIELD_MISSING")

    step_id = _require_text_match(
        text,
        r"Step ID:\s*`?([^`\n]+?)`?[ \t]*$",
    )
    idempotent_status = _require_text_match(
        text,
        r"Idempotent status:\s*`?([^`\n]+?)`?[ \t]*$",
    )
    script_path = _require_text_match(
        text,
        r"Script path:\s*`?([^`\n]+?)`?[ \t]*$",
    )
    script_sha256 = _require_text_match(
        text,
        r"Script SHA256:\s*`?([0-9a-f]{64})`?[ \t]*$",
    )
    inputs_sha256 = _require_text_match(
        text,
        r"Inputs SHA256:\s*`?(no_inputs_declared|[0-9a-f]{64})`?[ \t]*$",
    )
    duration_text = _require_text_match(
        text,
        r"Duration sec:\s*`?(\d+(?:\.\d+)?)`?[ \t]*$",
    )
    log_file = _require_text_match(
        text,
        r"Log file:\s*`?([^`\n]+?)`?[ \t]*$",
    )
    changed_files = [
        {
            "path": _relative_to_workspace(
                parsed["file_path"],
                workspace_path,
            ),
            "sha256": parsed["sha256"],
            "action": "created" if parsed["content"] is not None else "modified",
        }
        for parsed in parsed_records
    ]

    return {
        "task_id": task_id,
        "step_id": step_id,
        "idempotent_status": idempotent_status,
        "executed_at": timestamp,
        "workspace_dir": workspace_path.as_posix(),
        "script_path": script_path,
        "script_sha256": script_sha256,
        "inputs_sha256": inputs_sha256,
        "exit_code": exit_code,
        "duration_sec": float(duration_text),
        "log_file": log_file,
        "changed_files": changed_files,
        "stdout_summary": text,
        "stderr_summary": "",
    }
