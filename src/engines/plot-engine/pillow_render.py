#!/usr/bin/env python3
import argparse
import json

from PIL import Image, ImageDraw


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--dpi", type=int, required=True)
    parser.add_argument("--values", default="[]")
    parser.add_argument("--blank", action="store_true")
    args = parser.parse_args()

    values = json.loads(args.values)
    image = Image.new("RGB", (320, 240), "white")
    draw = ImageDraw.Draw(image)
    if not args.blank:
        draw.text((12, 10), args.title, fill="black")
        draw.line((20, 220, 300, 220), fill="black", width=1)
        for index, value in enumerate(values[:20]):
            x = 24 + index * 14
            height = max(1, min(160, int(abs(float(value)) * 10)))
            draw.line((x, 218, x, 218 - height), fill="#3B4992", width=6)
        if len(values) >= 2:
            draw.line((40, 40, 280, 40), fill="#EE0000", width=2)
    image.save(args.output, format="PNG", dpi=(args.dpi, args.dpi))

    saved = Image.open(args.output).convert("L")
    pixels = list(saved.getdata())
    mean = sum(pixels) / len(pixels)
    variance = sum((value - mean) ** 2 for value in pixels) / len(pixels)
    print(json.dumps({
        "path": args.output,
        "width": saved.width,
        "height": saved.height,
        "dpi": args.dpi,
        "pixelVariance": variance,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
