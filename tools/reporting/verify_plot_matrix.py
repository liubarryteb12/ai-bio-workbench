#!/usr/bin/env python3
"""Run and validate every plotting source in the reference library."""

import argparse
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

SENSITIVE_ENV_RE = re.compile(
    r"(?i)(key|token|secret|pass|credential|auth|proxy)"
)
SAFE_ID_RE = re.compile(r"^[a-z0-9_]+$")
SAFE_BASENAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
FORMAL_MATRIX_DEFAULT = Path("references/05.可参考生信代码/可用代码预筛选/源码/_meta/script_plot_matrix.json")
MIN_PNG_DPI = 299.0


def _paths(*names):
    return list(names)


ENTRY_SPECS = [
    {
        "id": "l1_boxplot",
        "source": "L1_\u57fa\u7840\u7edf\u8ba1\u56fe/L1_boxplot_code.R",
        "lang": "r",
        "role": "primary",
        "figure_ids": ["fig_l1_boxplot"],
        "outputs": _paths("L1_boxplot_verified.png", "L1_boxplot_verified.pdf"),
        "seed_mode": "hardcoded",
    },
    {
        "id": "l1_density",
        "source": "L1_\u57fa\u7840\u7edf\u8ba1\u56fe/L1_density_code.R",
        "lang": "r",
        "role": "primary",
        "figure_ids": ["fig_l1_density"],
        "outputs": _paths("L1_density_verified.png", "L1_density_verified.pdf"),
        "seed_mode": "hardcoded",
    },
    {
        "id": "l1_groupedbar",
        "source": "L1_\u57fa\u7840\u7edf\u8ba1\u56fe/L1_groupedbar_code.R",
        "lang": "r",
        "role": "primary",
        "figure_ids": ["fig_l1_groupedbar"],
        "outputs": _paths("L1_groupedbar_verified.png", "L1_groupedbar_verified.pdf"),
        "seed_mode": "hardcoded",
    },
    {
        "id": "l1_histogram",
        "source": "L1_\u57fa\u7840\u7edf\u8ba1\u56fe/L1_histogram_code.R",
        "lang": "r",
        "role": "primary",
        "figure_ids": ["fig_l1_histogram"],
        "outputs": _paths("L1_histogram_verified.png", "L1_histogram_verified.pdf"),
        "seed_mode": "hardcoded",
    },
    {
        "id": "l1_rest",
        "source": "L1_\u57fa\u7840\u7edf\u8ba1\u56fe/L1_rest_code.R",
        "lang": "r",
        "role": "aggregate",
        "figure_ids": [
            "fig_l1_histogram",
            "fig_l1_density",
            "fig_l1_scatter",
            "fig_l1_groupedbar",
        ],
        "outputs": _paths(
            "L1_histogram_verified.png",
            "L1_histogram_verified.pdf",
            "L1_density_verified.png",
            "L1_density_verified.pdf",
            "L1_scatter_verified.png",
            "L1_scatter_verified.pdf",
            "L1_groupedbar_verified.png",
            "L1_groupedbar_verified.pdf",
        ),
        "seed_mode": "hardcoded",
    },
    {
        "id": "l1_scatter",
        "source": "L1_\u57fa\u7840\u7edf\u8ba1\u56fe/L1_scatter_code.R",
        "lang": "r",
        "role": "primary",
        "figure_ids": ["fig_l1_scatter"],
        "outputs": _paths("L1_scatter_verified.png", "L1_scatter_verified.pdf"),
        "seed_mode": "hardcoded",
    },
    {
        "id": "l1_violin",
        "source": "L1_\u57fa\u7840\u7edf\u8ba1\u56fe/L1_violin_code.R",
        "lang": "r",
        "role": "primary",
        "figure_ids": ["fig_l1_violin"],
        "outputs": _paths("L1_violin_verified.png", "L1_violin_verified.pdf"),
        "seed_mode": "hardcoded",
    },    {
        "id": "l2_enrichment",
        "source": "L2_\u7ec4\u5b66\u5e38\u7528\u56fe/L2_enrichment_code.R",
        "lang": "r",
        "role": "primary",
        "figure_ids": [],
        "unmapped": True,
        "outputs": _paths("L2_enrichment_verified.png", "L2_enrichment_verified.pdf"),
        "seed_mode": "hardcoded",
    },
    {
        "id": "l2_heatmap",
        "source": "L2_\u7ec4\u5b66\u5e38\u7528\u56fe/L2_heatmap_code.R",
        "lang": "r",
        "role": "primary",
        "figure_ids": ["fig_l2_heatmap"],
        "outputs": _paths("L2_heatmap_verified.png", "L2_heatmap_verified.pdf"),
        "seed_mode": "hardcoded",
    },
    {
        "id": "l2_more",
        "source": "L2_\u7ec4\u5b66\u5e38\u7528\u56fe/L2_more_code.R",
        "lang": "r",
        "role": "aggregate",
        "figure_ids": ["fig_l2_heatmap", "fig_l2_umap", "fig_l2_pca"],
        "outputs": _paths(
            "L2_heatmap_verified.png",
            "L2_umap_verified.png",
            "L2_umap_verified.pdf",
            "L2_pca_verified.png",
            "L2_pca_verified.pdf",
        ),
        "seed_mode": "hardcoded",
    },
    {
        "id": "l2_pca",
        "source": "L2_\u7ec4\u5b66\u5e38\u7528\u56fe/L2_pca_code.R",
        "lang": "r",
        "role": "primary",
        "figure_ids": ["fig_l2_pca"],
        "outputs": _paths("L2_pca_verified.png", "L2_pca_verified.pdf"),
        "seed_mode": "hardcoded",
    },
    {
        "id": "l2_umap",
        "source": "L2_\u7ec4\u5b66\u5e38\u7528\u56fe/L2_umap_code.R",
        "lang": "r",
        "role": "primary",
        "figure_ids": ["fig_l2_umap"],
        "outputs": _paths("L2_umap_verified.png", "L2_umap_verified.pdf"),
        "seed_mode": "hardcoded",
    },    {
        "id": "l2p_dotplot",
        "source": "L2_\u7ec4\u5b66\u5e38\u7528\u56fe/L2p_dotplot_code.py",
        "lang": "python",
        "role": "primary",
        "figure_ids": ["fig_l2p_dotplot"],
        "outputs": _paths("figures/dotplot__L2p_dotplot_verified.png"),
        "seed_mode": "hardcoded",
    },
    {
        "id": "l2p_more",
        "source": "L2_\u7ec4\u5b66\u5e38\u7528\u56fe/L2p_more_code.py",
        "lang": "python",
        "role": "aggregate",
        "figure_ids": ["fig_l2p_volcano", "fig_l2p_dotplot", "fig_l2p_violin"],
        "outputs": _paths(
            "L2p_volcano_verified.png",
            "L2p_volcano_verified.pdf",
            "figures/dotplot__L2p_dotplot_verified.png",
            "figures/violin_L2p_violin_verified.png",
        ),
        "seed_mode": "hardcoded",
    },
    {
        "id": "l2p_umap",
        "source": "L2_\u7ec4\u5b66\u5e38\u7528\u56fe/L2p_umap_code.py",
        "lang": "python",
        "role": "primary",
        "figure_ids": ["fig_l2p_umap"],
        "outputs": _paths("umap_L2p_umap_verified.png"),
        "seed_mode": "hardcoded",
    },
    {
        "id": "l2p_violin",
        "source": "L2_\u7ec4\u5b66\u5e38\u7528\u56fe/L2p_violin_code.py",
        "lang": "python",
        "role": "primary",
        "figure_ids": ["fig_l2p_violin"],
        "outputs": _paths("figures/violin_L2p_violin_verified.png"),
        "seed_mode": "hardcoded",
    },
    {
        "id": "l2p_volcano",
        "source": "L2_\u7ec4\u5b66\u5e38\u7528\u56fe/L2p_volcano_code.py",
        "lang": "python",
        "role": "primary",
        "figure_ids": ["fig_l2p_volcano"],
        "outputs": _paths("L2p_volcano_verified.png", "L2p_volcano_verified.pdf"),
        "seed_mode": "hardcoded",
    },
    {
        "id": "l3_multipanel",
        "retired": True,
        "retired_reason": "figure_spec v2.3：生产默认只出单图，组合图证据不进入 Ready 基线",
        "source": "L3_\u9ad8\u7ea7\u7ec4\u5408\u56fe/L3_multipanel_code.R",
        "lang": "r",
        "role": "primary",
        "figure_ids": ["fig_l3_multipanel"],
        "outputs": _paths(
            "L3_multipanel_verified.png",
            "L3_multipanel_verified.pdf",
            "L3_multipanel_report.txt",
        ),
        "inputs": [("L3_\u9ad8\u7ea7\u7ec4\u5408\u56fe/input_data.csv", "input_data.csv")],
        "seed_mode": "external",
    },
    {
        "id": "l3_multippanel_quarantine",
        "source": "L3_\u9ad8\u7ea7\u7ec4\u5408\u56fe/L3_multippanel_code.R",
        "lang": "r",
        "role": "quarantined_duplicate",
        "figure_ids": [],
        "outputs": [],
        "quarantined": True,
        "quarantine_reason": "_QUARANTINE_NOTE.md excludes this file from entries and verification.",
    },    {
        "id": "compat_l1_boxplot",
        "source": "_meta/R453_compat/L1_boxplot_code.R",
        "lang": "r",
        "role": "compat",
        "figure_ids": ["fig_l1_boxplot"],
        "outputs": _paths("L1_boxplot_verified.png", "L1_boxplot_verified.pdf"),
        "seed_mode": "hardcoded",
    },
    {
        "id": "compat_l1_rest",
        "source": "_meta/R453_compat/L1_rest_code.R",
        "lang": "r",
        "role": "compat",
        "figure_ids": [
            "fig_l1_histogram",
            "fig_l1_density",
            "fig_l1_scatter",
            "fig_l1_groupedbar",
        ],
        "outputs": _paths(
            "L1_histogram_verified.png",
            "L1_histogram_verified.pdf",
            "L1_density_verified.png",
            "L1_density_verified.pdf",
            "L1_scatter_verified.png",
            "L1_scatter_verified.pdf",
            "L1_groupedbar_verified.png",
            "L1_groupedbar_verified.pdf",
        ),
        "seed_mode": "hardcoded",
    },
    {
        "id": "compat_l1_violin",
        "source": "_meta/R453_compat/L1_violin_code.R",
        "lang": "r",
        "role": "compat",
        "figure_ids": ["fig_l1_violin"],
        "outputs": _paths("L1_violin_verified.png", "L1_violin_verified.pdf"),
        "seed_mode": "hardcoded",
    },
    {
        "id": "compat_l2_core",
        "source": "_meta/R453_compat/L2_core_code.R",
        "lang": "r",
        "role": "compat",
        "figure_ids": ["fig_l2_volcano", "fig_l2_heatmap"],
        "outputs": _paths(
            "L2_volcano_verified.png",
            "L2_volcano_verified.pdf",
            "L2_enrichment_verified.png",
            "L2_enrichment_verified.pdf",
            "L2_heatmap_verified.pdf",
        ),
        "seed_mode": "hardcoded",
    },
    {
        "id": "compat_l2_more",
        "source": "_meta/R453_compat/L2_more_code.R",
        "lang": "r",
        "role": "compat",
        "figure_ids": ["fig_l2_heatmap", "fig_l2_umap", "fig_l2_pca"],
        "outputs": _paths(
            "L2_heatmap_verified.png",
            "L2_umap_verified.png",
            "L2_umap_verified.pdf",
            "L2_pca_verified.png",
            "L2_pca_verified.pdf",
        ),
        "seed_mode": "hardcoded",
    },
    {
        "id": "compat_l3_sankey",
        "source": "_meta/R453_compat/L3_sankey_code.R",
        "lang": "r",
        "role": "compat",
        "figure_ids": ["fig_l3_sankey"],
        "outputs": _paths("L3_sankey_verified.png", "L3_sankey_verified.pdf"),
        "seed_mode": "hardcoded",
    },
]


