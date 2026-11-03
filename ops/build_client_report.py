#!/usr/bin/env python3
"""客户交付包七章解读报告自动组装与打包引擎（aims v3.0 §7.2）。

职责（三件事，不碰分析本身）：
  1. 从 `projects/<id>/` 收集实际产物：实例脚本、图件、结果表、任务台账；
  2. 生成 `03_Interpretation_Report/` 下的 `Analysis_Report.md` 与单文件可交互
     `Analysis_Report.html`，严格按 aims v3.0 的七章结构；
  3. 归集三大件并打成 `<project_id>_Client_Delivery.tar.gz`。

设计红线（比功能更重要）：
  * **不编造数字**。所有统计量都从磁盘上的真实文件读出来；读不到就明写
    "未找到该步骤结果文件"，绝不填示例值。报告里出现一个假数字，
    整份交付的可信度就归零。
  * **不重写母版**。本脚本只读产物、只写 `deliverables/`，不修改任何分析脚本。
  * **脱敏绝对路径**。交付包里不允许出现服务器真实路径，统一替换为
    `{{DATA_ROOT}}` 占位（同时替换项目绝对前缀）。

用法：

    # 完整交付（生成报告 + 三大件 + tar.gz）
    python3 ops/build_client_report.py --project /mnt/ssd/bio_data/projects/PRJ_001

    # 只生成报告，不打包（调试用）
    python3 ops/build_client_report.py --project ... --no-tar

    # 只检查会产出什么，不写盘
    python3 ops/build_client_report.py --project ... --dry-run

    # 自检：用内置最小样例跑一遍全部七章渲染
    python3 ops/build_client_report.py --self-test

退出码：0 = 成功；1 = 参数/数据错误；2 = 环境错误（如无法写盘）。
"""

import argparse
import base64
import datetime
import fnmatch
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile

# 数据根目录：报告与脚本里的绝对路径统一替换成占位符
DATA_ROOT = os.environ.get("BIO_DATA_ROOT", "/mnt/ssd/bio_data")
PATH_PLACEHOLDER = "{{DATA_ROOT}}"

LINES = ["line1_bulk", "line2_scrna", "line3_spatial"]
LINE_LABEL = {
    "line1_bulk": "线 1 · GEO Bulk 转录组",
    "line2_scrna": "线 2 · 单细胞转录组",
    "line3_spatial": "线 3 · 空间转录组",
}

# 虚拟敲除相关的步骤：这些步骤产出的是 DR Genes（调控网络拓扑扰动），不是 DEG
DR_STEPS = {"virtual_knockout", "spatial_knockout", "summarize_dr", "dr_post_analysis"}

DEG_TAG = "[DEG · 转录本丰度消长]"
DR_TAG = "[DR Genes · 虚拟敲除调控网络拓扑微扰]"

# 步骤目录：只列关键产物与解读要点。
# 为什么内置而不是去读 project.js：本脚本部署在服务器 ops/ 下，
# 服务器上没有工作台源码；跨端共享代码会让部署多一个隐式依赖。
#
# 为什么按分析线分两层（STEP_CATALOG[line_id][step_id]）：`enrichment`、
# `dr_post_analysis`、`enrichment_figures`、`normalize_hvg` 等步骤名在三条线里
# 重名，但产物不同（如 line2 的 enrichment 写 enrichment_ora.tsv，line3 写
# enrichment_ora_<species>.tsv）。单层 dict 会让后定义的条目覆盖前一条：
# 2026-10-19 S6-scout 实测 line2 的 enrichment 条目（含 label/legend）被 line3
# 覆盖，运行时只剩 line3 的声明。取条目一律走 step_meta(step, line)。
#
# outputs 声明的是**脚本真实写出的文件名**，不是期望文件名；物种段、样本段、
# 细胞类型后缀由数据决定，用 `*` 通配（匹配逻辑见 _match_artifact）。
STEP_CATALOG = {
    # ---------- line1_bulk ----------
    "line1_bulk": {
        "prep_matrix": {
            "label": "GEO 数据获取与探针注释",
            "outputs": ["processed/expr_genes.tsv", "processed/group_map.tsv"],
            "methods": "GEOquery 拉取 series matrix 与 GPL 注释表，多探针映射到同一 Gene Symbol 时取中位数",
            "limits": "探针注释质量取决于 GPL 版本；跨平台合并需另行批次校正，本步骤不做",
            "legend": "Probe-to-symbol collapse and expression matrix assembly.",
        },
        "qc_matrix": {
            "label": "样本质控",
            "outputs": ["results/qc_report.txt"],
            "methods": "统计每样本检出基因数与组内中位相关系数，离群样本在报告中标注但不自动剔除",
            "limits": "离群判定为描述性统计，未做正式离群检验；是否剔除需结合实验记录人工判断",
            "legend": "Sample-level quality control: detected gene counts and within-group correlation.",
        },
        "pca_matrix": {
            "label": "PCA 与样本相关性",
            "outputs": ["results/pca_scores.tsv", "figures/l1_02_pca.png", "figures/l1_02_pca_step3.png"],
            "methods": "方差稳定化后取高变基因做 PCA，样本相关性用 Pearson 系数矩阵",
            "limits": "PCA 只反映转录组整体差异，不能替代分组设计的合理性论证",
            "legend": "Principal component analysis of variance-stabilized expression.",
        },
        "deg_limma": {
            "label": "差异表达分析 (DEG)",
            "outputs": ["results/deg_all.tsv", "results/deg_sig.tsv", "figures/l1_03_volcano_fdr.png",
                        "figures/l1_03_volcano_limma.png"],
            "methods": "limma 线性模型 + 经验贝叶斯收缩，按项目阈值档筛选显著基因",
            "limits": "DEG 反映的是转录本丰度差异，不等于功能因果；样本量小时统计功效有限",
            "legend": "Volcano plot of differentially expressed genes (limma, empirical Bayes).",
        },
        "wgcna_modules": {
            "label": "WGCNA 共表达模块",
            "outputs": ["results/wgcna_modules.tsv", "results/wgcna_module_trait.tsv",
                        "figures/l1_28_wgcna_softpower.png", "figures/l1_29_wgcna_module_trait.png"],
            "methods": "方差前 5000 基因构建加权共表达网络，动态剪切树划分模块，计算模块-表型相关",
            "limits": "模块划分对 soft-threshold 与最小模块大小敏感；样本量 <15 时网络稳定性差",
            "legend": "Weighted gene co-expression network modules and module-trait relationships.",
        },
        "enrichment_bulk": {
            "label": "功能富集 (GO/KEGG/GSEA)",
            "outputs": ["results/enrichment_gsea_go.tsv", "results/enrichment_gsea_kegg.tsv", "results/enrichment_kegg.tsv"],
            "methods": "clusterProfiler 做 GO BP/CC/MF 与 KEGG 的 GSEA 与 ORA",
            "limits": "富集结果依赖注释库版本与背景基因集选择，不代表通路活性被直接测量",
            "legend": "Functional enrichment analysis (GO/KEGG) of differentially expressed genes.",
        },
        "enrichment_figures": {
            "label": "富集出图",
            "outputs": ["figures/l1_13_gsea_top.png"],
            "methods": "取各本体 top20 条目做条形图，双标注条目名与显著性",
            "limits": "条形图只展示 top 条目，完整结果见对应 .tsv",
            "legend": "Top enriched terms across GO and KEGG categories.",
        },
        "ppi_string": {
            "label": "PPI 网络 + Hub 初筛",
            "outputs": ["results/ppi_edges.tsv", "results/ppi_hubs.tsv"],
            "methods": "STRING 数据库取互作边，按 Degree 排序初筛 hub 基因",
            "limits": "STRING 证据来自文本挖掘与实验汇总，存在假阳性；hub 不等于因果驱动基因",
            "legend": "Protein-protein interaction network and hub gene screening (STRING).",
        },
        "key_genes": {
            "label": "交集关键基因",
            "outputs": ["results/key_genes.tsv"],
            "methods": "取 DEG ∩ WGCNA 显著模块 ∩ PPI hub 三者的交集",
            "limits": "交集筛选会放大假阴性；DEG 判据放宽时需在报告中如实标注",
            "legend": "Intersection of DEG, co-expression modules and PPI hubs.",
        },
        "ml_model": {
            "label": "ML 建模 (LR + RF + LOOCV)",
            "outputs": ["results/ml_report.txt", "figures/l1_10_roc.png"],
            "methods": "逻辑回归与随机森林，留一交叉验证评估 ROC",
            "limits": "探索性结果，样本量小且未独立验证时不可作为临床性能指标",
            "legend": "Receiver operating characteristic curves of machine learning classifiers.",
        },
        "ml_hub_analysis": {
            "label": "Hub 基因 ML 精筛 + 重要性评估",
            "outputs": ["results/ml_core_hub_genes.tsv", "results/ml_importance.tsv", "figures/l1_22_shap.png"],
            "methods": "LASSO + RFE + 单因素筛选，随机森林/GBDT 重要性，SHAP 解释单样本贡献",
            "limits": "SHAP 解释的是模型行为而非生物学机制；特征间强相关时归因会分散",
            "legend": "SHAP summary plot for hub gene contributions.",
        },
        "external_validation": {
            "label": "外部验证冻结评估",
            "outputs": ["results/external_validation_preds.tsv", "figures/l1_12_external_roc.png"],
            "methods": "冻结训练集模型权重，直接在独立验证集上计算 ROC，不重新筛基因或调参",
            "limits": "验证集与训练集的平台、人群、预处理差异会影响性能可比性",
            "legend": "External validation ROC of the frozen classifier.",
        },
        "bulk_figures": {
            "label": "Bulk 出图",
            "outputs": ["figures/l1_01_correlation.png"],
            "methods": "统一 300 DPI、二分类固定配色，落盘前经版式收口",
            "limits": "图件为结果呈现，不改变统计结论",
            "legend": "Overview of sample-level and gene-level expression patterns.",
        },
    },
    # ---------- line2_scrna ----------
    "line2_scrna": {
        "ingest_counts": {
            "label": "单细胞数据读入",
            "outputs": ["results/scrna_counts.h5ad", "results/ingest_report.txt"],
            "methods": "读取 10x mtx 或 h5ad 原始计数矩阵，保留基因与细胞元数据",
            "limits": "不同建库平台的基因命名规范不同，读入时统一为大写 Symbol 可能合并同名基因",
            "legend": "Single-cell raw count matrix ingestion.",
        },
        "qc_cells": {
            "label": "细胞质控",
            "outputs": ["results/scrna_qc.h5ad", "results/qc_cell_metrics.tsv", "results/qc_report.txt"],
            "methods": "按检出基因数、UMI 总数与线粒体百分比过滤低质量细胞与双细胞",
            "limits": "阈值按项目配置固定，极端组织（如心肌、肝）可能需要放宽线粒体阈值",
            "legend": "Cell-level quality control metrics before and after filtering.",
        },
        "normalize_hvg": {
            "label": "标准化与高变基因",
            "outputs": ["results/scrna_norm.h5ad", "results/hvg_genes.tsv", "results/norm_report.txt"],
            "methods": "normalize_total + log1p，按方差选择高变基因，原始计数保存在 layers['counts']",
            "limits": "HVG 选择影响下游聚类分辨率；不同 HVG 数量会得到不同亚群粒度",
            "legend": "Normalization and highly variable gene selection.",
        },
        "integrate_harmony": {
            "label": "批次校正 (Harmony)",
            "outputs": ["results/scrna_integrated.h5ad", "results/integrate_report.txt"],
            "methods": "Harmony 在 PCA 空间迭代校正样本间批次效应",
            "limits": "过度校正会抹掉真实的组间差异；校正前后需对比验证",
            "legend": "Batch effect correction using Harmony.",
        },
        "cluster_umap": {
            "label": "降维聚类 UMAP",
            # 该步骤只写检查点与报告，不出图；UMAP 图件由 scrna_figures 统一出
            "outputs": ["results/scrna_clustered.h5ad", "results/cluster_report.txt"],
            "methods": "PCA 取主成分后 Leiden 聚类，UMAP 做二维可视化",
            "limits": "UMAP 的簇间距离不可解释为生物学距离；聚类分辨率是人为参数",
            "legend": "UMAP visualization of Leiden clusters.",
        },
        "annotate_celltypes": {
            "label": "细胞类型注释",
            "outputs": ["results/scrna_annotated.h5ad", "results/cluster_markers.tsv", "results/annotate_report.txt"],
            "methods": "基于经典 marker 表达做细胞类型注释",
            "limits": "注释依赖 marker 库覆盖度；稀有细胞类型与过渡态细胞可能被误判",
            "legend": "Cell type annotation based on canonical marker expression.",
        },
        "scrna_composition": {
            "label": "细胞类型比例/组成分析",
            # 组成图（l2_05/l2_06）由 scrna_figures 产，不在本步骤重复声明
            "outputs": ["results/celltype_composition.tsv", "results/scrna_composition.h5ad",
                        "results/composition_report.txt"],
            "methods": "统计各分组下细胞类型比例，Kruskal-Wallis 检验含 tie 校正",
            "limits": "比例差异可能来自取样与解离偏好，需结合供体层级统计复核",
            "legend": "Cell type composition across groups.",
        },
        "deg_groups": {
            "label": "组间差异表达 (DEG)",
            # 火山图（l2_08）由 scrna_figures 产，不在本步骤重复声明
            "outputs": ["results/deg_all_by_celltype.tsv", "results/deg_significant_by_celltype.tsv",
                        "results/scrna_deg.h5ad", "results/deg_report.txt"],
            "methods": "在固定细胞类型内用 rank_genes_groups 比较 Treat vs Control",
            "limits": "细胞层级检验的伪重复问题：细胞数不等于生物学重复数",
            "legend": "Differential expression within each cell type.",
        },
        "subcluster": {
            "label": "目标细胞亚群再聚类",
            "outputs": ["results/scrna_subcluster.h5ad", "results/scrna_deg_subclustered.h5ad",
                        "results/subcluster_markers.tsv", "results/subcluster_diagnosis_crosstab.tsv",
                        "results/subcluster_report.txt"],
            "methods": "提取目标细胞群重跑 HVG + PCA + 聚类，识别亚群 marker",
            "limits": "再聚类分辨率提高会放大噪声，亚群身份需要独立验证",
            "legend": "Subclustering of the target cell population.",
        },
        "enrichment": {
            "label": "单细胞多维功能富集",
            "outputs": ["results/enrichment_ora.tsv", "results/enrichment_gsea.tsv",
                        "results/enrichment_report.txt"],
            "methods": "gseapy 并行跑 GO BP/CC/MF、KEGG 与 Reactome 的 ORA 与 GSEA",
            "limits": "细胞层级富集同样受伪重复影响，结论应视为假设生成",
            "legend": "Multi-database functional enrichment of cell-type specific DEG.",
        },
        "enrichment_figures": {
            "label": "单细胞富集出图",
            "outputs": ["figures/l2_11_ora_top.png", "figures/l2_12_gsea_top.png"],
            "methods": "取各库 top20 条目做横向条形，双标注 OR/NES 与显著性",
            "limits": "条形图只展示 top 条目，完整结果见 enrichment_ora.tsv / enrichment_gsea.tsv",
            "legend": "Top enriched terms of cell-type specific DEG.",
        },
        "pseudotime": {
            "label": "拟时序/轨迹分析",
            # 母版只写伪时间检查点与报告，不写 track_genes.tsv
            "outputs": ["results/scrna_pseudotime.h5ad", "results/pseudotime_report.txt"],
            "methods": "PAGA 构建状态转移图，DPT 计算伪时间，以 Control 组为起点",
            "limits": "伪时间是有向排序而非真实时间；起点选择会改变整条轨迹解读",
            "legend": "Pseudotime trajectory analysis with Control as the root state.",
        },
        "cell_communication": {
            "label": "细胞通讯分析",
            # 该步骤不出图（历史声明 figures/l2_10_cellchat.png 从未产出，
            # 且 l2_10 序号已被 l2_10_pca_diagnosis.png 占用）
            "outputs": ["results/cellcomm_interactions.tsv", "results/scrna_cellcomm.h5ad",
                        "results/cellcomm_report.txt"],
            "methods": "liana consensus 配受体资源打分，比较组间信号流变化",
            "limits": "通讯推断基于配受体共表达，缺少蛋白层面证据；不同资源库结论可能不一致",
            "legend": "Cell-cell communication inferred from ligand-receptor co-expression.",
        },
        "scenic_tf": {
            "label": "转录因子调控分析 (SCENIC)",
            # tf_activity.tsv 由 tf_activity 步骤写，本步骤只写 regulon/adjacency/AUC 相关表
            "outputs": ["results/scenic_regulons.csv", "results/scenic_adjacencies.tsv",
                        "results/scenic_auc_mtx.tsv", "results/scenic_regulon_by_celltype.tsv",
                        "results/scenic_tf_summary.tsv", "results/scenic_report.txt"],
            "methods": "GRNBoost2 推断共表达模块 → cisTarget motif 富集 → AUCell 计算 regulon 活性",
            "limits": "SCENIC 依赖 motif 数据库与表达矩阵质量；regulon 活性是代理指标",
            "legend": "SCENIC regulon activity inference.",
        },
        "scenic_figures": {
            "label": "SCENIC 出图",
            "outputs": ["figures/l2_scenic_01_regulon_heatmap.png",
                        "figures/l2_scenic_02_top_regulons.png"],
            "methods": "regulon 活性热图 + regulon 特异性 top 条形图",
            "limits": "图件只展示 top regulon，完整 AUC 矩阵见 scenic_auc_mtx.tsv",
            "legend": "SCENIC regulon activity heatmap and top regulon specificity.",
        },
        "tf_activity": {
            "label": "TF 活性打分 (ORA 近似)",
            "outputs": ["results/tf_activity.tsv", "results/tf_report.txt"],
            "methods": "用 TF 靶基因集做 ORA 近似活性打分，作为 SCENIC 的对照路线",
            "limits": "ORA 近似不考虑基因间调控关系，只能作趋势参考",
            "legend": "Transcription factor activity approximated by target-set over-representation.",
        },
        "virtual_knockout": {
            "label": "虚拟敲除 (scTenifoldKnk)",
            "outputs": ["results/ko_dr_genes.tsv", "results/scrna_knockout.h5ad",
                        "results/knockout_report.txt"],
            "methods": "在 WT/Control 矩阵上构建基因调控网络，模拟敲除目标基因后比较网络拓扑变化，输出 DR Genes",
            "limits": "DR Genes 是调控网络拓扑扰动，不是表达量变化；无实验验证时只能作为假设",
            "legend": "Virtual knockout perturbation analysis (scTenifoldKnk).",
        },
        "summarize_dr": {
            "label": "DR 基因汇总",
            "outputs": ["results/dr_genes_summary.tsv", "results/dr_summary_report.txt"],
            "methods": "多次独立运行取 DR 基因稳健交集，按显著性排序",
            "limits": "交集策略提高稳健性但会漏掉单次运行特有信号",
            "legend": "Robust DR gene consensus across independent runs.",
        },
        "target_gene_localization": {
            "label": "目标基因表达定位",
            "outputs": ["results/target_gene_localization.tsv", "results/target_gene_localization_wide.tsv",
                        "results/scrna_localization.h5ad", "results/localization_report.txt",
                        "figures/l2_13_target_gene_dotplot.png"],
            "methods": "敲除基因与细胞类型差异 top5 基因的表达定位",
            "limits": "定位基于表达量，不代表蛋白定位或功能位置",
            "legend": "Expression localization of the target gene across cell types.",
        },
        "gsva_pathways": {
            "label": "GSVA 通路活性打分",
            "outputs": ["results/gsva_scores.tsv", "results/scrna_gsva.h5ad",
                        "results/gsva_report.txt", "figures/l2_14_gsva_heatmap.png"],
            "methods": "pseudobulk 后由 R GSVA 计算通路活性，取 top30 变异通路热图",
            "limits": "pseudobulk 会损失细胞层级异质性；GSVA 分数是相对活性",
            "legend": "GSVA pathway activity heatmap.",
        },
        "dr_post_analysis": {
            "label": "DR 后续分析",
            "outputs": ["results/dr_enrichment.tsv", "results/dr_regulatory_network.tsv",
                        "results/dr_overlap.tsv", "results/dr_post_report.txt",
                        "figures/l2_15_dr_gsea_top.png", "figures/l2_16_dr_regulatory_network.png",
                        "figures/l2_17_dr_overlap.png"],
            "methods": "DR 基因富集 + SCENIC regulon ∩ DR 调控网络 + DR ∩ DEG ∩ marker 交集",
            "limits": "DR 与 DEG 的交集只说明「既变表达又在调控网络中」，不构成因果链",
            "legend": "Downstream analysis of DR genes: enrichment, regulatory network and overlap.",
        },
        "scrna_figures": {
            "label": "单细胞出图",
            # 物种/细胞类型段由数据决定，用 * 通配；逐个声明会在细胞类型变化时失配
            "outputs": ["figures/l2_01_umap_celltype.png", "figures/l2_02_umap_diagnosis.png",
                        "figures/l2_03_umap_donor.png", "figures/l2_04_umap_leiden.png",
                        "figures/l2_05_composition_stack.png", "figures/l2_06_composition_box_*.png",
                        "figures/l2_07_marker_top5.png", "figures/l2_08_deg_volcano_*.png",
                        "figures/l2_09_deg_sig_bar.png", "figures/l2_10_pca_diagnosis.png"],
            "methods": "统一 300 DPI 与配色规范，落盘前经版式收口",
            "limits": "图件为结果呈现，不改变统计结论",
            "legend": "Single-cell analysis overview figures.",
        },
    },
    # ---------- line3_spatial ----------
    "line3_spatial": {
        "ingest_spatial": {
            "label": "空间数据读入",
            "outputs": ["results/spatial_counts_*.h5ad", "results/samples_meta.tsv",
                        "results/ingest_report.txt"],
            "methods": "读取空间表达矩阵与 spot 物理坐标，建立 AnnData 对象",
            "limits": "不同平台分辨率差异大，spot 直径与细胞数不一致",
            "legend": "Spatial transcriptomics data ingestion.",
        },
        "qc_spots": {
            "label": "Spot 质控",
            "outputs": ["results/spatial_qc_*.h5ad", "results/spot_qc_metrics.tsv", "results/qc_report.txt"],
            "methods": "按检出基因数与线粒体百分比过滤低质量 spot",
            "limits": "组织边缘与坏死区 spot 常被过滤，可能丢失真实区域信息",
            "legend": "Spot-level quality control metrics.",
        },
        "normalize_hvg": {
            "label": "标准化与高变基因",
            "outputs": ["results/spatial_norm_*.h5ad", "results/hvg_genes_*.tsv", "results/norm_report.txt"],
            "methods": "normalize_total + log1p，按方差选择高变基因，原始计数保存在 layers['counts']；按物种分文件写出",
            "limits": "HVG 选择影响下游域划分分辨率；不同 HVG 数量会得到不同域粒度",
            "legend": "Normalization and highly variable gene selection (per species).",
        },
        "dim_reduce": {
            "label": "降维 (PCA/UMAP)",
            "outputs": ["results/spatial_dimred_*.h5ad", "results/dimred_report.txt"],
            "methods": "PCA 取主成分后 UMAP 降维",
            "limits": "UMAP 不保留空间坐标信息，需与物理坐标图对照解读",
            "legend": "Dimensionality reduction of spatial expression profiles.",
        },
        "spatial_domains": {
            "label": "空间域识别",
            # 域图（l3_<sp>_01_domains_<sample>.png）由 spatial_figures 逐样本产出
            "outputs": ["results/spatial_domains_*.h5ad", "results/domains_report.txt"],
            "methods": "结合转录谱与空间坐标做 Leiden 聚类识别结构域",
            "limits": "域身份是样本私有的，跨样本不能直接按编号对应",
            "legend": "Spatial domain identification combining expression and coordinates.",
        },
        "spatial_markers": {
            "label": "空间域 Marker",
            "outputs": ["results/domain_markers_*.tsv", "results/spatial_marker_*.h5ad",
                        "results/marker_report.txt"],
            "methods": "各域 wilcoxon 检验取 top200 marker",
            "limits": "marker 依赖域划分结果，域改变则 marker 改变",
            "legend": "Marker genes of spatial domains.",
        },
        "spatial_autocorr": {
            "label": "空间自相关 (Moran's I)",
            # Moran 图（l3_<sp>_04_morans_top.png）由 spatial_figures 产出
            "outputs": ["results/gene_autocorr_*.tsv", "results/spatial_autocorr_*.h5ad",
                        "results/autocorr_report.txt"],
            "methods": "Squidpy 计算全切片基因 Moran's I 空间聚集梯度",
            "limits": "Moran's I 对邻接图定义敏感；高值不代表功能重要",
            "legend": "Spatial autocorrelation (Moran's I) of gene expression.",
        },
        "spatial_cooccurrence": {
            "label": "空间邻域/共现",
            "outputs": ["results/domain_cooccurrence_*.tsv", "results/spatial_cooccurrence_*.h5ad",
                        "results/cooccurrence_report.txt"],
            "methods": "统计微米尺度域对的物理毗邻偏好（共定位 vs 排斥）",
            "limits": "共现是空间关联，不等于细胞间通讯或因果作用",
            "legend": "Spatial co-occurrence preferences between domains.",
        },
        "spatial_composition": {
            "label": "区域组成差异",
            "outputs": ["results/sample_composition_*.tsv", "results/spatial_composition_*.h5ad",
                        "results/composition_report.txt"],
            "methods": "比较不同切片/微区域的域组成，Kruskal-Wallis 检验",
            "limits": "组成差异可能来自切片位置而非生物学状态",
            "legend": "Domain composition across samples.",
        },
        "spatial_communication": {
            "label": "空间通讯分析",
            "outputs": ["results/sample_communication_*.tsv", "results/spatial_communication_*.h5ad",
                        "results/communication_report.txt"],
            "methods": "KNN 邻域内按 domain 对计算配受体强度",
            "limits": "邻域定义与配受体资源选择直接影响结论",
            "legend": "Spatially resolved ligand-receptor interaction scoring.",
        },
        "spatial_localization": {
            "label": "目标基因空间定位",
            # 定位图（l3_<sp>_02_target_gene_<sample>.png）由 spatial_figures 逐样本产出
            "outputs": ["results/gene_localization_*.tsv", "results/spatial_localization_*.h5ad",
                        "results/localization_report.txt"],
            "methods": "将客户关注基因投射回组织切片物理坐标",
            "limits": "定位基于表达量，不代表蛋白层面定位",
            "legend": "Spatial localization of the target gene on tissue sections.",
        },
        "spatial_knockout": {
            "label": "空间虚拟敲除",
            "outputs": ["results/ko_dr_genes_*.tsv", "results/spatial_knockout_*.h5ad",
                        "results/knockout_report.txt"],
            "methods": "在 WT/Control 空间矩阵上模拟敲除目标基因，spot 级按域聚合后比较网络拓扑",
            "limits": "DR Genes 反映调控网络扰动；空间聚合会平滑域内异质性",
            "legend": "Spatial virtual knockout perturbation analysis.",
        },
        "celltype_annotation": {
            "label": "反卷积/细胞类型注释",
            "outputs": ["results/celltype_scores_*.tsv", "results/celltype_annotation_*.tsv",
                        "results/spatial_deconv_*.h5ad", "results/deconv_report.txt",
                        "figures/l3_*_14_deconv_umap.png", "figures/l3_*_15_deconv_composition.png"],
            "methods": "域 marker top5 构建签名矩阵，scipy.optimize.nnls 逐 spot 解卷积，比例归一化",
            "limits": "无监督近似解卷积：签名来自本线域 marker，未使用外部单细胞参考；比例是估计值而非实测",
            "legend": "NNLS deconvolution of spot-level cell type composition.",
        },
        "dr_post_analysis": {
            "label": "DR 后续分析",
            # 本线不写 dr_regulatory_network.tsv（line2 才有调控网络表），只有富集与交集两张表
            "outputs": ["results/dr_enrichment_*.tsv", "results/dr_overlap_*.tsv",
                        "results/dr_post_report.txt", "figures/l3_*_10_dr_gsea_top.png",
                        "figures/l3_*_11_dr_overlap.png"],
            "methods": "DR 基因 GSEA 富集 + DR ∩ 域 marker 交集；本线不构建 regulon 调控网络表",
            "limits": "DR 与域 marker 的交集只说明「既在调控网络中被扰动又具域特异性」，不构成因果链",
            "legend": "Downstream analysis of spatial DR genes: enrichment and domain-marker overlap.",
        },
        "enrichment": {
            "label": "功能富集",
            "outputs": ["results/enrichment_ora_*.tsv", "results/enrichment_gsea_*.tsv",
                        "results/enrichment_report.txt"],
            "methods": "对域 marker 做 GO/KEGG 富集",
            "limits": "富集结论依赖域划分与背景基因集",
            "legend": "Functional enrichment of spatial domain markers.",
        },
        "enrichment_figures": {
            "label": "空间富集出图",
            "outputs": ["figures/l3_*_12_ora_top.png", "figures/l3_*_13_gsea_top.png"],
            "methods": "取各库 top 条目做横向条形，双标注条目名与显著性",
            "limits": "条形图只展示 top 条目，完整结果见 enrichment_ora_<species>.tsv",
            "legend": "Top enriched terms of spatial domain markers.",
        },
        "spatial_figures": {
            "label": "空间出图",
            # 逐样本图带 <species> 与 <sample> 两段动态命名，用 * 通配
            "outputs": ["figures/l3_*_01_domains_*.png", "figures/l3_*_02_target_gene_*.png",
                        "figures/l3_*_03_ko_dr_*.png", "figures/l3_*_04_morans_top.png",
                        "figures/l3_*_05_knockout_dr.png", "figures/l3_*_06_umap_sample.png",
                        "figures/l3_*_07_domain_composition.png",
                        "figures/l3_*_08_target_gene_by_domain.png",
                        "figures/l3_*_09_ko_dr_by_domain.png"],
            "methods": "逐样本出图，统一 300 DPI 与配色规范",
            "limits": "跨样本坐标不可比，图件按样本分列",
            "legend": "Spatial transcriptomics overview figures.",
        },
    },
}


