#!/usr/bin/env python3
"""单文件出版级 HTML 报告渲染器（aims v2.5 七.3「项目报告双模态交付」）。

职责（只做一件事：Markdown 到单文件 HTML）：
  1. 读 <delivery-dir>/delivery_manifest.json 取项目元信息，读
     <delivery-dir>/Analysis_Report.md 取正文；
  2. 渲染成内联 CSS、零外部依赖、可直接双击打开的出版级 HTML；
  3. 渲染后自校验：非空、有 <style>、有目录、无外部资源引用。

设计红线：
  * 零外部依赖：不引 CDN、不引外部字体、不写外链 JS。产物断网可读。
  * 原文一律转义：Markdown 里的原始 HTML 片段只当文本显示，不允许注入。
  * 只认白名单语法：标题 / 段落 / 有序无序列表 / 表格 / 围栏代码块 /
    行内代码 / 粗体 / 斜体 / 链接。白名单之外的写法按纯文本输出。
  * 链接只放行 http(s)、mailto 与文内锚点（# 开头）；其它协议降级为纯文本。
  * 不改输入：manifest 与 md 只读，只写 --out 指定的那一个文件。

用法：

    python3 ops/render_report_html.py --delivery-dir /path/to/delivery
    python3 ops/render_report_html.py --delivery-dir ... --out /tmp/r.html --title "自定义标题"
    python3 ops/render_report_html.py --self-test

退出码：0 = 成功；1 = 自校验失败（产物不合规）；2 = 参数错或缺输入。
"""

import argparse
import datetime
import html
import json
import os
import re
import shutil
import sys
import tempfile

SCRIPT_VERSION = "1.0.0"
MANIFEST_NAME = "delivery_manifest.json"
REPORT_NAME = "Analysis_Report.md"
OUTPUT_NAME = "Analysis_Report.html"

EXIT_OK = 0
EXIT_SELF_CHECK = 1
EXIT_USAGE = 2

BT = chr(96)  # 反引号字符，拼接正则时避免源码里出现三连反引号


class InputError(Exception):
    """输入缺失或不可读：调用方统一映射成 exit 2。"""


# ============================================================
# 输入
# ============================================================

def read_text(path):
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        return fh.read()


def load_inputs(delivery_dir):
    """读交付目录下的清单与 Markdown 正文；缺任何一个都抛 InputError。"""
    if not delivery_dir:
        raise InputError("需要 --delivery-dir（或 --self-test）")
    if not os.path.isdir(delivery_dir):
        raise InputError("交付目录不存在: %s" % delivery_dir)

    manifest_path = os.path.join(delivery_dir, MANIFEST_NAME)
    if not os.path.isfile(manifest_path):
        raise InputError("缺少交付清单: %s（先跑 ops/build_client_report.py）" % manifest_path)
    try:
        manifest = json.loads(read_text(manifest_path))
    except ValueError as cause:
        raise InputError("交付清单不是合法 JSON: %s（%s）" % (manifest_path, cause))
    if not isinstance(manifest, dict):
        raise InputError("交付清单顶层必须是对象: %s" % manifest_path)

    md_path = os.path.join(delivery_dir, REPORT_NAME)
    if not os.path.isfile(md_path):
        raise InputError("缺少报告正文: %s" % md_path)
    md_text = read_text(md_path)
    if not md_text.strip():
        raise InputError("报告正文为空: %s" % md_path)

    return manifest, md_text, md_path


# ============================================================
# 行内语法
# ============================================================

TOKEN_RE = re.compile("\x00(\\d+)\x00")
LINK_RE = re.compile(r"\[([^\]\n]*)\]\(([^)\s]+)\)")
INLINE_CODE_RE = re.compile(BT + r"([^" + BT + r"\n]+)" + BT)
BOLD_RE = re.compile(r"\*\*([^\n]+?)\*\*")
ITALIC_STAR_RE = re.compile(r"(?<![*\w])\*([^*\n]+?)\*(?!\*)(?!\w)")
ITALIC_UNDER_RE = re.compile(r"(?<![\w_])_([^_\n]+?)_(?![\w_])")

ALLOWED_SCHEMES = ("http", "https", "mailto")
ANCHOR_RE = re.compile(r"^#[A-Za-z0-9_.:%-]+$")


