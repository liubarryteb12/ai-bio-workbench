#!/usr/bin/env python3
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps, ImageStat

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
PROJECT = ROOT / "local_projects" / "PRJ_AIMS_V3_20261027" / "figures"

FILES = [
    ("fig_l1_groupedbar", PROJECT / "line1_bulk" / "custom_fig_l1_groupedbar.png"),
    ("fig_l1_scatter", PROJECT / "line1_bulk" / "custom_fig_l1_scatter.png"),
    ("fig_l1_boxplot", PROJECT / "line1_bulk" / "custom_fig_l1_boxplot.png"),
    ("fig_l1_density", PROJECT / "line1_bulk" / "custom_fig_l1_density.png"),
    ("fig_l1_histogram", PROJECT / "line1_bulk" / "custom_fig_l1_histogram.png"),
    ("fig_l1_violin", PROJECT / "line1_bulk" / "custom_fig_l1_violin.png"),
    ("fig_l2_umap", PROJECT / "line2_scrna" / "custom_fig_l2_umap.png"),
    ("fig_l3_multipanel", PROJECT / "line1_bulk" / "custom_fig_l3_multipanel.png"),
    ("fig_l2p_violin", PROJECT / "line2_scrna" / "custom_fig_l2p_violin.png"),
    ("fig_l3_sankey", PROJECT / "line1_bulk" / "custom_fig_l3_sankey.png"),
]


def inspect(name, path):
    with Image.open(path) as image:
        image.verify()
    with Image.open(path) as image:
        image.load()
        width, height = image.size
        dpi = image.info.get("dpi")
        dpi = [round(float(value), 3) for value in dpi[:2]] if dpi else None
        variance = round(max(ImageStat.Stat(image.convert("RGB")).var), 6)
    valid_dpi = bool(dpi and min(dpi) >= 299.0)
    return {
        "template_id": name,
        "path": str(path.relative_to(ROOT)).replace("\\", "/"),
        "bytes": path.stat().st_size,
        "width": width,
        "height": height,
        "dpi": dpi,
        "pixel_variance": variance,
        "valid_dpi": valid_dpi,
        "valid": width > 0 and height > 0 and valid_dpi and variance > 1.0,
    }


thumbs = []
for name, path in FILES:
    image = Image.open(path).convert("RGB")
    image.thumbnail((480, 300))
    tile = Image.new("RGB", (500, 340), "white")
    x = (500 - image.width) // 2
    y = 30 + (300 - image.height) // 2
    tile.paste(image, (x, y))
    ImageDraw.Draw(tile).text((12, 8), name, fill="black")
    thumbs.append(tile)

sheet = Image.new("RGB", (1000, 1700), "#eeeeee")
for index, tile in enumerate(thumbs):
    sheet.paste(tile, ((index % 2) * 500, (index // 2) * 340))
sheet.save(OUT / "new_samples_contact_sheet.png", dpi=(150, 150))

rows = [inspect(name, path) for name, path in FILES]
(OUT / "new_samples_qc.json").write_text(
    json.dumps(rows, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
    newline="\n",
)
print(json.dumps({"rows": len(rows), "invalid": sum(not row["valid"] for row in rows)}))
