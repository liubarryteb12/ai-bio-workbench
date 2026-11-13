#!/usr/bin/env python3
"""Rebuild per-sample Visium tissue positions from Space Ranger JSON geometry.

Why this exists
  A shared Visium v1 slide-layout table places spots on a reference slide, not
  on a given section. Overlaying such a table on a section's own H&E image
  produces a visible offset. Each sample JSON records every capture-area spot
  in its full-resolution image frame as imageX/imageY, and the barcode to
  (row, col) mapping comes from the slide layout. Joining on (row, col) and
  applying one uniform full-res to lowres scale puts the spots on the section.

Outputs, per sample:
  <gsm>_tissue_positions_list.csv
    barcode,in_tissue,array_row,array_col,pxl_row,pxl_col
  pxl_row/pxl_col are in low-resolution image pixels, ready for ax.imshow.
"""

from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path

import pandas as pd
from PIL import Image


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json-dir", required=True, type=Path)
    parser.add_argument("--lowres-dir", type=Path)
    parser.add_argument(
        "--fullres-px",
        type=float,
        default=0.0,
        help="full-resolution image side in pixels, used to scale to lowres pixels",
    )
    parser.add_argument("--layout", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument(
        "--samples",
        required=True,
        help="comma-separated gsm=jsonfile pairs, e.g. GSM1=a.json.gz,GSM2=b.json.gz",
    )
    return parser.parse_args()


def load_json(path: Path):
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def main():
    args = parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    layout = pd.read_csv(
        args.layout,
        comment="#",
        header=None,
        names=["barcode", "in_tissue", "array_row", "array_col", "pxl_row", "pxl_col"],
    )
    summary = []
    for item in args.samples.split(","):
        gsm, json_name = item.split("=", 1)
        payload = load_json(args.json_dir / json_name)

        if args.lowres_dir is not None:
            image_path = args.lowres_dir / f"{gsm}_tissue_lowres_image.png"
            width, height = Image.open(image_path).size
        else:
            width = height = 600
        # Scale to lowres pixels using the true full-resolution image size.
        # Using the lowres size instead silently shrinks the whole capture frame.
        # imageX/imageY are already in the full-resolution image frame, so the
        # only transform needed is the uniform full-res to lowres scale.
        full_side = args.fullres_px
        if full_side <= 0:
            raise SystemExit("--fullres-px is required to scale the image frame")
        fraction = min(1.0, max(width, height) / full_side)
        # Use Space Ranger's own lowres pixel coordinates. These are already in
        # the image frame; re-fitting an affine from row/col can mirror the
        # result, because array row/col follows the slide, not the scan.
        geometry = pd.DataFrame(
            [
                {
                    "array_row": o["row"],
                    "array_col": o["col"],
                    "pxl_row": o["imageY"] * fraction,
                    "pxl_col": o["imageX"] * fraction,
                }
                for o in payload["oligo"]
            ]
        )
        merged = layout[["barcode", "in_tissue", "array_row", "array_col"]].merge(
            geometry, on=["array_row", "array_col"], how="left", validate="one_to_one"
        )
        target = args.out_dir / f"{gsm}_tissue_positions_list.csv"
        merged.to_csv(target, index=False, header=False)
        summary.append(
            {
                "gsm": gsm,
                "lowres": "%dx%d" % (width, height),
                "lowres_scalef": round(fraction, 6),
                "spots": int(len(merged)),
                "missing": int(merged["pxl_row"].isna().sum()),
            }
        )
        scale_json = args.out_dir / f"{gsm}_scalefactors_json.json"
        scale_json.write_text(
            json.dumps(
                {
                    "tissue_lowres_scalef": round(fraction, 6),
                    "spot_diameter_fullres": 89.0,
                    "fiducial_diameter_fullres": 89.0,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
    print(pd.DataFrame(summary).to_string(index=False))


if __name__ == "__main__":
    main()
