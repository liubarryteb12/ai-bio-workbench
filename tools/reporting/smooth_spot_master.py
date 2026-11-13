#!/usr/bin/env python3
"""One-hop hex lattice smoothing for display only.

Neighbour averaging on the Visium array grid. Each spot takes its own value
plus the mean of its directly adjacent array positions, weighted by
--self-weight. Zero spots stay zero unless a neighbour carries signal. This is
a rendering aid, and the output table must not feed statistics.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

# Visium v1 hex lattice: same-row neighbours are column +/- 2, and rows two
# apart are column +/- 1. The same-row +/- 1 variant is a silent no-op.
VISIUM_OFFSETS = [(0, -2), (0, 2), (-2, -1), (-2, 1), (2, -1), (2, 1)]


def smooth_block(values, rows, cols, weight, offsets=None):
    """Return one-hop smoothed values for a single section block."""
    offsets = offsets or VISIUM_OFFSETS
    lookup = {(row, col): index for index, (row, col) in enumerate(zip(rows, cols))}
    out = np.empty_like(values, dtype=float)
    for position, (row, col) in enumerate(zip(rows, cols)):
        total = 0.0
        count = 0
        for d_row, d_col in offsets:
            neighbour = lookup.get((row + d_row, col + d_col))
            if neighbour is not None:
                total += values[neighbour]
                count += 1
        neighbour_mean = total / count if count else values[position]
        out[position] = weight * values[position] + (1.0 - weight) * neighbour_mean
    return out


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--master", required=True, type=Path)
    parser.add_argument("--layout", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--self-weight", type=float, default=0.8)
    return parser.parse_args()


def main():
    args = parse_args()
    master = pd.read_csv(args.master, sep="\t")
    master["barcode"] = master["spot"].str.split("_", n=1).str[1]
    layout = pd.read_csv(
        args.layout,
        comment="#",
        header=None,
        names=["barcode", "in_tissue", "array_row", "array_col", "pxl_row", "pxl_col"],
    )[["barcode", "array_row", "array_col"]]
    frame = master.merge(layout, on="barcode", how="left")

    genes = [column for column in frame.columns if column.startswith("expr_")]
    weight = args.self_weight
    smoothed = frame.copy()
    for gene in genes:
        values = pd.to_numeric(frame[gene], errors="coerce").fillna(0.0)
        result = pd.Series(index=frame.index, dtype=float)
        for sample_id, block in frame.groupby("sample_id", sort=False):
            rows = block["array_row"].to_numpy()
            cols = block["array_col"].to_numpy()
            current = values.loc[block.index].to_numpy()
            out = smooth_block(current, rows, cols, weight)
            result.loc[block.index] = out
        smoothed[gene] = result.to_numpy()

    args.out.parent.mkdir(parents=True, exist_ok=True)
    smoothed.to_csv(args.out, sep="\t", index=False)
    print(
        "smoothed %d spots, %d genes, self_weight=%.2f -> %s"
        % (len(smoothed), len(genes), weight, args.out)
    )


if __name__ == "__main__":
    main()