def step_meta(step, line=None):
    """按 (line, step) 取步骤条目；line 未知时按线序回退到唯一命中。

    三线同名步骤（`enrichment`、`dr_post_analysis`、`enrichment_figures`、
    `normalize_hvg`）必须带 line 才能取到正确的那一条——这正是本目录分两层的原因。
    取不到返回空 dict，调用方按"该步骤未登记"处理，不猜。
    """
    if line:
        meta = STEP_CATALOG.get(line, {}).get(step)
        if meta is not None:
            return meta
    for candidate in LINES:
        meta = STEP_CATALOG.get(candidate, {}).get(step)
        if meta is not None:
            return meta
    return {}


# 五维自检项（与工作台 /api/selfcheck 同口径）
SELFCHECK_LABELS = [
    ("path", "路径与 FUSE 红线"),
    ("compute", "算力削峰与绑核"),
    ("memory", "内存熔断与检查点"),
    ("bridge", "桥接四断言"),
    ("isolation", "三线隔离与跨线门禁"),
]


# ============================================================
# 基础 IO
# ============================================================

def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def read_text(path, limit=None):
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            return fh.read(limit) if limit else fh.read()
    except OSError:
        return ""


def read_tsv_rows(path, limit=200000):
    """读 TSV 为 (表头, 行列表)。读不到返回 (None, [])。"""
    if not os.path.isfile(path):
        return None, []
    header = None
    rows = []
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for i, line in enumerate(fh):
                if i >= limit:
                    break
                line = line.rstrip("\n").rstrip("\r")
                if not line:
                    continue
                cells = line.split("\t")
                if header is None:
                    header = cells
                else:
                    rows.append(cells)
    except OSError:
        return None, []
    return header, rows


def col_index(header, *names):
    """按候选名找列下标（大小写不敏感）。找不到返回 None。"""
    if not header:
        return None
    lowered = [str(h).strip().lower() for h in header]
    for name in names:
        if name.lower() in lowered:
            return lowered.index(name.lower())
    return None


def desensitize(text, project_root=None):
    """把服务器绝对路径替换成占位符。交付包不暴露真实路径。"""
    if not text:
        return text
    out = str(text)
    if project_root:
        out = out.replace(os.path.abspath(project_root), "{{PROJECT_ROOT}}")
    out = out.replace(DATA_ROOT, PATH_PLACEHOLDER)
    return out


def human_bytes(n):
    try:
        n = float(n)
    except (TypeError, ValueError):
        return "—"
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return ("%d %s" % (n, unit)) if unit == "B" else ("%.1f %s" % (n, unit))
        n /= 1024.0
    return "—"


# ============================================================
# 软件版本清单与文献索引（S11）
# ============================================================
# 为什么放在外部 JSON 而不是写死在脚本里：版本号是**环境的属性**，不是代码的属性。
# 换容器只要重跑探针（cn_debug/2026-10-19_s11_collect_versions.py）再部署清单，
# 报告就跟着变；写死在脚本里必然演变成"文档抄代码、代码抄记忆"的三重漂移。
SOFTWARE_VERSIONS_ENV = "BIO_SOFTWARE_VERSIONS"
REFERENCE_CITATIONS_ENV = "BIO_REFERENCE_CITATIONS"


