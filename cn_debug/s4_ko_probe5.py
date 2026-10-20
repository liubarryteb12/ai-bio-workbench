#!/usr/bin/env python3
"""探针5：scTenifoldKnk API 参数确认 + 合成数据冒烟（与 line2 步骤 9 同口径）。

line2 步骤 9 定稿口径（计划文件记录）：scTenifoldKnk 类不接受顶层 random_state，
必须走 nc_kws/td_kws 注入；d_regulation 自动把敲除基因排除出期望计算。
本探针在容器内重验这两条（line3 复用必须先确认 API 行为一致），并测最小合成
数据（50 基因 x 60 样本）计时，评估 line3 pseudo-cell（57/18 个）规模下是否可行。
"""
import time

import numpy as np
import pandas as pd

from scTenifold import scTenifoldKnk

print("scTenifoldKnk signature 尝试")
import inspect
try:
    print(inspect.signature(scTenifoldKnk))
except Exception as e:
    print("sig fail:", e)

# 合成数据：60 pseudo-cell x 50 基因 counts，模仿 spot 域聚合后的 pseudo-bulk
# 注意两个坑（探针实测）：
#   1) 基因名必须是字符串（scTenifold 内部对 index 做 .str 处理，整数列名报
#      "Can only use .str accessor with string values"）；
#   2) QC 默认阈值 lib size >= 1000，合成 counts 要够大（真实 spot 聚合后
#      pseudo-bulk lib size 远大，不触此问题）。
rng = np.random.default_rng(20261013)
n_cells, n_genes = 60, 50
gene_names = ["G%03d" % i for i in range(n_genes)]
base = rng.poisson(lam=20.0, size=(n_cells, n_genes)).astype(float)
# 造 5 个模块共表达结构（tenifold 靠共表达建网）
for mod in range(5):
    cols = mod * 10 + np.arange(10)
    latent = rng.normal(size=(n_cells, 1))
    base[:, cols] += np.abs(latent) * rng.poisson(200.0, size=(1, 10))
ko_gene = "G007"   # 落在模块 0

t0 = time.time()
# scTenifold 的 DataFrame 约定：index=基因名、columns=细胞名（_QC.py 对 index 做
# .str.upper().match("^MT-")）。真实数据需转置成 genes x cells 再传。
knk = scTenifoldKnk(data=pd.DataFrame(base.T, index=gene_names),
                    ko_genes=ko_gene,
                    nc_kws={"n_cpus": 3, "n_cores": 3, "random_state": 20261013},
                    td_kws={"random_state": 20261013})
print("scTenifoldKnk init %.1fs OK" % (time.time() - t0))
try:
    print("attrs after init:", [a for a in dir(knk) if not a.startswith("_")][:15])
    print("has d_regulation:", hasattr(knk, "d_regulation"))
    t0 = time.time()
    knk.build()
    print("build %.1fs OK" % (time.time() - t0))
    dr = knk.d_regulation
    print("d_regulation type:", type(dr).__name__)
    if hasattr(dr, "columns"):
        print("cols:", list(dr.columns))
    if hasattr(dr, "shape"):
        print("shape:", dr.shape)
    if hasattr(dr, "head"):
        print(dr.head(3).to_string()[:400])
except Exception as e:
    import traceback
    print("FAIL:", type(e).__name__, str(e)[:300])
    traceback.print_exc()
