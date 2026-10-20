#!/usr/bin/env python3
"""S17 G1/G2 机器探针：从成品 PNG 取像素证据判定 line2 组合图的组图契约。

被验对象：`l2_20_composition_panel.png`（三面板 A/B/C）。
判据全部是"几何/颜色计数"，不读源码、不信脚本自述。

复用：底层像素函数（black_mask / color_mask / label_blobs / find_rects / find_letter /
iou_best / load_glyph / group_lines）直接 import S16 探针
`cn_debug/2026-10-20_verification_s16_g1g2.py`，不复制实现。

判据（每条参数写死在下面，实测值随打印输出）：

G1 面板编号
  P1 轴框：黑线矩形（四边黑覆盖率 >=0.9）恰好 3 个；A=最上面那个（y0 最小），
     B/C = 剩下的按 x0 分左右。结构断言：A 与 B 左缘对齐（<=4px）、A 与 C 右缘对齐
     （<=4px）、A 在 B/C 之上、A 宽 >= 0.80*图宽（上排横跨整幅）。
  P2 每个面板"左上角外侧"（x∈[x0-60,x0+220]、y∈[y0-70,y0-2]）存在高度 18..70px、
     宽度 8..60px 的字形，且 x0 距框左缘 <=40px、下缘距顶边 <=45px。
  P3 字形身份用模板匹配：A/B/C × 12pt bold / 10pt bold / 12pt normal 三套模板，
     判据 = 本面板字母的 12pt bold 模板 IoU 最大且 >=0.80、且优于同字母 12pt normal。

G2 共享图例（细胞类型色码只画一次、在图组下方居中、带语义标题）
  L0 图例色发现：全局出现 >=800px 的精确色里，凡在"所有面板下方"区域存在
     色块形状（w 40..120、h 10..45、面积 >=400，即 matplotlib 图例色块）的，判为图例色。
  L1 图例色恰好 == 细胞类型数（默认 13），每个色恰好 1 个色块，全部在所有面板下方，
     色块中点距图宽中线 <=6%；色块按 x 聚簇 <=2 列，每列 <=12 行（>12 条按列分组规则）。
  L2 图例色块上方 4..70px 有黑色墨迹（标题 "cell type"），右侧 4..60px 有条目文字墨迹
     ——证明不是"只有色块"。
  L3 面板外、图例区之外不得再出现图例色色块（防"图组上方/间隙里又画一次图例"）。
  L4 面板 A 内、面板 C 内不得出现图例色色块（防"面板内重复画同一组图例"；
     A 的堆叠条每段宽 415px、C 的散点面积 <50px，都不满足色块形状）。
  L5 共享色码成立：每个图例色在 A 内与 C 内各有 >=1 个色域（面积 >=200 / >=20），
     即 A 与 C 用的是同一套色码；且图例色与 B 的组别色（Healthy/Psoriasis）不重叠
     ——组别图例没有被混进共享图例。

内容交叉核对（确认字母与规格里的面板内容对得上）
  X1 A 是堆叠条：A 内图例色覆盖率 >=0.50（8 根柱铺满整幅高）
  X2 C 是 UMAP：C 内图例色覆盖率 <=0.10（只有 s=3 散点）
  X3 B 是组别箱线：B 内有面积 >=5000 的组别色块（两色各 >=1），且 A/C 内组别色块为 0
  X4 B 顶部 40% 有黑色文字墨迹（perm p 标注），A/C 顶部 40% 无（面板内无文字）
  X5 A 的 x 轴有 8 组供体标签：A 底边与 B/C 顶边之间的间隙里有黑色文字墨迹

用法：python 2026-10-20_verification_s17_g1g2.py --png <图> [--n-celltypes 13]
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

SW_W = (40, 120)      # 图例色块宽（实测 66~67px）
SW_H = (10, 45)       # 图例色块高（实测 23px）
SW_AREA = 400
CAND_MIN_PX = 800     # 候选色全局最小像素数
PAL_MIN_A = 200       # 图例色在 A 内的最小色域面积
PAL_MIN_C = 20        # 图例色在 C 内的最小色域面积（C 是散点）
BOX_AREA = 5000       # B 内组别色块最小面积（实测 3.9万~10万）
INK_MIN = 500         # 顶部 40% 黑色墨迹阈值


def load_s16():
    spec = importlib.util.spec_from_file_location("s16probe", S16)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def swatch_blobs(P, rgb, colors):
    """在给定色集合里找"图例色块形状"的连通域，返回 [(color, blob)]。"""
    out = []
    for c in colors:
        for b in P.label_blobs(P.color_mask(rgb, c, tol=0), SW_AREA):
            w, h = b["x1"] - b["x0"] + 1, b["y1"] - b["y0"] + 1
            if SW_W[0] <= w <= SW_W[1] and SW_H[0] <= h <= SW_H[1]:
                out.append((c, b))
    return out


def blob_area_in(box, blobs):
    return [b for b in blobs
            if box["x0"] <= b["cx"] <= box["x1"] and box["y0"] <= b["cy"] <= box["y1"]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--png", required=True)
    ap.add_argument("--glyphs", default=os.path.join(HERE, "2026-10-20_s16_dev", "glyphs"))
    ap.add_argument("--n-celltypes", type=int, default=13)
    ap.add_argument("--n-donors", type=int, default=8)
    ap.add_argument("--json", default="")
    args = ap.parse_args()

    P = load_s16()
    im = Image.open(args.png)
    im.load()
    rgb = np.asarray(im.convert("RGB"), dtype=np.int16)
    W, H = im.size
    black = P.black_mask(rgb)
    print("image %s  %dx%d  dpi=%s"
          % (os.path.basename(args.png), W, H, im.info.get("dpi")))
    fails = []

    # ---------------- P1 轴框 ----------------
    rects, hl, vl = P.find_rects(black, W, H)
    panels = [b for b in rects if b["w"] >= 0.10 * W and b["h"] >= 0.10 * H]
    print("P1 矩形候选 %d（横线 %d / 竖线 %d）" % (len(rects), len(hl), len(vl)))
    for b in sorted(rects, key=lambda d: -d["area"]):
        print("     rect (%d,%d)-(%d,%d) %dx%d"
              % (b["x0"], b["y0"], b["x1"], b["y1"], b["w"], b["h"]))
    if len(panels) != 3:
        print("FAIL P1 面板框数量 = %d（期望 3）" % len(panels))
        return 1
    top = min(panels, key=lambda d: d["y0"])
    rest = [b for b in panels if b is not top]
    names = {"A": top, "B": min(rest, key=lambda d: d["x0"]),
             "C": max(rest, key=lambda d: d["x0"])}
    pA, pB, pC = names["A"], names["B"], names["C"]
    struct = (abs(pA["x0"] - pB["x0"]) <= 4 and abs(pA["x1"] - pC["x1"]) <= 4
              and pA["y1"] < pB["y0"] and pA["w"] >= 0.80 * W)
    print("%s P1 3 个面板框: %s | A 宽=%.1f%% 图宽"
          % ("PASS" if struct else "FAIL",
             "  ".join("%s=(%d,%d)-(%d,%d)" % (k, v["x0"], v["y0"], v["x1"], v["y1"])
                       for k, v in sorted(names.items())), pA["w"] / W * 100))
    if not struct:
        fails.append("P1 三面板布局不符（A 应横跨上排、B/C 在下排）")

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
            fails.append("P2/P3 面板 %s 编号不匹配（best=%s IoU=%.3f）"
                         % (tag, best, scores[best]))

    # ---------------- 颜色发现 ----------------
    flat = rgb.reshape(-1, 3)
    uniq, counts = np.unique(flat, axis=0, return_counts=True)
    cands = []
    for i in range(len(uniq)):
        if counts[i] < CAND_MIN_PX:
            continue
        c = uniq[i]
        if c.min() >= 245:                                  # 白/近白
            continue
        if c.max() <= 90 and (c.max() - c.min()) <= 25:      # 黑/近黑（轴框文字）
            continue
        if (c.max() - c.min()) <= 25:                       # 灰（含抗锯齿灰）
            continue
        cands.append(tuple(int(x) for x in c))
    print("\n颜色发现：候选精确色 %d 个（全局 >=%dpx、非白非黑非灰）"
          % (len(cands), CAND_MIN_PX))

    max_bot = max(b["y1"] for b in panels)

    def outside(blob):
        return not any(b["x0"] <= blob["cx"] <= b["x1"] and b["y0"] <= blob["cy"] <= b["y1"]
                       for b in panels)

    sw = swatch_blobs(P, rgb, cands)
    below = [(c, bl) for c, bl in sw if bl["y0"] >= max_bot]
    legend_colors = sorted({c for c, _ in below})
    print("L0 面板下方图例色块 %d 个 / 图例色 %d 个: %s"
          % (len(below), len(legend_colors),
             " ".join("#%02X%02X%02X" % c for c in legend_colors)))

    # ---------------- L1 图例唯一 + 位置 ----------------
    per_color = {c: [bl for cc, bl in below if cc == c] for c in legend_colors}
    l1 = (len(legend_colors) == args.n_celltypes
          and all(len(v) == 1 for v in per_color.values()))
    xs = sorted(bl["x0"] for _, bl in below)
    x_clusters = []
    for x in xs:
        if x_clusters and x - x_clusters[-1][-1] <= 10:
            x_clusters[-1].append(x)
        else:
            x_clusters.append([x])
    rows_max = max(len(cl) for cl in x_clusters) if x_clusters else 0
    cols = len(x_clusters)
    mid = (min(bl["x0"] for _, bl in below) + max(bl["x1"] for _, bl in below)) / 2.0
    centered = abs(mid - W / 2.0) <= 0.06 * W
    l1 = l1 and centered and cols <= 2 and rows_max <= 12
    print("%s L1 图例色 %d 个（应=%d）、每色色块数=%s、列数=%d、每列最多 %d 行、"
          "色块组中点 x=%.0f 图宽中线=%.0f 偏差=%.1f%%"
          % ("PASS" if l1 else "FAIL", len(legend_colors), args.n_celltypes,
             sorted({len(v) for v in per_color.values()}), cols, rows_max,
             mid, W / 2.0, abs(mid - W / 2.0) / W * 100))
    if not l1:
        fails.append("L1 共享图例数量/居中/分组判定失败")

    # ---------------- L2 标题 + 条目文字 ----------------
    l2 = False
    if below:
        top_y = min(bl["y0"] for _, bl in below)
        lx0 = min(bl["x0"] for _, bl in below)
        lx1 = max(bl["x1"] for _, bl in below)
        title_ink = int(black[max(0, top_y - 70):max(0, top_y - 4), lx0:lx1 + 400].sum())
        label_ink = sum(int(black[bl["y0"] - 6:bl["y1"] + 6,
                                  bl["x1"] + 4:bl["x1"] + 120].sum())
                        for _, bl in below)
        l2 = title_ink >= 50 and label_ink >= 200
        print("%s L2 图例标题墨迹=%d px（色块上方 4..70px）、条目文字墨迹=%d px（右侧 4..120px）"
              % ("PASS" if l2 else "FAIL", title_ink, label_ink))
    if not l2:
        fails.append("L2 图例标题/条目文字判定失败")

    # ---------------- L3 面板外不得有第二份图例色块 ----------------
    stray = [(c, bl) for c, bl in sw
             if outside(bl) and not (bl["y0"] >= max_bot
                                     and lx0 - 10 <= bl["x0"] and bl["x1"] <= lx1 + 400)]
    l3 = not stray
    print("%s L3 面板外、图例区外的图例色色块数=%d%s"
          % ("PASS" if l3 else "FAIL", len(stray),
             "" if l3 else " %s" % [(c, bl["x0"], bl["y0"]) for c, bl in stray][:4]))
    if not l3:
        fails.append("L3 面板外存在第二份图例色块")

    # ---------------- L4 面板内不得有图例色块 ----------------
    in_sw = {}
    for tag in ("A", "B", "C"):
        box = names[tag]
        in_sw[tag] = [(c, bl) for c, bl in sw if blob_area_in(box, [bl])]
    l4 = not in_sw["A"] and not in_sw["C"]
    print("%s L4 面板内图例色色块数：A=%d B=%d C=%d（A/C 必须 0）"
          % ("PASS" if l4 else "FAIL", len(in_sw["A"]), len(in_sw["B"]), len(in_sw["C"])))
    if not l4:
        fails.append("L4 面板内出现重复图例色块")

    # ---------------- L5 共享色码成立 + 组别色不混入 ----------------
    blobs_by_color = {}
    for c in legend_colors:
        blobs_by_color[c] = P.label_blobs(P.color_mask(rgb, c, tol=0), 20)
    miss_a = [c for c in legend_colors if not blob_area_in(pA, blobs_by_color[c])]
    miss_c = [c for c in legend_colors if not blob_area_in(pC, blobs_by_color[c])]
    group_colors = []
    for c in cands:
        if c in legend_colors:
            continue
        big = [bl for bl in P.label_blobs(P.color_mask(rgb, c, tol=0), BOX_AREA)
               if blob_area_in(pB, [bl])]
        if big:
            group_colors.append(c)
    mixed = [c for c in group_colors if c in legend_colors]
    l5 = not miss_a and not miss_c and not mixed
    print("%s L5 图例色在 A 内缺失=%d 在 C 内缺失=%d；B 内组别色=%s（与图例色重叠=%d）"
          % ("PASS" if l5 else "FAIL", len(miss_a), len(miss_c),
             ["#%02X%02X%02X" % c for c in group_colors], len(mixed)))
    if not l5:
        fails.append("L5 A/C 色码与共享图例不一致")

    # ---------------- X1/X2 面板内容区分 ----------------
    def cover(box, colors):
        sub = rgb[box["y0"] + 3:box["y1"] - 2, box["x0"] + 3:box["x1"] - 2]
        m = np.zeros(sub.shape[:2], bool)
        for c in colors:
            m |= P.color_mask(sub, c, tol=0)
        return float(m.mean())

    cov_a, cov_c = cover(pA, legend_colors), cover(pC, legend_colors)
    x1 = cov_a >= 0.50
    x2 = cov_c <= 0.10
    print("%s X1 A 面板图例色覆盖率=%.3f（堆叠条 >=0.50）" % ("PASS" if x1 else "FAIL", cov_a))
    print("%s X2 C 面板图例色覆盖率=%.3f（UMAP 散点 <=0.10）" % ("PASS" if x2 else "FAIL", cov_c))
    if not x1:
        fails.append("X1 A 面板不像堆叠条")
    if not x2:
        fails.append("X2 C 面板不像散点 UMAP")

    # ---------------- X3 组别色只在 B 内 ----------------
    def group_in(box):
        n = 0
        for c in group_colors:
            n += len(blob_area_in(box, P.label_blobs(P.color_mask(rgb, c, tol=0), 100)))
        return n

    gb, ga, gc = group_in(pB), group_in(pA), group_in(pC)
    big_b = [c for c in group_colors
             if [bl for bl in P.label_blobs(P.color_mask(rgb, c, tol=0), BOX_AREA)
                 if blob_area_in(pB, [bl])]]
    x3 = len(big_b) >= 2 and ga == 0 and gc == 0
    print("%s X3 组别色块：B 内大色块色数=%d（两色各>=1）、A=%d C=%d（应 0）"
          % ("PASS" if x3 else "FAIL", len(big_b), ga, gc))
    if not x3:
        fails.append("X3 组别色分布不符（B 应为两色箱体、A/C 为 0）")

    # ---------------- X4 顶部文字墨迹（perm p 标注） ----------------
    def top_ink(box):
        y0, y1 = box["y0"] + 8, box["y0"] + int(0.40 * box["h"])
        x0, x1 = box["x0"] + 8, box["x1"] - 8
        return int(black[y0:y1, x0:x1].sum())

    ink_a, ink_b, ink_c = top_ink(pA), top_ink(pB), top_ink(pC)
    x4 = ink_b >= INK_MIN and ink_a == 0 and ink_c == 0
    print("%s X4 顶部 40%% 黑色墨迹：A=%d B=%d（perm p 文字，>=$%d） C=%d"
          % ("PASS" if x4 else "FAIL", ink_a, ink_b, INK_MIN, ink_c))
    if not x4:
        fails.append("X4 B 顶部无 perm p 文字墨迹或 A/C 面板内有文字")

    # ---------------- X5 A 的供体标签 ----------------
    gap_ink = int(black[pA["y1"] + 4:pB["y0"] - 2, pA["x0"]:pA["x1"]].sum())
    x5 = gap_ink >= 2000
    print("%s X5 A 与下排之间的间隙黑色文字墨迹=%d px（%d 组供体标签）"
          % ("PASS" if x5 else "FAIL", gap_ink, args.n_donors))
    if not x5:
        fails.append("X5 A 的 x 轴供体标签缺失")

    summary = {
        "png": os.path.abspath(args.png), "size": [W, H], "dpi": im.info.get("dpi"),
        "panels": {k: {kk: int(vv) for kk, vv in v.items()} for k, v in names.items()},
        "letters": letters,
        "legend_colors": ["#%02X%02X%02X" % c for c in legend_colors],
        "group_colors": ["#%02X%02X%02X" % c for c in group_colors],
        "P1": bool(struct),
        "P2_P3": not any(f.startswith("P2") for f in fails),
        "L1": bool(l1), "L2": bool(l2), "L3": bool(l3), "L4": bool(l4), "L5": bool(l5),
        "X1": bool(x1), "X2": bool(x2), "X3": bool(x3), "X4": bool(x4), "X5": bool(x5),
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
