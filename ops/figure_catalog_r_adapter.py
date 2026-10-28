#!/usr/bin/env python3
"""Batch adapter and K40 verifier for single-figure R catalog candidates."""

import argparse
import csv
import datetime
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path, PurePosixPath

from PIL import Image, ImageStat


SCHEMA_VERSION = 1
DEFAULT_STATUS = "code_ready"
DEFAULT_REMOTE_ROOT = "/mnt/ssd/bio_data"
DEFAULT_RSCRIPT = "/opt/R/4.5.3/bin/Rscript"
DEFAULT_R_LIBS = "/opt/R/4.5.3-site-library"
DEFAULT_TIMEOUT_SECONDS = 180
CATALOG_ID_RE = re.compile(r"^[A-Za-z0-9_]+$")
SECRET_PATTERN = re.compile(
    r"(?i)\b(api[_-]?key|token|password|passwd|secret|authorization)"
    r"\b(\s*[:=]\s*)([^\s]+)"
)
THREAD_ENV = {
    "OMP_NUM_THREADS": "4",
    "OPENBLAS_NUM_THREADS": "4",
    "MKL_NUM_THREADS": "4",
    "R_DEFAULT_PACKAGES": "datasets,utils,grDevices,graphics,stats,methods",
}
SUMMARY_FIELDS = [
    "catalog_id",
    "source_status",
    "status",
    "verdict",
    "failure_kind",
    "exit_code",
    "validation_exit",
    "artifact_sha256",
    "width",
    "height",
    "evidence_dir",
]


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def redact_text(text):
    return SECRET_PATTERN.sub(r"\1\2<REDACTED>", text or "")


def ensure_within(path, root):
    resolved = Path(path).resolve()
    root_resolved = Path(root).resolve()
    if resolved != root_resolved and root_resolved not in resolved.parents:
        raise ValueError(f"path escapes workspace: {path}")
    return resolved


def ensure_remote_root(path):
    value = str(path).replace("\\", "/")
    pure = PurePosixPath(value)
    if not pure.is_absolute() or ".." in pure.parts:
        raise ValueError(f"invalid remote root: {path}")
    if str(pure) != DEFAULT_REMOTE_ROOT and not str(pure).startswith(
        DEFAULT_REMOTE_ROOT + "/"
    ):
        raise ValueError(f"remote root must stay under {DEFAULT_REMOTE_ROOT}: {path}")
    return pure


def load_candidates(catalog_path, status=DEFAULT_STATUS):
    catalog_path = Path(catalog_path).resolve()
    library_root = catalog_path.parent
    document = json.loads(catalog_path.read_text(encoding="utf-8"))
    raw_entries = document.get("entries", []) if isinstance(document, dict) else document
    candidates = []
    for entry in raw_entries:
        if entry.get("lang") != "R" or entry.get("status") != status:
            continue
        catalog_id = str(entry.get("catalog_id", ""))
        if not CATALOG_ID_RE.fullmatch(catalog_id):
            raise ValueError(f"invalid catalog id: {catalog_id!r}")
        code_path = entry.get("code_path")
        if not code_path:
            raise ValueError(f"candidate has no code_path: {catalog_id}")
        source_path = ensure_within(library_root / code_path, library_root)
        if not source_path.is_file():
            raise FileNotFoundError(source_path)
        candidates.append(
            {
                "catalog_id": catalog_id,
                "source_status": entry["status"],
                "lang": entry["lang"],
                "title": entry.get("title", ""),
                "deps": entry.get("deps", []),
                "source_path": source_path,
                "code_file_sha256": entry.get("code_file_sha256"),
            }
        )
    candidates.sort(key=lambda item: item["catalog_id"])
    return candidates


def read_candidate_status(candidate, catalog_id):
    if candidate["catalog_id"] != catalog_id:
        raise ValueError(f"catalog id mismatch: {candidate['catalog_id']} != {catalog_id}")
    return candidate["source_status"]


def generate_adapter():
    return Path(__file__).with_name("figure_catalog_r_adapter.R").read_text(
        encoding="utf-8"
    )


