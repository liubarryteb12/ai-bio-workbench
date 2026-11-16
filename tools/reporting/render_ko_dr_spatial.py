#!/usr/bin/env python3
"""Render spatial maps of significant knockout-affected (DR) genes.

For one knockout gene, read its `ko_dr_genes_mouse.tsv`, keep rows with
significant=True and is_knockout_gene=False, then compute the per-spot mean
raw count across those genes from the sample matrix. The result is drawn on
the sample's own H&E image with native Space Ranger coordinates.

This reproduces the meaning of the earlier "KO DR expr" maps while fixing the
coordinates and adding the histology layer.
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
from scipy.io import mmread


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ko-table", required=True, type=Path)
    parser.add_argument("--ko-gene", required=True)
    parser.add_argument("--raw-dir", required=True, type=Path)
    parser.add_argument("--spatial-dir", required=True, type=Path)
    parser.add_argument("--samples", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument(
        "--layout",
        type=Path,
        default=Path("references/07.Visium_v1_载玻片布局/visium_v1_tissue_positions.csv"),
    )
    parser.add_argument("--cmap", default="magma")
    parser.add_argument("--spot-size", type=float, default=8.0)
    parser.add_argument("--alpha", type=float, default=0.75)
    parser.add_argument("--vmax-quantile", type=float, default=0.99)
    parser.add_argument("--sections", default="", help="optional comma-separated labels")
    return parser.parse_args()


def load_sections(path):
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    sections = payload["sections"] if isinstance(payload, dict) else payload
    return sections


def load_geometry(spatial_dir, section):
    json_path = spatial_dir / "shared_raw" / section["json"]
    opener = gzip.open if json_path.suffix == ".gz" else open
    with opener(json_path, "rt", encoding="utf-8") as handle:
        payload = json.load(handle)
    scale = json.loads(
        (spatial_dir / ("%s_scalefactors_json.json" % section["gsm"])).read_text(encoding="utf-8")
    )["tissue_lowres_scalef"]
    return pd.DataFrame(
        [
            {
                "array_row": spot["row"],
                "array_col": spot["col"],
                "pxl_row": spot["imageY"] * scale,
                "pxl_col": spot["imageX"] * scale,
            }
            for spot in payload["oligo"]
        ]
    )


def load_counts(raw_dir, section):
    stem = "%s_%s" % (section["gsm"], section["sample_id"])
    matrix_path = raw_dir / ("%s_matrix.mtx.gz" % stem)
    barcode_path = raw_dir / ("%s_barcodes.tsv.gz" % stem)
    feature_path = raw_dir / ("%s_features.tsv.gz" % stem)
    with gzip.open(matrix_path, "rb") as handle:
        matrix = mmread(handle).tocsr()
    barcodes = pd.read_csv(barcode_path, header=None, sep="\t")[0].astype(str)
    features = pd.read_csv(feature_path, header=None, sep="\t")
    if matrix.shape[1] != len(barcodes):
        raise SystemExit("matrix/barcode mismatch for %s" % stem)
    return matrix, barcodes.to_numpy(), features[1].astype(str).to_numpy()


def significant_union(table, ko_gene):
    """Species-level significant DR genes: union across all samples.

    This matches the original spatial_knockout step, which writes one
    species-level ko_dr_expr column from the union, not per-sample lists.
    """
    sig = table[
        (table["significant"].astype(str).str.lower() == "true")
        & (table["is_knockout_gene"].astype(str).str.lower() != "true")
    ].copy()
    sig = sig[sig["Gene"].astype(str) != ko_gene]
    return sig


def main():
    args = parse_args()
    table = pd.read_csv(args.ko_table, sep="\t")
    sections = load_sections(args.samples)
    if args.sections:
        wanted = [item.strip() for item in args.sections.split(",") if item.strip()]
        sections = [s for s in sections if s["label"] in wanted]
    args.out_dir.mkdir(parents=True, exist_ok=True)

    layout = pd.read_csv(
        args.layout,
        comment="#",
        header=None,
        names=["barcode", "in_tissue", "array_row", "array_col", "pxl_row", "pxl_col"],
    )[["barcode", "array_row", "array_col"]]

    prepared = []
    gene_rows = []
    sig_all = significant_union(table, args.ko_gene)
    union_genes = sorted(set(sig_all["Gene"].astype(str)))
    if not union_genes:
        raise SystemExit("no significant DR genes for %s" % args.ko_gene)
    print("ko_gene=%s union_genes=%d" % (args.ko_gene, len(union_genes)))
    for section in sections:
        per_sample = sig_all[
            sig_all["sample_id"].astype(str) == str(section["sample_id"])
        ]
        genes = union_genes
        matrix, barcodes, symbols = load_counts(args.raw_dir, section)
        rows = [index for index, symbol in enumerate(symbols) if symbol in set(genes)]
        if not rows:
            print("skip %s: DR genes absent from matrix" % section["label"])
            continue
        values = np.asarray(matrix[rows, :].mean(axis=0)).ravel()
        frame = pd.DataFrame({"barcode": barcodes, "ko_dr_expr": values})
        frame = frame.merge(layout, on="barcode", how="left")
        geometry = load_geometry(args.spatial_dir, section)
        frame = frame.merge(geometry, on=["array_row", "array_col"], how="inner")
        prepared.append((section, frame, len(genes)))
        for gene in genes:
            gene_rows.append({"sample_id": section["sample_id"], "label": section["label"],
                              "ko_gene": args.ko_gene, "dr_gene": gene,
                              "n_genes": len(genes),
                              "significant_in_sample": bool(gene in set(per_sample["Gene"].astype(str)))})

    if not prepared:
        raise SystemExit("no section had usable significant DR genes")

    all_values = pd.concat([frame["ko_dr_expr"] for _, frame, _ in prepared])
    vmax = float(np.percentile(all_values, 100 * args.vmax_quantile))
    if vmax <= 0:
        vmax = max(float(all_values.max()), 1.0)
    print("ko_gene=%s vmax=%.3f sections=%d" % (args.ko_gene, vmax, len(prepared)))

    summary = []
    cmap = plt.get_cmap(args.cmap)
    for section, frame, n_genes in prepared:
        image = Image.open(
            args.spatial_dir / ("%s_tissue_lowres_image.png" % section["gsm"])
        )
        fig, ax = plt.subplots(figsize=(5.6, 5.4), dpi=300)
        ax.imshow(image)
        scatter = ax.scatter(
            frame["pxl_col"], frame["pxl_row"], c=frame["ko_dr_expr"],
            cmap=cmap, vmin=0, vmax=vmax, s=args.spot_size * 1.3,
            alpha=args.alpha, linewidths=0, rasterized=True,
        )
        ax.set_title(
            "%s - %s KO DR" % (section["label"], args.ko_gene),
            fontsize=12, fontweight="bold", pad=8,
        )
        ax.set_xticks([])
        ax.set_yticks([])
        for spine in ax.spines.values():
            spine.set_visible(False)
        colorbar = fig.colorbar(scatter, ax=ax, fraction=0.045, pad=0.03, shrink=0.7)
        colorbar.set_label("KO DR expr", fontsize=9)
        colorbar.ax.tick_params(labelsize=8)
        fig.text(
            0.01, -0.02,
            "[Virtual KO - DR Genes] %s KO, %s\n"
            "mean counts of %d significant DR genes per spot\n"
            "n=%d spots; coords = Space Ranger native pixels"
            % (args.ko_gene, section["label"], n_genes, len(frame)),
            ha="left", va="top", fontsize=8, linespacing=1.5,
        )
        name = "slice_%s_%sKO_styleD.png" % (section["label"], args.ko_gene)
        fig.savefig(args.out_dir / name, bbox_inches="tight", dpi=300)
        plt.close(fig)
        frame.to_csv(
            args.out_dir / ("ko_dr_%s_%s_spots.tsv" % (args.ko_gene, section["label"])),
            sep="\t", index=False,
        )
        summary.append(
            {"ko_gene": args.ko_gene, "section": section["label"],
             "dr_genes": n_genes, "spots": len(frame), "vmax": round(vmax, 4),
             "file": name}
        )
        print("[OK] %s" % (args.out_dir / name))

    pd.DataFrame(summary).to_csv(
        args.out_dir / ("ko_dr_%s_summary.tsv" % args.ko_gene), sep="\t", index=False
    )
    pd.DataFrame(gene_rows).to_csv(
        args.out_dir / ("ko_dr_%s_genes.tsv" % args.ko_gene), sep="\t", index=False
    )
    print("summary rows=%d" % len(summary))


if __name__ == "__main__":
    main()
