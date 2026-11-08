#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""annotate_cardiac：心脏大类注释（替代旧母版 14 类皮肤免疫 marker 口径）。

输入：cluster 产物 processed/scrna_clustered.h5ad（obs['leiden']、uns['clustering']、obsm['X_umap']）。
输出：processed/scrna_annotated.h5ad、processed/cluster_markers.tsv、
      processed/cluster_celltype_scores.tsv、annotate_report.txt。

打分口径（为什么不用「top20 marker 命中数」）：
  上一版按每簇 wilcoxon top20 里命中几个 marker 打分，实测半数簇判 unknown（top20 只覆盖
  每簇 20 个基因，marker 集 3-8 个基因，命中概率极低）。改成标准做法：对每个细胞类型，
  用 sc.tl.score_genes 在**全基因组表达**上算每细胞打分（marker 集均值减去对照基因集均值），
  再按簇取均值；argmax 且分数高于阈值才定类型，否则 unknown 不硬猜。
  同时保留 wilcoxon top20 marker 表作为可复核证据，并把「簇 x 细胞类型」完整打分矩阵落盘。

paper 对照：GSE185100 无作者细胞级注释，celltype_paper/seurat_cluster_paper/celltype_paper_major
  一律 NA（后两者只为满足下游契约列存在性），报告明确写「不适用」，不伪装一致率。
