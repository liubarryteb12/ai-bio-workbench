# s4_domains_probe2：修正空间连贯性指标（逐样本算，避免跨样本坐标重叠干扰）
import time
from collections import Counter

import numpy as np
import anndata as ad
import scanpy as sc
from scipy.spatial import cKDTree

ad.settings.allow_write_nullable_strings = False

PATHS = {
    "mouse": "/mnt/ssd/bio_data/line3_spatial/processed/spatial_dimred_mouse.h5ad",
    "human": "/mnt/ssd/bio_data/line3_spatial/processed/spatial_dimred_human.h5ad",
}
SEED = 20261013

for species, path in PATHS.items():
    a = ad.read_h5ad(path)
    print("=== %s spots=%d samples=%d" % (species, a.shape[0], a.obs["sample_id"].nunique()))

    for res in [0.5, 1.0]:
        t0 = time.time()
        labels_all = np.empty(a.shape[0], dtype=object)
        for sample in a.obs["sample_id"].unique():
            mask = (a.obs["sample_id"] == sample).to_numpy()
            sub = a[mask].copy()
            sc.pp.neighbors(sub, n_neighbors=15, n_pcs=30, random_state=SEED)
            sc.tl.leiden(sub, resolution=res, flavor="igraph", n_iterations=2,
                         directed=False, random_state=SEED)
            labels_all[mask] = [sample + "_d" + str(x) for x in sub.obs["leiden"].astype(str)]
        elapsed = time.time() - t0

        # 逐样本空间连贯性（样本内 KD 树）
        coherences = []
        for sample in a.obs["sample_id"].unique():
            mask = (a.obs["sample_id"] == sample).to_numpy()
            coords = a.obsm["spatial"][mask]
            labels = labels_all[mask]
            tree = cKDTree(coords)
            _, idx = tree.query(coords, k=2)
            coherences.append(float((labels[idx[:, 1]] == labels).mean()))
        sizes = Counter(labels_all)
        n_small_domains = sum(1 for v in sizes.values() if v < 30)
        print("res=%.1f %.1fs domains=%d per_sample=%s | 逐样本连贯性 mean=%.4f min=%.4f | <30 spots 域数=%d"
              % (res, elapsed, len(sizes), sorted(Counter(labels_all).values())[-3:], np.mean(coherences), np.min(coherences), n_small_domains))
print("PROBE2_DONE")