def build_r_command(
    remote_dir,
    script_name,
    output_name,
    env,
    timeout_seconds,
    rscript_bin=DEFAULT_RSCRIPT,
):
    remote_dir = PurePosixPath(str(remote_dir).replace("\\", "/"))
    output_path = remote_dir / "output" / output_name
    command_env = dict(env)
    command_env.setdefault("BIO_FIGURE_OUTPUT", str(output_path))
    command_env.setdefault("R_LIBS_USER", DEFAULT_R_LIBS)
    env_prefix = " ".join(
        f"{key}={shlex.quote(str(value))}"
        for key, value in sorted(command_env.items())
    )
    return (
        f"mkdir -p -- {shlex.quote(str(remote_dir / 'output'))} && "
        f"cd {shlex.quote(str(remote_dir))} && "
        f"env {env_prefix} timeout --signal=TERM --kill-after=10s "
        f"{int(timeout_seconds)}s {shlex.quote(rscript_bin)} --vanilla "
        f"{shlex.quote('figure_catalog_r_adapter.R')} "
        f"{shlex.quote(script_name)}"
    )


class SshTransport:
    """Adapter for the external SSH boundary."""

    def __init__(
        self,
        host,
        ssh_bin="ssh",
        rscript_bin=DEFAULT_RSCRIPT,
        connect_timeout=15,
    ):
        self.host = host
        self.ssh_bin = ssh_bin
        self.rscript_bin = rscript_bin
        self.connect_timeout = int(connect_timeout)

    def _ssh(self, command, timeout_seconds=None):
        argv = [
            self.ssh_bin,
            "-o",
            "BatchMode=yes",
            "-o",
            f"ConnectTimeout={self.connect_timeout}",
            self.host,
            command,
        ]
        started = time.monotonic()
        try:
            completed = subprocess.run(
                argv,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout_seconds or (self.connect_timeout + 30),
                check=False,
            )
            return {
                "exit_code": completed.returncode,
                "stdout": completed.stdout,
                "stderr": completed.stderr,
                "duration_seconds": time.monotonic() - started,
                "timed_out": False,
            }
        except subprocess.TimeoutExpired as exc:
            stdout = exc.stdout or ""
            stderr = exc.stderr or ""
            if isinstance(stdout, bytes):
                stdout = stdout.decode("utf-8", errors="replace")
            if isinstance(stderr, bytes):
                stderr = stderr.decode("utf-8", errors="replace")
            return {
                "exit_code": 124,
                "stdout": stdout,
                "stderr": stderr + "\nlocal ssh timeout",
                "timed_out": True,
            }

    def _ssh_bytes(self, command, input_bytes=None, timeout_seconds=120):
        argv = [
            self.ssh_bin,
            "-o",
            "BatchMode=yes",
            "-o",
            f"ConnectTimeout={self.connect_timeout}",
            self.host,
            command,
        ]
        try:
            completed = subprocess.run(
                argv,
                input=input_bytes,
                capture_output=True,
                timeout=timeout_seconds,
                check=False,
            )
            return (
                completed.returncode,
                completed.stdout,
                completed.stderr.decode("utf-8", errors="replace"),
            )
        except subprocess.TimeoutExpired as exc:
            stderr = exc.stderr or b""
            if isinstance(stderr, str):
                stderr = stderr.encode("utf-8", errors="replace")
            return (
                124,
                exc.stdout or b"",
                stderr.decode("utf-8", errors="replace")
                + "\nlocal ssh byte-stream timeout",
            )

    def prepare(self, remote_dir):
        result = self._ssh(f"mkdir -p -- {shlex.quote(str(remote_dir))}")
        if result["exit_code"] != 0:
            raise RuntimeError(
                f"remote prepare failed ({result['exit_code']}): "
                f"{result['stderr'].strip()}"
            )

    def upload(self, local_path, remote_path):
        payload = Path(local_path).read_bytes()
        return_code, _stdout, stderr = self._ssh_bytes(
            f"cat > {shlex.quote(str(remote_path))}", input_bytes=payload
        )
        if return_code != 0:
            raise RuntimeError(f"remote upload failed ({return_code}): {stderr.strip()}")

    def execute(self, remote_dir, script_name, output_name, env, timeout_seconds):
        command = build_r_command(
            remote_dir=remote_dir,
            script_name=script_name,
            output_name=output_name,
            env=env,
            timeout_seconds=timeout_seconds,
            rscript_bin=self.rscript_bin,
        )
        result = self._ssh(command, timeout_seconds=int(timeout_seconds) + 30)
        result["command"] = command
        return result

    def download(self, remote_path, local_path):
        return_code, payload, stderr = self._ssh_bytes(
            f"cat {shlex.quote(str(remote_path))}"
        )
        if return_code != 0:
            raise RuntimeError(
                f"remote download failed ({return_code}): {stderr.strip()}"
            )
        target = Path(local_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)

    def cleanup(self, remote_dir):
        remote_dir_q = shlex.quote(str(remote_dir))
        prefix = shlex.quote(
            str(PurePosixPath(DEFAULT_REMOTE_ROOT) / "tmp" / "figure_catalog_validation")
        )
        command = (
            f"case {remote_dir_q} in {prefix}/*) rm -rf -- {remote_dir_q} ;; "
            f"*) echo 'refusing unsafe cleanup' >&2; exit 2 ;; esac"
        )
        result = self._ssh(command)
        if result["exit_code"] != 0:
            raise RuntimeError(
                f"remote cleanup failed ({result['exit_code']}): {result['stderr'].strip()}"
            )


