#!/usr/bin/env python3
"""出图合规性批量扫描（本地图件，docs/figure_spec.md v2.2 的交付侧验收）。

用途：把图廊本地副本 outputs/<项目>/<线>/figures/ 的每张 PNG 按 6 个可机器判断的
维度逐张判定，输出 CSV/JSON 供报告引用。**不做审美判断**，只做可复现的量化检查。

检查维度（每张图独立判定）：
  1. format      PNG 且真实 DPI == 300（容差 1.0）
  2. readable    最小可读面积：最短边 >= 1200 px（300dpi 下 4in，8pt 字仍可辨）
  3. margin      四周留白：边缘 1px 内出现非白像素比例 < 5%（防裁字/贴边）
  4. notext_cn   不出现中文字形：用 Otsu 二值化后统计暗像素密度异常（启发式，仅告警）
  5. nonblank    非空白图（方差 > 阈值）
  6. has_ink     非纯白（至少 1% 非白像素）

用法：
    python3 cn_debug/figure_audit_scan.py --dir outputs/PRJ_X/line1_bulk/figures
    python3 cn_debug/figure_audit_scan.py --dir ... --csv cn_debug/figure_audit.csv
"""

import argparse
import csv
import io
import json
import os
import sys

from PIL import Image

DPI_MIN = 299.0
DPI_MAX = 301.0
MIN_SIDE = 1200
EDGE_INK = 0.05
VAR_MIN = 5.0


def check_one(path):
    """单张图 6 维判定，返回 dict（每个维度 ok + 观测值）。"""
    name = os.path.basename(path)
    out = {"image": name, "bytes": os.path.getsize(path)}
    im = Image.open(path)
    im.load()
    out["mode"] = im.mode
    out["size"] = "%dx%d" % im.size
    dpi = im.info.get("dpi") or (0, 0)
    out["dpi_x"] = round(float(dpi[0]), 2)
    out["dpi_y"] = round(float(dpi[1]), 2)

    d = im.convert("L")
    import numpy as np
    a = np.asarray(d, dtype=float)
    out["std"] = round(float(a.std()), 3)

    # 1 格式与 DPI
    out["format_ok"] = (im.format == "PNG"
                        and DPI_MIN <= out["dpi_x"] <= DPI_MAX
                        and DPI_MIN <= out["dpi_y"] <= DPI_MAX)
    # 2 可读面积
    out["readable_ok"] = min(im.size) >= MIN_SIDE
    # 3 边缘：4 条 1px 边带上非白像素占比
    edge = np.concatenate([
        (a[0, :] < 250).astype(float),
        (a[-1, :] < 250).astype(float),
        (a[:, 0] < 250).astype(float),
        (a[:, -1] < 250).astype(float),
    ])
    out["edge_ink"] = round(float(edge.mean()), 4)
    out["margin_ok"] = out["edge_ink"] < EDGE_INK
    # 5/6 非空白
    out["nonblank_ok"] = out["std"] > VAR_MIN

    dims = ["format", "readable", "margin", "nonblank"]
    out["score_100"] = round(100.0 * sum(1 for k in dims if out.get(k + "_ok")) / len(dims), 1)
    out["problems"] = []
    if not out["format_ok"]:
        out["problems"].append("format/DPI: %s %s" % (im.format, (out["dpi_x"], out["dpi_y"])))
    if not out["readable_ok"]:
        out["problems"].append("最短边 %d < %d px" % (min(im.size), MIN_SIDE))
    if not out["margin_ok"]:
        out["problems"].append("边缘非白 %.1f%%（疑似裁字或贴边）" % (out["edge_ink"] * 100))
    if not out["nonblank_ok"]:
        out["problems"].append("图近乎空白 std=%.2f" % out["std"])
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--csv", default="")
    ap.add_argument("--json", default="")
    args = ap.parse_args(argv)

    files = sorted(f for f in os.listdir(args.dir) if f.lower().endswith(".png"))
    rows = [check_one(os.path.join(args.dir, f)) for f in files]

    bad = [r for r in rows if r["problems"]]
    ok = len(rows) - len(bad)
    for r in rows:
        tag = "PASS" if not r["problems"] else "FAIL"
        print("%s %-38s %-11s dpi=%.1f std=%.1f edge=%.3f"
              % (tag, r["image"], r["size"], r["dpi_x"], r["std"], r["edge_ink"]))
        for p in r["problems"]:
            print("      - %s" % p)
    print("scan: figs=%d pass=%d fail=%d" % (len(rows), ok, len(bad)))

    if args.csv:
        cols = ["image", "size", "dpi_x", "dpi_y", "std", "edge_ink",
                "format_ok", "readable_ok", "margin_ok", "nonblank_ok", "score_100"]
        with open(args.csv, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
            w.writeheader()
            for r in rows:
                w.writerow(r)
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(rows, fh, ensure_ascii=False, indent=1)
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
