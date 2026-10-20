#!/usr/bin/env python3
"""S16 G1 探针（第 1 段，跑在算力端）：渲染 A/B/C/D 的参考字形模板。

为什么要模板：本地 Windows 没有 matplotlib，无法本地渲染参考字形；G1 要求验证
"面板编号 A/B/C/D 存在且是 bold、>=10pt"，只能拿同一台机器、同一后端、同一 dpi
渲出的参考字形去和成品 PNG 做模板匹配。模板与成品同环境，字号/字重/抗锯齿可比。

输出：<out>/<char>_<pt>_<weight>.png（白底，字形墨迹已裁边）
用法：python3 2026-10-20_verification_s16_glyphs.py <out_dir>
"""

import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

CHARS = "ABCD"
# 12pt bold 是成品实际用的规格；10pt bold 与 12pt normal 作为对照（证明"更大字号"与
# "非 bold"都匹配不上，从而把 bold + >=10pt 这条变成可判定的量）。
VARIANTS = [(12, "bold"), (10, "bold"), (12, "normal")]


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/s16_dev_a/glyphs"
    os.makedirs(out, exist_ok=True)
    plt.rcParams["figure.dpi"] = 300
    for pt, weight in VARIANTS:
        for ch in CHARS:
            fig = plt.figure(figsize=(0.7, 0.6), dpi=300)
            fig.text(0.08, 0.5, ch, fontsize=pt, fontweight=weight,
                     va="center", ha="left", color="black")
            path = os.path.join(out, "%s_%d_%s.png" % (ch, pt, weight))
            fig.savefig(path, dpi=300, facecolor="white", bbox_inches="tight",
                        pad_inches=0.02)
            plt.close(fig)
            print("glyph %s %dpt %s -> %s" % (ch, pt, weight, path))


if __name__ == "__main__":
    main()
