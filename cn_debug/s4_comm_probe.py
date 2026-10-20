#!/usr/bin/env python3
"""S4 步骤 10 spatial_communication 探针：LR 资源盘点 + 空间 LR 打分口径定性。

回答三个问题：
1. 服务器上现有哪些配受体（LR）分析资源：liana 及其 resource、squidpy、
   CellPhoneDB 资源、omnipath 本地资源文件等（离线约束：不下载）。
2. 空间 LR 打分路线可行性：liana 的 spatial 分支（misty/ spatial_metrics_visium）
   依赖很重且与 Visium 元数据结构绑定，本线是 10x h5 自建 spatial 坐标，
   评估改走自实现（邻域权重 × 配受体表达乘积，squidpy gr.ligrec 同思路）的可行性。
3. 表达覆盖度：在步骤 9 产物（全基因 + domain）上，候选 LR 对的配体/受体
   spot 表达比例，定"多少比例的 LR 对在本数据上可评估"。
"""
import importlib.util
import json
import sys

import numpy as np
import pandas as pd
import anndata as ad

ad.settings.allow_write_nullable_strings = False

BASE = "/mnt/ssd/bio_data/line3_spatial/processed"


def have(mod):
    return importlib.util.find_spec(mod) is not None


print("== 1. 模块盘点 ==")
for m in ["liana", "squidpy", "omnipath", "misty", "cellphonedb", "commot",
          "spatialdm", "gseapy", "scanpy", "esda"]:
    lines = []
    lines.append("%-14s %s" % (m, "present" if have(m) else "ABSENT"))
    print(lines[0])

ver = {}
if have("liana"):
    import liana
    ver["liana"] = liana.__version__
    print("liana version:", ver["liana"])
if have("squidpy"):
    import squidpy
    ver["squidpy"] = squidpy.__version__
    print("squidpy version:", ver["squidpy"])
if have("omnipath"):
    import omnipath as op
    ver["omnipath"] = op.__version__
    print("omnipath version:", ver["omnipath"])

print()
print("== 2. liana 资源盘点 ==")
if have("liana"):
    from liana.resource import select_resource
    for name in ["consensus", "cellphonedb", "cellchatdb", "connectome", "icellnet",
                 "ligrec", "natmi"]:
        try:
            res = select_resource(name)
            n_pairs = len(res)
            n_uniq = len(set(zip(res["ligand"], res["receptor"])))
            print("resource %-12s rows=%d uniq_pairs=%d cols=%s"
                  % (name, n_pairs, n_uniq, list(res.columns)[:6]))
        except Exception as e:
            print("resource %-12s FAIL %s" % (name, str(e)[:100]))
else:
    print("liana ABSENT")

print()
print("== 3. LR 在数据上的表达覆盖度 ==")
lr_pairs_loaded = None
if have("liana"):
    from liana.resource import select_resource
    res = select_resource("consensus")
    lr_pairs_loaded = res
    pairs = sorted(set(zip(res["ligand"].astype(str), res["receptor"].astype(str))))
    print("consensus uniq pairs:", len(pairs))

def coverage(path, tag):
    a = ad.read_h5ad(path)
    obs_dom = a.obs["domain"].astype(str)
    sym = a.var["gene_symbol"].astype(str).tolist()
    sym_index = {}
    for i, s in enumerate(sym):
        sym_index.setdefault(s, i)  # 重复 symbol 取首个 index（与步骤 6 一致）
    out = {"species": tag, "spots": int(a.shape[0]), "genes": int(a.shape[1])}
    frac_expr = float((np.asarray(a.X.sum(axis=1)).ravel() > 0).mean())
    out["spot_nonzero_frac"] = frac_expr
    if lr_pairs_loaded is None:
        print(tag, out)
        return
    # 表达定义：归一化 log 值 > 0 视为该 spot 表达该基因
    Xcsc = a.X.tocsc()
    lig_ok = 0
    rec_ok = 0
    both_ok = 0
    evaluated = 0
    n_considered = 0
    for lig, rec in pairs:
        li = sym_index.get(lig)
        ri = sym_index.get(rec)
        n_considered += 1
        if li is None or ri is None:
            continue
        try:
            lv = np.asarray(Xcsc[:, li].todense()).ravel()
            rv = np.asarray(Xcsc[:, ri].todense()).ravel()
        except Exception:
            continue
        le = lv > 0
        re_ = rv > 0
        if le.any() and re_.any():
            evaluated += 1
        lig_ok += int(le.any())
        rec_ok += int(re_.any())
        both_ok += int(le.any() and re_.any())
    out["pairs_considered"] = n_considered
    out["ligand_present"] = lig_ok
    out["receptor_present"] = rec_ok
    out["both_present"] = both_ok
    out["both_frac"] = round(both_ok / max(n_considered, 1), 4)
    print(tag, json.dumps(out, ensure_ascii=False))
    return out

print("--- coverage per species（耗时长，先算 human 定性）---")
try:
    coverage(BASE + "/spatial_composition_mouse.h5ad", "mouse")
    coverage(BASE + "/spatial_composition_human.h5ad", "human")
except Exception as e:
    print("coverage FAIL:", str(e)[:300])
