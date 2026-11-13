"""Regression tests for the spatial panel helpers.

These guard two failures that were silent in the stroke work:
  * the shared slide layout used as pixel coordinates
  * the wrong Visium same-row neighbour offset
"""

import numpy as np
import pandas as pd

from tools.reporting.smooth_spot_master import VISIUM_OFFSETS, smooth_block
from tools.reporting.render_visium_feature_plot_v2 import load_master


def test_visium_offsets_use_column_step_two_on_the_same_row():
    assert (0, -2) in VISIUM_OFFSETS
    assert (0, 2) in VISIUM_OFFSETS
    assert (0, -1) not in VISIUM_OFFSETS
    assert (0, 1) not in VISIUM_OFFSETS


def test_one_hop_smoothing_reaches_all_six_neighbours():
    rows = np.array([2, 2, 2, 0, 0, 4, 4])
    cols = np.array([2, 0, 4, 1, 3, 1, 3])
    values = np.array([1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
    out = smooth_block(values, rows, cols, weight=0.8)
    assert out[0] == 0.8
    assert np.all(out[1:] > 0.0)
    assert np.all(out[1:] < 0.1)


def test_smoothing_is_a_no_op_when_all_values_are_zero():
    rows = np.array([2, 2, 2, 0, 0, 4, 4])
    cols = np.array([2, 0, 4, 1, 3, 1, 3])
    values = np.zeros(7)
    out = smooth_block(values, rows, cols, weight=0.8)
    assert np.all(out == 0.0)


def test_load_master_keeps_existing_array_columns(tmp_path):
    master = pd.DataFrame(
        {
            "spot": ["D3_AAACAAGTATCTCCCA-1"],
            "sample_id": ["D1-D3"],
            "array_row": [2],
            "array_col": [4],
            "expr_Egr1": [1.5],
        }
    )
    path = tmp_path / "master.tsv"
    master.to_csv(path, sep="\t", index=False)
    layout = tmp_path / "layout.csv"
    layout.write_text("# empty layout\n", encoding="utf-8")
    out = load_master(path, layout)
    assert "array_row" in out.columns
    assert "array_row_x" not in out.columns
    assert out.loc[0, "array_col"] == 4
