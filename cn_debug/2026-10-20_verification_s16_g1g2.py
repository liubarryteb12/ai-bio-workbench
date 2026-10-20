#!/usr/bin/env python3
"""S16 G1/G2 机器探针：从成品 PNG 取像素证据判定组图契约（不看源码自述）。

判据（每条都可复算，参数写死在下面）：

G1 面板编号
  P1 轴框检测：黑色（max(r,g,b)<=90 且通道极差<=25，借此排除热图深色格）长直线拼成矩形；
     四边黑覆盖率 >=0.9 才算框；再丢掉"包含其它框"的合并框（两列面板顶底同高时，整幅宽的
     那个框也会通过覆盖率判定，不丢就会把两个面板并成一个）。期望恰好 4 个面板框，
     按位置映射 A=左上 / B=左下 / C=右上 / D=右下。
  P2 每个面板框"左上角外侧"区域（x∈[x0-60, x0+220]，y∈[y0-70, y0-2]）内找黑色连通域，
     取一个高度 18..70px、宽度 8..60px 且 x0 最近框左缘（<=40px）、下缘离顶边 <=45px 的字形。
  P3 字形身份用模板匹配（模板由算力端同后端同 dpi 渲出：A/B/C/D × 12pt bold / 10pt bold
     / 12pt normal），判据 = 12pt bold 模板的 IoU 最大且 > 0.80，同时优于 12pt normal。
     IoU 在 ±3px 平移内取最大（成品与模板渲染原点不同）。

G2 共享图例
  L1 面板框外、组色（case #EE0000 / ctrl #3B4992）色块恰好 2 个（各 1），面积 >= 150px，
     且都在所有面板框下方（图例在图组下方）、两个色块中点距图宽中线 <= 6%。
  L2 这两个色块上方 4..70px 内有黑色墨迹（图例标题 "group"），右侧 4..60px 内有黑色墨迹
     （条目文字）——证明不是"只有色块"。
  L3 面板框外的 up/down/NS 图例色（#D62728 / #1F77B4 / #BBBBBB）色块恰好 3 个，且都落在
     面板 A 与面板 B 之间的水平间隙里（A 的 x 范围内、A 底边与 B 顶边之间）——
     up/down/NS 色码全图组只画一次。
  L4 面板内组色块计数：C 面板内 case+ctrl 色块总数 == 样本数（每样本一个散点；重复画一次
     图例会多出恰好 2 个色块），A/B/D 面板内组色块数必须为 0（组色语义只属于 C）。

内容交叉核对（确认字母与规格里的面板内容对得上，不只是字母顺序对）
  X1 存在窄色条（两条长竖线，间距 40..250px）紧贴标 "D" 的面板右侧，竖向跨度 >=0.8 面板高；
  X2 标 "C" 的面板内有 >=3 个 case 色与 >=3 个 ctrl 色大色块（s=60 散点，面积>=300）；
  X3 标 "B" 的面板内有 1 条贯通全宽的实线水平线（MA 的 log2FC=0），标 "A" 的面板内 0 条
     （火山图的 3 条阈值线全是虚线，最长连续段远短于全宽）；
  X4 标 "A" 的面板内分类色墨迹的垂直重心位于面板下半部（y>0.6），"B" 的位于中部
     （0.35..0.65）——火山图点云贴底、MA 点云绕 0 分布。

用法：python 2026-10-20_verification_s16_g1g2.py --png <图> [--glyphs <模板目录>]
退出码：0 = 全部 PASS；1 = 有 FAIL；2 = 环境/输入问题
"""

import argparse
import glob
import json
import os
import sys

import numpy as np
from PIL import Image

CASE = (238, 0, 0)        # #EE0000
CTRL = (59, 73, 146)      # #3B4992
UP = (214, 39, 40)        # #D62728
DOWN = (31, 119, 180)     # #1F77B4
NS = (187, 187, 187)      # #BBBBBB
TOL = 3                   # 颜色容差：色块核心是精确值；放宽到 10+ 会把抗锯齿灰字算成色块


# ---------------------------------------------------------------- 基础工具
def load_rgb(path):
    im = Image.open(path)
    im.load()
    return im, np.asarray(im.convert("RGB"), dtype=np.int16)


def black_mask(rgb):
    """近黑且非彩色（轴框/文字/刻度）：max<=90 且通道极差<=25。
    为什么加"非彩色"：热图深红 #67001F、深蓝 #053061、viridis 深紫都有强色偏，
    只看亮度会把整行热图当成"横线"。"""
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    return (mx <= 90) & ((mx - mn) <= 25)


