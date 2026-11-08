#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Render the L3 figures from the project adapter chain.

This script deliberately reads:
  processed/deconv_mouse.h5ad       (project NNLS result, Line 2 signatures)
  processed/localization_mouse.h5ad (project target-gene localization)
  results/morans_i_top_genes.tsv    (project Moran's I ranking)
  results/target_localization.tsv   (project target summary)

It does not read the legacy spatial_marker_mouse.h5ad / spatial_deconv_mouse.h5ad
objects produced by the master self-signature branch. Those objects are retained
for audit, but their figures are not presented as the project deconvolution result.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Patch
import numpy as np
import pandas as pd
import anndata as ad
import scanpy as sc

ROOT = Path(__file__).resolve().parents[1]
PROC = ROOT / "processed"
RES = ROOT / "results"
FIG = ROOT / "figures"
FIG.mkdir(parents=True, exist_ok=True)

SEED = int(os.environ.get("BIOANALYS_SEED", "20261105"))
plt.rcParams.update({
    "figure.dpi": 300,
    "savefig.dpi": 300,
    "font.size": 8,
    "font.family": "sans-serif",
    "font.sans-serif": ["Arial", "Helvetica", "Liberation Sans", "DejaVu Sans"],
    "axes.labelsize": 8,
    "xtick.labelsize": 8,
    "ytick.labelsize": 8,
    "legend.fontsize": 8,
    "legend.title_fontsize": 8,
    "axes.titlesize": 9,
    "axes.grid": False,
    "figure.autolayout": False,
    "savefig.bbox": "tight",
    "image.cmap": "viridis",
})


def caption(fig, *parts):
    parts = [str(p) for p in parts if p not in (None, "")]
    if parts:
        fig.text(0.01, -0.02, "\n".join(parts), ha="left", va="top",
                 fontsize=8, linespacing=1.5)


def palette(n):
    colors = []
    for name in ("tab20", "tab20b", "tab20c"):
        colors.extend(plt.get_cmap(name).colors)
    return [colors[i % len(colors)] for i in range(n)]


def save(fig, name):
    path = FIG / name
    fig.savefig(path, dpi=300, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print("wrote %s" % path, flush=True)


def legend_right(ax, fig, handles, labels, title, right=0.62):
    ax.legend(handles, labels, loc="upper left", bbox_to_anchor=(1.02, 1.0),
              ncol=1, fontsize=7, frameon=False, title=title)
    fig.subplots_adjust(left=0.04, right=right, top=0.97, bottom=0.09)


def natural_domain_key(value):
    match = re.search(r"_d(\d+)$", str(value))
    return int(match.group(1)) if match else 10 ** 9


def target_symbol(loc, loc_tab):
    meta = loc.uns.get("localization")
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except ValueError:
            meta = {}
    if isinstance(meta, dict):
        for key in ("target_gene_symbol", "gene_symbol", "top_target_gene"):
            value = str(meta.get(key) or "").strip()
            if value and not value.startswith("ENSMUSG"):
                return value
    if loc_tab is not None and len(loc_tab) and "gene_symbol" in loc_tab:
        value = str(loc_tab["gene_symbol"].dropna().iloc[0]).strip()
        if value:
            return value
    return "target"


def compute_umap(a):
    work = a.copy()
    n_top = min(2000, max(200, work.n_vars))
    sc.pp.highly_variable_genes(work, n_top_genes=n_top, flavor="seurat")
    work = work[:, work.var["highly_variable"].to_numpy()].copy()
    n_pcs = min(50, work.n_vars - 1, work.n_obs - 1)
    sc.pp.pca(work, n_comps=n_pcs, random_state=SEED)
    sc.pp.neighbors(work, n_neighbors=15, n_pcs=min(30, n_pcs),
                    random_state=SEED)
    sc.tl.umap(work, random_state=SEED)
    return np.asarray(work.obsm["X_umap"])


def main():
    deconv = ad.read_h5ad(PROC / "deconv_mouse.h5ad")
    loc = ad.read_h5ad(PROC / "localization_mouse.h5ad")
    loc_tab_path = RES / "target_localization.tsv"
    loc_tab = pd.read_csv(loc_tab_path, sep="\t") if loc_tab_path.exists() else None
    gene = target_symbol(loc, loc_tab)
    print("target_gene=%s" % gene, flush=True)

    samples = sorted(deconv.obs["sample_id"].astype(str).unique().tolist())
    ct_cols = sorted([c for c in deconv.obs.columns if c.startswith("celltype_nnls_")])
    celltypes = [c[len("celltype_nnls_"):] for c in ct_cols]
    if not samples or not celltypes:
        raise SystemExit("deconv_mouse.h5ad lacks sample_id or celltype_nnls_<type> columns")

    xy = np.asarray(deconv.obsm["spatial"], dtype=float)
    dom = deconv.obs["domain"].astype(str).to_numpy()
    samp = deconv.obs["sample_id"].astype(str).to_numpy()
    props = deconv.obs[ct_cols].to_numpy(dtype=float)
    props[~np.isfinite(props)] = 0.0
    row_sum = props.sum(axis=1, keepdims=True)
    props = np.divide(props, row_sum, out=np.zeros_like(props), where=row_sum > 0)
    prop_df = pd.DataFrame(props, columns=celltypes)
    prop_df["domain"] = dom
    prop_df["sample_id"] = samp
    dom_means = prop_df.groupby(["sample_id", "domain"], sort=False)[celltypes].mean()
    dom_means = dom_means.reindex(
        sorted(dom_means.index, key=lambda x: (samples.index(x[0]), natural_domain_key(x[1])))
    )
    sample_colors = dict(zip(samples, palette(len(samples))))

    # 01: per-sample domain maps, exact 47-domain project object.
    for sample in samples:
        mask = samp == sample
        sample_dom = dom[mask]
        labels = sorted(set(sample_dom), key=natural_domain_key)
        colors = palette(len(labels))
        fig, ax = plt.subplots(figsize=(11, 7))
        for label, color in zip(labels, colors):
            hit = sample_dom == label
            ax.scatter(xy[mask][hit, 0], xy[mask][hit, 1], s=5, color=color,
                       linewidths=0, label=label)
        ax.set_aspect("equal")
        ax.invert_yaxis()
        ax.set_xticks([])
        ax.set_yticks([])
        ax.set_title("%s spatial domains" % sample, fontsize=9)
        legend_right(ax, fig, [Patch(color=c, label=l) for l, c in zip(labels, colors)],
                     labels, "domain", right=0.60)
        caption(fig, "line3 mouse: %s spatial domains" % sample,
                "source=processed/deconv_mouse.h5ad (project adapter)",
                "n=%d domains, n=%d spots" % (len(labels), int(mask.sum())))
        save(fig, "l3_mouse_01_domains_%s.png" % sample)

    # 02: target-gene spatial maps from the project localization object.
    loc_xy = np.asarray(loc.obsm["spatial"], dtype=float)
    loc_samp = loc.obs["sample_id"].astype(str).to_numpy()
    expr = loc.obs["target_gene_expr"].to_numpy(dtype=float)
    for sample in sorted(set(loc_samp)):
        mask = loc_samp == sample
        values = expr[mask]
        vmin = float(np.nanpercentile(values, 1))
        vmax = float(np.nanpercentile(values, 99))
        if not np.isfinite(vmin) or not np.isfinite(vmax) or vmax <= vmin:
            vmin, vmax = float(np.nanmin(values)), float(np.nanmax(values) + 1e-12)
        fig, ax = plt.subplots(figsize=(7.6, 6.4))
        im = ax.scatter(loc_xy[mask, 0], loc_xy[mask, 1], c=values,
                        cmap="viridis", vmin=vmin, vmax=vmax, s=6, linewidths=0)
        ax.set_aspect("equal")
        ax.invert_yaxis()
        ax.set_xticks([])
        ax.set_yticks([])
        ax.set_title("%s: %s expression" % (sample, gene), fontsize=9)
        cb = fig.colorbar(im, ax=ax, fraction=0.046, pad=0.03)
        cb.set_label("%s expression" % gene)
        fig.subplots_adjust(left=0.04, right=0.82, top=0.94, bottom=0.12)
        caption(fig, "line3 mouse: %s target-gene localization" % sample,
                "source=processed/localization_mouse.h5ad (project adapter)",
                "n=%d spots; target=%s" % (int(mask.sum()), gene))
        save(fig, "l3_mouse_02_target_gene_%s.png" % sample)

    # 03/09: the legacy KO run is spot-level and therefore domain-independent,
    # but its old by-domain summary used the master 13-domain labels. Project the
    # same spot-level KO values onto the project 47-domain labels instead.
    ko_path = PROC / "spatial_knockout_mouse.h5ad"
    if ko_path.exists():
        ko = ad.read_h5ad(ko_path)
        if "ko_dr_expr" in ko.obs:
            ko_expr = pd.Series(ko.obs["ko_dr_expr"].to_numpy(dtype=float),
                               index=ko.obs_names).reindex(deconv.obs_names)
            ko_expr = ko_expr.to_numpy(dtype=float)
            if np.isfinite(ko_expr).sum() > 0:
                ko_gene = "KO gene"
                report_path = PROC / "knockout_report.txt"
                if report_path.exists():
                    match = re.search(r"ko_gene=([^\s]+)", report_path.read_text(encoding="utf-8"))
                    if match:
                        ko_gene = match.group(1)
                for sample in samples:
                    mask = samp == sample
                    values = ko_expr[mask]
                    vmin = float(np.nanpercentile(values, 1))
                    vmax = float(np.nanpercentile(values, 99))
                    if not np.isfinite(vmin) or not np.isfinite(vmax) or vmax <= vmin:
                        vmin, vmax = float(np.nanmin(values)), float(np.nanmax(values) + 1e-12)
                    fig, ax = plt.subplots(figsize=(7.6, 6.4))
                    im = ax.scatter(xy[mask, 0], xy[mask, 1], c=values, cmap="inferno",
                                    vmin=vmin, vmax=vmax, s=6, linewidths=0)
                    ax.set_aspect("equal")
                    ax.invert_yaxis()
                    ax.set_xticks([])
                    ax.set_yticks([])
                    ax.set_title("%s: KO(%s) DR mean expression" % (sample, ko_gene), fontsize=9)
                    cb = fig.colorbar(im, ax=ax, fraction=0.046, pad=0.03)
                    cb.set_label("KO DR expression")
                    fig.subplots_adjust(left=0.04, right=0.82, top=0.94, bottom=0.12)
                    caption(fig, "line3 mouse: %s KO(%s) DR mean expression" % (sample, ko_gene),
                            "spot-level KO values; project 47-domain spatial labels",
                            "source=spatial_knockout_mouse.h5ad + deconv_mouse.h5ad")
                    save(fig, "l3_mouse_03_ko_dr_%s.png" % sample)

                ko_by_dom = pd.DataFrame({"domain": dom, "expr": ko_expr}).groupby("domain")["expr"].mean()
                ko_by_dom = ko_by_dom.reindex(
                    sorted(ko_by_dom.index, key=natural_domain_key)
                )
                fig, ax = plt.subplots(figsize=(9.5, max(7, len(ko_by_dom) * 0.20)))
                colors = [sample_colors.get(d.split("_d")[0], "#777777") for d in ko_by_dom.index]
                ax.barh(np.arange(len(ko_by_dom)), ko_by_dom.to_numpy(), color=colors, height=0.7)
                ax.set_yticks(np.arange(len(ko_by_dom)))
                ax.set_yticklabels(ko_by_dom.index.tolist(), fontsize=7)
                ax.set_xlabel("mean KO(%s) DR expression" % ko_gene)
                legend_right(ax, fig,
                             [Patch(color=sample_colors[s], label=s) for s in samples],
                             samples, "sample", right=0.78)
                caption(fig, "line3 mouse: KO(%s) DR mean expression by project domain" % ko_gene,
                        "spot-level KO values projected onto project 47-domain labels",
                        "source=spatial_knockout_mouse.h5ad + deconv_mouse.h5ad")
                save(fig, "l3_mouse_09_ko_dr_by_domain.png")

    # 04: project Moran's I ranking.
    mor_path = RES / "morans_i_top_genes.tsv"
    if mor_path.exists():
        mor = pd.read_csv(mor_path, sep="\t")
        if {"gene_symbol", "moran_I"} <= set(mor.columns):
            top = mor.sort_values("moran_I", ascending=False).head(20).iloc[::-1]
            fig, ax = plt.subplots(figsize=(8.5, 7))
            ax.barh(np.arange(len(top)), top["moran_I"], color="#4C72B0", height=0.7)
            ax.set_yticks(np.arange(len(top)))
            ax.set_yticklabels(top["gene_symbol"].astype(str), fontsize=8)
            ax.set_xlabel("Moran's I (mean across samples)")
            caption(fig, "line3 mouse: top spatial autocorrelation genes",
                    "source=results/morans_i_top_genes.tsv (project adapter)",
                    "n=%d genes; top 20 by mean Moran's I" % len(mor))
            save(fig, "l3_mouse_04_morans_top.png")

    # 06/14: project UMAP, sample labels and macrophage fraction.
    try:
        umap = compute_umap(deconv)
        umap_note = "PCA/neighbors/UMAP recomputed from deconv_mouse.h5ad"
    except Exception as exc:  # noqa: BLE001
        umap = xy
        umap_note = "UMAP unavailable, spatial coordinates used as fallback (%s)" % str(exc)[:80]
        print(umap_note, flush=True)

    fig, ax = plt.subplots(figsize=(8.5, 6.5))
    for sample in samples:
        mask = samp == sample
        ax.scatter(umap[mask, 0], umap[mask, 1], s=4, color=sample_colors[sample],
                   linewidths=0, label=sample)
    ax.set_xlabel("UMAP 1")
    ax.set_ylabel("UMAP 2")
    legend_right(ax, fig, [Patch(color=sample_colors[s], label=s) for s in samples],
                 samples, "sample", right=0.80)
    caption(fig, "line3 mouse: UMAP colored by sample",
            umap_note, "n=%d spots" % deconv.n_obs)
    save(fig, "l3_mouse_06_umap_sample.png")

    macro_col = "celltype_nnls_macrophage"
    macro = deconv.obs[macro_col].to_numpy(dtype=float) if macro_col in deconv.obs else props[:, celltypes.index("macrophage")]
    fig, ax = plt.subplots(figsize=(9, 7))
    im = ax.scatter(umap[:, 0], umap[:, 1], c=macro, cmap="viridis", s=5,
                    linewidths=0, vmin=0, vmax=max(float(np.nanpercentile(macro, 99)), 1e-6))
    ax.set_xlabel("UMAP 1")
    ax.set_ylabel("UMAP 2")
    cb = fig.colorbar(im, ax=ax, fraction=0.046, pad=0.03)
    cb.set_label("macrophage fraction")
    fig.subplots_adjust(right=0.82)
    primary = deconv.obs["celltype_nnls"].astype(str).value_counts()
    primary_text = ", ".join("%s=%d" % (k, int(v)) for k, v in primary.head(4).items())
    caption(fig, "line3 mouse: NNLS deconvolution (project Line 2 signatures)",
            "color = macrophage fraction; primary labels: %s" % primary_text,
            "n=%d spots, %d celltypes; %s" % (deconv.n_obs, len(celltypes), umap_note))
    save(fig, "l3_mouse_14_deconv_umap.png")

    # 07: sample x domain composition.
    dom_columns = sorted(set(dom), key=natural_domain_key)
    dom_palette = palette(len(dom_columns))
    sample_dom = pd.crosstab(pd.Series(samp, name="sample"), pd.Series(dom, name="domain"))
    sample_dom = sample_dom.reindex(index=samples, columns=dom_columns, fill_value=0)
    sample_dom = sample_dom.div(sample_dom.sum(axis=1), axis=0)
    fig, ax = plt.subplots(figsize=(12, 9))
    bottom = np.zeros(len(sample_dom))
    for j, domain in enumerate(dom_columns):
        values = sample_dom[domain].to_numpy()
        ax.bar(range(len(sample_dom)), values, bottom=bottom, width=0.7,
               color=dom_palette[j], label=domain)
        bottom += values
    ax.set_xticks(range(len(sample_dom)))
    ax.set_xticklabels(sample_dom.index.tolist(), rotation=35, ha="right")
    ax.set_ylabel("domain proportion")
    legend_right(ax, fig,
                 [Patch(color=dom_palette[j], label=d) for j, d in enumerate(dom_columns)],
                 dom_columns, "domain", right=0.58)
    caption(fig, "line3 mouse: spatial domain composition per sample",
            "source=processed/deconv_mouse.h5ad (project adapter)",
            "n=%d samples, %d domains" % (len(samples), len(dom_columns)))
    save(fig, "l3_mouse_07_domain_composition.png")

    # 08: target-gene mean by project domain.
    loc_dom = loc.obs["domain"].astype(str).to_numpy()
    target_by_dom = pd.DataFrame({"domain": loc_dom, "expr": expr}).groupby("domain")["expr"].mean()
    target_by_dom = target_by_dom.reindex(
        sorted(target_by_dom.index, key=natural_domain_key)
    )
    target_samples = {d: d.split("_d")[0] for d in target_by_dom.index}
    fig, ax = plt.subplots(figsize=(9.5, max(7, len(target_by_dom) * 0.20)))
    colors = [sample_colors.get(target_samples[d], "#777777") for d in target_by_dom.index]
    ax.barh(np.arange(len(target_by_dom)), target_by_dom.to_numpy(), color=colors, height=0.7)
    ax.set_yticks(np.arange(len(target_by_dom)))
    ax.set_yticklabels(target_by_dom.index.tolist(), fontsize=7)
    ax.set_xlabel("mean %s expression" % gene)
    handles = [Patch(color=sample_colors[s], label=s) for s in samples]
    legend_right(ax, fig, handles, samples, "sample", right=0.78)
    caption(fig, "line3 mouse: %s mean expression by spatial domain" % gene,
            "source=processed/localization_mouse.h5ad (project adapter)",
            "n=%d domains" % len(target_by_dom))
    save(fig, "l3_mouse_08_target_gene_by_domain.png")

    # 15: domain x celltype stacked composition.
    fig_h = max(9, len(dom_means) * 0.20)
    fig, ax = plt.subplots(figsize=(11, fig_h))
    y = np.arange(len(dom_means))
    left = np.zeros(len(dom_means))
    ct_colors = dict(zip(celltypes, palette(len(celltypes))))
    for ct in celltypes:
        values = dom_means[ct].to_numpy()
        ax.barh(y, values, left=left, color=ct_colors[ct], height=0.7, label=ct)
        left += values
    ax.set_yticks(y)
    ax.set_yticklabels(dom_means.index.get_level_values("domain").tolist(), fontsize=7)
    ax.set_xlabel("mean NNLS proportion")
    legend_right(ax, fig, [Patch(color=ct_colors[c], label=c) for c in celltypes],
                 celltypes, "celltype", right=0.76)
    caption(fig, "line3 mouse: domain celltype composition",
            "source=processed/deconv_mouse.h5ad (project Line 2 signatures)",
            "n=%d spots, %d domains, %d celltypes" % (deconv.n_obs, len(dom_means), len(celltypes)))
    save(fig, "l3_mouse_15_deconv_composition.png")

    # 16: three-sample macrophage-fraction panel.
    fig, axes = plt.subplots(1, 3, figsize=(15, 5.2))
    vmax = max(float(np.nanpercentile(macro, 99)), 1e-6)
    for ax, sample, letter in zip(axes, samples, "ABC"):
        mask = samp == sample
        im = ax.scatter(xy[mask, 0], xy[mask, 1], c=macro[mask], cmap="viridis",
                        s=5, linewidths=0, vmin=0, vmax=vmax)
        ax.set_aspect("equal")
        ax.invert_yaxis()
        ax.set_xticks([])
        ax.set_yticks([])
        ax.set_title("%s: %s" % (letter, sample), fontsize=9)
    cb = fig.colorbar(im, ax=axes, fraction=0.025, pad=0.02)
    cb.set_label("macrophage fraction")
    fig.subplots_adjust(left=0.03, right=0.88, top=0.92, bottom=0.08, wspace=0.06)
    caption(fig, "line3 mouse: macrophage fraction across samples",
            "source=processed/deconv_mouse.h5ad (project Line 2 signatures)",
            "n=%d spots; shared color scale" % deconv.n_obs)
    save(fig, "l3_mouse_16_domain_panel.png")

    # 17: sample-level celltype composition.
    sample_ct = dom_means.groupby(level="sample_id")[celltypes].mean().reindex(samples)
    fig, ax = plt.subplots(figsize=(9, 6.5))
    bottom = np.zeros(len(sample_ct))
    for ct in celltypes:
        values = sample_ct[ct].to_numpy()
        ax.bar(range(len(sample_ct)), values, bottom=bottom, color=ct_colors[ct],
               width=0.65, label=ct)
        bottom += values
    ax.set_xticks(range(len(sample_ct)))
    ax.set_xticklabels(sample_ct.index.tolist(), rotation=25, ha="right")
    ax.set_ylabel("mean NNLS proportion")
    legend_right(ax, fig, [Patch(color=ct_colors[c], label=c) for c in celltypes],
                 celltypes, "celltype", right=0.78)
    caption(fig, "line3 mouse: sample-level celltype composition",
            "source=processed/deconv_mouse.h5ad (project Line 2 signatures)",
            "n=%d samples, %d celltypes" % (len(samples), len(celltypes)))
    save(fig, "l3_mouse_17_celltype_composition.png")

    rows = [
        ("l3_mouse_01_domains_*", "processed/deconv_mouse.h5ad", "project adapter, 47 domains"),
        ("l3_mouse_02_target_gene_*", "processed/localization_mouse.h5ad", "project adapter"),
        ("l3_mouse_04_morans_top", "results/morans_i_top_genes.tsv", "project adapter"),
        ("l3_mouse_06_umap_sample", "processed/deconv_mouse.h5ad", "recomputed UMAP"),
        ("l3_mouse_07_domain_composition", "processed/deconv_mouse.h5ad", "project adapter"),
        ("l3_mouse_08_target_gene_by_domain", "processed/localization_mouse.h5ad", "project adapter"),
        ("l3_mouse_14_deconv_umap", "processed/deconv_mouse.h5ad", "project Line 2 signatures"),
        ("l3_mouse_15_deconv_composition", "processed/deconv_mouse.h5ad", "project Line 2 signatures"),
        ("l3_mouse_16_domain_panel", "processed/deconv_mouse.h5ad", "project Line 2 signatures"),
        ("l3_mouse_17_celltype_composition", "processed/deconv_mouse.h5ad", "project Line 2 signatures"),
        ("l3_mouse_03_ko_dr_*", "spatial_knockout_mouse.h5ad + deconv_mouse.h5ad", "spot-level KO values; project spatial labels"),
        ("l3_mouse_05_knockout_dr", "legacy spatial_knockout_mouse.h5ad", "master branch, 13 domains; not project-aligned"),
        ("l3_mouse_09_ko_dr_by_domain", "spatial_knockout_mouse.h5ad + deconv_mouse.h5ad", "spot-level KO values; project 47 domains"),
        ("l3_mouse_10..13", "legacy knockout outputs", "master branch; not project-aligned"),
    ]
    pd.DataFrame(rows, columns=["figure", "source", "status"]).to_csv(
        FIG / "FIGURE_SOURCE_MANIFEST.tsv", sep="\t", index=False
    )
    (FIG / "README_FIGURE_SOURCES.md").write_text(
        "# L3 figure provenance\n\n"
        "The project-aligned figures are rendered by `scripts/line3_spatial/align_project_figures.py` "
        "from `processed/deconv_mouse.h5ad` and `processed/localization_mouse.h5ad`.\n\n"
        "`l3_mouse_03_ko_dr_*` and `l3_mouse_09_ko_dr_by_domain` use spot-level KO values projected onto "
        "the project 47-domain labels. `l3_mouse_05` and `l3_mouse_10..13` remain legacy master-branch "
        "summaries and must not be described as project 47-domain results.\n",
        encoding="utf-8",
    )
    print("figure provenance manifest written", flush=True)


if __name__ == "__main__":
    main()
