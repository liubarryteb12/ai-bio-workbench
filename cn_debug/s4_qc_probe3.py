# s4_qc_probe3.py：基因级 spot 计数分布：定 GENE_MIN_SPOTS 阈值
import numpy as np
import anndata as ad

PROCESSED = "/mnt/ssd/bio_data/line3_spatial/processed"

for tag in ("mouse", "human"):
    a = ad.read_h5ad("%s/spatial_counts_%s.h5ad" % (PROCESSED, tag))
    gene_spots = np.bincount(a.X.indices, minlength=a.n_vars)
    gene_umis = np.asarray(a.X.sum(axis=0)).ravel()
    print("=== %s === spots=%d genes=%d nnz=%d" % (tag, a.n_obs, a.n_vars, a.X.nnz))
    for thr in (1, 2, 3, 5, 10):
        keep = gene_spots >= thr
        print("gene_spots>=%2d: keep %5d / %d (%.1f%% genes, %.1f%% umis)"
              % (thr, keep.sum(), a.n_vars, keep.mean() * 100,
                 gene_umis[keep].sum() / gene_umis.sum() * 100))
    hist = np.bincount(np.minimum(gene_spots, 10))
    print("gene_spots histogram (0..10+): %s" % hist[:11].tolist())
    # 被 <3 滤掉的基因的总 UMI 占比
    keep3 = gene_spots >= 3
    print("dropped(<3) genes umi share: %.3f%%" % (gene_umis[~keep3].sum() / gene_umis.sum() * 100))
    print()
