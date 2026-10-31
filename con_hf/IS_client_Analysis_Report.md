# 缺血性卒中乳酸化相关基因筛选与生物标志物鉴定 · 客户交付解读报告

> 项目 ID：`PRJ_20261019_IS_lactylation`　生成时间：2026-10-20 06:49:01　报告版本：1.0
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
| 项目名称 | 缺血性卒中乳酸化相关基因筛选与生物标志物鉴定 |
| 疾病 | Ischemic Stroke |
| 物种 | Homo sapiens |
| 研究领域 | 心脑血管 |
| 数据来源模式 | PUBLIC_DB |
| 分组设计 | 2 组 · 非配对 |

**队列与分期设计**：未命名（基准对照，43 例）；未命名（疾病/实验组，89 例）

- 线 1 · GEO Bulk 转录组 共检出 **12** 个差异表达基因（上调 9 / 下调 3），log2FC 绝对值最大的包括 OLAH、LOC105377458、POM121L9P、MCEMP1、LOC100996760。

## 第二章：材料与方法学标准段落 (Materials & Methods)

| 字段 | 内容 |
|---|---|
| 统计阈值档 | standard_sci |
| log2FC 阈值 | 1.0 |
| 校正 p 值阈值 | 0.05 |
| 名义 p 值阈值 | 0.05 |
| 线粒体百分比上限 | 15% |
| 随机种子 | 20261013 |
| 出图模板 | template_1_nature_side |
| 出图分辨率 | 300 DPI |
| 统计模型 | 独立样本线性模型 |

**软件环境**：任务台账未记录软件版本，请从第七章台账补录后再引用本段

### 软件与版本登记（算力容器实测）

| 语言 | 包 / 解释器 | 版本 | 用途 |
|---|---|---|---|
| R | R | 4.3.3 | 统计建模、富集分析与图件（线 1 步骤 1-4；线 2 富集/LASSO 桥接） |
| python3 | python3 | 3.12.3 | 机器学习、单细胞/空间分析与图件（线 1 步骤 5-8；线 2/线 3 主体） |
| R | WGCNA | 1.74 | 加权共表达网络构建、动态剪切树划分模块、模块-性状关联（wgcna_modules） |
| R | limma | 3.58.1 | DEG 线性模型 + 经验贝叶斯收缩（deg_limma） |
| R | ggplot2 | 4.0.3 | 线 1 全部 l1_* 图件绘制 |
| R | clusterProfiler | 4.10.1 | GO BP/CC/MF 与 KEGG 的 ORA / GSEA（enrichment_bulk） |
| R | data.table | 1.14.10 | 大表读写与分组聚合 |
| R | glmnet | 4.1.8 | LASSO 特征筛选（ml_model） |
| R | survival | 3.5.8 | Cox 比例风险模型（cox_analysis） |
| R | org.Hs.eg.db | 3.18.0 | Gene Symbol → Entrez ID 注释（富集分析入参） |
| R | matrixStats | 1.2.0 | 矩阵行列统计（QC 与网络构建） |
| R | GSVA | 1.50.5 | GSVA 通路活性评分（gsva_pathways） |
| R | GSEABase | 1.64.0 | GSVA 输入基因集封装 |
| Python | scanpy | 1.12.4 | 单细胞/空间预处理、HVG、PCA、邻居图、聚类、UMAP、DEG、DPT 拟时序 |
| Python | anndata | 0.13.4 | AnnData 容器与 h5ad 读写 |
| Python | pandas | 2.3.3 | 结果表读写与整形 |
| Python | numpy | 2.5.3 | 数值计算与稀疏矩阵 |
| Python | scipy | 1.18.1 | 稀疏矩阵运算、统计检验、置换检验、NNLS |
| Python | scikit-learn | 1.9.1 | 机器学习模型、PCA/降维、交叉验证与 AUC |
| Python | matplotlib | 3.11.2 | 三线全部图件绘制 |
| Python | networkx | 3.7 | PPI / 共表达网络拓扑与枢纽基因打分 |
| Python | statsmodels | 0.15.0 | 统计模型与多重检验校正 |
| Python | harmonypy | 2.0.2 | 批次整合 Harmony（integrate_harmony） |
| Python | liana | 1.10.0 | 细胞间通讯 consensus 资源 + rank_aggregate（cell_communication / spatial_communication） |
| Python | pyscenic | 0.12.1 | SCENIC 转录因子活性推断（scenic_tf） |
| Python | arboreto | 0.1.6 | SCENIC GRN 推断后端（pyscenic 依赖） |
| Python | gseapy | 1.3.1 | Python 侧 GSEA / 富集（enrichment） |
| Python | scTenifold | 0.5.1 | 虚拟敲除 scTenifoldKnk 网络扰动（virtual_knockout / spatial_knockout） |
| Python | shap | 0.53.0 | SHAP 模型可解释性（ml_hub_analysis） |
| Python | h5py | 3.16.0 | HDF5/h5ad 底层直读（spatial ingest） |
| Python | Pillow | 12.3.0 | 空间图件/图像读取 |
| Python | adjustText | 1.4.0 | 图件标签避让 |

