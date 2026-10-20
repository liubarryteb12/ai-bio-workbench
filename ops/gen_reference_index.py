#!/usr/bin/env python3
"""生成 `reference/生信分析可用参考文献/INDEX.md`（文献索引的机读源是 citations.json）。

为什么要生成而不是手写：交付报告里的方法学引用直接读 `citations.json`，
INDEX.md 只是同一份数据的人读视图。手写两份必然漂移——某天改了 DOI，
报告和索引就会各说一套。这里让 INDEX.md 由 citations.json 生成，并在生成时
逐个校验 PDF 是否真实存在（路径写错会直接报错，而不是生成一个指向空处的索引）。

用法：
    python ops/gen_reference_index.py            # 生成 INDEX.md
    python ops/gen_reference_index.py --check    # 只校验，不写盘（CI/自检用）

退出码：0 = 成功；1 = citations.json 结构有问题或 PDF 缺失。
"""
import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF_DIR = os.path.join(ROOT, "reference", "生信分析可用参考文献")
CITATIONS = os.path.join(REF_DIR, "citations.json")
INDEX_MD = os.path.join(REF_DIR, "INDEX.md")

# 01/02/03 是应用范例（同类研究怎么用这些方法），不是软件引用来源，
# 因此只登记目录与篇数，不逐篇抄标题——逐篇抄就得从 PDF 首页取标题，
# 与"方法学引用"用途无关，反而增加编造风险。
APP_DIRS = [
    ("01_方向一_GEO数据挖掘加机器学习加体外验证", "线 1（GEO Bulk + 机器学习 + 体外验证）的方法学范例"),
    ("02_方向二_单细胞转录组", "线 2（单细胞转录组）的方法学范例"),
    ("03_方向三_单细胞联合空间转录组", "线 3（单细胞 + 空间转录组）的方法学范例"),
]

# 本项目三条线脚本里实际出现过的包（与 docs/software_versions.json 的 lines 字段同源）。
# 放在这里是为了在索引里直接回答"我这条线能引哪几篇"，避免报告堆文献。
PIPELINE_USE = [
    ("line1_bulk", ["WGCNA", "limma", "ggplot2", "clusterProfiler", "data.table", "glmnet",
                    "survival", "org.Hs.eg.db", "matrixStats",
                    "scikit-learn", "statsmodels", "networkx", "shap", "matplotlib",
                    "pandas", "numpy", "scipy", "adjustText"]),
    ("line2_scrna", ["scanpy", "anndata", "harmonypy", "liana", "pyscenic", "arboreto", "gseapy",
                     "scTenifold", "networkx", "scikit-learn", "matplotlib", "pandas", "numpy",
                     "scipy", "adjustText", "GSVA", "GSEABase"]),
    ("line3_spatial", ["scanpy", "anndata", "liana", "scTenifold", "gseapy", "scikit-learn",
                       "matplotlib", "pandas", "numpy", "scipy", "h5py", "Pillow"]),
]

# 包名 → citations.json 的 key（大小写差异与"实现了同一算法但不是同一软件"的情况分开写）
PACKAGE_TO_KEY = {
    "WGCNA": "WGCNA",
    "limma": "limma",
    "Scanpy": "Scanpy",
    "scanpy": "Scanpy",
    "harmonypy": "harmony",
}


def load_citations():
    with open(CITATIONS, encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data.get("entries"), list):
        raise SystemExit("citations.json 缺少 entries 数组")
    return data


def check_pdfs(data):
    """逐个校验 entries/duplicates 里的 PDF 路径真实存在。返回问题列表。"""
    problems = []
    seen = []
    for entry in data["entries"]:
        pdf = entry.get("pdf")
        if pdf:
            seen.append(pdf)
            if not os.path.isfile(os.path.join(REF_DIR, pdf)):
                problems.append("entries[%s].pdf 不存在: %s" % (entry.get("key"), pdf))
    for dup in data.get("duplicates", []):
        pdf = dup.get("pdf")
        if not pdf:
            problems.append("duplicates 条目缺 pdf: %s" % dup)
            continue
        seen.append(pdf)
        if not os.path.isfile(os.path.join(REF_DIR, pdf)):
            problems.append("duplicates.pdf 不存在: %s" % pdf)
    # 覆盖性校验：04 目录下的每个 PDF 都必须在索引里出现一次
    tool_dir = os.path.join(REF_DIR, "04_工具包原始论文")
    if os.path.isdir(tool_dir):
        for name in sorted(os.listdir(tool_dir)):
            if not name.lower().endswith(".pdf"):
                continue
            rel = "04_工具包原始论文/" + name
            if rel not in seen:
                problems.append("04 目录下的 PDF 未进索引: %s" % rel)
    return problems


def cell(text):
    """Markdown 表格单元格：竖线与换行会破坏表格。"""
    if text is None:
        return "未获取"
    return str(text).replace("|", "\\|").replace("\n", " ")


