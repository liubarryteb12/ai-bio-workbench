#!/usr/bin/env python3
"""步骤 13 探针 8：用 scTenifold 真实 QC 规则逐样本清点（定位 BH001 全基因被滤）。

scTenifold _QC.py 实测规则：
  - lib_size > 1000（严格大于）；
  - outlier：Tukey 1.5 IQR（先过 lib 闸的库大小分布上算）；
  - mito：index.str.upper().match("^MT-")（mouse Title case 也命中！），
    mt_rates = mt sum / lib，剔 mt_rates >= 0.1；
  - 基因：(!=0).mean(axis=1) > 0.05；
  - 基因二道闸：cells > 500 走 mean >= 0（恒真）否则 sum >= 0（恒真），
    即 BH001 这种大样本第二道不滤，第一道 min_percent 是唯一基因闸。
探针逐物种逐样本按同序模拟，报告每步剔除量与最终 gene x spot 规模。
"""
import numpy as np
import pandas as pd
import anndata as ad

PATHS = {
    "mouse": "/mnt/ssd/bio_data/line3_spatial/processed/spatial_localization_mouse.h5ad",
    "human": "/mnt/ssd/bio_data/line3_spatial/processed/spatial_localization_human.h5ad",
}
KO = {"mouse": "Spp1", "human": "SPP1"}


def fivenum(x):
    x = np.sort(np.asarray(x, dtype=float))
    n = len(x)
    n4 = np.floor((n + 3) / 2) / 2
    d = np.array([1, n4, (n + 1) / 2, n + 1 - n4, n]) - 1
    return 0.5 * (x[np.floor(d).astype(int)] + x[np.ceil(d).astype(int)])


for species, path in PATHS.items():
    a = ad.read_h5ad(path)
    symbols = a.var["gene_symbol"].astype(str).tolist()
    hvg_mask = a.var["highly_variable"].to_numpy(dtype=bool)
    hvg = [s for s, h in zip(symbols, hvg_mask) if h]
    up = {}
    for i, s in enumerate(symbols):
        up.setdefault(s.upper(), i)
    ko_sym = KO[species]
    ko_i = up[ko_sym.upper()]
    if ko_sym not in hvg:
        hvg.append(ko_sym)
    seen = set()
    hvg = [s for s in hvg if not (s in seen or seen.add(s))]
    first_pos = {}
    for i, s in enumerate(symbols):
        first_pos.setdefault(s, i)
    keep_idx = [first_pos[s] for s in hvg]
    counts = a.layers["counts"].tocsr()
    sample_arr = a.obs["sample_id"].astype(str).to_numpy()
    ko_expr_all = np.asarray(counts[:, ko_i].todense()).ravel()
    # mito mask 与 scTenifold 完全一致：upper().match("^MT-")
    mito_mask = np.array([bool(pd.Series([s.upper()]).str.match("^MT-").iloc[0]) for s in symbols])
    print("=" * 78)
    print("[%s] HVG宇宙=%d mito基因=%d KO=%s"
          % (species, len(hvg), int(mito_mask.sum()), ko_sym))
    for s in sorted(set(sample_arr.tolist())):
        m = sample_arr == s
        sub = counts[m]
        # 直接用 counts 的列子集（hvg 顺序）
        X = pd.DataFrame(np.asarray(sub[:, keep_idx].todense()).T,
                         index=hvg, columns=a.obs_names[m].tolist())
        lib = X.sum(axis=0)
        n0 = X.shape[1]
        keep = lib > 1000
        n1 = int((~keep).sum())
        X1 = X.loc[:, keep]
        lib1 = X1.sum(axis=0)
        _, Q1, _, Q3, _ = fivenum(lib1.to_numpy(dtype=float))
        iqr = Q3 - Q1
        keep2 = (lib1 >= Q1 - 1.5 * iqr) & (lib1 <= Q3 + 1.5 * iqr)
        n2 = int((~keep2).sum())
        X2 = X1.loc[:, keep2]
        mt = X2.index.str.upper().str.match("^MT-")
        mt_rates = X2[mt].sum(axis=0) / X2.sum(axis=0)
        keep3 = mt_rates < 0.1
        n3 = int((~keep3).sum())
        X3 = X2.loc[:, keep3]
        n_g_before = X3.shape[0]
        gene_frac = (X3 != 0).mean(axis=1)
        X4 = X3[gene_frac > 0.05]
        n4 = int(n_g_before - X4.shape[0])
        ko_surv = ko_sym in X4.index
        final_cols = X4.columns
        ko_mask = np.isin(np.asarray(a.obs_names[m]), np.asarray(final_cols))
        ko_frac_final = float((ko_expr_all[m][ko_mask] > 0).mean()) if len(final_cols) else 0.0
        print("  %-12s spots=%-5d |剔lib=%-4d 剔outlier=%-4d 剔mito=%-4d |基因 %d->%d(剔%d) "
              "KO存活=%s final=%dx%d"
              % (s, n0, n1, n2, n3, n_g_before, X4.shape[0], n4,
                 ko_surv, X4.shape[0], X4.shape[1]))
