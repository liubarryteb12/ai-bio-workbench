#!/usr/bin/env python3
"""探针4：scTenifold 目录内容与 API 入口。"""
import os
import importlib.util

print("== import scTenifold ==")
try:
    import scTenifold as tf
    print("OK:", tf.__file__)
    print("attrs:", [a for a in dir(tf) if not a.startswith("_")][:20])
    from scTenifold.data_generator import generate_synthetic_data
    print("generate_synthetic_data OK")
    import inspect
    print(inspect.signature(generate_synthetic_data))
except Exception as e:
    print("FAIL:", type(e).__name__, str(e)[:200])

print()
print("== 目录内容 ==")
import site
for sp in site.getsitepackages():
    cand = os.path.join(sp, "scTenifold")
    if os.path.isdir(cand):
        print("dir:", cand)
        for f in sorted(os.listdir(cand)):
            full = os.path.join(cand, f)
            kind = "d" if os.path.isdir(full) else "f"
            print("   [%s] %s" % (kind, f))
        break

print()
print("== dist-info RECORD 关键行 ==")
for sp in site.getsitepackages():
    di = os.path.join(sp, "sctenifoldpy-0.5.1.dist-info")
    if os.path.isdir(di):
        for f in sorted(os.listdir(di)):
            print("   ", f)
        top = os.path.join(di, "top_level.txt")
        if os.path.exists(top):
            print("top_level.txt:", open(top).read().strip())
