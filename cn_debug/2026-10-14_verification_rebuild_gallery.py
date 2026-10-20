"""重建本地图件画廊 outputs/figures/index.html（扫描三线 figures 目录）。

只读图件目录 + 写 index.html；不改任何图件。
"""
import datetime
import pathlib

ROOT = pathlib.Path(r"d:/00.AIagent/codespace/AI辅助生信分析流程工作台/outputs/figures")
LINES = [
    ("line1_bulk", "线1 / GEO bulk"),
    ("line2_scrna", "线2 / 单细胞转录组"),
    ("line3_spatial", "线3 / 空间转录组"),
]
STYLE = (
    "body{font-family:system-ui,\"Microsoft YaHei\",sans-serif;margin:0;"
    "background:#f5f6f8;color:#1a1a1a}\n"
    "header{background:#1f2937;color:#fff;padding:18px 28px}"
    "h1{margin:0;font-size:20px}header p{margin:6px 0 0;font-size:13px;opacity:.8}\n"
    "section{padding:18px 28px}h2{font-size:16px;border-left:4px solid #2563eb;"
    "padding-left:10px;margin:22px 0 12px}\n"
    ".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}\n"
    ".card{background:#fff;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden}\n"
    ".card img{width:100%;display:block;background:#fff}\n"
    ".card .cap{padding:8px 10px;font-size:11px;color:#374151;"
    "border-top:1px solid #eee;word-break:break-all}\n"
)

total = 0
sections = []
for dirname, title in LINES:
    d = ROOT / dirname
    files = sorted(p.name for p in d.glob("*.png")) if d.is_dir() else []
    total += len(files)
    cards = "".join(
        "<div class='card'><a href='%s/%s' target='_blank'>"
        "<img src='%s/%s' loading='lazy'></a>"
        "<div class='cap'>%s</div></div>" % (dirname, f, dirname, f, f)
        for f in files
    )
    sections.append("<h2>%s（%d 张）</h2><div class='grid'>%s</div>"
                    % (title, len(files), cards))

today = datetime.date.today().isoformat()
html = (
    "<!DOCTYPE html><html lang=\"zh\"><head><meta charset=\"utf-8\">"
    "<title>三条分析线出图审核</title>\n<style>%s</style></head><body>\n"
    "<header><h1>三条分析线出图审核（单图版）</h1>"
    "<p>共 %d 张 · 全部单图 · 出图规范 docs/figure_spec.md v1.1 · %s</p></header><section>\n"
    "%s\n</section></body></html>\n"
    % (STYLE, total, today, "\n".join(sections))
)
(ROOT / "index.html").write_text(html, encoding="utf-8")
print("wrote index.html total=%d" % total)
for dirname, title in LINES:
    print("  %s: %d" % (dirname, len(list((ROOT / dirname).glob("*.png")))))
