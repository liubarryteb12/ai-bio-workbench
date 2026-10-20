#!/usr/bin/env python3
"""S16：把 l1_32_deg_overview 的几何审计判决合并进 cn_debug/figure_audit_all.csv。

只做一件事：新增 l1_32 一行（verdict/violations 取自远端 audit_figure_layout --csv 的原文），
既有行一行不动（合并后逐行 diff 证明只多一行）。先备份，重复执行幂等。
"""

import csv
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALL = os.path.join(ROOT, "cn_debug", "figure_audit_all.csv")
SRC = os.path.join(ROOT, "cn_debug", "2026-10-20_s16_dev", "s16_audit_bulk.csv")
TARGET = "l1_32_deg_overview.png"
SOURCE_TAG = "S16_audit_20261013"


def main():
    with open(SRC, encoding="utf-8") as fh:
        rows = {r["figure"]: r for r in csv.DictReader(fh)}
    if TARGET not in rows:
        print("FAIL 审计 CSV 里没有 %s" % TARGET)
        return 1
    hit = rows[TARGET]
    print("审计原文: %s verdict=%s violations=%r"
          % (TARGET, hit["verdict"], hit["violations"]))

    with open(ALL, encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        fieldnames = reader.fieldnames
        existing = list(reader)
    print("合并前 %d 行，字段=%s" % (len(existing), fieldnames))

    if any(r["figure"] == TARGET for r in existing):
        print("已存在 %s，无需新增（幂等）" % TARGET)
        return 0

    backup = os.path.join(os.path.dirname(SRC), "figure_audit_all.csv.before_s16")
    if not os.path.exists(backup):
        shutil.copy2(ALL, backup)
        print("备份 -> %s" % backup)

    row = {k: "" for k in fieldnames}
    row["figure"] = TARGET
    row["verdict"] = hit["verdict"]
    row["violations"] = hit["violations"]
    if "source" in fieldnames:
        row["source"] = SOURCE_TAG
    existing.append(row)

    with open(ALL, "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fieldnames)
        w.writeheader()
        for r in existing:
            w.writerow(r)
    print("合并后 %d 行（+1）" % len(existing))
    return 0


if __name__ == "__main__":
    sys.exit(main())
