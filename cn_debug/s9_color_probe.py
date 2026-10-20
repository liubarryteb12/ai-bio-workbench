#!/usr/bin/env python3
"""S9 颜色正确性探针：从重渲染后的图件里取像素，验证二分类标准色真的落到图上。

判据（docs/figure_spec.md §三 / §八.5）：
  case = #EE0000 (238,0,0)   ctrl = #3B4992 (59,73,146)
同时验证旧色 #C44E52 (196,78,82) / #4C72B0 (76,114,176) 已从这些图里消失。

用法：python cn_debug/s9_color_probe.py [图目录]
退出码：0 = 全部断言通过；1 = 有断言失败
"""
import os
import sys
import warnings

from PIL import Image

warnings.filterwarnings("ignore", category=DeprecationWarning)  # Pillow 14 前 getdata 仍可用

CASE = (238, 0, 0)
CTRL = (59, 73, 146)
OLD_CASE = (196, 78, 82)
OLD_CTRL = (76, 114, 176)
MIN_PIXELS = 20   # 至少这么多个纯色像素才认定"这个颜色真的被画上去了"


def count_exact(img, rgb):
    return sum(1 for px in img.getdata() if px[:3] == rgb)


def main():
    fig_dir = sys.argv[1] if len(sys.argv) > 1 else \
        os.path.join("outputs", "PRJ_E2E_GSE277173", "line1_bulk", "figures")
    targets = ["l1_02_pca.png", "l1_05a_genes_detected.png", "l1_05b_within_group_cor.png"]
    ok = True
    for name in targets:
        path = os.path.join(fig_dir, name)
        if not os.path.exists(path):
            print("FAIL %s 不存在" % path)
            ok = False
            continue
        img = Image.open(path).convert("RGB")
        n_case = count_exact(img, CASE)
        n_ctrl = count_exact(img, CTRL)
        n_old_case = count_exact(img, OLD_CASE)
        n_old_ctrl = count_exact(img, OLD_CTRL)
        verdict = (n_case >= MIN_PIXELS and n_ctrl >= MIN_PIXELS
                   and n_old_case == 0 and n_old_ctrl == 0)
        ok = ok and verdict
        print("%s %-28s size=%dx%d case#EE0000=%d ctrl#3B4992=%d "
              "old#C44E52=%d old#4C72B0=%d"
              % ("PASS" if verdict else "FAIL", name, img.width, img.height,
                 n_case, n_ctrl, n_old_case, n_old_ctrl))
    print("color_probe: %s" % ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
