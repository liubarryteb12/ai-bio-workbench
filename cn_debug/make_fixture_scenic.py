"""自检夹具：造 scenic_figures 的最小合成输入（仅供 cn_debug 审计，不入交付包）。

列名刻意取长（activated_keratinocyte 这类），用于验证长标签换行与"不越出图框"。
"""
import os

import numpy as np

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "2026-10-18_tmp_scenic_audit", "work")
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(20261018)

celltypes = ["activated_keratinocyte", "progenitor_keratinocyte",
             "channel_keratinocyte", "cycling_basal_keratinocyte",
             "macrophage_mDC", "Langerhans_cell", "T_cell", "NK_cell",
             "endothelial_venule", "fibroblast_papillary", "mast_cell", "B_cell"]
regulons = ["MX1", "STAT1", "IRF7", "NFKB1", "RELA", "JUN", "FOS", "EGR1",
            "ATF3", "CEBPB", "SPI1", "PU1", "MYC", "TP53", "FOXO1", "XBP1",
            "BACH1", "NRF2", "HIF1A", "KLF4", "KLF6", "ELF3", "GATA3", "TBX21",
            "RUNX3", "PRDM1", "IRF4", "BLIMP1", "BATF", "MAFB"]

mat = np.abs(rng.normal(0.4, 0.25, size=(len(celltypes), len(regulons))))
with open(os.path.join(OUT, "scenic_regulon_by_celltype.tsv"), "w",
          encoding="utf-8") as fh:
    fh.write("celltype\t" + "\t".join(regulons) + "\n")
    for i, ct in enumerate(celltypes):
        fh.write(ct + "\t" + "\t".join("%.4f" % v for v in mat[i]) + "\n")

with open(os.path.join(OUT, "scenic_tf_summary.tsv"), "w", encoding="utf-8") as fh:
    fh.write("regulon\tspecificity_z\ttop_celltype\tn_cells\n")
    zs = sorted(np.abs(rng.normal(2.2, 0.8, size=len(regulons))), reverse=True)
    for k, reg in enumerate(regulons):
        # 让前几名落在超长 celltype 名上，专门触发标签溢出场景
        ct = celltypes[k % len(celltypes)]
        fh.write("%s\t%.4f\t%s\t%d\n" % (reg, zs[k], ct, 100 + k))

print("fixture ->", OUT)
