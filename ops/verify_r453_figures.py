#!/usr/bin/env python3
"""Run the 17 verified figure sources under R 4.5.3 and validate artifacts."""

import argparse
import datetime
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


CORE_PACKAGES = [
    "WGCNA", "clusterProfiler", "limma", "enrichplot", "fgsea", "DOSE",
    "GOSemSim", "aplot", "ggtree", "treeio", "GSVA", "GSEABase",
    "org.Hs.eg.db", "org.Mm.eg.db", "ComplexHeatmap", "ggplot2",
    "data.table", "glmnet", "survival", "pROC", "patchwork", "igraph",
]

RUNNERS = [
    {"id": "r_l1_boxplot", "lang": "r", "script": "_meta/R453_compat/L1_boxplot_code.R"},
    {"id": "r_l1_violin", "lang": "r", "script": "_meta/R453_compat/L1_violin_code.R"},
    {"id": "r_l1_rest", "lang": "r", "script": "_meta/R453_compat/L1_rest_code.R"},
    {"id": "r_l2_core", "lang": "r", "script": "_meta/R453_compat/L2_core_code.R"},
    {"id": "r_l2_more", "lang": "r", "script": "_meta/R453_compat/L2_more_code.R"},
    {"id": "r_l3_sankey", "lang": "r", "script": "_meta/R453_compat/L3_sankey_code.R"},
    {
        "id": "r_l3_multipanel",
        "lang": "r",
        "script": "L3_高级组合图/L3_multipanel_code.R",
        "copy": [("L3_高级组合图/input_data.csv", "input_data.csv")],
    },
    {"id": "py_l2p_umap", "lang": "python", "script": "L2_组学常用图/L2p_umap_code.py"},
    {"id": "py_l2p_more", "lang": "python", "script": "L2_组学常用图/L2p_more_code.py"},
    {"id": "py_l2p_stats", "lang": "python", "script": "L2_组学常用图/L2p_stats_code.py"},
    {
        "id": "r_l1_p0_gallery",
        "lang": "r",
        "script": "_meta/R453_compat/L1_p0_gallery_code.R",
    },
    {"id": "py_l2p_enrich_ko", "lang": "python", "script": "L2_组学常用图/L2p_enrich_ko_code.py"},
    {"id": "py_l2p_cellcomm_autocorr", "lang": "python", "script": "L2_组学常用图/L2p_cellcomm_autocorr_code.py"},
]

FIGURE_ARTIFACTS = {
    "fig_l1_groupedbar": "r_l1_rest:L1_groupedbar_verified",
    "fig_l2_heatmap": ["r_l2_core:L2_heatmap_verified.pdf", "r_l2_more:L2_heatmap_verified.png"],
    "fig_l2_pca": "r_l2_more:L2_pca_verified",
    "fig_l1_scatter": "r_l1_rest:L1_scatter_verified",
    "fig_l2_umap": "r_l2_more:L2_umap_verified",
    "fig_l1_boxplot": "r_l1_boxplot:L1_boxplot_verified",
    "fig_l1_density": "r_l1_rest:L1_density_verified",
    "fig_l1_histogram": "r_l1_rest:L1_histogram_verified",
    "fig_l1_violin": "r_l1_violin:L1_violin_verified",
    "fig_l2_volcano": "r_l2_core:L2_volcano_verified",
    "fig_l2p_dotplot": "py_l2p_more:figures/dotplot__L2p_dotplot_verified.png",
    "fig_l2p_umap": "py_l2p_umap:umap_L2p_umap_verified.png",
    "fig_l2p_violin": "py_l2p_more:figures/violin_L2p_violin_verified.png",
    "fig_l2p_volcano": "py_l2p_more:L2p_volcano_verified",
    "fig_l3_sankey": "r_l3_sankey:L3_sankey_verified",
    "fig_l3_multipanel": "r_l3_multipanel:L3_multipanel_verified",
    "fig_l2p_scatterplot": "py_l2p_stats:L2p_scatter_verified.png",
    "fig_l2p_barplot": "py_l2p_stats:L2p_bar_verified.png",
    "fig_l2p_boxplot": "py_l2p_stats:L2p_box_verified.png",
    "fig_l2p_heatmap": "py_l2p_stats:L2p_heatmap_verified.png",
    "fig_l1_ridgeline": "r_l1_p0_gallery:L1_ridgeline_verified.png",
    "fig_l1_upsetplot": "r_l1_p0_gallery:L1_upset_verified.png",
    "fig_l1_vennplot": "r_l1_p0_gallery:L1_venn_verified.png",
    "fig_l1_correlogram": "r_l1_p0_gallery:L1_correlogram_verified.png",
    "fig_l1_bubble": "r_l1_p0_gallery:L1_bubble_verified.png",
    "fig_l3_chorddiagram": "py_l2p_cellcomm_autocorr:L3_cellcomm_chord_verified.png",
    "fig_l1_connectedscatter": "py_l2p_cellcomm_autocorr:L3_spatial_autocorr_verified.png",
    "fig_l2p_gseaplot": "py_l2p_enrich_ko:L2p_gsea_verified.png",
    "fig_l2p_enrichmentplot": "py_l2p_enrich_ko:L2p_enrichment_verified.png",
    "fig_l2_networkplot": "py_l2p_enrich_ko:L2p_konetwork_verified.png",
}
BLOCKED_FIGURES = [
    {
        "id": "fig_kegg_pathway",
        "artifacts": [],
        "blocked_reason": "本库尚无 pathview KEGG 通路图母版，历史 L2_enrichment_verified.png 是富集气泡图",
    },
]
FIGURES = [
    {"id": figure_id, "artifacts": artifacts}
    for figure_id, artifacts in FIGURE_ARTIFACTS.items()
] + BLOCKED_FIGURES


