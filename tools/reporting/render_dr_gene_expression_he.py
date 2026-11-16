#!/usr/bin/env python3
"""Paired control-versus-D3 H&E expression maps for significant DR genes.

This is the H&E counterpart of l3_mouse_dr_expr_<KO>_<gene>.png. For each
significant DR gene of one knockout target, it renders C1-control and D1-D3
side by side on their own H&E images, using log1p(CPM per 10k) from raw counts.

DR genes are the union of rows with adjusted p-value < 0.05 and
is_knockout_gene=False across all samples. This matches the original
generate_dr_gene_expression_figures.py selection rule.
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
    parser.add_argument("--control", default="C1-control")
    parser.add_argument("--case", default="D1-D3")
    parser.add_argument("--alpha", type=float, default=0.05)
    parser.add_argument("--spot-size", type=float, default=7.0)
    parser.add_argument("--point-alpha", type=float, default=0.8)
    parser.add_argument("--vmax-quantile", type=float, default=0.99)
    parser.add_argument("--limit", type=int, default=0, help="optional gene cap for a pilot run")
    return parser.parse_args()


def load_sections(path):
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    sections = payload["sections"] if isinstance(payload, dict) else payload
    return {section["sample_id"]: section for section in sections}


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


def prepare_sample(raw_dir, spatial_dir, section, layout):
    stem = "%s_%s" % (section["gsm"], section["sample_id"])
    with gzip.open(raw_dir / ("%s_matrix.mtx.gz" % stem), "rb") as handle:
        matrix = mmread(handle).tocsr()
    barcodes = pd.read_csv(raw_dir / ("%s_barcodes.tsv.gz" % stem), header=None, sep="\t")[0].astype(str)
    features = pd.read_csv(raw_dir / ("%s_features.tsv.gz" % stem), header=None, sep="\t")
    symbols = features[1].astype(str).to_numpy()
    depth = np.asarray(matrix.sum(axis=0)).ravel()
    frame = pd.DataFrame({"barcode": barcodes.to_numpy(), "depth": depth})
    frame = frame.merge(layout, on="barcode", how="left")
    frame = frame.merge(load_geometry(spatial_dir, section), on=["array_row", "array_col"], how="inner")
    first_position = {}
    for index, symbol in enumerate(symbols):
        first_position.setdefault(symbol, index)
    return {
        "section": section,
        "matrix": matrix,
        "frame": frame,
        "first_position": first_position,
        "image": Image.open(spatial_dir / ("%s_tissue_lowres_image.png" % section["gsm"])),
    }


def gene_values(sample, gene):
    index = sample["first_position"].get(gene)
    if index is None:
        return None
    counts = np.asarray(sample["matrix"][index, :].todense()).ravel().astype(float)
    depth = sample["frame"]["depth"].to_numpy(dtype=float)
    with np.errstate(divide="ignore", invalid="ignore"):
        cpm = np.divide(counts * 10000.0, depth, out=np.zeros_like(counts), where=depth > 0)
    return np.log1p(cpm)


def render_pair(control, case, control_values, case_values, gene, ko_gene, out_path, args):
    combined = np.concatenate([control_values, case_values])
    finite = combined[np.isfinite(combined)]
    vmax = float(np.percentile(finite, 100 * args.vmax_quantile)) if finite.size else 1.0
    if vmax <= 0:
        vmax = 1.0

    fig, axes = plt.subplots(1, 2, figsize=(10.8, 5.4), dpi=300)
    for ax, sample, values in (
        (axes[0], control, control_values),
        (axes[1], case, case_values),
    ):
        ax.imshow(sample["image"])
        scatter = ax.scatter(
            sample["frame"]["pxl_col"], sample["frame"]["pxl_row"], c=values,
            cmap="viridis", vmin=0, vmax=vmax, s=args.spot_size,
            alpha=args.point_alpha, linewidths=0, rasterized=True,
        )
        ax.set_title("%s: %s expr" % (sample["section"]["sample_id"], gene), fontsize=9)
        ax.set_xticks([])
        ax.set_yticks([])
        for spine in ax.spines.values():
            spine.set_visible(False)
        colorbar = fig.colorbar(scatter, ax=ax, shrink=0.82, fraction=0.046, pad=0.02)
        colorbar.set_label("log-normalized expr", fontsize=8)
        colorbar.ax.tick_params(labelsize=7)

    fig.text(
        0.01, -0.02,
        "[Virtual KO - DR Genes] KO %s, significant DR gene %s\n"
        "Spatial expression of the observed gene, control vs day 3 lesion\n"
        "DR status comes from computational network perturbation, not experimental knockout"
        % (ko_gene, gene),
        ha="left", va="top", fontsize=8, linespacing=1.5,
    )
    fig.savefig(out_path, bbox_inches="tight", dpi=300)
    plt.close(fig)
    return vmax


def main():
    args = parse_args()
    table = pd.read_csv(args.ko_table, sep="\t")
    significant = table[
        (pd.to_numeric(table["adjusted p-value"], errors="coerce") < args.alpha)
        & (table["is_knockout_gene"].astype(str).str.lower() != "true")
    ]
    genes = sorted(set(significant["Gene"].astype(str)))
    if args.limit:
        genes = genes[: args.limit]
    if not genes:
        raise SystemExit("no significant DR genes for %s" % args.ko_gene)

    sections = load_sections(args.samples)
    control_section = sections[args.control]
    case_section = sections[args.case]
    layout = pd.read_csv(
        args.layout,
        comment="#",
        header=None,
        names=["barcode", "in_tissue", "array_row", "array_col", "pxl_row", "pxl_col"],
    )[["barcode", "array_row", "array_col"]]
    control = prepare_sample(args.raw_dir, args.spatial_dir, control_section, layout)
    case = prepare_sample(args.raw_dir, args.spatial_dir, case_section, layout)
    args.out_dir.mkdir(parents=True, exist_ok=True)

    rows = []
    missing = []
    for gene in genes:
        control_values = gene_values(control, gene)
        case_values = gene_values(case, gene)
        if control_values is None or case_values is None:
            missing.append(gene)
            continue
        name = "l3_mouse_dr_expr_%s_%s_styleD.png" % (args.ko_gene, gene)
        vmax = render_pair(
            control, case, control_values, case_values, gene, args.ko_gene,
            args.out_dir / name, args,
        )
        rows.append(
            {"ko_gene": args.ko_gene, "dr_gene": gene, "file": name,
             "vmax": round(vmax, 4), "control_spots": len(control["frame"]),
             "case_spots": len(case["frame"])}
        )
        print("[OK] %s" % (args.out_dir / name))

    pd.DataFrame(rows).to_csv(
        args.out_dir / ("dr_expr_%s_manifest.tsv" % args.ko_gene), sep="\t", index=False
    )
    if missing:
        pd.DataFrame({"ko_gene": args.ko_gene, "missing_gene": missing}).to_csv(
            args.out_dir / ("dr_expr_%s_missing.tsv" % args.ko_gene), sep="\t", index=False
        )
    print("ko_gene=%s rendered=%d missing=%d" % (args.ko_gene, len(rows), len(missing)))


if __name__ == "__main__":
    main()
