"""成品图比例尺物理长度独立量测（不读被检代码的任何自证）。

原理：Visium 六角晶格相邻 spot 间距恒为 100 µm，是图上唯一的绝对长度基准。
两条独立链路互相印证：
  1. 比例尺长度取两条端刻度中心之间的距离（避开线宽与抗锯齿的像素晕）。
  2. 晶格 pitch 由点云 x 投影自相关的第一个峰给出；六角晶格沿 x 的投影周期
     是 pitch*cos(30°)，必须除以 cos30° 才是真实 pitch。

第 73 轮踩坑记录：第一版直接用横线暗段长度（133px，含抗锯齿晕）当条长，
又把投影周期 22px 当成真实 pitch，于是算出「500um 只有 470um」的假缺陷。
改用端刻度中心（128.0px）与投影周期折算（25.40px）后，实测 503.9um。
"""
import sys
import numpy as np
from PIL import Image


def measure(png):
    a = np.asarray(Image.open(png).convert("L")).astype(float)
    h, w = a.shape
    dark = a < 100
    cols = dark.sum(axis=0)
    rows = dark.sum(axis=1)
    fc = np.flatnonzero(cols > 0.6 * h)
    fr = np.flatnonzero(rows > 0.6 * w)
    xL, xR = int(fc[0]), int(fc[-1])
    yT, yB = int(fr[0]), int(fr[-1])

    bar_y = None
    bar_x0 = bar_x1 = 0
    for y in range(yT + 5, yB - 3):
        idx = np.flatnonzero(np.diff(np.concatenate(([0], dark[y, xL + 3:xR - 3].view(np.int8), [0]))))
        if idx.size < 2:
            continue
        s, e = idx[0::2], idx[1::2]
        L = e - s
        k = int(np.argmax(L))
        if 80 < L[k] < 0.6 * (xR - xL):
            bar_y = y
            bar_x0 = int(s[k]) + xL + 3
            bar_x1 = int(e[k]) + xL + 3
            break
    if bar_y is None:
        raise SystemExit("NO_SCALEBAR")

    band = dark[bar_y - 14:bar_y - 4, max(bar_x0 - 6, 0):min(bar_x1 + 7, w)]
    colhas = band.sum(axis=0) >= 4
    xs = np.flatnonzero(colhas) + max(bar_x0 - 6, 0)
    groups = []
    cur = [int(xs[0])] if xs.size else []
    for v in xs[1:]:
        if int(v) - cur[-1] <= 2:
            cur.append(int(v))
        else:
            groups.append(cur)
            cur = [int(v)]
    if cur:
        groups.append(cur)
    centers = [float(np.mean(g)) for g in groups]
    if len(centers) < 2:
        raise SystemExit("NO_TICKS")
    bar_px = centers[-1] - centers[0]

    inner = a[yT + 4:yB - 4, xL + 4:xR - 4]
    mask = inner < 230
    ys, xs2 = np.nonzero(mask)
    keep = (ys > np.percentile(ys, 1)) & (ys < np.percentile(ys, 99))
    ys, xs2 = ys[keep], xs2[keep]
    proj = np.zeros(inner.shape[1])
    np.add.at(proj, xs2, 1)
    proj = proj - proj.mean()
    ac = np.correlate(proj, proj, mode="full")[len(proj) - 1:]
    ac = ac / ac[0]
    best = None
    for k in range(11, 79):
        if ac[k] > ac[k - 1] and ac[k] > ac[k + 1]:
            if best is None or ac[k] > ac[best]:
                best = k
    if best is None:
        raise SystemExit("NO_LATTICE")
    # 峰值整数分辨率只有 ±1px，折算到 pitch 是 ±4%，会把 500um 量成 511。
    # 用抛物线插值取亚像素峰位，把量测噪声压到 1% 以内。
    if 0 < best < len(ac) - 1:
        y0, y1, y2 = float(ac[best - 1]), float(ac[best]), float(ac[best + 1])
        denom = y0 - 2.0 * y1 + y2
        delta = 0.5 * (y0 - y2) / denom if abs(denom) > 1e-12 else 0.0
    else:
        delta = 0.0
    proj_period_px = float(best) + float(delta)
    pitch_px = proj_period_px / np.cos(np.deg2rad(30.0))
    bar_um = bar_px / pitch_px * 100.0
    return bar_px, proj_period_px, pitch_px, bar_um


if __name__ == "__main__":
    png = sys.argv[1]
    bar_px, proj_px, pitch_px, bar_um = measure(png)
    print("BAR_PX=%.1f" % bar_px)
    print("PROJ_PERIOD_PX=%.1f" % proj_px)
    print("PITCH_PX=%.2f" % pitch_px)
    print("BAR_UM=%.1f" % bar_um)
    print("LABEL_UM=500")
