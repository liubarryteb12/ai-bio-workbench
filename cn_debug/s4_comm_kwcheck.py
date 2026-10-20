#!/usr/bin/env python3
"""小探针：KW tie 校正核对。mouse lr_mean_score 有 ties 时教科书 naive vs scipy。"""
import numpy as np
from scipy.stats import kruskal, chi2

def naive_kw(cols, tie=True):
    groups = [np.asarray(c, dtype=float) for c in cols]
    n = sum(len(g) for g in groups)
    k = len(groups)
    allv = np.concatenate(groups)
    order = np.argsort(allv, kind="mergesort")
    sv = allv[order]
    tie_sum = 0.0
    i = 0
    while i < len(sv):
        j = i
        while j + 1 < len(sv) and sv[j + 1] == sv[i]:
            j += 1
        t = j - i + 1
        if t > 1:
            tie_sum += t ** 3 - t
        i = j + 1
    ranks = np.empty(len(allv), dtype=float)
    i = 0
    while i < len(allv):
        j = i
        while j + 1 < len(allv) and sv[j + 1] == sv[i]:
            j += 1
        ranks[order[i:j + 1]] = (i + j) / 2.0 + 1.0
        i = j + 1
    r_sums, sizes, pos = [], [], 0
    for g in groups:
        r_sums.append(ranks[pos:pos + len(g)].sum())
        sizes.append(len(g))
        pos += len(g)
    h = 12.0 / (n * (n + 1)) * sum(rs ** 2 / sz for rs, sz in zip(r_sums, sizes)) - 3 * (n + 1)
    if tie:
        c = 1 - tie_sum / (n ** 3 - n)
        h = h / c if c > 0 else h
    p = float(chi2.sf(h, k - 1))
    return h, p, tie_sum

# mouse tsv 的 lr_mean_score
import pandas as pd
tsv = pd.read_csv("/mnt/ssd/bio_data/line3_spatial/processed/sample_communication_mouse.tsv", sep="\t")
labels = list(tsv["condition_class"])
uniq = sorted(set(labels))
print("values:", tsv["lr_mean_score"].tolist())
print("labels:", labels)
vals = tsv["lr_mean_score"].to_numpy(dtype=float)
cols = [vals[[i for i, x in enumerate(labels) if x == u]] for u in uniq]
print("with tie:", naive_kw(cols, True))
print("no tie  :", naive_kw(cols, False))
print("scipy   :", kruskal(*cols))
