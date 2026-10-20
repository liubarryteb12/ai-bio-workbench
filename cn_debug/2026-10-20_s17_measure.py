#!/usr/bin/env python3
"""S17 测量脚本（不是判决）：把 l2_20 的候选判据所需的观测量全部打印出来。

做法：复用 S16 探针（cn_debug/2026-10-20_verification_s16_g1g2.py）的底层函数
（black_mask / color_mask / label_blobs / find_rects / find_letter / iou_best / load_glyph），
按 importlib 加载，不复制实现。**本脚本只测量，不判 PASS/FAIL**——判据在看到实测值后
才在正式探针里定死，避免"照结果调阈值"。

用法：python 2026-10-20_s17_measure.py --png <图>
"""

import argparse
import importlib.util
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
S16 = os.path.join(HERE, "2026-10-20_verification_s16_g1g2.py")


def load_s16():
    spec = importlib.util.spec_from_file_location("s16probe", S16)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--png", required=True)
    ap.add_argument("--glyphs", default=os.path.join(HERE, "2026-10-20_s16_dev", "glyphs"))
    args = ap.parse_args()

    p = load_s16()
    im = Image.open(args.png)
    im.load()
    rgb = np.asarray(im.convert("RGB"), dtype=np.int16)
    W, H = im.size
    print("image %dx%d dpi=%s" % (W, H, im.info.get("dpi")))

    black = p.black_mask(rgb)
    rects, hl, vl = p.find_rects(black, W, H)
    print("rects=%d  hl=%d vl=%d" % (len(rects), len(hl), len(vl)))
    for b in sorted(rects, key=lambda d: -d["area"]):
        print("   rect (%d,%d)-(%d,%d) %dx%d" % (b["x0"], b["y0"], b["x1"], b["y1"],
                                                 b["w"], b["h"]))

    # ---- 颜色普查：全图出现频次最高的精确色（排除白/近白/近黑）----
    flat = rgb.reshape(-1, 3)
    uniq, counts = np.unique(flat, axis=0, return_counts=True)
    order = np.argsort(-counts)
    print("\n--- 高频精确色 top25 ---")
    shown = 0
    for i in order:
        c = uniq[i]
        if counts[i] < 500:
            break
        if c.min() >= 245 or (c.max() <= 90 and (c.max() - c.min()) <= 25):
            continue
        print("   #%02X%02X%02X  %7d px" % (c[0], c[1], c[2], counts[i]))
        shown += 1
        if shown >= 25:
            break

    # ---- 面板内/外的"色块"几何普查（用高频色逐个做连通域，看 w/h/area 分布）----
    print("\n--- 色块几何（area>=100 的连通域，按色分组打印前若干）---")
    for i in order[:60]:
        c = uniq[i]
        if counts[i] < 800:
            break
        if c.min() >= 245:
            continue
        blobs = p.label_blobs(p.color_mask(rgb, tuple(int(x) for x in c), tol=0), 100)
        if not blobs:
            continue
        sizes = sorted(((b["x1"] - b["x0"] + 1, b["y1"] - b["y0"] + 1, b["area"])
                        for b in blobs), key=lambda t: -t[2])[:6]
        print("   #%02X%02X%02X n=%3d  (w,h,area)=%s" % (c[0], c[1], c[2], len(blobs), sizes))

    print("\nDONE")


if __name__ == "__main__":
    sys.exit(main())
