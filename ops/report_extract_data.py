# -*- coding: utf-8 -*-
"""在 K40 上抽取报告所需数据，输出 JSON（供本地渲染 HTML）。"""
import json
import os
import sys

import numpy as np
import pandas as pd

PROJ = sys.argv[1]
BASE = "/mnt/ssd/bio_data/projects/%s/line3_spatial" % PROJ
PROC = os.path.join(BASE, "processed")
FIG = os.path.join(BASE, "figures")

out = {"project": PROJ, "figures": [], "tables": {}, "focus": {}, "notes": []}

# ---- 图件清单 ----
for f in sorted(os.listdir(FIG)):
    if f.endswith(".png"):
        out["figures"].append({"name": f, "bytes": os.path.getsize(os.path.join(FIG, f))})

# ---- 样本与分组 ----
sm = os.path.join(PROC, "samples_meta.tsv")
if os.path.isfile(sm):
    d = pd.read_csv(sm, sep="\t")
    out["tables"]["samples"] = d.astype(str).to_dict("records")

# ---- 域统计 ----
rep = os.path.join(PROC, "domains_report.txt")
if os.path.isfile(rep):
    out["tables"]["domains_report"] = open(rep, encoding="utf-8", errors="replace").read()[:4000]

# ---- QC ----
qc = os.path.join(PROC, "spot_qc_metrics.tsv")
if os.path.isfile(qc):
    d = pd.read_csv(qc, sep="\t")
    num = d.select_dtypes("number")
    out["tables"]["qc"] = {
        "n_spots": int(len(d)),
        "cols": list(d.columns)[:12],
        "summary": {c: {"min": float(num[c].min()), "median": float(num[c].median()),
                        "max": float(num[c].max())}
                    for c in list(num.columns)[:8]},
    }

# ---- 富集 ORA top ----
for key, fn in (("ora", "enrichment_ora_mouse.tsv"), ("gsea", "enrichment_gsea_mouse.tsv")):
    p = os.path.join(PROC, fn)
    if os.path.isfile(p):
        d = pd.read_csv(p, sep="\t")
        pcol = next((c for c in ("Adjusted P-value", "adj_p", "padj") if c in d.columns), None)
        if pcol:
            d = d.sort_values(pcol).head(20)
        cols = [c for c in ("domain", "library", "Term", "Overlap", pcol) if c in d.columns]
        out["tables"][key] = d[cols].astype(str).to_dict("records") if cols else []

# ---- 域 marker top ----
p = os.path.join(PROC, "domain_markers_mouse.tsv")
if os.path.isfile(p):
    d = pd.read_csv(p, sep="\t")
    cols = [c for c in ("group", "rank", "gene_symbol", "scores", "logfoldchanges",
                        "pvals_adj") if c in d.columns]
    out["tables"]["markers_top"] = d.sort_values("rank").head(30)[cols].astype(str).to_dict("records")
    out["tables"]["markers_shape"] = list(d.shape)

# ---- 自相关 ----
p = os.path.join(PROC, "gene_autocorr_mouse.tsv")
if os.path.isfile(p):
    d = pd.read_csv(p, sep="\t")
    icol = next((c for c in d.columns if "i_mean" in c or c == "I"), None)
    if icol:
        top = d.sort_values(icol, ascending=False).head(20)
        cols = [c for c in ("gene_symbol", icol, "gearys_c_mean") if c in d.columns]
        out["tables"]["autocorr_top"] = top[cols].astype(str).to_dict("records")
        out["tables"]["autocorr_stats"] = {
            "n_genes": int(len(d)),
            "p99": float(np.nanpercentile(d[icol].to_numpy(dtype=float), 99)),
            "median": float(np.nanmedian(d[icol].to_numpy(dtype=float))),
        }

# ---- 域共现 ----
p = os.path.join(PROC, "domain_cooccurrence_mouse.tsv")
if os.path.isfile(p):
    d = pd.read_csv(p, sep="\t")
    out["tables"]["cooccurrence"] = d.head(15).astype(str).to_dict("records")
    if "same_z" in d.columns:
        out["tables"]["cooccurrence_stats"] = {
            "n_domains": int(len(d)),
            "same_z_median": float(d["same_z"].median()),
            "same_frac_median": float(d["same_frac"].median()),
        }

# ---- 通讯 ----
p = os.path.join(PROC, "sample_communication_mouse.tsv")
if os.path.isfile(p):
    out["tables"]["communication"] = pd.read_csv(p, sep="\t").astype(str).to_dict("records")

