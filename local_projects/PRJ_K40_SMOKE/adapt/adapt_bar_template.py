# Master-SHA256: 33463fefeffaaf7d3b7a75aa235c2aa3fca87168e68838756c6c11454b58c575
#!/usr/bin/env python3
import argparse
import json

from PIL import Image, ImageDraw


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    with open(args.spec, encoding="utf-8") as handle:
        spec = json.load(handle)

    values = spec.get("values", [])
    title = spec.get("title", "Template studio")
    image = Image.new("RGB", (320, 240), "white")
    draw = ImageDraw.Draw(image)
    draw.text((12, 10), title, fill="black")
    draw.line((20, 220, 300, 220), fill="black", width=1)
    for index, value in enumerate(values[:20]):
        x = 24 + index * 14
        height = max(1, min(160, int(abs(float(value)) * 10)))
        draw.line((x, 218, x, 218 - height), fill="#3B4992", width=6)
    if values:
        draw.line((40, 40, 280, 40), fill="#EE0000", width=2)
    image.save(args.out, format="PNG", dpi=(300, 300))

    saved = Image.open(args.out).convert("L")
    pixels = list(saved.getdata())
    mean = sum(pixels) / len(pixels)
    variance = sum((value - mean) ** 2 for value in pixels) / len(pixels)
    print(json.dumps({
        "path": args.out,
        "width": saved.width,
        "height": saved.height,
        "dpi": 300,
        "pixelVariance": variance,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
