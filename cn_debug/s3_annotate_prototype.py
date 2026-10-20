# S3 步骤 6 细胞类型注释一次性原型：探测作者注释分布 + marker 基因比对可行性
# 用完即弃，不进 src/。运行：python3 s3_annotate_prototype.py <h5ad>
import sys
import numpy as np
import pandas as pd
import anndata as ad
import scanpy as sc

h5ad_path = sys.argv[1]
adata = ad.read_h5ad(h5ad_path)
print("loaded", adata.shape)
print("leiden clusters:", adata.obs["leiden"].nunique())
print("celltype_paper counts:")
print(adata.obs["celltype_paper"].value_counts().to_dict())
print()
print("crosstab leiden x celltype_paper:")
ct = pd.crosstab(adata.obs["leiden"], adata.obs["celltype_paper"])
print(ct.to_string())
print()
print("NA celltype count:", int((adata.obs["celltype_paper"] == "NA").sum()))

# marker 基因（wilcoxon vs rest，用 layers counts 还是 X？注释用归一化 X 合理）
sc.tl.rank_genes_groups(adata, groupby="leiden", method="wilcoxon", n_genes=20)
result = adata.uns["rank_genes_groups"]
for cluster in sorted(adata.obs["leiden"].unique(), key=lambda s: int(s)):
    names = list(result["names"][cluster])
    scores = list(result["scores"][cluster])
    top10 = ["%s(%.1f)" % (n, s) for n, s in zip(names[:10], scores[:10])]
    paper = adata.obs[adata.obs["leiden"] == cluster]["celltype_paper"].value_counts()
    print("cluster %s (n=%d): paper=%s" % (cluster, int((adata.obs['leiden'] == cluster).sum()), paper.to_dict()))
    print("   markers:", " ".join(top10))
print("PROTOTYPE_DONE")
