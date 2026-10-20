# S3 步骤 2 QC 一次性原型：验证论文阈值影响面 + doublet 交叉 + 基因过滤
# 用完即弃，不进 src/。运行：python3 s3_qc_prototype.py <h5ad>
import sys
import numpy as np
import pandas as pd
import anndata as ad

h5ad_path = sys.argv[1]
adata = ad.read_h5ad(h5ad_path)
print("loaded", adata.shape)

X = adata.X
ncount = np.asarray(X.sum(axis=1)).ravel()
nnz_per_cell = np.asarray((X > 0).sum(axis=1)).ravel()
ercc_mask = adata.var["ercc"].to_numpy(dtype=bool)
ercc_per_cell = np.asarray(X[:, ercc_mask].sum(axis=1)).ravel()
ercc_frac = np.where(ncount > 0, ercc_per_cell / np.maximum(ncount, 1), 0.0)
nnz_gene = np.asarray((X > 0).sum(axis=0)).ravel()

# 与 ingest 落盘的 computed 列对账（确认口径一致）
assert np.allclose(ncount, adata.obs["ncount_computed"] + ercc_per_cell), "ncount 口径不一致"
assert np.array_equal(nnz_per_cell, adata.obs["nfeature_computed"] + np.asarray((X[:, ercc_mask] > 0).sum(axis=1)).ravel()), "nfeature 口径不一致"
print("computed 列口径一致 OK")

for name, arr in [("ncount_total", ncount), ("nfeature_total", nnz_per_cell), ("ercc_frac", ercc_frac)]:
    q = np.percentile(arr, [0, 1, 5, 25, 50, 75, 95, 99, 100])
    print("%s min/p1/p5/p25/p50/p75/p95/p99/max = %s" % (name, " ".join("%.4g" % v for v in q)))

# 论文阈值（按细胞）：nCount_RNA>50000 / nFeature_RNA>1500 / ERCC<15%
# 注意 nCount_RNA 口径 = 总量含 ERCC（ingest 对账确认 soft 剔除 ERCC，矩阵总量含 ERCC）
fail_ncount = ncount <= 50000
fail_nfeature = nnz_per_cell <= 1500
fail_ercc = ercc_frac >= 0.15
fail_any = fail_ncount | fail_nfeature | fail_ercc
print("fail_ncount=%d fail_nfeature=%d fail_ercc=%d fail_any=%d pass=%d" % (
    fail_ncount.sum(), fail_nfeature.sum(), fail_ercc.sum(), fail_any.sum(), (~fail_any).sum()))

# doublet 与 QC 失败的交叉
is_doublet = (adata.obs["class"] == "doublet").to_numpy()
print("doublet=%d singlet=%d" % (is_doublet.sum(), (~is_doublet).sum()))
print("doublet 中 QC fail = %d；singlet 中 QC fail = %d" % ((is_doublet & fail_any).sum(), ((~is_doublet) & fail_any).sum()))

# 排除 doublet 后再看 QC 失败面（若 doublet 单列）
print("若排除 doublet：剩余 %d，其中 QC fail = %d" % (((~is_doublet)).sum(), ((~is_doublet) & fail_any).sum()))

# 基因过滤：在 QC 通过且非 doublet 的细胞上统计表达细胞数
keep_cell = (~fail_any) & (~is_doublet)
nnz_gene_kept = np.asarray((X[keep_cell] > 0).sum(axis=0)).ravel()
for min_cells in (1, 3, 5, 10):
    gene_keep = nnz_gene_kept >= min_cells
    print("gene min_cells>=%d: kept=%d / %d" % (min_cells, gene_keep.sum(), len(gene_keep)))

# 分组分布（QC 通过且 singlet）
obs = adata.obs
df = pd.DataFrame({"group": obs["group"], "donor": obs["donor"], "class": obs["class"],
                   "ncount": ncount, "nfeature": nnz_per_cell, "ercc_frac": ercc_frac,
                   "pass": ~fail_any})
kept = df[(~df["pass"]) == False]
kept = kept[kept["class"] != "doublet"]
print("最终保留按组:", dict(kept["group"].value_counts()))
print("最终保留按供体:", dict(kept["donor"].value_counts()))
print("保留细胞 median ncount=%.0f nfeature=%.0f ercc=%.4f" % (
    kept["ncount"].median(), kept["nfeature"].median(), kept["ercc_frac"].median()))
# 每供体每组的保留矩阵（查有没有整组被打空）
print(pd.crosstab(kept["donor"], kept["group"]))
print("PROTOTYPE_DONE")