版本号由 `cn_debug/2026-10-19_s11_collect_versions.py` 在算力容器内实采（只读 `packageVersion()` / `import`，未安装、未升级任何包）；清单文件：`/data/data/com.termux/files/home/software_versions.json`。表内只列本项目实际跑过的线（line1_bulk、line2_scrna、line3_spatial）用到的软件。

清单中以下包已安装但**未进入本项目流程**（步骤脚本未 import / library），不计入本表、也不作为引用：Seurat、pheatmap、ComplexHeatmap、pROC、seaborn、squidpy。

### 随机种子

| 字段 | 内容 |
|---|---|
| 契约种子（aims 铁律#3） | 20261013 |
| 台账实际记录 | 20261013 |
| 一致性 | 一致 |
| 注入方式 | 任务引擎以环境变量 `BIOANALYS_SEED` 注入每条任务（`BioanalysDesktop/server/task.js`） |

### 方法学引用（原始论文）

| 包 / 方法 | 用于分析线 | 文献 | 作者 | 出处 · 年份 | DOI |
|---|---|---|---|---|---|
| WGCNA | line1_bulk | WGCNA: an R package for weighted correlation network analysis | Langfelder P, Horvath S | BMC Bioinformatics 9:559 · 2008 | 10.1186/1471-2105-9-559 |
| scanpy | line2_scrna、line3_spatial | Scanpy for analysis of large-scale single-cell gene expression data | Wolf FA, Angerer P, Theis FJ | bioRxiv preprint（August 9, 2017） · 2017 | 10.1101/174029 |
| harmonypy | line2_scrna | Package 'harmony' : Fast, Sensitive, and Accurate Integration of Single Cell Data | Patikas N, Yao H, Korsunsky I, Hemberg M, Millard N, Fan J, Slowikowski K 等（PDF 首页作者列表被截断） | R 包手册，Version 2.0.5，构建日期 June 13, 2026 · 2026 | 未获取 |
| （平台）Bioconductor | line1_bulk、line2_scrna | Bioconductor: open software development for computational biology and bioinformatics | Gentleman RC, Carey VJ, Bates DM, Bolstad B, Dettling M, Dudoit S, Ellis B, Gautier L, Ge Y, Gentry J, Hornik K, Hothorn T, Huber W, Iacus S, Irizarry R, Leisch F, Li C, Maechler M, Rossini AJ, Sawitzki G, Smith C, Smyth G, Tierney L, Yang JYH 等（PDF 首页作者列表在此处截断，其后作者未获取） | Genome Biology 5(10):R80 · 2004 | 10.1186/gb-2004-5-10-r80 |

引用取自文献索引 `{{DATA_ROOT}}/reference_citations.json`（人读视图 `reference/生信分析可用参考文献/INDEX.md`）。只列本项目实际跑过的线用到的软件；未使用的文献不列入，避免「文献很多」被读成「已引用」。

**以下软件在用、但本目录无其原始论文，故未引用**（不拿同类方法的论文顶替）：limma（本目录 04 类 18 个 PDF 中无 limma 原始论文；`工具包_*_2014__Moderated_estimation_of_fold_change_and_dispersion...` 经首页文字层确认是 DESeq2（Love/Huber/Anders），不是 limma。故 limma 只有版本号、无本地文献可引）。

以下包在用但无单篇方法学论文可引（基础库 / 绘图库 / 注释库），未列入引用：ggplot2、clusterProfiler、data.table、glmnet、survival、org.Hs.eg.db、matrixStats、GSVA、GSEABase、anndata 等 26 个。

