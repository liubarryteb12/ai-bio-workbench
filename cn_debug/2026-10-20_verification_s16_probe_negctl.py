#!/usr/bin/env python3
"""S16 G1/G2 探针的负对照：证明探针不是"怎么都 PASS"。

做法：在成品 PNG 的副本上做两处定向破坏，再跑同一个探针，必须判 FAIL。
  neg1：把面板 C 的字母涂白（G1 应该红）
  neg2：在面板 D 里贴一对 case/ctrl 色块（模拟"面板内重复图例"，G2 L4 应该红）
原始图不动，破坏副本写在 --out-dir。

用法：python 2026-10-20_verification_s16_probe_negctl.py --png <成品图> [--out-dir <目录>]
退出码：0 = 两条负对照都按预期 FAIL；1 = 探针对破坏不敏感（探针无效）
"""

import argparse
import json
import os
import subprocess
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
PROBE = os.path.join(HERE, "2026-10-20_verification_s16_g1g2.py")


def run_probe(png):
    proc = subprocess.run([sys.executable, PROBE, "--png", png],
                          capture_output=True, text=True)
    return proc.returncode, proc.stdout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--png", required=True)
    ap.add_argument("--out-dir", default=os.path.join(HERE, "2026-10-20_s16_dev"))
    ap.add_argument("--json", default=os.path.join(HERE, "2026-10-20_s16_dev",
                                                   "g1g2_dev1.json"),
                    help="成品图探针 JSON（取面板框与字形位置用）")
    args = ap.parse_args()
    os.makedirs(args.out_dir, exist_ok=True)

    with open(args.json, encoding="utf-8") as fh:
        info = json.load(fh)
    panels = info["panels"]
    letter_c = info["letters"]["C"]["bbox"]

    rc0, out0 = run_probe(args.png)
    print("基准图 rc=%d（应 0）" % rc0)
    if rc0 != 0:
        print("基准图本身没 PASS，先修图再谈负对照")
        return 1

    # neg1：涂白面板 C 的字母
    im = Image.open(args.png).convert("RGB")
    d = ImageDraw.Draw(im)
    d.rectangle([letter_c["x0"] - 6, letter_c["y0"] - 6,
                 letter_c["x1"] + 6, letter_c["y1"] + 6], fill=(255, 255, 255))
    p1 = os.path.join(args.out_dir, "l1_32_neg1_no_letter_c.png")
    im.save(p1, dpi=(300, 300))

    # neg2：在面板 D 里贴一对组色块（模拟面板内重复图例）
    im = Image.open(args.png).convert("RGB")
    d = ImageDraw.Draw(im)
    box = panels["D"]
    cx = box["x0"] + (box["x1"] - box["x0"]) // 2
    cy = box["y0"] + (box["y1"] - box["y0"]) // 2
    d.rectangle([cx, cy, cx + 30, cy + 30], fill=(238, 0, 0))
    d.rectangle([cx + 70, cy, cx + 100, cy + 30], fill=(59, 73, 146))
    p2 = os.path.join(args.out_dir, "l1_32_neg2_dup_legend.png")
    im.save(p2, dpi=(300, 300))

    ok = True
    for tag, path, expect in (("neg1 涂白字母 C", p1, "P2/P3"),
                              ("neg2 D 面板内贴组色块", p2, "L4")):
        rc, out = run_probe(path)
        hit = [ln for ln in out.splitlines() if ln.startswith("FAIL")]
        print("\n=== %s ===\nrc=%d（应 1）\n%s" % (tag, rc, "\n".join(hit[:6])))
        good = rc == 1 and any(expect.split("/")[0] in ln for ln in hit)
        print("%s 负对照：%s" % ("PASS" if good else "FAIL", tag))
        ok = ok and good
    print("\nnegctl: %s" % ("PASS 两条负对照都按预期变红" if ok else "FAIL 探针对破坏不敏感"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