def safe_href(url):
    """只放行 http(s) / mailto / 文内锚点；其余返回 None（调用方降级为纯文本）。"""
    target = (url or "").strip()
    if not target:
        return None
    if re.search(r"[\s\"'<>" + BT + r"\\]", target):
        return None
    match = re.match(r"^([A-Za-z][A-Za-z0-9+.\-]*):", target)
    if not match:
        return None
    if match.group(1).lower() not in ALLOWED_SCHEMES:
        return None
    return target


def _restore(text, tokens):
    def restore(match):
        return tokens[int(match.group(1))]

    # 占位符可能嵌套（链接文字里又有行内代码），还原到不再变化为止
    for _ in range(4):
        if not TOKEN_RE.search(text):
            break
        text = TOKEN_RE.sub(restore, text)
    return text


def render_inline_plain(text):
    """链接文字用：只做粗体/斜体/行内代码，不再递归解析链接。"""
    escaped = html.escape(text or "", quote=True)
    tokens = []

    def stash(fragment):
        tokens.append(fragment)
        return "\x00%d\x00" % (len(tokens) - 1)

    escaped = INLINE_CODE_RE.sub(
        lambda m: stash("<code>%s</code>" % m.group(1)), escaped)
    escaped = BOLD_RE.sub(r"<strong>\1</strong>", escaped)
    escaped = ITALIC_STAR_RE.sub(r"<em>\1</em>", escaped)
    escaped = ITALIC_UNDER_RE.sub(r"<em>\1</em>", escaped)
    return _restore(escaped, tokens)


def render_inline(text):
    """行内渲染。输入是原始 Markdown 片段，输出是已转义的 HTML 片段。

    顺序：先整体转义，再把行内代码与链接抽成占位符，最后才处理粗体/斜体，
    这样代码里的星号不会被当成强调，链接 href 里的下划线也不会被吃。
    """
    escaped = html.escape(text or "", quote=True)
    tokens = []

    def stash(fragment):
        tokens.append(fragment)
        return "\x00%d\x00" % (len(tokens) - 1)

    escaped = INLINE_CODE_RE.sub(
        lambda m: stash("<code>%s</code>" % m.group(1)), escaped)

    def link_repl(match):
        label = match.group(1)
        href = safe_href(html.unescape(match.group(2)))
        inner = render_inline_plain(label)
        if href is None:
            # 协议不在白名单：保留可读文本，不给可点击能力
            return stash(inner)
        return stash('<a href="%s" target="_blank" rel="noopener noreferrer">%s</a>'
                     % (html.escape(href, quote=True), inner))

    escaped = LINK_RE.sub(link_repl, escaped)
    escaped = BOLD_RE.sub(r"<strong>\1</strong>", escaped)
    escaped = ITALIC_STAR_RE.sub(r"<em>\1</em>", escaped)
    escaped = ITALIC_UNDER_RE.sub(r"<em>\1</em>", escaped)
    return _restore(escaped, tokens)


# ============================================================
# 块级语法
# ============================================================

HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
FENCE_RE = re.compile(r"^\s*(" + BT + r"{3,}|~{3,})\s*([A-Za-z0-9_+#.\-]*)\s*$")
HR_RE = re.compile(r"^\s*([-*_])(?:\s*\1){2,}\s*$")
UL_RE = re.compile(r"^\s*[-*+]\s+(.*)$")
OL_RE = re.compile(r"^\s*\d+[.)]\s+(.*)$")
TABLE_SEP_RE = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")


def split_row(line):
    """按未转义的竖线切表格行，反斜杠转义的竖线还原成字面竖线。"""
    raw = line.strip()
    if raw.startswith("|"):
        raw = raw[1:]
    if raw.endswith("|") and not raw.endswith("\\|"):
        raw = raw[:-1]
    cells = []
    buf = []
    i = 0
    while i < len(raw):
        char = raw[i]
        if char == "\\" and i + 1 < len(raw) and raw[i + 1] == "|":
            buf.append("|")
            i += 2
            continue
        if char == "|":
            cells.append("".join(buf).strip())
            buf = []
            i += 1
            continue
        buf.append(char)
        i += 1
    cells.append("".join(buf).strip())
    return cells