def file_sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_sha256(path):
    path = Path(path)
    return file_sha256(path) if path.is_file() else None


def ensure_within(path, root):
    resolved = Path(path).resolve()
    root_resolved = Path(root).resolve()
    if not resolved.is_relative_to(root_resolved):
        raise ValueError(f"path outside workspace root: {resolved}")
    return resolved


def safe_relative_path(root, relative):
    relative = Path(relative)
    if relative.is_absolute():
        raise ValueError(f"absolute relative path is forbidden: {relative}")
    return ensure_within(Path(root) / relative, root)


def safe_target_name(name):
    name = str(name)
    if (
        name in {".", "..", "manifest.json"}
        or re.fullmatch(r"source\.[A-Za-z0-9]+", name)
        or not SAFE_BASENAME_RE.fullmatch(name)
    ):
        raise ValueError(f"unsafe input target name: {name}")
    return name


def validate_payload_entries(manifest_entries, expected_ids):
    if not isinstance(manifest_entries, list):
        raise ValueError("payload manifest must contain an entries array")
    validated = {}
    for item in manifest_entries:
        if not isinstance(item, dict):
            raise ValueError("payload manifest entry must be an object")
        entry_id = item.get("id")
        if not isinstance(entry_id, str) or not SAFE_ID_RE.fullmatch(entry_id):
            raise ValueError(f"unsafe payload entry id: {entry_id}")
        if entry_id in validated:
            raise ValueError(f"duplicate payload entry id: {entry_id}")
        source = item.get("source")
        if not isinstance(source, str) or not source:
            raise ValueError(f"payload entry has no source: {entry_id}")
        suffix = item.get("source_suffix")
        if not isinstance(suffix, str) or not re.fullmatch(r"\.[A-Za-z0-9]+", suffix):
            raise ValueError(f"unsafe source suffix for {entry_id}: {suffix}")
        source_sha256 = item.get("source_sha256")
        if not isinstance(source_sha256, str) or not SHA256_RE.fullmatch(source_sha256):
            raise ValueError(f"invalid source hash for {entry_id}")
        inputs = item.get("inputs", [])
        if not isinstance(inputs, list):
            raise ValueError(f"payload inputs must be an array for {entry_id}")
        for input_spec in inputs:
            if not isinstance(input_spec, dict):
                raise ValueError(f"payload input must be an object for {entry_id}")
            if not isinstance(input_spec.get("source"), str):
                raise ValueError(f"payload input source is missing for {entry_id}")
            safe_target_name(input_spec.get("target"))
        validated[entry_id] = item
    expected_ids = set(expected_ids)
    actual_ids = set(validated)
    if actual_ids != expected_ids:
        raise ValueError(
            "payload manifest entry set mismatch: "
            f"missing={sorted(expected_ids - actual_ids)} "
            f"extra={sorted(actual_ids - expected_ids)}"
        )
    return validated