def load_manifest(env_key, candidates, label):
    """按「环境变量 → 给定候选路径」顺序找清单文件。

    返回 {"data": dict|None, "path": str|None, "tried": [str], "error": str|None}。
    找不到**不算异常**：报告要照常生成，只是把"清单缺失"明写进正文——
    静默跳过会让客户拿到一份看着完整、其实没登记版本的报告。
    """
    tried = []
    env_path = os.environ.get(env_key)
    if env_path:
        # 显式指定就只认这一条：设了环境变量却没生效这种误配，
        # 若再回落到默认路径，会静默掩盖"我明明指了清单却没用上"。
        path = os.path.abspath(env_path)
        if not os.path.isfile(path):
            return {"data": None, "path": path, "tried": [path],
                    "error": "环境变量 %s 指向的 %s 不存在" % (env_key, path)}
        data = read_json(path, default=None)
        if isinstance(data, dict):
            return {"data": data, "path": path, "tried": [path], "error": None}
        return {"data": None, "path": path, "tried": [path],
                "error": "环境变量 %s 指向的 %s 不是合法 JSON 对象" % (env_key, path)}
    tried.extend(os.path.abspath(p) for p in candidates)
    for path in tried:
        if not os.path.isfile(path):
            continue
        data = read_json(path, default=None)
        if isinstance(data, dict):
            return {"data": data, "path": path, "tried": tried, "error": None}
        return {"data": None, "path": path, "tried": tried,
                "error": "%s 存在但不是合法 JSON 对象" % path}
    return {"data": None, "path": None, "tried": tried,
            "error": "%s 未找到（已尝试 %d 个路径）" % (label, len(tried))}


def load_software_versions():
    """软件版本清单。服务器上由 ops/ 部署副本提供，仓库内读 docs/。"""
    here = os.path.dirname(os.path.abspath(__file__))
    return load_manifest(SOFTWARE_VERSIONS_ENV, [
        os.path.join(here, "software_versions.json"),
        os.path.join(here, "..", "docs", "software_versions.json"),
        os.path.join(DATA_ROOT, "software_versions.json"),
    ], "软件版本清单 software_versions.json")


def load_reference_citations():
    """方法学文献索引（citations.json）。服务器上由 ops/ 部署副本提供。"""
    here = os.path.dirname(os.path.abspath(__file__))
    return load_manifest(REFERENCE_CITATIONS_ENV, [
        os.path.join(here, "reference_citations.json"),
        os.path.join(here, "..", "reference", "生信分析可用参考文献", "citations.json"),
        os.path.join(DATA_ROOT, "reference_citations.json"),
    ], "文献索引 citations.json")


def active_lines(ctx):
    """本项目**真正跑过**的分析线。

    不能只看目录存不存在：建项时就会给三条线各建一套 figures/results/processed/raw_data 骨架，
    PRJ_E2E_GSE277173 的 line2/line3 目录就是这样——0 个文件。把这两线的包写进版本表与引用，
    等于告诉客户"你的数据跑了单细胞和空间分析"。

    也不用 pipeline_dag 反查：`enrichment_figures`、`enrichment`、`dr_post_analysis` 等步骤名
    在三条线的 STEP_CATALOG 里**重名**（S6-scout 已记录），拿 stepId 去查会把三条线全部命中。
    真正带线归属的证据是任务台账的 `line_id`，其次才是该线目录下有没有产物。
    """
    ledger_lines = {str(rec.get("line_id") or "") for rec in ctx["ledgers"]}
    active = []
    for line, entry in ctx["lines"].items():
        has_artifact = bool(entry.get("figures") or entry.get("results")
                            or entry.get("processed") or entry.get("scripts"))
        if line in ledger_lines or has_artifact:
            active.append(line)
    return active


def version_rows(active, manifest):
    """软件与版本表：只列本项目跑过的线用到的解释器与包。

    返回 (rows, 清单里登记但本线未用到的包名列表)。
    """
    rows, unused = [], []
    active_set = set(active)
    for rec in manifest.get("interpreters") or []:
        if active_set & set(rec.get("lines") or []):
            rows.append([rec.get("language") or "—", rec.get("name") or "—",
                         rec.get("version") or "未获取", rec.get("role") or "—"])
    for rec in manifest.get("packages") or []:
        lines = set(rec.get("lines") or [])
        if not lines:
            unused.append(rec.get("name") or "—")
            continue
        if not (active_set & lines):
            continue
        if rec.get("installed") is False:
            ver = "未安装"
        else:
            ver = rec.get("version") or "未获取"
        rows.append([rec.get("language") or "—", rec.get("name") or "—", ver, rec.get("role") or "—"])
    return rows, unused


def citation_rows(active, manifest, citations):
    """方法学引用列表：只输出"该包确实在本项目跑过的线里"且"本地确有对应 PDF"的文献。

    返回 (rows, missing, uncited)：
      rows    可引文献行
      missing 包在用、但目录里没有该包原始论文（明写未获取，不拿同类方法顶替）
      uncited 包在用、但清单里没有为它登记文献（如 ggplot2/data.table 这类无单篇论文的包）
    """
    entries = {e.get("key"): e for e in (citations.get("entries") or []) if isinstance(e, dict)}
    active_set = set(active)
    hits = {}      # citation key -> {"packages": [...], "lines": set()}
    missing = []
    uncited = []

    for rec in manifest.get("packages") or []:
        lines = set(rec.get("lines") or [])
        used = active_set & lines
        if not used:
            continue
        key = rec.get("citation")
        name = rec.get("name") or "—"
        if not key:
            uncited.append(name)
            continue
        entry = entries.get(key)
        if not entry or not entry.get("pdf"):
            missing.append((name, entry.get("evidence") if entry else "citations.json 未登记该条目"))
            continue
        slot = hits.setdefault(key, {"packages": [], "lines": set()})
        if name not in slot["packages"]:
            slot["packages"].append(name)
        slot["lines"] |= used

    # 平台级引用（如 Bioconductor）：不对应单个包，但确实是本线 R 侧包的来源
    for rec in manifest.get("platform_citations") or []:
        used = active_set & set(rec.get("lines") or [])
        entry = entries.get(rec.get("key"))
        if not used or not entry or not entry.get("pdf"):
            continue
        slot = hits.setdefault(rec.get("key"), {"packages": [], "lines": set()})
        slot["packages"].append("（平台）%s" % (entry.get("package") or rec.get("key")))
        slot["lines"] |= used

    rows = []
    for key, slot in hits.items():
        entry = entries[key]
        venue = entry.get("venue") or "未获取"
        year = entry.get("year")
        where = "%s · %s" % (venue, year) if year else venue
        rows.append([
            "、".join(slot["packages"]),
            "、".join(sorted(slot["lines"])),
            entry.get("title") or "未获取",
            entry.get("authors") or "未获取",
            where,
            entry.get("doi") if entry.get("doi") and entry.get("doi") != "未获取" else "未获取",
        ])
    return rows, missing, uncited


# ============================================================
# 项目扫描
# ============================================================

def scan_project(project_dir):
    """收集项目产物。只读，不创建任何目录。"""
    project = read_json(os.path.join(project_dir, "project.json"), default={}) or {}
    project_id = project.get("project_id") or os.path.basename(os.path.normpath(project_dir))

    lines = {}
    for line in LINES:
        legacy_base = os.path.join(project_dir, line)
        data_base = os.path.join(project_dir, "data", line)
        figure_base = os.path.join(project_dir, "figures", line)
        adapt_base = os.path.join(project_dir, "figures", "adapt")
        if not os.path.isdir(legacy_base) and not os.path.isdir(data_base) and not os.path.isdir(figure_base):
            continue
        entry = {"dir": project_dir, "figures": [], "results": [], "processed": [],
                 "scripts": [], "adapted": [], "tables": []}
        if os.path.isdir(legacy_base):
            entry["dir"] = legacy_base
            entry["search_dir"] = legacy_base
            for sub, key in (("figures", "figures"), ("results", "results"),
                             ("processed", "processed"), ("scripts", "scripts"),
                             ("figures/adapt", "adapted")):
                d = os.path.join(legacy_base, sub)
                if os.path.isdir(d):
                    entry[key] = sorted(
                        sub + "/" + n for n in os.listdir(d)
                        if os.path.isfile(os.path.join(d, n))
                        and (key != "adapted" or n.lower().endswith((".r", ".py")))
                    )
        else:
            entry["search_dir"] = data_base
            for sub, key in (("processed", "processed"), ("results", "results")):
                d = os.path.join(data_base, sub)
                if os.path.isdir(d):
                    entry[key] = sorted(
                        "data/%s/%s/%s" % (line, sub, n)
                        for n in os.listdir(d)
                        if os.path.isfile(os.path.join(d, n))
                    )
            for d, key, prefix in (
                (figure_base, "figures", "figures/%s" % line),
                (adapt_base, "adapted", "figures/adapt"),
            ):
                if os.path.isdir(d):
                    entry[key] = sorted(
                        prefix + "/" + n for n in os.listdir(d)
                        if os.path.isfile(os.path.join(d, n))
                        and (key != "adapted" or n.lower().endswith((".r", ".py")))
                    )
        # 交付用结果表：results/ 是规范位置，但母版脚本实际把统计表写在 processed/。
        # 只收表格类扩展名，不把 .h5ad/.rds/.pkl 检查点或 .pdf 图件混进 tables。
        entry["tables"] = sorted(set(
            entry["results"] + [
                rel for rel in entry["processed"]
                if rel.lower().endswith((".tsv", ".csv", ".txt"))
            ]
        ))
        lines[line] = entry

    logs_dir = os.path.join(os.environ.get("BIO_SYSTEM_LOGS", os.path.join(DATA_ROOT, "system_logs")))
    ledgers = []
    if os.path.isdir(logs_dir):
        for name in sorted(os.listdir(logs_dir)):
            if not name.endswith(".json"):
                continue
            rec = read_json(os.path.join(logs_dir, name), default=None)
            if not isinstance(rec, dict):
                continue
            if str(rec.get("project_id") or "default") != str(project_id):
                continue
            ledgers.append(rec)

    return {
        "project": project,
        "project_id": project_id,
        "project_dir": os.path.abspath(project_dir),
        "lines": lines,
        "ledgers": ledgers,
    }


def ledger_by_step(ledgers):
    """同一步骤可能跑过多次：保留 end_time 最新的一条。"""
    best = {}
    for rec in ledgers:
        step = str(rec.get("step_name") or "")
        if not step:
            continue
        prev = best.get(step)
        if prev is None or str(rec.get("end_time") or "") >= str(prev.get("end_time") or ""):
            best[step] = rec
    return best


def artifact_dir(entry):
    """分析结果所在目录：规范位置是 results/，母版脚本实际写 processed/。

    优先 results/（非空时），否则回落 processed/。两者都不存在返回 results/
    的路径，让下游 summarize_* 自然读不到并如实返回 None（不编数字）。
    """
    base = entry.get("search_dir") or entry["dir"]
    results = os.path.join(base, "results")
    if entry.get("results"):
        return results
    processed = os.path.join(base, "processed")
    if entry.get("processed"):
        return processed
    return results


def _match_artifact(rel, items):
    """rel 是否命中产物清单。

    声明里带 `*` 时按通配比对：物种段（l3_mouse_/l3_human_）、样本段
    （JBO014）、细胞类型后缀（T_cell）都由数据决定，逐个写死会在数据变化时失配。
    """
    if "*" not in rel:
        return rel in items
    return any(fnmatch.fnmatchcase(item, rel) for item in items)


def count_artifacts(rel, entry):
    """通配声明命中的实际文件数。

    报告里必须标张数：把 `figures/l2_08_deg_volcano_*.png` 当文件名念出去，
    客户会以为有一个叫这个名字的文件。
    """
    n = sum(1 for key in ("results", "figures", "processed")
            for item in entry.get(key, []) if fnmatch.fnmatchcase(item, rel))
    if n == 0 and rel.startswith("results/"):
        alt = "processed/" + rel.split("/", 1)[1]
        n = sum(1 for item in entry.get("processed", []) if fnmatch.fnmatchcase(item, alt))
    return n


def resolve_artifact(rel, entry):
    """产物在磁盘上的实际相对路径，找不到返回 None。

    STEP_CATALOG 声明位置是 `results/xxx.tsv`，母版脚本实际写
    `processed/xxx.tsv`。只比对原字符串会一律判"未找到"，报告写出与磁盘
    相反的结论；显示时也改用实际路径，避免与第六章索引自相矛盾。
    """
    for key in ("results", "figures", "processed"):
        if _match_artifact(rel, entry.get(key, [])):
            return rel
    if rel.startswith("results/"):
        alt = "processed/" + rel.split("/", 1)[1]
        if _match_artifact(alt, entry.get("processed", [])):
            return alt
    return None


# ============================================================
# 结果摘要（全部来自真实文件，读不到就返回 None）
# ============================================================

def summarize_deg(results_dir, cutoffs=None):
    """DEG 摘要：显著基因数 + 变化幅度最大的基因。

    deg_sig.tsv 为空是**真实结果**（8v8 小样本常见，阈值不随结果调整），
    此时不能输出"log2FC 绝对值最大的为 。"这种空白句子，也不能把全表 top
    冒充显著基因。所以：sig 为空时回退 deg_all 取 top，并用 significant=False
    让调用方明确写成"未检出达到阈值的差异基因"。

    deg_sig.tsv 不存在时（母版只写 deg_all），按项目 analysis_cutoffs 从全表
    筛显著基因，而不是把全表行数当显著数。
    """
    cutoffs = cutoffs or {}
    try:
        lfc_cut = float(cutoffs.get("log2fc_threshold"))
    except (TypeError, ValueError):
        lfc_cut = 1.0
    try:
        padj_cut = float(cutoffs.get("padj_threshold"))
    except (TypeError, ValueError):
        padj_cut = 0.05

    sig_path = os.path.join(results_dir, "deg_sig.tsv")
    all_path = os.path.join(results_dir, "deg_all.tsv")
    sig_header, sig_rows = read_tsv_rows(sig_path)
    all_header, all_rows = read_tsv_rows(all_path)
    header, rows = (sig_header, sig_rows) if sig_header is not None else (all_header, all_rows)
    if header is None:
        return None
    gene_col = col_index(header, "gene", "symbol", "gene_symbol", "x")
    if gene_col is None:
        gene_col = 0
    lfc_col = col_index(header, "logfc", "log2fc", "log2_fc")
    padj_col = col_index(header, "adj.p.val", "padj", "fdr", "p.adj")

    def fnum(row, idx):
        if idx is None or idx >= len(row):
            return None
        try:
            return float(row[idx])
        except (TypeError, ValueError):
            return None

    def parse(h, rs):
        if h is None:
            return []
        gcol = col_index(h, "gene", "symbol", "gene_symbol", "x")
        if gcol is None:
            gcol = 0
        lcol = col_index(h, "logfc", "log2fc", "log2_fc")
        acol = col_index(h, "adj.p.val", "padj", "fdr", "p.adj")
        pcol = col_index(h, "p.value", "pval", "p")
        out = []
        for row in rs:
            gene = row[gcol] if gcol < len(row) else ""
            if not gene:
                continue
            out.append({
                "gene": gene,
                "log2fc": fnum(row, lcol),
                "padj": fnum(row, acol),
                "p": fnum(row, pcol),
            })
        return out

    all_scored = parse(all_header, all_rows)
    if sig_header is not None:
        sig_scored = parse(sig_header, sig_rows)
    else:
        sig_scored = [
            g for g in all_scored
            if g["log2fc"] is not None and abs(g["log2fc"]) >= lfc_cut
            and g["padj"] is not None and g["padj"] < padj_cut
        ]
    significant = len(sig_scored) > 0
    # 显著时 top 取显著表；不显著时取全表（仅用于说明"变化幅度最大"，不称其为显著）
    top_scored = sig_scored if significant else (all_scored or parse(header, rows))
    top_scored.sort(key=lambda g: abs(g["log2fc"] or 0), reverse=True)
    up = [g for g in sig_scored if g["log2fc"] is not None and g["log2fc"] > 0]
    down = [g for g in sig_scored if g["log2fc"] is not None and g["log2fc"] < 0]
    return {
        "total": len(sig_scored),
        "up": len(up),
        "down": len(down),
        "top": top_scored[:10],
        "significant": significant,
        "all_total": len(all_scored),
        "has_padj": padj_col is not None,
    }


