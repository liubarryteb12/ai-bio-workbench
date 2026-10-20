#!/usr/bin/env python3
"""探针3：scTenifoldpy import 失败的具体错误。"""
import traceback

try:
    import scTenifoldpy
    print("import OK:", scTenifoldpy.__file__)
except Exception as e:
    print("import FAIL:", type(e).__name__, str(e)[:300])
    print("--- traceback ---")
    traceback.print_exc()

import os
print()
print("== 包目录检查 ==")
import site
for sp in site.getsitepackages():
    cand = os.path.join(sp, "scTenifoldpy")
    if os.path.isdir(cand):
        print("dir:", cand)
        for f in sorted(os.listdir(cand)):
            print("   ", f)
        break
else:
    print("scTenifoldpy 目录不存在于 site-packages")
    # 查 dist-info
    for sp in site.getsitepackages():
        for d in os.listdir(sp):
            if "enifold" in d.lower():
                print("found:", d)
