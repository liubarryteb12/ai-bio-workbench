#!/usr/bin/env python3
"""S10 静态自检（无副作用，不落盘）。

为什么需要它：scrna_figures 是 bash 包装 + PYSCRIPT heredoc，`bash -n` 只查 bash 段，
python 段语法要靠把 heredoc 抽出来单独 compile 才能验；旧色值/写死组名/静默降级
是本次验收的硬判据（A1/A2），用字符串扫描留可复核证据。
"""
import io
import re
import sys

PATH = "src/line2_scrna/scripts/scrna_figures"
HEREDOC = re.compile(r"<<'PYSCRIPT'\n(.*?)\nPYSCRIPT", re.S)

text = io.open(PATH, encoding="utf-8").read()
blocks = HEREDOC.findall(text)
if not blocks:
    sys.exit("FAIL: 未找到 PYSCRIPT heredoc")
code = blocks[-1]
compile(code, PATH, "exec")
print("py syntax OK heredoc_lines=%d file_lines=%d"
      % (len(code.splitlines()), len(text.splitlines())))

checks = [
    ("旧 ctrl 色 #4C72B0", r"#4C72B0"),
    ("旧 case 色 #C44E52", r"#C44E52"),
    ("静默降级 .get(g, 'gray')", r"\.get\([^)]*,\s*[\"']gray[\"']\)"),
    ("写死组名 \"Healthy\"", r"[\"']Healthy[\"']"),
    ("写死组名 \"Psoriasis\"", r"[\"']Psoriasis[\"']"),
]
bad = 0
for label, pat in checks:
    hits = [(i + 1, ln.strip()) for i, ln in enumerate(text.splitlines())
            if re.search(pat, ln)]
    if hits:
        bad += 1
        print("FAIL: %s 仍 %d 命中" % (label, len(hits)))
        for ln_no, ln in hits:
            print("      L%d: %s" % (ln_no, ln))
    else:
        print("OK: %s 0 命中" % label)

print("RESULT: %s" % ("PASS" if bad == 0 else "FAIL"))
sys.exit(1 if bad else 0)
