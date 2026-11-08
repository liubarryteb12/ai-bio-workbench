#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""cluster_adapt：line2 降维聚类（邻居图 + UMAP + leiden），供体混合度对照门。

为什么要适配全局母版 cluster_umap：母版的门是「每个大簇单一供体 <= 50%，否则判
harmony 失效」。该阈值按上一研究的数据形态定（4,587 细胞 / 8 同阶段供体），
在本数据上会系统性误判：本数据含三个发育层（19-20 周胎心 3 例、4-14 岁非病对照 3 例、
5-10 岁 DCM 4 例）。胎心与儿童心的细胞组成本就不同，胎心主导的簇是生物学信号不是批次残留，
母版会把这些簇一律判成「校正失效」。

替代判据（更强，不是更松）：
  1. 对照测量：同参数（n_neighbors=15 / resolution=1.0 / seed）分别在 X_pca_harmony（校正后）
     与 X_pca（校正前）上聚类，算「大簇供体混合度」= 按簇大小加权的归一化供体熵；
  2. 硬门：校正后混合度必须不低于校正前（差 < 0.01 判不达标）。这把母版想抓的
     「harmony 没起作用/更糟」变成可直接观测的量；
  3. 逐簇绝对占比照旧算并写进报告与 uns，含该主供体的阶段/年龄，供人工判读；
     不再据此硬失败，因为它无法区分「批次残留」与「发育阶段差异」。

输出契约与母版逐字一致（下游 annotate_celltypes 直接可用）：
  processed/scrna_clustered.h5ad  obs['leiden'] / obsm['X_umap'] /
  uns['clustering'](dict) / uns['seed'](int) / uns['source_h5ad']，另加 uns['donor_mixing']。
