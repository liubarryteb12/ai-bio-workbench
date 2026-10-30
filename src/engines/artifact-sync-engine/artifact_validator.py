#!/usr/bin/env python3
"""Validate structured A2A execution artifacts."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

TERMUX_HOME = "/data/data/com.termux/files/home"
TERMUX_WORKSPACE_ROOT = f"{TERMUX_HOME}/workspace"
CONTAINER_WORKSPACE_ROOT = "/mnt/ssd/bio_data"
ALLOWED_WORKSPACE_ROOTS = (TERMUX_WORKSPACE_ROOT, CONTAINER_WORKSPACE_ROOT)
MAX_JSON_BYTES = 4 * 1024 * 1024
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
ALLOWED_ACTIONS = {"created", "modified", "verified"}
ALLOWED_IDEMPOTENT_STATUS = {
    "fresh_run",
    "reused_done_checkpoint",
    "attached_running_lock",
}
ACCEPTANCE_REQUIRED_FIELDS = (
    "passed",
    "exit_code",
    "script_sha256",
    "inputs_sha256",
    "changed_files",
    "log_file",
    "checks",
)
FINAL_ACCEPTANCE_REQUIRED_FIELDS = ACCEPTANCE_REQUIRED_FIELDS + (
    "verifier",
    "verified_at",
    "modification_scope",
)
REQUIRED_FIELDS = (
    "task_id",
    "step_id",
    "idempotent_status",
    "executed_at",
    "workspace_dir",
    "script_path",
    "script_sha256",
    "inputs_sha256",
    "exit_code",
    "duration_sec",
    "log_file",
    "changed_files",
    "stdout_summary",
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
    _validate_nonempty_string(artifact, "task_id", errors)
    _validate_nonempty_string(artifact, "step_id", errors)
    _validate_idempotent_status(artifact, errors)
    _validate_string_field(artifact, "stdout_summary", errors)
    _validate_string_field(artifact, "stderr_summary", errors)
    _validate_timestamp(artifact, errors)
    _validate_workspace(artifact, errors)
    _validate_path_field(artifact, "script_path", errors)
    _validate_sha256_field(artifact, "script_sha256", errors)
    _validate_inputs_sha256(artifact, errors)
    _validate_exit_code(artifact, errors)
    _validate_duration(artifact, errors)
    _validate_path_field(artifact, "log_file", errors)
    _validate_changed_files(artifact, errors)
    _validate_json_size(artifact, errors)
    return errors


def assert_valid_artifact(artifact: dict) -> None:
    """Raise ValueError when the artifact is invalid."""
    errors = validate_artifact(artifact)
    if errors:
        raise ValueError(", ".join(errors))


def validate_dispatch_paths(
    task: dict,
    runtime: str = "termux",
    visible_roots: tuple[str, ...] | None = None,
) -> list[str]:
    """Reject task paths that the selected runtime cannot see.

    A Termux task must use the Termux workspace, while a K40 container task
    must use the container mount. This prevents Pi from spending turns
    searching a path that exists only on the other side of the boundary.
    """
    if not isinstance(task, dict):
        return ["ERR_TASK_NOT_OBJECT"]

    errors: list[str] = []
    runtime_name = str(runtime).strip().lower()
    if visible_roots is None:
        if runtime_name in {"termux", "pi", "pi-termux"}:
            roots = (TERMUX_WORKSPACE_ROOT,)
        elif runtime_name in {"k40", "k40-container", "container", "proot-ubuntu"}:
            roots = (CONTAINER_WORKSPACE_ROOT,)
        else:
            return [f"ERR_TASK_RUNTIME_INVALID:{runtime_name or 'empty'}"]
    else:
        roots = tuple(_normalize_declared_path(root) for root in visible_roots)

    workspace = task.get("workspace_dir")
    if not isinstance(workspace, str) or not workspace.strip():
        errors.append("ERR_TASK_FIELD_INVALID:workspace_dir")
        workspace_path: PurePosixPath | None = None
    else:
        workspace_path = _declared_path(workspace)
        if _has_unsafe_parts(workspace_path):
            errors.append("ERR_TASK_PATH_UNSAFE:workspace_dir")
        elif not _path_under_roots(workspace_path, roots):
            errors.append("ERR_TASK_PATH_NOT_VISIBLE:workspace_dir")

    for field in ("script_path",):
        value = task.get(field)
        if not isinstance(value, str) or not value.strip():
            errors.append(f"ERR_TASK_FIELD_INVALID:{field}")
            continue
        path = _declared_path(value)
        if _has_unsafe_parts(path):
            errors.append(f"ERR_TASK_PATH_UNSAFE:{field}")
        elif path.is_absolute() and (
            workspace_path is None or not _is_relative_to(path, workspace_path)
        ):
            errors.append(f"ERR_TASK_PATH_NOT_VISIBLE:{field}")

    for field in ("inputs", "outputs"):
        values = task.get(field)
        if not isinstance(values, list):
            errors.append(f"ERR_TASK_FIELD_INVALID:{field}")
            continue
        for index, value in enumerate(values):
            if not isinstance(value, str) or not value.strip():
                errors.append(f"ERR_TASK_FIELD_INVALID:{field}:{index}")
                continue
            path = _declared_path(value)
            if _has_unsafe_parts(path):
                errors.append(f"ERR_TASK_PATH_UNSAFE:{field}:{index}")
            elif path.is_absolute() and (
                workspace_path is None or not _is_relative_to(path, workspace_path)
            ):
                errors.append(f"ERR_TASK_PATH_NOT_VISIBLE:{field}:{index}")
    return _dedupe(errors)


def validate_preliminary_acceptance(artifact: dict) -> list[str]:
    return _validate_acceptance_layer(
        artifact,
        "preliminary_acceptance",
        ACCEPTANCE_REQUIRED_FIELDS,
        require_codex=False,
    )


def validate_final_acceptance(artifact: dict) -> list[str]:
    return _validate_acceptance_layer(
        artifact,
        "final_acceptance",
        FINAL_ACCEPTANCE_REQUIRED_FIELDS,
        require_codex=True,
    )


def validate_completion_artifact(artifact: dict) -> list[str]:
    """Validate a task that claims to be completed.

    The base runner artifact remains valid on its own, but completion is a
    separate claim and requires both Pi preliminary acceptance and an
    independent Codex final acceptance.
    """
    errors = list(validate_artifact(artifact))
    errors.extend(validate_preliminary_acceptance(artifact))
    errors.extend(validate_final_acceptance(artifact))
    return _dedupe(errors)


def evaluate_task_completion(artifact: dict) -> dict:
    errors = validate_completion_artifact(artifact)
    return {
        "state": "completed" if not errors else "working",
        "passed": not errors,
        "errors": errors,
    }


def build_final_acceptance(
    artifact: dict,
    workspace_root: str | Path | None = None,
    command_results: list[dict] | None = None,
    input_paths: list[str] | None = None,
    verifier: str = "codex",
    modification_scope: str = "within_workspace",
) -> dict:
    """Build a Codex-side acceptance record from independently checked facts.

    The caller executes acceptance commands and passes their results in. This
    function independently hashes every changed file under ``workspace_root``;
    it never promotes Pi's own ``passed`` flag into a final result.
    """
    errors: list[str] = []
    checks: list[dict] = []

    if not isinstance(artifact, dict):
        return {
            "passed": False,
            "verifier": verifier,
            "verified_at": datetime.now(timezone.utc).isoformat(),
            "modification_scope": modification_scope,
            "errors": ["ERR_ARTIFACT_NOT_OBJECT"],
        }

    base_errors = validate_artifact(artifact)
    preliminary_errors = validate_preliminary_acceptance(artifact)
    errors.extend(base_errors)
    errors.extend(preliminary_errors)
    checks.append(
        {
            "name": "preliminary_acceptance",
            "passed": not preliminary_errors,
            "detail": "verified" if not preliminary_errors else ";".join(preliminary_errors),
        }
    )

    declared_workspace = artifact.get("workspace_dir")
    if workspace_root is None:
        if not isinstance(declared_workspace, str):
            errors.append("ERR_FINAL_ACCEPTANCE_WORKSPACE_INVALID")
            root = None
        else:
            root = Path(declared_workspace)
    else:
        root = Path(workspace_root)

    file_errors = _verify_changed_files_on_disk(artifact, root)
    errors.extend(file_errors)
    checks.append(
        {
            "name": "changed_files_on_disk",
            "passed": not file_errors,
            "detail": "verified" if not file_errors else ";".join(file_errors),
        }
    )

    script_errors = _verify_script_hash_on_disk(artifact, root)
    errors.extend(script_errors)
    checks.append(
        {
            "name": "script_hash_on_disk",
            "passed": not script_errors,
            "detail": "verified" if not script_errors else ";".join(script_errors),
        }
    )

    inputs_errors = _verify_inputs_hash_on_disk(
        artifact,
        root,
        input_paths,
    )
    errors.extend(inputs_errors)
    checks.append(
        {
            "name": "inputs_hash_on_disk",
            "passed": not inputs_errors,
            "detail": "verified" if not inputs_errors else ";".join(inputs_errors),
        }
    )

    if not isinstance(command_results, list) or not command_results:
        errors.append("ERR_FINAL_ACCEPTANCE_COMMANDS_MISSING")
    else:
        for index, result in enumerate(command_results):
            if not isinstance(result, dict):
                errors.append(f"ERR_FINAL_ACCEPTANCE_COMMAND_INVALID:{index}")
                continue
            command = result.get("command")
            exit_code = result.get("exit_code")
            command_ok = (
                isinstance(command, str)
                and bool(command.strip())
                and isinstance(exit_code, int)
                and not isinstance(exit_code, bool)
                and exit_code == 0
            )
            if not command_ok:
                errors.append(f"ERR_FINAL_ACCEPTANCE_COMMAND_FAILED:{index}")
            checks.append(
                {
                    "name": f"command:{index}",
                    "passed": command_ok,
                    "detail": command if isinstance(command, str) else "",
                }
            )

    if not isinstance(verifier, str) or verifier != "codex":
        errors.append("ERR_ACCEPTANCE_VERIFIER_INVALID:final_acceptance")
    if modification_scope != "within_workspace":
        errors.append("ERR_FINAL_ACCEPTANCE_SCOPE_INVALID")

    return {
        "passed": not errors,
        "verifier": verifier,
        "verified_at": datetime.now(timezone.utc).isoformat(),
        "modification_scope": modification_scope,
        "exit_code": artifact.get("exit_code"),
        "script_sha256": artifact.get("script_sha256"),
        "inputs_sha256": artifact.get("inputs_sha256"),
        "changed_files": artifact.get("changed_files"),
        "log_file": artifact.get("log_file"),
        "checks": checks,
        "errors": _dedupe(errors),
    }


def _validate_acceptance_layer(
    artifact: dict,
    layer: str,
    required_fields: tuple[str, ...],
    require_codex: bool,
) -> list[str]:
    if not isinstance(artifact, dict):
        return ["ERR_ARTIFACT_NOT_OBJECT"]
    acceptance = artifact.get(layer)
    if acceptance is None:
        return [f"ERR_ACCEPTANCE_FIELD_MISSING:{layer}"]
    if not isinstance(acceptance, dict):
        return [f"ERR_ACCEPTANCE_NOT_OBJECT:{layer}"]

    errors: list[str] = []
    for field in required_fields:
        if field not in acceptance:
            errors.append(f"ERR_ACCEPTANCE_FIELD_MISSING:{layer}.{field}")

    passed = acceptance.get("passed")
    if not isinstance(passed, bool):
        if "passed" in acceptance:
            errors.append(f"ERR_ACCEPTANCE_PASSED_NOT_BOOL:{layer}")
    elif not passed:
        errors.append(f"ERR_ACCEPTANCE_PASSED_FALSE:{layer}")

    _validate_acceptance_match(
        artifact,
        acceptance,
        layer,
        "exit_code",
        errors,
    )
    _validate_acceptance_match(
        artifact,
        acceptance,
        layer,
        "script_sha256",
        errors,
    )
    _validate_acceptance_match(
        artifact,
        acceptance,
        layer,
        "inputs_sha256",
        errors,
    )
    _validate_acceptance_match(
        artifact,
        acceptance,
        layer,
        "log_file",
        errors,
    )
    _validate_acceptance_changed_files(artifact, acceptance, layer, errors)
    _validate_acceptance_checks(acceptance, layer, errors)

    if require_codex:
        if acceptance.get("verifier") != "codex":
            errors.append(f"ERR_ACCEPTANCE_VERIFIER_INVALID:{layer}")
        _validate_acceptance_timestamp(acceptance, layer, errors)
        if acceptance.get("modification_scope") != "within_workspace":
            errors.append(f"ERR_ACCEPTANCE_SCOPE_INVALID:{layer}")
    return _dedupe(errors)


def _validate_acceptance_match(
    artifact: dict,
    acceptance: dict,
    layer: str,
    field: str,
    errors: list[str],
) -> None:
    if field in acceptance and acceptance.get(field) != artifact.get(field):
        errors.append(f"ERR_ACCEPTANCE_MISMATCH:{layer}.{field}")


def _validate_acceptance_changed_files(
    artifact: dict,
    acceptance: dict,
    layer: str,
    errors: list[str],
) -> None:
    if "changed_files" not in acceptance:
        return
    expected = _canonical_changed_files(artifact.get("changed_files"))
    actual = _canonical_changed_files(acceptance.get("changed_files"))
    if expected is None or actual is None or expected != actual:
        errors.append(f"ERR_ACCEPTANCE_MISMATCH:{layer}.changed_files")


def _validate_acceptance_checks(
    acceptance: dict,
    layer: str,
    errors: list[str],
) -> None:
    if "checks" not in acceptance:
        return
    checks = acceptance.get("checks")
    if not isinstance(checks, list) or not checks:
        errors.append(f"ERR_ACCEPTANCE_CHECKS_INVALID:{layer}")
        return
    all_passed = True
    for index, check in enumerate(checks):
        if not isinstance(check, dict):
            errors.append(f"ERR_ACCEPTANCE_CHECK_INVALID:{layer}:{index}")
            all_passed = False
            continue
        if not isinstance(check.get("name"), str) or not check["name"].strip():
            errors.append(f"ERR_ACCEPTANCE_CHECK_INVALID:{layer}:{index}")
        if not isinstance(check.get("passed"), bool):
            errors.append(f"ERR_ACCEPTANCE_CHECK_INVALID:{layer}:{index}")
            all_passed = False
        elif not check["passed"]:
            errors.append(f"ERR_ACCEPTANCE_CHECK_FAILED:{layer}:{index}")
            all_passed = False
    if acceptance.get("passed") is True and not all_passed:
        errors.append(f"ERR_ACCEPTANCE_CHECKS_NOT_ALL_PASSED:{layer}")


def _validate_acceptance_timestamp(
    acceptance: dict,
    layer: str,
    errors: list[str],
) -> None:
    value = acceptance.get("verified_at")
    if not isinstance(value, str):
        if "verified_at" in acceptance:
            errors.append(f"ERR_ACCEPTANCE_TIMESTAMP_INVALID:{layer}")
        return
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        errors.append(f"ERR_ACCEPTANCE_TIMESTAMP_INVALID:{layer}")
        return
    if parsed.tzinfo is None or parsed.tzinfo.utcoffset(parsed) is None:
        errors.append(f"ERR_ACCEPTANCE_TIMESTAMP_INVALID:{layer}")


def _verify_changed_files_on_disk(
    artifact: dict,
    root: Path | None,
) -> list[str]:
    if root is None:
        return ["ERR_FINAL_ACCEPTANCE_WORKSPACE_INVALID"]
    changed_files = artifact.get("changed_files")
    if not isinstance(changed_files, list):
        return ["ERR_FINAL_ACCEPTANCE_CHANGED_FILES_INVALID"]

    errors: list[str] = []
    try:
        resolved_root = root.resolve(strict=True)
    except OSError:
        return ["ERR_FINAL_ACCEPTANCE_WORKSPACE_INVALID"]
    if not resolved_root.is_dir():
        return ["ERR_FINAL_ACCEPTANCE_WORKSPACE_INVALID"]

    for item in changed_files:
        if not isinstance(item, dict):
            errors.append("ERR_FINAL_ACCEPTANCE_CHANGED_FILE_INVALID")
            continue
        relative = item.get("path")
        expected = item.get("sha256")
        if not isinstance(relative, str) or not relative:
            errors.append("ERR_FINAL_ACCEPTANCE_CHANGED_FILE_INVALID")
            continue
        path = PurePosixPath(relative)
        if path.is_absolute() or _has_unsafe_parts(path):
            errors.append(f"ERR_FINAL_ACCEPTANCE_CHANGED_PATH_UNSAFE:{relative}")
            continue
        candidate = (resolved_root / Path(*path.parts)).resolve()
        if not _is_relative_to(candidate, resolved_root):
            errors.append(f"ERR_FINAL_ACCEPTANCE_CHANGED_PATH_UNSAFE:{relative}")
            continue
        if not candidate.is_file():
            errors.append(f"ERR_FINAL_ACCEPTANCE_FILE_MISSING:{relative}")
            continue
        actual = hashlib.sha256(candidate.read_bytes()).hexdigest()
        if not isinstance(expected, str) or actual != expected:
            errors.append(f"ERR_FINAL_ACCEPTANCE_FILE_HASH_MISMATCH:{relative}")
    return errors


def _verify_script_hash_on_disk(
    artifact: dict,
    root: Path | None,
) -> list[str]:
    if root is None:
        return ["ERR_FINAL_ACCEPTANCE_WORKSPACE_INVALID"]
    script_path = artifact.get("script_path")
    expected = artifact.get("script_sha256")
    candidate, path_errors = _resolve_artifact_file(
        script_path,
        artifact.get("workspace_dir"),
        root,
    )
    if path_errors:
        return path_errors
    if candidate is None:
        return ["ERR_FINAL_ACCEPTANCE_SCRIPT_INVALID"]
    if not candidate.is_file():
        return ["ERR_FINAL_ACCEPTANCE_SCRIPT_MISSING"]
    actual = hashlib.sha256(candidate.read_bytes()).hexdigest()
    if not isinstance(expected, str) or actual != expected:
        return ["ERR_FINAL_ACCEPTANCE_SCRIPT_HASH_MISMATCH"]
    return []


def _verify_inputs_hash_on_disk(
    artifact: dict,
    root: Path | None,
    input_paths: list[str] | None,
) -> list[str]:
    if root is None:
        return ["ERR_FINAL_ACCEPTANCE_WORKSPACE_INVALID"]
    declared = artifact.get("inputs_sha256")
    if input_paths is None:
        if declared == "no_inputs_declared":
            return []
        return ["ERR_FINAL_ACCEPTANCE_INPUTS_UNVERIFIED"]
    if not isinstance(input_paths, list):
        return ["ERR_FINAL_ACCEPTANCE_INPUTS_INVALID"]
    if not input_paths:
        if declared == "no_inputs_declared":
            return []
        return ["ERR_FINAL_ACCEPTANCE_INPUTS_HASH_MISMATCH"]

    combined = ""
    for value in input_paths:
        if not isinstance(value, str) or not value.strip():
            return ["ERR_FINAL_ACCEPTANCE_INPUTS_INVALID"]
        candidate, path_errors = _resolve_artifact_file(
            value,
            artifact.get("workspace_dir"),
            root,
        )
        if path_errors:
            return path_errors
        if candidate is None or not candidate.is_file():
            return [f"ERR_FINAL_ACCEPTANCE_INPUT_MISSING:{value}"]
        digest = hashlib.sha256(candidate.read_bytes()).hexdigest()
        combined += f"{value}:{digest};"

    actual = hashlib.sha256(combined.encode("utf-8")).hexdigest()
    if not isinstance(declared, str) or actual != declared:
        return ["ERR_FINAL_ACCEPTANCE_INPUTS_HASH_MISMATCH"]
    return []


def _resolve_artifact_file(
    value: Any,
    workspace_dir: Any,
    root: Path,
) -> tuple[Path | None, list[str]]:
    if not isinstance(value, str) or not value.strip():
        return None, ["ERR_FINAL_ACCEPTANCE_PATH_INVALID"]
    try:
        resolved_root = root.resolve(strict=True)
    except OSError:
        return None, ["ERR_FINAL_ACCEPTANCE_WORKSPACE_INVALID"]
    if not resolved_root.is_dir():
        return None, ["ERR_FINAL_ACCEPTANCE_WORKSPACE_INVALID"]

    declared = PurePosixPath(value)
    if declared.is_absolute():
        if not isinstance(workspace_dir, str):
            return None, ["ERR_FINAL_ACCEPTANCE_PATH_UNSAFE"]
        try:
            declared = declared.relative_to(PurePosixPath(workspace_dir))
        except ValueError:
            return None, ["ERR_FINAL_ACCEPTANCE_PATH_UNSAFE"]
    if _has_unsafe_parts(declared):
        return None, ["ERR_FINAL_ACCEPTANCE_PATH_UNSAFE"]

    candidate = (resolved_root / Path(*declared.parts)).resolve()
    if not _is_relative_to(candidate, resolved_root):
        return None, ["ERR_FINAL_ACCEPTANCE_PATH_UNSAFE"]
    return candidate, []


def _canonical_changed_files(value: Any) -> list[tuple[str, str, str]] | None:
    if not isinstance(value, list):
        return None
    canonical: list[tuple[str, str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            return None
        path = item.get("path")
        sha256 = item.get("sha256")
        action = item.get("action")
        if not all(isinstance(part, str) for part in (path, sha256, action)):
            return None
        canonical.append((path, sha256, action))
    return sorted(canonical)


def _normalize_declared_path(value: str) -> str:
    text = str(value).strip()
    if text == "$HOME":
        return TERMUX_HOME
    if text.startswith("$HOME/"):
        return TERMUX_HOME + text[len("$HOME"):]
    if text == "~":
        return TERMUX_HOME
    if text.startswith("~/"):
        return TERMUX_HOME + text[1:]
    return text


def _declared_path(value: str) -> PurePosixPath:
    return PurePosixPath(_normalize_declared_path(value))


def _has_unsafe_parts(path: PurePosixPath) -> bool:
    text = path.as_posix()
    return (
        ".." in path.parts
        or "\0" in text
        or "\\" in text
        or text == "/sdcard"
        or text.startswith("/sdcard/")
        or text == "/storage/emulated"
        or text.startswith("/storage/emulated/")
        or text == "/storage/self/primary"
        or text.startswith("/storage/self/primary/")
    )


def _path_under_roots(path: PurePosixPath, roots: tuple[str, ...]) -> bool:
    return any(_is_relative_to(path, PurePosixPath(root)) for root in roots)


def _is_relative_to(path: PurePosixPath | Path, root: PurePosixPath | Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result


def _validate_string_field(artifact: dict, field: str, errors: list[str]) -> None:
    if field in artifact and not isinstance(artifact[field], str):
        errors.append(f"ERR_ARTIFACT_FIELD_TYPE:{field}")


def _validate_nonempty_string(artifact: dict, field: str, errors: list[str]) -> None:
    value = artifact.get(field)
    if isinstance(value, str) and not value.strip():
        errors.append(f"ERR_ARTIFACT_FIELD_EMPTY:{field}")


def _validate_idempotent_status(artifact: dict, errors: list[str]) -> None:
    value = artifact.get("idempotent_status")
    if not isinstance(value, str):
        if "idempotent_status" in artifact:
            errors.append("ERR_ARTIFACT_FIELD_TYPE:idempotent_status")
        return
    if value not in ALLOWED_IDEMPOTENT_STATUS:
        errors.append("ERR_ARTIFACT_IDEMPOTENT_STATUS_INVALID")


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
    path = PurePosixPath(value)
    if not path.is_absolute() or _has_unsafe_parts(path):
        errors.append("ERR_ARTIFACT_WORKSPACE_OUTSIDE_ROOT")
        return
    normalized = path.as_posix().rstrip("/")
    if not _path_under_allowed_roots(normalized):
        errors.append("ERR_ARTIFACT_WORKSPACE_OUTSIDE_ROOT")


def _validate_path_field(artifact: dict, field: str, errors: list[str]) -> None:
    value = artifact.get(field)
    if not isinstance(value, str):
        if field in artifact:
            errors.append(f"ERR_ARTIFACT_FIELD_TYPE:{field}")
        return
    path = PurePosixPath(value)
    if not value or _has_unsafe_parts(path):
        errors.append(f"ERR_ARTIFACT_PATH_UNSAFE:{field}")
        return
    if path.is_absolute() and not _path_under_allowed_roots(value.rstrip("/")):
        errors.append(f"ERR_ARTIFACT_PATH_UNSAFE:{field}")


def _path_under_allowed_roots(value: str) -> bool:
    normalized = PurePosixPath(value).as_posix().rstrip("/")
    return any(
        normalized == root.rstrip("/")
        or normalized.startswith(root.rstrip("/") + "/")
        for root in ALLOWED_WORKSPACE_ROOTS
    )


def _validate_sha256_field(artifact: dict, field: str, errors: list[str]) -> None:
    value = artifact.get(field)
    if not isinstance(value, str) or not SHA256_PATTERN.fullmatch(value):
        errors.append(f"ERR_ARTIFACT_SHA256_MALFORMED:{field}")


def _validate_inputs_sha256(artifact: dict, errors: list[str]) -> None:
    value = artifact.get("inputs_sha256")
    if not isinstance(value, str):
        if "inputs_sha256" in artifact:
            errors.append("ERR_ARTIFACT_FIELD_TYPE:inputs_sha256")
        return
    if value == "no_inputs_declared" or SHA256_PATTERN.fullmatch(value):
        return
    errors.append("ERR_ARTIFACT_INPUTS_SHA256_MALFORMED")


def _validate_exit_code(artifact: dict, errors: list[str]) -> None:
    if "exit_code" not in artifact:
        return
    if isinstance(artifact["exit_code"], bool) or not isinstance(artifact["exit_code"], int):
        errors.append("ERR_ARTIFACT_FIELD_TYPE:exit_code")
    elif artifact["exit_code"] != 0:
        errors.append("ERR_ARTIFACT_EXIT_CODE_NONZERO")


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
        _validate_changed_file(index, item, artifact.get("workspace_dir"), errors)


def _validate_changed_file(index: int, item: Any, workspace_dir: Any, errors: list[str]) -> None:
    prefix = f"ERR_ARTIFACT_CHANGED_FILE:{index}"
    if not isinstance(item, dict):
        errors.append(f"{prefix}:ERR_ARTIFACT_NOT_OBJECT")
        return

    path = item.get("path")
    sha256 = item.get("sha256")
    action = item.get("action")

    if not isinstance(path, str):
        errors.append(f"{prefix}:ERR_ARTIFACT_FIELD_TYPE:path")
    elif not path or path.startswith("/") or _has_unsafe_parts(PurePosixPath(path)):
        errors.append(f"{prefix}:ERR_ARTIFACT_CHANGED_PATH_UNSAFE")
    elif isinstance(workspace_dir, str):
        resolved_text = (PurePosixPath(workspace_dir) / path).as_posix()
        normalized_root = PurePosixPath(workspace_dir).as_posix().rstrip("/")
        if not resolved_text.startswith(normalized_root + "/"):
            errors.append(f"{prefix}:ERR_ARTIFACT_CHANGED_PATH_OUTSIDE_WORKSPACE")

    if not isinstance(sha256, str) or not SHA256_PATTERN.fullmatch(sha256):
        errors.append("ERR_ARTIFACT_SHA256_MALFORMED")

    if action not in ALLOWED_ACTIONS:
        errors.append("ERR_ARTIFACT_ACTION_INVALID")


def _validate_json_size(artifact: dict, errors: list[str]) -> None:
    # JSON-RPC may escape non-ASCII characters, so enforce the larger ASCII wire form.
    size = len(json.dumps(artifact, ensure_ascii=True, separators=(",", ":")).encode("utf-8"))
    if size > MAX_JSON_BYTES:
        errors.append("ERR_ARTIFACT_OVERSIZE")

