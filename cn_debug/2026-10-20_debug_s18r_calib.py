#!/usr/bin/env python3
"""S18R 诊断 2：为探针 L5/X 判据取实测值（mouse+human）。"""
import importlib.util
import os
import sys

import numpy as np
from PIL import Image

S16 = r"D:/00.AIagent/codespace/AI辅助生信分析流程工作台/cn_debug/2026-10-20_verification_s16_g1g2.py"
spec = importlib.util.spec_from_file_location("s16probe", S16)
P = importlib.util.module_from_spec(spec)
spec.loader.exec_module(P)

DEV = r"D:/00.AIagent/codespace/AI辅助生信分析流程工作台/cn_debug/2026-10-20_s18r_dev"


def analyze(png, n_dom):
    im = Image.open(png)
    im.load()
    rgb = np.asarray(im.convert("RGB"), dtype=np.int16)
    W, H = im.size
    black = P.black_mask(rgb)
    rects, _, _ = P.find_rects(black, W, H)
    panels = [b for b in rects if b["w"] >= 0.10 * W and b["h"] >= 0.10 * H]
    top2 = sorted(panels, key=lambda d: (d["y0"], d["x0"]))[:2]
    A = min(top2, key=lambda d: d["x0"])
    B = max(top2, key=lambda d: d["x0"])
    C = max([b for b in panels if b is not A and b is not B], key=lambda d: d["area"])
    max_bot = max(b["y1"] for b in panels)
    print("== %s %dx%d n_dom=%d" % (os.path.basename(png), W, H, n_dom))
    print("   A=(%d,%d)-(%d,%d) B=(%d,%d)-(%d,%d) C=(%d,%d)-(%d,%d)"
          % (A["x0"], A["y0"], A["x1"], A["y1"], B["x0"], B["y0"], B["x1"], B["y1"],
             C["x0"], C["y0"], C["x1"], C["y1"]))

    # 图例带颜色发现（宽松形状 + 宽松颜色过滤）
    band = rgb[max_bot:, :, :]
    uniq, counts = np.unique(band.reshape(-1, 3), axis=0, return_counts=True)
    leg_colors = []
    for i in range(len(uniq)):
        c = uniq[i]
        if c.min() >= 240:
            continue
        if c.max() <= 90 and (c.max() - c.min()) <= 25:
            continue
        ct = tuple(int(x) for x in c)
        for b in P.label_blobs(P.color_mask(band, ct, tol=0), 400):
            w, h = b["x1"] - b["x0"] + 1, b["y1"] - b["y0"] + 1
            fill = b["area"] / float(w * h)
            if 40 <= w <= 120 and 10 <= h <= 45 and fill >= 0.85:
                leg_colors.append(ct)
                break
    leg_colors = sorted(set(leg_colors))
    print("   图例色=%d（应=%d）" % (len(leg_colors), n_dom))
    ws, hs = [], []
    for c in leg_colors:
        for b in P.label_blobs(P.color_mask(band, c, tol=0), 400):
            w, h = b["x1"] - b["x0"] + 1, b["y1"] - b["y0"] + 1
            fill = b["area"] / float(w * h)
            if 40 <= w <= 120 and 10 <= h <= 45 and fill >= 0.85:
                ws.append(w)
                hs.append(h)
    med_w = float(np.median(ws)) if ws else 0
    med_h = float(np.median(hs)) if hs else 0
    print("   swatch 中位几何 %.1fx%.1f（范围 %d..%d x %d..%d）"
          % (med_w, med_h, min(ws), max(ws), min(hs), max(hs)))

    # 紧几何（中位 +-30%）下：面板内 / 面板外上方 的图例色块
    tw = (int(med_w * 0.7), int(med_w * 1.3))
    th = (int(med_h * 0.7), int(med_h * 1.3))
    in_panel, above = 0, 0
    for c in leg_colors:
        for b in P.label_blobs(P.color_mask(rgb, c, tol=0), 400):
            w, h = b["x1"] - b["x0"] + 1, b["y1"] - b["y0"] + 1
            fill = b["area"] / float(w * h)
            if not (tw[0] <= w <= tw[1] and th[0] <= h <= th[1] and fill >= 0.85):
                continue
            inside = any(p["x0"] <= b["cx"] <= p["x1"] and p["y0"] <= b["cy"] <= p["y1"]
                         for p in panels)
            if inside:
                in_panel += 1
            elif b["y0"] < max_bot:
                above += 1
    print("   紧几何图例色块：面板内=%d 面板上方/间隙=%d（均应 0）" % (in_panel, above))

    # L5a：A 内 >=500px 的颜色集合
    sub_a = rgb[A["y0"]:A["y1"], A["x0"]:A["x1"], :].reshape(-1, 3)
    ua, ca = np.unique(sub_a, axis=0, return_counts=True)
    a_cols = []
    for i in range(len(ua)):
        c = ua[i]
        if ca[i] < 500 or c.min() >= 240:
            continue
        if c.max() <= 90 and (c.max() - c.min()) <= 25:
            continue
        a_cols.append(tuple(int(x) for x in c))
    a_in_leg = [c for c in a_cols if c in leg_colors]
    print("   A 内 >=500px 颜色=%d，其中属图例色=%d" % (len(a_cols), len(a_in_leg)))

    # L5b：每个图例色在 C 内的最大色域面积
    areas = []
    for c in leg_colors:
        blobs = [b for b in P.label_blobs(P.color_mask(rgb, c, tol=0), 5)
                 if C["x0"] <= b["cx"] <= C["x1"] and C["y0"] <= b["cy"] <= C["y1"]]
        areas.append(max((b["area"] for b in blobs), default=0))
    print("   C 内图例色最大色域面积：min=%d 中位=%d（min 应 >0）"
          % (min(areas), int(np.median(areas))))

    # X2：B 内图例色覆盖率
    sub_b = rgb[B["y0"] + 3:B["y1"] - 2, B["x0"] + 3:B["x1"] - 2]
    mb = np.zeros(sub_b.shape[:2], bool)
    for c in leg_colors:
        mb |= P.color_mask(sub_b, c, tol=0)
    print("   B 内图例色覆盖率=%.3f" % float(mb.mean()))

    # X3：C 内条的左对齐（各图例色最大色域的 x0 一致性）
    xs = []
    for c in leg_colors:
        blobs = [b for b in P.label_blobs(P.color_mask(rgb, c, tol=0), 200)
                 if C["x0"] <= b["cx"] <= C["x1"] and C["y0"] <= b["cy"] <= C["y1"]]
        if blobs:
            xs.append(max(blobs, key=lambda b: b["area"])["x0"])
    if xs:
        print("   C 内条左缘 x0: min=%d max=%d 极差=%d（左对齐应极小）"
              % (min(xs), max(xs), max(xs) - min(xs)))

    # X5：C 左缘域标签文字墨迹
    strip = black[max(0, C["y0"] + 10):C["y1"] - 10, max(0, C["x0"] - 420):max(0, C["x0"] - 8)]
    print("   C 左缘 420px 条带黑色墨迹=%d（57/18 行域标签）" % int(strip.sum()))


for png, n in (("l3_mouse_16_domain_panel.png", 57), ("l3_human_16_domain_panel.png", 18)):
    analyze(os.path.join(DEV, png), n)