def split_aligns(line):
    aligns = []
    for cell in split_row(line):
        left = cell.startswith(":")
        right = cell.endswith(":")
        if left and right:
            aligns.append("center")
        elif right:
            aligns.append("right")
        elif left:
            aligns.append("left")
        else:
            aligns.append("")
    return aligns


def is_table_start(lines, index):
    if index + 1 >= len(lines):
        return False
    if "|" not in lines[index]:
        return False
    return bool(TABLE_SEP_RE.match(lines[index + 1]))


def starts_block(lines, index):
    line = lines[index]
    if not line.strip():
        return True
    if HEADING_RE.match(line) or FENCE_RE.match(line) or HR_RE.match(line):
        return True
    if line.lstrip().startswith(">"):
        return True
    if UL_RE.match(line) or OL_RE.match(line):
        return True
    return is_table_start(lines, index)


def parse_blocks(md_text):
    """把 Markdown 拆成块序列。白名单之外的写法一律按段落文本处理。"""
    text = md_text.replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    blocks = []
    index = 0
    total = len(lines)
    while index < total:
        line = lines[index]
        if not line.strip():
            index += 1
            continue

        fence = FENCE_RE.match(line)
        if fence:
            marker = fence.group(1)
            lang = fence.group(2) or ""
            closing = re.compile(r"^\s*%s{%d,}\s*$" % (re.escape(marker[0]), len(marker)))
            index += 1
            body = []
            while index < total and not closing.match(lines[index]):
                body.append(lines[index])
                index += 1
            if index < total:
                index += 1
            blocks.append(("code", lang, "\n".join(body)))
            continue

        heading = HEADING_RE.match(line)
        if heading:
            blocks.append(("heading", len(heading.group(1)), heading.group(2)))
            index += 1
            continue

        if HR_RE.match(line):
            blocks.append(("hr",))
            index += 1
            continue

        if is_table_start(lines, index):
            header = split_row(lines[index])
            aligns = split_aligns(lines[index + 1])
            index += 2
            rows = []
            while index < total and lines[index].strip() and "|" in lines[index]:
                rows.append(split_row(lines[index]))
                index += 1
            blocks.append(("table", header, rows, aligns))
            continue

        if line.lstrip().startswith(">"):
            quoted = []
            while index < total and lines[index].lstrip().startswith(">"):
                quoted.append(re.sub(r"^\s*>\s?", "", lines[index]))
                index += 1
            blocks.append(("quote", "\n".join(quoted)))
            continue

        if UL_RE.match(line):
            items = []
            while index < total and UL_RE.match(lines[index]):
                items.append(UL_RE.match(lines[index]).group(1).strip())
                index += 1
            blocks.append(("ul", items))
            continue

        if OL_RE.match(line):
            items = []
            while index < total and OL_RE.match(lines[index]):
                items.append(OL_RE.match(lines[index]).group(1).strip())
                index += 1
            blocks.append(("ol", items))
            continue

        para = [line.strip()]
        index += 1
        while index < total and not starts_block(lines, index):
            para.append(lines[index].strip())
            index += 1
        blocks.append(("para", " ".join(para)))
    return blocks


# ============================================================
# 渲染
# ============================================================

