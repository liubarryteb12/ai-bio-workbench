#!/usr/bin/env python3
"""Build a labeled contact sheet from a plot verification matrix."""

import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw

from verify_plot_matrix import ensure_within


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--matrix", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--workspace-root", type=Path, default=Path.cwd())
    args = parser.parse_args()

    try:
        workspace_root = ensure_within(args.workspace_root, args.workspace_root)
        matrix_path = ensure_within(args.matrix, workspace_root)
        output_path = ensure_within(args.output, workspace_root)
    except ValueError as exc:
        parser.error(str(exc))

    matrix = json.loads(matrix_path.read_text(encoding="utf-8"))
    run_root = ensure_within(matrix_path.parent / "runs", workspace_root)
    rows = []
    for entry in matrix["entries"]:
        for artifact in entry.get("artifacts", []):
            if artifact["path"].lower().endswith(".png"):
                local_path = Path(artifact["path"])
                try:
                    local_path = ensure_within(local_path, workspace_root)
                except ValueError:
                    local_path = None
                if local_path is None or not local_path.is_file():
                    local_path = ensure_within(
                        run_root / entry["id"] / artifact["relative_path"],
                        run_root,
                    )
                rows.append((entry["id"], artifact, local_path))
    if not rows:
        raise SystemExit("no PNG artifacts found")

    columns = 4
    tile_width = 360
    tile_height = 300
    image_box = (20, 42, tile_width - 20, tile_height - 18)
    canvas = Image.new(
        "RGB",
        (columns * tile_width, math.ceil(len(rows) / columns) * tile_height),
        "white",
    )
    draw = ImageDraw.Draw(canvas)
    for index, (entry_id, artifact, local_path) in enumerate(rows):
        x = (index % columns) * tile_width
        y = (index // columns) * tile_height
        draw.rectangle((x, y, x + tile_width - 1, y + tile_height - 1), outline="#d0d0d0")
        draw.text((x + 12, y + 10), entry_id, fill="black")
        draw.text(
            (x + 12, y + 24),
            artifact["relative_path"],
            fill="#555555",
        )
        try:
            with Image.open(local_path) as source:
                image = source.convert("RGB")
                image.thumbnail(
                    (image_box[2] - image_box[0], image_box[3] - image_box[1]),
                    Image.Resampling.LANCZOS,
                )
            paste_x = x + (tile_width - image.width) // 2
            paste_y = y + image_box[1] + (image_box[3] - image_box[1] - image.height) // 2
            canvas.paste(image, (paste_x, paste_y))
        except Exception as exc:
            draw.text((x + 20, y + 80), f"load failed: {exc}", fill="red")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path)
    print(f"images={len(rows)} output={output_path}")


if __name__ == "__main__":
    main()