"""
import os
import sys
import time

import numpy as np
import pandas as pd
import anndata as ad
import scanpy as sc

N_MARKER_GENES = 20
MIN_SCORE = 0.10          # score_genes 是 z 量纲：>0.1 表示 marker 集相对对照基因集富集
MIN_GENES_PER_SET = 2     # marker 集在数据里至少命中 2 个才参与打分

CELLTYPE_MARKERS = {
    "cardiomyocyte": ["NPPA", "MYH7", "MYH6", "TNNT2", "ACTC1", "TTN", "MYL7", "MYL2"],
    "fibroblast": ["DDR2", "TCF21", "POSTN", "LUM", "THY1", "COL1A1", "COL1A2", "FN1"],
    "endothelial": ["PECAM1", "VWF", "CDH5", "KDR", "NPR3"],
    "smooth_muscle": ["MYH11", "ACTA2", "TAGLN", "MYL9"],
    "epicardial": ["WT1", "UPK3B", "KRT19"],
    "macrophage": ["C1QA", "C1QB", "CD68", "LYVE1", "CSF1R"],
    "T_cell": ["CD3E", "CD2", "IL7R"],
    "B_cell": ["CD79A", "MS4A1"],
    "mast": ["TPSAB2", "CPA3"],
    "pericyte": ["DCN", "PDGFRB", "NOTCH3"],
    "schwann_nerve": ["S100B", "PLP1", "MPZ"],
}


def fail(message):
    sys.stderr.write("annotate_cardiac 自校验失败: %s\n" % message)
    sys.stderr.flush()
    sys.exit(1)


def log(message):
    print(message, flush=True)


h5ad_file = os.environ["H5AD_FILE"]
seed = os.environ["BIOANALYS_SEED"]
seed_int = int(seed)
START = time.time()

adata = ad.read_h5ad(h5ad_file)
log("loaded cells=%d genes=%d" % adata.shape)
required_obs = ["donor", "diagnosis", "region", "group", "class", "plate", "well",
                "celltype_paper", "seurat_cluster_paper", "leiden"]
missing = [c for c in required_obs if c not in adata.obs.columns]
if missing:
    fail("输入 h5ad 缺少 obs 列 %s" % missing)
if "clustering" not in adata.uns:
    fail("输入 h5ad 缺少 uns['clustering']")
if "X_umap" not in adata.obsm:
    fail("输入 h5ad 缺少 obsm['X_umap']")

leiden_before = sorted(adata.obs["leiden"].unique(), key=lambda s: int(s))
n_cells_before = adata.shape[0]

# --- 1. marker 证据表：wilcoxon 每簇 top20（可复核，不直接用于判定）---
sc.tl.rank_genes_groups(adata, groupby="leiden", method="wilcoxon",
                        n_genes=N_MARKER_GENES, use_raw=False)
rgg = adata.uns["rank_genes_groups"]
if set(rgg["names"].dtype.names) != set(leiden_before):
    fail("marker 输出簇集合与 obs['leiden'] 不一致")

symbols = (adata.var["gene_symbol"].astype(str).to_numpy()
           if "gene_symbol" in adata.var.columns else adata.var_names.astype(str).to_numpy())
ens_to_sym = {ens: sym for ens, sym in zip(adata.var_names.astype(str), symbols)}
sym_to_ens = {}
for ens, sym in zip(adata.var_names.astype(str), symbols):
    sym_to_ens.setdefault(sym.upper(), []).append(ens)
dup_symbols = {s: len(v) for s, v in sym_to_ens.items() if len(v) > 1}

marker_rows = []
for cluster in leiden_before:
    genes = list(rgg["names"][cluster])
    for rank, (gene, s, lfc, pv) in enumerate(zip(genes, rgg["scores"][cluster],
                                                  rgg["logfoldchanges"][cluster],
                                                  rgg["pvals_adj"][cluster]), start=1):
        marker_rows.append({"cluster": cluster, "rank": rank, "gene": gene,
                            "gene_symbol": ens_to_sym.get(gene, gene),
                            "score": float(s),
                            "log2fc": float(lfc) if np.isfinite(lfc) else np.nan,
                            "pvals_adj": float(pv)})

# --- 2. marker 集打分：score_genes（全基因组），按簇取均值 ---
set_coverage = {}
scored_types = []
for celltype, markers in CELLTYPE_MARKERS.items():
    present = [g for g in markers if g.upper() in sym_to_ens]
    set_coverage[celltype] = {"declared": len(markers), "present": len(present),
                              "missing": [g for g in markers if g not in present]}
    if len(present) < MIN_GENES_PER_SET:
        log("skip %s: 只有 %d/%d 个 marker 在数据里" % (celltype, len(present), len(markers)))
        continue
    gene_list = [sym_to_ens[g.upper()][0] for g in present]   # 多 Ensembl 同 symbol 取首个
    sc.tl.score_genes(adata, gene_list, score_name="score_" + celltype, random_state=seed_int,
                      ctrl_size=max(50, len(gene_list) * 5))
    scored_types.append(celltype)
if not scored_types:
    fail("没有任何细胞类型的 marker 集可用")

score_cols = ["score_" + ct for ct in scored_types]
cluster_scores = adata.obs.groupby("leiden", observed=True)[score_cols].mean()
cluster_scores = cluster_scores.loc[leiden_before]
cluster_scores.to_csv("cluster_celltype_scores.tsv", sep="\t",
                      index_label="cluster")

cluster_annotation = {}
for cluster in leiden_before:
    row = cluster_scores.loc[cluster]
    best = row.idxmax()
    best_score = float(row.max())
    second = float(row.drop(best).max()) if len(row) > 1 else float("-inf")
    best_type = best[len("score_"):]
    if best_score < MIN_SCORE:
        annotation = "unknown"
    else:
        annotation = best_type
    cluster_annotation[cluster] = {
        "annotation": annotation,
        "best_type_raw": best_type,
        "score": best_score,
        "margin": best_score - second,
        "sizes": int((adata.obs["leiden"] == cluster).sum()),
    }
    log("cluster %s (n=%d) -> %s score=%.3f margin=%.3f raw_best=%s"
        % (cluster, cluster_annotation[cluster]["sizes"], annotation, best_score,
           best_score - second, best_type))

adata.obs["celltype"] = adata.obs["leiden"].map(lambda c: cluster_annotation[c]["annotation"])
adata.obs["celltype_paper_major"] = "NA"
if adata.obs["celltype"].isna().any():
    fail("存在细胞未分到注释")
if sorted(adata.obs["leiden"].unique(), key=lambda s: int(s)) != leiden_before:
    fail("leiden 簇集合在注释前后变化")
if adata.shape[0] != n_cells_before:
    fail("细胞数变化")

unknown_clusters = [c for c, v in cluster_annotation.items() if v["annotation"] == "unknown"]
celltype_counts = {str(k): int(v) for k, v in adata.obs["celltype"].value_counts().items()}
low_margin = [c for c, v in cluster_annotation.items() if v["margin"] < 0.05]

adata.uns["annotation"] = {
    "method": "scanpy_score_genes_per_celltype_then_cluster_mean",
    "min_score": MIN_SCORE,
    "min_genes_per_set": MIN_GENES_PER_SET,
    "granularity": "heart_major_class_11",
    "marker_sets": {k: list(v) for k, v in CELLTYPE_MARKERS.items()},
    "marker_set_coverage": set_coverage,
    "scored_types": scored_types,
    "cluster_annotation": {c: {"annotation": v["annotation"], "score": round(v["score"], 4),
                               "margin": round(v["margin"], 4), "n_cells": v["sizes"]}
                            for c, v in cluster_annotation.items()},
    "paper_overall_agreement": "not_applicable_no_author_annotation",
    "unknown_clusters": unknown_clusters,
    "low_margin_clusters": low_margin,
    "seed": seed_int,
}
adata.uns["cluster_markers"] = pd.DataFrame(marker_rows)
adata.uns["seed"] = seed_int
adata.uns["source_h5ad"] = h5ad_file
adata.write_h5ad("scrna_annotated.h5ad")
pd.DataFrame(marker_rows).to_csv("cluster_markers.tsv", sep="\t", index=False)

per_cluster = ["  %s n=%d -> %s score=%.3f margin=%.3f"
               % (c, v["sizes"], v["annotation"], v["score"], v["margin"])
               for c, v in sorted(cluster_annotation.items(), key=lambda kv: int(kv[0]))]
report = [
    "step=annotate_cardiac",
    "seed=%s" % seed,
    "input_h5ad=%s" % h5ad_file,
    "clusters=%d cells=%d" % (len(leiden_before), n_cells_before),
    "marker_method=sc.tl.score_genes（marker 集均值 - 对照基因集均值，z 量纲）按簇取均值；"
    "min_score=%.2f；wilcoxon top%d 另存为可复核证据" % (MIN_SCORE, N_MARKER_GENES),
    "marker_set_coverage=%s" % {k: "%d/%d" % (v["present"], v["declared"])
                                 for k, v in set_coverage.items()},
    "scored_types=%s" % scored_types,
    "celltype_counts=%s" % celltype_counts,
    "unknown_clusters=%s" % (unknown_clusters or "无"),
    "low_margin_clusters(<0.05)=%s" % (low_margin or "无"),
    "ambiguous_symbols=%d（同 symbol 对应多个 Ensembl，打分取 var 顺序首个）" % len(dup_symbols),
    "paper_agreement=不适用（celltype_paper 全 NA，GSE185100 无作者细胞级注释，不计算一致率）",
    "per_cluster_begin",
    *per_cluster,
    "per_cluster_end",
    "limitation_note=注释是 marker 集自动打分结果，未经作者注释或专家核验；"
    " 本数据为 snRNA（核内），TTN/MYH6 等长基因可能受内含子信号影响，心肌亚型不再细分；"
    " 低于阈值的簇记 unknown 不硬猜；低 margin 簇（次优类型分数接近）已单列供复核。",
    "elapsed_seconds=%.0f" % (time.time() - START),
    "outputs=scrna_annotated.h5ad, cluster_markers.tsv, cluster_celltype_scores.tsv, annotate_report.txt",
]
with open("annotate_report.txt", "w", encoding="utf-8") as fh:
    fh.write("\n".join(report) + "\n")
for line in report:
    log(line)
log("annotate_cardiac OK")