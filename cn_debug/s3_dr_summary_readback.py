# s3_dr_summary_readback.py — 一次性回读验证
# 验证步骤 10 两产物：tsv 结构 + report 内容完整性
import pandas as pd

summary = pd.read_csv("/mnt/ssd/bio_data/line2_scrna/processed/dr_genes_summary.tsv", sep="\t")
print("columns:", list(summary.columns))
print("n_rows:", summary.shape[0])
print("rank:", summary["rank"].tolist())
print("genes:", summary["Gene"].tolist())
print("direction:", summary["direction"].tolist())
print("marker_celltypes:", summary["marker_celltypes"].tolist())
print("top_expr_celltype:", summary["top_expr_celltype"].tolist())
print("top_expr_prop:", summary["top_expr_prop"].tolist())
assert summary.shape[0] == 4
assert summary["rank"].tolist() == [1, 2, 3, 4]
assert "TNF" not in summary["Gene"].tolist()

with open("/mnt/ssd/bio_data/line2_scrna/processed/dr_summary_report.txt") as fh:
    report = fh.read()
print("--- report (%d chars) ---" % len(report))
print(report)
