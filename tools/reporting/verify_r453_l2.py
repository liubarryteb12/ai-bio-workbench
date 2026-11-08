#!/usr/bin/env python3
"""Verify the R 4.5.3 and Python bridge layer for h5ad, UTF-8 CSV, and float bits."""

import argparse
import datetime
import json
import math
import os
import struct
import subprocess
import sys
from pathlib import Path


def compare_headers(actual, expected):
    return list(actual) == list(expected)


def compare_float_bits(actual, expected):
    if len(actual) != len(expected):
        return False
    return all(
        struct.pack(">d", float(left)) == struct.pack(">d", float(right))
        for left, right in zip(actual, expected)
    )


def run(command, cwd, env=None, timeout=300):
    completed = subprocess.run(
        command,
        cwd=cwd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )
    return {
        "command": " ".join(str(item) for item in command),
        "exit_code": completed.returncode,
        "output": completed.stdout[-8000:],
    }


def make_h5ad_files(root):
    import anndata as ad
    import numpy as np

    rng = np.random.default_rng(20261013)
    matrix = rng.normal(size=(12, 30)).astype("float32")
    genes = ["STAT3", "IL17A", "TNF", "CXCL8", "JUN", "FOS", "NFKB1"] + [
        "GENE%02d" % index for index in range(23)
    ]
    samples = ["SAMPLE%03d" % index for index in range(matrix.shape[0])]

    good = ad.AnnData(matrix)
    good.var_names = genes
    good.obs_names = samples
    good.obsm["X_pca"] = rng.normal(size=(12, 5)).astype("float32")
    good.obsm["X_umap"] = rng.normal(size=(12, 2)).astype("float32")
    good.write_h5ad(root / "good.h5ad")

    numeric = ad.AnnData(matrix)
    numeric.var_names = [str(index) for index in range(matrix.shape[1])]
    numeric.obs_names = samples
    numeric.obsm["X_pca"] = rng.normal(size=(12, 5)).astype("float32")
    numeric.write_h5ad(root / "numeric_genes.h5ad")

    no_embedding = ad.AnnData(matrix)
    no_embedding.var_names = genes
    no_embedding.obs_names = samples
    no_embedding.write_h5ad(root / "no_embedding.h5ad")
    return root


def check_h5ad(bridge, python_bin, root):
    cases = [
        {
            "id": "h5ad_good",
            "file": root / "good.h5ad",
            "stage": "post-dimred",
            "expected_exit": 0,
            "expected_marker": "[BRIDGE PASS]",
        },
        {
            "id": "h5ad_numeric_genes",
            "file": root / "numeric_genes.h5ad",
            "stage": "post-dimred",
            "expected_exit": 1,
            "expected_marker": "[BRIDGE FAIL]",
        },
        {
            "id": "h5ad_missing_obsm_post",
            "file": root / "no_embedding.h5ad",
            "stage": "post-dimred",
            "expected_exit": 1,
            "expected_marker": "[BRIDGE FAIL]",
        },
        {
            "id": "h5ad_missing_obsm_pre",
            "file": root / "no_embedding.h5ad",
            "stage": "pre-dimred",
            "expected_exit": 0,
            "expected_marker": "[BRIDGE WARN]",
        },
    ]
    results = []
    for case in cases:
        completed = run([
            python_bin,
            bridge,
            "--input",
            case["file"],
            "--from",
            "Python",
            "--to",
            "R",
            "--stage",
            case["stage"],
        ], root)
        case["passed"] = (
            completed["exit_code"] == case["expected_exit"]
            and case["expected_marker"] in completed["output"]
        )
        case.update(completed)
        results.append(case)
    return results


def check_csv_utf8(rscript, site_library, root):
    import csv

    source = root / "中文输入.csv"
    roundtrip = root / "中文回写.csv"
    expected = ["基因", "样本", "表达量"]
    with source.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(expected)
        writer.writerow(["STAT3", "样本甲", "12.5"])
        writer.writerow(["TNF", "样本乙", "8.25"])

    env = dict(os.environ)
    env["R_LIBS_USER"] = site_library
    expression = (
        "args <- commandArgs(trailingOnly=TRUE); "
        "d <- read.csv(args[1], check.names=FALSE, fileEncoding='UTF-8'); "
        "write.csv(d, args[2], row.names=FALSE, quote=FALSE, fileEncoding='UTF-8')"
    )
    completed = run([
        rscript,
        "--no-save",
        "--no-restore",
        "--no-site-file",
        "--no-environ",
        "-e",
        expression,
        str(source),
        str(roundtrip),
    ], root, env)
    with roundtrip.open("r", encoding="utf-8", newline="") as handle:
        actual = next(csv.reader(handle))
    return {
        "id": "csv_utf8_headers",
        "expected": expected,
        "actual": actual,
        "passed": completed["exit_code"] == 0 and compare_headers(actual, expected),
        **completed,
    }


def check_float_bits(rscript, site_library, root):
    expected = [
        0.1,
        1.0 / 3.0,
        math.pi,
        1e-300,
        1.2345678901234567,
        -0.0,
        math.nextafter(1.0, 2.0),
    ]
    source = root / "float_values.txt"
    output = root / "float_roundtrip.txt"
    source.write_text("".join(format(item, ".17g") + "\n" for item in expected), encoding="utf-8")
    env = dict(os.environ)
    env["R_LIBS_USER"] = site_library
    expression = (
        "args <- commandArgs(trailingOnly=TRUE); "
        "x <- scan(args[1], quiet=TRUE); "
        "writeLines(sprintf('%.17g', x), args[2], useBytes=TRUE)"
    )
    completed = run([
        rscript,
        "--no-save",
        "--no-restore",
        "--no-site-file",
        "--no-environ",
        "-e",
        expression,
        str(source),
        str(output),
    ], root, env)
    actual = [float(line) for line in output.read_text(encoding="utf-8").splitlines() if line.strip()]
    return {
        "id": "float17_bit_exact",
        "expected": [format(item, ".17g") for item in expected],
        "actual": [format(item, ".17g") for item in actual],
        "passed": completed["exit_code"] == 0 and compare_float_bits(actual, expected),
        **completed,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--bridge-engine", type=Path, required=True)
    parser.add_argument("--rscript", default="/mnt/ssd/bio_data/tools/ops/layout_autoload/bin/Rscript")
    parser.add_argument("--python", default="/root/venvs/bio-py/bin/python3")
    parser.add_argument("--site-library", default="/opt/R/4.5.3-site-library")
    args = parser.parse_args(argv)

    args.output.mkdir(parents=True, exist_ok=True)
    make_h5ad_files(args.output)
    h5ad = check_h5ad(args.bridge_engine, args.python, args.output)
    csv_check = check_csv_utf8(args.rscript, args.site_library, args.output)
    float_check = check_float_bits(args.rscript, args.site_library, args.output)
    checks = h5ad + [csv_check, float_check]
    status = "pass" if all(check["passed"] for check in checks) else "fail"
    report = {
        "schema_version": 1,
        "generated_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "status": status,
        "checks": checks,
    }
    report_path = args.output / "r453_l2_report.json"
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True, default=str) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"ok": status == "pass", "report": str(report_path)}))
    return 0 if status == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
