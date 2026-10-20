#!/usr/bin/env python3
"""临时排查：把 17 个出图脚本的 PYSCRIPT heredoc 全抠出来逐块编译，报语法错误。

背景：服务器真数据审计时 ml_model / ppi_string 报 SyntaxError，需要先确认
是"我植入的 helper 块本身有语法问题"还是"审计脚本的 heredoc 提取截错位置"。
"""
import io
import re
import sys
import py_compile

SCRIPTS = [
    "src/line1_bulk/scripts/bulk_figures",
    "src/line1_bulk/scripts/enrichment_figures",
    "src/line1_bulk/scripts/external_validation",
    "src/line1_bulk/scripts/key_genes",
    "src/line1_bulk/scripts/ml_hub_analysis",
    "src/line1_bulk/scripts/ml_model",
    "src/line1_bulk/scripts/ppi_string",
    "src/line2_scrna/scripts/dr_post_analysis",
    "src/line2_scrna/scripts/enrichment_figures",
    "src/line2_scrna/scripts/gsva_pathways",
    "src/line2_scrna/scripts/scenic_figures",
    "src/line2_scrna/scripts/scrna_figures",
    "src/line2_scrna/scripts/target_gene_localization",
    "src/line3_spatial/scripts/celltype_annotation",
    "src/line3_spatial/scripts/dr_post_analysis",
    "src/line3_spatial/scripts/enrichment_figures",
    "src/line3_spatial/scripts/spatial_figures",
]

PAT = re.compile(r"<<'PYSCRIPT'\n(.*?)\nPYSCRIPT", re.S)


def main():
    bad = 0
    for rel in SCRIPTS:
        text = io.open(rel, encoding="utf-8", errors="replace").read()
        blocks = PAT.findall(text)
        if not blocks:
            print("NOHEREDOC %s" % rel)
            bad += 1
            continue
        line0 = 0
        ok = 0
        for i, code in enumerate(blocks):
            try:
                compile(code, "%s#block%d" % (rel, i), "exec")
                ok += 1
            except SyntaxError as exc:
                bad += 1
                # 报错行号是块内相对行号；折算回文件行号供定位
                start = text.find(code)
                file_line = text[:start].count("\n") + 1 + (exc.lineno or 0)
                print("SYNTAXERR %s block%d 文件行~%d: %s"
                      % (rel, i, file_line, exc.msg))
                blk = code.split("\n")
                lo = max(0, (exc.lineno or 1) - 4)
                hi = min(len(blk), (exc.lineno or 1) + 2)
                for k in range(lo, hi):
                    print("      %4d| %s" % (k + 1, blk[k]))
        print("OK %s blocks=%d compiled=%d" % (rel, len(blocks), ok))
    print("bad=%d" % bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
