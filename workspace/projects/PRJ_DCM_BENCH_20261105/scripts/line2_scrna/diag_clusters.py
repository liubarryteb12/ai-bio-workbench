import numpy as np
import pandas as pd
import anndata as ad
import scanpy as sc

P = '/mnt/ssd/bio_data/projects/PRJ_DCM_BENCH_20261105/line2_scrna/processed'
a = ad.read_h5ad(P + '/scrna_integrated.h5ad')
print('shape', a.shape)
obs = a.obs
meta = obs.groupby('donor', observed=True).agg(
    diagnosis=('diagnosis', 'first'), group=('group', 'first'), age=('age', 'first')).sort_index()
print(meta.to_string())

sc.pp.neighbors(a, n_neighbors=15, n_pcs=30, use_rep='X_pca_harmony', random_state=20261105)
sc.tl.leiden(a, resolution=1.0, random_state=20261105, flavor='igraph', n_iterations=2,
             directed=False, key_added='leiden_diag')
obs = a.obs
ct = pd.crosstab(obs['leiden_diag'], obs['donor'])
ct = ct.loc[ct.sum(axis=1).sort_values(ascending=False).index]
print()
print('cluster x donor 细胞数:')
print(ct.to_string())
print()
share = ct.div(ct.sum(axis=1), axis=0)
diag = obs.groupby('donor', observed=True)['diagnosis'].first().to_dict()
age = obs.groupby('donor', observed=True)['age'].first().to_dict()
print('每簇: 大小 主供体 占比 主供体阶段/年龄')
for cl in ct.index:
    row = share.loc[cl]
    dn = row.idxmax()
    print('  %-4s %6d  %-9s %.3f  %s / %s' % (cl, int(ct.loc[cl].sum()), dn, float(row.max()), diag[dn], age[dn]))
print()
# 阶段构成：把 donor 折叠成 fetal / child
stage_map = {d: ('fetal' if diag[d] == 'Fetal' else 'child') for d in diag}
obs['stage'] = obs['donor'].map(stage_map)
ct_stage = pd.crosstab(obs['leiden_diag'], obs['stage'])
ct_stage = ct_stage.loc[ct.index]
share_stage = ct_stage.div(ct_stage.sum(axis=1), axis=0)
print('每簇 stage 占比（fetal / child）:')
for cl in ct_stage.index:
    r = share_stage.loc[cl]
    print('  %-4s %6d  fetal=%.2f child=%.2f' % (cl, int(ct_stage.loc[cl].sum()), float(r.get('fetal', 0)), float(r.get('child', 0))))