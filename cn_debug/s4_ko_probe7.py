#!/usr/bin/env python3
"""步骤 13 探针 7：逐样本路线单样本实测（最小可行验证）。

取 mouse JBO001（1646 spot，Spp1 占比 42%）与 human JBO018（2500 spot，
SPP1 占比 7%）各跑一次完整 scTenifoldKnk（基因宇宙 = HVG + KO 基因，
spot 作 cell 单元），报告 exit/耗时/DR 表规模。只读输入，不写产物。
"""
import time
import numpy as np
import pandas as pd
import anndata as ad
from scTenifold import scTenifoldKnk

ad.settings.allow_write_nullable_strings = False

CASES = [
    ("mouse", "/mnt/ssd/bio_data/line3_spatial/processed/spatial_localization_mouse.h5ad",
     "JBO001", "Spp1"),
    ("human", "/mnt/ssd/bio_data/line3_spatial/processed/spatial_localization_human.h5ad",
     "JBO018", "SPP1"),
]
SEED = 20261013
N_CPUS = 3

for species, path, sample, ko_sym in CASES:
    a = ad.read_h5ad(path)
    symbols = a.var["gene_symbol"].astype(str).tolist()
    hvg_mask = a.var["highly_variable"].to_numpy(dtype=bool)
    hvg = [s for s, h in zip(symbols, hvg_mask) if h]
    up = {}
    for i, s in enumerate(symbols):
        up.setdefault(s.upper(), i)
    ko_i = up[ko_sym.upper()]
    if ko_sym not in hvg:
        hvg = hvg + [ko_sym]
    seen = set()
    hvg = [s for s in hvg if not (s in seen or seen.add(s))]
    first_pos = {}
    for i, s in enumerate(symbols):
        first_pos.setdefault(s, i)
    keep_idx = [first_pos[s] for s in hvg]
    sample_arr = a.obs["sample_id"].astype(str).to_numpy()
    m = sample_arr == sample
    counts = a.layers["counts"].tocsr()
    sub = counts[m][:, keep_idx]
    cell_names = a.obs_names[m].tolist()
    pseudo = pd.DataFrame(np.asarray(sub.todense()).T, index=hvg, columns=cell_names)
    print("=" * 70)
    print("[%s %s] pseudo %d 基因 x %d spot, KO=%s"
          % (species, sample, pseudo.shape[0], pseudo.shape[1], ko_sym))
    t0 = time.time()
    knk = scTenifoldKnk(data=pseudo, ko_genes=ko_sym,
                        nc_kws={"n_cpus": N_CPUS, "n_cores": N_CPUS, "random_state": SEED},
                        td_kws={"random_state": SEED})
    knk.build()
    dr = knk.d_regulation
    el = time.time() - t0
    sig = dr[(dr["adjusted p-value"] < 0.05) & (dr["Gene"].astype(str) != ko_sym)]
    print("  完成 %.1fs，DR 表 %d 基因，显著非敲除 %d 个" % (el, len(dr), len(sig)))
    print("  top: %s" % sig.sort_values("adjusted p-value").head(5)["Gene"].tolist())
    print("  columns=%s" % list(dr.columns))