def redact_text(text, env=None):
    text = text or ""
    env = env or os.environ
    for name, value in env.items():
        if SENSITIVE_ENV_RE.search(name) and value and len(value) >= 4:
            text = text.replace(value, "<REDACTED>")
    return re.sub(
        r"(?i)(\b(?:api[_-]?key|token|secret|password|passwd|credential)\b"
        r"\s*[:=]\s*)([^\s]+)",
        r"\1<REDACTED>",
        text,
    )


def child_environment():
    env = {
        name: value
        for name, value in os.environ.items()
        if not SENSITIVE_ENV_RE.search(name)
    }
    env.update(
        {
            "R_LIBS_USER": "/opt/R/4.5.3-site-library",
            "R_PROFILE_USER": "/mnt/ssd/bio_data/ops/layout_autoload/Rprofile",
            "PYTHONPATH": "/mnt/ssd/bio_data/ops/layout_autoload:"
            + env.get("PYTHONPATH", ""),
            "MPLBACKEND": "Agg",
            "OMP_NUM_THREADS": "3",
            "OPENBLAS_NUM_THREADS": "3",
            "MKL_NUM_THREADS": "3",
            "NUMEXPR_NUM_THREADS": "3",
            "NUMBA_NUM_THREADS": "3",
            "VECLIB_MAXIMUM_THREADS": "3",
        }
    )
    return env


