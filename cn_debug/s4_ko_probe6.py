#!/usr/bin/env python3
"""步骤 13 探针 6：逐样本路线可行性定性。

背景：域聚合路线（mouse 57 / human 18 pseudo-cell）在 human 上 QC 后只剩 1 个
pseudo-cell 直接崩，改走 aims.txt 允许的"子集运行"分支 = 逐样本把 spot 当单元。
本探针回答：
  1. 每个样本有多少 spot，分几个域；
  2. KO 基因（mouse Spp1 / human SPP1）在各样本的表达量与表达 spot 占比；
  3. 模拟 scTenifold QC（剔 lib<1000 spot、mito 比>0.1 spot）后，每样本剩多少 spot，
     KO 基因是否仍满足"表达 spot 占比 >= 5%"（否则会被 QC 过滤掉、样本作废）。
只读，不改产物。
"""
import numpy as np
import anndata as ad

PATHS = {
    "mouse": "/mnt/ssd/bio_data/line3_spatial/processed/spatial_localization_mouse.h5ad",
    "human": "/mnt/ssd/bio_data/line3_spatial/processed/spatial_localization_human.h5ad",
}
KO = {"mouse": "Spp1", "human": "SPP1"}

for species, path in PATHS.items():
    a = ad.read_h5ad(path)
    print("=" * 70)
    print("[%s] spots=%d genes=%d" % (species, a.shape[0], a.shape[1]))
    counts = a.layers["counts"].tocsr()
    total = np.asarray(counts.sum(axis=1)).ravel()
    symbols = a.var["gene_symbol"].astype(str).tolist()
    ko_sym = KO[species]
    # 大小写归一找 KO 基因（mouse Title case）
    up = {}
    for i, s in enumerate(symbols):
        up.setdefault(s.upper(), i)
    ko_i = up.get(ko_sym.upper())
    print("KO gene=%s var_idx=%s" % (ko_sym, ko_i))
    if ko_i is None:
        print("  KO 基因未在 var 中！")
        continue
    ko_expr = np.asarray(counts[:, ko_i].todense()).ravel()
    print("KO 全库 counts sum=%d，表达 spot 占比=%.4f" % (ko_expr.sum(), (ko_expr > 0).mean()))
    # mito 比例（scTenifold QC 用大写 ^MT- 匹配；mouse mt- 不命中）
    mito_mask = np.array([s.upper().startswith("MT-") for s in symbols])
    mito_frac = np.asarray(counts[:, mito_mask].sum(axis=1)).ravel() / np.maximum(total, 1)
    print("mito 基因数=%d（大写 ^MT- 命中）" % int(mito_mask.sum()))
    sample_arr = a.obs["sample_id"].astype(str).to_numpy()
    dom = a.obs["domain"].astype(str).to_numpy()
    for s in sorted(set(sample_arr.tolist())):
        m = sample_arr == s
        n_spots = int(m.sum())
        n_dom = len(set(dom[m].tolist()))
        ko_s = ko_expr[m]
        ko_frac_all = (ko_s > 0).mean()
        # 模拟 QC：剔 lib<1000 与 mito 比>0.1
        keep = m & (total >= 1000) & (mito_frac <= 0.1)
        n_keep = int(keep.sum())
        ko_frac_keep = (ko_expr[keep] > 0).mean() if n_keep else 0.0
        print("  %-12s spots=%-5d domains=%-2d KOexpr_sum=%-7d KO%%_all=%.4f "
              "-> after_QC spots=%-5d KO%%=%.4f %s"
              % (s, n_spots, n_dom, int(ko_s.sum()), ko_frac_all,
                 n_keep, ko_frac_keep, "OK" if ko_frac_keep >= 0.05 else "KO会被滤/样本作废"))