### English Methods Paragraph（可直接粘贴进论文）

```
Differential expression analysis was performed with limma using an empirical Bayes moderated t-statistic. Genes were considered differentially expressed at |log2 fold change| > 1.0 and adjusted P < 0.05. Co-expression network construction, functional enrichment (GO/KEGG), and machine learning classification were carried out as described in the corresponding sections. All analyses used fixed random seed 20261013 to ensure reproducibility.
```

**协变量校正**：批次列 `dataset`，校正变量 age、sex。

## 第三章：分步分析结果与三段式深度解读 (Step-by-Step Results)

### 步骤 1 · GEO 数据获取与探针注释

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：已找到产物：`processed/expr_genes.tsv`、`processed/group_map.tsv`；任务 `is_l1_pr`，状态 `completed`，语言 bash

**③ 方法学与生物学限制**：探针注释质量取决于 GPL 版本；跨平台合并需另行批次校正，本步骤不做

```
Figure legend: Probe-to-symbol collapse and expression matrix assembly.
```

### 步骤 2 · merge_combat

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：任务 `is_l1_me`，状态 `completed`，语言 bash

**③ 方法学与生物学限制**：该步骤未登记限制说明，引用前请人工复核方法学前提。

### 步骤 3 · 差异表达分析 (DEG)

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：检出 12 个差异表达基因（上调 9 / 下调 3），log2FC 绝对值最大的为 OLAH、LOC105377458、POM121L9P、MCEMP1、LOC100996760。

**② 数据与统计依据**：已找到产物：`processed/deg_all.tsv`、`processed/deg_sig.tsv`、`figures/l1_03_volcano_fdr.png`、`figures/l1_03_volcano_limma.png`；任务 `is_l1_de`，状态 `completed`，语言 bash

**③ 方法学与生物学限制**：DEG 反映的是转录本丰度差异，不等于功能因果；样本量小时统计功效有限

```
Figure legend: Volcano plot of differentially expressed genes (limma, empirical Bayes).
```

### 步骤 4 · lrg_deg

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：任务 `is_l1_lr`，状态 `completed`，语言 bash

**③ 方法学与生物学限制**：该步骤未登记限制说明，引用前请人工复核方法学前提。

### 步骤 5 · ml_hub_lrg

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：任务 `is_l1_ml`，状态 `completed`，语言 bash

**③ 方法学与生物学限制**：该步骤未登记限制说明，引用前请人工复核方法学前提。

### 步骤 6 · ingest_10x

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：任务 `is_l2_in`，状态 `completed`，语言 python3

**③ 方法学与生物学限制**：该步骤未登记限制说明，引用前请人工复核方法学前提。

### 步骤 7 · 细胞质控

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：已找到产物：`results/qc_cell_metrics.tsv`、`results/qc_report.txt`；未找到：`results/scrna_qc.h5ad`；任务 `is_l2_qc`，状态 `completed`，语言 python3

**③ 方法学与生物学限制**：阈值按项目配置固定，极端组织（如心肌、肝）可能需要放宽线粒体阈值

```
Figure legend: Cell-level quality control metrics before and after filtering.
```

### 步骤 8 · 细胞类型注释

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：已找到产物：`results/cluster_markers.tsv`、`results/annotate_report.txt`；未找到：`results/scrna_annotated.h5ad`；任务 `is_l2_an`，状态 `completed`，语言 python3

**③ 方法学与生物学限制**：注释依赖 marker 库覆盖度；稀有细胞类型与过渡态细胞可能被误判

```
Figure legend: Cell type annotation based on canonical marker expression.
```

### 步骤 9 · normalize_integrate

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：任务 `is_l2_no`，状态 `completed`，语言 python3

**③ 方法学与生物学限制**：该步骤未登记限制说明，引用前请人工复核方法学前提。

### 步骤 10 · lr_score_final

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：任务 `is_l2_lr`，状态 `completed`，语言 python3

**③ 方法学与生物学限制**：该步骤未登记限制说明，引用前请人工复核方法学前提。

### 步骤 11 · metacells_l2

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：任务 `is_l2_me`，状态 `completed`，语言 python3

**③ 方法学与生物学限制**：该步骤未登记限制说明，引用前请人工复核方法学前提。

