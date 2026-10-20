#!/usr/bin/env python3
"""探针2：容器真实敲除工具盘点 + scTenifoldpy 到底有没有。"""
import importlib.util
import subprocess
import sys

CANDIDATES = [
    "scTenifoldpy", "scTenifoldKnk", "tenifoldknk",
    "celloracle", "genformer", "gseapy",
    "sklearn", "torch", "tensorflow",
    "scanpy", "anndata", "numba",
]
print("== import 探针 ==")
for m in CANDIDATES:
    spec = importlib.util.find_spec(m)
    print("%-14s %s" % (m, spec.origin if spec else "ABSENT"))

print()
print("== pip list  grep 相关 ==")
out = subprocess.run([sys.executable, "-m", "pip", "list"],
                     capture_output=True, text=True)
for line in out.stdout.splitlines():
    low = line.lower()
    if any(k in low for k in ["tenif", "knk", "oracle", "genformer",
                              "torch", "tensorflow", "numba", "scanpy",
                              "liana", "scikit", "cellrank"]):
        print("  ", line.strip())