# ---- 组成 ----
p = os.path.join(PROC, "sample_composition_mouse.tsv")
if os.path.isfile(p):
    out["tables"]["composition"] = pd.read_csv(p, sep="\t").head(20).astype(str).to_dict("records")

# ---- 细胞类型 ----
p = os.path.join(PROC, "celltype_annotation_mouse.tsv")
if os.path.isfile(p):
    d = pd.read_csv(p, sep="\t")
    ct = d["primary_celltype"].value_counts().head(12)
    out["tables"]["celltype_counts"] = [{"celltype": str(k), "n_spots": int(v)}
                                        for k, v in ct.items()]
    cross = pd.crosstab(d["domain"].astype(str), d["primary_celltype"].astype(str))
    frac = cross.div(cross.sum(axis=1).replace(0, 1), axis=0)
    top = frac.max(axis=1).sort_values(ascending=False).head(10)
    out["tables"]["celltype_by_domain"] = [
        {"domain": str(k), "top_celltype": str(frac.loc[k].idxmax()),
         "fraction": round(float(frac.loc[k].max()), 4)} for k in top.index]

# ---- KO DR（P1） ----
p = os.path.join(PROC, "ko_dr_genes_mouse.tsv")
if os.path.isfile(p):
    d = pd.read_csv(p, sep="\t")
    out["tables"]["ko_dr_shape"] = list(d.shape)
    if "significant" in d.columns:
        sig = d[d["significant"].astype(str).str.lower().isin(("true", "1"))]
    else:
        sig = d
    out["tables"]["ko_dr_top"] = sig.head(25).astype(str).to_dict("records")
    out["tables"]["ko_dr_sig_n"] = int(len(sig))
    out["tables"]["ko_gene"] = str(d["ko_gene"].iloc[0]) if "ko_gene" in d.columns else "?"

# ---- 交集 ----
p = os.path.join(PROC, "dr_overlap_mouse.tsv")
if os.path.isfile(p):
    out["tables"]["dr_overlap"] = pd.read_csv(p, sep="\t").head(20).astype(str).to_dict("records")

# ---- 定位 ----
p = os.path.join(PROC, "gene_localization_mouse.tsv")
if os.path.isfile(p):
    d = pd.read_csv(p, sep="\t")
    out["tables"]["localization_shape"] = list(d.shape)
    if "n_marker_domains" in d.columns:
        out["tables"]["localization_top"] = d.sort_values(
            "n_marker_domains", ascending=False).head(20).astype(str).to_dict("records")

# ---- 先验 focus 基因表达 ----
FOCUS = {"PRJ_STROKE_P1_SPATIAL_ABCA1": ["Abca1", "Akt1", "Sox9", "Adipor2", "Dpm1"],
         "PRJ_STROKE_P2_SPATIAL_LACTPYRO_5GENES": ["Myh9", "Egr1", "Gstp1", "Epha4", "Tjp1"]}
genes = FOCUS.get(PROJ, [])
if genes:
    import anndata as ad
    hp = os.path.join(PROC, "spatial_domains_mouse.h5ad")
    if os.path.isfile(hp):
        a = ad.read_h5ad(hp)
        sym = a.var["gene_symbol"].astype(str).to_numpy()
        grp = a.obs["group"].astype(str).to_numpy()
        dom = a.obs["domain"].astype(str).to_numpy()
        rows = []
        for g in genes:
            idx = np.where(sym == g)[0]
            if len(idx) == 0:
                rows.append({"gene": g, "status": "not_in_matrix"})
                continue
            col = a.X[:, idx[0]]
            x = np.asarray(col.todense()).ravel() if hasattr(col, "todense") else np.asarray(col).ravel()
            ctrl = float(np.mean(x[grp == "mouse_control_brain"])) if (grp == "mouse_control_brain").any() else float("nan")
            dis = float(np.mean(x[grp == "mouse_disease_brain"])) if (grp == "mouse_disease_brain").any() else float("nan")
            lfc = float(np.log2((dis + 0.01) / (ctrl + 0.01)))
            dm = [(float(np.mean(x[dom == k])), str(k)) for k in set(dom)]
            dm.sort(reverse=True)
            rows.append({
                "gene": g, "status": "ok",
                "mean": round(float(np.mean(x)), 4),
                "control": round(ctrl, 4), "disease": round(dis, 4),
                "log2fc": round(lfc, 3),
                "top_domains": [{"domain": d, "mean": round(v, 3)} for v, d in dm[:3]],
            })
        out["focus"] = rows

print(json.dumps(out, ensure_ascii=False))