def inspect_png(path):
    path = Path(path)
    result = {
        "path": path.name,
        "exists": path.is_file(),
        "valid": False,
        "blank": None,
        "width": None,
        "height": None,
        "size_bytes": None,
        "sha256": None,
        "detail": "",
    }
    if not path.is_file():
        result["detail"] = "artifact missing"
        return result
    result["size_bytes"] = path.stat().st_size
    result["sha256"] = sha256_file(path)
    try:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            image.load()
            result["width"] = image.width
            result["height"] = image.height
            if image.width < 64 or image.height < 64:
                result["detail"] = "image too small"
                return result
            gray = image.convert("L")
            extrema = gray.getextrema()
            stddev = ImageStat.Stat(gray).stddev[0]
            blank = extrema[1] - extrema[0] <= 1 or stddev <= 1.0
            result["blank"] = blank
            if blank:
                result["detail"] = "image is blank"
                return result
        result["valid"] = True
        result["detail"] = "PIL verify+load, nonblank, dimensions checked"
    except Exception as exc:
        result["detail"] = f"{type(exc).__name__}: {exc}"
    return result


def classify_failure(result, artifact):
    if result["timed_out"] or result["exit_code"] == 124:
        return "timeout"
    if result["exit_code"] != 0:
        text = f"{result['stdout']}\n{result['stderr']}".lower()
        dependency_markers = (
            "there is no package called",
            "package or namespace load failed",
            "library not found",
            "cannot open file",
            "shared object",
        )
        network_markers = (
            "connection reset",
            "connection refused",
            "name resolution",
            "network is unreachable",
            "temporary failure in name resolution",
        )
        if any(marker in text for marker in dependency_markers):
            return "dependency_failure"
        if any(marker in text for marker in network_markers):
            return "network_failure"
        return "code_failure"
    if not artifact["exists"] or not artifact["valid"]:
        return "image_failure"
    return None


def write_text(path, text):
    path = Path(path)
    path.write_text(text, encoding="utf-8", newline="\n")


def verification_report_text(verification):
    artifact = verification["artifact"]
    lines = [
        "step_executed=figure_catalog_r_adapter",
        f"catalog_id={verification['catalog_id']}",
        f"status={verification['status']}",
        f"verdict={verification['verdict']}",
        f"failure_kind={verification.get('failure_kind') or ''}",
        f"exit_code={verification['exit_code']}",
        f"validation_exit={verification['validation_exit']}",
        f"host={verification['environment']['host']}",
        f"seed={verification['environment']['seed']}",
        f"timeout_seconds={verification['timeout_seconds']}",
        f"artifact_sha256={artifact.get('sha256') or ''}",
        f"artifact_width={artifact.get('width') or ''}",
        f"artifact_height={artifact.get('height') or ''}",
        f"artifact_detail={artifact.get('detail', '')}",
    ]
    return "\n".join(lines) + "\n"


def write_batch_outputs(output_root, report):
    output_root = Path(output_root)
    write_text(
        output_root / "batch_report.json",
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
    )
    with (output_root / "summary.tsv").open(
        "w", encoding="utf-8", newline=""
    ) as handle:
        writer = csv.DictWriter(handle, fieldnames=SUMMARY_FIELDS, lineterminator="\n")
        writer.writeheader()
        for entry in report["entries"]:
            artifact = entry.get("artifact") or {}
            writer.writerow(
                {
                    "catalog_id": entry["catalog_id"],
                    "source_status": entry["source_status"],
                    "status": entry["status"],
                    "verdict": entry["verdict"],
                    "failure_kind": entry.get("failure_kind") or "",
                    "exit_code": entry["exit_code"],
                    "validation_exit": entry["validation_exit"],
                    "artifact_sha256": artifact.get("sha256") or "",
                    "width": artifact.get("width") or "",
                    "height": artifact.get("height") or "",
                    "evidence_dir": entry["evidence_dir"],
                }
            )