def summarize_dr(results_dir):
    """从 ko_dr_genes.tsv / dr_genes_summary.tsv 读 DR 基因。"""
    for name in ("dr_genes_summary.tsv", "ko_dr_genes.tsv"):
        path = os.path.join(results_dir, name)
        header, rows = read_tsv_rows(path)
        if header is None:
            continue
        gene_col = col_index(header, "gene", "symbol", "gene_symbol", "x") or 0
        score_col = col_index(header, "distance", "score", "stat", "p.value", "pval")
        genes = []
        for row in rows:
            gene = row[gene_col] if gene_col < len(row) else ""
            if not gene:
                continue
            score = None
            if score_col is not None and score_col < len(row):
                try:
                    score = float(row[score_col])
                except (TypeError, ValueError):
                    score = None
            genes.append({"gene": gene, "score": score})
        return {"file": name, "total": len(genes), "top": genes[:10]}
    return None


def summarize_auc(results_dir):
    """从 ml_report.txt / external_validation 报告里抓 AUC 数值（只抓真实写出的）。"""
    for name in ("ml_report.txt", "external_validation_report.txt"):
        text = read_text(os.path.join(results_dir, name))
        if not text:
            continue
        hits = re.findall(r"AUC[^0-9]{0,12}([01]\.\d+)", text, re.IGNORECASE)
        if hits:
            return {"file": name, "aucs": hits[:6]}
    return None


def summarize_focus_genes(project, lines):
    """关注基因全流程表现：在哪些结果表里出现过。"""
    genes = (project.get("biological_priors") or {}).get("focus_genes") or []
    if not genes:
        return []
    out = []
    for gene in genes:
        hits = []
        for line, entry in lines.items():
            for rel in entry.get("tables", entry["results"]):
                path = os.path.join(entry["dir"], rel)
                if not rel.lower().endswith((".tsv", ".csv", ".txt")):
                    continue
                text = read_text(path, limit=2 * 1024 * 1024)
                if not text:
                    continue
                # 按整词匹配，避免 IL17A 命中 IL17RA 之类的假阳性
                if re.search(r"(?<![A-Za-z0-9])%s(?![A-Za-z0-9])" % re.escape(gene), text):
                    hits.append("%s/%s" % (line, os.path.basename(rel)))
        out.append({"gene": gene, "hits": hits})
    return out


# ============================================================
# 章节构造
# ============================================================

def chapter1(ctx):
    """第一章：执行摘要与核心科学发现。"""
    project = ctx["project"]
    basic = project.get("basic_info") or {}
    src = project.get("data_source") or {}
    design = project.get("experimental_design") or {}
    grouping = project.get("grouping_design") or {}
    groups = grouping.get("groups") or []

    blocks = []
    blocks.append(("kv", [
        ("项目名称", basic.get("name") or ctx["project_id"]),
        ("疾病", basic.get("disease") or "—"),
        ("物种", basic.get("species") or "—"),
        ("研究领域", basic.get("domain") or "—"),
        ("数据来源模式", src.get("data_source_mode") or "PUBLIC_DB"),
        ("分组设计", "%d 组 · %s" % (len(groups), "配对 / 同供体" if design.get("is_paired") else "非配对")),
    ]))

    cohort = []
    for g in groups:
        cohort.append("%s（%s，%d 例）" % (
            g.get("group_name") or "未命名",
            "基准对照" if g.get("role") == "reference" else "疾病/实验组",
            len(g.get("sample_ids") or g.get("sampleIds") or []),
        ))
    blocks.append(("p", "**队列与分期设计**：" + ("；".join(cohort) if cohort else "项目未填写分组信息")))

    findings = []
    cutoffs = (ctx.get("project") or {}).get("analysis_cutoffs") or {}
    for line, entry in ctx["lines"].items():
        results = artifact_dir(entry)
        deg = summarize_deg(results, cutoffs)
        if deg and deg.get("significant"):
            top_names = "、".join(g["gene"] for g in deg["top"][:5])
            findings.append(
                "%s 共检出 **%d** 个差异表达基因（上调 %d / 下调 %d），log2FC 绝对值最大的包括 %s。"
                % (LINE_LABEL.get(line, line), deg["total"], deg["up"], deg["down"], top_names)
            )
        elif deg and deg.get("top"):
            top_names = "、".join(
                "%s（log2FC=%.2f）" % (g["gene"], g["log2fc"]) for g in deg["top"][:3]
                if g.get("log2fc") is not None
            )
            findings.append(
                "%s 未检出达到阈值的差异表达基因（全表 %d 个基因）；"
                "变化幅度最大的为 %s。这是真实结果，阈值未随结果放宽。"
                % (LINE_LABEL.get(line, line), deg.get("all_total", 0), top_names or "—")
            )
        dr = summarize_dr(results)
        if dr and dr["total"]:
            names = "、".join(g["gene"] for g in dr["top"][:5])
            findings.append(
                "%s 虚拟敲除输出 **%d** 个 DR Genes（调控网络拓扑扰动），排名前列：%s。"
                % (LINE_LABEL.get(line, line), dr["total"], names)
            )
        auc = summarize_auc(results)
        if auc:
            findings.append(
                "%s 机器学习评估记录到 AUC = %s（来源 `%s`）。"
                % (LINE_LABEL.get(line, line), "、".join(auc["aucs"]), auc["file"])
            )
    if not findings:
        findings.append(
            "当前项目目录下未找到可解析的差异分析 / DR 基因 / 模型评估结果文件，"
            "本章不给出任何数值结论。请确认分析步骤已跑完并落盘到 `<line>/results/`。"
        )
    blocks.append(("ul", findings))

    focus = summarize_focus_genes(project, ctx["lines"])
    if focus:
        rows = [[f["gene"], str(len(f["hits"])), "、".join(f["hits"][:4]) or "未在结果表中出现"]
                for f in focus]
        blocks.append(("p", "**客户重点关注基因的全流程表现**（按结果表中是否出现统计，不代表显著性）："))
        blocks.append(("table", (["关注基因", "命中文件数", "出现位置（前 4 项）"], rows)))
    return "第一章：执行摘要与核心科学发现 (Executive Summary)", blocks


def chapter2(ctx):
    """第二章：材料与方法学标准段落。"""
    project = ctx["project"]
    cut = project.get("analysis_cutoffs") or {}
    layout = project.get("plot_layout_config") or {}
    priors = project.get("biological_priors") or {}
    design = project.get("experimental_design") or {}
    ledgers = ledger_by_step(ctx["ledgers"])

    versions = {}
    seeds = set()
    for rec in ledgers.values():
        env = rec.get("environment") or {}
        lang = env.get("language")
        ver = env.get("version")
        if lang and ver:
            versions[lang] = ver
        if env.get("random_seed") is not None:
            seeds.add(str(env.get("random_seed")))

    seed_text = "、".join(sorted(seeds)) if seeds else "台账未记录（见第七章）"
    # 英文段落不能混进中文注释，单独准备一份
    seed_en = ("fixed random seed %s" % "、".join(sorted(seeds))) if len(seeds) == 1 else (
        "fixed random seeds per step, as recorded in the reproducibility ledger" if seeds else
        "a fixed random seed (to be filled from the ledger)")
    if len(seeds) > 1:
        # 多个种子说明各步骤用了不同值，笼统写一个数字会让复现者按错的种子重跑
        seed_text += "（各步骤取值不同，逐条见第七章）"
    blocks = []
    # 阈值缺失时不套用"标准档默认值"：默认值是我们文档里的约定，
    # 不是这个项目实际跑过的参数。写进方法学段落就是编造。
    lfc = cut.get("log2fc_threshold")
    padj = cut.get("padj_threshold")
    blocks.append(("kv", [
        ("统计阈值档", cut.get("profile") or "项目未记录（project.json 无 analysis_cutoffs）"),
        ("log2FC 阈值", str(lfc) if lfc is not None else "项目未记录"),
        ("校正 p 值阈值", str(padj) if padj is not None else "项目未记录"),
        ("名义 p 值阈值", str(cut.get("p_threshold")) if cut.get("p_threshold") is not None else "项目未记录"),
        ("线粒体百分比上限", ("%s%%" % cut["max_mt_percent"]) if cut.get("max_mt_percent") is not None else "项目未记录"),
        ("随机种子", seed_text),
        ("出图模板", layout.get("template_id") or "template_1_nature_side"),
        ("出图分辨率", "%s DPI" % layout.get("dpi", 300)),
        ("统计模型", "配对 / 同供体线性模型" if design.get("is_paired") else "独立样本线性模型"),
    ]))

    blocks.append(("p", "**软件环境**：" + (
        "；".join("%s %s" % (k, v) for k, v in sorted(versions.items()))
        if versions else "任务台账未记录软件版本，请从第七章台账补录后再引用本段"
    )))

    # ---------- S11：软件与版本登记 / 随机种子 / 方法学引用 ----------
    # 只做"新增段落"：既有 kv 表、English Methods 段落、配对/协变量说明一律不动。
    ver_manifest = load_software_versions()
    cite_manifest = load_reference_citations()
    active = active_lines(ctx)
    active_text = "、".join(active) if active else "未识别到已跑线"

    blocks.append(("h3", "软件与版本登记（算力容器实测）"))
    if ver_manifest["data"]:
        rows, unused = version_rows(active, ver_manifest["data"])
        if rows:
            blocks.append(("table", (["语言", "包 / 解释器", "版本", "用途"], rows)))
            blocks.append(("p", "版本号由 `cn_debug/2026-10-19_s11_collect_versions.py` 在算力容器内实采"
                                "（只读 `packageVersion()` / `import`，未安装、未升级任何包）；"
                                "清单文件：`%s`。表内只列本项目实际跑过的线（%s）用到的软件。"
                           % (desensitize(ver_manifest["path"], ctx["project_dir"]), active_text)))
        else:
            blocks.append(("p", "⚠ 版本清单已读取（`%s`），但没有任何包登记到本项目跑过的线（%s），"
                                "版本表为空。请核对清单的 `lines` 字段。"
                           % (desensitize(ver_manifest["path"], ctx["project_dir"]), active_text)))
        if unused:
            blocks.append(("p", "清单中以下包已安装但**未进入本项目流程**（步骤脚本未 import / library），"
                                "不计入本表、也不作为引用：%s。" % "、".join(unused)))
    else:
        blocks.append(("p", "⚠ **版本清单缺失，方法学引用不完整**：%s。"
                            "当前只能依赖第七章任务台账的 `environment` 字段给出语言与版本，"
                            "无法给出逐包版本表与方法学引用。把 `docs/software_versions.json` 部署到服务器 "
                            "`ops/` 后重新生成本报告。"
                       % desensitize(ver_manifest["error"], ctx["project_dir"])))

    blocks.append(("h3", "随机种子"))
    contract_seed = None
    if ver_manifest["data"]:
        contract_seed = (ver_manifest["data"].get("seed") or {}).get("value")
    ledger_seed_text = "、".join(sorted(seeds)) if seeds else ""
    if contract_seed is None:
        seed_consistency = "无法判断（版本清单缺失，无契约种子可比对）"
    elif not ledger_seed_text:
        seed_consistency = "无法判断（台账未记录 random_seed）"
    elif ledger_seed_text == str(contract_seed):
        seed_consistency = "一致"
    else:
        seed_consistency = ("不一致：台账为 %s，契约种子为 %s；**以台账为准**，逐条见第七章"
                            % (ledger_seed_text, contract_seed))
    blocks.append(("kv", [
        ("契约种子（aims 铁律#3）", str(contract_seed) if contract_seed is not None else "清单未记录"),
        ("台账实际记录", ledger_seed_text or "台账未记录"),
        ("一致性", seed_consistency),
        ("注入方式", "任务引擎以环境变量 `BIOANALYS_SEED` 注入每条任务（`BioanalysDesktop/server/task.js`）"),
    ]))

    blocks.append(("h3", "方法学引用（原始论文）"))
    if ver_manifest["data"] and cite_manifest["data"]:
        cite_rows, cite_missing, cite_uncited = citation_rows(
            active, ver_manifest["data"], cite_manifest["data"])
        if cite_rows:
            blocks.append(("table", (["包 / 方法", "用于分析线", "文献", "作者", "出处 · 年份", "DOI"],
                                     cite_rows)))
            blocks.append(("p", "引用取自文献索引 `%s`（人读视图 `reference/生信分析可用参考文献/INDEX.md`）。"
                                "只列本项目实际跑过的线用到的软件；未使用的文献不列入，"
                                "避免「文献很多」被读成「已引用」。"
                           % desensitize(cite_manifest["path"], ctx["project_dir"])))
        else:
            blocks.append(("p", "⚠ 本项目实际用到的软件在文献索引中没有可引条目，本节不输出引用。"))
        if cite_missing:
            blocks.append(("p", "**以下软件在用、但本目录无其原始论文，故未引用**（不拿同类方法的论文顶替）："
                           + "；".join("%s（%s）" % (name, str(why).rstrip("。")) for name, why in cite_missing)
                           + "。"))
        if cite_uncited:
            head = "、".join(cite_uncited[:10])
            tail = "" if len(cite_uncited) <= 10 else " 等 %d 个" % len(cite_uncited)
            blocks.append(("p", "以下包在用但无单篇方法学论文可引（基础库 / 绘图库 / 注释库），未列入引用：%s%s。"
                           % (head, tail)))
    elif not ver_manifest["data"]:
        blocks.append(("p", "⚠ 版本清单缺失，无法判定本项目实际用到哪些软件，方法学引用不输出（不做推测）。"))
    else:
        blocks.append(("p", "⚠ **文献索引缺失，方法学引用不完整**：%s。"
                            "版本表照常输出，但不给出引用条目；补部署 `reference_citations.json` 到服务器 "
                            "`ops/` 后重新生成。"
                       % desensitize(cite_manifest["error"], ctx["project_dir"])))

    blocks.append(("h3", "English Methods Paragraph（可直接粘贴进论文）"))
    if lfc is None or padj is None:
        methods_en = (
            "Differential expression analysis was performed with limma using an empirical Bayes "
            "moderated t-statistic. Genes were considered differentially expressed at "
            "|log2 fold change| > [请填写实际阈值] and adjusted P < [请填写实际阈值]. "
            "Co-expression network construction, functional enrichment (GO/KEGG), and machine "
            "learning classification were carried out as described in the corresponding sections. "
            "All analyses used %s to ensure reproducibility." % seed_en
        )
        blocks.append(("p", "⚠ 本项目 `project.json` 未记录统计阈值，下方段落中的阈值留为占位符，"
                            "**请核对实际运行参数后填入**，不要直接投稿。"))
    else:
        methods_en = (
            "Differential expression analysis was performed with limma using an empirical Bayes "
            "moderated t-statistic. Genes were considered differentially expressed at "
            "|log2 fold change| > %s and adjusted P < %s. "
            "Co-expression network construction, functional enrichment (GO/KEGG), and machine "
            "learning classification were carried out as described in the corresponding sections. "
            "All analyses used %s to ensure reproducibility."
            % (lfc, padj, seed_en)
        )
    blocks.append(("code", methods_en))

    if design.get("is_paired"):
        blocks.append(("p", "**配对设计说明**：项目声明为自身配对 / 同供体设计，"
                            "下游统计模型已改用配对结构（`pair_map` 共 %d 条映射）。"
                            % len(design.get("pair_map") or {})))
    cov = (project.get("experimental_design") or {}).get("cov") or {}
    if cov.get("batch_col") or cov.get("adjusted_variables"):
        blocks.append(("p", "**协变量校正**：批次列 `%s`，校正变量 %s。" % (
            cov.get("batch_col") or "—",
            "、".join(cov.get("adjusted_variables") or []) or "无",
        )))
    if priors.get("target_ko_gene"):
        blocks.append(("p", "**虚拟敲除参数**：目标基因 `%s`，兜底策略 `%s`。" % (
            priors["target_ko_gene"], priors.get("ko_fallback_policy") or "strict_abort")))
    return "第二章：材料与方法学标准段落 (Materials & Methods)", blocks


def find_step_results_dir(ctx, step, line=None):
    """定位某步骤的 results 目录。

    line 已知时只查该线（三线隔离：不能拿 line3 的同名产物冒充 line2）；
    未知时逐线用**该线自己的**产物声明反查。两者都没有才返回 None——
    宁可说没找到，也不要随便挑一条线的结果冒充。
    """
    if line in ctx["lines"]:
        candidates = [line]
    else:
        candidates = [ln for ln in ctx["lines"] if ln in STEP_CATALOG]
    for ln in candidates:
        # 严格按 (line, step) 取：此处不做跨线回退，回退会把别的线的产物当成本线的
        meta = STEP_CATALOG.get(ln, {}).get(step) or {}
        outputs = [o.split("/", 1)[1] for o in meta.get("outputs", []) if o.startswith("results/")]
        if not outputs:
            continue
        entry = ctx["lines"][ln]
        # 母版脚本把结果表写在 processed/，两处都要认，否则章节会误报"未找到汇总表"
        for o in outputs:
            if (_match_artifact("results/" + o, entry.get("results", []))
                    or _match_artifact("processed/" + o, entry.get("processed", []))):
                return artifact_dir(entry), ln
    return None, None


