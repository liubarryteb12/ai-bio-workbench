#!/usr/bin/env python3
"""Validate structured A2A execution artifacts."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Any

WORKSPACE_ROOT = "/data/data/com.termux/files/home/workspace"
MAX_JSON_BYTES = 4 * 1024 * 1024
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
ALLOWED_ACTIONS = {"created", "modified", "deleted"}
REQUIRED_FIELDS = (
    "task_id",
    "executed_at",
    "workspace_dir",
    "command_or_action",
    "exit_code",
    "duration_sec",
    "changed_files",
    "stdout_summary",
    "stderr_summary",
)


def validate_artifact(artifact: dict) -> list[str]:
    """Return stable uppercase error codes. An empty list means valid."""
    if not isinstance(artifact, dict):
        return ["ERR_ARTIFACT_NOT_OBJECT"]

    errors: list[str] = []
    for field in REQUIRED_FIELDS:
        if field not in artifact:
            errors.append(f"ERR_ARTIFACT_FIELD_MISSING:{field}")

    _validate_string_field(artifact, "task_id", errors)
    _validate_string_field(artifact, "command_or_action", errors)
    _validate_string_field(artifact, "stdout_summary", errors)
    _validate_string_field(artifact, "stderr_summary", errors)
    _validate_timestamp(artifact, errors)
    _validate_workspace(artifact, errors)
    _validate_exit_code(artifact, errors)
    _validate_duration(artifact, errors)
    _validate_changed_files(artifact, errors)
    _validate_json_size(artifact, errors)
    return errors


def assert_valid_artifact(artifact: dict) -> None:
    """Raise ValueError when the artifact is invalid."""
    errors = validate_artifact(artifact)
    if errors:
        raise ValueError(", ".join(errors))


def _validate_string_field(artifact: dict, field: str, errors: list[str]) -> None:
    if field in artifact and not isinstance(artifact[field], str):
        errors.append(f"ERR_ARTIFACT_FIELD_TYPE:{field}")


def _validate_timestamp(artifact: dict, errors: list[str]) -> None:
    value = artifact.get("executed_at")
    if not isinstance(value, str):
        if "executed_at" in artifact:
            errors.append("ERR_ARTIFACT_FIELD_TYPE:executed_at")
        return
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        errors.append("ERR_ARTIFACT_TIMESTAMP_MALFORMED")
        return
    offset = parsed.tzinfo.utcoffset(parsed) if parsed.tzinfo else None
    if offset is None:
        errors.append("ERR_ARTIFACT_TIMESTAMP_MISSING_OFFSET")


def _validate_workspace(artifact: dict, errors: list[str]) -> None:
    value = artifact.get("workspace_dir")
    if not isinstance(value, str):
        if "workspace_dir" in artifact:
            errors.append("ERR_ARTIFACT_FIELD_TYPE:workspace_dir")
        return
    normalized = PurePosixPath(value).as_posix().rstrip("/")
    root = WORKSPACE_ROOT.rstrip("/")
    if normalized != root and not normalized.startswith(root + "/"):
        errors.append("ERR_ARTIFACT_WORKSPACE_OUTSIDE_ROOT")


def _validate_exit_code(artifact: dict, errors: list[str]) -> None:
    if "exit_code" not in artifact:
        return
    if isinstance(artifact["exit_code"], bool) or not isinstance(artifact["exit_code"], int):
        errors.append("ERR_ARTIFACT_FIELD_TYPE:exit_code")


def _validate_duration(artifact: dict, errors: list[str]) -> None:
    if "duration_sec" not in artifact:
        return
    value = artifact["duration_sec"]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        errors.append("ERR_ARTIFACT_FIELD_TYPE:duration_sec")
    elif value < 0:
        errors.append("ERR_ARTIFACT_DURATION_NEGATIVE")


def _validate_changed_files(artifact: dict, errors: list[str]) -> None:
    if "changed_files" not in artifact:
        return
    value = artifact["changed_files"]
    if not isinstance(value, list):
        errors.append("ERR_ARTIFACT_FIELD_TYPE:changed_files")
        return
    for index, item in enumerate(value):
        _validate_changed_file(index, item, errors)


def _validate_changed_file(index: int, item: Any, errors: list[str]) -> None:
    prefix = f"ERR_ARTIFACT_CHANGED_FILE:{index}"
    if not isinstance(item, dict):
        errors.append(f"{prefix}:ERR_ARTIFACT_NOT_OBJECT")
        return

    path = item.get("path")
    sha256 = item.get("sha256")
    action = item.get("action")

    if not isinstance(path, str):
        errors.append(f"{prefix}:ERR_ARTIFACT_FIELD_TYPE:path")
    elif not path or path.startswith("/") or ".." in PurePosixPath(path).parts:
        errors.append(f"{prefix}:ERR_ARTIFACT_CHANGED_PATH_UNSAFE")
    elif path.startswith("/sdcard") or path.startswith("/storage/emulated"):
        errors.append(f"{prefix}:ERR_ARTIFACT_CHANGED_PATH_UNSAFE")

    if not isinstance(sha256, str) or not SHA256_PATTERN.fullmatch(sha256):
        errors.append("ERR_ARTIFACT_SHA256_MALFORMED")

    if action not in ALLOWED_ACTIONS:
        errors.append("ERR_ARTIFACT_ACTION_INVALID")


def _validate_json_size(artifact: dict, errors: list[str]) -> None:
    size = len(json.dumps(artifact, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    if size > MAX_JSON_BYTES:
        errors.append("ERR_ARTIFACT_OVERSIZE")

