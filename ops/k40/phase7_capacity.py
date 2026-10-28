#!/usr/bin/env python3
import argparse
import hashlib
import os
import resource
import shutil
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import __version__ as scipy_version
from scipy import sparse


STEP_NAME = "k40_phase7_sparse_capacity"
N_GENES = 10_000
N_SAMPLES = 20_000
TARGET_DENSITY = 0.01
N_TOP_VARIABLE = 1_000
TARGET_SUM = 10_000.0


def fail(message: str, exit_code: int = 1) -> None:
    print(f"step_executed={STEP_NAME} status=fail reason={message}", file=sys.stderr)
    raise SystemExit(exit_code)


def parse_seed() -> int:
    raw_seed = os.environ.get("BIOANALYS_SEED")
    if raw_seed is None or raw_seed.strip() == "":
        fail("BIOANALYS_SEED is required", 3)
    try:
        return int(raw_seed)
    except ValueError:
        fail("BIOANALYS_SEED must be an integer", 3)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_meminfo() -> dict[str, int]:
    metrics = {}
    for line in Path("/proc/meminfo").read_text(encoding="ascii").splitlines():
        key, raw_value = line.split(":", maxsplit=1)
        value_kb = int(raw_value.strip().split()[0])
        metrics[key] = value_kb
    return metrics


def read_max_temp_c() -> str:
    temperatures = []
    for path in Path("/sys/class/thermal").glob("thermal_zone*/temp"):
        try:
            value = int(path.read_text(encoding="ascii").strip()) / 1000.0
        except (OSError, ValueError):
            continue
        if 0.0 < value < 150.0:
            temperatures.append(value)
    return f"{max(temperatures):.1f}" if temperatures else "unavailable"


def build_sparse_matrix(seed: int) -> sparse.csr_matrix:
    rng = np.random.default_rng(seed)
    target_nonzero = int(N_GENES * N_SAMPLES * TARGET_DENSITY)
    row_indices = rng.integers(0, N_GENES, size=target_nonzero, dtype=np.int32)
    column_indices = rng.integers(0, N_SAMPLES, size=target_nonzero, dtype=np.int32)
    values = rng.lognormal(mean=2.0, sigma=1.0, size=target_nonzero)
    coo_matrix = sparse.coo_matrix(
        (values, (row_indices, column_indices)),
        shape=(N_GENES, N_SAMPLES),
        dtype=np.float64,
    )
    return coo_matrix.tocsr()


def process_matrix(matrix: sparse.csr_matrix) -> tuple[pd.DataFrame, float]:
    library_sizes = np.asarray(matrix.sum(axis=1)).ravel()
    if np.any(library_sizes <= 0):
        fail("zero library size detected")

    scale_factors = TARGET_SUM / library_sizes
    normalized = sparse.diags(scale_factors) @ matrix
    normalized.data = np.log1p(normalized.data)

    row_means = np.asarray(normalized.mean(axis=1)).ravel()
    row_squared_means = np.asarray(normalized.multiply(normalized).mean(axis=1)).ravel()
    row_variances = np.maximum(row_squared_means - np.square(row_means), 0.0)

    top_indices = np.argpartition(row_variances, -N_TOP_VARIABLE)[-N_TOP_VARIABLE:]
    top_indices = top_indices[np.argsort(row_variances[top_indices])[::-1]]
    top_genes = pd.DataFrame(
        {
            "gene": [f"GENE_{index + 1:05d}" for index in top_indices],
            "library_size": library_sizes[top_indices],
            "normalized_mean": row_means[top_indices],
            "normalized_variance": row_variances[top_indices],
        }
    )
    return top_genes, float(library_sizes.sum())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    seed = parse_seed()
    output_path = Path(args.output)
    if output_path.exists():
        fail(f"output already exists: {output_path}", 2)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temp_dir = Path(
        tempfile.mkdtemp(prefix=f".{output_path.name}.", dir=output_path.parent)
    )

    started = time.monotonic()
    try:
        print(f"step_executed={STEP_NAME} status=started seed={seed}", flush=True)
        matrix = build_sparse_matrix(seed)
        expected_nonzero = int(N_GENES * N_SAMPLES * TARGET_DENSITY)
        density = matrix.nnz / (N_GENES * N_SAMPLES)
        top_genes, total_counts = process_matrix(matrix)

        if matrix.shape != (N_GENES, N_SAMPLES):
            fail(f"unexpected matrix shape {matrix.shape}")
        if matrix.nnz < expected_nonzero * 0.99:
            fail("nonzero count below expected tolerance")
        if not np.isfinite(matrix.data).all():
            fail("matrix contains non-finite values")
        if top_genes.shape[0] != N_TOP_VARIABLE:
            fail("unexpected top variable gene count")
        if not np.isfinite(top_genes["normalized_variance"]).all():
            fail("non-finite variance in top variable genes")
        if not total_counts > 0:
            fail("invalid total count")

        top_path = temp_dir / "top_variable_genes.tsv"
        top_genes.to_csv(top_path, sep="\t", index=False, float_format="%.6g")

        elapsed_seconds = time.monotonic() - started
        peak_rss_kb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        meminfo = read_meminfo()
        swap_used_kb = meminfo["SwapTotal"] - meminfo["SwapFree"]
        report_path = temp_dir / "phase7_report.txt"
        report_lines = [
            f"step_executed={STEP_NAME}",
            "status=pass",
            f"seed={seed}",
            f"numpy={np.__version__}",
            f"pandas={pd.__version__}",
            f"scipy={scipy_version}",
            "matrix_representation=csr_sparse",
            f"matrix_shape={N_GENES}x{N_SAMPLES}",
            f"matrix_nnz={matrix.nnz}",
            f"matrix_density={density:.6f}",
            f"top_variable_genes={N_TOP_VARIABLE}",
            f"elapsed_seconds={elapsed_seconds:.3f}",
            f"peak_rss_kb={peak_rss_kb}",
            f"max_temp_c={read_max_temp_c()}",
            f"mem_available_kb={meminfo['MemAvailable']}",
            f"swap_used_kb={swap_used_kb}",
            f"top_variable_genes_sha256={sha256_file(top_path)}",
        ]
        report_path.write_text("\n".join(report_lines) + "\n", encoding="utf-8")
        os.replace(temp_dir, output_path)
        print(f"step_executed={STEP_NAME} status=pass output={output_path}", flush=True)
        print((output_path / "phase7_report.txt").read_text(encoding="utf-8"), end="")
    except Exception as exc:
        shutil.rmtree(temp_dir, ignore_errors=True)
        fail(f"{type(exc).__name__}: {exc}")


if __name__ == "__main__":
    main()