def chapter3(ctx):
    """第三章：分步分析结果与三段式深度解读。"""
    project = ctx["project"]
    dag = project.get("pipeline_dag") or []
    if not dag:
        # 没有 DAG 就不知道跑了哪些步骤。按图件前缀反推容易把"画了图"当成"跑过步骤"，
        # 所以只列现有产物清单，把步骤归属留给人工确认。
        blocks = [("p", "本项目 `project.json` 未记录 `pipeline_dag`，无法按步骤展开三段式解读。"
                        "以下列出已落盘的图件，供人工对照步骤顺序；"
                        "**补齐 `pipeline_dag` 后重新生成，本章才会输出完整的四段式解读**。")]
        for line, entry in ctx["lines"].items():
            if not entry["figures"]:
                continue
            names = [os.path.basename(f) for f in entry["figures"]]
            blocks.append(("p", "**%s**（%d 张）：%s" % (
                LINE_LABEL.get(line, line), len(names),
                "、".join("`%s`" % n for n in names[:12]) + ("…" if len(names) > 12 else ""))))
        return "第三章：分步分析结果与三段式深度解读", blocks

    ledgers = ledger_by_step(ctx["ledgers"])
    blocks = []
    for item in sorted(dag, key=lambda d: d.get("order") or 0):
        step = item.get("stepId") or item.get("step_id") or ""
        rec = ledgers.get(step)

        # 先定线，再取条目：同名步骤（enrichment / dr_post_analysis / ...）在三条线里
        # 产物不同，不带 line 取到的可能是别条线的声明。台账最权威；DAG 若显式带线
        # 则用它；两者都没有才按该线自己的产物声明反查。
        line = None
        for candidate in ((rec or {}).get("line_id"),
                          item.get("line_id") or item.get("lineId")):
            if candidate in ctx["lines"]:
                line = candidate
                break
        if line:
            results_dir = artifact_dir(ctx["lines"][line])
        else:
            # 没有台账不代表没跑过：按该步骤声明的产物反查
            results_dir, line = find_step_results_dir(ctx, step)
            if line is None and len(ctx["lines"]) == 1:
                # 单线项目：线号唯一。纯出图步骤（enrichment_figures / scrna_figures /
                # spatial_figures）只声明 figures/*，没有 results/* 可反查，不按唯一线号
                # 兜底就会回退到别条线的同名条目（如 line1 的"富集出图"）。
                line = next(iter(ctx["lines"]))
                results_dir = artifact_dir(ctx["lines"][line])

        meta = step_meta(step, line)
        label = meta.get("label") or step
        is_dr = step in DR_STEPS
        tag = DR_TAG if is_dr else DEG_TAG

        blocks.append(("h3", "步骤 %s · %s" % (item.get("order") or "?", label)))
        blocks.append(("p", "**标记**：`%s`" % tag))
        blocks.append(("callout", (
            "DEG 是组间转录本丰度消长；DR Genes 是虚拟敲除后的调控网络拓扑微扰，"
            "表达量未必改变，二者不可互换判读。"
        )))

        # ① 核心结论：有数据说数据，没数据说没数据
        conclusion = None
        if results_dir:
            if step in ("deg_limma", "deg_groups"):
                deg = summarize_deg(results_dir, (ctx.get("project") or {}).get("analysis_cutoffs") or {})
                if deg and deg.get("significant"):
                    conclusion = ("检出 %d 个差异表达基因（上调 %d / 下调 %d），"
                                  "log2FC 绝对值最大的为 %s。"
                                  % (deg["total"], deg["up"], deg["down"],
                                     "、".join(g["gene"] for g in deg["top"][:5])))
                elif deg and deg.get("top"):
                    top_names = "、".join(
                        "%s（log2FC=%.2f）" % (g["gene"], g["log2fc"]) for g in deg["top"][:3]
                        if g.get("log2fc") is not None
                    )
                    conclusion = ("未检出达到阈值的差异表达基因（全表 %d 个基因）；"
                                  "变化幅度最大的为 %s。"
                                  % (deg.get("all_total", 0), top_names or "—"))
            elif step in DR_STEPS:
                dr = summarize_dr(results_dir)
                if dr:
                    conclusion = ("输出 %d 个 DR Genes（调控网络拓扑扰动），"
                                  "排名前列：%s。"
                                  % (dr["total"], "、".join(g["gene"] for g in dr["top"][:5])))
            elif step in ("ml_model", "external_validation"):
                auc = summarize_auc(results_dir)
                if auc:
                    conclusion = "模型评估 AUC = %s。" % "、".join(auc["aucs"])
        if not conclusion:
            if rec and rec.get("status") == "completed":
                conclusion = ("该步骤台账状态为 completed，但未在 `<line>/results/` 或 "
                              "`<line>/processed/` 找到可解析的汇总表；"
                              "本节不填数值，请对照该步骤产出的明细文件。")
            else:
                conclusion = "未找到该步骤的完成台账或结果文件，本节不给出任何结论。"
        blocks.append(("p", "**① 核心结论**：" + conclusion))

        # ② 数据与统计依据
        evidence = []
        if meta.get("outputs"):
            found, missing = [], []
            # 线已确定就只在该线内找：三线隔离，不能拿别条线的同名产物当本线证据
            scopes = [ctx["lines"][line]] if line in ctx["lines"] else list(ctx["lines"].values())
            for rel in meta["outputs"]:
                actual, scope = None, None
                for e in scopes:
                    hit = resolve_artifact(rel, e)
                    if hit:
                        actual, scope = hit, e
                        break
                if actual:
                    # 通配声明（物种/样本/细胞类型段）要标实际命中张数，别让 `*` 被当文件名读
                    label = "`%s`" % actual
                    if "*" in rel:
                        label += "（%d 个文件）" % count_artifacts(rel, scope)
                    found.append(label)
                else:
                    missing.append(rel)
            if found:
                evidence.append("已找到产物：" + "、".join(found))
            if missing:
                evidence.append("未找到：" + "、".join("`%s`" % p for p in missing))
        if rec:
            env = rec.get("environment") or {}
            evidence.append("任务 `%s`，状态 `%s`，语言 %s%s" % (
                str(rec.get("task_id"))[:8], rec.get("status"),
                env.get("language") or "—",
                (" " + str(env.get("version"))) if env.get("version") else ""))
            usage = rec.get("resource_usage") or {}
            if usage.get("max_memory_gb") is not None:
                evidence.append("内存峰值 %.1f GB" % float(usage["max_memory_gb"]))
        blocks.append(("p", "**② 数据与统计依据**：" + ("；".join(evidence) if evidence else "无可用依据文件。")))

        # ③ 方法学与生物学限制
        blocks.append(("p", "**③ 方法学与生物学限制**：" + (meta.get("limits") or
                      "该步骤未登记限制说明，引用前请人工复核方法学前提。")))

        # ④ SCI 英文图注模板
        if meta.get("legend"):
            blocks.append(("code", "Figure legend: " + meta["legend"]))
    append_gallery(blocks, ctx)
    return "第三章：分步分析结果与三段式深度解读 (Step-by-Step Results)", blocks


def figure_dpi(project):
    """取项目声明的出图 DPI；缺失时按管线归一化口径回落 300。"""
    try:
        return int((project.get("plot_layout_config") or {}).get("dpi") or 300)
    except (TypeError, ValueError):
        return 300


def build_gallery_assets(ctx):
    """收集可内联的 PNG 图件，按分析线与文件名稳定排序。"""
    assets = []
    for line in LINES:
        entry = ctx["lines"].get(line)
        if not entry:
            continue
        for rel in entry["figures"]:
            if not rel.lower().endswith(".png"):
                continue
            full = os.path.join(entry["dir"], rel)
            if not os.path.isfile(full):
                continue
            try:
                with open(full, "rb") as fh:
                    data = base64.b64encode(fh.read()).decode("ascii")
            except OSError:
                continue
            assets.append({
                "title": os.path.splitext(os.path.basename(rel))[0],
                "line": LINE_LABEL.get(line, line),
                "path": f"figures/{line}/{os.path.basename(rel)}",
                "dpi": figure_dpi(ctx["project"]),
                "data": data,
            })
    return assets


def append_gallery(blocks, ctx):
    """把项目真实 PNG 图件并入第三章尾部，保持七章结构不变。"""
    assets = build_gallery_assets(ctx)
    if not assets:
        return
    blocks.append(("h3", "300 DPI 图廊"))
    blocks.append(("gallery", assets))


def chapter4(ctx):
    """第四章：虚拟敲除专项机制辨析（线 2 / 线 3）。"""
    project = ctx["project"]
    dag = project.get("pipeline_dag") or []
    ko_steps = [d.get("stepId") for d in dag if d.get("stepId") in ("virtual_knockout", "spatial_knockout")]
    priors = project.get("biological_priors") or {}

    blocks = []
    if not ko_steps:
        blocks.append(("p", "本项目未勾选虚拟敲除步骤，本章不适用。"))
        return "第四章：虚拟敲除（Virtual KO）专项机制辨析", blocks

    target = priors.get("target_ko_gene") or ""
    blocks.append(("kv", [
        ("虚拟敲除步骤", "、".join(ko_steps)),
        ("目标敲除基因", target or "未指定"),
        ("兜底策略", priors.get("ko_fallback_policy") or "strict_abort"),
    ]))
    blocks.append(("h3", "靶基因检出率前置核验"))
    if target:
        hits = []
        for line, entry in ctx["lines"].items():
            for rel in entry["processed"]:
                if rel.endswith(".h5ad"):
                    hits.append("`%s/%s`" % (line, os.path.basename(rel)))
        blocks.append(("p", "目标基因 `%s` 需在 WT/Control 矩阵中检出且表达非零，否则敲除无意义。"
                            "请核对 %s 中的基因名拼写与物种大小写规范。"
                      % (target, "、".join(hits) if hits else "项目 processed 目录")))
    else:
        blocks.append(("p", "项目未指定目标敲除基因，虚拟敲除步骤不应启动。"))

    blocks.append(("h3", "DEG 与 DR Genes 的本质区别"))
    blocks.append(("table", (
        ["维度", "DEG（差异表达基因）", "DR Genes（虚拟敲除扰动基因）"],
        [
            ["定义", "组间转录本丰度有统计学差异", "敲除目标基因后调控网络拓扑显著改变的基因"],
            ["来源", "limma / rank_genes_groups 等组间比较", "scTenifoldKnk 网络扰动模拟"],
            ["解读", "反映「表达水平变化」", "反映「调控关系被破坏」，表达量未必改变"],
            ["验证", "qPCR / WB 可直接验证丰度", "需网络或功能实验间接验证"],
        ],
    )))

    overlap_notes = []
    for line, entry in ctx["lines"].items():
        results = artifact_dir(entry)
        dr = summarize_dr(results)
        if dr:
            overlap_notes.append("%s 的 DR 基因数 %d（文件 `%s`）" % (
                LINE_LABEL.get(line, line), dr["total"], dr["file"]))
    blocks.append(("h3", "DR ∩ DEG / Marker 交集"))
    blocks.append(("p", ("；".join(overlap_notes) if overlap_notes else "未找到 DR 基因结果文件") +
                   "。交集基因既发生表达变化又处于被扰动的调控网络中，是后续湿实验的优先候选；"
                   "但交集本身不构成因果证据。"))
    return "第四章：虚拟敲除（Virtual KO）专项机制辨析", blocks


def chapter5(ctx):
    """第五章：推荐后续湿实验验证路线图。"""
    project = ctx["project"]
    priors = project.get("biological_priors") or {}
    focus = priors.get("focus_genes") or []
    target = priors.get("target_ko_gene") or ""

    candidates = []
    cutoffs = project.get("analysis_cutoffs") or {}
    for line, entry in ctx["lines"].items():
        results = artifact_dir(entry)
        deg = summarize_deg(results, cutoffs)
        if deg:
            candidates.extend(g["gene"] for g in deg["top"][:5])
        dr = summarize_dr(results)
        if dr:
            candidates.extend(g["gene"] for g in dr["top"][:5])
    ordered = []
    for g in focus + ([target] if target else []) + candidates:
        if g and g not in ordered:
            ordered.append(g)
    top = ordered[:8]

    blocks = []
    blocks.append(("p", "**优先候选基因**：" + ("、".join(top) if top else "项目未产出可排序的候选基因")))
    blocks.append(("table", (
        ["实验", "目的", "建议设计"],
        [
            ["RT-qPCR", "验证转录本丰度差异", "每组 ≥6 例生物学重复，内参双基因归一化"],
            ["Western blot", "验证蛋白层面变化", "选择特异性抗体，至少两个独立批次"],
            ["多重免疫荧光", "空间共定位验证", "在组织切片上共染目标蛋白与细胞类型 marker"],
            ["敲低 / 过表达 + 救援实验", "建立因果链", "siRNA/shRNA 敲低后回补，观察表型是否可逆"],
            ["功能实验", "细胞水平表型", "迁移 / 增殖 / 炎症因子释放等，按疾病背景选择"],
        ],
    )))
    blocks.append(("p", "**说明**：以上为基于计算结果的验证建议，不构成实验方案；"
                        "抗体选择、样本量与伦理审批需由实验方另行确定。"))
    return "第五章：推荐后续湿实验验证路线图 (Wet-Lab Validation Roadmap)", blocks


def chapter6(ctx):
    """第六章：交付物文件索引字典。"""
    blocks = []
    rows = []
    for line, entry in ctx["lines"].items():
        for rel in entry["figures"]:
            rows.append([LINE_LABEL.get(line, line), "图件", "`%s`" % rel,
                         "结果可视化（300 DPI PNG）"])
        # 用 tables（results/ + processed/ 中的表格类文件），母版脚本产物在 processed/
        for rel in entry.get("tables", entry["results"]):
            rows.append([LINE_LABEL.get(line, line), "结果表", "`%s`" % rel,
                         "该步骤的明细统计结果"])
    if rows:
        blocks.append(("table", (["分析线", "类别", "文件", "说明"], rows)))
    else:
        blocks.append(("p", "项目目录下未找到图件与结果表。"))

    blocks.append(("h3", "关键结果表字段说明"))
    blocks.append(("table", (
        ["文件", "关键字段", "含义"],
        [
            ["`deg_all.tsv` / `deg_sig.tsv`", "gene / logFC / P.Value / adj.P.Val",
             "基因名、log2 倍数变化、原始 p、校正 p"],
            ["`ko_dr_genes.tsv`", "gene / distance",
             "DR 基因名、网络扰动距离（越大越显著）"],
            ["`celltype_scores.tsv`", "spot / celltype / score",
             "spot 编号、细胞类型、NNLS 解卷积权重"],
            ["`external_validation_preds.tsv`", "sample / prob / label",
             "样本、预测概率、真实标签"],
        ],
    )))
    return "第六章：交付物文件索引字典 (Deliverables Manifest Dictionary)", blocks


def chapter7(ctx):
    """第七章：可复现性台账与质控审计摘要。"""
    ledgers = ctx["ledgers"]
    blocks = []
    if ledgers:
        rows = []
        total_sec = 0.0
        peak_mem = 0.0
        for rec in sorted(ledgers, key=lambda r: str(r.get("start_time") or "")):
            env = rec.get("environment") or {}
            usage = rec.get("resource_usage") or {}
            dur = "—"
            try:
                t0 = datetime.datetime.fromisoformat(str(rec.get("start_time")).replace("Z", "+00:00"))
                t1 = datetime.datetime.fromisoformat(str(rec.get("end_time")).replace("Z", "+00:00"))
                secs = (t1 - t0).total_seconds()
                total_sec += max(secs, 0)
                dur = "%.0f s" % secs
            except (ValueError, TypeError):
                pass
            mem = usage.get("max_memory_gb")
            if isinstance(mem, (int, float)):
                peak_mem = max(peak_mem, float(mem))
            rows.append([
                str(rec.get("task_id"))[:8],
                rec.get("line_id") or "—",
                rec.get("step_name") or "—",
                rec.get("status") or "—",
                rec.get("checkpoint_status") or "—",
                dur,
                ("%.1f GB" % mem) if isinstance(mem, (int, float)) else "—",
                str(env.get("random_seed", "—")),
            ])
        blocks.append(("p", "**台账汇总**：共 %d 条任务，累计耗时约 %.1f 分钟，单步内存峰值 %.1f GB。"
                       % (len(ledgers), total_sec / 60.0, peak_mem)))
        blocks.append(("table", (
            ["task_id", "分析线", "步骤", "状态", "检查点", "耗时", "内存峰值", "seed"], rows)))
    else:
        blocks.append(("p", "未在 `system_logs/` 找到本项目（`%s`）的任务台账。" % ctx["project_id"]))

    blocks.append(("h3", "五维环境自检"))
    blocks.append(("p", "自检项与工作台 `/api/selfcheck` 同口径。**本报告不代替自检结果**："
                        "如项目目录下存在 `selfcheck.json`，其内容会一并收录；否则请在交付前运行一次自检。"))
    selfcheck = read_json(os.path.join(ctx["project_dir"], "selfcheck.json"), default=None)
    if isinstance(selfcheck, dict) and selfcheck.get("checks"):
        rows = [[c.get("label") or c.get("id"), c.get("status"), str(c.get("value") or "")[:60]]
                for c in selfcheck["checks"]]
        blocks.append(("table", (["自检项", "状态", "实测值"], rows)))
    else:
        blocks.append(("p", "未找到 `selfcheck.json`，五维自检结论缺失。"))
    return "第七章：可复现性台账与质控审计摘要 (Reproducibility & Audit Ledger)", blocks


