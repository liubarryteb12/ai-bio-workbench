#!/usr/bin/env python3
"""S16 调试：按给定矩形区域做颜色普查（确认每个面板里到底画了什么）。"""

import sys

import numpy as np
from PIL import Image

COLORS = {
    "case": (238, 0, 0),
    "ctrl": (59, 73, 146),
    "up": (214, 39, 40),
    "down": (31, 119, 180),
    "ns": (187, 187, 187),
}


def main():
    path = sys.argv[1]
    tol = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    boxes = {
        "A": (260, 92, 2309, 1428),
        "C": (2800, 92, 4849, 1428),
        "B": (260, 1929, 2309, 3932),
        "D": (2800, 1929, 4715, 3932),
        "gap_AB": (260, 1428, 2309, 1929),
        "legend": (2200, 4400, 2900, 4700),
        "cbar": (4720, 1929, 4900, 3932),
    }
    rgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.int16)
    print("tol=%d" % tol)
    for name, (x0, y0, x1, y1) in boxes.items():
        sub = rgb[y0:y1, x0:x1]
        total = sub.shape[0] * sub.shape[1]
        ink = (sub.mean(axis=2) < 245).mean()
        parts = []
        for cname, col in COLORS.items():
            n = int(np.all(np.abs(sub - np.array(col, dtype=np.int16)) <= tol, axis=2).sum())
            parts.append("%s=%d" % (cname, n))
        print("%-8s %dx%d ink=%.4f %s" % (name, x1 - x0, y1 - y0, ink, " ".join(parts)))


if __name__ == "__main__":
    main()
