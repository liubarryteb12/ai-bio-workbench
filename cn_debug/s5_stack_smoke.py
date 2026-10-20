#!/usr/bin/env python3
"""pyscenic 安装后核心栈冒烟（确认未破坏既有分析依赖）。"""
import importlib

mods = ["scanpy", "anndata", "liana", "scTenifold", "gseapy", "pyscenic",
        "arboreto", "ctxcore", "dask", "pyarrow", "loompy", "numpy", "pandas",
        "scipy", "sklearn", "matplotlib", "harmonypy"]
for m in mods:
    try:
        mod = importlib.import_module(m)
        v = getattr(mod, "__version__", "?")
        print("OK   %-12s %s" % (m, v))
    except Exception as e:
        print("FAIL %-12s %s" % (m, str(e)[:80]))
