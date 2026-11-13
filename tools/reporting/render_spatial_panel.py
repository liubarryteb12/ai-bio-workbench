#!/usr/bin/env python3
"""One-command Visium panel pipeline: config, raw, smoothed, manifest, QC.

This is the reusable workflow distilled from the GSE233814 stroke work. It
expects one shared spatial input directory and a per-project section config:

  shared/
    01_spot_master.tsv
    spatial_inputs/
      GSM..._tissue_lowres_image.png
      GSM..._scalefactors_json.json
      GSM..._tissue_positions_list.csv
      shared_raw/GSM...json.gz

  project/figures_config/visium_sections.json

Outputs under project/report/spatial_panels/:
  raw/        one PNG per section and gene, zero-count spots visible
              plus one-row multi-section panels and a manifest
  smoothed/   the same, from a one-hop hex-lattice smoothed master
  diagnostics/ zero fraction and detection map
  raw/figure_manifest.tsv, smoothed/figure_manifest.tsv
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import pandas as pd


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-dir", required=True, type=Path)
    parser.add_argument("--shared-dir", required=True, type=Path)
    parser.add_argument("--genes", default="")
    parser.add_argument("--cmap", default="Spectral_r")
    parser.add_argument("--alpha", type=float, default=0.75)
    parser.add_argument("--spot-size", type=float, default=8.0)
    parser.add_argument("--zero-color", default="#D9D9D9")
    parser.add_argument("--zero-alpha", type=float, default=0.55)
    parser.add_argument("--self-weight", type=float, default=0.8)
    parser.add_argument("--no-smooth", action="store_true")
    parser.add_argument("--no-diagnostics", action="store_true")
    return parser.parse_args()


def run(command):
    print("+", " ".join(str(part) for part in command))
    subprocess.run([str(part) for part in command], check=True)


def main():
    args = parse_args()
    here = Path(__file__).resolve().parent
    root = args.project_dir
    shared = args.shared_dir
    config = root / "figures_config" / "visium_sections.json"
    master = shared / "01_spot_master.tsv"
    spatial = shared / "spatial_inputs"
    layout = Path("references/07.Visium_v1_载玻片布局/visium_v1_tissue_positions.csv")
    out = root / "report" / "spatial_panels"
    out.mkdir(parents=True, exist_ok=True)
    sections = json.loads(config.read_text(encoding="utf-8"))
    sections = sections["sections"] if isinstance(sections, dict) else sections
    section_labels = ",".join(section["label"] for section in sections)
    genes = [item.strip() for item in args.genes.split(",") if item.strip()]
    if not genes:
        columns = pd.read_csv(master, sep="\t", nrows=0).columns
        genes = [column[len("expr_"):] for column in columns if column.startswith("expr_")]
    gene_arg = ",".join(genes)

    common = [
        sys.executable,
        here / "render_visium_feature_plot_v2.py",
        "--spatial-dir", spatial,
        "--samples", config,
        "--layout", layout,
        "--cmap", args.cmap,
        "--alpha", args.alpha,
        "--spot-size", args.spot_size,
        "--zero-color", args.zero_color,
        "--zero-alpha", args.zero_alpha,
    ]
    common.extend(["--genes", gene_arg])

    run(common + ["--master", master, "--out-dir", out / "raw", "--single", "--panel"])
    run([
        sys.executable, here / "build_spatial_contact_sheet.py",
        "--dir", out / "raw",
        "--genes", gene_arg,
        "--sections", section_labels,
        "--out", out / "raw" / "contact_sheet_genes_he.png",
    ])

    if not args.no_smooth:
        smoothed_master = out / "smoothed_spot_master.tsv"
        run([
            sys.executable, here / "smooth_spot_master.py",
            "--master", master,
            "--layout", layout,
            "--out", smoothed_master,
            "--self-weight", args.self_weight,
        ])
        run(
            common
            + [
                "--master", smoothed_master,
                "--out-dir", out / "smoothed",
                "--single",
            ]
        )
        run([
            sys.executable, here / "build_spatial_contact_sheet.py",
            "--dir", out / "smoothed",
            "--genes", gene_arg,
            "--sections", section_labels,
            "--out", out / "smoothed" / "contact_sheet_genes_he.png",
        ])

    if not args.no_diagnostics:
        run([
            sys.executable, here / "spatial_zero_diagnostics.py",
            "--master", master,
            "--spatial-dir", spatial,
            "--samples", config,
            "--out-dir", out / "diagnostics",
            "--section", "D3",
            "--gene", "Egr1",
        ])

    print("done:", out)


if __name__ == "__main__":
    main()