### 步骤 12 · wgcna_l2

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：任务 `is_l2_wg`，状态 `completed`，语言 Rscript

**③ 方法学与生物学限制**：该步骤未登记限制说明，引用前请人工复核方法学前提。

### 步骤 13 · candidates_l2

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：任务 `is_l2_ca`，状态 `completed`，语言 python3

**③ 方法学与生物学限制**：该步骤未登记限制说明，引用前请人工复核方法学前提。

### 步骤 14 · lhs_subset_export

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：任务 `is_l2_su`，状态 `completed`，语言 python3

**③ 方法学与生物学限制**：该步骤未登记限制说明，引用前请人工复核方法学前提。

### 步骤 15 · monocle2_lhs

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：任务 `is_l2_mo`，状态 `completed`，语言 Rscript

**③ 方法学与生物学限制**：该步骤未登记限制说明，引用前请人工复核方法学前提。

### 步骤 16 · ingest_visium

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：任务 `is_l3_in`，状态 `completed`，语言 python3

**③ 方法学与生物学限制**：该步骤未登记限制说明，引用前请人工复核方法学前提。

### 步骤 17 · spatial_qc_norm

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：任务 `is_l3_qc`，状态 `completed`，语言 python3

**③ 方法学与生物学限制**：该步骤未登记限制说明，引用前请人工复核方法学前提。

### 步骤 18 · spatial_lr_score

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：任务 `is_l3_sc`，状态 `completed`，语言 python3

**③ 方法学与生物学限制**：该步骤未登记限制说明，引用前请人工复核方法学前提。

### 步骤 19 · spatial_target_genes

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：任务 `is_l3_ta`，状态 `completed`，语言 python3

**③ 方法学与生物学限制**：该步骤未登记限制说明，引用前请人工复核方法学前提。

### 步骤 20 · make_merged_candidates

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：任务 `is_l1_mk`，状态 `completed`，语言 python3

**③ 方法学与生物学限制**：该步骤未登记限制说明，引用前请人工复核方法学前提。

### 步骤 21 · enrich_line1

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：任务 `is_l1_en`，状态 `completed`，语言 Rscript

**③ 方法学与生物学限制**：该步骤未登记限制说明，引用前请人工复核方法学前提。

### 步骤 22 · spatial_regions

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：任务 `is_l3_re`，状态 `completed`，语言 python3

**③ 方法学与生物学限制**：该步骤未登记限制说明，引用前请人工复核方法学前提。

### 步骤 23 · liana_comm

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：任务 `is_l2_co`，状态 `completed`，语言 python3

**③ 方法学与生物学限制**：该步骤未登记限制说明，引用前请人工复核方法学前提。

### 步骤 24 · immune_ssgsea

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：任务 `is_l1_im`，状态 `completed`，语言 python3

**③ 方法学与生物学限制**：该步骤未登记限制说明，引用前请人工复核方法学前提。

### 步骤 25 · l1_lrg_heatmap_spec

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：任务 `is_l1_lr`，状态 `completed`，语言 bash

**③ 方法学与生物学限制**：该步骤未登记限制说明，引用前请人工复核方法学前提。

### 步骤 26 · l3_figures_spec

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：任务 `is_l3_fi`，状态 `completed`，语言 bash

**③ 方法学与生物学限制**：该步骤未登记限制说明，引用前请人工复核方法学前提。

### 步骤 27 · l1_ml_figures_spec

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：任务 `is_l1_ml`，状态 `completed`，语言 bash

**③ 方法学与生物学限制**：该步骤未登记限制说明，引用前请人工复核方法学前提。

### 步骤 28 · l2_figures_spec

**标记**：`[DEG · 转录本丰度消长]`

**① 核心结论**：该步骤台账状态为 completed，但未在 `<line>/results/` 或 `<line>/processed/` 找到可解析的汇总表；本节不填数值，请对照该步骤产出的明细文件。

**② 数据与统计依据**：任务 `is_l2_fi`，状态 `completed`，语言 bash

**③ 方法学与生物学限制**：该步骤未登记限制说明，引用前请人工复核方法学前提。

## 第四章：虚拟敲除（Virtual KO）专项机制辨析

本项目未勾选虚拟敲除步骤，本章不适用。