def version_text(command, env):
    try:
        completed = subprocess.run(
            command,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError(f"version command failed: {command[0]}: {exc}") from exc
    return redact_text(completed.stdout.strip())


def rewrite_boxplot_output_root(source, target):
    text = Path(source).read_text(encoding="utf-8")
    replaced = text.replace("/tmp/figlib", str(Path(target).parent).replace("\\", "/"))
    Path(target).parent.mkdir(parents=True, exist_ok=True)
    Path(target).write_text(replaced, encoding="utf-8", newline="\n")
    return replaced != text


def marker_present(stdout, report_paths):
    if "RENDER_OK" in (stdout or ""):
        return True
    for path in report_paths:
        path = Path(path)
        if path.is_file() and path.suffix.lower() == ".txt":
            if "RENDER_OK" in path.read_text(encoding="utf-8", errors="replace"):
                return True
    return False


def inspect_png(path):
    try:
        from PIL import Image, ImageStat

        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            image.load()
            width, height = image.size
            dpi = image.info.get("dpi")
            if isinstance(dpi, (tuple, list)) and len(dpi) >= 2:
                dpi = [round(float(dpi[0]), 3), round(float(dpi[1]), 3)]
            else:
                dpi = None
            variance = ImageStat.Stat(image.convert("RGB")).var
            pixel_variance = round(max(variance), 6)
        if width <= 0 or height <= 0:
            return False, {
                "width": width,
                "height": height,
                "dpi": dpi,
                "pixel_variance": pixel_variance,
                "detail": "invalid PNG dimensions",
            }
        if pixel_variance <= 1.0:
            return False, {
                "width": width,
                "height": height,
                "dpi": dpi,
                "pixel_variance": pixel_variance,
                "detail": "blank PNG",
            }
        if not isinstance(dpi, list) or len(dpi) < 2 or min(dpi) < MIN_PNG_DPI:
            return False, {
                "width": width,
                "height": height,
                "dpi": dpi,
                "pixel_variance": pixel_variance,
                "detail": f"PNG must be at least 300 DPI, got {dpi}",
            }
        return True, {
            "width": width,
            "height": height,
            "dpi": dpi,
            "pixel_variance": pixel_variance,
            "detail": "PIL verify+load and nonblank check passed",
        }
    except Exception as exc:
        return False, {"detail": f"PIL verify+load failed: {type(exc).__name__}: {exc}"}


def inspect_artifact(path):
    path = Path(path)
    meta = {
        "path": str(path),
        "exists": path.is_file(),
        "size_bytes": path.stat().st_size if path.is_file() else 0,
        "sha256": file_sha256(path) if path.is_file() else None,
    }
    if not path.is_file():
        meta.update(ok=False, detail="missing")
        return meta
    suffix = path.suffix.lower()
    if suffix == ".png":
        ok, details = inspect_png(path)
    elif suffix == ".pdf":
        with path.open("rb") as handle:
            ok = handle.read(5) == b"%PDF-"
        details = {"detail": "PDF header passed; full validation not performed"}
    elif suffix == ".txt":
        ok = path.stat().st_size > 0
        details = {"detail": "nonempty text report"}
    else:
        ok = False
        details = {"detail": "unsupported artifact type"}
    if ok and suffix in {".png", ".pdf"} and path.stat().st_size <= 1000:
        ok = False
        details = {"detail": "artifact file is too small"}
    meta.update(ok=ok, **details)
    return meta


def summarize_artifacts(entries):
    artifacts = [
        artifact
        for entry in entries
        for artifact in entry.get("artifacts", [])
    ]
    png = [item for item in artifacts if item["path"].lower().endswith(".png")]
    pdf = [item for item in artifacts if item["path"].lower().endswith(".pdf")]
    text = [item for item in artifacts if item["path"].lower().endswith(".txt")]
    return {
        "total": len(artifacts),
        "png": len(png),
        "png_unique_sha256": len(
            {item["sha256"] for item in png if item.get("sha256")}
        ),
        "pdf": len(pdf),
        "txt": len(text),
        "invalid": sum(not item.get("ok") for item in artifacts),
    }


def build_formal_matrix(report):
    entries = []
    for entry in report.get("entries", []):
        if entry.get("quarantined"):
            continue
        entries.append({
            "entry_id": entry["id"],
            "script_path": entry["source"],
            "source_sha256": entry["source_sha256"],
            "language": entry["lang"],
            "role": entry["role"],
            "figure_ids": entry.get("figure_ids", []),
            "execution_mode": "direct_exact_sha256",
            "compat_pair": None,
            "fixture_input": [
                item.get("target")
                for item in entry.get("inputs", [])
                if isinstance(item, dict)
            ] or ["internal_or_builtin"],
            "expected_outputs": entry.get("outputs", []),
            "artifacts": entry.get("artifacts", []),
            "k40_exit_code": entry.get("execution", {}).get("exit_code"),
            "marker_found": entry.get("execution", {}).get("marker_found") is True,
            "seed_mode": entry.get("seed_mode", "unknown"),
            "seed_environment": report.get("seed"),
            "status": entry.get("run_status"),
            "evidence_run_id": report.get("run_id"),
        })
    return {
        "schema_version": "1.0.0",
        "generated_at": report.get("generated_at"),
        "run_id": report.get("run_id"),
        "k40_env": report.get("environment", {}),
        "entries": entries,
    }


def validate_formal_matrix(matrix_path, reference_root=None):
    path = Path(matrix_path)
    try:
        matrix = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"matrix unreadable or invalid JSON: {exc}") from exc
    entries = matrix.get("entries")
    if not isinstance(entries, list) or len(entries) != 27:
        count = len(entries) if isinstance(entries, list) else "non-list"
        raise ValueError(f"matrix must contain exactly 27 entries, got {count}")
    seen = set()
    for entry in entries:
        entry_id = entry.get("entry_id")
        if not isinstance(entry_id, str) or not SAFE_ID_RE.fullmatch(entry_id):
            raise ValueError(f"invalid entry_id: {entry_id}")
        if entry_id in seen:
            raise ValueError(f"duplicate entry_id: {entry_id}")
        seen.add(entry_id)
        if entry.get("status") != "pass":
            raise ValueError(f"{entry_id}: status is not pass")
        if entry.get("k40_exit_code") != 0:
            raise ValueError(f"{entry_id}: k40_exit_code is not 0")
        if entry.get("marker_found") is not True:
            raise ValueError(f"{entry_id}: RENDER_OK marker missing")
        source_sha = entry.get("source_sha256")
        if not isinstance(source_sha, str) or not SHA256_RE.fullmatch(source_sha):
            raise ValueError(f"{entry_id}: invalid source_sha256")
        if reference_root is not None:
            source = safe_relative_path(reference_root, entry.get("script_path", ""))
            if safe_sha256(source) != source_sha:
                raise ValueError(f"{entry_id}: source hash drift")
        outputs = entry.get("expected_outputs")
        if not isinstance(outputs, list) or not outputs:
            raise ValueError(f"{entry_id}: expected_outputs missing")
        artifacts = entry.get("artifacts")
        if not isinstance(artifacts, list) or not artifacts:
            raise ValueError(f"{entry_id}: artifacts missing")
        if any(not item.get("ok") for item in artifacts):
            raise ValueError(f"{entry_id}: one or more artifacts failed validation")
    return {
        "ok": True,
        "matrix": str(path),
        "entries": len(entries),
        "run_id": matrix.get("run_id"),
        "overall_status": "pass",
    }


