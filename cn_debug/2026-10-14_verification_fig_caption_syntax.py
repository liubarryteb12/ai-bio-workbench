"""出图/分析脚本语法校验：抽取 bash 脚本内的 python heredoc 块逐个 compile()。

支持一个脚本内多个 heredoc 块（如 gsva_pathways 含 PYSCRIPT + RSCRIPT），
只对 python 块做 compile，R 块跳过（由 R 侧运行期校验）。
"""
import pathlib
import re

root = pathlib.Path(r"d:/00.AIagent/codespace/AI辅助生信分析流程工作台")
scripts = [
    "src/line1_bulk/scripts/bulk_figures",
    "src/line1_bulk/scripts/ppi_string",
    "src/line1_bulk/scripts/key_genes",
    "src/line1_bulk/scripts/ml_model",
    "src/line1_bulk/scripts/external_validation",
    "src/line1_bulk/scripts/enrichment_figures",
    "src/line1_bulk/scripts/ml_hub_analysis",
    "src/line2_scrna/scripts/scrna_figures",
    "src/line2_scrna/scripts/scenic_tf",
    "src/line2_scrna/scripts/scenic_figures",
    "src/line2_scrna/scripts/enrichment_figures",
    "src/line2_scrna/scripts/target_gene_localization",
    "src/line2_scrna/scripts/gsva_pathways",
    "src/line2_scrna/scripts/dr_post_analysis",
    "src/line3_spatial/scripts/spatial_figures",
    "src/line3_spatial/scripts/dr_post_analysis",
    "src/line3_spatial/scripts/enrichment",
    "src/line3_spatial/scripts/enrichment_figures",
]
BLOCK = re.compile(r"<<'PYSCRIPT'\n(.*?)\nPYSCRIPT", re.S)
ok = True
for rel in scripts:
    path = root / rel
    text = path.read_text(encoding="utf-8")
    blocks = BLOCK.findall(text)
    if not blocks:
        print("NO_PY_BLOCK:", rel)
        ok = False
        continue
    for i, code in enumerate(blocks):
        try:
            compile(code, "%s#block%d" % (rel, i), "exec")
        except SyntaxError as e:
            ok = False
            print("PY_SYNTAX_ERROR: %s block%d: %s" % (rel, i, e))
    print("PY_SYNTAX_OK: %s (%d block)" % (rel, len(blocks)))
print("ALL_OK" if ok else "FAIL")