## 第五章：推荐后续湿实验验证路线图 (Wet-Lab Validation Roadmap)

**优先候选基因**：OLAH、LOC105377458、POM121L9P、MCEMP1、LOC100996760

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
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_03_volcano_fdr.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_03_volcano_limma.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_32_lrg_deg_heatmap.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_33_ml_roc.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_34_ml_calibration.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_35_ml_overlap.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_36_ml_importance.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_37_ml_roc_m2.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_38_ml_calibration_m2.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_39_ml_overlap_m2.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 图件 | `figures/l1_40_ml_importance_m2.png` | 结果可视化（300 DPI PNG） |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/deg_all.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/deg_report.txt` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/deg_sig.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/enrich_go_LRG_diff.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/enrich_go_M1_hub.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/enrich_go_M2_hub.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/enrich_kegg_LRG_diff.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/enrich_kegg_M1_hub.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/enrich_kegg_M2_hub.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/enrichment_report.txt` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/expr_genes.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/group_map.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/gsea_go_BP.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/gsea_go_CC.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/gsea_go_MF.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/gsea_kegg.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/immune_celltype_comparison_external.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/immune_celltype_comparison_train.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/immune_hub_correlation.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/immune_report.txt` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/immune_ssgsea_external.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/immune_ssgsea_train.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/l1_merged_candidates.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/lrg_deg_all.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/lrg_deg_candidates.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/lrg_deg_report.txt` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/lrg_deg_sig.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/merge_combat_report.txt` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/merged_candidates_report.txt` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/merged_expr.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/merged_group_map.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/ml_candidate_genes_used.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/ml_external_pred.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/ml_hub_genes.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/ml_hub_genes_m1.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/ml_hub_genes_m2.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/ml_hub_lrg_report.txt` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/ml_hub_lrg_report_m1.txt` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/ml_hub_lrg_report_m2.txt` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/ml_loocv_pred.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/ml_select_by_method.tsv` | 该步骤的明细统计结果 |
| 线 1 · GEO Bulk 转录组 | 结果表 | `processed/ml_select_by_method_m2.tsv` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 图件 | `figures/l2_01_lac_group_celltype.png` | 结果可视化（300 DPI PNG） |
| 线 2 · 单细胞转录组 | 图件 | `figures/l2_02_score_distributions.png` | 结果可视化（300 DPI PNG） |
| 线 2 · 单细胞转录组 | 图件 | `figures/l2_03_five_algorithm_corr.png` | 结果可视化（300 DPI PNG） |
| 线 2 · 单细胞转录组 | 图件 | `figures/l2_04_wgcna_modules.png` | 结果可视化（300 DPI PNG） |
| 线 2 · 单细胞转录组 | 图件 | `figures/l2_05_candidates_evidence.png` | 结果可视化（300 DPI PNG） |
| 线 2 · 单细胞转录组 | 图件 | `figures/l2_06_pseudotime.png` | 结果可视化（300 DPI PNG） |
| 线 2 · 单细胞转录组 | 图件 | `figures/l2_07_comm_top.png` | 结果可视化（300 DPI PNG） |
| 线 2 · 单细胞转录组 | 结果表 | `results/annotate_report.txt` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/cellchat_lhs_interactions.tsv` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/cellchat_report.txt` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/celltype_mapping.tsv` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/cluster_markers.tsv` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/deg_lhs_lls.tsv` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/hdwgcna_hubs.tsv` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/hdwgcna_modules.tsv` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/hdwgcna_report.txt` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/hvg_genes.tsv` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/ingest_report.txt` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/integrate_report.txt` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/l2_candidates.tsv` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/l2_candidates_report.txt` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/lactylation_scores.tsv` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/lactylation_scores_part1.tsv` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/lactylation_scores_part2.tsv` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/lhs_sub_expr.tsv` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/lhs_sub_meta.tsv` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/lhs_sub_report.txt` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/liana_lhs_top.tsv` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/lr_score_report.txt` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/lrg_deg_all.tsv` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/lrg_deg_sig.tsv` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/metacell_expr.tsv` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/metacell_meta.tsv` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/metacell_report.txt` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/monocle2_pseudotime.tsv` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/monocle2_report.txt` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/monocle2_traj_by_celltype.tsv` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/qc_cell_metrics.tsv` | 该步骤的明细统计结果 |
| 线 2 · 单细胞转录组 | 结果表 | `results/qc_report.txt` | 该步骤的明细统计结果 |
| 线 3 · 空间转录组 | 图件 | `figures/l3_mouse_01_region_score_boxplot.png` | 结果可视化（300 DPI PNG） |
| 线 3 · 空间转录组 | 图件 | `figures/l3_mouse_02_regions_umap.png` | 结果可视化（300 DPI PNG） |
| 线 3 · 空间转录组 | 图件 | `figures/l3_mouse_03_target_genes_heatmap.png` | 结果可视化（300 DPI PNG） |
| 线 3 · 空间转录组 | 结果表 | `results/hvg_genes.tsv` | 该步骤的明细统计结果 |
| 线 3 · 空间转录组 | 结果表 | `results/ingest_report.txt` | 该步骤的明细统计结果 |
| 线 3 · 空间转录组 | 结果表 | `results/l3_regions_report.txt` | 该步骤的明细统计结果 |
| 线 3 · 空间转录组 | 结果表 | `results/lr_score_by_cluster.tsv` | 该步骤的明细统计结果 |
| 线 3 · 空间转录组 | 结果表 | `results/lr_score_by_condition.tsv` | 该步骤的明细统计结果 |
| 线 3 · 空间转录组 | 结果表 | `results/normalize_report.txt` | 该步骤的明细统计结果 |
| 线 3 · 空间转录组 | 结果表 | `results/qc_report.txt` | 该步骤的明细统计结果 |
| 线 3 · 空间转录组 | 结果表 | `results/region_by_condition.tsv` | 该步骤的明细统计结果 |
| 线 3 · 空间转录组 | 结果表 | `results/region_lr_compare.tsv` | 该步骤的明细统计结果 |
| 线 3 · 空间转录组 | 结果表 | `results/spatial_lr_report.txt` | 该步骤的明细统计结果 |
| 线 3 · 空间转录组 | 结果表 | `results/spatial_lr_scores.tsv` | 该步骤的明细统计结果 |
| 线 3 · 空间转录组 | 结果表 | `results/spatial_regions.tsv` | 该步骤的明细统计结果 |
| 线 3 · 空间转录组 | 结果表 | `results/spatial_target_genes.tsv` | 该步骤的明细统计结果 |
| 线 3 · 空间转录组 | 结果表 | `results/spatial_target_report.txt` | 该步骤的明细统计结果 |
| 线 3 · 空间转录组 | 结果表 | `results/spot_meta.tsv` | 该步骤的明细统计结果 |
| 线 3 · 空间转录组 | 结果表 | `results/spot_qc_metrics.tsv` | 该步骤的明细统计结果 |
| 线 3 · 空间转录组 | 结果表 | `results/target_gene_by_cluster.tsv` | 该步骤的明细统计结果 |
| 线 3 · 空间转录组 | 结果表 | `results/target_gene_by_condition.tsv` | 该步骤的明细统计结果 |

