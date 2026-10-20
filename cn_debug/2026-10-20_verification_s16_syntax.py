#!/usr/bin/env python3
"""S16 语法自检：抽出 bulk_figures 的 PYSCRIPT heredoc 块并 compile（不执行、不 import）。

为什么单独做：本地 Windows 无 matplotlib/pandas，跑不了真脚本；但语法错误必须在部署前
本地拦掉（远端才跑一次，省一轮往返）。
"""

import io
import os
import re
import sys

HEREDOC = re.compile(r"<<'PYSCRIPT'\n(.*?)\nPYSCRIPT", re.S)
SCRIPT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    "src", "line1_bulk", "scripts", "bulk_figures")


def main():
    text = io.open(SCRIPT, encoding="utf-8").read()
    blocks = HEREDOC.findall(text)
    print("heredoc blocks: %d" % len(blocks))
    rc = 0
    for i, code in enumerate(blocks, 1):
        try:
            compile(code, "%s#block%d" % (SCRIPT, i), "exec")
            print("block %d: syntax OK (%d lines)" % (i, code.count("\n") + 1))
        except SyntaxError as exc:
            rc = 1
            print("block %d: SYNTAX ERROR line %s: %s" % (i, exc.lineno, exc.msg))
    return rc


if __name__ == "__main__":
    sys.exit(main())
