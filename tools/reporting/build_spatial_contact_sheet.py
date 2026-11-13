#!/usr/bin/env python3
"""Build a gene x section contact sheet from rendered spatial slice PNGs."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", required=True, type=Path, help="directory with slice_<section>_<gene>_styleD.png")
    parser.add_argument("--genes", required=True, help="comma-separated genes in row order")
    parser.add_argument("--sections", required=True, help="comma-separated section labels in column order")
    parser.add_argument("--out", type=Path, help="output PNG; default <dir>/contact_sheet_genes_he.png")
    parser.add_argument("--title", default="Visium spatial: focus genes by section")
    parser.add_argument("--tile-width", type=int, default=320)
    parser.add_argument("--tile-height", type=int, default=330)
    return parser.parse_args()


def load_font(size):
    for candidate in (
        Path("C:/Windows/Fonts/arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ):
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def main():
    args = parse_args()
    genes = [item.strip() for item in args.genes.split(",") if item.strip()]
    sections = [item.strip() for item in args.sections.split(",") if item.strip()]
    out = args.out or (args.dir / "contact_sheet_genes_he.png")
    width = args.tile_width * len(sections)
    height = args.tile_height * len(genes) + 50
    canvas = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(canvas)
    label_font = load_font(15)
    title_font = load_font(28)
    draw.text((12, 8), args.title, fill="black", font=title_font)
    image_box = (8, 38, args.tile_width - 8, args.tile_height - 8)

    missing = []
    for row, gene in enumerate(genes):
        for col, section in enumerate(sections):
            x = col * args.tile_width
            y = 50 + row * args.tile_height
            draw.rectangle((x, y, x + args.tile_width - 1, y + args.tile_height - 1), outline="#d5d5d5")
            draw.text((x + 9, y + 8), "%s  |  %s" % (gene, section), fill="black", font=label_font)
            path = args.dir / ("slice_%s_%s_styleD.png" % (section, gene))
            if not path.exists():
                missing.append(path.name)
                draw.text((x + 9, y + 80), "missing", fill="red", font=label_font)
                continue
            with Image.open(path) as source:
                image = source.convert("RGB")
                image.thumbnail(
                    (image_box[2] - image_box[0], image_box[3] - image_box[1]),
                    Image.Resampling.LANCZOS,
                )
            paste_x = x + (args.tile_width - image.width) // 2
            paste_y = y + image_box[1] + (image_box[3] - image_box[1] - image.height) // 2
            canvas.paste(image, (paste_x, paste_y))
    canvas.save(out)
    print("contact sheet %s, genes=%d sections=%d missing=%d"
          % (out, len(genes), len(sections), len(missing)))
    if missing:
        print("missing:", ", ".join(missing))


if __name__ == "__main__":
    main()
