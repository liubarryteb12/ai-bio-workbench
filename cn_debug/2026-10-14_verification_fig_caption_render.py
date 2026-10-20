import os
import pathlib
import re

import numpy as np
import pandas as pd

root = pathlib.Path(r"d:/00.AIagent/codespace/AI辅助生信分析流程工作台")
base = root / "cn_debug/fig_caption_check"
proc = base / "processed"
figs = base / "figures"
proc.mkdir(parents=True, exist_ok=True)
figs.mkdir(parents=True, exist_ok=True)

rng = np.random.default_rng(42)
samples = ["S%02d" % i for i in range(1, 17)]
groups = ["LS"] * 8 + ["NLS"] * 8
genes = ["GENE%03d" % i for i in range(60)]

M = rng.normal(8, 1.5, size=(len(genes), len(samples)))
df = pd.DataFrame(M, index=genes, columns=samples)
df.insert(0, "gene", genes)
df.to_csv(proc / "expr_genes.tsv", sep="\t", index=False)

pcs = rng.normal(0, 3, size=(16, 2))
pcs[:8, 0] -= 4
pd.DataFrame({"sample": samples, "group": groups,
              "PC1": pcs[:, 0], "PC2": pcs[:, 1]}).to_csv(
    proc / "pca_scores.tsv", sep="\t", index=False)

pd.DataFrame({"sample": samples, "group": groups,
              "genes_detected": rng.integers(8000, 14000, 16),
              "median_within_group_cor": rng.uniform(0.85, 0.99, 16)}).to_csv(
    proc / "sample_qc.tsv", sep="\t", index=False)

pd.DataFrame({"sample": samples, "group": groups}).to_csv(
    proc / "group_map.tsv", sep="\t", index=False)

n = 2000
l2 = rng.normal(0, 1.2, n)
pv = rng.uniform(0, 1, n)
padj = np.clip(pv * 2, 0, 1)
pd.DataFrame({"gene": ["G%04d" % i for i in range(n)], "log2FC": l2,
              "AveExpr": rng.normal(8, 2, n), "P_Value": pv,
              "adj_P_Val": padj}).to_csv(proc / "deg_all.tsv", sep="\t", index=False)

text = (root / "src/line1_bulk/scripts/bulk_figures").read_text(encoding="utf-8")
code = re.search(r"python3 - <<'PYSCRIPT'\n(.*)\nPYSCRIPT", text, re.S).group(1)
os.environ["FIG_DIR"] = str(proc)
exec(compile(code, "bulk_figures", "exec"), {"__name__": "__main__"})
print("OUTPUT_DIR", figs)
