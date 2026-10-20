#!/usr/bin/env python3
"""S4 步骤 12 目标基因空间定位探针。

目标基因清单选择口径（线3 九项之"目标基因空间定位"）：用户未点名具体基因，
从**线内已有产物**提炼候选：步骤 6 各空间域 marker 的 top1 基因（rank_genes_groups
结构 uns['domain_markers']['names'][:, 0]），即每域最强 marker 去重集合，线内证据，
不引入外部基因表（用户工作方式第 6 条：不主动加入未要求内容）。

探针回答：
1. 目标基因集合与 spot 表达覆盖。
2. 定位口径：每基因的域富集（域内表达均值 vs 全样本均值 + 域内表达 spot 占比）、
   top 定位域是否与其 marker 域一致（自洽性）。
3. 计时：目标基因子集操作 vs 全基因，定生产脚本形态。
"""
import time

import numpy as np
import anndata as ad

ad.settings.allow_write_nullable_strings = False
BASE = "/mnt/ssd/bio_data/line3_spatial/processed"

for tag in ["mouse", "human"]:
    print("== %s ==" % tag)
    t0 = time.time()
    a = ad.read_h5ad(BASE + "/spatial_communication_%s.h5ad" % tag)
    t_read = time.time() - t0
    dm = a.uns["domain_markers"]
    names = dm["names"]                      # structured array (n_genes,) dtype 字段为 group 名
    names_arr = np.asarray(names)
    print("names dtype:", names_arr.dtype, "shape:", names_arr.shape)
    groups = a.obs["domain"].astype("category").cat.categories.tolist()
    print("groups:", len(groups), "names fields:", names_arr.dtype.names[:5])
    # rank_genes_groups 的 names 是 (n_genes,) structured array，字段名为 group 名，
    # 每字段内按 rank 降序（rank 0 为该组 top1 marker）。names 字段序与
    # 候选池：各域 marker 前 topK 名（去重），而不是 top1（探针定性：wilcoxon top1
    # 在 spot 噪声数据上含大量泛表达基因 frac>=0.99，无定位信息量）。
    # 打分口径（逐样本算，domain 身份样本私有同步骤 9）：
    #   enrich(sample) = 域内表达 spot 占比 / 该基因全 spot 占比（该样本内）
    #   self_consistent(sample) = 该基因 marker 域（样本内）恰为 enrich 最高域
    # 目标基因排序 = self_consistent 样本数降序 → best_enrich 降序 → frac_all 升序
    # （泛表达基因 frac 高排序自然沉底，不用硬阈值拍脑袋）
    TOPK = 20
    cand = {}
    for g in groups:
        for rank in range(min(TOPK, np.asarray(names_arr).shape[0])):
            cand.setdefault(str(names_arr[g][rank]), set()).add(g)
    print("候选池（各域 top%d 去重）: %d" % (TOPK, len(cand)))

    # marker names 是 Ensembl ID（var_names 本身，步骤 6 既定口径：symbol 在 var 列），
    # 直接用 var_index 映射，不做 symbol 归一（步骤 10 的 symbol 归一只适用于 LR 资源）
    var_index = {v: i for i, v in enumerate(a.var_names.tolist())}

    dom = a.obs["domain"].astype(str).to_numpy()
    samples = sorted(a.obs["sample_id"].unique().tolist())
    sample_arr = a.obs["sample_id"].astype(str).to_numpy()
    X = a.X.tocsc()
    print("read %.1fs, X nnz=%d" % (t_read, X.nnz))

    # 逐目标基因：逐样本域富集（domain 身份样本私有，跨样本累加无意义，同步骤 9 教训），
    # 再按"在多少个样本里其 marker 域同时是富集 top1 域"汇总（自洽样本数）
    t1 = time.time()
    rows = []
    for gene in sorted(cand.keys()):
        gi = var_index.get(gene)
        if gi is None:
            continue
        col = np.asarray(X[:, gi].toarray()).ravel()
        n_expr = int((col > 0).sum())
        marker_doms = sorted(cand[gene])
        n_samples_top = 0
        n_samples_total = 0
        best_enrich = 0.0
        top_dom_overall = None
        for s in samples:
            sm = sample_arr == s
            cs = col[sm]
            all_frac_s = float((cs > 0).mean())
            if all_frac_s <= 0:
                continue
            n_samples_total += 1
            dom_s = dom[sm]
            marker_here = [d for d in marker_doms if (dom_s == d).any()]
            if not marker_here:
                continue
            per_dom = []
            for d in sorted(set(dom_s.tolist())):
                m = dom_s == d
                frac = float((cs[m] > 0).mean())
                per_dom.append((d, frac))
            if not per_dom:
                continue
            per_dom_sorted = sorted(per_dom, key=lambda x: -x[1])
            top_d, top_frac = per_dom_sorted[0]
            enrich = top_frac / all_frac_s
            if enrich > best_enrich:
                best_enrich = enrich
                top_dom_overall = (s, top_d, top_frac)
            if top_d in marker_here:
                n_samples_top += 1
        rows.append({
            "gene": gene, "n_expr": n_expr, "frac_all": n_expr / a.shape[0],
            "n_samples_total": n_samples_total,
            "n_samples_top": n_samples_top,
            "best_enrich": best_enrich,
            "best_example": top_dom_overall,
            "marker_domains": marker_doms,
        })
    print("逐基因域富集 %.1fs（候选 %d）" % (time.time() - t1, len(rows)))
    sym_list = a.var["gene_symbol"].astype(str).tolist()
    for r in sorted(rows, key=lambda x: (-x["n_samples_top"], -x["best_enrich"], x["frac_all"]))[:12]:
        gsym = sym_list[var_index[r["gene"]]] if var_index.get(r["gene"]) is not None else "?"
        print("   %-18s %-10s n_expr=%5d frac=%.3f 自洽样本=%d/%d best_enrich=%.2f best=%s marker域数=%d"
              % (r["gene"], gsym, r["n_expr"], r["frac_all"], r["n_samples_top"],
                 r["n_samples_total"], r["best_enrich"], r["best_example"],
                 len(r["marker_domains"])))
    print("全流程 %.1fs" % (time.time() - t0))