def command_prefix():
    prefix = []
    if shutil.which("nice"):
        prefix.extend(["nice", "-n", "10"])
    if shutil.which("ionice"):
        prefix.extend(["ionice", "-c", "2", "-n", "4"])
    return prefix


def run_entry(spec, source_path, input_paths, output_root, seed, rscript, python, timeout):
    entry_id = spec["id"]
    run_dir = output_root / "runs" / entry_id
    run_dir = ensure_within(run_dir, output_root)
    if run_dir.exists():
        shutil.rmtree(run_dir)
    run_dir.mkdir(parents=True)
    source = Path(source_path)
    if not source.is_file():
        return {"ok": False, "error": "source missing"}, run_dir

    try:
        run_source = run_dir / source.name
        if spec.get("rewrite_tmp_figlib"):
            rewrite_boxplot_output_root(source, run_source)
        else:
            shutil.copy2(source, run_source)
        for source_file, target_name in input_paths:
            if Path(source_file).is_file():
                shutil.copy2(source_file, run_dir / target_name)
            else:
                return {"ok": False, "error": f"input missing: {source_file}"}, run_dir
    except OSError as exc:
        return {"ok": False, "error": f"staging failed: {exc}"}, run_dir

    env = child_environment()
    env.update(
        {
            "BIOANALYS_SEED": str(seed),
            "R453_OUT_DIR": str(run_dir),
        }
    )
    if spec["lang"] == "r":
        command = command_prefix() + [
            rscript,
            "--no-save",
            "--no-restore",
            "--no-site-file",
            "--no-environ",
            str(run_source),
        ]
    else:
        command = command_prefix() + [python, str(run_source)]

    try:
        completed = subprocess.run(
            command,
            cwd=run_dir,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
        stdout = redact_text(completed.stdout)
        stderr = redact_text(completed.stderr)
        exit_code = completed.returncode
        error = None
    except subprocess.TimeoutExpired as exc:
        stdout = redact_text(exc.stdout or "")
        stderr = redact_text(exc.stderr or "")
        exit_code = None
        error = f"timeout after {timeout}s"
    except OSError as exc:
        stdout = ""
        stderr = ""
        exit_code = None
        error = f"process start failed: {exc}"

    (run_dir / "runner.log").write_text(
        "command=" + " ".join(command) + "\n"
        f"exit_code={exit_code}\n"
        "stdout\n" + stdout + "\n"
        "stderr\n" + stderr + "\n",
        encoding="utf-8",
        newline="\n",
    )
    result = {
        "ok": exit_code == 0,
        "exit_code": exit_code,
        "marker_found": "RENDER_OK" in stdout,
        "stdout_tail": stdout[-4000:],
        "stderr_tail": stderr[-4000:],
    }
    if error:
        result["error"] = error
    return result, run_dir


def usability(entry):
    if entry["quarantined"]:
        return "excluded_by_policy"
    if entry["run_status"] != "pass" or entry["artifact_status"] != "pass":
        return "unavailable"
    if entry.get("unmapped"):
        return "available_unmapped_demo"
    return "available_demo"


def markdown_report(report):
    lines = [
        "# Plot Source Availability",
        "",
        f"Run id: `{report['run_id']}`",
        "",
        "This matrix verifies source-level rendering on K40. The usage unit is each individual "
        "PNG or PDF listed for an entry. Every available row is a demo template, not a production "
        "template.",
        "",
        "| Entry | Role | Source | Run | Artifact | Usability | SHA256 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for entry in report["entries"]:
        lines.append(
            "| {id} | {role} | `{source}` | {run_status} | {artifact_status} | "
            "{usability} | `{sha256}` |".format(
                id=entry["id"],
                role=entry["role"],
                source=entry["source"],
                run_status=entry["run_status"],
                artifact_status=entry["artifact_status"],
                usability=entry["usability"],
                sha256=entry["source_sha256"],
            )
        )
    lines.extend(
        [
            "",
            "## Summary",
            "",
            f"- Sources: {report['summary']['total']}",
            f"- Executed: {report['summary']['executed']}",
            f"- Available demo sources: {report['summary']['available']}",
            f"- Failed: {report['summary']['failed']}",
            f"- Quarantined: {report['summary']['quarantined']}",
            f"- Artifacts: {report['summary']['artifacts']['total']}",
            f"- PNGs: {report['summary']['artifacts']['png']}",
            f"- Unique PNG SHA256 values: {report['summary']['artifacts']['png_unique_sha256']}",
            f"- PDFs: {report['summary']['artifacts']['pdf']}",
            "",
            "## Caveats",
            "",
            "- Most demo scripts hardcode seed 42 instead of the workspace external seed contract.",
            "- Most demo scripts create synthetic data and do not consume their documented input_data.csv.",
            "- The L1 boxplot masters honor R453_OUT_DIR and are executed from their exact source bytes.",
            "- The L1 boxplot legend overlaps the plotting area and needs layout review before delivery.",
            "- The L2 enrichment bubble chart is runnable but has no registered figure id.",
            "- The L3 multipanel code implements a closed panel/group/value CSV contract, which is narrower than its README.",
            f"- The {report['summary']['artifacts']['png']} PNG files collapse to "
            f"{report['summary']['artifacts']['png_unique_sha256']} unique SHA256 values "
            "because aggregate and compatibility sources repeat the same renders.",
            "- The combined contact sheet is QA-only and is not a deliverable.",
            "- PDF validation checks the file header only.",
        ]
    )
    return "\n".join(lines) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference-root", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--run-id")
    parser.add_argument("--payload-root", type=Path)
    parser.add_argument("--payload-manifest", type=Path)
    parser.add_argument("--emit-plan", type=Path)
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("--matrix", type=Path)
    parser.add_argument("--workspace-root", type=Path, default=Path.cwd())
    parser.add_argument("--seed", type=int, default=20261013)
    parser.add_argument("--rscript", default="/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript")
    parser.add_argument("--python", default="/root/venvs/bio-py/bin/python3")
    parser.add_argument("--timeout", type=int, default=300)
    args = parser.parse_args(argv)
    if args.strict:
        try:
            workspace_root = ensure_within(args.workspace_root, args.workspace_root)
            reference_root = args.reference_root or (workspace_root / "references" / "05.可参考生信代码" / "可用代码预筛选" / "源码")
            reference_root = ensure_within(reference_root, workspace_root)
            matrix_path = args.matrix or (reference_root / "_meta" / "script_plot_matrix.json")
            payload = validate_formal_matrix(matrix_path, reference_root)
        except (ValueError, OSError) as exc:
            print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, sort_keys=True))
            return 2
        print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
        return 0
    if args.reference_root is None:
        parser.error("--reference-root is required unless --strict is used")
    try:
        workspace_root = ensure_within(args.workspace_root, args.workspace_root)
        reference_root = ensure_within(args.reference_root, workspace_root)
    except ValueError as exc:
        parser.error(str(exc))

    if args.emit_plan:
        try:
            plan_path = ensure_within(args.emit_plan, workspace_root)
        except ValueError as exc:
            parser.error(str(exc))
        plan_entries = []
        for spec in ENTRY_SPECS:
            try:
                source = safe_relative_path(reference_root, spec["source"])
            except ValueError as exc:
                parser.error(str(exc))
            plan_entries.append(
                {
                    "id": spec["id"],
                    "source": spec["source"],
                    "source_suffix": source.suffix,
                    "source_sha256": safe_sha256(source),
                    "quarantined": bool(spec.get("quarantined")),
                    "inputs": [
                        {"source": source_rel, "target": target_name}
                        for source_rel, target_name in spec.get("inputs", [])
                    ],
                }
            )
        plan_path.parent.mkdir(parents=True, exist_ok=True)
        plan_path.write_text(
            json.dumps({"entries": plan_entries}, ensure_ascii=False, indent=2, sort_keys=True)
            + "\n",
            encoding="utf-8",
            newline="\n",
        )
        print(str(plan_path))
        return 0

    if args.output is None or not args.run_id:
        parser.error("--output and --run-id are required unless --emit-plan is used")

    payload_manifest = None
    payload_entries = {}
    if args.payload_root or args.payload_manifest:
        if not args.payload_root or not args.payload_manifest:
            parser.error("--payload-root and --payload-manifest must be used together")
        try:
            payload_root = ensure_within(args.payload_root, workspace_root)
            payload_manifest_path = ensure_within(args.payload_manifest, workspace_root)
        except ValueError as exc:
            parser.error(str(exc))
        try:
            payload_manifest = json.loads(
                payload_manifest_path.read_text(encoding="utf-8")
            )
        except (OSError, json.JSONDecodeError) as exc:
            parser.error(f"payload manifest is unreadable or invalid JSON: {exc}")
        expected_ids = {spec["id"] for spec in ENTRY_SPECS}
        try:
            payload_entries = validate_payload_entries(
                payload_manifest.get("entries"),
                expected_ids,
            )
        except ValueError as exc:
            parser.error(str(exc))

    if not SAFE_ID_RE.fullmatch(args.run_id):
        parser.error("--run-id must match [a-z0-9_]+")
    try:
        output_root = ensure_within(args.output, workspace_root)
    except ValueError as exc:
        parser.error(str(exc))
    if output_root == workspace_root:
        parser.error("--output must be a child directory of --workspace-root")
    output_root.mkdir(parents=True, exist_ok=True)
    entries = []
    for spec in ENTRY_SPECS:
        payload_entry = payload_entries.get(spec["id"])
        if payload_entry:
            payload_dir = ensure_within(payload_root / spec["id"], payload_root)
            suffix = payload_entry.get("source_suffix", "")
            if not re.fullmatch(r"\.[A-Za-z0-9]+", suffix):
                parser.error(f"unsafe source suffix for {spec['id']}: {suffix}")
            source = ensure_within(payload_dir / ("source" + suffix), payload_dir)
            expected_sha = payload_entry["source_sha256"]
            source_sha = safe_sha256(source)
            input_paths = []
            for item in payload_entry.get("inputs", []):
                try:
                    target_name = safe_target_name(item["target"])
                    input_path = ensure_within(payload_dir / target_name, payload_dir)
                except ValueError as exc:
                    parser.error(str(exc))
                input_paths.append((input_path, target_name))
        else:
            source = safe_relative_path(reference_root, spec["source"])
            expected_sha = safe_sha256(source)
            source_sha = expected_sha
            input_paths = [
                (
                    safe_relative_path(reference_root, source_rel),
                    target_name,
                )
                for source_rel, target_name in spec.get("inputs", [])
            ]
        for _, target_name in input_paths:
            try:
                safe_target_name(target_name)
            except ValueError as exc:
                parser.error(str(exc))
        payload_source_matches = expected_sha is not None and source_sha == expected_sha
        item = {
            **{key: value for key, value in spec.items() if key not in {"inputs"}},
            "source_sha256": source_sha,
            "quarantined": bool(spec.get("quarantined")),
            "payload_source_matches": payload_source_matches,
        }
        if not payload_source_matches:
            item.update(
                run_status="fail",
                artifact_status="fail",
                artifacts=[],
                execute_source_sha256=None,
                execution={"ok": False, "error": "payload source hash mismatch"},
            )
        elif spec.get("quarantined"):
            item.update(
                run_status="not_run",
                artifact_status="not_applicable",
                artifacts=[],
                execute_source_sha256=None,
            )
        else:
            result, run_dir = run_entry(
                spec,
                source,
                input_paths,
                output_root,
                args.seed,
                args.rscript,
                args.python,
                args.timeout,
            )
            artifacts = []
            for output_rel in spec["outputs"]:
                artifact = inspect_artifact(run_dir / output_rel)
                artifact["relative_path"] = output_rel
                artifacts.append(artifact)
            artifact_ok = bool(artifacts) and all(item["ok"] for item in artifacts)
            report_paths = [
                run_dir / output_rel
                for output_rel in spec["outputs"]
                if output_rel.lower().endswith(".txt")
            ]
            result["marker_found"] = marker_present(result.get("stdout_tail", ""), report_paths)
            result["ok"] = result.get("exit_code") == 0 and result["marker_found"]
            run_status = "pass" if result["ok"] and artifact_ok else "fail"
            item.update(
                run_status=run_status,
                artifact_status="pass" if artifact_ok else "fail",
                artifacts=artifacts,
                execution=result,
                execute_source_sha256=safe_sha256(run_dir / source.name),
            )
        item["usability"] = usability(item)
        entries.append(item)

    executed = [item for item in entries if not item["quarantined"]]
    available = [item for item in entries if item["usability"].startswith("available")]
    failed = [item for item in executed if item["run_status"] != "pass"]
    version_env = child_environment()
    try:
        r_version = version_text([args.rscript, "--version"], version_env)
        python_version = version_text([args.python, "--version"], version_env)
    except RuntimeError as exc:
        parser.error(str(exc))
    report = {
        "schema_version": 1,
        "run_id": args.run_id,
        "usage_unit": "single_png",
        "contact_sheet": "qa_only",
        "generated_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "seed": args.seed,
        "environment": {
            "rscript": args.rscript,
            "python": args.python,
            "python_version": python_version,
            "r_version": r_version,
            "r_libs_user": "/opt/R/4.5.3-site-library",
            "threads": 3,
            "backend": "Agg",
        },
        "entries": entries,
        "summary": {
            "total": len(entries),
            "executed": len(executed),
            "available": len(available),
            "failed": len(failed),
            "quarantined": len(entries) - len(executed),
            "artifacts": summarize_artifacts(entries),
            "overall_status": "pass" if not failed else "fail",
        },
    }
    matrix_path = output_root / "plot_matrix.json"
    formal_matrix_path = output_root / "script_plot_matrix.json"
    markdown_path = output_root / "PLOT_AVAILABILITY.md"
    summary_path = output_root / "summary.tsv"
    matrix_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    formal_matrix = build_formal_matrix(report)
    formal_matrix_path.write_text(
        json.dumps(formal_matrix, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    markdown_path.write_text(markdown_report(report), encoding="utf-8", newline="\n")
    summary = ["entry\trole\trun_status\tartifact_status\tusability\tsource_sha256"]
    for item in entries:
        summary.append(
            "\t".join(
                [
                    item["id"],
                    item["role"],
                    item["run_status"],
                    item["artifact_status"],
                    item["usability"],
                    item["source_sha256"] or "",
                ]
            )
        )
    summary_path.write_text("\n".join(summary) + "\n", encoding="utf-8", newline="\n")
    print(
        json.dumps(
            {
                "run_id": args.run_id,
                "matrix": str(matrix_path),
                "formal_matrix": str(formal_matrix_path),
                "summary": report["summary"],
            },
            ensure_ascii=False,
        )
    )
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