CSS = """
:root{--ink:#111827;--muted:#6b7280;--line:#e5e7eb;--accent:#0f766e;--zebra:#f9fafb}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#fff;color:var(--ink);font-size:16px;line-height:1.85;
  font-family:"Source Han Serif SC","Noto Serif CJK SC","Songti SC","SimSun","Microsoft YaHei",
  -apple-system,"Segoe UI",sans-serif}
.page{max-width:860px;margin:0 auto;padding:56px 32px 96px}
header.doc-head{border-bottom:3px solid var(--accent);padding-bottom:18px;margin-bottom:32px}
header.doc-head h1{font-size:30px;line-height:1.35;margin:0 0 10px}
.doc-subtitle{margin:0 0 10px;color:#374151;font-size:15.5px}
.meta{color:var(--muted);font-size:13.5px;word-break:break-word}
nav.toc{background:var(--zebra);border:1px solid var(--line);border-radius:10px;
  padding:18px 24px;margin:0 0 40px}
nav.toc h2{font-size:14px;letter-spacing:.08em;color:var(--muted);margin:0 0 10px;
  border:0;padding:0;text-transform:uppercase}
nav.toc ol{margin:0;padding-left:22px}
nav.toc li{margin:4px 0}
nav.toc a{color:var(--accent);text-decoration:none;border-bottom:0}
nav.toc a:hover{text-decoration:underline}
.toc-empty{color:var(--muted);font-size:13.5px;margin:0}
h1,h2,h3,h4,h5,h6{line-height:1.4;
  font-family:"Noto Sans CJK SC","PingFang SC","Microsoft YaHei",-apple-system,"Segoe UI",sans-serif}
h2{font-size:23px;margin:46px 0 14px;padding-bottom:8px;border-bottom:2px solid var(--line);
  scroll-margin-top:16px}
h3{font-size:18px;margin:30px 0 10px;color:#0f766e}
h4{font-size:16px;margin:22px 0 8px}
p{margin:12px 0}
ul,ol{padding-left:26px;margin:12px 0}
li{margin:6px 0}
blockquote{margin:16px 0;padding:10px 18px;border-left:4px solid var(--accent);
  background:var(--zebra);color:#374151}
blockquote p{margin:6px 0}
code{font-size:13.5px;padding:1px 5px;border:1px solid var(--line);border-radius:4px;
  background:#f3f4f6;font-family:"JetBrains Mono","Cascadia Mono",Consolas,"Courier New",monospace}
pre{margin:16px 0;padding:14px 16px;border:1px solid var(--line);border-left:4px solid #cbd5e1;
  border-radius:8px;background:#f8fafc;overflow-x:auto;line-height:1.65}
pre code{padding:0;border:0;background:none;font-size:13px}
.table-wrap{overflow-x:auto;margin:16px 0}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{border:1px solid var(--line);padding:8px 12px;text-align:left;vertical-align:top}
thead th{background:#f1f5f9;font-weight:600;white-space:nowrap}
tbody tr:nth-child(even){background:var(--zebra)}
tbody tr:hover{background:#ecfdf5}
a{color:#0b7285;text-decoration:none;border-bottom:1px solid #cfe3ea}
a:hover{border-bottom-color:var(--accent)}
hr{border:0;border-top:1px solid var(--line);margin:32px 0}
footer.doc-foot{margin-top:56px;padding-top:16px;border-top:1px solid var(--line);
  color:var(--muted);font-size:12.5px;display:flex;gap:16px;flex-wrap:wrap;
  justify-content:space-between}
@media (max-width:720px){.page{padding:32px 18px 64px}body{font-size:15px}}
@media print{
  body{background:#fff;font-size:11.5pt;line-height:1.6}
  .page{max-width:none;padding:0}
  nav.toc{background:#fff;break-inside:avoid}
  h2,h3,h4{break-after:avoid}
  table,pre,blockquote,tr{break-inside:avoid}
  thead{display:table-header-group}
  a{color:#111827;border-bottom:0}
  footer.doc-foot{color:#4b5563}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
"""


def slugify(text, used):
    base = re.sub(r"[^\w\u4e00-\u9fa5\- ]+", "", text or "").strip()
    base = re.sub(r"\s+", "-", base).lower() or "section"
    slug = base
    suffix = 2
    while slug in used:
        slug = "%s-%d" % (base, suffix)
        suffix += 1
    used.add(slug)
    return slug


def render_table(header, rows, aligns):
    def cell(tag, value, index):
        align = aligns[index] if index < len(aligns) else ""
        style = ' style="text-align:%s"' % align if align else ""
        return "<%s%s>%s</%s>" % (tag, style, render_inline(value), tag)

    head = "".join(cell("th", value, i) for i, value in enumerate(header))
    body = []
    for row in rows:
        cells = list(row) + [""] * (len(header) - len(row))
        body.append("<tr>%s</tr>" % "".join(
            cell("td", value, i) for i, value in enumerate(cells[:len(header)])))
    return ('<div class="table-wrap"><table><thead><tr>%s</tr></thead>'
            "<tbody>%s</tbody></table></div>" % (head, "".join(body)))


TOC_TITLES = ("目录", "目 录", "contents", "table of contents")


