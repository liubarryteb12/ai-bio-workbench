#!/usr/bin/env python3
"""S18R G1/G2 探针的负对照：证明探针不是"怎么都 PASS"。

做法：在成品 PNG 的副本上做三处定向破坏，再跑同一个探针，必须判 FAIL。
  neg1：把面板 B 的字母涂白（G1 应红：P2/P3）
  neg2：在面板 C 里贴 4 个"图例同几何"色块（模拟面板内重复图例，G2 应红：L4）
  neg3：在 A/B 与 C 之间的间隙贴同几何色块（模拟图组里第二份图例，G2 应红：L3）
原始图不动，破坏副本写在 --out-dir。

用法：python 2026-10-20_verification_s18r_probe_negctl.py --png <成品图> \
        --json <探针 JSON> [--n-domains 57|18] [--n-domains-a 5|3] [--n-samples 10|5]
退出码：0 = 三条负对照都按预期 FAIL；1 = 探针对破坏不敏感（探针无效）
"""

import argparse
import json
import os
import subprocess
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
PROBE = os.path.join(HERE, "2026-10-20_verification_s18r_g1g2.py")


def run_probe(png, extra):
    proc = subprocess.run([sys.executable, PROBE, "--png", png] + extra,
                          capture_output=True, text=True)
    return proc.returncode, proc.stdout


def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--png", required=True)
    ap.add_argument("--json", required=True, help="基准图探针 JSON（取面板框/字形/图例几何）")
    ap.add_argument("--n-domains", type=int, required=True)
    ap.add_argument("--n-domains-a", type=int, required=True)
    ap.add_argument("--n-samples", type=int, required=True)
    ap.add_argument("--out-dir", default=os.path.join(HERE, "2026-10-20_s18r_dev"))
    args = ap.parse_args()
    os.makedirs(args.out_dir, exist_ok=True)
    extra = ["--n-domains", str(args.n_domains), "--n-domains-a", str(args.n_domains_a),
             "--n-samples", str(args.n_samples)]

    with open(args.json, encoding="utf-8") as fh:
        info = json.load(fh)
    panels = info["panels"]
    letter_b = info["letters"]["B"]["bbox"]
    legend_colors = [hex2rgb(c) for c in info["legend_colors"]]
    geom = info["swatch_geom"]
    sw_w, sw_h = int(round(geom["med_w"])), int(round(geom["med_h"]))

    rc0, out0 = run_probe(args.png, extra)
    print("基准图 rc=%d（应 0）" % rc0)
    if rc0 != 0:
        print("基准图本身没 PASS，先修图再谈负对照")
        return 1

    # neg1：涂白面板 B 的字母
    im = Image.open(args.png).convert("RGB")
    d = ImageDraw.Draw(im)
    d.rectangle([letter_b["x0"] - 6, letter_b["y0"] - 6,
                 letter_b["x1"] + 6, letter_b["y1"] + 6], fill=(255, 255, 255))
    p1 = os.path.join(args.out_dir, "neg1_no_letter_b.png")
    im.save(p1, dpi=(300, 300))

    # neg2：面板 C 内贴 4 个图例同几何色块（模拟面板内重复图例）
    im = Image.open(args.png).convert("RGB")
    d = ImageDraw.Draw(im)
    box = panels["C"]
    cx = box["x0"] + (box["x1"] - box["x0"]) // 3
    cy = box["y0"] + (box["y1"] - box["y0"]) // 2
    for k in range(4):
        x = cx + k * (sw_w + 30)
        d.rectangle([x, cy, x + sw_w, cy + sw_h], fill=legend_colors[k])
    p2 = os.path.join(args.out_dir, "neg2_dup_legend_in_c.png")
    im.save(p2, dpi=(300, 300))

    # neg3：A/B 与 C 之间的间隙贴同几何色块（模拟图组内第二份图例）
    im = Image.open(args.png).convert("RGB")
    d = ImageDraw.Draw(im)
    gy = panels["A"]["y1"] + 40
    gx = panels["A"]["x0"] + 60
    for k in range(4):
        x = gx + k * (sw_w + 30)
        d.rectangle([x, gy, x + sw_w, gy + sw_h], fill=legend_colors[k])
    p3 = os.path.join(args.out_dir, "neg3_dup_legend_in_gap.png")
    im.save(p3, dpi=(300, 300))

    ok = True
    for tag, path, expect in (("neg1 涂白字母 B", p1, "P2/P3"),
                              ("neg2 C 面板内贴图例色块", p2, "L4"),
                              ("neg3 A/B-C 间隙贴图例色块", p3, "L3")):
        rc, out = run_probe(path, extra)
        hit = [ln for ln in out.splitlines() if ln.startswith("FAIL")]
        print("\n=== %s ===\nrc=%d（应 1）\n%s" % (tag, rc, "\n".join(hit[:6])))
        good = rc == 1 and any(expect.split("/")[0] in ln for ln in hit)
        print("%s 负对照：%s" % ("PASS" if good else "FAIL", tag))
        ok = ok and good
    print("\nnegctl: %s" % ("PASS 三条负对照都按预期变红" if ok else "FAIL 探针对破坏不敏感"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
