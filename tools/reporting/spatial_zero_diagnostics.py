#!/usr/bin/env python3
"""Zero-count diagnostics for one Visium section.

Outputs:
  zero_fraction_<section>.png     zero UMI fraction per focus gene
  detection_map_<section>_<gene>.png   in-tissue zero vs positive spots
  zero_fraction_<section>.tsv     the underlying numbers

The map uses the sample's own H&E and native Space Ranger pixel coordinates,
so the spots and the tissue are in the same frame.
"""

from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from PIL import Image


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--master", required=True, type=Path)
    parser.add_argument("--spatial-dir", required=True, type=Path)
    parser.add_argument("--samples", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--section", default="", help="section label; empty picks D3 or the first section")
    parser.add_argument("--gene", default="", help="gene for the detection map; empty picks Egr1 or the first gene")
    return parser.parse_args()


def load_sections(path):
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    return payload["sections"] if isinstance(payload, dict) else payload


def pick_section(sections, label):
    if label:
        for section in sections:
            if section["label"].lower() == label.lower():
                return section
        raise SystemExit("section not found: %s" % label)
    for section in sections:
        if section["label"].lower() == "d3":
            return section
    return sections[0]


def section_spots(section, master, spatial_dir):
    json_path = spatial_dir / "shared_raw" / section["json"]
    opener = gzip.open if json_path.suffix == ".gz" else open
    with opener(json_path, "rt", encoding="utf-8") as handle:
        payload = json.load(handle)
    scale = json.loads(
        (spatial_dir / ("%s_scalefactors_json.json" % section["gsm"])).read_text(encoding="utf-8")
    )["tissue_lowres_scalef"]
    geometry = pd.DataFrame(
        [
            {
                "array_row": spot["row"],
                "array_col": spot["col"],
                "x": spot["imageX"] * scale,
                "y": spot["imageY"] * scale,
            }
            for spot in payload["oligo"]
        ]
    )
    block = master[master["sample_id"] == section["sample_id"]]
    merged = block.merge(geometry, on=["array_row", "array_col"], how="inner")
    if merged.empty:
        raise SystemExit("no spots matched for %s" % section["label"])
    return merged, spatial_dir / ("%s_tissue_lowres_image.png" % section["gsm"])


def main():
    args = parse_args()
    master = pd.read_csv(args.master, sep="\t")
    if "barcode" not in master.columns:
        master["barcode"] = master["spot"].str.split("_", n=1).str[1]
    layout = pd.read_csv(
        Path("references/07.Visium_v1_载玻片布局/visium_v1_tissue_positions.csv"),
        comment="#",
        header=None,
        names=["barcode", "in_tissue", "array_row", "array_col", "pxl_row", "pxl_col"],
    )
    if not {"array_row", "array_col"}.issubset(master.columns):
        master = master.merge(
            layout[["barcode", "array_row", "array_col"]], on="barcode", how="left"
        )
    genes = sorted(
        column[len("expr_"):] for column in master.columns if column.startswith("expr_")
    )
    section = pick_section(load_sections(args.samples), args.section)
    gene = args.gene or ("Egr1" if "Egr1" in genes else genes[0])
    if ("expr_%s" % gene) not in master.columns:
        raise SystemExit("gene not found: %s" % gene)

    block = master[master["sample_id"] == section["sample_id"]].copy()
    rates = {}
    for candidate in genes:
        values = pd.to_numeric(block["expr_%s" % candidate], errors="coerce").fillna(0)
        rates[candidate] = float((values == 0).mean())

    args.out_dir.mkdir(parents=True, exist_ok=True)
    frame = pd.DataFrame(
        [{"gene": key, "zero_fraction": value} for key, value in rates.items()]
    ).sort_values("zero_fraction", ascending=False)
    frame.to_csv(args.out_dir / ("zero_fraction_%s.tsv" % section["label"]),
                 sep="\t", index=False)

    fig, ax = plt.subplots(figsize=(7.2, 3.2), dpi=300)
    ordered = frame.sort_values("zero_fraction")
    ax.barh(ordered["gene"], 100 * ordered["zero_fraction"], color="#7a6fa8")
    ax.set_xlabel("spots with zero UMI count (%)")
    ax.set_xlim(0, 100)
    for index, (_, row) in enumerate(ordered.iterrows()):
        ax.text(100 * row["zero_fraction"] + 1, index, "%.1f%%" % (100 * row["zero_fraction"]),
                va="center", fontsize=7)
    ax.set_title("%s: zero-count fraction by focus gene" % section["label"], fontsize=10)
    fig.savefig(args.out_dir / ("zero_fraction_%s.png" % section["label"]),
                bbox_inches="tight", dpi=300)
    plt.close(fig)

    spots, image_path = section_spots(section, master, args.spatial_dir)
    values = pd.to_numeric(spots["expr_%s" % gene], errors="coerce").fillna(0)
    zero = values <= 0
    fig, ax = plt.subplots(figsize=(5.8, 5.6), dpi=300)
    ax.imshow(Image.open(image_path))
    ax.scatter(spots.loc[zero, "x"], spots.loc[zero, "y"], s=11, c="#D9D9D9",
               alpha=0.75, linewidths=0.25, edgecolors="#9A9A9A",
               label="in tissue, zero count (n=%d)" % int(zero.sum()))
    ax.scatter(spots.loc[~zero, "x"], spots.loc[~zero, "y"], s=11, c="#b2182b",
               alpha=0.9, linewidths=0, label="in tissue, detected (n=%d)" % int((~zero).sum()))
    ax.set_title("%s - %s detection, all %d in-tissue spots"
                 % (section["label"], gene, len(spots)), fontsize=10)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.legend(loc="upper left", bbox_to_anchor=(1.02, 1.0), frameon=False, fontsize=7)
    fig.savefig(args.out_dir / ("detection_map_%s_%s.png" % (section["label"], gene)),
                bbox_inches="tight", dpi=300)
    plt.close(fig)
    print("section=%s spots=%d gene=%s zero=%.1f%%"
          % (section["label"], len(spots), gene, 100 * rates[gene]))


if __name__ == "__main__":
    main()
