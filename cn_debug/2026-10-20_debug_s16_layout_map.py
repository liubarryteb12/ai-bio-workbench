#!/usr/bin/env python3
"""S16 调试：把成品 PNG 打成"可读"的 ASCII 布局图 + 打印线/框候选。

为什么要它：本会话没有图像查看工具，判定版式只能靠像素统计。ASCII 密度图能直接看出
"面板在哪、图例在哪、色条在哪"，比逐条猜阈值快。
"""

import os
import sys

import numpy as np
from PIL import Image

VIRIDIS = [(68, 1, 84), (65, 68, 135), (42, 120, 142), (34, 168, 132),
           (122, 209, 81), (253, 231, 37)]
RDBU = [(103, 0, 31), (5, 48, 97)]   # 只要两端深色：中点是近白 (247,247,247)，会和背景白撞车


def main():
    path = sys.argv[1]
    cols = int(sys.argv[2]) if len(sys.argv) > 2 else 100
    im = Image.open(path)
    rgb = np.asarray(im.convert("RGB"), dtype=np.int16)
    H, W = rgb.shape[:2]
    rows = max(1, int(cols * H / W / 2.0))
    print("%s  %dx%d" % (os.path.basename(path), W, H))
    ys = np.linspace(0, H, rows + 1).astype(int)
    xs = np.linspace(0, W, cols + 1).astype(int)
    print("    " + "".join(str((i // 10) % 10) for i in range(cols)))
    for r in range(rows):
        line = []
        for c in range(cols):
            blk = rgb[ys[r]:ys[r + 1], xs[c]:xs[c + 1]].reshape(-1, 3)
            if blk.size == 0:
                line.append(" ")
                continue
            dark = (blk.max(axis=1) <= 90).mean()
            red = (np.abs(blk - np.array([238, 0, 0])).max(axis=1) <= 12).mean()
            blue = (np.abs(blk - np.array([59, 73, 146])).max(axis=1) <= 12).mean()
            up = (np.abs(blk - np.array([214, 39, 40])).max(axis=1) <= 12).mean()
            dn = (np.abs(blk - np.array([31, 119, 180])).max(axis=1) <= 12).mean()
            ns = (np.abs(blk - np.array([187, 187, 187])).max(axis=1) <= 12).mean()
            vir = max((np.abs(blk - np.array(v)).max(axis=1) <= 10).mean()
                      for v in VIRIDIS)
            rdbu = max((np.abs(blk - np.array(v)).max(axis=1) <= 10).mean()
                       for v in RDBU)
            ink = (blk.mean(axis=1) < 245).mean()
            if red > 0.10:
                ch = "R"
            elif blue > 0.10:
                ch = "B"
            elif up > 0.10:
                ch = "u"
            elif dn > 0.10:
                ch = "d"
            elif ns > 0.10:
                ch = "n"
            elif vir > 0.10:
                ch = "v"
            elif rdbu > 0.10:
                ch = "h"
            elif dark > 0.5:
                ch = "#"
            elif ink > 0.5:
                ch = "+"
            elif ink > 0.15:
                ch = "."
            else:
                ch = " "
            line.append(ch)
        print("%4d" % ys[r] + "".join(line))
    print("    " + "".join(str((i // 10) % 10) for i in range(cols)))


if __name__ == "__main__":
    main()
