#!/usr/bin/env python3
"""S16：从 figure_score 的 --json 输出里打印指定图的逐项判决（C1/C2 是否命中要看得见）。"""

import json
import sys

path = sys.argv[1]
target = sys.argv[2] if len(sys.argv) > 2 else "l1_32_deg_overview.png"
rows = json.load(open(path, encoding="utf-8"))
if isinstance(rows, dict):
    rows = rows.get("figures") or rows.get("rows") or []
for r in rows:
    if r.get("image") == target:
        print("image   =", r.get("image"))
        print("verdict =", r.get("verdict"), " score =", r.get("score"))
        print("items   =", json.dumps(r.get("items"), ensure_ascii=False, sort_keys=True))
        print("missing =", r.get("missing"), " veto =", r.get("veto"))
        print("C1 caption 登记 =", r["items"].get("C1"), " C2 命名合规 =", r["items"].get("C2"))
        break
else:
    print("未找到 %s（JSON 顶层类型 %s）" % (target, type(rows).__name__))
    sys.exit(1)