def is_md_toc_section(blocks, index):
    """判断第 index 块是不是 Markdown 自带的目录段（标题 + 链接列表）。"""
    block = blocks[index]
    if block[0] != "heading":
        return False
    if block[2].strip().lower() not in TOC_TITLES:
        return False
    if index + 1 >= len(blocks):
        return False
    nxt = blocks[index + 1]
    if nxt[0] not in ("ul", "ol") or not nxt[1]:
        return False
    linked = sum(1 for item in nxt[1] if "](" in item)
    return linked * 2 >= len(nxt[1])


def render_body(blocks):
    """返回 (正文 HTML, 目录条目列表)。首个 h1 由页头承载，不在正文重复。

    Markdown 自带的「目录」段会被整段丢弃：目录由本渲染器按 h2 统一生成，
    保留原文目录只会多出一组指向旧锚点的死链。
    """
    used = set()
    toc = []
    parts = []
    seen_h1 = False
    skip_next = False
    for index, block in enumerate(blocks):
        if skip_next:
            skip_next = False
            continue
        if is_md_toc_section(blocks, index):
            skip_next = True
            continue
        kind = block[0]
        if kind == "heading":
            level = block[1]
            raw = block[2]
            if level == 1:
                if not seen_h1:
                    seen_h1 = True
                    continue
                level = 2
            anchor = "sec-" + slugify(raw, used)
            if level == 2:
                toc.append((anchor, raw))
            parts.append('<h%d id="%s">%s</h%d>' % (level, anchor, render_inline(raw), level))
        elif kind == "para":
            parts.append("<p>%s</p>" % render_inline(block[1]))
        elif kind == "ul":
            parts.append("<ul>%s</ul>" % "".join(
                "<li>%s</li>" % render_inline(item) for item in block[1]))
        elif kind == "ol":
            parts.append("<ol>%s</ol>" % "".join(
                "<li>%s</li>" % render_inline(item) for item in block[1]))
        elif kind == "quote":
            inner = "".join("<p>%s</p>" % render_inline(line)
                            for line in block[1].split("\n") if line.strip())
            parts.append("<blockquote>%s</blockquote>" % inner)
        elif kind == "code":
            lang = block[1]
            code = html.escape(block[2], quote=False)
            cls = ' class="language-%s"' % html.escape(lang, quote=True) if lang else ""
            parts.append('<pre class="code-block"><code%s>%s</code></pre>' % (cls, code))
        elif kind == "table":
            parts.append(render_table(block[1], block[2], block[3]))
        elif kind == "hr":
            parts.append("<hr>")
    return "\n".join(parts), toc


def first_h1(blocks):
    for block in blocks:
        if block[0] == "heading" and block[1] == 1:
            return block[2]
    return ""


