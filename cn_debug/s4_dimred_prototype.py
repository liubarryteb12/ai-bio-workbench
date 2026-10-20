# s4_dimred_prototype：线3 步骤 4 降维原型探针（一次性，服务器 /tmp 跑）
# 目的：
#   1. 计时：HVG 2000 子集上 scale / PCA(50) / neighbors+UMAP 各段耗时（mouse 17k spots）
#   2. 方差结构：PC1 / cum10 / cum30 解释率
#   3. sample 与 group 在 PCA 前 10 维上的 silhouette（采样 5000 spots 近似），
#      作为"是否需要跨样本批次校正"的决策证据：空间域识别下游逐样本做，
#      若 sample 主导方差属预期（不同组织区域），报告如实记录即可
#   4. obs 列名核对（下游着色与分组用）
import time

import numpy as np
import anndata as ad
import scanpy as sc
from sklearn.metrics import silhouette_score

ad.settings.allow_write_nullable_strings = False

PATHS = {
    "mouse": "/mnt/ssd/bio_data/line3_spatial/processed/spatial_norm_mouse.h5ad",
    "human": "/mnt/ssd/bio_data/line3_spatial/processed/spatial_norm_human.h5ad",
}

for species, path in PATHS.items():
    a = ad.read_h5ad(path)
    print("=== %s spots=%d genes=%d" % (species, a.shape[0], a.shape[1]))
    print("obs columns: %s" % list(a.obs.columns))

    hvg = a.var["highly_variable"].to_numpy(dtype=bool)
    sub = a[:, hvg].copy()
    print("hvg subset %d x %d" % sub.shape)

    t0 = time.time()
    sc.pp.scale(sub, max_value=10)
    t1 = time.time()
    sc.tl.pca(sub, n_comps=50, random_state=0)
    t2 = time.time()
    vr = sub.uns["pca"]["variance_ratio"]
    print("scale %.1fs pca %.1fs | PC1=%.3f%% cum10=%.3f%% cum30=%.3f%%"
          % (t1 - t0, t2 - t1, vr[0] * 100, vr[:10].sum() * 100, vr[:30].sum() * 100))

    # sample/group silhouette（采样控制 O(n^2) 成本）
    rng = np.random.default_rng(0)
    n = sub.shape[0]
    idx = rng.choice(n, size=min(5000, n), replace=False)
    emb = sub.obsm["X_pca"][idx][:, :10]
    for key in ["sample", "group"]:
        if key in sub.obs.columns:
            labels = sub.obs[key].to_numpy()[idx]
            if len(np.unique(labels)) > 1:
                sil = silhouette_score(emb, labels, sample_size=None)
                print("silhouette(%s, PCA10) = %.4f" % (key, sil))

    t3 = time.time()
    sc.pp.neighbors(sub, n_neighbors=15, n_pcs=30, random_state=0)
    sc.tl.umap(sub, random_state=0)
    t4 = time.time()
    print("neighbors+umap %.1fs | X_umap shape=%s finite=%s"
          % (t4 - t3, sub.obsm["X_umap"].shape,
             bool(np.isfinite(sub.obsm["X_umap"]).all())))

    # scale 后 dtype 与稀疏性检查
    print("X after scale: type=%s dtype=%s" % (type(sub.X).__name__, sub.X.dtype))
    print("layers['counts'] kept: %s nnz=%d" % ("counts" in sub.layers, sub.layers["counts"].nnz))
print("PROTOTYPE_DONE")
