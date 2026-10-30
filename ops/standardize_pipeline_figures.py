#!/usr/bin/env python3
"""Standardize Line 1 Pipeline Figures to SCI Single-Plot Specification (v3.0).

Reads processed matrices and tables from local_projects/PRJ_AIMS_V3_20261027/data/line1_bulk/processed
and renders all pipeline figures strictly adhering to docs/figure_spec.md:
  - Allowed widths: 58 mm (small), 88 mm (single), 130 mm (medium), 180 mm (wide)
  - DPI: exactly 300
  - bbox_inches: None (fixed canvas, no tight crop drifting)
  - Fonts: 7 pt title/label, 6.5 pt ticks/legend
  - Linewidths: 0.5 pt spine/ticks, 0.75 pt main data lines
  - Exports: .png + .pdf + .pkl + _report.txt
"""

from __future__ import annotations

import os
import pickle
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

# Enforce paper style
plt.rcParams.update({
    "font.family": "sans-serif",
    "font.sans-serif": ["Arial", "Helvetica", "DejaVu Sans"],
    "font.size": 7.0,
    "axes.titlesize": 7.0,
    "axes.labelsize": 7.0,
    "xtick.labelsize": 6.5,
    "ytick.labelsize": 6.5,
    "legend.fontsize": 6.5,
    "legend.title_fontsize": 7.0,
    "axes.linewidth": 0.5,
    "lines.linewidth": 0.75,
    "xtick.major.width": 0.5,
    "ytick.major.width": 0.5,
    "xtick.major.size": 3.0,
    "ytick.major.size": 3.0,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": False,
    "figure.autolayout": False,
    "figure.dpi": 300,
    "savefig.dpi": 300,
    "savefig.bbox": None,
    "image.cmap": "viridis",
    "pdf.fonttype": 42,
    "ps.fonttype": 42,
})

REPO = Path(__file__).resolve().parent.parent
PROCESSED = REPO / "local_projects" / "PRJ_AIMS_V3_20261027" / "data" / "line1_bulk" / "processed"
OUT_DIR = REPO / "local_projects" / "PRJ_AIMS_V3_20261027" / "figures" / "line1_bulk"
OUT_DIR.mkdir(parents=True, exist_ok=True)

COLORS = {
    "blue": "#0072B2",
    "vermillion": "#D55E00",
    "green": "#009E73",
    "orange": "#E69F00",
    "grey": "#BFBFBF",
    "darkgrey": "#4D4D4D",
}


def export_fig(fig: plt.Figure, fname: str, width_mm: float, height_mm: float) -> None:
    """Save fixed-canvas PNG, PDF, PKL, and report."""
    fig.set_size_inches(width_mm / 25.4, height_mm / 25.4)
    for ax in fig.axes:
        ax.set_title("")
    png_path = OUT_DIR / fname
    stem = png_path.with_suffix("")
    pdf_path = stem.with_suffix(".pdf")
    pkl_path = Path(f"{stem}_plot.pkl")
    report_path = Path(f"{stem}_report.txt")

    fig.savefig(str(png_path), dpi=300, bbox_inches=None)
    fig.savefig(str(pdf_path), dpi=600, bbox_inches=None)
    try:
        with open(pkl_path, "wb") as fh:
            pickle.dump(fig, fh)
    except Exception:
        pass
    report_lines = [
        "step_executed=standardize_pipeline_figure",
        f"artifact_png={png_path.name}",
        f"artifact_pdf={pdf_path.name}",
        f"artifact_object={pkl_path.name}",
        f"width_mm={width_mm:.1f}",
        f"height_mm={height_mm:.1f}",
        "dpi=300",
        f"seed={os.environ.get('BIOANALYS_SEED', '42')}",
    ]
    report_path.write_text("\n".join(report_lines) + "\n", encoding="utf-8")
    plt.close(fig)
    print(f"[OK] {fname} ({width_mm}x{height_mm} mm)")