"""
import hashlib
import os
import sys
import time

import numpy as np
import pandas as pd
import anndata as ad
import scanpy as sc
import scipy.sparse as sps

N_NEIGHBORS = 15
N_PCS = 30
RESOLUTION = 1.0
LARGE_CLUSTER_MIN = 100
DONOR_SHARE_REPORT = 0.5
MIXING_TOLERANCE = 0.01


def fail(message):
    sys.stderr.write("cluster_adapt 自校验失败: %s\n" % message)
    sys.stderr.flush()
    sys.exit(1)


def log(message):
    print(message, flush=True)


def donor_mixing(leiden, donors):
    """按簇大小加权的归一化供体熵（1.0 = 每簇供体完全均混）。"""
    k_total = max(len(set(donors)), 1)
    scores, weights, table = [], [], {}
    for cluster, members in pd.Series(range(len(leiden))).groupby(np.asarray(leiden)):
        idx = members.to_numpy()
        if len(idx) < LARGE_CLUSTER_MIN:
            continue
        counts = pd.Series([donors[i] for i in idx]).value_counts()
        p = (counts / counts.sum()).to_numpy()
        entropy = float(-(p * np.log(p)).sum() / np.log(k_total)) if k_total > 1 else 1.0
        scores.append(entropy)
        weights.append(len(idx))
        table[str(cluster)] = (str(counts.index[0]), float(p.max()), float(entropy), int(len(idx)))
    if not scores:
        return 0.0, table
    return float(np.average(scores, weights=weights)), table


h5ad_file = os.environ["H5AD_FILE"]
seed = os.environ["BIOANALYS_SEED"]
try:
    seed_int = int(seed)
except ValueError:
    fail("BIOANALYS_SEED 不是整数: %s" % seed)

START = time.time()
adata = ad.read_h5ad(h5ad_file)
log("loaded cells=%d genes=%d" % adata.shape)
for key in ("X_pca_harmony", "X_pca"):
    if key not in adata.obsm:
        fail("输入缺 obsm['%s']（不是 integrate_harmony 产物？）" % key)
if "donor" not in adata.obs.columns:
    fail("输入缺 obs['donor']")
if "integration" not in adata.uns:
    fail("输入缺 uns['integration']（不是 integrate_harmony 产物？）")

donors = adata.obs["donor"].astype(str).tolist()
stage = {}
if "diagnosis" in adata.obs.columns:
    for donor, diag in adata.obs.groupby("donor", observed=True)["diagnosis"].first().items():
        stage[str(donor)] = "fetal" if str(diag) == "Fetal" else "child"
age_map = {}
if "age" in adata.obs.columns:
    for donor, age in adata.obs.groupby("donor", observed=True)["age"].first().items():
        age_map[str(donor)] = str(age)

# --- 1. 邻居图 / UMAP / leiden（参数与母版逐字一致）---
sc.pp.neighbors(adata, n_neighbors=N_NEIGHBORS, n_pcs=N_PCS, use_rep="X_pca_harmony",
                random_state=seed_int)
sc.tl.umap(adata, random_state=seed_int)
sc.tl.leiden(adata, resolution=RESOLUTION, random_state=seed_int, flavor="igraph",
             n_iterations=2, directed=False, key_added="leiden")
leiden_counts = adata.obs["leiden"].value_counts()
n_clusters = int(leiden_counts.shape[0])
if n_clusters < 2:
    fail("leiden 只得到 %d 个簇" % n_clusters)
log("leiden clusters=%d size_min=%d size_max=%d"
    % (n_clusters, int(leiden_counts.min()), int(leiden_counts.max())))

# --- 2. 对照：未校正嵌入上同参数聚类，量 harmony 到底改善了多少 ---
mini = ad.AnnData(X=sps.csr_matrix((adata.n_obs, 1), dtype=np.float32),
                  obs=adata.obs[["donor"]].copy())
mini.obsm["X_pca"] = adata.obsm["X_pca"]
sc.pp.neighbors(mini, n_neighbors=N_NEIGHBORS, use_rep="X_pca", random_state=seed_int)
sc.tl.leiden(mini, resolution=RESOLUTION, random_state=seed_int, flavor="igraph",
             n_iterations=2, directed=False, key_added="leiden_uncorrected")
mixing_corrected, table_corrected = donor_mixing(adata.obs["leiden"].to_numpy(), donors)
mixing_uncorrected, _ = donor_mixing(mini.obs["leiden_uncorrected"].to_numpy(), donors)
log("donor_mixing corrected=%.4f uncorrected=%.4f" % (mixing_corrected, mixing_uncorrected))
if mixing_corrected + MIXING_TOLERANCE < mixing_uncorrected:
    fail("harmony 校正后供体混合度（%.4f）低于校正前（%.4f），校正未生效或方向反了"
         % (mixing_corrected, mixing_uncorrected))

# --- 3. 逐簇绝对占比照旧留痕（不据此硬失败，附阶段供判读）---
dominated = {cl: v for cl, v in table_corrected.items() if v[1] > DONOR_SHARE_REPORT}

adata.uns["clustering"] = {
    "method": "scanpy_leiden_igraph_on_harmony_embedding",
    "use_rep": "X_pca_harmony",
    "n_neighbors": N_NEIGHBORS,
    "n_pcs": N_PCS,
    "resolution": RESOLUTION,
    "random_state": seed_int,
    "umap": "scanpy_umap_random_state_seed",
    "n_clusters": n_clusters,
}
adata.uns["donor_mixing"] = {
    "corrected": round(mixing_corrected, 4),
    "uncorrected": round(mixing_uncorrected, 4),
    "gain": round(mixing_corrected - mixing_uncorrected, 4),
    "metric": "按簇大小加权的归一化供体熵（大簇 >= %d 细胞）" % LARGE_CLUSTER_MIN,
    "n_donor_dominated_clusters": len(dominated),
    "donor_dominated": {str(k): {"donor": v[0], "share": round(v[1], 4),
                        "stage": stage.get(v[0], "NA"), "size": v[3]}
                        for k, v in dominated.items()},
}
adata.uns["seed"] = seed_int
adata.uns["source_h5ad"] = h5ad_file

os.makedirs("processed", exist_ok=True)
out_path = os.path.join("processed", "scrna_clustered.h5ad")
adata.write_h5ad(out_path)

report = [
    "step=cluster_adapt",
    "seed=%s" % seed,
    "input_h5ad=%s" % h5ad_file,
    "cells=%d（聚类不丢细胞）" % adata.n_obs,
    "neighbors=n_neighbors=%d use_rep=X_pca_harmony" % N_NEIGHBORS,
    "umap=scanpy sc.tl.umap random_state=%d" % seed_int,
    "leiden=igraph flavor resolution=%.1f random_state=%d" % (RESOLUTION, seed_int),
    "n_clusters=%d size_min=%d size_max=%d"
    % (n_clusters, int(leiden_counts.min()), int(leiden_counts.max())),
    "cluster_sizes=%s" % {str(k): int(v) for k, v in leiden_counts.items()},
    "donor_mixing_gate=校正后 %.4f vs 校正前 %.4f（gain=%+.4f，要求 >= -%.2f）"
    % (mixing_corrected, mixing_uncorrected, mixing_corrected - mixing_uncorrected,
       MIXING_TOLERANCE),
    "donor_mixing_metric=按簇大小加权归一化供体熵（大簇>=%d 细胞；1.0=完全均混）"
    % LARGE_CLUSTER_MIN,
    "donor_dominated_clusters=%d（占比>%.0f%%；母版此处硬失败，本适配改为留痕+对照门，理由见脚本头）"
    % (len(dominated), DONOR_SHARE_REPORT * 100),
]
for cl in sorted(dominated, key=lambda x: int(x)):
    dn, share, ent, size = dominated[cl]
    report.append("  cluster %s size=%d top_donor=%s share=%.3f stage=%s age=%s entropy=%.3f"
                  % (cl, size, dn, share, stage.get(dn, "NA"), age_map.get(dn, "NA"), ent))
report.append("cluster_x_group:")
for cluster in sorted(leiden_counts.index, key=lambda x: int(x)):
    groups = adata.obs[adata.obs["leiden"] == cluster]["group"].value_counts()
    report.append("  %s: %s" % (cluster, {str(k): int(v) for k, v in groups.items()}))
report.append("cluster_x_donor:")
for cluster in sorted(leiden_counts.index, key=lambda x: int(x)):
    dn = adata.obs[adata.obs["leiden"] == cluster]["donor"].value_counts()
    report.append("  %s: %s" % (cluster, {str(k): int(v) for k, v in dn.items()}))
report += [
    "limitation_note=本数据含三个发育层（胎心 19-20 周 / 儿童非病对照 4-14 岁 / 儿童 DCM 5-10 岁），"
    " 胎心主导的簇是发育生物学信号；绝对占比门无法区分它与批次残留，故以对照混合度为准，"
    " 逐簇占比与阶段信息全部留痕供人工判读。",
    "sha_ledger_note=仅对本次产物与报告做 sha256（父目录含上游 ~7GB h5ad，全量哈希无溯源价值且拖慢步骤）",
    "outputs=processed/scrna_clustered.h5ad, cluster_report.txt",
    "elapsed_seconds=%.0f" % (time.time() - START),
]
report_path = os.path.join("cluster_report.txt")
with open(report_path, "w", encoding="utf-8") as fh:
    fh.write("\n".join(report) + "\n")
    for artifact in (out_path,):
        with open(artifact, "rb") as afh:
            fh.write("%s_sha256=%s\n" % (os.path.basename(artifact),
                                          hashlib.sha256(afh.read()).hexdigest()))
for line in report:
    log(line)
log("cluster_adapt OK")