def validate_artifact(path):
    path = Path(path)
    if not path.is_file():
        return False, "missing"
    size = path.stat().st_size
    suffix = path.suffix.lower()
    if suffix == ".png":
        if size <= 5000:
            return False, "PNG smaller than 5KB"
        if path.read_bytes()[:8] != b"\x89PNG\r\n\x1a\n":
            return False, "invalid PNG magic"
    elif suffix == ".pdf":
        if size <= 1000:
            return False, "PDF smaller than 1KB"
        if path.read_bytes()[:5] != b"%PDF-":
            return False, "invalid PDF header"
    else:
        return False, "unsupported artifact type"
    return True, "ok"


def expected_files(value):
    if isinstance(value, str):
        if value.endswith((".png", ".pdf")):
            return [value]
        return [value + ".png", value + ".pdf"]
    files = []
    for item in value:
        files.extend(expected_files(item))
    return files


def parse_spec(value):
    runner_id, name = value.split(":", 1)
    return runner_id, name


def run_command(command, cwd, env, log_path, timeout=900):
    completed = subprocess.run(
        command,
        cwd=cwd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )
    log_path.write_text(
        "COMMAND=%s\nEXIT=%s\nSTDOUT\n%s\nSTDERR\n%s\n"
        % (" ".join(command), completed.returncode, completed.stdout, completed.stderr),
        encoding="utf-8",
    )
    return completed


def priority_prefix():
    prefix = []
    if shutil.which("nice"):
        prefix.extend(["nice", "-n", "10"])
    if shutil.which("ionice"):
        prefix.extend(["ionice", "-c", "2", "-n", "4"])
    return prefix


def file_sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def package_status(rscript, site_library):
    code = (
        "pkgs <- c(%s); ok <- vapply(pkgs, requireNamespace, logical(1), quietly=TRUE); "
        "cat(sprintf('%%s=%%s\\n', pkgs, ifelse(ok, 'TRUE', 'FALSE')))"
        % ",".join("'%s'" % item for item in CORE_PACKAGES)
    )
    env = dict(os.environ)
    env["R_LIBS_USER"] = site_library
    completed = subprocess.run(
        [rscript, "--no-save", "--no-restore", "--no-site-file", "--no-environ", "-e", code],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=180,
    )
    statuses = {}
    for line in completed.stdout.splitlines():
        if "=" in line:
            name, value = line.strip().split("=", 1)
            if name in CORE_PACKAGES:
                statuses[name] = value == "TRUE"
    return {
        "exit_code": completed.returncode,
        "packages": statuses,
        "missing": [name for name in CORE_PACKAGES if not statuses.get(name)],
        "output": completed.stdout[-4000:],
    }


