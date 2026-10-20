# GSE277173 银屑病皮损非皮损 Bulk 真实数据验证 · 客户交付解读报告

> 项目 ID：`PRJ_E2E_GSE277173`　生成时间：2026-10-19 02:46:21　报告版本：1.0
> 本报告由 `ops/build_client_report.py` 依据项目实际产物自动生成。所有统计量均读自磁盘文件；缺失处明确标注，不做推测填充。

## 目录
1. [第一章：执行摘要与核心科学发现 (Executive Summary)](#第一章-执行摘要与核心科学发现-Executive-Summary)
2. [第二章：材料与方法学标准段落 (Materials & Methods)](#第二章-材料与方法学标准段落-Materials-Methods)
3. [第三章：分步分析结果与三段式深度解读 (Step-by-Step Results)](#第三章-分步分析结果与三段式深度解读-Step-by-Step-Results)
4. [第四章：虚拟敲除（Virtual KO）专项机制辨析](#第四章-虚拟敲除-Virtual-KO-专项机制辨析)
5. [第五章：推荐后续湿实验验证路线图 (Wet-Lab Validation Roadmap)](#第五章-推荐后续湿实验验证路线图-Wet-Lab-Validation-Roadmap)
6. [第六章：交付物文件索引字典 (Deliverables Manifest Dictionary)](#第六章-交付物文件索引字典-Deliverables-Manifest-Dictionary)
7. [第七章：可复现性台账与质控审计摘要 (Reproducibility & Audit Ledger)](#第七章-可复现性台账与质控审计摘要-Reproducibility-Audit-Ledger)

## 第一章：执行摘要与核心科学发现 (Executive Summary)

| 字段 | 内容 |
|---|---|
| 项目名称 | GSE277173 银屑病皮损非皮损 Bulk 真实数据验证 |
| 疾病 | Psoriasis |
| 物种 | Homo sapiens |
| 研究领域 | 皮肤与免疫外炎症 |
| 数据来源模式 | PUBLIC_DB |
| 分组设计 | 2 组 · 配对 / 同供体 |

**队列与分期设计**：未命名（基准对照，8 例）；未命名（疾病/实验组，8 例）

- 线 1 · GEO Bulk 转录组 未检出达到阈值的差异表达基因（全表 20019 个基因）；变化幅度最大的为 ACTC1（log2FC=-1.98）、TM4SF19（log2FC=1.77）、SPP1（log2FC=1.71）。这是真实结果，阈值未随结果放宽。

**客户重点关注基因的全流程表现**（按结果表中是否出现统计，不代表显著性）：

| 关注基因 | 命中文件数 | 出现位置（前 4 项） |
|---|---|---|
| IL17A | 3 | line1_bulk/deg_all.tsv、line1_bulk/expr_genes.tsv、line1_bulk/wgcna_modules.tsv |
| S100A8 | 3 | line1_bulk/deg_all.tsv、line1_bulk/expr_genes.tsv、line1_bulk/wgcna_modules.tsv |
| S100A9 | 3 | line1_bulk/deg_all.tsv、line1_bulk/expr_genes.tsv、line1_bulk/wgcna_modules.tsv |

## 第二章：材料与方法学标准段落 (Materials & Methods)

| 字段 | 内容 |
|---|---|
| 统计阈值档 | standard_sci |
| log2FC 阈值 | 1 |
| 校正 p 值阈值 | 0.05 |
| 名义 p 值阈值 | 0.05 |
| 线粒体百分比上限 | 15% |
| 随机种子 | 20261013 |
| 出图模板 | template_2_cell_wide |
| 出图分辨率 | 300 DPI |
| 统计模型 | 配对 / 同供体线性模型 |

**软件环境**：R 4.3.3

### English Methods Paragraph（可直接粘贴进论文）

```
Differential expression analysis was performed with limma using an empirical Bayes moderated t-statistic. Genes were considered differentially expressed at |log2 fold change| > 1 and adjusted P < 0.05. Co-expression network construction, functional enrichment (GO/KEGG), and machine learning classification were carried out as described in the corresponding sections. All analyses used fixed random seed 20261013 to ensure reproducibility.
```

**配对设计说明**：项目声明为自身配对 / 同供体设计，下游统计模型已改用配对结构（`pair_map` 共 16 条映射）。

## 第三章：分步分析结果与三段式深度解读 (Step-by-Step Results)

### 步骤 1 · GEO 数据获取与探针注释

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：已找到产物：`processed/expr_genes.tsv`、`processed/group_map.tsv`；任务 `bc4df93e`，状态 `completed`，语言 R 4.3.3

**③ 方法学与生物学限制**：探针注释质量取决于 GPL 版本；跨平台合并需另行批次校正，本步骤不做

```
Figure legend: Probe-to-symbol collapse and expression matrix assembly.
```

### 步骤 2 · 样本质控

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：已找到产物：`processed/qc_report.txt`；任务 `f82022ac`，状态 `completed`，语言 R 4.3.3

**③ 方法学与生物学限制**：离群判定为描述性统计，未做正式离群检验；是否剔除需结合实验记录人工判断

```
Figure legend: Sample-level quality control: detected gene counts and within-group correlation.
```

### 步骤 3 · PCA 与样本相关性

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：已找到产物：`processed/pca_scores.tsv`、`figures/l1_02_pca.png`、`figures/l1_02_pca_step3.png`；任务 `0364dc55`，状态 `completed`，语言 R 4.3.3

**③ 方法学与生物学限制**：PCA 只反映转录组整体差异，不能替代分组设计的合理性论证

```
Figure legend: Principal component analysis of variance-stabilized expression.
```

### 步骤 4 · 差异表达分析 (DEG)

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：未检出达到阈值的差异表达基因（全表 20019 个基因）；变化幅度最大的为 ACTC1（log2FC=-1.98）、TM4SF19（log2FC=1.77）、SPP1（log2FC=1.71）。

**② 数据与统计依据**：已找到产物：`processed/deg_all.tsv`、`processed/deg_sig.tsv`、`figures/l1_03_volcano_fdr.png`、`figures/l1_03_volcano_limma.png`；任务 `73f1e2ab`，状态 `completed`，语言 R 4.3.3

**③ 方法学与生物学限制**：DEG 反映的是转录本丰度差异，不等于功能因果；样本量小时统计功效有限

```
Figure legend: Volcano plot of differentially expressed genes (limma, empirical Bayes).
```

### 步骤 5 · WGCNA 共表达模块

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：已找到产物：`processed/wgcna_modules.tsv`、`processed/wgcna_module_trait.tsv`、`figures/l1_28_wgcna_softpower.png`、`figures/l1_29_wgcna_module_trait.png`；任务 `8c58ec6e`，状态 `completed`，语言 R 4.3.3

**③ 方法学与生物学限制**：模块划分对 soft-threshold 与最小模块大小敏感；样本量 <15 时网络稳定性差

```
Figure legend: Weighted gene co-expression network modules and module-trait relationships.
```

### 步骤 6 · 功能富集 (GO/KEGG/GSEA)

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：已找到产物：`processed/enrichment_gsea_go.tsv`、`processed/enrichment_gsea_kegg.tsv`、`processed/enrichment_kegg.tsv`；任务 `07adf243`，状态 `completed`，语言 R 4.3.3

**③ 方法学与生物学限制**：富集结果依赖注释库版本与背景基因集选择，不代表通路活性被直接测量

```
Figure legend: Functional enrichment analysis (GO/KEGG) of differentially expressed genes.
```

### 步骤 7 · 富集出图

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：已找到产物：`figures/l1_13_gsea_top.png`；任务 `6758204f`，状态 `completed`，语言 R 4.3.3

**③ 方法学与生物学限制**：条形图只展示 top 条目，完整结果见对应 .tsv

```
Figure legend: Top enriched terms across GO and KEGG categories.
```

### 步骤 8 · PPI 网络 + Hub 初筛

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：已找到产物：`processed/ppi_edges.tsv`、`processed/ppi_hubs.tsv`；任务 `1747c8c2`，状态 `completed`，语言 R 4.3.3

**③ 方法学与生物学限制**：STRING 证据来自文本挖掘与实验汇总，存在假阳性；hub 不等于因果驱动基因

```
Figure legend: Protein-protein interaction network and hub gene screening (STRING).
```

### 步骤 9 · 交集关键基因

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：已找到产物：`processed/key_genes.tsv`；任务 `aa112fc9`，状态 `completed`，语言 R 4.3.3

**③ 方法学与生物学限制**：交集筛选会放大假阴性；DEG 判据放宽时需在报告中如实标注

```
Figure legend: Intersection of DEG, co-expression modules and PPI hubs.
```

### 步骤 10 · Hub 基因 ML 精筛 + 重要性评估

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：已找到产物：`processed/ml_core_hub_genes.tsv`、`processed/ml_importance.tsv`、`figures/l1_22_shap.png`；任务 `b289bd11`，状态 `completed`，语言 R 4.3.3

**③ 方法学与生物学限制**：SHAP 解释的是模型行为而非生物学机制；特征间强相关时归因会分散

```
Figure legend: SHAP summary plot for hub gene contributions.
```

### 步骤 11 · Bulk 出图

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：已找到产物：`figures/l1_01_correlation.png`；任务 `89fdcd75`，状态 `completed`，语言 R 4.3.3

**③ 方法学与生物学限制**：图件为结果呈现，不改变统计结论

```
Figure legend: Overview of sample-level and gene-level expression patterns.
```

## 第四章：虚拟敲除（Virtual KO）专项机制辨析

本项目未勾选虚拟敲除步骤，本章不适用。

## 第五章：推荐后续湿实验验证路线图 (Wet-Lab Validation Roadmap)

**优先候选基因**：IL17A、S100A8、S100A9、ACTC1、TM4SF19、SPP1、ACTG2、MUCL1

| 实验 | 目的 | 建议设计 |
|---|---|---|
| RT-qPCR | 验证转录本丰度差异 | 每组 ≥6 例生物学重复，内参双基因归一化 |
| Western blot | 验证蛋白层面变化 | 选择特异性抗体，至少两个独立批次 |
| 多重免疫荧光 | 空间共定位验证 | 在组织切片上共染目标蛋白与细胞类型 marker |
| 敲低 / 过表达 + 救援实验 | 建立因果链 | siRNA/shRNA 敲低后回补，观察表型是否可逆 |
| 功能实验 | 细胞水平表型 | 迁移 / 增殖 / 炎症因子释放等，按疾病背景选择 |

**说明**：以上为基于计算结果的验证建议，不构成实验方案；抗体选择、样本量与伦理审批需由实验方另行确定。

## 第六章：交付物文件索引字典 (Deliverables Manifest Dictionary)

| 分析线 | 类别 | 文件 | 说明 |
|---|---|---|---|
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_01_correlation.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_02_pca.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_02_pca_step3.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_03_volcano_fdr.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_03_volcano_limma.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_03_volcano_nominal.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_04_topvar_heatmap.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_05a_genes_detected.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_05b_within_group_cor.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_06_ma_fdr.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_06_ma_nominal.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_07_ppi_network.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_08_ppi_hubs.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_09_key_genes.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_13_gsea_top.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_14_module_ora_top.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_15_kegg_top.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_16_lasso_path.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_17_lasso_cv.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_18_rfe_curve.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_19_univariate.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_20_hub_overlap.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_21_importance.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_22_shap.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_23_cluster_heatmap.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_24_corr_network.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_25_kegg_gsea_top.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_26_shap_waterfall.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_28_wgcna_softpower.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_29_wgcna_module_trait.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/deg_all.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/deg_report.txt` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/deg_sig.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/enrichment_gsea_go.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/enrichment_gsea_kegg.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/enrichment_kegg.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/enrichment_module_ora.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/enrichment_report.txt` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/expr_genes.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/group_map.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/key_genes.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/key_genes_report.txt` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/ml_cluster_samples.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/ml_core_hub_genes.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/ml_corr_network.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/ml_hub_report.txt` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/ml_importance.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/ml_lasso_cv.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/ml_lasso_genes.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/ml_lasso_path.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/ml_lasso_summary.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/ml_rfe_curve.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/ml_rfe_genes.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/ml_shap.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/ml_univariate.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/pca_report.txt` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/pca_scores.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/ppi_edges.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/ppi_hubs.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/ppi_report.txt` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/prep_report.txt` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/qc_report.txt` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/sample_qc.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/wgcna_module_trait.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/wgcna_modules.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/wgcna_report.txt` | 该步骤的明细统计结果 |

### 关键结果表字段说明

| 文件 | 关键字段 | 含义 |
|---|---|---|
| `deg_all.tsv` / `deg_sig.tsv` | gene / logFC / P.Value / adj.P.Val | 基因名、log2 倍数变化、原始 p、校正 p |
| `ko_dr_genes.tsv` | gene / distance | DR 基因名、网络扰动距离（越大越显著） |
| `celltype_scores.tsv` | spot / celltype / score | spot 编号、细胞类型、NNLS 解卷积权重 |
| `external_validation_preds.tsv` | sample / prob / label | 样本、预测概率、真实标签 |

## 第七章：可复现性台账与质控审计摘要 (Reproducibility & Audit Ledger)

**台账汇总**：共 19 条任务，累计耗时约 30.2 分钟，单步内存峰值 0.0 GB。

| task_id | 分析线 | 步骤 | 状态 | 检查点 | 耗时 | 内存峰值 | seed |
|---|---|---|---|---|---|---|---|
| bc4df93e | line1_bulk | prep_matrix | completed | passed | 4 s | — | 20261013 |
| f82022ac | line1_bulk | qc_matrix | completed | passed | 3 s | — | 20261013 |
| d6f93df6 | line1_bulk | pca_matrix | completed | passed | 3 s | — | 20261013 |
| 3e3bead8 | line1_bulk | deg_limma | completed | passed | 4 s | — | 20261013 |
| 11a1aac7 | line1_bulk | wgcna_modules | completed | passed | 344 s | — | 20261013 |
| 07adf243 | line1_bulk | enrichment_bulk | completed | passed | 263 s | — | 20261013 |
| 6758204f | line1_bulk | enrichment_figures | completed | passed | 6 s | — | 20261013 |
| 1747c8c2 | line1_bulk | ppi_string | completed | passed | 7 s | — | 20261013 |
| aa112fc9 | line1_bulk | key_genes | completed | passed | 3 s | — | 20261013 |
| b289bd11 | line1_bulk | ml_hub_analysis | completed | passed | 31 s | — | 20261013 |
| 89fdcd75 | line1_bulk | bulk_figures | completed | passed | 7 s | — | 20261013 |
| 9848eaa7 | line1_bulk | pca_matrix | failed | failed | 4 s | — | 20261013 |
| d8ad3183 | line1_bulk | pca_matrix | completed | passed | 3 s | — | 20261013 |
| 3b09b8b0 | line1_bulk | deg_limma | completed | passed | 4 s | — | 20261013 |
| 5c068a8b | line1_bulk | wgcna_modules | completed | passed | 347 s | — | 20261013 |
| 0364dc55 | line1_bulk | pca_matrix | completed | passed | 4 s | — | 20261013 |
| 73f1e2ab | line1_bulk | deg_limma | completed | passed | 6 s | — | 20261013 |
| 4918da0c | line1_bulk | wgcna_modules | completed | passed | 375 s | — | 20261013 |
| 8c58ec6e | line1_bulk | wgcna_modules | completed | passed | 394 s | — | 20261013 |

### 五维环境自检

自检项与工作台 `/api/selfcheck` 同口径。**本报告不代替自检结果**：如项目目录下存在 `selfcheck.json`，其内容会一并收录；否则请在交付前运行一次自检。

未找到 `selfcheck.json`，五维自检结论缺失。

---

本报告不含任何推测数值。若某章节标注「未找到」，表示对应产物尚未落盘，请补齐后重新生成本报告。