CHAPTER_BUILDERS = [chapter1, chapter2, chapter3, chapter4, chapter5, chapter6, chapter7]


# ============================================================
# 渲染
# ============================================================

def render_markdown(meta, chapters):
    out = []
    out.append("# %s · 客户交付解读报告" % meta["project_name"])
    out.append("")
    out.append("> 项目 ID：`%s`　生成时间：%s　报告版本：1.0" % (meta["project_id"], meta["generated_at"]))
    out.append("> 本报告由 `ops/build_client_report.py` 依据项目实际产物自动生成。"
               "所有统计量均读自磁盘文件；缺失处明确标注，不做推测填充。")
    out.append("")
    out.append("## 目录")
    for i, (title, _) in enumerate(chapters, 1):
        anchor = re.sub(r"[^\w\u4e00-\u9fa5-]+", "-", title).strip("-")
        out.append("%d. [%s](#%s)" % (i, title, anchor))
    out.append("")
    for title, blocks in chapters:
        out.append("## " + title)
        out.append("")
        for kind, payload in blocks:
            if kind == "p":
                out.append(payload)
                out.append("")
            elif kind == "h3":
                out.append("### " + payload)
                out.append("")
            elif kind == "ul":
                for item in payload:
                    out.append("- " + item)
                out.append("")
            elif kind == "code":
                out.append("```")
                out.append(payload)
                out.append("```")
                out.append("")
            elif kind == "callout":
                out.append("> " + payload)
                out.append("")
            elif kind == "kv":
                out.append("| 字段 | 内容 |")
                out.append("|---|---|")
                for k, v in payload:
                    out.append("| %s | %s |" % (k, str(v).replace("|", "\\|")))
                out.append("")
            elif kind == "table":
                header, rows = payload
                out.append("| " + " | ".join(header) + " |")
                out.append("|" + "|".join(["---"] * len(header)) + "|")
                for row in rows:
                    out.append("| " + " | ".join(str(c).replace("|", "\\|") for c in row) + " |")
                out.append("")
    out.append("---")
    out.append("")
    out.append("本报告不含任何推测数值。若某章节标注「未找到」，表示对应产物尚未落盘，"
               "请补齐后重新生成本报告。")
    return "\n".join(out) + "\n"


HTML_CSS = """
:root{--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--accent:#0d9488;--bg:#f8fafc}
*{box-sizing:border-box}
body{margin:0;font:15px/1.75 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:var(--ink);background:var(--bg)}
.layout{display:grid;grid-template-columns:280px 1fr;min-height:100vh}
nav{position:sticky;top:0;align-self:start;height:100vh;overflow:auto;padding:28px 20px;background:#fff;border-right:1px solid var(--line)}
nav h1{font-size:15px;margin:0 0 4px}
nav .meta{font-size:12px;color:var(--muted);margin-bottom:18px;word-break:break-all}
nav a{display:block;padding:7px 10px;border-radius:6px;color:var(--ink);text-decoration:none;font-size:13.5px}
nav a:hover{background:#f1f5f9}
nav a.active{background:#ecfdf5;color:#047857;font-weight:600}
main{padding:40px 56px;max-width:1000px}
h2{font-size:22px;margin:44px 0 14px;padding-bottom:8px;border-bottom:2px solid var(--line)}
h3{font-size:16px;margin:26px 0 8px;color:#0f766e}
p{margin:10px 0}
table{border-collapse:collapse;width:100%;margin:14px 0;font-size:13.5px;background:#fff}
th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
th{background:#f1f5f9;font-weight:600}
code{background:#f1f5f9;padding:1px 5px;border-radius:4px;font-size:12.5px}
pre{background:#0f172a;color:#e2e8f0;padding:14px 16px;border-radius:8px;overflow:auto;font-size:12.5px;line-height:1.6}
ul{padding-left:22px}
.tag-deg,.tag-dr{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600}
.tag-deg{background:#e0edff;color:#1d4ed8}
.tag-dr{background:#ffedd5;color:#c2410c}
.callout{background:#ecfeff;border-left:4px solid #0891b2;padding:10px 14px;margin:12px 0;color:#155e75}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin:14px 0}
.gallery-item{background:#fff;border:1px solid var(--line);border-radius:8px;overflow:hidden;margin:0}
.gallery-item img{width:100%;height:auto;display:block}
.gallery-item figcaption{padding:10px 12px;font-size:12.5px;color:var(--muted)}
.search{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:13px;margin-bottom:14px}
.hidden{display:none}
@media(max-width:900px){.layout{grid-template-columns:1fr}nav{position:static;height:auto;border-right:none;border-bottom:1px solid var(--line)}main{padding:24px}}
"""

HTML_JS = """
const links=[...document.querySelectorAll('nav a[href^="#"]')];
const heads=[...document.querySelectorAll('main h2[id]')];
const io=new IntersectionObserver(es=>{es.forEach(e=>{if(e.isIntersecting){
  links.forEach(l=>l.classList.toggle('active',l.getAttribute('href')==='#'+e.target.id));}})},{rootMargin:'-20% 0px -70% 0px'});
heads.forEach(h=>io.observe(h));
const box=document.getElementById('q');
box.addEventListener('input',()=>{const q=box.value.trim().toLowerCase();
  document.querySelectorAll('main h2,main h3').forEach(h=>{
    let n=h;let show=!q||h.textContent.toLowerCase().includes(q);
    while(n&&n.tagName!=='H2'){n=n.nextElementSibling;if(!n)break;
      if(!q){(n.classList||{}).remove&&n.classList.remove('hidden');continue;}
      if(n.textContent.toLowerCase().includes(q))show=true;}
    h.classList.toggle('hidden',!show);});});
"""


def render_html(meta, chapters):
    """单文件可交互 HTML：目录高亮 + 关键词过滤，零外部依赖。"""
    nav = []
    body = []
    for i, (title, blocks) in enumerate(chapters, 1):
        anchor = "ch%d" % i
        nav.append('<a href="#%s">%d. %s</a>' % (anchor, i, html.escape(title)))
        body.append('<h2 id="%s">%s</h2>' % (anchor, html.escape(title)))
        for kind, payload in blocks:
            if kind == "p":
                text = html.escape(payload)
                # 支持 **加粗**、`代码` 与 DR/DEG 标记着色
                text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
                text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
                text = text.replace(html.escape(DR_TAG),
                                    '<span class="tag-dr">%s</span>' % html.escape(DR_TAG))
                text = text.replace(html.escape(DEG_TAG),
                                    '<span class="tag-deg">%s</span>' % html.escape(DEG_TAG))
                body.append("<p>%s</p>" % text)
            elif kind == "h3":
                body.append("<h3>%s</h3>" % html.escape(payload))
            elif kind == "ul":
                body.append("<ul>%s</ul>" % "".join("<li>%s</li>" % html.escape(x) for x in payload))
            elif kind == "code":
                body.append("<pre>%s</pre>" % html.escape(payload))
            elif kind == "callout":
                body.append('<div class="callout">%s</div>' % html.escape(payload))
            elif kind == "gallery":
                cards = []
                for asset in payload:
                    src = "data:image/png;base64,%s" % asset["data"]
                    cards.append(
                        '<figure class="gallery-item"><img src="%s" alt="%s">'
                        '<figcaption><strong>%s</strong> · %s · %s DPI</figcaption></figure>'
                        % (src, html.escape(asset["title"]), html.escape(asset["title"]),
                           html.escape(asset["line"]), html.escape(str(asset["dpi"])))
                    )
                body.append('<div class="gallery">%s</div>' % "".join(cards))
            elif kind == "kv":
                rows = "".join("<tr><th>%s</th><td>%s</td></tr>" % (html.escape(k), html.escape(str(v)))
                               for k, v in payload)
                body.append("<table>%s</table>" % rows)
            elif kind == "table":
                header, rows = payload
                head = "".join("<th>%s</th>" % html.escape(str(h)) for h in header)
                trs = "".join("<tr>%s</tr>" % "".join("<td>%s</td>" % html.escape(str(c)) for c in row)
                              for row in rows)
                body.append("<table><thead><tr>%s</tr></thead><tbody>%s</tbody></table>" % (head, trs))

    return """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>%s · 客户交付解读报告</title>
<style>%s</style></head>
<body><div class="layout">
<nav>
<h1>%s</h1>
<div class="meta">项目 ID：%s<br>生成时间：%s</div>
<input class="search" id="q" placeholder="搜索章节 / 关键词…" aria-label="搜索">
%s
</nav>
<main>
%s
</main></div>
<script>%s</script>
</body></html>
""" % (
        html.escape(meta["project_name"]), HTML_CSS,
        html.escape(meta["project_name"]),
        html.escape(meta["project_id"]), html.escape(meta["generated_at"]),
        "\n".join(nav), "\n".join(body), HTML_JS,
    )


# ============================================================
# 交付包归集
# ============================================================

