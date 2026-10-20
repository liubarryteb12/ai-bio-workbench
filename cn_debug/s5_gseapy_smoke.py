#!/usr/bin/env python3
"""gseapy 安装后冒烟 + 核心栈未破坏验证。"""
import importlib

mods = ["gseapy", "scanpy", "anndata", "liana", "scTenifold", "pandas", "numpy",
        "scipy", "matplotlib", "harmonypy"]
for m in mods:
    try:
        mod = importlib.import_module(m)
        print("OK   %-12s %s" % (m, getattr(mod, "__version__", "?")))
    except Exception as e:
        print("FAIL %-12s %s" % (m, e))

# gseapy 关键 API
from gseapy import enrichr, gsea
print("gseapy API: enrichr/gsea importable")