def color_mask(rgb, color, tol=TOL):
    return np.all(np.abs(rgb - np.array(color, dtype=np.int16)) <= tol, axis=2)


def longest_run(line):
    idx = np.flatnonzero(line)
    if idx.size == 0:
        return 0
    breaks = np.flatnonzero(np.diff(idx) > 1)
    starts = np.concatenate(([0], breaks + 1))
    ends = np.concatenate((breaks, [idx.size - 1]))
    return int((idx[ends] - idx[starts] + 1).max())


def group_lines(positions, gap=2):
    """把相邻的行/列坐标并成一条线，返回中心坐标列表。"""
    if not positions:
        return []
    out, cur = [], [positions[0]]
    for p in positions[1:]:
        if p - cur[-1] <= gap:
            cur.append(p)
        else:
            out.append(int(round(sum(cur) / len(cur))))
            cur = [p]
    out.append(int(round(sum(cur) / len(cur))))
    return out


def edge_coverage(mask, y, x_from, x_to, horizontal=True, samples=160):
    if horizontal:
        xs = np.linspace(x_from, x_to, samples).astype(int)
        return float(mask[y, xs].mean())
    ys = np.linspace(x_from, x_to, samples).astype(int)
    return float(mask[ys, y].mean())


def label_blobs(mask, min_area=20):
    """4-邻域连通域（只遍历 True 像素，色块总量很小）。"""
    ys, xs = np.nonzero(mask)
    todo = set(zip(ys.tolist(), xs.tolist()))
    blobs = []
    while todo:
        seed = todo.pop()
        stack, comp = [seed], [seed]
        while stack:
            cy, cx = stack.pop()
            for nb in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                if nb in todo:
                    todo.discard(nb)
                    stack.append(nb)
                    comp.append(nb)
        if len(comp) < min_area:
            continue
        arr = np.array(comp)
        y0, y1 = int(arr[:, 0].min()), int(arr[:, 0].max())
        x0, x1 = int(arr[:, 1].min()), int(arr[:, 1].max())
        blobs.append({"area": len(comp), "y0": y0, "y1": y1, "x0": x0, "x1": x1,
                      "cy": float(arr[:, 0].mean()), "cx": float(arr[:, 1].mean())})
    return blobs


def merge_adjacent(boxes, tol=6):
    """合并"同一 x 跨度上下相接"或"同一 y 跨度左右相接"的矩形。

    为什么需要：面板内部的贯通实线（如 MA 的 log2FC=0 黑线）会被当成一条"横线"，
    把该面板切成上下两个矩形；两个半框各自四边黑覆盖率都够，不合并就会多出一个面板。
    """
    boxes = list(boxes)
    changed = True
    while changed:
        changed = False
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                a, b = boxes[i], boxes[j]
                same_x = abs(a["x0"] - b["x0"]) <= tol and abs(a["x1"] - b["x1"]) <= tol
                same_y = abs(a["y0"] - b["y0"]) <= tol and abs(a["y1"] - b["y1"]) <= tol
                vert = same_x and (abs(a["y1"] - b["y0"]) <= tol
                                   or abs(b["y1"] - a["y0"]) <= tol)
                horz = same_y and (abs(a["x1"] - b["x0"]) <= tol
                                   or abs(b["x1"] - a["x0"]) <= tol)
                if not (vert or horz):
                    continue
                m = {"x0": min(a["x0"], b["x0"]), "y0": min(a["y0"], b["y0"]),
                     "x1": max(a["x1"], b["x1"]), "y1": max(a["y1"], b["y1"])}
                m["w"], m["h"] = m["x1"] - m["x0"], m["y1"] - m["y0"]
                m["area"] = m["w"] * m["h"]
                boxes = [x for k, x in enumerate(boxes) if k not in (i, j)] + [m]
                changed = True
                break
            if changed:
                break
    return boxes


