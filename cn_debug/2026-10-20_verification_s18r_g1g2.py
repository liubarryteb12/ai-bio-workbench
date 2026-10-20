#!/usr/bin/env python3
"""S18R G1/G2 机器探针：从成品 PNG 取像素证据判定 line3 组合图的组图契约。

被验对象：`l3_{sp}_16_domain_panel.png`（三面板 A/B/C，A=左上空间域散点、
B=右上域组成堆叠条、C=占满下排的 target gene 域均值条形）。
判据全部是"几何/颜色计数"，不读源码、不信脚本自述。

复用：底层像素函数（black_mask / color_mask / label_blobs / find_rects /
find_letter / iou_best / load_glyph）直接 import S16 探针
`cn_debug/2026-10-20_verification_s16_g1g2.py`，不复制实现；
面板结构与图例判据参照 S17 探针适配到本图布局。

判据（参数写死在下面，实测值随打印输出）：

G1 面板编号
  P1 轴框：黑色矩形（四边黑覆盖率>=0.9）恰好 3 个；A=上行左、B=上行右、
     C=剩下的（占满下排）。结构断言：A/B 顶边齐平（<=4px）、A.x1 < B.x0、
     C 在 A/B 下方、C 左右缘不低于 A/B（横跨整幅）。
  P2 每个面板"左上角外侧"（x∈[x0-60,x0+220]、y∈[y0-70,y0-2]）存在高度
     18..70px、宽度 8..60px 的字形，且 x0 距框左缘 <=40px、下缘距顶边 <=45px。
  P3 字形身份用模板匹配（S16 dev 渲出的 A/B/C × 12pt bold / 10pt bold /
     12pt normal）：判据 = 本面板字母 12pt bold 模板 IoU 最大且 >=0.80，
     且优于同字母 12pt normal。

G2 共享图例（域色码只画一次、图组下方居中、带语义标题）
  L0 图例色发现：所有面板下方的色块形状（w 40..120、h 10..45、面积>=400、
     填充率>=0.85，即 matplotlib 图例色块）按颜色归类；颜色过滤只排除
     近白（min>=240）与近黑（max<=90 且极差<=25）——域色板含灰（#7F7F7F 等），
     不能按"彩色"过滤（会把灰色域色漏掉）。
  L1 图例色恰好 == 域数（--n-domains），每色恰好 1 个色块，全部在面板下方，
     色块组中点距图宽中线 <=6%；按 x 聚簇的列数 <= ceil(n/12)、每列 <=12 行
     （>12 条按列分组规则，沿用 legend_out）。
  L2 最上一行色块上方 4..70px 有黑色墨迹（标题 "spatial domain"），每色块
     右侧 4..120px 有黑色墨迹（条目文字）——证明不是"只有色块"。
  L3 面板外、图例带之外不得再出现"图例同几何"色块（防图组上方/间隙里又画
     一次图例）；几何按图例带实测中位 w/h 收紧到 ±30%（图例色块 66x23 是
     同一份 fig.legend 的固定几何，重复图例必然同尺寸）。
  L4 面板内不得出现"图例同几何"色块（防面板内重复画同一组图例；A 的散点
     不结块、B 的堆叠段宽 ~405px、C 的条高 44..67px，均不满足 66x23 几何）。
  L5 共享色码成立：A 内 >=500px 的图例色个数 == A 面板样本的域数
     （--n-domains-a，A 只用样本私有域，用共享色板取色）；每个图例色在 C 内
     都有 >=200px 色域（C 覆盖全部域）。

内容交叉核对（确认字母与规格里的面板内容对得上）
  X1 B 是堆叠条：B 内图例色覆盖率 >=0.50（多根柱铺满面板）。
  X2 C 是横向条形：各图例色在 C 内最大色域的左缘极差 <=6px（左对齐），
     且域标签墨迹在 C 左缘条带（>=2000px）。
  X3 A 是无刻度空间散点：A 面板下方 4..44px 黑色墨迹 ~0（无 x 轴刻度），
     B 面板下方同位置有样本标签墨迹（>=2000px）。

用法：python 2026-10-20_verification_s18r_g1g2.py --png <图> \
        [--n-domains 57|18] [--n-domains-a 5|3] [--n-samples 10|5]
退出码：0 = 全部 PASS；1 = 有 FAIL；2 = 环境/输入问题
"""

import argparse
import glob
import importlib.util
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
S16 = os.path.join(HERE, "2026-10-20_verification_s16_g1g2.py")

