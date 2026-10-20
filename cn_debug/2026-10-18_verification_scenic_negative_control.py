"""自检负对照：把 scenic_figures 的两个修复点回退，确认审计能报 FAIL。

任何"审计全 PASS"都必须先证明它在缺陷版本上会红，否则等于没测。
回退两点：1) 长标签不换行；2) 不调用 fit_text_right 自动留位。
"""
import io
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "line2_scrna", "scripts", "scenic_figures")
TMP = os.path.join(ROOT, "cn_debug", "2026-10-18_tmp_scenic_audit", "scenic_figures_unfixed")
WORK = os.path.join(ROOT, "cn_debug", "2026-10-18_tmp_scenic_audit", "work")

code = io.open(SRC, encoding="utf-8").read()
assert 'wrap_label(r["top_celltype"])' in code
code = code.replace('wrap_label(r["top_celltype"])', 'r["top_celltype"]')
assert "        fit_text_edges(fig, axes[0])" in code
code = code.replace("        fit_text_edges(fig, axes[0])",
                    "        pass  # fit_text_edges 已回退")
io.open(TMP, "w", encoding="utf-8").write(code)
print("un-fixed variant ->", TMP)

r = subprocess.run([sys.executable,
                    os.path.join(ROOT, "ops", "audit_figure_layout.py"),
                    "--script", TMP, "--cwd", WORK],
                   capture_output=True, text=True)
sys.stdout.write(r.stdout)
sys.stderr.write(r.stderr)
print("exit=%d (期望 1：负对照必须红)" % r.returncode)
sys.exit(0 if r.returncode == 1 else 1)