# ---------------------------------------------------------------- 轴框检测
def find_rects(black, W, H):
    rows = [y for y in range(H) if longest_run(black[y]) >= 0.25 * W]
    cols = [x for x in range(W) if longest_run(black[:, x]) >= 0.15 * H]
    hl, vl = group_lines(rows), group_lines(cols)
    boxes = []
    for i in range(len(hl)):
        for j in range(i + 1, len(hl)):
            if hl[j] - hl[i] < 0.10 * H:
                continue
            for k in range(len(vl)):
                for l in range(k + 1, len(vl)):
                    if vl[l] - vl[k] < 0.05 * W:
                        continue
                    top, bot, left, right = hl[i], hl[j], vl[k], vl[l]
                    if (edge_coverage(black, top, left, right) < 0.9
                            or edge_coverage(black, bot, left, right) < 0.9
                            or edge_coverage(black, left, top, bot, False) < 0.9
                            or edge_coverage(black, right, top, bot, False) < 0.9):
                        continue
                    boxes.append({"y0": top, "y1": bot, "x0": left, "x1": right,
                                  "w": right - left, "h": bot - top,
                                  "area": (right - left) * (bot - top)})
    # 去重（同一框可能被相邻线组合重复命中）
    uniq = []
    for b in sorted(boxes, key=lambda d: -d["area"]):
        if any(abs(b["y0"] - u["y0"]) <= 4 and abs(b["y1"] - u["y1"]) <= 4
               and abs(b["x0"] - u["x0"]) <= 4 and abs(b["x1"] - u["x1"]) <= 4
               for u in uniq):
            continue
        uniq.append(b)
    # 先合并被内部贯通线切开的半框，再丢掉"包含另一个框"的合并框
    uniq = merge_adjacent(uniq)
    dedup = []
    for b in sorted(uniq, key=lambda d: -d["area"]):
        if any(abs(b["y0"] - u["y0"]) <= 4 and abs(b["y1"] - u["y1"]) <= 4
               and abs(b["x0"] - u["x0"]) <= 4 and abs(b["x1"] - u["x1"]) <= 4
               for u in dedup):
            continue
        dedup.append(b)
    uniq = dedup
    kept = []
    for b in uniq:
        if any(o is not b and o["area"] < b["area"]
               and o["x0"] >= b["x0"] - 4 and o["x1"] <= b["x1"] + 4
               and o["y0"] >= b["y0"] - 4 and o["y1"] <= b["y1"] + 4 for o in uniq):
            continue
        kept.append(b)
    return kept, hl, vl


def find_colorbar(vl, black, rgb, panel_h, dbox):
    """色条 = 贴在 D 面板右侧、两条长竖线之间"有连续色带"的窄条（间距 60..250px）。

    为什么不靠"矩形"：colorbar 上下边只有几十 px，达不到横线阈值（0.25*图宽），
    所以它从不出现在矩形候选里。为什么还要判"内部有色带"：D 面板右边线与色条左边线
    之间还有 pad 空隙（实测 41px 白条），只按间距会把这个空白当色条，色条缺失也能过。
    """
    best = None
    for i in range(len(vl)):
        for j in range(i + 1, len(vl)):
            gap = vl[j] - vl[i]
            if not (60 <= gap <= 250):
                continue
            if vl[i] < dbox["x1"] or vl[i] - dbox["x1"] > 200:
                continue
            s_l = longest_run(black[:, vl[i]])
            s_r = longest_run(black[:, vl[j]])
            if min(s_l, s_r) < 0.8 * panel_h:
                continue
            inner = rgb[dbox["y0"]:dbox["y1"], vl[i] + 3:vl[j] - 2]
            ink = float((inner.mean(axis=2) < 245).mean()) if inner.size else 0.0
            if ink < 0.3:
                continue
            cand = {"x0": int(vl[i]), "x1": int(vl[j]), "w": int(gap),
                    "span": int(min(s_l, s_r)), "interior_ink": round(ink, 3)}
            if best is None or cand["w"] > best["w"]:
                best = cand
    return best