SW_W = (40, 120)      # 图例色块宽（实测 66..67px）
SW_H = (10, 45)       # 图例色块高（实测 23px）
SW_AREA = 400
SW_FILL = 0.85
CAND_MIN_PX = 1000    # 图例带内候选色最小像素数（色块本身 1518px）
PAL_MIN_A = 500       # 图例色在 A 内的最小像素数（判"A 用共享色码"）
PAL_MIN_C = 200       # 图例色在 C 内的最小色域面积
INK_MIN = 50          # 图例标题墨迹阈值
LABEL_INK_MIN = 200   # 图例条目文字墨迹阈值
B_COVER = 0.50        # B 面板堆叠条图例色覆盖率下限
EDGE_INK_MIN = 2000   # B 样本标签 / C 域标签墨迹阈值


def load_s16():
    spec = importlib.util.spec_from_file_location("s16probe", S16)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def band_legend_colors(P, rgb, max_bot):
    """图例带（所有面板下方）的图例色发现：色块形状 + 宽松颜色过滤。"""
    band = rgb[max_bot:, :, :]
    uniq, counts = np.unique(band.reshape(-1, 3), axis=0, return_counts=True)
    out = []
    for i in range(len(uniq)):
        if counts[i] < CAND_MIN_PX:
            continue
        c = uniq[i]
        if c.min() >= 240:                                   # 近白
            continue
        if c.max() <= 90 and (c.max() - c.min()) <= 25:      # 近黑
            continue
        ct = tuple(int(x) for x in c)
        for b in P.label_blobs(P.color_mask(band, ct, tol=0), SW_AREA):
            w, h = b["x1"] - b["x0"] + 1, b["y1"] - b["y0"] + 1
            fill = b["area"] / float(w * h)
            if SW_W[0] <= w <= SW_W[1] and SW_H[0] <= h <= SW_H[1] and fill >= SW_FILL:
                out.append(ct)
                break
    return sorted(set(out))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--png", required=True)
    ap.add_argument("--glyphs", default=os.path.join(HERE, "2026-10-20_s16_dev", "glyphs"))
    ap.add_argument("--n-domains", type=int, required=True, help="物种级域数（mouse 57 / human 18）")
    ap.add_argument("--n-domains-a", type=int, required=True, help="A 面板样本的域数（mouse 5 / human 3）")
    ap.add_argument("--n-samples", type=int, required=True, help="样本数（mouse 10 / human 5）")
    ap.add_argument("--json", default="")
    args = ap.parse_args()

    P = load_s16()
    im = Image.open(args.png)
    im.load()
    rgb = np.asarray(im.convert("RGB"), dtype=np.int16)
    W, H = im.size
    black = P.black_mask(rgb)
    print("image %s  %dx%d  dpi=%s" % (os.path.basename(args.png), W, H, im.info.get("dpi")))
    fails = []

    # ---------------- P1 轴框 ----------------
    rects, hl, vl = P.find_rects(black, W, H)
    panels = [b for b in rects if b["w"] >= 0.10 * W and b["h"] >= 0.10 * H]
    print("P1 矩形候选 %d（横线 %d / 竖线 %d）" % (len(rects), len(hl), len(vl)))
    for b in sorted(rects, key=lambda d: -d["area"]):
        print("     rect (%d,%d)-(%d,%d) %dx%d" % (b["x0"], b["y0"], b["x1"], b["y1"], b["w"], b["h"]))
    if len(panels) != 3:
        print("FAIL P1 面板框数量 = %d（期望 3）" % len(panels))
        return 1
    top2 = sorted(panels, key=lambda d: (d["y0"], d["x0"]))[:2]
    names = {"A": min(top2, key=lambda d: d["x0"]), "B": max(top2, key=lambda d: d["x0"])}
    rest = [b for b in panels if b is not names["A"] and b is not names["B"]]
    names["C"] = max(rest, key=lambda d: d["area"])
    pA, pB, pC = names["A"], names["B"], names["C"]
    struct = (abs(pA["y0"] - pB["y0"]) <= 4 and pA["x1"] < pB["x0"]
              and pC["y0"] > pA["y1"] + 50
              and pC["x0"] <= pA["x0"] + 8 and pC["x1"] >= pB["x1"] - 8
              and pC["w"] >= 0.80 * W)
    print("%s P1 3 个面板框: %s | C 宽=%.1f%% 图宽"
          % ("PASS" if struct else "FAIL",
             "  ".join("%s=(%d,%d)-(%d,%d)" % (k, v["x0"], v["y0"], v["x1"], v["y1"])
                       for k, v in sorted(names.items())), pC["w"] / W * 100))
    if not struct:
        fails.append("P1 三面板布局不符（A/B 应上行并排、C 占满下排）")

    # ---------------- P2/P3 面板编号 ----------------
    glyphs = {}
    for path in sorted(glob.glob(os.path.join(args.glyphs, "*.png"))):
        ch, pt, weight = os.path.basename(path)[:-4].split("_")
        g = P.load_glyph(path)
        if g is not None:
            glyphs[(ch, int(pt), weight)] = g
    if not glyphs:
        print("FAIL 模板目录为空: %s" % args.glyphs)
        return 2
    letters = {}
    for tag, box in sorted(names.items()):
        crop, bbox = P.find_letter(black, box)
        if crop is None:
            print("FAIL P2 面板 %s 左上角外侧未找到字形" % tag)
            fails.append("P2 面板 %s 未找到编号" % tag)
            continue
        scores = {k: P.iou_best(crop, t) for k, t in glyphs.items()}
        best = max(scores, key=scores.get)
        alt12n = scores.get((best[0], 12, "normal"), 0.0)
        alt10 = scores.get((best[0], 10, "bold"), 0.0)
        ok = (best[0] == tag and best[1] == 12 and best[2] == "bold"
              and scores[best] >= 0.80 and scores[best] > alt12n)
        letters[tag] = {"bbox": bbox, "best": list(best), "iou": scores[best],
                        "crop": [int(crop.shape[0]), int(crop.shape[1])]}
        print("%s P2/P3 面板 %s 编号: 匹配=%s %dpt %s IoU=%.3f | 同字 12normal=%.3f "
              "10bold=%.3f | 字形 %dx%dpx 位置(%d,%d) 框左上(%d,%d)"
              % ("PASS" if ok else "FAIL", tag, best[0], best[1], best[2],
                 scores[best], alt12n, alt10, crop.shape[0], crop.shape[1],
                 bbox["x0"], bbox["y1"], box["x0"], box["y0"]))
        if not ok:
            fails.append("P2/P3 面板 %s 编号不匹配（best=%s IoU=%.3f）" % (tag, best, scores[best]))

    # ---------------- 图例色发现（L0） ----------------
    max_bot = max(b["y1"] for b in panels)
    legend_colors = band_legend_colors(P, rgb, max_bot)
    print("\nL0 面板下方图例色 %d 个（应=%d）: %s"
          % (len(legend_colors), args.n_domains,
             " ".join("#%02X%02X%02X" % c for c in legend_colors[:8]) + " ..."))
    if len(legend_colors) != args.n_domains:
        fails.append("L0/L1 图例色数量 %d != 域数 %d" % (len(legend_colors), args.n_domains))

    # 每色在图例带的色块 + 中位几何（供 L3/L4 收紧几何用）
    band = rgb[max_bot:, :, :]
    per_color = {}
    for c in legend_colors:
        sw = []
        for b in P.label_blobs(P.color_mask(band, c, tol=0), SW_AREA):
            w, h = b["x1"] - b["x0"] + 1, b["y1"] - b["y0"] + 1
            fill = b["area"] / float(w * h)
            if SW_W[0] <= w <= SW_W[1] and SW_H[0] <= h <= SW_H[1] and fill >= SW_FILL:
                sw.append({"x0": b["x0"], "y0": b["y0"] + max_bot, "x1": b["x1"],
                           "y1": b["y1"] + max_bot, "w": w, "h": h,
                           "cx": b["cx"], "cy": b["cy"] + max_bot})
        per_color[c] = sw

    # ---------------- L1 图例唯一 + 位置 ----------------
    dup = {c: len(sw) for c, sw in per_color.items() if len(sw) != 1}
    all_sw = [b for sw in per_color.values() for b in sw]
    xs = sorted(b["x0"] for b in all_sw)
    x_clusters = []
    for x in xs:
        if x_clusters and x - x_clusters[-1][-1] <= 10:
            x_clusters[-1].append(x)
        else:
            x_clusters.append([x])
    rows_max = max(len(cl) for cl in x_clusters) if x_clusters else 0
    cols = len(x_clusters)
    mid = (min(b["x0"] for b in all_sw) + max(b["x1"] for b in all_sw)) / 2.0 if all_sw else 0
    centered = abs(mid - W / 2.0) <= 0.06 * W
    ncol_expect = 1 if args.n_domains <= 12 else -(-args.n_domains // 12)
    l1 = (not dup and centered and cols <= ncol_expect and rows_max <= 12)
    print("%s L1 每色色块数=%s、列数=%d（应<=%d）、每列最多 %d 行（应<=12）、"
          "色块组中点 x=%.0f 图宽中线=%.0f 偏差=%.1f%%"
          % ("PASS" if l1 else "FAIL", sorted(set(dup.values())) if dup else "各 1",
             cols, ncol_expect, rows_max, mid, W / 2.0,
             abs(mid - W / 2.0) / W * 100))
    if not l1:
        fails.append("L1 共享图例数量/居中/分组判定失败")

    # ---------------- L2 标题 + 条目文字 ----------------
    l2 = False
    if all_sw:
        top_y = min(b["y0"] for b in all_sw)
        lx0 = min(b["x0"] for b in all_sw)
        lx1 = max(b["x1"] for b in all_sw)
        title_ink = int(black[max(0, top_y - 70):max(0, top_y - 4), lx0:lx1 + 400].sum())
        label_ink = sum(int(black[b["y0"] - 6:b["y1"] + 6, b["x1"] + 4:b["x1"] + 120].sum())
                        for b in all_sw)
        l2 = title_ink >= INK_MIN and label_ink >= LABEL_INK_MIN
        print("%s L2 图例标题墨迹=%d px（色块上方 4..70px）、条目文字墨迹=%d px（右侧 4..120px）"
              % ("PASS" if l2 else "FAIL", title_ink, label_ink))
    if not l2:
        fails.append("L2 图例标题/条目文字判定失败")

    # ---------------- L3/L4 重复图例（紧几何：图例中位 w/h ±30%） ----------------
    med_w = float(np.median([b["w"] for b in all_sw])) if all_sw else 0
    med_h = float(np.median([b["h"] for b in all_sw])) if all_sw else 0
    tw = (int(med_w * 0.7), int(med_w * 1.3))
    th = (int(med_h * 0.7), int(med_h * 1.3))
    print("L3/L4 图例色块中位几何 %.0fx%.0f → 紧几何窗口 w∈[%d,%d] h∈[%d,%d]"
          % (med_w, med_h, tw[0], tw[1], th[0], th[1]))
    stray_out, stray_in = [], []
    for c in legend_colors:
        for b in P.label_blobs(P.color_mask(rgb, c, tol=0), SW_AREA):
            w, h = b["x1"] - b["x0"] + 1, b["y1"] - b["y0"] + 1
            fill = b["area"] / float(w * h)
            if not (tw[0] <= w <= tw[1] and th[0] <= h <= th[1] and fill >= SW_FILL):
                continue
            inside = any(p["x0"] <= b["cx"] <= p["x1"] and p["y0"] <= b["cy"] <= p["y1"]
                         for p in panels)
            if inside:
                stray_in.append((c, b["x0"], b["y0"], w, h))
            elif b["y0"] < max_bot:
                # 面板外但不在图例带内（图例带 = max_bot 及以下）→ 疑似第二份图例
                stray_out.append((c, b["x0"], b["y0"], w, h))
    l3 = not stray_out
    l4 = not stray_in
    print("%s L3 面板外、图例带外的同几何图例色块=%d%s"
          % ("PASS" if l3 else "FAIL", len(stray_out),
             "" if l3 else " %s" % [("#%02X%02X%02X" % r[0], r[1], r[2]) for r in stray_out][:4]))
    print("%s L4 面板内同几何图例色块：A=%d B=%d C=%d（均应 0）"
          % ("PASS" if l4 else "FAIL",
             sum(1 for r in stray_in if pA["x0"] <= r[1] <= pA["x1"] and pA["y0"] <= r[2] <= pA["y1"]),
             sum(1 for r in stray_in if pB["x0"] <= r[1] <= pB["x1"] and pB["y0"] <= r[2] <= pB["y1"]),
             sum(1 for r in stray_in if pC["x0"] <= r[1] <= pC["x1"] and pC["y0"] <= r[2] <= pC["y1"])))
    if not l3:
        fails.append("L3 面板外存在第二份图例色块")
    if not l4:
        fails.append("L4 面板内出现重复图例色块")

    # ---------------- L5 共享色码 ----------------
    sub_a = rgb[pA["y0"]:pA["y1"], pA["x0"]:pA["x1"], :].reshape(-1, 3)
    ua, ca = np.unique(sub_a, axis=0, return_counts=True)
    a_big = set()
    for i in range(len(ua)):
        if ca[i] < PAL_MIN_A or ua[i].min() >= 240:
            continue
        if ua[i].max() <= 90 and (ua[i].max() - ua[i].min()) <= 25:
            continue
        a_big.add(tuple(int(x) for x in ua[i]))
    a_leg = [c for c in legend_colors if c in a_big]
    l5a = len(a_leg) == args.n_domains_a
    print("%s L5a A 内 >=%dpx 的图例色=%d（应=%d，A 面板样本的域数）"
          % ("PASS" if l5a else "FAIL", PAL_MIN_A, len(a_leg), args.n_domains_a))
    miss_c = []
    for c in legend_colors:
        blobs = [b for b in P.label_blobs(P.color_mask(rgb, c, tol=0), PAL_MIN_C)
                 if pC["x0"] <= b["cx"] <= pC["x1"] and pC["y0"] <= b["cy"] <= pC["y1"]]
        if not blobs:
            miss_c.append(c)
    l5b = not miss_c
    print("%s L5b 图例色在 C 内缺失=%d%s"
          % ("PASS" if l5b else "FAIL", len(miss_c),
             "" if not miss_c else " %s" % ["#%02X%02X%02X" % c for c in miss_c][:4]))
    if not l5a:
        fails.append("L5a A 面板未用共享域色码（或域数不符）")
    if not l5b:
        fails.append("L5b C 面板未覆盖全部域色码")

    # ---------------- X1 B 是堆叠条 ----------------
    sub_b = rgb[pB["y0"] + 3:pB["y1"] - 2, pB["x0"] + 3:pB["x1"] - 2]
    mb = np.zeros(sub_b.shape[:2], bool)
    for c in legend_colors:
        mb |= P.color_mask(sub_b, c, tol=0)
    cov_b = float(mb.mean())
    x1 = cov_b >= B_COVER
    print("%s X1 B 面板图例色覆盖率=%.3f（堆叠条 >=%.2f）" % ("PASS" if x1 else "FAIL", cov_b, B_COVER))
    if not x1:
        fails.append("X1 B 面板不像堆叠条")

    # ---------------- X2 C 是左对齐横向条形 + 域标签 ----------------
    lefts = []
    for c in legend_colors:
        blobs = [b for b in P.label_blobs(P.color_mask(rgb, c, tol=0), PAL_MIN_C)
                 if pC["x0"] <= b["cx"] <= pC["x1"] and pC["y0"] <= b["cy"] <= pC["y1"]]
        if blobs:
            lefts.append(max(blobs, key=lambda b: b["area"])["x0"])
    span = (max(lefts) - min(lefts)) if lefts else -1
    label_ink_c = int(black[max(0, pC["y0"] + 10):pC["y1"] - 10,
                             max(0, pC["x0"] - 420):max(0, pC["x0"] - 8)].sum())
    x2 = 0 <= span <= 6 and label_ink_c >= EDGE_INK_MIN
    print("%s X2 C 内条左缘极差=%d px（左对齐 <=6）、C 左缘域标签墨迹=%d px（>=%d）"
          % ("PASS" if x2 else "FAIL", span, label_ink_c, EDGE_INK_MIN))
    if not x2:
        fails.append("X2 C 面板不像左对齐横向条形（或缺域标签）")

    # ---------------- X3 A 无 x 刻度 / B 有样本标签 ----------------
    # B 的 x 刻度是 45° 旋转标签，墨迹沿对角线分布，取 150px 条带统计
    ink_a = int(black[pA["y1"] + 4:pA["y1"] + 44, pA["x0"]:pA["x1"]].sum())
    ink_b = int(black[pB["y1"] + 4:pB["y1"] + 154, pB["x0"]:pB["x1"]].sum())
    x3 = ink_a < 200 and ink_b >= EDGE_INK_MIN
    print("%s X3 面板下方墨迹：A=%d（4..44px 无刻度 <200） B=%d（4..154px 样本标签 >=%d）"
          % ("PASS" if x3 else "FAIL", ink_a, ink_b, EDGE_INK_MIN))
    if not x3:
        fails.append("X3 A/B 面板下方文字分布不符")

    summary = {
        "png": os.path.abspath(args.png), "size": [W, H], "dpi": im.info.get("dpi"),
        "panels": {k: {kk: int(vv) for kk, vv in v.items()} for k, v in names.items()},
        "letters": letters,
        "legend_colors": ["#%02X%02X%02X" % c for c in legend_colors],
        "swatch_geom": {"med_w": med_w, "med_h": med_h,
                        "tight_w": list(tw), "tight_h": list(th)},
        "P1": bool(struct),
        "P2_P3": not any(f.startswith("P2") for f in fails),
        "L0_L1": l1, "L2": l2, "L3": l3, "L4": l4, "L5a": l5a, "L5b": l5b,
        "X1": x1, "X2": x2, "X3": x3,
        "fails": fails,
    }
    print("\nSUMMARY %s" % json.dumps(summary, ensure_ascii=False))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(summary, fh, ensure_ascii=False, indent=1)
    print("probe: %s (%d fails)" % ("PASS" if not fails else "FAIL", len(fails)))
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