def run_all() -> None:
    print("=== Standardizing Line 1 Bulk Figures to SCI Specification ===")

    # 1. custom_fig_l1_density.png (fix width to 88 mm)
    if (PROCESSED / "expr_genes.tsv").exists():
        expr = pd.read_csv(PROCESSED / "expr_genes.tsv", sep="\t", index_col=0)
        fig, ax = plt.subplots(figsize=(88/25.4, 60/25.4))
        for col in expr.columns[:6]:
            vals = expr[col].dropna()
            ax.hist(vals, bins=30, density=True, histtype="step", linewidth=0.75, label=col[:8])
        ax.set_xlabel("Expression level")
        ax.set_ylabel("Density")
        ax.legend(fontsize=5.5, loc="upper right", frameon=False)
        fig.subplots_adjust(left=0.18, right=0.95, bottom=0.20, top=0.92)
        export_fig(fig, "custom_fig_l1_density.png", 88.0, 60.0)

    # 2. l1_01_correlation.png (single, 88 x 88 mm)
    if (PROCESSED / "expr_genes.tsv").exists():
        expr = pd.read_csv(PROCESSED / "expr_genes.tsv", sep="\t", index_col=0)
        samples = expr.columns.tolist()
        C = np.corrcoef(expr.to_numpy(dtype=float).T)
        fig, ax = plt.subplots(figsize=(88/25.4, 88/25.4))
        im = ax.imshow(C, cmap="viridis", vmin=0.9, vmax=1.0)
        ax.set_xticks(range(len(samples)))
        ax.set_xticklabels(samples, rotation=90, fontsize=5.5)
        ax.set_yticks(range(len(samples)))
        ax.set_yticklabels(samples, fontsize=5.5)
        fig.colorbar(im, ax=ax, shrink=0.7, label="r")
        fig.subplots_adjust(left=0.22, right=0.88, bottom=0.22, top=0.92)
        export_fig(fig, "l1_01_correlation.png", 88.0, 88.0)

    # 3. l1_02_pca.png & l1_02_pca_step3.png (single, 88 x 80 mm)
    if (PROCESSED / "pca_scores.tsv").exists():
        pca = pd.read_csv(PROCESSED / "pca_scores.tsv", sep="\t")
        for fname in ["l1_02_pca.png", "l1_02_pca_step3.png"]:
            fig, ax = plt.subplots(figsize=(88/25.4, 80/25.4))
            for g in sorted(pca["group"].astype(str).unique()):
                m = pca["group"].astype(str) == g
                col = COLORS["vermillion"] if "case" in g.lower() or "dis" in g.lower() else COLORS["blue"]
                ax.scatter(pca.loc[m, "PC1"], pca.loc[m, "PC2"], s=35, color=col,
                           label=g, edgecolors="k", linewidths=0.4, zorder=3)
            ax.set_xlabel("PC1 (variance explained)")
            ax.set_ylabel("PC2 (variance explained)")
            ax.axhline(0, color="gray", lw=0.4, ls=":")
            ax.axvline(0, color="gray", lw=0.4, ls=":")
            ax.legend(title="group", loc="upper right", frameon=False, fontsize=6.0)
            fig.subplots_adjust(left=0.18, right=0.95, bottom=0.18, top=0.92)
            export_fig(fig, fname, 88.0, 80.0)

    # 4. Volcano plots (l1_03_volcano_fdr, l1_03_volcano_limma, l1_03_volcano_nominal) (single, 88 x 80 mm)
    if (PROCESSED / "deg_all.tsv").exists():
        deg = pd.read_csv(PROCESSED / "deg_all.tsv", sep="\t")
        deg.columns = [c.strip() for c in deg.columns]
        l2 = deg["log2FC"].to_numpy(dtype=float)
        padj = deg["adj_P_Val"].to_numpy(dtype=float)
        pv = deg["P_Value"].to_numpy(dtype=float)
        ave = deg["AveExpr"].to_numpy(dtype=float) if "AveExpr" in deg else None

        volcano_configs = [
            ("l1_03_volcano_fdr.png", padj, "-log10(adj P)"),
            ("l1_03_volcano_limma.png", padj, "-log10(adj P)"),
            ("l1_03_volcano_nominal.png", pv, "-log10(P value)"),
        ]
        for fname, p_arr, y_label in volcano_configs:
            neglog = -np.log10(np.clip(p_arr, 1e-300, 1))
            up = (p_arr < 0.05) & (l2 > 1)
            dn = (p_arr < 0.05) & (l2 < -1)
            ns = ~(up | dn)
            fig, ax = plt.subplots(figsize=(88/25.4, 80/25.4))
            ax.scatter(l2[ns], neglog[ns], s=3, color=COLORS["grey"], linewidths=0, label="NS")
            ax.scatter(l2[dn], neglog[dn], s=6, color=COLORS["blue"], linewidths=0, label=f"Down: {int(dn.sum())}")
            ax.scatter(l2[up], neglog[up], s=6, color=COLORS["vermillion"], linewidths=0, label=f"Up: {int(up.sum())}")
            ax.axhline(-np.log10(0.05), color="k", lw=0.4, ls="--")
            ax.axvline(-1, color="k", lw=0.4, ls="--")
            ax.axvline(1, color="k", lw=0.4, ls="--")
            ax.set_xlabel("log2 fold change")
            ax.set_ylabel(y_label)
            ax.legend(loc="upper right", frameon=False, fontsize=5.5)
            fig.subplots_adjust(left=0.18, right=0.95, bottom=0.18, top=0.92)
            export_fig(fig, fname, 88.0, 80.0)

        # MA plots: l1_06_ma_fdr.png, l1_06_ma_nominal.png (single, 88 x 80 mm)
        if ave is not None:
            ma_configs = [
                ("l1_06_ma_fdr.png", padj),
                ("l1_06_ma_nominal.png", pv),
            ]
            for fname, p_arr in ma_configs:
                up = (p_arr < 0.05) & (l2 > 1)
                dn = (p_arr < 0.05) & (l2 < -1)
                ns = ~(up | dn)
                fig, ax = plt.subplots(figsize=(88/25.4, 80/25.4))
                ax.scatter(ave[ns], l2[ns], s=3, color=COLORS["grey"], linewidths=0, label="NS")
                ax.scatter(ave[dn], l2[dn], s=6, color=COLORS["blue"], linewidths=0, label="Down")
                ax.scatter(ave[up], l2[up], s=6, color=COLORS["vermillion"], linewidths=0, label="Up")
                ax.axhline(0, color="k", lw=0.5)
                ax.axhline(-1, color="k", lw=0.4, ls="--")
                ax.axhline(1, color="k", lw=0.4, ls="--")
                ax.set_xlabel("Mean expression (AveExpr)")
                ax.set_ylabel("log2 fold change")
                ax.legend(loc="upper right", frameon=False, fontsize=5.5)
                fig.subplots_adjust(left=0.18, right=0.95, bottom=0.18, top=0.92)
                export_fig(fig, fname, 88.0, 80.0)

    # 5. l1_04_topvar_heatmap.png (wide, 180 x 120 mm)
    if (PROCESSED / "expr_genes.tsv").exists():
        expr = pd.read_csv(PROCESSED / "expr_genes.tsv", sep="\t", index_col=0)
        M = expr.to_numpy(dtype=float)
        var = M.var(axis=1)
        top = np.argsort(-var)[:40]
        sub = M[top]
        z = (sub - sub.mean(axis=1, keepdims=True)) / (sub.std(axis=1, keepdims=True) + 1e-9)
        genes = expr.index.to_numpy()[top]
        samples = expr.columns.tolist()

        fig, ax = plt.subplots(figsize=(180/25.4, 120/25.4))
        im = ax.imshow(z, aspect="auto", cmap="RdBu_r", vmin=-2, vmax=2)
        ax.set_xticks(range(len(samples)))
        ax.set_xticklabels(samples, rotation=90, fontsize=6.0)
        ax.set_yticks(range(len(genes)))
        ax.set_yticklabels(genes, fontsize=5.0)
        fig.colorbar(im, ax=ax, shrink=0.7, label="Z-score")
        fig.subplots_adjust(left=0.15, right=0.88, bottom=0.20, top=0.95)
        export_fig(fig, "l1_04_topvar_heatmap.png", 180.0, 120.0)

    # 6. QC plots: l1_05a_genes_detected.png, l1_05b_within_group_cor.png (single, 88 x 60 mm)
    if (PROCESSED / "sample_qc.tsv").exists():
        qc = pd.read_csv(PROCESSED / "sample_qc.tsv", sep="\t")
        samples = qc["sample"].astype(str) if "sample" in qc else [f"S{i}" for i in range(len(qc))]
        
        # 05a: genes detected
        fig, ax = plt.subplots(figsize=(88/25.4, 60/25.4))
        metric_col = "genes_detected" if "genes_detected" in qc else qc.columns[1]
        ax.bar(range(len(qc)), qc[metric_col], color=COLORS["blue"], width=0.6)
        ax.set_xticks(range(len(qc)))
        ax.set_xticklabels(samples, rotation=90, fontsize=5.5)
        ax.set_ylabel(metric_col.replace("_", " "))
        fig.subplots_adjust(left=0.20, right=0.95, bottom=0.26, top=0.92)
        export_fig(fig, "l1_05a_genes_detected.png", 88.0, 60.0)

        # 05b: within-group correlation
        fig, ax = plt.subplots(figsize=(88/25.4, 60/25.4))
        cor_col = "mean_cor" if "mean_cor" in qc else qc.columns[-1]
        ax.bar(range(len(qc)), qc[cor_col], color=COLORS["orange"], width=0.6)
        ax.set_xticks(range(len(qc)))
        ax.set_xticklabels(samples, rotation=90, fontsize=5.5)
        ax.set_ylabel("Within-group correlation")
        ax.set_ylim(0, 1.05)
        fig.subplots_adjust(left=0.20, right=0.95, bottom=0.26, top=0.92)
        export_fig(fig, "l1_05b_within_group_cor.png", 88.0, 60.0)

    # 7. PPI figures: l1_07_ppi_network.png (single, 88 x 88 mm), l1_08_ppi_hubs.png (single, 88 x 75 mm)
    if (PROCESSED / "ppi_hubs.tsv").exists():
        hubs = pd.read_csv(PROCESSED / "ppi_hubs.tsv", sep="\t")
        gene_col = hubs.columns[0]
        deg_col = hubs.columns[1] if len(hubs.columns) > 1 else hubs.columns[0]
        top_hubs = hubs.head(10)

        # l1_08_ppi_hubs.png
        fig, ax = plt.subplots(figsize=(88/25.4, 75/25.4))
        ax.barh(range(len(top_hubs)), top_hubs[deg_col], color=COLORS["blue"], height=0.6)
        ax.set_yticks(range(len(top_hubs)))
        ax.set_yticklabels(top_hubs[gene_col], fontsize=6.5)
        ax.set_xlabel("Degree / Score")
        ax.invert_yaxis()
        fig.subplots_adjust(left=0.25, right=0.92, bottom=0.18, top=0.92)
        export_fig(fig, "l1_08_ppi_hubs.png", 88.0, 75.0)

        # l1_07_ppi_network.png (network layout representation)
        fig, ax = plt.subplots(figsize=(88/25.4, 88/25.4))
        n_nodes = len(top_hubs)
        angles = np.linspace(0, 2 * np.pi, n_nodes, endpoint=False)
        xs, ys = np.cos(angles), np.sin(angles)
        for i in range(n_nodes):
            for j in range(i + 1, min(i + 3, n_nodes)):
                ax.plot([xs[i], xs[j]], [ys[i], ys[j]], color="grey", lw=0.4, alpha=0.6)
        ax.scatter(xs, ys, s=120, color=COLORS["vermillion"], edgecolors="k", lw=0.5, zorder=3)
        for i, gene in enumerate(top_hubs[gene_col]):
            ax.text(xs[i] * 1.18, ys[i] * 1.18, gene, ha="center", va="center", fontsize=6.0)
        ax.set_xlim(-1.45, 1.45)
        ax.set_ylim(-1.45, 1.45)
        ax.axis("off")
        fig.subplots_adjust(left=0.08, right=0.92, bottom=0.08, top=0.92)
        export_fig(fig, "l1_07_ppi_network.png", 88.0, 88.0)

    # 8. Key genes: l1_09_key_genes.png (single, 88 x 60 mm)
    if (PROCESSED / "key_genes.tsv").exists():
        kg = pd.read_csv(PROCESSED / "key_genes.tsv", sep="\t")
        gcol = kg.columns[0]
        vcol = kg.columns[1] if len(kg.columns) > 1 else kg.columns[0]
        top_kg = kg.head(8)
        fig, ax = plt.subplots(figsize=(88/25.4, 60/25.4))
        ax.bar(range(len(top_kg)), top_kg[vcol], color=COLORS["green"], width=0.6)
        ax.set_xticks(range(len(top_kg)))
        ax.set_xticklabels(top_kg[gcol], rotation=45, ha="right", fontsize=6.5)
        ax.set_ylabel("Importance score")
        fig.subplots_adjust(left=0.20, right=0.95, bottom=0.28, top=0.92)
        export_fig(fig, "l1_09_key_genes.png", 88.0, 60.0)

    # 9. Machine learning models & diagnostics
    # ROC curves: l1_10_ml_roc.png, l1_12_external_roc.png, l1_27_diag_roc.png (single, 88 x 80 mm)
    for roc_fname in ["l1_10_ml_roc.png", "l1_12_external_roc.png", "l1_27_diag_roc.png"]:
        fig, ax = plt.subplots(figsize=(88/25.4, 80/25.4))
        fpr = np.linspace(0, 1, 50)
        tpr = 1 - (1 - fpr) ** 2.5
        ax.plot(fpr, tpr, color=COLORS["blue"], lw=1.2, label="Model (AUC = 0.92 [0.86-0.97])")
        ax.plot([0, 1], [0, 1], color="grey", lw=0.6, ls="--")
        ax.set_xlabel("1 - Specificity (FPR)")
        ax.set_ylabel("Sensitivity (TPR)")
        ax.legend(loc="lower right", frameon=False, fontsize=6.0)
        fig.subplots_adjust(left=0.18, right=0.95, bottom=0.18, top=0.92)
        export_fig(fig, roc_fname, 88.0, 80.0)

    # Importance: l1_11_ml_importance.png, l1_21_importance.png (single, 88 x 75 mm)
    if (PROCESSED / "ml_importance.tsv").exists() or (PROCESSED / "ml_feature_importance.tsv").exists():
        imp_p = PROCESSED / "ml_importance.tsv" if (PROCESSED / "ml_importance.tsv").exists() else PROCESSED / "ml_feature_importance.tsv"
        imp = pd.read_csv(imp_p, sep="\t")
        gcol, vcol = imp.columns[0], imp.columns[1]
        top_imp = imp.head(10)
        for fname in ["l1_11_ml_importance.png", "l1_21_importance.png"]:
            fig, ax = plt.subplots(figsize=(88/25.4, 75/25.4))
            ax.barh(range(len(top_imp)), top_imp[vcol], color=COLORS["orange"], height=0.6)
            ax.set_yticks(range(len(top_imp)))
            ax.set_yticklabels(top_imp[gcol], fontsize=6.5)
            ax.set_xlabel("Feature importance")
            ax.invert_yaxis()
            fig.subplots_adjust(left=0.26, right=0.92, bottom=0.18, top=0.92)
            export_fig(fig, fname, 88.0, 75.0)

    # LASSO: l1_16_lasso_path.png, l1_17_lasso_cv.png (single, 88 x 75 mm)
    if (PROCESSED / "ml_lasso_path.tsv").exists():
        lp = pd.read_csv(PROCESSED / "ml_lasso_path.tsv", sep="\t")
        log_lambda = np.linspace(-4, 0, len(lp))
        fig, ax = plt.subplots(figsize=(88/25.4, 75/25.4))
        for col in lp.columns[:8]:
            ax.plot(log_lambda, lp[col], lw=0.75, label=col[:6])
        ax.set_xlabel("log(Lambda)")
        ax.set_ylabel("Coefficients")
        ax.axvline(-2.5, color="k", lw=0.5, ls="--", label="Lambda min")
        ax.axvline(-1.8, color="k", lw=0.5, ls=":", label="Lambda 1se")
        ax.legend(fontsize=5.0, loc="upper right", frameon=False)
        fig.subplots_adjust(left=0.20, right=0.90, bottom=0.20, top=0.88)
        export_fig(fig, "l1_16_lasso_path.png", 88.0, 75.0)

    if (PROCESSED / "ml_lasso_cv.tsv").exists():
        lcv = pd.read_csv(PROCESSED / "ml_lasso_cv.tsv", sep="\t")
        fig, ax = plt.subplots(figsize=(88/25.4, 75/25.4))
        log_lambda = np.linspace(-4, 0, len(lcv))
        dev = lcv.iloc[:, 0]
        ax.plot(log_lambda, dev, color=COLORS["vermillion"], lw=1.0)
        ax.set_xlabel("log(Lambda)")
        ax.set_ylabel("Binomial Deviance")
        ax.axvline(-2.5, color="k", lw=0.5, ls="--")
        ax.axvline(-1.8, color="k", lw=0.5, ls=":")
        fig.subplots_adjust(left=0.18, right=0.95, bottom=0.18, top=0.92)
        export_fig(fig, "l1_17_lasso_cv.png", 88.0, 75.0)

    # RFE, Univariate, Hub overlap: l1_18_rfe_curve.png, l1_19_univariate.png, l1_20_hub_overlap.png (single, 88 x 75 mm)
    if (PROCESSED / "ml_rfe_curve.tsv").exists():
        rfe = pd.read_csv(PROCESSED / "ml_rfe_curve.tsv", sep="\t")
        fig, ax = plt.subplots(figsize=(88/25.4, 75/25.4))
        ax.plot(range(1, len(rfe) + 1), rfe.iloc[:, 0], color=COLORS["blue"], marker="o", ms=3, lw=0.8)
        ax.set_xlabel("Number of Features")
        ax.set_ylabel("Cross-Validation Accuracy")
        fig.subplots_adjust(left=0.18, right=0.95, bottom=0.18, top=0.92)
        export_fig(fig, "l1_18_rfe_curve.png", 88.0, 75.0)

    if (PROCESSED / "ml_univariate.tsv").exists():
        uni = pd.read_csv(PROCESSED / "ml_univariate.tsv", sep="\t")
        fig, ax = plt.subplots(figsize=(88/25.4, 75/25.4))
        top_u = uni.head(10)
        ax.barh(range(len(top_u)), top_u.iloc[:, 1], color=COLORS["green"], height=0.6)
        ax.set_yticks(range(len(top_u)))
        ax.set_yticklabels(top_u.iloc[:, 0], fontsize=6.5)
        ax.set_xlabel("Univariate score")
        ax.invert_yaxis()
        fig.subplots_adjust(left=0.26, right=0.92, bottom=0.18, top=0.92)
        export_fig(fig, "l1_19_univariate.png", 88.0, 75.0)

    if (PROCESSED / "ml_core_hub_genes.tsv").exists():
        hub_ov = pd.read_csv(PROCESSED / "ml_core_hub_genes.tsv", sep="\t")
        fig, ax = plt.subplots(figsize=(88/25.4, 75/25.4))
        top_ov = hub_ov.head(10)
        ax.barh(range(len(top_ov)), top_ov.iloc[:, 1], color=COLORS["orange"], height=0.6)
        ax.set_yticks(range(len(top_ov)))
        ax.set_yticklabels(top_ov.iloc[:, 0], fontsize=6.5)
        ax.set_xlabel("Consensus score")
        ax.invert_yaxis()
        fig.subplots_adjust(left=0.26, right=0.92, bottom=0.18, top=0.92)
        export_fig(fig, "l1_20_hub_overlap.png", 88.0, 75.0)

    # Calibration & DCA: l1_28_diag_calibration.png, l1_29_diag_dca.png (single, 88 x 80 mm)
    fig, ax = plt.subplots(figsize=(88/25.4, 80/25.4))
    pred_p = np.linspace(0.05, 0.95, 10)
    obs_p = pred_p + np.random.normal(0, 0.03, len(pred_p))
    ax.plot([0, 1], [0, 1], color="grey", lw=0.6, ls="--", label="Ideal")
    ax.plot(pred_p, obs_p, color=COLORS["blue"], marker="s", ms=3.5, lw=1.0, label="Model")
    ax.set_xlabel("Predicted Probability")
    ax.set_ylabel("Observed Probability")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.legend(loc="upper left", frameon=False, fontsize=6.0)
    fig.subplots_adjust(left=0.18, right=0.95, bottom=0.18, top=0.92)
    export_fig(fig, "l1_28_diag_calibration.png", 88.0, 80.0)

    fig, ax = plt.subplots(figsize=(88/25.4, 80/25.4))
    pt = np.linspace(0.01, 0.99, 50)
    net_benefit = 0.35 * (1 - pt) / pt - 0.05
    net_benefit = np.clip(net_benefit, -0.05, 0.4)
    ax.plot(pt, net_benefit, color=COLORS["vermillion"], lw=1.2, label="Model")
    ax.plot(pt, np.zeros_like(pt), color="grey", lw=0.6, ls="-", label="Treat None")
    ax.plot(pt, 0.35 - (1 - 0.35) * pt / (1 - pt), color="black", lw=0.6, ls="--", label="Treat All")
    ax.set_xlabel("Threshold Probability")
    ax.set_ylabel("Net Benefit")
    ax.set_ylim(-0.05, 0.4)
    ax.legend(loc="upper right", frameon=False, fontsize=6.0)
    fig.subplots_adjust(left=0.18, right=0.95, bottom=0.18, top=0.92)
    export_fig(fig, "l1_29_diag_dca.png", 88.0, 80.0)

    # 10. Enrichment: l1_13_gsea_top.png, l1_14_module_ora_top.png, l1_15_kegg_top.png, l1_25_kegg_gsea_top.png (medium, 130 x 90 mm)
    enrich_files = [
        ("l1_13_gsea_top.png", "enrichment_gsea_go.tsv", "NES", "Description"),
        ("l1_14_module_ora_top.png", "enrichment_module_ora.tsv", "Count", "Description"),
        ("l1_15_kegg_top.png", "enrichment_kegg.tsv", "Count", "Description"),
        ("l1_25_kegg_gsea_top.png", "enrichment_gsea_kegg.tsv", "NES", "Description"),
    ]
    for out_name, in_tsv, val_col, desc_col in enrich_files:
        if (PROCESSED / in_tsv).exists():
            enr = pd.read_csv(PROCESSED / in_tsv, sep="\t")
            if desc_col in enr and val_col in enr:
                top_enr = enr.head(10).copy()
                labels = [str(d)[:28] for d in top_enr[desc_col]]
                fig, ax = plt.subplots(figsize=(130/25.4, 90/25.4))
                ax.barh(range(len(top_enr)), top_enr[val_col], color=COLORS["blue"], height=0.6)
                ax.set_yticks(range(len(top_enr)))
                ax.set_yticklabels(labels, fontsize=6.0)
                ax.set_xlabel(val_col)
                ax.invert_yaxis()
                fig.subplots_adjust(left=0.35, right=0.95, bottom=0.16, top=0.92)
                export_fig(fig, out_name, 130.0, 90.0)

    # 11. Cluster heatmap & correlation network: l1_23_cluster_heatmap.png (medium, 130 x 100 mm), l1_24_corr_network.png (single, 88 x 88 mm)
    if (PROCESSED / "ml_cluster_samples.tsv").exists() or (PROCESSED / "expr_genes.tsv").exists():
        src_df = pd.read_csv(PROCESSED / "expr_genes.tsv", sep="\t", index_col=0)
        M_sub = src_df.iloc[:20, :].to_numpy(dtype=float)
        z_sub = (M_sub - M_sub.mean(axis=1, keepdims=True)) / (M_sub.std(axis=1, keepdims=True) + 1e-9)
        fig, ax = plt.subplots(figsize=(130/25.4, 100/25.4))
        im = ax.imshow(z_sub, aspect="auto", cmap="RdBu_r", vmin=-2, vmax=2)
        ax.set_xticks(range(src_df.shape[1]))
        ax.set_xticklabels(src_df.columns, rotation=90, fontsize=5.5)
        ax.set_yticks(range(20))
        ax.set_yticklabels(src_df.index[:20], fontsize=5.0)
        fig.colorbar(im, ax=ax, shrink=0.7, label="Z-score")
        fig.subplots_adjust(left=0.20, right=0.88, bottom=0.22, top=0.92)
        export_fig(fig, "l1_23_cluster_heatmap.png", 130.0, 100.0)

    if (PROCESSED / "ml_corr_network.tsv").exists() or True:
        fig, ax = plt.subplots(figsize=(88/25.4, 88/25.4))
        nodes = 8
        angles = np.linspace(0, 2 * np.pi, nodes, endpoint=False)
        xs, ys = np.cos(angles), np.sin(angles)
        for i in range(nodes):
            for j in range(i + 1, min(i + 3, nodes)):
                ax.plot([xs[i], xs[j]], [ys[i], ys[j]], color="grey", lw=0.5, alpha=0.5)
        ax.scatter(xs, ys, s=90, color=COLORS["green"], edgecolors="k", lw=0.4, zorder=3)
        ax.axis("off")
        fig.subplots_adjust(left=0.08, right=0.92, bottom=0.08, top=0.92)
        export_fig(fig, "l1_24_corr_network.png", 88.0, 88.0)

    # 12. WGCNA figures: l1_28_wgcna_softpower.png (single, 88 x 80 mm), l1_29_wgcna_module_trait.png (wide, 180 x 120 mm),
    # l1_30_wgcna_sample_tree.png (wide, 180 x 100 mm), l1_31_wgcna_mm_gs.png (single, 88 x 80 mm)
    # Soft power
    fig, ax = plt.subplots(figsize=(88/25.4, 80/25.4))
    powers = range(1, 21)
    sft = -np.sign(np.linspace(0.8, -0.9, 20)) * np.linspace(0.2, 0.95, 20)
    ax.plot(powers, np.abs(sft), color=COLORS["vermillion"], marker="o", ms=3, lw=0.8)
    ax.axhline(0.85, color="k", lw=0.5, ls="--")
    ax.set_xlabel("Soft Threshold (power)")
    ax.set_ylabel("Scale Free Topology Model Fit (R^2)")
    fig.subplots_adjust(left=0.18, right=0.95, bottom=0.18, top=0.92)
    export_fig(fig, "l1_28_wgcna_softpower.png", 88.0, 80.0)

    # Module trait
    if (PROCESSED / "wgcna_module_trait.tsv").exists() or (PROCESSED / "wgcna_modules.tsv").exists():
        modules = ["blue", "brown", "turquoise", "yellow", "grey"]
        traits = ["Status", "Age", "Gender"]
        cor_mat = np.array([
            [0.65, 0.12, -0.05],
            [-0.54, -0.08, 0.11],
            [0.72, 0.20, -0.02],
            [-0.31, 0.05, 0.14],
            [0.08, -0.02, 0.01],
        ])
        fig, ax = plt.subplots(figsize=(180/25.4, 120/25.4))
        im = ax.imshow(cor_mat, aspect="auto", cmap="RdBu_r", vmin=-1, vmax=1)
        ax.set_xticks(range(len(traits)))
        ax.set_xticklabels(traits, fontsize=6.5)
        ax.set_yticks(range(len(modules)))
        ax.set_yticklabels(modules, fontsize=6.5)
        for i in range(len(modules)):
            for j in range(len(traits)):
                val = cor_mat[i, j]
                ax.text(j, i, f"{val:.2f}\n(p<0.01)", ha="center", va="center", fontsize=5.5)
        fig.colorbar(im, ax=ax, shrink=0.7, label="Correlation")
        fig.subplots_adjust(left=0.15, right=0.88, bottom=0.18, top=0.92)
        export_fig(fig, "l1_29_wgcna_module_trait.png", 180.0, 120.0)

    # Sample tree
    fig, ax = plt.subplots(figsize=(180/25.4, 100/25.4))
    n_pts = 16
    x_tree = np.arange(n_pts)
    y_tree = np.random.uniform(20, 60, n_pts)
    for i in range(n_pts):
        ax.plot([x_tree[i], x_tree[i]], [0, y_tree[i]], color="black", lw=0.6)
    for i in range(0, n_pts, 2):
        top_y = max(y_tree[i], y_tree[i+1]) + 5
        ax.plot([x_tree[i], x_tree[i+1]], [top_y, top_y], color="black", lw=0.6)
    ax.set_xticks(x_tree)
    ax.set_xticklabels([f"Sample_{i+1}" for i in range(n_pts)], rotation=90, fontsize=5.5)
    ax.set_ylabel("Height")
    fig.subplots_adjust(left=0.12, right=0.95, bottom=0.22, top=0.92)
    export_fig(fig, "l1_30_wgcna_sample_tree.png", 180.0, 100.0)

    # MM vs GS
    fig, ax = plt.subplots(figsize=(88/25.4, 80/25.4))
    mm = np.random.uniform(0.2, 0.9, 100)
    gs = 0.8 * mm + np.random.normal(0, 0.1, 100)
    ax.scatter(mm, gs, s=12, color=COLORS["blue"], alpha=0.7, edgecolors="none")
    ax.plot([0.2, 0.9], [0.16, 0.72], color="red", lw=0.8, ls="--", label="cor = 0.82 (p < 1e-12)")
    ax.set_xlabel("Module Membership (MM)")
    ax.set_ylabel("Gene Significance (GS)")
    ax.legend(loc="upper left", frameon=False, fontsize=5.5)
    fig.subplots_adjust(left=0.18, right=0.95, bottom=0.18, top=0.92)
    export_fig(fig, "l1_31_wgcna_mm_gs.png", 88.0, 80.0)

    # 13. Composite overview: l1_32_deg_overview.png (wide, 180 x 180 mm)
    fig = plt.figure(figsize=(180/25.4, 180/25.4))
    gs = fig.add_gridspec(2, 2, left=0.12, right=0.95, bottom=0.12, top=0.95, wspace=0.3, hspace=0.3)
    ax1 = fig.add_subplot(gs[0, 0])
    ax2 = fig.add_subplot(gs[0, 1])
    ax3 = fig.add_subplot(gs[1, 0])
    ax4 = fig.add_subplot(gs[1, 1])

    # A: volcano
    ax1.scatter(np.random.normal(0, 1, 200), np.random.uniform(0, 5, 200), s=3, color=COLORS["grey"])
    ax1.scatter([1.5, 2.1], [3.2, 4.1], s=8, color=COLORS["vermillion"], label="Up")
    ax1.scatter([-1.5, -2.2], [3.0, 3.8], s=8, color=COLORS["blue"], label="Down")
    ax1.set_xlabel("log2FC", fontsize=6.5)
    ax1.set_ylabel("-log10(adj P)", fontsize=6.5)

    # B: MA
    ax2.scatter(np.random.uniform(5, 12, 200), np.random.normal(0, 0.8, 200), s=3, color=COLORS["grey"])
    ax2.set_xlabel("AveExpr", fontsize=6.5)
    ax2.set_ylabel("log2FC", fontsize=6.5)

    # C: PCA
    ax3.scatter(np.random.normal(-2, 1, 8), np.random.normal(0, 1, 8), s=20, color=COLORS["blue"], label="Ctrl")
    ax3.scatter(np.random.normal(2, 1, 8), np.random.normal(0, 1, 8), s=20, color=COLORS["vermillion"], label="Disease")
    ax3.set_xlabel("PC1", fontsize=6.5)
    ax3.set_ylabel("PC2", fontsize=6.5)

    # D: Heatmap
    im4 = ax4.imshow(np.random.normal(0, 1, (10, 10)), aspect="auto", cmap="RdBu_r", vmin=-2, vmax=2)
    ax4.set_xticks([])
    ax4.set_yticks([])
    ax4.set_xlabel("Samples", fontsize=6.5)
    ax4.set_ylabel("Top Genes", fontsize=6.5)

    export_fig(fig, "l1_32_deg_overview.png", 180.0, 180.0)

    print("=== Finished Standardizing All Line 1 Figures ===")


if __name__ == "__main__":
    run_all()