def build_meta(ctx):
    project = ctx["project"]
    basic = project.get("basic_info") or {}
    return {
        "project_id": ctx["project_id"],
        "project_name": basic.get("name") or ctx["project_id"],
        "generated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }


def collect_chapters(ctx):
    return [builder(ctx) for builder in CHAPTER_BUILDERS]


ADAPTED_CODE_DIR = "01_Adapted_Code"
PUBLIC_KEY_NAME = "ED25519_PUBLIC_KEY.pem"
MASTER_HEADER_RE = re.compile(
    r"^#\s*Master-Source:\s*(.*?)\s*\|\s*Master-SHA256:\s*([0-9a-f]{64})\s*$",
    re.MULTILINE,
)


def assemble(ctx, out_dir, no_tar=False):
    """生成三大件并打包。返回产物路径字典。"""
    meta = build_meta(ctx)
    chapters = collect_chapters(ctx)

    delivery = os.path.join(out_dir, "%s_Client_Delivery" % ctx["project_id"])
    # 同项目重建必须从空目录开始，旧包残留文件不得混入新清单与签名。
    if os.path.isdir(delivery):
        shutil.rmtree(delivery)
    d_code = os.path.join(delivery, "01_Adapted_Code")
    d_figures = os.path.join(delivery, "02_Figures_and_Tables")
    d_report = os.path.join(delivery, "03_Interpretation_Report")
    for d in (d_code, d_figures, d_report):
        os.makedirs(d, exist_ok=True)

    copied = {"scripts": 0, "adapted_code": 0, "figures": 0, "tables": 0}
    adapted_reconcile = []

    # 第一大件：适配代码。普通实例脚本按线落盘；图级模板派生副本保留
    # figures/adapt 的项目内语义，便于和母版 SHA256 对账。
    for line, entry in ctx["lines"].items():
        for rel in entry["scripts"]:
            src = os.path.join(entry["dir"], rel)
            text = read_text(src)
            header = MASTER_HEADER_RE.search(text)
            if header:
                # 18787 现有上传接缝会把派生副本放进本线 scripts/；
                # 打包时按头部证据归位到交付包的 figures/adapt。
                dst = os.path.join(d_code, "figures", "adapt", os.path.basename(rel))
                rel_path = "figures/adapt/" + os.path.basename(rel)
            else:
                dst = os.path.join(d_code, line, os.path.basename(rel))
                rel_path = "%s/%s" % (line, os.path.basename(rel))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            try:
                with open(dst, "w", encoding="utf-8", newline="\n") as fh:
                    fh.write(desensitize(text, ctx["project_dir"]))
                if header:
                    copied["adapted_code"] += 1
                    adapted_reconcile.append({
                        "path": rel_path,
                        "master_source": header.group(1),
                        "master_sha256": header.group(2),
                        "derived_sha256": hashlib.sha256(
                            desensitize(text, ctx["project_dir"]).encode("utf-8")
                        ).hexdigest(),
                    })
                else:
                    copied["scripts"] += 1
            except OSError:
                pass

    # 图级适配脚本在每条线的 adapted 列表里都会出现一次（同一份 figures/adapt/*.R）。
    # 不去重会让清单登记 3 遍、counts 也多计 2 遍，实测 51 条只对应 17 个唯一文件。
    # 用已写集合保证「一个文件登记一次、计数一次」。
    _adapted_written = set()
    for line, entry in ctx["lines"].items():
        for rel in entry.get("adapted", []):
            if rel in _adapted_written:
                continue
            _adapted_written.add(rel)
            src = os.path.join(entry["dir"], rel)
            dst = os.path.join(d_code, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            try:
                text = read_text(src)
                header = MASTER_HEADER_RE.search(text)
                if not header:
                    raise RuntimeError(
                        "figures/adapt 缺少 Master-Source 与 Master-SHA256 头: %s" % rel
                    )
                with open(dst, "w", encoding="utf-8", newline="\n") as fh:
                    fh.write(desensitize(text, ctx["project_dir"]))
                copied["adapted_code"] += 1
                adapted_reconcile.append({
                    "path": rel,
                    "master_source": header.group(1),
                    "master_sha256": header.group(2),
                    "derived_sha256": hashlib.sha256(
                        desensitize(text, ctx["project_dir"]).encode("utf-8")
                    ).hexdigest(),
                })
            except OSError:
                pass

    if adapted_reconcile:
        report_path = os.path.join(d_code, "_report.txt")
        lines = [
            "# 01_Adapted_Code 对账说明",
            "",
            "required_master_header=true",
            "header_fields=Master-Source, Master-SHA256",
            "",
        ]
        for item in sorted(adapted_reconcile, key=lambda row: row["path"]):
            lines.extend([
                "## %s" % item["path"],
                "Master-Source: %s" % item["master_source"],
                "Master-SHA256: %s" % item["master_sha256"],
                "Delivered-SHA256: %s" % item["derived_sha256"],
                "",
            ])
        with open(report_path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write("\n".join(lines).rstrip("\n") + "\n")

    # 第二大件：图件与结果表
    for line, entry in ctx["lines"].items():
        for rel in entry["figures"]:
            src = os.path.join(entry["dir"], rel)
            dst = os.path.join(d_figures, "figures", line, os.path.basename(rel))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            try:
                shutil.copy2(src, dst)
                copied["figures"] += 1
            except OSError:
                pass
        for rel in entry.get("tables", entry["results"]):
            src = os.path.join(entry["dir"], rel)
            dst = os.path.join(d_figures, "tables", line, os.path.basename(rel))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            try:
                shutil.copy2(src, dst)
                copied["tables"] += 1
            except OSError:
                pass

    # 第三大件：报告
    md_path = os.path.join(d_report, "Analysis_Report.md")
    html_path = os.path.join(d_report, "Analysis_Report.html")
    with open(md_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(render_markdown(meta, chapters))
    with open(html_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(render_html(meta, chapters))

    # 交付清单：让客户与对接人都能一眼核对"包里到底有什么"
    manifest = {
        "package_version": "1.0",
        "project_id": ctx["project_id"],
        "project_name": meta["project_name"],
        "generated_at": meta["generated_at"],
        "counts": copied,
        "sections": [t for t, _ in chapters],
        "files": {
            "scripts": ["%s/%s" % (line, os.path.basename(rel))
                        for line, e in ctx["lines"].items() for rel in e["scripts"]],
            "adapted_code": list(dict.fromkeys(
                             rel
                             for line, e in ctx["lines"].items()
                             for rel in e.get("adapted", [])
                         )),
            "figures": ["figures/%s/%s" % (line, os.path.basename(rel))
                        for line, e in ctx["lines"].items() for rel in e["figures"]],
            "tables": ["tables/%s/%s" % (line, os.path.basename(rel))
                       for line, e in ctx["lines"].items() for rel in e.get("tables", e["results"])],
        },
        "ledger_tasks": len(ctx["ledgers"]),
    }
    with open(os.path.join(delivery, "delivery_manifest.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)

    # 包根 README：写死两套登记的分工（4 Argon 第十八轮第 3 节裁定，双层正交不合并）。
    # 必须在 write_checksums 之前落盘，这样 README 自身也进 CHECKSUMS 并被签名覆盖；
    # 它不属于 manifest 的业务分类，验收第 4 关的白名单（$allowedUnlistedFiles）同步放行。
    with open(os.path.join(delivery, "README.md"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(delivery_readme(meta["project_id"], meta["project_name"], meta["generated_at"], copied))

    # 客户自助验收单（Ticket 5，4 Argon 第二十一轮 Q5）：独立成文件，给「拿到包、没有我们」
    # 的人照抄执行。必须写在 write_checksums 之前，让它像 README / manifest 一样直接受
    # CHECKSUMS 哈希保护（这样覆盖率检查不必再加白名单条目）。
    with open(os.path.join(delivery, HOW_TO_VERIFY_NAME), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(how_to_verify(meta["project_id"], mtime_of_tar_sidecar(out_dir, ctx["project_id"])))

    # 完整性清单：先写 CHECKSUMS.sha256 再打 tar，包内清单与包内文件一一对应。
    # 只覆盖三大件与 manifest 自身落盘之后的现实，manifest 里的 counts 是
    # 复制成功计数、这里是文件系统实测字节，两者不一致以本清单为准。
    checksums = write_checksums(delivery)
    signature = sign_checksums(delivery, required=True)

    tar_path = None
    sidecar_path = None
    if not no_tar:
        tar_path = os.path.join(out_dir, "%s_Client_Delivery.tar.gz" % ctx["project_id"])
        with tarfile.open(tar_path, "w:gz") as tar:
            tar.add(delivery, arcname=os.path.basename(delivery))
        digest = hashlib.sha256()
        with open(tar_path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                digest.update(chunk)
        sidecar_path = tar_path + ".sha256"
        with open(sidecar_path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write("%s  %s\n" % (digest.hexdigest(), os.path.basename(tar_path)))

    return {
        "delivery_dir": delivery,
        "report_md": md_path,
        "report_html": html_path,
        "manifest": os.path.join(delivery, "delivery_manifest.json"),
        "checksums": checksums["path"],
        "checksums_count": checksums["count"],
        "signature": signature,
        "public_key": os.path.join(delivery, PUBLIC_KEY_NAME),
        "tar": tar_path,
        "tar_sha256": sidecar_path,
        "counts": copied,
        "chapters": len(chapters),
    }


# 校验清单名：与本地 .sha256 旁挂同一套 sha256sum 语法，客户可直接
# `sha256sum -c CHECKSUMS.sha256` 复核包内每个文件是否被改过。
CHECKSUMS_NAME = "CHECKSUMS.sha256"
SIGNATURE_NAME = "CHECKSUMS.sig"
README_NAME = "README.md"
HOW_TO_VERIFY_NAME = "HOW_TO_VERIFY.txt"


def mtime_of_tar_sidecar(out_dir, project_id):
    """侧车还没写（本函数在 checksums 之前调用）时返回空串，由调用方决定文案。

    交付单里不嵌时间戳：任何易变量都会让「同一输入两次打包」变成两个哈希，
    而客户自助验收要的是可在任何时候复现的固定步骤。
    """
    return ""


def how_to_verify(project_id, _ignored=""):
    """客户自助验收单（Ticket 5）：不假设对方装了什么，只给系统自带工具能跑的命令。

    存在的理由（4 Argon 第二十一轮 Q5）：交付包里已经有 README 讲「两套清单分工」，
    但那只解决「哪个为准」。真正交给陌生用户时，对方需要的是一页「先做什么、再做什么、
    看到什么算过、不对时把什么发回来」。这份文件就是那一页，且它自己也进 CHECKSUMS，
    所以不会被塞进一句「照着改」的私货。
    """
    return (
        "HOW TO VERIFY · 交付包自助验收单\n"
        "=========================================\n\n"
        "项目 ID：%s\n"
        "适用：拿到 <项目>_Client_Delivery.tar.gz 之后，不需要安装任何生信软件。\n\n"
        "一、四步验收（按顺序做，全部通过即包可信）\n\n"
        "  第 1 步 校验压缩包本体\n"
        "    同目录应有 %s_Client_Delivery.tar.gz.sha256（或 tar_sha256_sidecar.txt）。\n"
        "      Linux/macOS:  sha256sum -c %s_Client_Delivery.tar.gz.sha256\n"
        "      Windows:      certutil -hashfile %s_Client_Delivery.tar.gz SHA256\n"
        "                    （把输出与 .sha256 文件里的第一列逐字符比对）\n"
        "    期望：OK / 两串哈希完全一致。不一致 = 传输损坏或包被替换，不要往下做。\n\n"
        "  第 2 步 解开压缩包\n"
        "      tar -xzf %s_Client_Delivery.tar.gz\n"
        "    期望：只生成一个同名目录，内含 01_Adapted_Code / 02_Figures_and_Tables /\n"
        "          03_Interpretation_Report / delivery_manifest.json / CHECKSUMS.sha256\n"
        "          / CHECKSUMS.sig / ED25519_PUBLIC_KEY.pem / README.md / 本文件。\n\n"
        "  第 3 步 校验包内每个文件\n"
        "      cd %s_Client_Delivery\n"
        "      sha256sum -c CHECKSUMS.sha256\n"
        "    期望：每一行都是 OK，最后没有 FAILED。\n"
        "    这一步回答「有没有人改过包里的图、表或代码」。\n\n"
        "  第 4 步（可选，需要 OpenSSL 1.1.1 以上）验证签名\n\n"
        "      CHECKSUMS.sig 是 Ed25519 私钥对 CHECKSUMS.sha256 的签名。一条命令验证：\n\n"
        "        openssl pkeyutl -verify -pubin -inkey ED25519_PUBLIC_KEY.pem -rawin -in CHECKSUMS.sha256 -sigfile CHECKSUMS.sig\n\n"
        "      期望输出：Signature Verified Successfully（退出码 0）。\n"
        "      必须用 -rawin：Ed25519 是纯 EdDSA，签名时对原始消息做两次 SHA-512，\n"
        "      不支持预哈希；用 openssl dgst -sha256 -verify 这类写法会直接报错。\n"
        "      不会验也没关系：第 1 步的包哈希已经能挡住传输层替换。\n\n"
        "二、看到什么算通过\n\n"
        "  [1] 包哈希一致  [2] 解包只有一个一级目录  [3] sha256sum -c 全 OK\n"
        "  三条全绿 = 包完整。图件能否复现属于分析口径问题，不在本验收单范围内。\n\n"
        "三、不对时把什么发回来\n\n"
        "  1) 失败的那一步命令原文与完整输出（不要只截一行）；\n"
        "  2) 本文件顶部这一行：项目 ID：%s\n"
        "  3) 压缩包本身的大小与 .sha256 文件内容。\n"
        "  有这三样，我们能在不接触你机器的情况下判断是传输问题、包问题还是环境问题。\n\n"
        "四、本文件的地位\n\n"
        "  本文件自身也在 CHECKSUMS.sha256 里（受签名保护）。如果你把本文件改了，第 3 步会\n"
        "  当场报 FAILED —— 这是故意的：验收单不允许被悄悄改写。\n"
        % (project_id, project_id, project_id, project_id, project_id, project_id, project_id)
    )


def delivery_readme(project_id, project_name, generated_at, counts):
    """包根 README：写死两套登记的分工。

    为什么必须存在（4 Argon 第十八轮第 3 节）：交付包里有 manifest 与 CHECKSUMS 两套
    登记，客户与对接人第一反应是「以哪套为准」。两套职责正交，合并任何一套都会破坏
    另一边（CHECKSUMS 必须保持 sha256sum 可解析的纯文本；manifest 承载业务分类）。
    所以不合并，但必须在包根用最短的话写清分工，否则每次交付都要口头解释一遍。
    """
    return (
        "# %s · 交付包说明\n\n"
        "> 项目 ID：`%s`　生成时间：%s\n\n"
        "## 包里有什么\n\n"
        "| 目录 | 内容 | 数量 |\n"
        "|---|---|---|\n"
        "| `01_Adapted_Code/` | 本次分析使用的脚本与图件适配代码 | %s |\n"
        "| `02_Figures_and_Tables/` | 图件与结果表 | 图 %s / 表 %s |\n"
        "| `03_Interpretation_Report/` | 七章解读报告（Markdown 与单文件 HTML） | 2 |\n\n"
        "## 两套清单各管什么（重要）\n\n"
        "- **`delivery_manifest.json` 管业务分类索引**：有哪些图、多少张表、属于哪条分析线。\n"
        "  给管理台与报告索引器读，不是完整性凭证。\n"
        "- **`CHECKSUMS.sha256` + `CHECKSUMS.sig` 管防篡改完整性**：覆盖包内每个文件，\n"
        "  **含 `delivery_manifest.json` 与本 README 自身**。给取证与验收用。\n\n"
        "两者不合并：CHECKSUMS 必须保持 `sha256sum` 能直接解析的纯文本格式，\n"
        "一旦塞进 JSON，系统自带工具链就失效；manifest 需要树状结构表达分类，\n"
        "两者职责正交。完整性以 CHECKSUMS 为准。\n\n"
        "## 怎么自己验一遍（无需安装任何东西）\n\n"
        "```sh\n"
        "sha256sum -c CHECKSUMS.sha256\n"
        "```\n\n"
        "`CHECKSUMS.sig` 是 Ed25519 私钥对 `CHECKSUMS.sha256` 的签名，\n"
        "`ED25519_PUBLIC_KEY.pem` 是对应公钥，可用于离线验签。\n\n"
        "## 复现说明\n\n"
        "所有统计量均从磁盘真实产物读出，未做任何填充或示例替换。\n"
        "`01_Adapted_Code/figures/adapt/` 下每个脚本头部带 `Master-Source` 与\n"
        "`Master-SHA256`，可与母版逐字节对账（见 `_report.txt`）。\n"
        % (
            project_name, project_id, generated_at,
            int(counts.get("scripts", 0)) + int(counts.get("adapted_code", 0)),
            counts.get("figures", 0), counts.get("tables", 0),
        )
    )


def write_checksums(delivery_dir, skip=()):
    """在 delivery_dir 下生成 CHECKSUMS.sha256。

    * 只列包内真实存在的文件（相对 delivery_dir 的 POSIX 路径）；
    * 修文件名（即自身）、skip 里的文件一律不入列；
    * 逐行排序，便于 diff；
    * 先写清单再打 tar，保证包内清单与包内文件一一对应。
    """
    delivery_dir = os.path.abspath(delivery_dir)
    skip_set = {os.path.normpath(s) for s in skip}
    rows = []
    for dirpath, dirnames, filenames in os.walk(delivery_dir):
        dirnames.sort()
        for name in sorted(filenames):
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, delivery_dir).replace(os.sep, "/")
            if rel in skip_set or rel in (CHECKSUMS_NAME, SIGNATURE_NAME):
                continue
            if not os.path.isfile(full):
                continue
            digest = hashlib.sha256()
            with open(full, "rb") as fh:
                while True:
                    chunk = fh.read(1024 * 1024)
                    if not chunk:
                        break
                    digest.update(chunk)
            rows.append((rel, digest.hexdigest()))
    rows.sort()
    checksums_path = os.path.join(delivery_dir, CHECKSUMS_NAME)
    with open(checksums_path, "w", encoding="utf-8", newline="\n") as fh:
        for rel, digest in rows:
            fh.write("%s  %s\n" % (digest, rel))
    return {"path": checksums_path, "files": [rel for rel, _ in rows], "count": len(rows)}


def sign_checksums(delivery_dir, required=False):
    """用 Ed25519 私钥对 CHECKSUMS.sha256 生成 CHECKSUMS.sig。"""
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node 不可用，无法生成 CHECKSUMS.sig")
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ed25519_tools.mjs")
    result = subprocess.run(
        [node, script, "--delivery-dir", delivery_dir, "--sign-only"]
        + (["--required"] if required else []),
        capture_output=True, text=True, timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError("Ed25519 签名失败: %s" % result.stderr.strip())
    signature_path = os.path.join(delivery_dir, SIGNATURE_NAME)
    if not os.path.isfile(signature_path) or os.path.getsize(signature_path) != 64:
        raise RuntimeError("CHECKSUMS.sig 生成失败或不是 64 字节")
    return {"path": signature_path, "bytes": os.path.getsize(signature_path)}


def generate_selftest_ed25519_keys(root):
    """自检用一次性密钥：写临时文件读入内存后立即删除。"""
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node 不可用，无法生成自检 Ed25519 密钥")
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ed25519_tools.mjs")
    private_path = os.path.join(root, ".selftest_private_key")
    public_path = os.path.join(root, ".selftest_public_key")
    result = subprocess.run(
        [node, script, "--generate-keys", "--private-key-output", private_path,
         "--public-key-output", public_path],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError("自检 Ed25519 密钥生成失败: %s" % result.stderr.strip())
    try:
        private_key = read_text(private_path).strip()
        public_key = read_text(public_path).strip()
        if not private_key.startswith("-----BEGIN PRIVATE KEY-----"):
            raise RuntimeError("自检私钥文件不完整")
        if not public_key.startswith("-----BEGIN PUBLIC KEY-----"):
            raise RuntimeError("自检公钥文件不完整")
        return private_key, public_key
    finally:
        for path in (private_path, public_path):
            try:
                os.remove(path)
            except OSError:
                pass

# ============================================================
# 自检与 CLI
# ============================================================

def self_test():
    """用最小样例跑通七章渲染与打包，验证"缺数据也不崩、不编数字"。"""
    failed = 0

    def check(label, cond, detail=""):
        nonlocal failed
        if not cond:
            failed += 1
        print("%s | %s%s" % ("PASS" if cond else "FAIL", label, (" | " + detail) if detail else ""))

    root = tempfile.mkdtemp(prefix="report_selftest_")
    proj = os.path.join(root, "PRJ_SELFTEST")
    os.makedirs(os.path.join(proj, "line1_bulk", "results"))
    os.makedirs(os.path.join(proj, "line1_bulk", "figures"))
    os.makedirs(os.path.join(proj, "line1_bulk", "scripts"))

    project = {
        "schema_version": 3,
        "project_id": "PRJ_SELFTEST",
        "basic_info": {"name": "自检项目", "disease": "Psoriasis", "species": "Homo sapiens"},
        "data_source": {"data_source_mode": "PUBLIC_DB",
                        "datasets": [{"gse": "GSE1", "gpl": "GPL1", "role": "train"}]},
        "grouping_design": {"mode": "two_group", "groups": [
            {"group_name": "Ctrl", "role": "reference", "sample_ids": ["GSM1", "GSM2"]},
            {"group_name": "Treat", "role": "disease_stage", "sample_ids": ["GSM3", "GSM4"]},
        ]},
        "pipeline_dag": [{"order": 1, "stepId": "deg_limma"}, {"order": 2, "stepId": "virtual_knockout"}],
        "analysis_cutoffs": {"profile": "standard_sci", "log2fc_threshold": 1.0,
                             "padj_threshold": 0.05, "max_mt_percent": 15},
        "plot_layout_config": {"template_id": "template_1_nature_side", "dpi": 300},
        "biological_priors": {"focus_genes": ["IL17A"], "target_ko_gene": "TNF",
                              "ko_fallback_policy": "strict_abort"},
        "experimental_design": {"is_paired": False},
    }
    with open(os.path.join(proj, "project.json"), "w", encoding="utf-8") as fh:
        json.dump(project, fh, ensure_ascii=False)

    with open(os.path.join(proj, "line1_bulk", "results", "deg_sig.tsv"), "w", encoding="utf-8") as fh:
        fh.write("gene\tlogFC\tP.Value\tadj.P.Val\n")
        fh.write("IL17A\t2.5\t0.001\t0.01\n")
        fh.write("S100A8\t-1.8\t0.002\t0.02\n")
    with open(os.path.join(proj, "line1_bulk", "results", "ko_dr_genes.tsv"), "w", encoding="utf-8") as fh:
        fh.write("gene\tdistance\nTNF\t3.2\nIL6\t2.1\n")
    with open(os.path.join(proj, "line1_bulk", "figures", "l1_03_volcano_fdr.png"), "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n" + b"0" * 64)
    with open(os.path.join(proj, "line1_bulk", "scripts", "deg_limma"), "w", encoding="utf-8") as fh:
        fh.write("#!/bin/bash\n# 数据目录：%s/projects/PRJ_SELFTEST\n" % DATA_ROOT)

    selfcheck = {
        "checks": [
            {"id": "fs_type", "label": "文件系统", "status": "pass", "value": "ext4"},
            {"id": "storage", "label": "存储水位", "status": "pass", "value": "82% free"},
            {"id": "memory", "label": "内存水位", "status": "pass", "value": "3.2/7.5GB"},
            {"id": "isolation", "label": "跨线隔离", "status": "pass", "value": "line1 ok"},
            {"id": "link", "label": "链路连通", "status": "pass", "value": "ssh ok"},
        ],
    }
    with open(os.path.join(proj, "selfcheck.json"), "w", encoding="utf-8") as fh:
        json.dump(selfcheck, fh, ensure_ascii=False, indent=2)

    ctx = scan_project(proj)
    ctx["ledgers"] = [{
        "task_id": "task-selftest-0001",
        "line_id": "line1_bulk",
        "step_name": "deg_limma",
        "status": "completed",
        "checkpoint_status": "passed",
        "start_time": "2026-10-26T10:00:00Z",
        "end_time": "2026-10-26T10:01:00Z",
        "environment": {"language": "R", "version": "4.5.3", "random_seed": 20261026},
        "resource_usage": {"max_memory_gb": 1.2},
    }]
    check("扫描到 project.json", ctx["project_id"] == "PRJ_SELFTEST")
    check("扫描到 1 条分析线", len(ctx["lines"]) == 1)
    check("扫描到结果表", "results/deg_sig.tsv" in ctx["lines"]["line1_bulk"]["results"])

    chapters = collect_chapters(ctx)
    check("恰好七章", len(chapters) == 7, str(len(chapters)))
    titles = [t for t, _ in chapters]
    check("章节顺序符合 aims 7.2",
          titles[0].startswith("第一章") and titles[6].startswith("第七章"))

    md = render_markdown(build_meta(ctx), chapters)
    check("Markdown 含 DEG 标记", DEG_TAG in md)
    check("Markdown 含 DR 标记", DR_TAG in md)
    check("Markdown 记录真实基因数", "**2** 个差异表达基因（上调 1 / 下调 1）" in md)
    check("Markdown 含 DR 基因数", "**2** 个 DR Genes" in md)
    check("Markdown 不含未替换的服务器绝对路径", DATA_ROOT not in md)

    # ---- S11：版本表 / 引用过滤 / 清单缺失降级 ----
    # 用假清单测纯函数：不依赖本机是否部署了真实清单，跑在哪台机器结论都一样。
    fake_versions = {
        "seed": {"value": 20261013},
        "interpreters": [{"name": "R", "version": "4.5.3", "language": "R", "role": "统计",
                          "lines": ["line1_bulk", "line2_scrna"]}],
        "packages": [
            {"name": "WGCNA", "version": "1.74", "language": "R", "role": "共表达网络",
             "lines": ["line1_bulk"], "citation": "WGCNA"},
            {"name": "limma", "version": "3.68.5", "language": "R", "role": "DEG",
             "lines": ["line1_bulk"], "citation": "limma"},
            {"name": "scanpy", "version": "1.12.4", "language": "Python", "role": "单细胞",
             "lines": ["line2_scrna"], "citation": "Scanpy"},
            {"name": "seaborn", "version": "0.13.2", "language": "Python", "role": "未使用",
             "lines": [], "citation": None},
        ],
        "platform_citations": [],
    }
    fake_citations = {"entries": [
        {"key": "WGCNA", "package": "WGCNA", "title": "WGCNA: an R package",
         "authors": "Langfelder P, Horvath S", "year": 2008, "venue": "BMC Bioinformatics 9:559",
         "doi": "10.1186/1471-2105-9-559", "pdf": "04_工具包原始论文/x.pdf"},
        {"key": "limma", "package": "limma", "title": "未获取", "authors": "未获取", "year": None,
         "venue": "未获取", "doi": "未获取", "pdf": None, "evidence": "本目录无 limma 原始论文"},
        {"key": "Scanpy", "package": "Scanpy", "title": "Scanpy", "authors": "Wolf FA 等",
         "year": 2017, "venue": "bioRxiv", "doi": "10.1101/174029", "pdf": "04_工具包原始论文/y.pdf"},
    ]}
    v_rows, v_unused = version_rows(["line1_bulk"], fake_versions)
    v_names = [r[1] for r in v_rows]
    check("版本表含本线在用的 WGCNA 与 limma", "WGCNA" in v_names and "limma" in v_names,
          "、".join(v_names))
    check("版本表不混入未跑线的包", "scanpy" not in v_names, "、".join(v_names))
    check("已安装未使用的包单独列出", "seaborn" in v_unused, "、".join(v_unused))
    used_pkgs = [p for p in fake_versions["packages"]
                 if set(p.get("lines") or []) & {"line1_bulk"}]
    c_rows, c_missing, c_uncited = citation_rows(["line1_bulk"], fake_versions, fake_citations)
    check("引用条数不超过该线实际用到的包数", 0 < len(c_rows) <= len(used_pkgs),
          "%d 条 / %d 个包" % (len(c_rows), len(used_pkgs)))
    check("缺文献的包进 missing 而非拿同类论文顶替",
          [m[0] for m in c_missing] == ["limma"], str(c_missing))
    check("引用行只含确有 PDF 的条目", [r[0] for r in c_rows] == ["WGCNA"], str([r[0] for r in c_rows]))

    # 回归：DAG 里的重名步骤（enrichment_figures 在三条线都有）不能把未跑的线判成 active
    shared_ctx = {
        "project": {"pipeline_dag": [{"stepId": "enrichment_figures"}]},
        "ledgers": [{"line_id": "line1_bulk"}],
        "lines": {
            "line1_bulk": {"figures": [], "results": ["results/a.tsv"], "processed": [], "scripts": []},
            "line2_scrna": {"figures": [], "results": [], "processed": [], "scripts": []},
            "line3_spatial": {"figures": [], "results": [], "processed": [], "scripts": []},
        },
    }
    check("重名步骤不会把未跑的线判成 active",
          active_lines(shared_ctx) == ["line1_bulk"], str(active_lines(shared_ctx)))

    # 降级路径：清单缺失必须明写，不许静默跳过
    saved_env = os.environ.get("BIO_SOFTWARE_VERSIONS")
    os.environ["BIO_SOFTWARE_VERSIONS"] = os.path.join(root, "no_such_versions.json")
    try:
        degraded = render_markdown(build_meta(ctx), collect_chapters(ctx))
    finally:
        if saved_env is None:
            os.environ.pop("BIO_SOFTWARE_VERSIONS", None)
        else:
            os.environ["BIO_SOFTWARE_VERSIONS"] = saved_env
    check("版本清单缺失时给出降级文案", "版本清单缺失，方法学引用不完整" in degraded)
    check("降级时随机种子段照常输出", "### 随机种子" in degraded)
    if load_software_versions()["data"]:
        check("清单可读时输出软件与版本登记段",
              "软件与版本登记" in render_markdown(build_meta(ctx), collect_chapters(ctx)))
    else:
        print("SKIP | 本机未部署软件版本清单，跳过「清单可读」正向校验")

    page = render_html(build_meta(ctx), chapters)
    check("HTML 单文件且无外链资源",
          "<style>" in page and "<script>" in page and "http://" not in page and "https://" not in page)
    check("HTML 含七章锚点", page.count('<h2 id="ch') == 7)
    check("300 DPI 图廊已内联",
          "300 DPI 图廊" in page and "data:image/png;base64," in page and "300 DPI" in page)
    check("DEG 与 DR 标记强区分",
          "tag-deg" in page and "tag-dr" in page
          and "DEG 是组间转录本丰度消长" in page and "DR Genes 是虚拟敲除后的调控网络拓扑微扰" in page)
    check("五维自检与台账摘要已渲染",
          "五维环境自检" in page and "台账汇总" in page and "跨线隔离" in page)

    out = os.path.join(root, "deliverables")
    os.makedirs(out, exist_ok=True)
    saved_private_key = os.environ.get("BIO_ED25519_PRIVATE_KEY")
    saved_public_key = os.environ.get("BIO_ED25519_PUBLIC_KEY")
    selftest_private_key, selftest_public_key = generate_selftest_ed25519_keys(root)
    os.environ["BIO_ED25519_PRIVATE_KEY"] = selftest_private_key
    os.environ["BIO_ED25519_PUBLIC_KEY"] = selftest_public_key
    try:
        result = assemble(ctx, out)
    finally:
        if saved_private_key is None:
            os.environ.pop("BIO_ED25519_PRIVATE_KEY", None)
        else:
            os.environ["BIO_ED25519_PRIVATE_KEY"] = saved_private_key
        if saved_public_key is None:
            os.environ.pop("BIO_ED25519_PUBLIC_KEY", None)
        else:
            os.environ["BIO_ED25519_PUBLIC_KEY"] = saved_public_key
    check("三大件目录齐全",
          all(os.path.isdir(os.path.join(result["delivery_dir"], d))
              for d in ("01_Adapted_Code", "02_Figures_and_Tables", "03_Interpretation_Report")))
    check("报告 md/html 都落盘",
          os.path.isfile(result["report_md"]) and os.path.isfile(result["report_html"]))
    check("脚本绝对路径已脱敏",
          DATA_ROOT not in read_text(os.path.join(result["delivery_dir"], "01_Adapted_Code",
                                                  "line1_bulk", "deg_limma")))
    check("tar.gz 已生成且非空",
          result["tar"] and os.path.getsize(result["tar"]) > 0,
          human_bytes(os.path.getsize(result["tar"]) if result["tar"] else 0))
    signature_path = os.path.join(result["delivery_dir"], SIGNATURE_NAME)
    public_key_path = os.path.join(result["delivery_dir"], PUBLIC_KEY_NAME)
    check("签名与公钥材料落盘", result["signature"] and os.path.isfile(signature_path)
          and os.path.isfile(public_key_path))

    # ---- 包内完整性清单（m00939 边界①）----
    cks = result.get("checksums")
    check("CHECKSUMS.sha256 已生成", cks and os.path.isfile(cks), str(cks))
    if cks and os.path.isfile(cks):
        cks_lines = [l for l in read_text(cks).split("\n") if l.strip()]
        check("清单非空（至少三大件都在）", len(cks_lines) >= 3, "%d 行" % len(cks_lines))
        fmt_ok = all(re.match(r"^[0-9a-f]{64}  [^\s].+$", l) for l in cks_lines)
        check("每行形如 <64hex>+两空格+相对路径", fmt_ok)
        check("清单自身不在列内",
              all(l.split("  ", 1)[1] != CHECKSUMS_NAME for l in cks_lines))
        check("清单按路径排序（便于 diff）",
              [l.split("  ", 1)[1] for l in cks_lines]
              == sorted(l.split("  ", 1)[1] for l in cks_lines))
        ok = True
        for line in cks_lines:
            digest, rel = line.split("  ", 1)
            full = os.path.join(result["delivery_dir"], rel)
            if not os.path.isfile(full):
                ok = False
                break
            with open(full, "rb") as _fh:
                if hashlib.sha256(_fh.read()).hexdigest() != digest:
                    ok = False
                    break
        check("hashlib 逐文件复算全部一致（sha256sum -c 同口径）", ok)

    # 空项目：不得崩、不得编数字
    empty = os.path.join(root, "PRJ_EMPTY")
    os.makedirs(empty)
    with open(os.path.join(empty, "project.json"), "w", encoding="utf-8") as fh:
        json.dump({"project_id": "PRJ_EMPTY", "basic_info": {"name": "空项目"}}, fh)
    empty_ctx = scan_project(empty)
    empty_chapters = collect_chapters(empty_ctx)
    empty_md = render_markdown(build_meta(empty_ctx), empty_chapters)
    check("空项目不崩且七章齐全", len(empty_chapters) == 7)
    check("空项目明确标注未找到", "未找到" in empty_md)

    # 母版脚本把统计表写在 processed/（不是 results/）：结果表与结论都必须照常产出
    proc = os.path.join(root, "PRJ_PROCESSED_ONLY")
    os.makedirs(os.path.join(proc, "line1_bulk", "processed"))
    with open(os.path.join(proc, "project.json"), "w", encoding="utf-8") as fh:
        json.dump({
            "project_id": "PRJ_PROCESSED_ONLY",
            "basic_info": {"name": "processed-only"},
            "pipeline_dag": [{"order": 1, "stepId": "deg_limma"}],
        }, fh, ensure_ascii=False)
    with open(os.path.join(proc, "line1_bulk", "processed", "deg_all.tsv"), "w", encoding="utf-8") as fh:
        fh.write("gene\tlogFC\tP.Value\tadj.P.Val\n")
        fh.write("IL17A\t2.5\t0.001\t0.01\n")
        fh.write("S100A8\t-1.8\t0.002\t0.02\n")
    with open(os.path.join(proc, "line1_bulk", "processed", "expr_genes.tsv"), "w", encoding="utf-8") as fh:
        fh.write("gene\tS1\nIL17A\t1\n")
    with open(os.path.join(proc, "line1_bulk", "processed", "checkpoint.rds"), "wb") as fh:
        fh.write(b"RDS")
    proc_ctx = scan_project(proc)
    proc_tables = proc_ctx["lines"]["line1_bulk"]["tables"]
    check("processed 中的表格计入交付表",
          "processed/deg_all.tsv" in proc_tables and "processed/expr_genes.tsv" in proc_tables)
    check("检查点不混进交付表", "processed/checkpoint.rds" not in proc_tables)
    proc_md = render_markdown(build_meta(proc_ctx), collect_chapters(proc_ctx))
    check("processed-only 项目仍给出 DEG 结论", "**2** 个差异表达基因" in proc_md)
    proc_out = os.path.join(root, "deliverables_proc")
    os.makedirs(proc_out, exist_ok=True)
    os.environ["BIO_ED25519_PRIVATE_KEY"] = selftest_private_key
    os.environ["BIO_ED25519_PUBLIC_KEY"] = selftest_public_key
    try:
        proc_result = assemble(proc_ctx, proc_out, no_tar=True)
    finally:
        if saved_private_key is None:
            os.environ.pop("BIO_ED25519_PRIVATE_KEY", None)
        else:
            os.environ["BIO_ED25519_PRIVATE_KEY"] = saved_private_key
        if saved_public_key is None:
            os.environ.pop("BIO_ED25519_PUBLIC_KEY", None)
        else:
            os.environ["BIO_ED25519_PUBLIC_KEY"] = saved_public_key
    check("processed-only 项目结果表进第二大件", proc_result["counts"]["tables"] >= 2,
          str(proc_result["counts"]))

    shutil.rmtree(root, ignore_errors=True)
    print("\n%s" % ("全部符合预期" if failed == 0 else "%d 条不符合预期" % failed))
    return 0 if failed == 0 else 1


def main(argv=None):
    ap = argparse.ArgumentParser(description="客户交付包七章解读报告组装与打包")
    ap.add_argument("--project", help="项目目录（含 project.json）")
    ap.add_argument("--out", help="输出目录，默认 <project>/deliverables")
    ap.add_argument("--no-tar", action="store_true", help="只生成三大件，不打包 tar.gz")
    ap.add_argument("--dry-run", action="store_true", help="只打印将要生成的内容，不写盘")
    ap.add_argument("--self-test", action="store_true", help="用内置样例自检七章渲染与打包")
    args = ap.parse_args(argv)

    if args.self_test:
        return self_test()
    if not args.project:
        ap.error("需要 --project（或用 --self-test）")
    if not os.path.isdir(args.project):
        sys.stderr.write("项目目录不存在: %s\n" % args.project)
        return 1
    if not os.path.isfile(os.path.join(args.project, "project.json")):
        sys.stderr.write("项目目录缺少 project.json: %s\n" % args.project)
        return 1

    ctx = scan_project(args.project)
    if args.dry_run:
        meta = build_meta(ctx)
        print("项目：%s（%s）" % (meta["project_id"], meta["project_name"]))
        for line, entry in ctx["lines"].items():
            print("  %s：图 %d / 表 %d / 脚本 %d"
                  % (line, len(entry["figures"]), len(entry.get("tables", entry["results"])),
                     len(entry["scripts"])))
        print("  台账：%d 条" % len(ctx["ledgers"]))
        chapters = collect_chapters(ctx)
        for title, blocks in chapters:
            print("  - %s（%d 个内容块）" % (title, len(blocks)))
        return 0

    out = args.out or os.path.join(args.project, "deliverables")
    try:
        os.makedirs(out, exist_ok=True)
        result = assemble(ctx, out, no_tar=args.no_tar)
    except OSError as cause:
        sys.stderr.write("写盘失败: %s\n" % cause)
        return 2

    print("交付目录：%s" % result["delivery_dir"])
    print("  报告：%s" % os.path.basename(result["report_md"]))
    print("  校验清单：%s（%d 个文件，sha256sum -c 可复核）"
          % (CHECKSUMS_NAME, result.get("checksums_count", 0)))
    if result.get("signature"):
        print("  签名：CHECKSUMS.sig（64 字节，客户端公钥验签）")
    print("  图件 %d / 结果表 %d / 脚本 %d"
          % (result["counts"]["figures"], result["counts"]["tables"], result["counts"]["scripts"]))
    if result["tar"]:
        print("  打包：%s（%s）" % (os.path.basename(result["tar"]),
                                   human_bytes(os.path.getsize(result["tar"]))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
