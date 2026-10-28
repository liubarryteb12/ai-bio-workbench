#!/usr/bin/env python3
"""Replace matplotlib default DE colors with Okabe-Ito per 03出图规范 §四."""

from __future__ import annotations

import os

MARKER = "# [spec-v110] DE palette: Okabe-Ito (Up=#D55E00 Down=#0072B2 NS grey70)"
FILES = [
    "/mnt/ssd/bio_data/bin/line1_bulk/bulk_figures",
    "/mnt/ssd/bio_data/bin/line2_scrna/scrna_figures",
    "/mnt/ssd/bio_data/bin/line1_bulk/enrichment_figures",
    "/mnt/ssd/bio_data/bin/line2_scrna/enrichment_figures",
    "/mnt/ssd/bio_data/bin/line3_spatial/enrichment_figures",
]


def main() -> int:
    for path in FILES:
        name = os.path.basename(path)
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        if MARKER in text:
            print(f"SKIP {name}: already done")
            continue
        n_up = text.count('UP = "#D62728"')
        n_down = text.count('DOWN = "#1F77B4"')
        text = text.replace('UP = "#D62728"', 'UP = "#D55E00"')
        text = text.replace('DOWN = "#1F77B4"', 'DOWN = "#0072B2"')
        lines = text.split("\n")
        insert_at = next((i for i, line in enumerate(lines) if line.startswith("UP = ")), 0)
        lines.insert(insert_at, MARKER)
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write("\n".join(lines))
        print(f"OK {name}: UP x{n_up} DOWN x{n_down}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