def render(data):
    out = []
    out.append("# 生信分析可用参考文献索引（INDEX）")
    out.append("")
    out.append("> **本文件由 `ops/gen_reference_index.py` 从 `citations.json` 生成，请勿手改。**")
    out.append("> 改文献信息请改 `citations.json` 后重新生成；机读源与交付报告引用读的是同一份数据。")
    out.append("")
    out.append("字段来源：`%s`。" % data.get("extraction", "未记录"))
    out.append("取值规则：%s" % data.get("field_policy", "未记录"))
    out.append("")
    cov = data.get("coverage") or {}
    out.append("覆盖情况：04 类工具包目录共 **%s 个 PDF**，去重后 **%s 篇**，其中 **%s 个是重复拷贝**。"
               % (cov.get("pdf_total", "未记录"), cov.get("unique_papers", "未记录"),
                  cov.get("duplicate_copies", "未记录")))
    out.append("")

    out.append("## 一、工具包 / 方法 → 原始文献")
    out.append("")
    out.append("| 包 / 方法 | 版本范围 | 论文标题 | 作者 | 年份 | 出处 / DOI | 本地路径 |")
    out.append("|---|---|---|---|---|---|---|")
    for entry in data["entries"]:
        doi = entry.get("doi")
        doi_txt = ("DOI: `%s`" % doi) if doi and doi != "未获取" else "DOI 未获取"
        venue = entry.get("venue") or "未获取"
        out.append("| %s | %s | %s | %s | %s | %s<br>%s | %s |" % (
            cell(entry.get("package")),
            cell(entry.get("version_range")),
            cell(entry.get("title")),
            cell(entry.get("authors")),
            cell(entry.get("year")),
            cell(venue),
            cell(doi_txt),
            cell(entry.get("pdf") or "本目录无此文献"),
        ))
    out.append("")

    out.append("## 二、重复拷贝（同一篇论文的另一份文件）")
    out.append("")
    if data.get("duplicates"):
        out.append("| 对应条目 | 本地路径 | 判定依据 |")
        out.append("|---|---|---|")
        for dup in data["duplicates"]:
            out.append("| %s | %s | %s |" % (cell(dup.get("key")), cell(dup.get("pdf")),
                                            cell(dup.get("evidence"))))
    else:
        out.append("无。")
    out.append("")

    out.append("## 三、本项目各线用到的包 → 是否可引")
    out.append("")
    out.append("「可引」= 本目录有对应 PDF 且该包确实出现在 `src/<line>/scripts/` 里；"
               "「缺文献」= 包在用但本目录没有它的原始论文，报告里会明写未获取，不拿别的论文顶替。")
    out.append("")
    out.append("| 分析线 | 包 | 本目录文献 | 引用条目 |")
    out.append("|---|---|---|---|")
    by_key = {e.get("key"): e for e in data["entries"]}
    for line, pkgs in PIPELINE_USE:
        for pkg in pkgs:
            key = PACKAGE_TO_KEY.get(pkg)
            entry = by_key.get(key) if key else None
            if entry and entry.get("pdf"):
                out.append("| %s | `%s` | 有 | %s |" % (line, pkg, cell(entry.get("title"))))
            elif entry:
                out.append("| %s | `%s` | **缺文献** | %s |" % (line, pkg, cell(entry.get("evidence"))))
            else:
                out.append("| %s | `%s` | **缺文献** | 本目录无对应原始论文 |" % (line, pkg))
    out.append("")
    out.append("另：线 1 / 线 2 的 R 侧包全部来自 Bioconductor，平台级引用见条目 `Bioconductor`"
               "（Gentleman RC 等，2004）。")
    out.append("")

    out.append("## 四、01 / 02 / 03 类：方法学范例（不作为软件引用）")
    out.append("")
    out.append("| 目录 | 篇数 | 用途 |")
    out.append("|---|---|---|")
    for name, purpose in APP_DIRS:
        d = os.path.join(REF_DIR, name)
        n = len([f for f in os.listdir(d) if f.lower().endswith(".pdf")]) if os.path.isdir(d) else 0
        out.append("| `%s` | %d | %s |" % (name, n, purpose))
    out.append("")
    out.append("这三类文献用于写作时对照同类研究的方法与结论表述；**交付报告的方法学引用不使用它们**，"
               "因为报告引用必须对应本项目实际跑过的软件。")
    out.append("")
    return "\n".join(out) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description="从 citations.json 生成 INDEX.md")
    ap.add_argument("--check", action="store_true", help="只校验不写盘")
    args = ap.parse_args(argv)

    if not os.path.isfile(CITATIONS):
        sys.stderr.write("缺少 %s\n" % CITATIONS)
        return 1
    data = load_citations()
    problems = check_pdfs(data)
    if problems:
        for p in problems:
            sys.stderr.write("FAIL %s\n" % p)
        return 1
    text = render(data)
    if args.check:
        print("PASS citations.json 结构可读，PDF 路径全部命中，索引可渲染（%d 字符）" % len(text))
        return 0
    with open(INDEX_MD, "w", encoding="utf-8") as fh:
        fh.write(text)
    print("写出 %s（%d 字符）" % (INDEX_MD, len(text)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