### 关键结果表字段说明

| 文件 | 关键字段 | 含义 |
|---|---|---|
| `deg_all.tsv` / `deg_sig.tsv` | gene / logFC / P.Value / adj.P.Val | 基因名、log2 倍数变化、原始 p、校正 p |
| `ko_dr_genes.tsv` | gene / distance | DR 基因名、网络扰动距离（越大越显著） |
| `celltype_scores.tsv` | spot / celltype / score | spot 编号、细胞类型、NNLS 解卷积权重 |
| `external_validation_preds.tsv` | sample / prob / label | 样本、预测概率、真实标签 |

## 第七章：可复现性台账与质控审计摘要 (Reproducibility & Audit Ledger)

**台账汇总**：共 38 条任务，累计耗时约 46.1 分钟，单步内存峰值 0.0 GB。

| task_id | 分析线 | 步骤 | 状态 | 检查点 | 耗时 | 内存峰值 | seed |
|---|---|---|---|---|---|---|---|
| is_l1_pr | line1_bulk | prep_matrix | completed | passed | 3 s | : | 20261013 |
| is_l1_pr | line1_bulk | prep_matrix | completed | passed | 6 s | : | 20261013 |
| is_l1_pr | line1_bulk | prep_matrix | completed | passed | 17 s | : | 20261013 |
| is_l1_me | line1_bulk | merge_combat | completed | passed | 52 s | : | 20261013 |
| is_l1_me | line1_bulk | merge_combat | completed | passed | 50 s | : | 20261013 |
| is_l1_de | line1_bulk | deg_limma | completed | passed | 4 s | : | 20261013 |
| is_l1_lr | line1_bulk | lrg_deg | completed | passed | 2 s | : | 20261013 |
| is_l1_ml | line1_bulk | ml_hub_lrg | completed | passed | 26 s | : | 20261013 |
| is_l2_in | line2_scrna | ingest_10x | completed | passed | 26 s | : | 20261013 |
| is_l2_qc | line2_scrna | qc_cells | completed | passed | 22 s | : | 20261013 |
| is_l2_an | line2_scrna | annotate_celltypes | completed | passed | 33 s | : | 20261013 |
| is_l2_no | line2_scrna | normalize_integrate | completed | passed | 219 s | : | 20261013 |
| is_l2_lr | line2_scrna | lr_score_iqr | failed | halted | 922 s | : | 20261013 |
| is_l2_lr | line2_scrna | lr_score_final | completed | passed | 53 s | : | 20261013 |
| is_l2_hd | line2_scrna | hdwgcna_hubs | failed | halted | 141 s | : | 20261013 |
| is_l2_me | line2_scrna | metacells_l2 | completed | passed | 136 s | : | 20261013 |
| is_l2_wg | line2_scrna | wgcna_l2 | completed | passed | 24 s | : | 20261013 |
| is_l2_ca | line2_scrna | candidates_l2 | completed | passed | 2 s | : | 20261013 |
| is_l2_mo | line2_scrna | monocle_cellchat | failed | halted | 25 s | : | 20261013 |
| is_l2_su | line2_scrna | lhs_subset_export | completed | passed | 22 s | : | 20261013 |
| is_l2_mo | line2_scrna | monocle2_lhs | completed | passed | 308 s | : | 20261013 |
| is_l2_cc | line2_scrna | cellchat_l2 | failed | halted | 32 s | : | 20261013 |
| is_l3_in | line3_spatial | ingest_visium | completed | passed | 37 s | : | 20261013 |
| is_l3_qc | line3_spatial | spatial_qc_norm | completed | passed | 107 s | : | 20261013 |
| is_l3_sc | line3_spatial | spatial_lr_score | completed | passed | 28 s | : | 20261013 |
| is_l3_ta | line3_spatial | spatial_target_genes | completed | passed | 24 s | : | 20261013 |
| is_l1_mk | line1_bulk | make_merged_candidates | completed | passed | 2 s | : | 20261013 |
| is_l1_ml | line1_bulk | ml_hub_lrg | completed | passed | 26 s | : | 20261013 |
| is_l1_en | line1_bulk | enrich_line1 | completed | passed | 226 s | : | 20261013 |
| is_l1_ml | line1_bulk | ml_hub_lrg | completed | passed | 27 s | : | 20261013 |
| is_l3_re | line3_spatial | spatial_regions | completed | passed | 16 s | : | 20261013 |
| is_l2_co | line2_scrna | liana_comm | completed | passed | 67 s | : | 20261013 |
| is_l1_im | line1_bulk | immune_ssgsea | completed | passed | 10 s | : | 20261013 |
| is_l2_fi | line2_scrna | l2_figures | completed | passed | 10 s | : | 20261013 |
| is_l1_lr | line1_bulk | l1_lrg_heatmap_spec | completed | passed | 6 s | : | 20261013 |
| is_l3_fi | line3_spatial | l3_figures_spec | completed | passed | 18 s | : | 20261013 |
| is_l1_ml | line1_bulk | l1_ml_figures_spec | completed | passed | 24 s | : | 20261013 |
| is_l2_fi | line2_scrna | l2_figures_spec | completed | passed | 11 s | : | 20261013 |

### 五维环境自检

自检项与工作台 `/api/selfcheck` 同口径。**本报告不代替自检结果**：如项目目录下存在 `selfcheck.json`，其内容会一并收录；否则请在交付前运行一次自检。

未找到 `selfcheck.json`，五维自检结论缺失。

---

本报告不含任何推测数值。若某章节标注「未找到」，表示对应产物尚未落盘，请补齐后重新生成本报告。
