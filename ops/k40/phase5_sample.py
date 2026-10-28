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

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import scipy
from scipy import stats


STEP_NAME = "k40_phase5_python_sample"
N_GENES = 200
N_SAMPLES = 60
N_TOP_GENES = 10


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


def build_matrix(seed: int) -> tuple[pd.DataFrame, np.ndarray]:
    rng = np.random.default_rng(seed)
    groups = np.array(["control"] * 30 + ["case"] * 30)
    baseline = rng.lognormal(mean=6.0, sigma=0.6, size=(N_GENES, 1))
    noise = rng.lognormal(mean=0.0, sigma=0.18, size=(N_GENES, N_SAMPLES))
    matrix = baseline * noise
    matrix[:20, 30:] *= 1.35
    matrix = np.round(matrix, 4)

    genes = [f"GENE_{index:04d}" for index in range(1, N_GENES + 1)]
    sample_ids = [f"SAMPLE_{index:03d}" for index in range(1, N_SAMPLES + 1)]
    frame = pd.DataFrame(matrix, index=genes, columns=sample_ids)
    return frame, groups


def compute_statistics(
    expression: pd.DataFrame, groups: np.ndarray
) -> pd.DataFrame:
    control = expression.loc[:, groups == "control"]
    case = expression.loc[:, groups == "case"]
    statistic, p_value = stats.ttest_ind(
        case.to_numpy(), control.to_numpy(), axis=1, equal_var=False
    )
    result = pd.DataFrame(
        {
            "gene": expression.index,
            "control_mean": control.mean(axis=1).to_numpy(),
            "case_mean": case.mean(axis=1).to_numpy(),
            "log2_fold_change": np.log2(
                (case.mean(axis=1) + 1e-6) / (control.mean(axis=1) + 1e-6)
            ),
            "welch_t": statistic,
            "p_value": p_value,
        }
    )
    result = result.sort_values("p_value").reset_index(drop=True)
    return result


def validate_outputs(
    expression: pd.DataFrame,
    groups: np.ndarray,
    statistics_frame: pd.DataFrame,
    matrix_path: Path,
    stats_path: Path,
    plot_path: Path,
) -> None:
    if expression.shape != (N_GENES, N_SAMPLES):
        fail(f"unexpected matrix shape {expression.shape}")
    if int((groups == "control").sum()) != 30 or int((groups == "case").sum()) != 30:
        fail("unexpected group sizes")
    if not np.isfinite(expression.to_numpy()).all():
        fail("matrix contains non-finite values")
    if statistics_frame.shape[0] != N_GENES:
        fail("statistics row count mismatch")
    if not statistics_frame["p_value"].between(0.0, 1.0).all():
        fail("p-values outside [0, 1]")
    for path in (matrix_path, stats_path, plot_path):
        if not path.is_file() or path.stat().st_size == 0:
            fail(f"missing or empty artifact {path.name}")
    if plot_path.read_bytes()[:8] != b"\x89PNG\r\n\x1a\n":
        fail("plot is not a valid PNG")
    reloaded = pd.read_csv(matrix_path, sep="\t", index_col=0)
    if reloaded.shape != expression.shape:
        fail("matrix round-trip shape mismatch")


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
    print(f"step_executed={STEP_NAME} status=started seed={seed}", flush=True)
    try:
        expression, groups = build_matrix(seed)
        statistics_frame = compute_statistics(expression, groups)

        matrix_path = temp_dir / "expression_matrix.tsv"
        stats_path = temp_dir / "differential_statistics.tsv"
        plot_path = temp_dir / "expression_preview.png"
        expression.to_csv(matrix_path, sep="\t", float_format="%.4f")
        statistics_frame.to_csv(stats_path, sep="\t", index=False, float_format="%.8g")

        top_genes = statistics_frame.head(N_TOP_GENES)["gene"].tolist()
        preview = expression.loc[top_genes]
        fig, axis = plt.subplots(figsize=(10, 4.5))
        image = axis.imshow(preview.to_numpy(), aspect="auto", cmap="viridis")
        axis.set_xticks([0, 29, 30, 59])
        axis.set_xticklabels(
            [expression.columns[0], expression.columns[29], expression.columns[30], expression.columns[59]],
            rotation=30,
        )
        axis.set_yticks(range(N_TOP_GENES))
        axis.set_yticklabels(top_genes, fontsize=8)
        axis.set_title("Top differential genes")
        axis.set_xlabel("Samples")
        axis.set_ylabel("Genes")
        fig.colorbar(image, ax=axis, label="Expression")
        fig.tight_layout()
        fig.savefig(plot_path, dpi=120)
        plt.close(fig)

        validate_outputs(
            expression,
            groups,
            statistics_frame,
            matrix_path,
            stats_path,
            plot_path,
        )

        elapsed_seconds = time.monotonic() - started
        peak_rss_kb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        top_row = statistics_frame.iloc[0]
        report_path = temp_dir / "phase5_report.txt"
        report_lines = [
            f"step_executed={STEP_NAME}",
            "status=pass",
            f"seed={seed}",
            f"python={sys.version.split()[0]}",
            f"numpy={np.__version__}",
            f"pandas={pd.__version__}",
            f"scipy={scipy.__version__}",
            f"matplotlib={matplotlib.__version__}",
            f"matrix_shape={expression.shape[0]}x{expression.shape[1]}",
            f"control_samples={int((groups == 'control').sum())}",
            f"case_samples={int((groups == 'case').sum())}",
            f"top_gene={top_row['gene']}",
            f"top_gene_log2_fold_change={top_row['log2_fold_change']:.6f}",
            f"top_gene_p_value={top_row['p_value']:.8g}",
            f"elapsed_seconds={elapsed_seconds:.3f}",
            f"peak_rss_kb={peak_rss_kb}",
            f"max_temp_c={read_max_temp_c()}",
            f"expression_matrix_sha256={sha256_file(matrix_path)}",
            f"differential_statistics_sha256={sha256_file(stats_path)}",
            f"expression_preview_sha256={sha256_file(plot_path)}",
        ]
        report_path.write_text("\n".join(report_lines) + "\n", encoding="utf-8")
        os.replace(temp_dir, output_path)
        print(f"step_executed={STEP_NAME} status=pass output={output_path}", flush=True)
        final_report_path = output_path / "phase5_report.txt"
        print(final_report_path.read_text(encoding="utf-8"), end="")
    except Exception as exc:
        shutil.rmtree(temp_dir, ignore_errors=True)
        fail(f"{type(exc).__name__}: {exc}")


if __name__ == "__main__":
    main()
