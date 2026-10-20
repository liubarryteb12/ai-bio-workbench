#!/usr/bin/env python3
"""S16 调试：按颜色统计像素与包围盒（确认色条/图例/散点到底在不在图里）。"""

import sys

import numpy as np
from PIL import Image

TARGETS = {
    "case#EE0000": (238, 0, 0),
    "ctrl#3B4992": (59, 73, 146),
    "up#D62728": (214, 39, 40),
    "down#1F77B4": (31, 119, 180),
    "ns#BBBBBB": (187, 187, 187),
    "vir0#440154": (68, 1, 84),
    "vir1#414487": (65, 68, 135),
    "vir2#2A788E": (42, 120, 142),
    "vir3#22A884": (34, 168, 132),
    "vir4#7AD151": (122, 209, 81),
    "vir5#FDE725": (253, 231, 37),
    "rdbu_dark#67001F": (103, 0, 31),
    "rdbu_dark#053061": (5, 48, 97),
}


def main():
    path = sys.argv[1]
    tol = int(sys.argv[2]) if len(sys.argv) > 2 else 10
    rgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.int16)
    print("%s %s tol=%d" % (path, rgb.shape, tol))
    for name, col in TARGETS.items():
        m = np.all(np.abs(rgb - np.array(col, dtype=np.int16)) <= tol, axis=2)
        n = int(m.sum())
        if n == 0:
            print("%-18s 0" % name)
            continue
        ys, xs = np.nonzero(m)
        print("%-18s n=%-7d bbox x[%d..%d] y[%d..%d]"
              % (name, n, xs.min(), xs.max(), ys.min(), ys.max()))


if __name__ == "__main__":
    main()
