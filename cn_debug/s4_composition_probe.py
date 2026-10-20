# s4_composition_probe：步骤 9 区域组成差异分析原型探针。
# 目标（口径决策前先看真实数据）：
#   1. 每物种每样本 condition/group/spot 数与 domain 数；
#   2. 每样本 domain 组成（spot 占比）画像 + 组内/组间组成距离（Bray-Curtis）；
#   3. 小样本下统计可行性：每组几个样本，逐域 KW 检验能到什么程度；
#   4. 多样性（Shannon/Simpson 或有效域数）的组间差异方向。
# 输入：步骤 8 产物 spatial_cooccurrence_mouse.h5ad / spatial_cooccurrence_human.h5ad
#       （obs 含 sample_id/condition/condition_class/group/domain）。
import sys
import numpy as np
import pandas as pd
import scanpy as h5ad_reader  # noqa: F401  (scanpy 仅用于读 h5ad)
import anndata as ad

ad.settings.allow_write_nullable_strings = False

PROC = "/mnt/ssd/bio_data/line3_spatial/processed"


def shannon(p):
    p = p[p > 0]
    return float(-(p * np.log(p)).sum())


def bray_curtis(p, q):
    return float(np.abs(p - q).sum() / (p.sum() + q.sum()))


def probe_species(species):
    path = "%s/spatial_cooccurrence_%s.h5ad" % (PROC, species)
    a = ad.read_h5ad(path)
    obs = a.obs
    dom = obs["domain"].to_numpy()
    sid = obs["sample_id"].to_numpy()
    cond = obs["condition"].to_numpy()
    ccls = obs["condition_class"].to_numpy()
    samples = sorted(set(sid))
    domains = sorted(set(dom))
    nd = len(domains)
    print("== %s: %d spots x %d genes, %d samples, %d domains ==" %
          (species, a.n_obs, a.n_vars, len(samples), nd))

    # 每样本 x 每域 spot 计数 -> 组成向量
    comp = np.zeros((len(samples), nd))
    sidx = {s: i for i, s in enumerate(samples)}
    didx = {d: j for j, d in enumerate(domains)}
    for s, d in zip(sid, dom):
        comp[sidx[s], didx[d]] += 1
    prop = comp / comp.sum(axis=1, keepdims=True)

    meta = pd.DataFrame({
        "sample_id": samples,
        "condition": [cond[sid == s][0] for s in samples],
        "condition_class": [ccls[sid == s][0] for s in samples],
        "n_spots": comp.sum(axis=1).astype(int),
        "n_domains": (comp > 0).sum(axis=1).astype(int),
        "shannon": [shannon(prop[i]) for i in range(len(samples))],
    })
    print(meta.to_string(index=False))

    # 每域规模（spot 数中位数）与每样本域数分布
    dom_size = np.median(comp, axis=0)
    print("domain spot size: min %d / median %d / max %d" %
          (dom_size.min(), np.median(dom_size), dom_size.max()))
    print("n_domains per sample: min %d / max %d" %
          (meta["n_domains"].min(), meta["n_domains"].max()))

    # 组内 vs 组间 Bray-Curtis（condition_class 分组）
    groups = meta["condition_class"].to_numpy()
    within, between = [], []
    for i in range(len(samples)):
        for j in range(i + 1, len(samples)):
            d = bray_curtis(prop[i], prop[j])
            (within if groups[i] == groups[j] else between).append(d)
    print("condition_class group sizes: %s" %
          dict(pd.Series(groups).value_counts()))
    print("Bray-Curtis within-group mean %.4f (n=%d) / between-group mean %.4f (n=%d)" %
          (np.mean(within) if within else float("nan"), len(within),
           np.mean(between) if between else float("nan"), len(between)))

    # condition 原始值分组（SD/WD 拆分后的更细组）
    conds = meta["condition"].to_numpy()
    print("condition group sizes: %s" % dict(pd.Series(conds).value_counts()))
    w2, b2 = [], []
    for i in range(len(samples)):
        for j in range(i + 1, len(samples)):
            d = bray_curtis(prop[i], prop[j])
            (w2 if conds[i] == conds[j] else b2).append(d)
    print("Bray-Curtis within(condition) mean %.4f (n=%d) / between mean %.4f (n=%d)" %
          (np.mean(w2) if w2 else float("nan"), len(w2),
           np.mean(b2) if b2 else float("nan"), len(b2)))

    # 逐域占比的组间 KW 可行性（scipy）
    from scipy.stats import kruskal
    uniq = sorted(set(groups))
    n_sig = 0
    pvals = []
    if all((groups == g).sum() >= 2 for g in uniq) and len(uniq) >= 2:
        for j in range(nd):
            cols = [prop[groups == g, j] for g in uniq]
            try:
                p = kruskal(*cols).pvalue
            except ValueError:
                continue
            pvals.append(p)
        n_sig = int(sum(np.array(pvals) < 0.05))
        print("per-domain KW (condition_class, %d groups): %d/%d domains p<0.05, min p %.4f" %
              (len(uniq), n_sig, len(pvals), min(pvals) if pvals else float("nan")))
    else:
        print("per-domain KW skipped: group sizes %s" %
              {g: int((groups == g).sum()) for g in uniq})

    # Shannon 多样性组间方向
    for g in uniq:
        v = meta.loc[groups == g, "shannon"].to_numpy()
        print("shannon %-16s n=%d mean %.4f values %s" %
              (g, len(v), v.mean(), np.round(v, 4)))
    return meta


for sp in ("mouse", "human"):
    probe_species(sp)
    print()
print("PROBE_DONE")
