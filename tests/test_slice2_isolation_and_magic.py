import hashlib
import os
import sys
import tempfile
import pytest

sys.path.insert(0, os.path.abspath("03_server_orchestrator/core"))
from isolation_guard import (
    assert_three_line_isolation,
    evaluate_compute_sieve,
    verify_artifact_binary_integrity,
    IsolationViolationError,
)


def test_slice2_isolation_guard_violations():
    # 1. Path traversal with ..
    with pytest.raises(IsolationViolationError):
        assert_three_line_isolation("line1_bulk", ["../../etc/passwd"])

    with pytest.raises(IsolationViolationError):
        assert_three_line_isolation("line1_bulk", ["processed/../.."])

    # 2. Cross-line reference: line1 referencing line2
    with pytest.raises(IsolationViolationError):
        assert_three_line_isolation("line1_bulk", ["../line2_scrna/processed/matrix.rds"])

    # 3. Valid paths within sandbox
    assert_three_line_isolation("line1_bulk", ["processed/counts.tsv", "results/volcano.png"])
    assert_three_line_isolation("line2_scrna", ["processed/scrna.h5ad", "results/umap.png"])
    assert_three_line_isolation("line3_spatial", ["processed/spatial.h5ad", "results/spatial_dim.pdf"])


def test_slice2_compute_sieve():
    # 1. Bulk RNA-seq normal size
    sieve_bulk = evaluate_compute_sieve("line1_bulk", n_genes=20000, n_cells_or_samples=12)
    assert sieve_bulk["sieve_passed"] is True
    assert sieve_bulk["downsampling_applied"] is False
    assert sieve_bulk["estimated_peak_mb"] < 1000

    # 2. Single-cell with 10,000 cells (under 20k cap)
    sieve_sc_small = evaluate_compute_sieve("line2_scrna", n_genes=3000, n_cells_or_samples=10000)
    assert sieve_sc_small["sieve_passed"] is True
    assert sieve_sc_small["downsampling_applied"] is False
    assert sieve_sc_small["target_cell_cap"] == 10000

    # 3. Single-cell with 30,000 cells (over 20k cap -> auto downsample to 15,000)
    sieve_sc_large = evaluate_compute_sieve("line2_scrna", n_genes=3000, n_cells_or_samples=30000)
    assert sieve_sc_large["sieve_passed"] is True
    assert sieve_sc_large["downsampling_applied"] is True
    assert sieve_sc_large["target_cell_cap"] == 15000
    assert sieve_sc_large["estimated_peak_mb"] <= 5500


def test_slice2_artifact_binary_integrity():
    with tempfile.TemporaryDirectory() as tmp_dir:
        # A. Valid PNG (magic header + >4KB + IEND)
        png_path = os.path.join(tmp_dir, "plot.png")
        png_bytes = b"\x89PNG\r\n\x1a\n" + (b"\x00" * 5000) + b"IEND\xaeB`\x82"
        with open(png_path, "wb") as f:
            f.write(png_bytes)
        png_sha = hashlib.sha256(png_bytes).hexdigest()

        ok, reason = verify_artifact_binary_integrity(png_path, png_sha)
        assert ok is True
        assert reason == "OK"

        # B. Truncated PNG (missing IEND)
        bad_png_path = os.path.join(tmp_dir, "bad_plot.png")
        bad_png_bytes = b"\x89PNG\r\n\x1a\n" + (b"\x00" * 5000)
        with open(bad_png_path, "wb") as f:
            f.write(bad_png_bytes)
        bad_sha = hashlib.sha256(bad_png_bytes).hexdigest()

        ok, reason = verify_artifact_binary_integrity(bad_png_path, bad_sha)
        assert ok is False
        assert "CORRUPTED" in reason

        # C. 0-byte file
        zero_path = os.path.join(tmp_dir, "zero.png")
        with open(zero_path, "wb") as f:
            pass
        zero_sha = hashlib.sha256(b"").hexdigest()
        ok, reason = verify_artifact_binary_integrity(zero_path, zero_sha)
        assert ok is False
        assert "ZERO_BYTE" in reason

        # D. Hash mismatch
        ok, reason = verify_artifact_binary_integrity(png_path, "0" * 64)
        assert ok is False
        assert "SHA256_MISMATCH" in reason

        # E. Valid PDF (%PDF- header + >2KB + %%EOF)
        pdf_path = os.path.join(tmp_dir, "report.pdf")
        pdf_bytes = b"%PDF-1.4\n" + (b"0" * 3000) + b"\n%%EOF\n"
        with open(pdf_path, "wb") as f:
            f.write(pdf_bytes)
        pdf_sha = hashlib.sha256(pdf_bytes).hexdigest()

        ok, reason = verify_artifact_binary_integrity(pdf_path, pdf_sha)
        assert ok is True
        assert reason == "OK"

        # F. Truncated PDF (missing %%EOF)
        bad_pdf_path = os.path.join(tmp_dir, "bad_report.pdf")
        bad_pdf_bytes = b"%PDF-1.4\n" + (b"0" * 3000)
        with open(bad_pdf_path, "wb") as f:
            f.write(bad_pdf_bytes)
        bad_pdf_sha = hashlib.sha256(bad_pdf_bytes).hexdigest()

        ok, reason = verify_artifact_binary_integrity(bad_pdf_path, bad_pdf_sha)
        assert ok is False
        assert "CORRUPTED" in reason
