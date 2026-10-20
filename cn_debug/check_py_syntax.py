#!/usr/bin/env python3
"""语法检查：从 bash 脚本提取 python heredoc 段并 ast.parse。"""
import ast
import re
import sys

path = "/mnt/ssd/bio_data/line3_spatial/bin/spatial_knockout"
lines = open(path, encoding="utf-8").read().splitlines()
body = []
in_py = False
for ln in lines:
    if re.match(r"^python3\s+-\s+<<'PYSCRIPT'\s*$", ln):
        in_py = True
        continue
    if in_py and ln.strip() == "PYSCRIPT":
        break
    if in_py:
        body.append(ln)
print("extracted_lines=%d" % len(body))
if not body:
    sys.exit("no python heredoc found")
src = "\n".join(body)
ast.parse(src)
print("PY_OK")
