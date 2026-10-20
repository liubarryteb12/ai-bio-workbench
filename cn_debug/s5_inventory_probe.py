#!/usr/bin/env python3
"""盘点探针：容器内已装库与 line2/line3 产物盘点（只读）。"""
import importlib.util as u
import os

mods = ["scvelo", "cell2location", "scvi", "squidpy", "tangram", "destvi",
        "scanpy", "seaborn", "matplotlib", "liana", "scTenifold", "harmonypy",
        "scrublet", "scanorama", "gseapy", "pydot", "networkx"]
for m in mods:
    print("MOD %-14s %s" % (m, "OK" if u.find_spec(m) else "MISSING"))

for line in ["line2_scrna", "line3_spatial"]:
    d = "/mnt/ssd/bio_data/%s/processed" % line
    print("== %s ==" % d)
    for f in sorted(os.listdir(d)):
        p = os.path.join(d, f)
        if os.path.isfile(p):
            print("  %10.1f MB  %s" % (os.path.getsize(p) / 1e6, f))
