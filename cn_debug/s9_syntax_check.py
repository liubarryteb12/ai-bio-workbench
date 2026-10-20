#!/usr/bin/env python3
"""S9 静态自检：bulk_figures 内嵌 Python 段的语法 + 组名/旧色值零残留。

用法：python cn_debug/s9_syntax_check.py
退出码：0 = 通过；1 = 有违规
"""
import io
import re
import sys

TARGET = "src/line1_bulk/scripts/bulk_figures"
BAD_PATTERNS = [
    (r"#C44E52", "旧 case 色 #C44E52 仍在"),
    (r"#4C72B0", "旧 ctrl 色 #4C72B0 仍在"),
    (r'["\']LS["\']', '硬编码组名 "LS" 仍在'),
    (r'["\']NLS["\']', '硬编码组名 "NLS" 仍在'),
    (r'\.get\(\s*g\s*,\s*["\']gray["\']', "静默降级 .get(g, 'gray') 仍在"),
]


def main():
    text = io.open(TARGET, encoding="utf-8").read()
    m = re.search(r"<<'PYSCRIPT'\n(.*)\nPYSCRIPT\n", text, re.S)
    if not m:
        print("FAIL: 找不到 PYSCRIPT heredoc 段")
        return 1
    code = m.group(1)
    try:
        compile(code, TARGET + "<py>", "exec")
    except SyntaxError as exc:
        print("FAIL: 内嵌 Python 语法错误 %s: %s" % (exc.lineno, exc.msg))
        return 1
    print("py syntax OK lines=%d" % (code.count("\n") + 1))

    bad = 0
    for pattern, label in BAD_PATTERNS:
        hits = [(i, line.strip()) for i, line in enumerate(text.splitlines(), 1)
                if re.search(pattern, line)]
        # 注释/文档字符串里的历史说明不算违规（只禁止可执行代码里的残留）
        hits = [h for h in hits if not h[1].startswith("#") and not h[1].startswith('"""')]
        if hits:
            bad += len(hits)
            print("FAIL: %s -> %s" % (label, hits[:3]))
        else:
            print("OK: %s 0 命中" % label)
    print("RESULT: %s" % ("PASS" if bad == 0 else "FAIL total=%d" % bad))
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
