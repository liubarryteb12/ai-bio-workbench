#!/usr/bin/env python3
"""S11 验收自检：A1（版本清单来自远端实采）、A2（索引覆盖 04 全部 PDF）。

做法：把 `docs/software_versions.json` 与远端探针原始输出逐条对账。
对不上的立刻 FAIL —— 版本号一旦靠手抄，这份清单就失去意义。

用法：python cn_debug/2026-10-19_s11_verify.py
退出码：0 = 全过；1 = 有 FAIL
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSIONS = os.path.join(ROOT, "docs", "software_versions.json")
RAW = os.path.join(ROOT, "cn_debug", "2026-10-19_s11_versions_raw.json")
REF = os.path.join(ROOT, "reference", "生信分析可用参考文献")
CITATIONS = os.path.join(REF, "citations.json")
INDEX = os.path.join(REF, "INDEX.md")
TOOL_DIR = os.path.join(REF, "04_工具包原始论文")

failed = 0


def check(label, cond, detail=""):
    global failed
    if not cond:
        failed += 1
    print("%s | %s%s" % ("PASS" if cond else "FAIL", label, (" | " + str(detail)) if detail else ""))


def main():
    with open(VERSIONS, encoding="utf-8") as fh:
        ver = json.load(fh)
    with open(RAW, encoding="utf-8") as fh:
        raw = json.load(fh)
    with open(CITATIONS, encoding="utf-8") as fh:
        cit = json.load(fh)

    pkgs = ver.get("packages") or []
    inters = ver.get("interpreters") or []

    # ---- A1 ----
    check("清单含 R 与 Python 两侧主语言",
          {i.get("language") for i in inters} >= {"R", "python3"} or
          {p.get("language") for p in pkgs} >= {"R", "Python"},
          "解释器=%s" % [i.get("name") for i in inters])
    check("登记包数 ≥ 10", len(pkgs) >= 10, "%d 个" % len(pkgs))
    check("每条都有 source 实测命令", all(p.get("source") for p in pkgs + inters),
          "缺 source: %s" % [p.get("name") for p in pkgs + inters if not p.get("source")])
    check("seed 登记为 20261013", (ver.get("seed") or {}).get("value") == 20261013,
          (ver.get("seed") or {}).get("value"))

    # 逐条与远端探针原始输出对账（版本号不许手抄）
    mismatched = []
    for p in pkgs:
        name = p.get("name")
        bucket = "r_packages" if name in (raw.get("r_packages") or {}) else "python_packages"
        rec = (raw.get(bucket) or {}).get(name) or {}
        if rec.get("installed"):
            if p.get("version") != rec.get("version"):
                mismatched.append("%s: 清单=%s 探针=%s" % (name, p.get("version"), rec.get("version")))
        elif p.get("version") is not None:
            mismatched.append("%s: 探针未安装但清单有版本 %s" % (name, p.get("version")))
    check("所有版本号与探针原始输出一致", not mismatched, "；".join(mismatched))
    check("探针脚本与原始输出留档",
          os.path.isfile(os.path.join(ROOT, "cn_debug", "2026-10-19_s11_collect_versions.py")) and os.path.isfile(RAW))

    # ---- A2 ----
    pdfs = sorted(n for n in os.listdir(TOOL_DIR) if n.lower().endswith(".pdf"))
    index_text = open(INDEX, encoding="utf-8").read()
    missing_in_index = [n for n in pdfs if n not in index_text]
    check("INDEX.md 覆盖 04 目录全部 PDF", not missing_in_index,
          "%d 个 PDF，缺 %s" % (len(pdfs), missing_in_index))
    check("INDEX.md 覆盖 04 全部 PDF（citations.json 亦全）",
          len(cit.get("entries", [])) + len(cit.get("duplicates", [])) >= len(pdfs),
          "entries=%d duplicates=%d pdf=%d" % (len(cit["entries"]), len(cit.get("duplicates", [])), len(pdfs)))
    bad_year = [e["key"] for e in cit["entries"]
                if e.get("year") is not None and not isinstance(e.get("year"), int)]
    check("年份字段要么是整数要么为空（未获取）", not bad_year, bad_year)
    fake_doi = [e["key"] for e in cit["entries"]
                if e.get("doi") and e["doi"] != "未获取" and not re.match(r"^10\.\d{4,9}/\S+$", e["doi"])]
    check("DOI 字段格式合法（10.xxxx/…）或标未获取", not fake_doi, fake_doi)

    # 生成器自检（顺带跑一次 --check）
    out = subprocess.run([sys.executable, os.path.join(ROOT, "ops", "gen_reference_index.py"), "--check"],
                         capture_output=True, text=True)
    check("gen_reference_index.py --check 通过", out.returncode == 0,
          (out.stdout or out.stderr).strip()[:160])

    print("\n%s" % ("全部符合预期" if failed == 0 else "%d 条不符合预期" % failed))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