def python_status(python_bin):
    code = (
        "import importlib, platform\n"
        "print('python=' + platform.python_version())\n"
        "mods=['scanpy','anndata','pandas','numpy','matplotlib']\n"
        "for m in mods:\n"
        " x=importlib.import_module(m)\n"
        " print(f'{m}={getattr(x,\"__version__\",\"unknown\")}')\n"
    )
    completed = subprocess.run(
        [python_bin, "-c", code],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=120,
    )
    return {"exit_code": completed.returncode, "output": completed.stdout}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--rscript", default="/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript")
    parser.add_argument("--python", default="/root/venvs/bio-py/bin/python3")
    parser.add_argument("--site-library", default="/opt/R/4.5.3-site-library")
    parser.add_argument("--l2-report", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args(argv)

    args.output.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env.update({
        "R_LIBS_USER": args.site_library,
        "R_PROFILE_USER": "/mnt/ssd/bio_data/ops/layout_autoload/Rprofile",
        "PYTHONPATH": "/mnt/ssd/bio_data/ops/layout_autoload:" + env.get("PYTHONPATH", ""),
        "MPLBACKEND": "Agg",
        "OMP_NUM_THREADS": "3",
        "OPENBLAS_NUM_THREADS": "3",
        "MKL_NUM_THREADS": "3",
        "NUMEXPR_NUM_THREADS": "3",
    })
    wrapper = priority_prefix()
    runner_results = {}
    for runner in RUNNERS:
        run_dir = args.output / "runs" / runner["id"]
        if run_dir.exists():
            shutil.rmtree(run_dir)
        run_dir.mkdir(parents=True)
        script = args.reference_root / runner["script"]
        run_script = run_dir / script.name
        shutil.copy2(script, run_script)
        for source, target in runner.get("copy", []):
            shutil.copy2(args.reference_root / source, run_dir / target)
        child_env = dict(env)
        child_env["R453_OUT_DIR"] = str(run_dir)
        child_env.setdefault("BIOANALYS_SEED", "20261013")
        if runner["lang"] == "r":
            command = wrapper + [
                args.rscript, "--no-save", "--no-restore", "--no-site-file", "--no-environ",
                str(run_script),
            ]
        else:
            command = wrapper + [args.python, str(run_script)]
        try:
            completed = run_command(
                command, run_dir, child_env, run_dir / "runner.log",
            )
            runner_results[runner["id"]] = {
                "source": runner["script"],
                "source_sha256": file_sha256(script),
                "command": " ".join(command),
                "exit_code": completed.returncode,
                "ok": completed.returncode == 0,
            }
        except (OSError, subprocess.TimeoutExpired) as cause:
            runner_results[runner["id"]] = {
                "source": runner["script"],
                "source_sha256": file_sha256(script) if script.is_file() else None,
                "command": " ".join(command),
                "exit_code": None,
                "ok": False,
                "error": str(cause),
            }

    figures = []
    for figure in FIGURES:
        artifacts = []
        for spec in expected_files(figure["artifacts"]):
            runner_id, filename = parse_spec(spec)
            path = args.output / "runs" / runner_id / filename
            ok, reason = validate_artifact(path)
            artifacts.append({"file": filename, "runner": runner_id, "ok": ok, "reason": reason})
        runner_ok = all(runner_results.get(item["runner"], {}).get("ok") for item in artifacts)
        blocked_reason = figure.get("blocked_reason")
        ready = not blocked_reason and runner_ok and all(item["ok"] for item in artifacts)
        figures.append({
            "id": figure["id"],
            "status": "ready" if ready else "blocked_r453",
            "verified": ready,
            "artifacts": artifacts,
            **({"reason": blocked_reason} if blocked_reason else {}),
        })

    rscript_version = subprocess.run(
        [args.rscript, "--version"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=30,
    )
    packages = package_status(args.rscript, args.site_library)
    python = python_status(args.python)
    if args.l2_report:
        l2_report = json.loads(args.l2_report.read_text(encoding="utf-8"))
        l2_section = l2_report
        l2_status = l2_report.get("status", "fail")
    else:
        l2_section = {"status": "not_run"}
        l2_status = "not_run"
    l1_status = "pass" if (
        rscript_version.returncode == 0
        and "4.5.3" in rscript_version.stdout
        and not packages["missing"]
        and python["exit_code"] == 0
        and "python=3.12.3" in python["output"]
    ) else "fail"
    blocked = sum(not figure["verified"] for figure in figures)
    if all(figure["verified"] for figure in figures):
        l3_status = "pass"
    elif all(figure["status"] in {"ready", "blocked_r453"} for figure in figures):
        l3_status = "pass_with_blocked"
    else:
        l3_status = "fail"
    overall_status = "fail"
    if l1_status == "pass" and l2_status == "pass":
        if l3_status == "pass":
            overall_status = "ready"
        elif l3_status == "pass_with_blocked":
            overall_status = "complete_with_blocked"
    report = {
        "schema_version": 1,
        "generated_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "r_version_raw": rscript_version.stdout.strip(),
        "site_library": args.site_library,
        "l1": {
            "status": l1_status,
            "rscript_exit": rscript_version.returncode,
            "packages": packages["packages"],
            "missing_packages": packages["missing"],
            "python": python,
        },
        "l2": l2_section,
        "l3": {
            "status": l3_status,
            "runners": runner_results,
            "figures": figures,
            "ready": sum(figure["verified"] for figure in figures),
            "blocked": sum(not figure["verified"] for figure in figures),
        },
        "overall_status": overall_status,
    }
    report_path = args.report or (args.output / "r453_verification_report.json")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "ok": report["overall_status"] in {"ready", "complete_with_blocked"},
        "report": str(report_path),
        "ready": report["l3"]["ready"],
        "blocked": report["l3"]["blocked"],
    }, ensure_ascii=False))
    return 0 if report["overall_status"] in {"ready", "complete_with_blocked"} else 1


if __name__ == "__main__":
    sys.exit(main())