def build_meta(manifest, blocks, title_override=None):
    project_id = str(manifest.get("project_id") or "").strip()
    project_name = str(manifest.get("project_name") or "").strip()
    heading = first_h1(blocks)
    title = (title_override or project_name or heading or project_id or "分析报告").strip()
    # 正文首个 h1 与页头标题不同时降为副标题，信息不丢也不重复
    subtitle = heading.strip() if heading.strip() and heading.strip() != title else ""
    return {
        "title": title,
        "subtitle": subtitle,
        "project_id": project_id,
        "project_name": project_name,
        "package_version": str(manifest.get("package_version") or "").strip(),
        "generated_at": str(manifest.get("generated_at") or "").strip(),
        "rendered_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }


def render_html(meta, blocks):
    body, toc = render_body(blocks)
    if toc:
        toc_html = "<ol>%s</ol>" % "".join(
            '<li><a href="#%s">%s</a></li>' % (anchor, render_inline(text))
            for anchor, text in toc)
    else:
        toc_html = '<p class="toc-empty">（正文没有二级标题，未生成目录）</p>'

    meta_bits = []
    if meta["project_id"]:
        meta_bits.append("项目 ID：%s" % html.escape(meta["project_id"]))
    if meta["package_version"]:
        meta_bits.append("清单版本：%s" % html.escape(meta["package_version"]))
    if meta["generated_at"]:
        meta_bits.append("报告生成时间：%s" % html.escape(meta["generated_at"]))
    meta_bits.append("章节数：%d" % len(toc))

    head = "\n".join([
        "<!doctype html>",
        '<html lang="zh-CN">',
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<meta name="generator" content="ops/render_report_html.py v%s">' % SCRIPT_VERSION,
        "<title>%s</title>" % html.escape(meta["title"]),
        "<style>",
        CSS.strip("\n"),
        "</style>",
        "</head>",
        "<body>",
        '<div class="page">',
        '<header class="doc-head">',
        "<h1>%s</h1>" % html.escape(meta["title"]),
    ] + (['<p class="doc-subtitle">%s</p>' % html.escape(meta["subtitle"])]
         if meta.get("subtitle") else []) + [
        '<div class="meta">%s</div>' % "\u3000".join(meta_bits),
        "</header>",
        '<nav class="toc" id="toc" aria-label="目录">',
        "<h2>目录</h2>",
        toc_html,
        "</nav>",
        '<main id="content">',
    ])

    tail = "\n".join([
        "</main>",
        '<footer class="doc-foot">',
        "<span>生成时间：%s</span>" % html.escape(meta["rendered_at"]),
        "<span>渲染器：ops/render_report_html.py v%s</span>" % SCRIPT_VERSION,
        "</footer>",
        "</div>",
        "</body>",
        "</html>",
    ])
    return head + "\n" + body + "\n" + tail + "\n"


# ============================================================
# 自校验
# ============================================================

# 只拦"资源引用"：<link>、外链 <script>、<img>/<iframe>/<object>/<embed>/<source>、
# CSS 的 url(...) 与 @import。正文里用户自己的 http 超链接不算资源引用。
EXTERNAL_RESOURCE_PATTERNS = [
    (re.compile(r"<link\b", re.I), "<link> 标签"),
    (re.compile(r"<script\b[^>]*\bsrc\s*=", re.I), "外链 <script src>"),
    (re.compile(r"<img\b", re.I), "<img> 标签"),
    (re.compile(r"<iframe\b", re.I), "<iframe> 标签"),
    (re.compile(r"<object\b", re.I), "<object> 标签"),
    (re.compile(r"<embed\b", re.I), "<embed> 标签"),
    (re.compile(r"<source\b", re.I), "<source> 标签"),
    (re.compile(r"@import\b", re.I), "@import 规则"),
    (re.compile(r"url\(\s*['\"]?(?:https?:)?//", re.I), "CSS url(...) 引用"),
]


def external_resource_hits(page):
    hits = []
    for pattern, label in EXTERNAL_RESOURCE_PATTERNS:
        if pattern.search(page):
            hits.append(label)
    return hits


def check_output(page, toc_entries=None):
    problems = []
    if not page or not page.strip():
        problems.append("产物为空")
        return problems
    lowered = page.lower()
    if not lowered.startswith("<!doctype html>"):
        problems.append("缺少 <!doctype html>")
    if 'charset="utf-8"' not in lowered:
        problems.append("缺少 UTF-8 声明")
    if "<style>" not in page:
        problems.append("缺少内联 <style>")
    if 'id="toc"' not in page:
        problems.append("缺少目录容器 id=toc")
    if toc_entries and '<a href="#' not in page:
        problems.append("目录有条目但缺少锚点链接")
    hits = external_resource_hits(page)
    if hits:
        problems.append("检测到外部资源引用: %s" % "、".join(hits))
    return problems


# ============================================================
# 自检
# ============================================================

def self_test():
    failures = [0]
    total = [0]

    def check(name, ok, detail=""):
        total[0] += 1
        if ok:
            print("PASS | %s" % name)
        else:
            failures[0] += 1
            print("FAIL | %s%s" % (name, (" | " + detail) if detail else ""))

    sample_md = "\n".join([
        "# PRJ_SELFTEST 交付解读报告",
        "",
        "> 本报告由脚本自动生成。",
        "",
        "## 第一章 数据与方法",
        "",
        "样本量 **12** 例，阈值 " + BT + "padj < 0.05" + BT + "，基因 *IL17A* 显著上调。",
        "",
        "| 基因 | logFC | padj |",
        "|---|---|---:|",
        "| IL17A | 2.5 | 0.01 |",
        "| S100A8 | -1.8 | 0.02 |",
        "",
        "### 步骤清单",
        "",
        "- 质控",
        "- 差异分析",
        "",
        "1. 先跑质控",
        "2. 再跑差异",
        "",
        BT + BT + BT + "bash",
        "Rscript --vanilla deg_limma.R",
        "echo done",
        BT + BT + BT,
        "",
        "危险片段：<script>alert(1)</script> 与 <img src=x onerror=alert(1)>",
        "",
        "外链 [官网](https://example.org/a?x=1&y=2) 与 [邮件](mailto:a@b.c) "
        "与 [坏链](javascript:alert(1)) 与 [相对](figures/a.png)。",
        "",
        "## 第二章 结果",
        "",
        "结论段落。",
        "",
    ])
    blocks = parse_blocks(sample_md)
    meta = build_meta({"project_id": "PRJ_SELFTEST", "project_name": "自检项目",
                       "package_version": "1.0", "generated_at": "2026-10-21 10:00:00"},
                      blocks, None)
    page = render_html(meta, blocks)
    _, toc = render_body(blocks)

    check("页头使用清单里的项目名", "<h1>自检项目</h1>" in page)
    check("首个 h1 不在正文重复", page.count("<h1>") == 1, str(page.count("<h1>")))
    check("首个 h1 与标题不同则降为副标题",
          '<p class="doc-subtitle">PRJ_SELFTEST 交付解读报告</p>' in page)
    check("二级标题生成目录锚点", len(toc) == 2 and '<a href="#sec-' in page, str(toc))
    check("目录条目数与 h2 数一致", page.count('<li><a href="#sec-') == len(toc), str(len(toc)))
    check("表格渲染为 table/thead/tbody",
          "<table>" in page and "<thead>" in page and page.count("<tr>") >= 3)
    check("右对齐列带 text-align", 'style="text-align:right"' in page)
    check("代码块等宽渲染且保留原文",
          '<pre class="code-block"><code class="language-bash">Rscript --vanilla deg_limma.R' in page)
    check("行内代码渲染", "<code>padj &lt; 0.05</code>" in page)
    check("粗体渲染", "<strong>12</strong>" in page)
    check("斜体渲染", "<em>IL17A</em>" in page)
    check("原始 script 标签被转义成文本",
          "&lt;script&gt;alert(1)&lt;/script&gt;" in page
          and "<script>alert(1)</script>" not in page)
    check("原始 img onerror 被转义成文本",
          "&lt;img src=x onerror=alert(1)&gt;" in page and "<img" not in page.lower())
    check("https 链接保留为可点击",
          '<a href="https://example.org/a?x=1&amp;y=2"' in page)
    check("mailto 链接保留", '<a href="mailto:a@b.c"' in page)
    check("javascript 链接降级为纯文本",
          "javascript:alert(1" not in page and ">坏链</a>" not in page)
    check("相对链接降级为纯文本", 'href="figures/a.png"' not in page)
    check("有序列表渲染", "<ol>" in page and "<li>先跑质控</li>" in page)
    check("无序列表渲染", "<ul>" in page and "<li>质控</li>" in page)
    check("引用块渲染", "<blockquote>" in page)
    check("打印样式存在", "@media print" in page)
    check("页脚写生成时间与脚本版本",
          "生成时间：" in page and ("render_report_html.py v%s" % SCRIPT_VERSION) in page)
    check("自校验零问题", check_output(page, toc) == [], str(check_output(page, toc)))

    md_with_toc = "\n".join([
        "## 目录",
        "",
        "1. [第一章 数据与方法](#第一章-数据与方法)",
        "2. [第二章 结果](#第二章-结果)",
        "",
        "## 第一章 数据与方法",
        "",
        "正文。",
        "",
    ])
    page3 = render_html(build_meta({"project_id": "PRJ_TOC"}, parse_blocks(md_with_toc), None),
                        parse_blocks(md_with_toc))
    check("Markdown 自带的目录段被整段丢弃",
          page3.count('<h2 id="sec-') == 1 and page3.count("<h2") == 2,
          "body_h2=%d nav_h2=1" % page3.count('<h2 id="sec-'))
    check("原文目录的死锚点不再出现", 'href="#第' not in page3)

    # 缺输入：三个都必须抛 InputError，调用方据此 exit 2
    root = tempfile.mkdtemp(prefix="render_html_selftest_")
    try:
        missing_both = os.path.join(root, "empty")
        os.makedirs(missing_both)
        try:
            load_inputs(missing_both)
            check("缺 manifest 时抛 InputError", False)
        except InputError:
            check("缺 manifest 时抛 InputError", True)

        only_manifest = os.path.join(root, "only_manifest")
        os.makedirs(only_manifest)
        with open(os.path.join(only_manifest, MANIFEST_NAME), "w",
                  encoding="utf-8", newline="\n") as fh:
            json.dump({"project_id": "PRJ_X"}, fh)
        try:
            load_inputs(only_manifest)
            check("缺 md 时抛 InputError", False)
        except InputError:
            check("缺 md 时抛 InputError", True)

        blank = os.path.join(root, "blank")
        os.makedirs(blank)
        with open(os.path.join(blank, MANIFEST_NAME), "w",
                  encoding="utf-8", newline="\n") as fh:
            json.dump({"project_id": "PRJ_X"}, fh)
        with open(os.path.join(blank, REPORT_NAME), "w",
                  encoding="utf-8", newline="\n") as fh:
            fh.write("   \n\n")
        try:
            load_inputs(blank)
            check("md 只有空白时抛 InputError", False)
        except InputError:
            check("md 只有空白时抛 InputError", True)

        good = os.path.join(root, "good")
        os.makedirs(good)
        with open(os.path.join(good, MANIFEST_NAME), "w",
                  encoding="utf-8", newline="\n") as fh:
            json.dump({"project_id": "PRJ_OK", "project_name": "好项目",
                       "generated_at": "2026-10-21 10:00:00"}, fh, ensure_ascii=False)
        with open(os.path.join(good, REPORT_NAME), "w",
                  encoding="utf-8", newline="\n") as fh:
            fh.write("## 只有二级标题\n\n中文正文，含 **加粗**。\n")
        manifest, md_text, _ = load_inputs(good)
        check("合法输入可读出", manifest.get("project_id") == "PRJ_OK" and "中文正文" in md_text)
        page2 = render_html(build_meta(manifest, parse_blocks(md_text), None),
                            parse_blocks(md_text))
        check("中文正文不乱码", "中文正文" in page2 and 'charset="utf-8"' in page2.lower())
    finally:
        shutil.rmtree(root, ignore_errors=True)

    print("\n%s" % ("全部符合预期" if failures[0] == 0 else "%d 条不符合预期" % failures[0]))
    return EXIT_OK if failures[0] == 0 else EXIT_SELF_CHECK


# ============================================================
# 入口
# ============================================================

def main(argv=None):
    parser = argparse.ArgumentParser(
        description="把交付目录里的 Analysis_Report.md 渲染成单文件出版级 HTML")
    parser.add_argument("--delivery-dir",
                        help="交付目录（含 delivery_manifest.json 与 Analysis_Report.md）")
    parser.add_argument("--out", help="输出文件路径，默认 <delivery-dir>/Analysis_Report.html")
    parser.add_argument("--title", help="覆盖报告标题（默认取清单里的 project_name）")
    parser.add_argument("--self-test", action="store_true", help="跑内建用例自检渲染与转义")
    parser.add_argument("--version", action="version",
                        version="render_report_html.py %s" % SCRIPT_VERSION)
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()

    try:
        manifest, md_text, md_path = load_inputs(args.delivery_dir)
    except InputError as cause:
        sys.stderr.write("%s\n" % cause)
        return EXIT_USAGE

    blocks = parse_blocks(md_text)
    meta = build_meta(manifest, blocks, args.title)
    page = render_html(meta, blocks)
    _, toc = render_body(blocks)

    problems = check_output(page, toc)
    if problems:
        sys.stderr.write("自校验失败（未写盘）：\n")
        for item in problems:
            sys.stderr.write("  - %s\n" % item)
        return EXIT_SELF_CHECK

    out_path = args.out or os.path.join(os.path.abspath(args.delivery_dir), OUTPUT_NAME)
    try:
        parent = os.path.dirname(os.path.abspath(out_path))
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(out_path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(page)
    except OSError as cause:
        sys.stderr.write("写盘失败: %s\n" % cause)
        return EXIT_USAGE

    print("已渲染: %s（%d 字节，%d 个二级章节，来源 %s）"
          % (out_path, os.path.getsize(out_path), len(toc), os.path.basename(md_path)))
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