# ---------------------------------------------------------------- 字形匹配
def load_glyph(path):
    a = np.asarray(Image.open(path).convert("L"))
    ink = a < 128
    ys, xs = np.nonzero(ink)
    if ys.size == 0:
        return None
    return ink[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def iou_best(a, b, shifts=3):
    H = max(a.shape[0], b.shape[0]) + 2 * shifts
    W = max(a.shape[1], b.shape[1]) + 2 * shifts
    A = np.zeros((H, W), bool)
    A[shifts:shifts + a.shape[0], shifts:shifts + a.shape[1]] = a
    best = 0.0
    for dy in range(-shifts, shifts + 1):
        for dx in range(-shifts, shifts + 1):
            B = np.zeros((H, W), bool)
            B[shifts + dy:shifts + dy + b.shape[0],
              shifts + dx:shifts + dx + b.shape[1]] = b
            inter = np.logical_and(A, B).sum()
            uni = np.logical_or(A, B).sum()
            if uni and inter / uni > best:
                best = inter / uni
    return best


def find_letter(black, box):
    """在面板左上角外侧找字形连通域，返回 (crop, bbox) 或 (None, None)。"""
    y_from, y_to = max(0, box["y0"] - 70), max(0, box["y0"] - 2)
    x_from, x_to = max(0, box["x0"] - 60), min(black.shape[1], box["x0"] + 220)
    sub = black[y_from:y_to, x_from:x_to]
    best = None
    for b in label_blobs(sub, min_area=60):
        h, w = b["y1"] - b["y0"] + 1, b["x1"] - b["x0"] + 1
        if not (18 <= h <= 70 and 8 <= w <= 60):
            continue
        dx = abs((b["x0"] + x_from) - box["x0"])
        gap = box["y0"] - (b["y1"] + y_from)
        if dx > 40 or gap > 45 or gap < 0:
            continue
        score = dx + gap * 0.5
        if best is None or score < best[0]:
            best = (score, b)
    if best is None:
        return None, None
    b = best[1]
    crop = sub[b["y0"]:b["y1"] + 1, b["x0"]:b["x1"] + 1]
    bbox = {"y0": b["y0"] + y_from, "y1": b["y1"] + y_from,
            "x0": b["x0"] + x_from, "x1": b["x1"] + x_from}
    return crop, bbox


# ---------------------------------------------------------------- 主流程
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--png", required=True)
    ap.add_argument("--glyphs", default=os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "2026-10-20_s16_dev", "glyphs"))
    ap.add_argument("--n-samples", type=int, default=16,
                    help="样本数（L4：C 面板内组色块总数应等于它）")
    ap.add_argument("--json", default="")
    args = ap.parse_args()

    im, rgb = load_rgb(args.png)
    W, H = im.size
    print("image %s  %dx%d  dpi=%s" % (os.path.basename(args.png), W, H,
                                       im.info.get("dpi")))
    black = black_mask(rgb)
    rects, hl, vl = find_rects(black, W, H)
    panels = [b for b in rects if b["w"] >= 0.10 * W and b["h"] >= 0.10 * H]
    print("P1 矩形候选 %d 个（横线 %d / 竖线 %d）" % (len(rects), len(hl), len(vl)))
    for b in rects:
        print("     rect (%d,%d)-(%d,%d) %dx%d" % (b["x0"], b["y0"], b["x1"], b["y1"],
                                                   b["w"], b["h"]))
    if len(panels) != 4:
        print("FAIL P1 面板框数量 = %d（期望 4）" % len(panels))
        return 1
    names = {}
    left = sorted(panels, key=lambda d: d["x0"])[:2]
    right = sorted(panels, key=lambda d: d["x0"])[2:]
    for grp, tags in ((left, ("A", "B")), (right, ("C", "D"))):
        names[tags[0]] = min(grp, key=lambda d: d["y0"])
        names[tags[1]] = max(grp, key=lambda d: d["y0"])
    print("PASS P1 4 个面板框: " + "  ".join(
        "%s=(%d,%d)-(%d,%d)" % (k, v["x0"], v["y0"], v["x1"], v["y1"])
        for k, v in sorted(names.items())))

    fails = []
    glyphs = {}
    for path in sorted(glob.glob(os.path.join(args.glyphs, "*.png"))):
        ch, pt, weight = os.path.basename(path)[:-4].split("_")
        g = load_glyph(path)
        if g is not None:
            glyphs[(ch, int(pt), weight)] = g
    if not glyphs:
        print("FAIL 模板目录为空: %s" % args.glyphs)
        return 2

    # ---- G1 ----
    letters = {}
    for tag, box in sorted(names.items()):
        crop, bbox = find_letter(black, box)
        if crop is None:
            fails.append("P2 面板 %s 左上角外侧未找到字形" % tag)
            print("FAIL P2 %s: 未找到字形" % tag)
            continue
        scores = {}
        for key, tmpl in glyphs.items():
            scores[key] = iou_best(crop, tmpl)
        best = max(scores, key=scores.get)
        letters[tag] = {"bbox": bbox, "best": best, "iou": scores[best],
                        "crop_size": [int(crop.shape[0]), int(crop.shape[1])]}
        alt12n = scores.get((best[0], 12, "normal"), 0.0)
        alt10 = scores.get((best[0], 10, "bold"), 0.0)
        ok = (best[0] == tag and best[1] == 12 and best[2] == "bold"
              and scores[best] >= 0.80 and scores[best] > alt12n)
        print("%s P2/P3 面板 %s 字形: 匹配=%s %dpt %s IoU=%.3f | 同字 12normal=%.3f "
              "10bold=%.3f | 字形 %dx%dpx 位置(%d,%d) 框左上(%d,%d)"
              % ("PASS" if ok else "FAIL", tag, best[0], best[1], best[2],
                 scores[best], alt12n, alt10, crop.shape[0], crop.shape[1],
                 bbox["x0"], bbox["y1"], box["x0"], box["y0"]))
        if not ok:
            fails.append("P2/P3 面板 %s 字形不匹配（best=%s IoU=%.3f）"
                         % (tag, best, scores[best]))

    # ---- G2 ----
    def outside(blob, boxes):
        cy, cx = blob["cy"], blob["cx"]
        return not any(b["y0"] <= cy <= b["y1"] and b["x0"] <= cx <= b["x1"]
                       for b in boxes)

    case_b = [b for b in label_blobs(color_mask(rgb, CASE), 150)]
    ctrl_b = [b for b in label_blobs(color_mask(rgb, CTRL), 150)]
    out_case = [b for b in case_b if outside(b, panels)]
    out_ctrl = [b for b in ctrl_b if outside(b, panels)]
    max_bot = max(b["y1"] for b in panels)
    print("L1 组色块: case 共%d(框外%d) ctrl 共%d(框外%d)"
          % (len(case_b), len(out_case), len(ctrl_b), len(out_ctrl)))
    l1 = (len(out_case) == 1 and len(out_ctrl) == 1
          and all(b["y0"] >= max_bot for b in out_case + out_ctrl))
    if l1:
        mid = (out_case[0]["cx"] + out_ctrl[0]["cx"]) / 2.0
        l1 = abs(mid - W / 2.0) <= 0.06 * W
        print("L1 图例中点 x=%.0f 图宽中线=%.0f 偏差=%.1f%%"
              % (mid, W / 2.0, abs(mid - W / 2.0) / W * 100))
    print("%s L1 框外组色块恰好 2 个(各1)且在图组下方居中" % ("PASS" if l1 else "FAIL"))
    if not l1:
        fails.append("L1 共享图例色块判定失败")

    l2 = False
    if l1:
        leg = out_case + out_ctrl
        top = min(b["y0"] for b in leg)
        x0 = min(b["x0"] for b in leg)
        x1 = max(b["x1"] for b in leg)
        title_ink = int(black[max(0, top - 70):max(0, top - 4), x0:x1 + 200].sum())
        label_ink = sum(int(black[b["y0"] - 6:b["y1"] + 6, b["x1"] + 4:b["x1"] + 60].sum())
                        for b in leg)
        l2 = title_ink >= 50 and label_ink >= 50
        print("L2 图例标题墨迹=%d px（上方 4..70px），条目文字墨迹=%d px（右侧 4..60px）"
              % (title_ink, label_ink))
    print("%s L2 图例带语义标题 + 条目文字（不是只有色块）" % ("PASS" if l2 else "FAIL"))
    if not l2:
        fails.append("L2 图例标题/条目文字判定失败")

    ud_blobs = []
    for name, col, amin in (("up", UP, 40), ("down", DOWN, 40), ("ns", NS, 40)):
        blobs = [b for b in label_blobs(color_mask(rgb, col), amin) if outside(b, panels)]
        ud_blobs.append((name, blobs))
    counts = {n: len(b) for n, b in ud_blobs}
    allud = [b for _, bs in ud_blobs for b in bs]
    a_box, b_box = names.get("A"), names.get("B")
    in_gap = [b for b in allud
              if a_box and b_box and a_box["x0"] - 10 <= b["cx"] <= a_box["x1"] + 10
              and a_box["y1"] < b["cy"] < b_box["y0"]]
    l3 = (counts.get("up") == 1 and counts.get("down") == 1 and counts.get("ns") == 1
          and len(in_gap) == len(allud) and len(allud) == 3)
    print("L3 框外 up/down/NS 色块数=%s，落在 A-B 间隙内的=%d/%d"
          % (counts, len(in_gap), len(allud)))
    print("%s L3 up/down/NS 图例全图组只画一次（位于 A 下方间隙）" % ("PASS" if l3 else "FAIL"))
    if not l3:
        fails.append("L3 up/down/NS 图例次数/位置判定失败")

    in_panel = {}
    for tag, box in sorted(names.items()):
        cs = [b for b in case_b if box["x0"] <= b["cx"] <= box["x1"]
              and box["y0"] <= b["cy"] <= box["y1"]]
        ct = [b for b in ctrl_b if box["x0"] <= b["cx"] <= box["x1"]
              and box["y0"] <= b["cy"] <= box["y1"]]
        in_panel[tag] = (len(cs), len(ct))
        print("L4 面板 %s 内 case/ctrl 色块数=%d/%d" % (tag, len(cs), len(ct)))
    l4 = (sum(in_panel["C"]) == args.n_samples
          and in_panel["A"] == (0, 0) and in_panel["B"] == (0, 0)
          and in_panel["D"] == (0, 0))
    print("%s L4 C 内组色块总数=%d（应=%d；重复画一次图例会多 2 个）；A/B/D 内=%s"
          % ("PASS" if l4 else "FAIL", sum(in_panel["C"]), args.n_samples,
             {k: in_panel[k] for k in ("A", "B", "D")}))
    if not l4:
        fails.append("L4 面板内组色块计数不符（疑似重复图例）")

    # ---- 内容交叉核对 ----
    dbox = names["D"]
    cb = find_colorbar(vl, black, rgb, max(b["h"] for b in panels), dbox)
    x1 = bool(cb and 0 <= cb["x0"] - dbox["x1"] <= 200)
    print("%s X1 色条=%s；D 面板右边 x=%d"
          % ("PASS" if x1 else "FAIL", cb, dbox["x1"]))
    if not x1:
        fails.append("X1 色条与 D 面板位置关系不符")

    def big_in(box, blobs):
        return [b for b in blobs if box["x0"] <= b["cx"] <= box["x1"]
                and box["y0"] <= b["cy"] <= box["y1"] and b["area"] >= 300]

    cbox = names.get("C")
    x2 = bool(cbox and len(big_in(cbox, case_b)) >= 3 and len(big_in(cbox, ctrl_b)) >= 3)
    print("%s X2 C 面板内有 >=3 个 case + >=3 个 ctrl 大色块（s=60 散点）: %d/%d"
          % ("PASS" if x2 else "FAIL",
             len(big_in(cbox, case_b)) if cbox else 0,
             len(big_in(cbox, ctrl_b)) if cbox else 0))
    if not x2:
        fails.append("X2 C 面板散点判定失败")

    def full_lines(box):
        out = []
        for y in range(box["y0"] + 3, box["y1"] - 2):
            if longest_run(black[y, box["x0"] + 3:box["x1"] - 2]) >= 0.9 * (box["w"] - 5):
                out.append(y)
        return group_lines(out)

    fl_a = full_lines(names["A"]) if names.get("A") else []
    fl_b = full_lines(names["B"]) if names.get("B") else []
    x3 = len(fl_a) == 0 and len(fl_b) >= 1
    print("%s X3 贯通全宽实线：A=%d 条（火山图阈值线全是虚线→0），B=%d 条（MA 的 log2FC=0）"
          % ("PASS" if x3 else "FAIL", len(fl_a), len(fl_b)))
    if not x3:
        fails.append("X3 A/B 面板内容区分失败")

    def ink_centroid(box):
        m = np.zeros_like(black)
        for col in (UP, DOWN, NS):
            m |= color_mask(rgb, col)
        sub = m[box["y0"]:box["y1"], box["x0"]:box["x1"]]
        ys, xs = np.nonzero(sub)
        if ys.size == 0:
            return None
        return float(ys.mean() / max(1, box["h"]))

    ca = ink_centroid(names["A"]) if names.get("A") else None
    cb2 = ink_centroid(names["B"]) if names.get("B") else None
    x4 = ca is not None and cb2 is not None and ca > 0.60 and 0.30 <= cb2 <= 0.70
    print("%s X4 分类色墨迹垂直重心：A=%.2f（贴底 >0.60） B=%.2f（中部 0.30..0.70）"
          % ("PASS" if x4 else "FAIL", ca or -1, cb2 or -1))
    if not x4:
        fails.append("X4 A/B 点云分布区分失败")

    summary = {
        "png": os.path.abspath(args.png), "size": [W, H],
        "dpi": im.info.get("dpi"),
        "panels": {k: {kk: int(vv) for kk, vv in v.items()} for k, v in names.items()},
        "colorbar": cb,
        "letters": letters,
        "G1_P1": True, "G1_P2_P3": not any(f.startswith("P2") for f in fails),
        "G2_L1": l1, "G2_L2": l2, "G2_L3": l3, "G2_L4": l4,
        "X1": x1, "X2": x2, "X3": x3, "X4": x4,
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
