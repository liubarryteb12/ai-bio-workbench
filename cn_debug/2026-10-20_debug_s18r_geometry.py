#!/usr/bin/env python3
"""S18R 几何诊断：为 G1/G2 探针校准阈值（一次性，探针定稿前跑）。
输出：面板框、编号字形、图例带 swatch 几何、面板内候选色块的形状/填充率统计。"""
import importlib.util
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
S16 = os.path.join(HERE, "2026-10-20_verification_s16_g1g2.py")
spec = importlib.util.spec_from_file_location("s16probe", S16)
P = importlib.util.module_from_spec(spec)
spec.loader.exec_module(P)


def diagnose(png):
    im = Image.open(png)
    im.load()
    rgb = np.asarray(im.convert("RGB"), dtype=np.int16)
    W, H = im.size
    black = P.black_mask(rgb)
    print("== %s  %dx%d  dpi=%s" % (os.path.basename(png), W, H, im.info.get("dpi")))
    rects, hl, vl = P.find_rects(black, W, H)
    panels = [b for b in rects if b["w"] >= 0.10 * W and b["h"] >= 0.10 * H]
    print("rects=%d panels=%d" % (len(rects), len(panels)))
    for b in sorted(rects, key=lambda d: -d["area"]):
        print("   rect (%d,%d)-(%d,%d) %dx%d" % (b["x0"], b["y0"], b["x1"], b["y1"], b["w"], b["h"]))
    names = {}
    top2 = sorted(panels, key=lambda d: (d["y0"], d["x0"]))[:2]
    rest = [b for b in panels if b not in top2]
    names["A"] = min(top2, key=lambda d: d["x0"])
    names["B"] = max(top2, key=lambda d: d["x0"])
    for tag in ("A", "B"):
        box = names[tag]
        crop, bbox = P.find_letter(black, box)
        print("   面板 %s 框(%d,%d)-(%d,%d) 字形=%s bbox=%s" %
              (tag, box["x0"], box["y0"], box["x1"], box["y1"],
               "None" if crop is None else "%dx%d" % crop.shape, bbox))
    for tag in [t for t in names if t in ("A", "B")]:
        pass
    if rest:
        names["C"] = max(rest, key=lambda d: d["area"])
        box = names["C"]
        crop, bbox = P.find_letter(black, box)
        print("   面板 C 框(%d,%d)-(%d,%d) 字形=%s bbox=%s" %
              (box["x0"], box["y0"], box["x1"], box["y1"],
               "None" if crop is None else "%dx%d" % crop.shape, bbox))

    # 颜色发现
    flat = rgb.reshape(-1, 3)
    uniq, counts = np.unique(flat, axis=0, return_counts=True)
    cands = []
    for i in range(len(uniq)):
        if counts[i] < 800:
            continue
        c = uniq[i]
        if c.min() >= 245:
            continue
        if c.max() <= 90 and (c.max() - c.min()) <= 25:
            continue
        if (c.max() - c.min()) <= 25:
            continue
        cands.append(tuple(int(x) for x in c))
    print("候选精确色 %d 个" % len(cands))

    max_bot = max(b["y1"] for b in panels)
    # 图例带：所有面板下方的 swatch 形状色块
    below_sw = []
    for c in cands:
        for b in P.label_blobs(P.color_mask(rgb, c, tol=0), 400):
            w, h = b["x1"] - b["x0"] + 1, b["y1"] - b["y0"] + 1
            fill = b["area"] / float(w * h)
            if 40 <= w <= 120 and 10 <= h <= 45 and b["y0"] >= max_bot:
                below_sw.append((c, b, w, h, fill))
    print("面板下方 swatch 形状色块 %d 个；色 %d 个" %
          (len(below_sw), len({c for c, _, _, _, _ in below_sw})))
    for c, b, w, h, fill in below_sw[:6]:
        print("   #%02X%02X%02X (%d,%d) %dx%d area=%d fill=%.2f" %
              (c[0], c[1], c[2], b["x0"], b["y0"], w, h, b["area"], fill))
    if below_sw:
        ws = [w for _, _, w, _, _ in below_sw]
        hs = [h for _, _, _, h, _ in below_sw]
        fs = [f for _, _, _, _, f in below_sw]
        print("swatch 几何: w %d..%d  h %d..%d  fill %.2f..%.2f" %
              (min(ws), max(ws), min(hs), max(hs), min(fs), max(fs)))
        xs = sorted(b["x0"] for _, b, _, _, _ in below_sw)
        clusters = []
        for x in xs:
            if clusters and x - clusters[-1][-1] <= 10:
                clusters[-1].append(x)
            else:
                clusters.append([x])
        print("图例列簇 %d 个，每簇条数=%s" % (len(clusters), [len(c) for c in clusters]))
        mid = (min(b["x0"] for _, b, _, _, _ in below_sw) +
               max(b["x1"] for _, b, _, _, _ in below_sw)) / 2.0
        print("图例色块组中点 x=%.0f vs 图宽中线 %.0f 偏差=%.2f%%" %
              (mid, W / 2.0, abs(mid - W / 2.0) / W * 100))
        top_y = min(b["y0"] for _, b, _, _, _ in below_sw)
        lx0 = min(b["x0"] for _, b, _, _, _ in below_sw)
        lx1 = max(b["x1"] for _, b, _, _, _ in below_sw)
        title_ink = int(black[max(0, top_y - 70):max(0, top_y - 4), lx0:lx1 + 400].sum())
        label_ink = sum(int(black[b["y0"] - 6:b["y1"] + 6, b["x1"] + 4:b["x1"] + 120].sum())
                        for _, b, _, _, _ in below_sw)
        print("图例标题墨迹=%d 条目文字墨迹=%d" % (title_ink, label_ink))

    # 面板内：swatch 形状色块（含填充率），用于校准"面板内不得重复图例"判据
    for tag, box in names.items():
        hits = []
        for c in cands:
            for b in P.label_blobs(P.color_mask(rgb, c, tol=0), 400):
                if not (box["x0"] <= b["cx"] <= box["x1"] and box["y0"] <= b["cy"] <= box["y1"]):
                    continue
                w, h = b["x1"] - b["x0"] + 1, b["y1"] - b["y0"] + 1
                fill = b["area"] / float(w * h)
                hits.append((c, b, w, h, fill))
        shape = [x for x in hits if 40 <= x[2] <= 120 and 10 <= x[3] <= 45]
        solid = [x for x in shape if x[4] >= 0.85]
        print("面板 %s 内色块(>=400px)=%d，swatch 形状=%d，其中 fill>=0.85=%d" %
              (tag, len(hits), len(shape), len(solid)))
        for c, b, w, h, fill in sorted(shape, key=lambda d: -d[4])[:8]:
            print("      #%02X%02X%02X (%d,%d) %dx%d area=%d fill=%.2f" %
                  (c[0], c[1], c[2], b["x0"], b["y0"], w, h, b["area"], fill))


if __name__ == "__main__":
    for png in sys.argv[1:]:
        diagnose(png)
