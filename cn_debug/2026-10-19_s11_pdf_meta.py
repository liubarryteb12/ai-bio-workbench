"""S11 文献元数据探针：用 pdftotext 抽每个 PDF 第 1 页文本前若干行。

用途：为 `references/生信分析可用参考文献/INDEX.md` 取真实标题/作者/年份，
      不凭文件名臆造。抽不到就如实打印 "未获取"。

用法：python cn_debug/2026-10-19_s11_pdf_meta.py [子目录名...]
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = os.path.join(ROOT, "reference", "生信分析可用参考文献")
PDFTOTEXT = r"C:\Users\18765\AppData\Local\hermes\tools\git-2.53.0+3-win32-x64\mingw64\bin\pdftotext.EXE"
LINES = 14


def first_page(pdf):
    try:
        out = subprocess.run([PDFTOTEXT, "-f", "1", "-l", "1", "-enc", "UTF-8", pdf, "-"],
                             capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    except (OSError, subprocess.SubprocessError) as exc:
        return "EXTRACT_FAIL %s: %s" % (type(exc).__name__, exc)
    if out.returncode != 0:
        return "EXTRACT_FAIL exit=%d %s" % (out.returncode, (out.stderr or "").strip()[:200])
    txt = [ln.strip() for ln in out.stdout.splitlines() if ln.strip()]
    return "\n".join(txt[:LINES]) if txt else "EXTRACT_EMPTY"


def main(argv):
    subs = argv[1:] or sorted(d for d in os.listdir(REF) if os.path.isdir(os.path.join(REF, d)))
    for sub in subs:
        d = os.path.join(REF, sub)
        if not os.path.isdir(d):
            print("!! 无此目录: %s" % sub)
            continue
        for name in sorted(os.listdir(d)):
            if not name.lower().endswith(".pdf"):
                continue
            print("=" * 100)
            print("DIR : %s" % sub)
            print("FILE: %s" % name)
            print("-" * 100)
            print(first_page(os.path.join(d, name)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