def summarize_entries(entries):
    summary = {
        "total": len(entries),
        "pass": 0,
        "failed": 0,
        "timeout": 0,
        "dependency_failure": 0,
        "network_failure": 0,
        "code_failure": 0,
        "image_failure": 0,
        "transfer_failure": 0,
        "source_mismatch": 0,
    }
    for entry in entries:
        if entry["verdict"] == "pass":
            summary["pass"] += 1
        else:
            summary["failed"] += 1
            kind = entry.get("failure_kind")
            if kind in summary:
                summary[kind] += 1
    return summary


def run_batch(
    catalog_path,
    output_root,
    seed,
    host="k40-ubuntu",
    remote_root=DEFAULT_REMOTE_ROOT,
    timeout_seconds=DEFAULT_TIMEOUT_SECONDS,
    status=DEFAULT_STATUS,
    rscript_bin=DEFAULT_RSCRIPT,
    transport=None,
    workspace_root=None,
):
    if seed is None:
        raise ValueError("BIOANALYS_SEED is required")
    workspace_root = Path(workspace_root or Path(__file__).resolve().parents[1])
    catalog_path = ensure_within(catalog_path, workspace_root)
    output_root = ensure_within(output_root, workspace_root)
    remote_root = ensure_remote_root(remote_root)
    candidates = load_candidates(catalog_path, status=status)
    if not candidates:
        raise ValueError("no R catalog candidates matched the requested status")
    output_root.mkdir(parents=True, exist_ok=True)
    run_id = "figure_catalog_r_adapter_" + datetime.datetime.now().strftime(
        "%Y%m%d_%H%M%S"
    )
    transport = transport or SshTransport(host=host, rscript_bin=rscript_bin)
    entries = []
    for candidate in candidates:
        catalog_id = candidate["catalog_id"]
        evidence_dir = output_root / catalog_id
        if evidence_dir.exists():
            shutil.rmtree(evidence_dir)
        evidence_dir.mkdir(parents=True)
        source_copy = evidence_dir / "source.R"
        shutil.copy2(candidate["source_path"], source_copy)
        adapter_copy = evidence_dir / "figure_catalog_r_adapter.R"
        adapter_copy.write_text(generate_adapter(), encoding="utf-8", newline="\n")
        source_sha256 = sha256_file(candidate["source_path"])
        remote_dir = remote_root / "tmp" / "figure_catalog_validation" / run_id / catalog_id
        remote_source = remote_dir / source_copy.name
        remote_adapter = remote_dir / adapter_copy.name
        remote_artifact = remote_dir / "output" / f"{catalog_id}.png"
        local_artifact = evidence_dir / "artifact.png"
        stdout_path = evidence_dir / "stdout.txt"
        stderr_path = evidence_dir / "stderr.txt"
        env = dict(THREAD_ENV)
        env.update(
            {
                "BIOANALYS_SEED": str(seed),
                "BIO_FIGURE_OUTPUT": str(remote_artifact),
                "R_LIBS_USER": DEFAULT_R_LIBS,
                "LANG": "C.UTF-8",
            }
        )
        exit_code = None
        stdout = ""
        stderr = ""
        timed_out = False
        failure_kind = None
        transfer_error = ""
        artifact = inspect_png(local_artifact)
        result = {"exit_code": 125, "stdout": "", "stderr": "not executed", "timed_out": False}
        try:
            if candidate["code_file_sha256"] and source_sha256 != candidate["code_file_sha256"]:
                failure_kind = "source_mismatch"
                stderr = "catalog code_file_sha256 does not match source"
            else:
                transport.prepare(remote_dir)
                transport.upload(candidate["source_path"], remote_source)
                transport.upload(adapter_copy, remote_adapter)
                result = transport.execute(
                    remote_dir,
                    source_copy.name,
                    remote_artifact.name,
                    env,
                    int(timeout_seconds),
                )
                exit_code = result["exit_code"]
                stdout = result["stdout"]
                stderr = result["stderr"]
                timed_out = result["timed_out"]
                if result["exit_code"] == 0:
                    try:
                        transport.download(remote_artifact, local_artifact)
                    except Exception as exc:
                        transfer_error = f"{type(exc).__name__}: {exc}"
                        failure_kind = "transfer_failure"
                artifact = inspect_png(local_artifact)
                if failure_kind is None:
                    failure_kind = classify_failure(result, artifact)
        except Exception as exc:
            stderr = stderr + f"\ntransport_error={type(exc).__name__}: {exc}"
            failure_kind = "transfer_failure"
            exit_code = 125
        finally:
            try:
                transport.cleanup(remote_dir)
            except Exception as exc:
                stderr = stderr + f"\ncleanup_error={type(exc).__name__}: {exc}"
        if exit_code is None:
            exit_code = result["exit_code"]
        validation_exit = 0 if artifact["valid"] else 1
        verdict = "pass" if exit_code == 0 and artifact["valid"] and not transfer_error else "fail"
        if verdict == "pass":
            failure_kind = None
            status_value = "k40_verified"
        else:
            status_value = "failed"
            if failure_kind is None:
                failure_kind = classify_failure(result, artifact) or "code_failure"
        write_text(stdout_path, redact_text(stdout))
        write_text(stderr_path, redact_text(stderr))
        verification = {
            "schema_version": SCHEMA_VERSION,
            "catalog_id": catalog_id,
            "run_id": run_id,
            "status": status_value,
            "verdict": verdict,
            "failure_kind": failure_kind,
            "source_status": candidate["source_status"],
            "exit_code": int(exit_code),
            "validation_exit": validation_exit,
            "timed_out": timed_out,
            "timeout_seconds": int(timeout_seconds),
            "environment": {
                "host": host,
                "remote_root": str(remote_root),
                "rscript": rscript_bin,
                "r_libs_user": DEFAULT_R_LIBS,
                "seed": int(seed),
                "threads": 4,
                "env": env,
            },
            "command": {
                "adapter": adapter_copy.name,
                "script": source_copy.name,
                "output": str(remote_artifact),
            },
            "source": {
                "path": str(candidate["source_path"]),
                "sha256": source_sha256,
                "expected_sha256": candidate["code_file_sha256"],
            },
            "artifact": artifact,
            "stdout_path": "stdout.txt",
            "stderr_path": "stderr.txt",
            "artifact_path": "artifact.png" if artifact["exists"] else None,
        }
        write_text(
            evidence_dir / "verification.json",
            json.dumps(verification, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        )
        write_text(evidence_dir / "report.txt", verification_report_text(verification))
        entry = {
            "catalog_id": catalog_id,
            "source_status": candidate["source_status"],
            "status": status_value,
            "verdict": verdict,
            "failure_kind": failure_kind,
            "exit_code": int(exit_code),
            "validation_exit": validation_exit,
            "evidence_dir": evidence_dir.name,
            "artifact": artifact,
            "source_sha256": source_sha256,
        }
        entries.append(entry)
        print(
            f"step_executed=figure_catalog_r_adapter catalog_id={catalog_id} "
            f"verdict={verdict} failure_kind={failure_kind or ''}",
            flush=True,
        )
    summary = summarize_entries(entries)
    report = {
        "schema_version": SCHEMA_VERSION,
        "run_id": run_id,
        "generated_at": datetime.datetime.now().astimezone().isoformat(
            timespec="seconds"
        ),
        "catalog_path": str(catalog_path),
        "output_root": str(output_root),
        "environment": {
            "host": host,
            "remote_root": str(remote_root),
            "rscript": rscript_bin,
            "r_libs_user": DEFAULT_R_LIBS,
            "seed": int(seed),
            "threads": 4,
            "timeout_seconds": int(timeout_seconds),
        },
        "selection": {"language": "R", "status": status},
        "summary": summary,
        "entries": entries,
    }
    write_batch_outputs(output_root, report)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--catalog",
        type=Path,
        default=Path("reference/05.可参考出图代码/library/catalog.json"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("con_hf/runs/2026-10-27_figure_catalog_adaptation/r_adapter"),
    )
    parser.add_argument("--seed", default=None)
    parser.add_argument("--host", default="k40-ubuntu")
    parser.add_argument("--remote-root", default=DEFAULT_REMOTE_ROOT)
    parser.add_argument("--rscript", default=DEFAULT_RSCRIPT)
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_SECONDS)
    parser.add_argument("--status", default=DEFAULT_STATUS)
    parser.add_argument("--ssh-bin", default="ssh")
    args = parser.parse_args(argv)
    if not args.seed:
        print("BIOANALYS_SEED is required; pass --seed", file=sys.stderr)
        raise SystemExit(3)
    transport = SshTransport(
        host=args.host,
        ssh_bin=args.ssh_bin,
        rscript_bin=args.rscript,
    )
    try:
        report = run_batch(
            catalog_path=args.catalog,
            output_root=args.output,
            seed=args.seed,
            host=args.host,
            remote_root=args.remote_root,
            timeout_seconds=args.timeout,
            status=args.status,
            rscript_bin=args.rscript,
            transport=transport,
        )
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"figure_catalog_r_adapter failed: {exc}", file=sys.stderr)
        return 2
    print(
        json.dumps(
            {
                "batch_report": str(Path(args.output) / "batch_report.json"),
                "summary": report["summary"],
            },
            ensure_ascii=False,
        )
    )
    return 0 if report["summary"]["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
