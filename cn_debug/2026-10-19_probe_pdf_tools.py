"""探测本机可用的 PDF 元数据读取手段（S11 前置环境探测）。"""
import importlib
import shutil
import sys

print("python", sys.version.split()[0])
for mod in ("pypdf", "PyPDF2", "pdfminer", "fitz", "pdfplumber"):
    try:
        m = importlib.import_module(mod)
        print("OK   ", mod, getattr(m, "__version__", "?"))
    except Exception as exc:  # noqa: BLE001
        print("MISS ", mod, type(exc).__name__)
for exe in ("pdfinfo", "pdftotext"):
    print("BIN  ", exe, shutil.which(exe))
