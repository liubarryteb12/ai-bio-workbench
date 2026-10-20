#!/usr/bin/env python3
"""提取 bash 脚本内 python heredoc 并用 pyflakes 查未定义名/未用变量。"""
import re
import subprocess
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
src = "\n".join(body)
with open("/tmp/ko_check.py", "w", encoding="utf-8") as fh:
    fh.write(src)
proc = subprocess.run([sys.executable, "-m", "pyflakes", "/tmp/ko_check.py"],
                      capture_output=True, text=True)
print("pyflakes_rc=%d" % proc.returncode)
print(proc.stdout or "(no stdout)")
print(proc.stderr or "(no stderr)")
