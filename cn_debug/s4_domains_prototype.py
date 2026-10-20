# s4_domains_prototype：线3 步骤 5 空间域识别原型探针（一次性，服务器 /tmp 跑）
# 目的：
#   1. 计时：逐样本 neighbors + leiden（mouse 10 样本 × ~1700 spots，human 5 样本 × ~1400）
#   2. 域数 / 域大小分布（resolution=1.0）
#   3. 空间连贯性诊断：spot 的像素空间最近邻与自身同域的比例（越接近 1 域越贴合空间结构）
#   4. resolution 敏感性：0.5 / 1.0 / 1.5 域数对比，定稿口径
import time
from collections import Counter

import numpy as np
import anndata as ad
import scanpy as sc

ad.settings.allow_write_nullable_strings = False

PATHS = {
    "mouse": "/mnt/ssd/bio_data/line3_spatial/processed/spatial_dimred_mouse.h5ad",
    "human": "/mnt/ssd/bio_data/line3_spatial/processed/spatial_dimred_human.h5ad",
}
SEED = 20261013


def spatial_coherence(coords, labels):
    # 像素空间最近邻（欧氏，fullres 像素坐标）与自身同域比例
    from scipy.spatial import cKDTree
    tree = cKDTree(coords)
    _, idx = tree.query(coords, k=2)  # 第 0 个是自己
    nn_labels = labels[idx[:, 1]]
    return float((nn_labels == labels).mean())


for species, path in PATHS.items():
    a = ad.read_h5ad(path)
    print("=== %s spots=%d genes=%d samples=%d" % (species, a.shape[0], a.shape[1], a.obs["sample_id"].nunique()))
    coords_all = a.obsm["spatial"]

    for res in [0.5, 1.0, 1.5]:
        t0 = time.time()
        labels_all = np.empty(a.shape[0], dtype=object)
        n_domains = {}
        for sample in a.obs["sample_id"].unique():
            mask = (a.obs["sample_id"] == sample).to_numpy()
            sub = a[mask].copy()
            sc.pp.neighbors(sub, n_neighbors=15, n_pcs=30, random_state=SEED)
            sc.tl.leiden(sub, resolution=res, flavor="igraph", n_iterations=2,
                         directed=False, random_state=SEED)
            labels_all[mask] = [sample + "_d" + str(x) for x in sub.obs["leiden"].astype(str)]
            n_domains[sample] = sub.obs["leiden"].nunique()
        elapsed = time.time() - t0
        coh = spatial_coherence(coords_all, labels_all.astype(str))
        sizes = Counter(labels_all)
        small = sum(v for k, v in sizes.items() if v < 30)
        print("res=%.1f %.1fs domains_total=%d per_sample=%s | 空间连贯性=%.4f | <30 spots 的域=%d"
              % (res, elapsed, len(sizes), sorted(n_domains.values()), coh, small))

    # resolution=1.0 下域大小明细（前 5 大 + 最小 3 个）
    labels_all = np.empty(a.shape[0], dtype=object)
    for sample in a.obs["sample_id"].unique():
        mask = (a.obs["sample_id"] == sample).to_numpy()
        sub = a[mask].copy()
        sc.pp.neighbors(sub, n_neighbors=15, n_pcs=30, random_state=SEED)
        sc.tl.leiden(sub, resolution=1.0, flavor="igraph", n_iterations=2,
                     directed=False, random_state=SEED)
        labels_all[mask] = [sample + "_d" + str(x) for x in sub.obs["leiden"].astype(str)]
    sizes = Counter(labels_all)
    print("res=1.0 域大小 top5=%s min3=%s" % (sizes.most_common(5), sorted(sizes.items(), key=lambda kv: kv[1])[:3]))
print("PROTOTYPE_DONE")
