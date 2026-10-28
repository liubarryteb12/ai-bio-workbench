#!/usr/bin/env python3
"""Verify STRING v12.0 and Line 1 benchmark deployment evidence."""

import argparse
import datetime
import gzip
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_gzip(path):
    try:
        with gzip.open(path, "rb") as handle:
            while handle.read(1024 * 1024):
                pass
        return True
    except (OSError, EOFError):
        return False


def count_lines(path):
    count = 0
    with Path(path).open("rb") as handle:
        for _ in handle:
            count += 1
    return count


def verify_file(path, expected_sha256, gzip_required=False):
    path = Path(path)
    exists = path.is_file()
    actual = sha256(path) if exists else None
    result = {
        "path": str(path),
        "exists": exists,
        "expected_sha256": expected_sha256,
        "actual_sha256": actual,
        "hash_ok": exists and actual == expected_sha256,
    }
    if gzip_required:
        result["gzip_ok"] = exists and verify_gzip(path)
    return result


def read_graph(rscript, site_library, path):
    expression = (
        "args <- commandArgs(trailingOnly=TRUE); "
        "suppressPackageStartupMessages(library(igraph)); "
        "d <- read.table(gzfile(args[1]), header=TRUE, sep='', quote='', comment.char='', check.names=FALSE); "
        "stopifnot(ncol(d) >= 2); "
        "g <- graph_from_data_frame(d[, 1:2], directed=FALSE); "
        "cat(sprintf('nodes=%d edges=%d\\n', vcount(g), ecount(g)))"
    )
    env = dict(os.environ)
    env["R_LIBS_USER"] = site_library
    completed = subprocess.run(
        [
            rscript,
            "--no-save",
            "--no-restore",
            "--no-site-file",
            "--no-environ",
            "-e",
            expression,
            str(path),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        timeout=180,
    )
    values = {}
    for line in completed.stdout.splitlines():
        if line.startswith("nodes="):
            for item in line.split():
                key, value = item.split("=", 1)
                values[key] = int(value)
    return {
        "path": str(path),
        "exit_code": completed.returncode,
        "nodes": values.get("nodes"),
        "edges": values.get("edges"),
        "ok": completed.returncode == 0 and bool(values),
        "output": completed.stdout[-4000:],
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--public-root", type=Path, default=Path("/mnt/ssd/bio_data/public_references"))
    parser.add_argument("--string-manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--rscript", default="/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript")
    parser.add_argument("--site-library", default="/opt/R/4.5.3-site-library")
    args = parser.parse_args(argv)

    string_root = args.public_root / "stringdb"
    benchmark_root = args.public_root / "benchmarks" / "line1"
    string_manifest = json.loads(args.string_manifest.read_text(encoding="utf-8"))

    string_files = []
    for species, item in sorted(string_manifest["species"].items()):
        links_name = f"{species}.protein.links.v12.0.min700.tsv.gz"
        info_name = f"{species}.protein.info.v12.0.txt.gz"
        string_files.append(verify_file(string_root / links_name, item["links_sha256"], True))
        string_files.append(verify_file(string_root / info_name, item["info_sha256"], True))
        compatibility = verify_file(string_root / f"{species}.protein.links.v12.0.txt.gz", item["links_sha256"], True)
        compatibility["compatibility_alias"] = True
        string_files.append(compatibility)

    igraph = [
        read_graph(
            args.rscript,
            args.site_library,
            string_root / f"{species}.protein.links.v12.0.min700.tsv.gz",
        )
        for species in ("9606", "10090")
    ]

    benchmark_manifest = json.loads((benchmark_root / "benchmark_manifest.json").read_text(encoding="utf-8"))
    benchmark_files = []
    for name, expected in sorted(benchmark_manifest["inputs"].items()):
        benchmark_files.append(verify_file(benchmark_root / "raw" / name, expected, True))
    for relative, expected in sorted(benchmark_manifest["outputs"].items()):
        benchmark_files.append(verify_file(benchmark_root / relative, expected))

    train_expr = benchmark_root / "processed" / "train" / "train_expr.tsv"
    val_expr = benchmark_root / "processed" / "val" / "val_expr.tsv"
    train_genes = max(count_lines(train_expr) - 1, 0)
    val_genes = max(count_lines(val_expr) - 1, 0)
    benchmark_shape = {
        "train_genes": train_genes,
        "validation_genes": val_genes,
        "manifest_genes": benchmark_manifest["genes"],
        "ok": train_genes == benchmark_manifest["genes"] == val_genes,
    }

    string_ok = all(item["hash_ok"] and item.get("gzip_ok", True) for item in string_files)
    graph_ok = all(item["ok"] for item in igraph)
    benchmark_ok = (
        all(item["hash_ok"] and item.get("gzip_ok", True) for item in benchmark_files)
        and benchmark_shape["ok"]
    )
    report = {
        "schema_version": 1,
        "generated_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "status": "pass" if string_ok and graph_ok and benchmark_ok else "fail",
        "stringdb": {
            "status": "pass" if string_ok and graph_ok else "fail",
            "manifest": str(args.string_manifest),
            "files": string_files,
            "igraph": igraph,
        },
        "line1_benchmark": {
            "status": "pass" if benchmark_ok else "fail",
            "manifest": str(benchmark_root / "benchmark_manifest.json"),
            "files": benchmark_files,
            "shape": benchmark_shape,
            "train": benchmark_manifest["train"],
            "validation": benchmark_manifest["validation"],
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"ok": report["status"] == "pass", "report": str(args.output)}))
    return 0 if report["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
