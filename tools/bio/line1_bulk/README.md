# 线1 / GEO bulk 线

> 术语见 `GLOSSARY.md`，隔离约束见 `docs/isolation.md`。
> 本目录只放线1 代码。线2、线3 代码不得出现在这里，本目录脚本也不得引用另外两条线。

## 输入

GEO 芯片（表达集）或 bulk RNA-seq count 矩阵。

## 线内步骤（顺序）

1. GEO 下载
2. 预处理 / 注释（探针 ID 转 gene symbol）
3. 多数据集整合与去批次
4. QC
5. 分组
6. PCA
7. DEG + WGCNA
8. 富集 + PPI / hub 基因
9. 交集关键基因
10. 机器学习建模（训练集内选基因、调参）
11. 独立 GEO 外部验证（冻结评估）

## 工具分工（线内混用）

| 语言 | 负责 |
|---|---|
| R | 芯片背景校正/分位数归一化、limma / DESeq2 差异检验、WGCNA、clusterProfiler 富集、ComplexHeatmap 排版 |
| Python | 大规模矩阵运算、机器学习建模（scikit-learn 类） |

主语言与版本、随机种子记到 `envs/manifest.txt`，分析中途不更换。

## 外部验证冻结（硬约束）

- 独立 GEO 验证集只做冻结评估：**不重新筛基因、不重新调参**。
- 验证集内部可去批次，但**禁止**把训练集与验证集合并校正后再评估。
- 多外部数据集、跨平台要分开报告，关注表达方向一致性。

## 产出去向

服务器 `/mnt/ssd/bio_data/projects/<项目>/line1_bulk/{raw_data,processed,results,figures}/`
（脚本 `bin/line1_bulk/` 与环境声明 `envs/line1_bulk/` 全局一份，所有项目共用）。
任务台账 JSON 落 `/mnt/ssd/bio_data/system_logs/`，`line_id` = `line1_bulk`，`project_id` = 所属项目。
**产物回搬（用户拍板 2026-10-13）**：processed/results 产物与 system_logs 台账
必须通过 `ops/07_pull_outputs.ps1` 回搬至本地 `outputs/` 目录存档（scp + 逐文件
字节校验，同名默认跳过、-Force 覆盖），服务器保留运行态正本。

## 本目录结构（本地代码本体，与服务器侧数据目录一一对应）

本地只放代码；数据、产物、环境全部在服务器 `/mnt/ssd/bio_data/projects/<项目>/line1_bulk/`（代码与环境在顶层全局一份）。

```
src/line1_bulk/
├── README.md            # 本文件
├── scripts/             # 线内分析脚本（.R / .py 可混用，但只在本线内）
└── checkpoint/          # 桥上检查点脚本，命名 checkpoint_*.R / checkpoint_*.py
```

桥上检查点用于跨语言传文件（如 Python 出 clean_table 给 R 做 limma），
必须校验四项：基因名、矩阵方向、细胞名/样本名、embedding（若有）。
约束与校验规则见 `docs/isolation.md`。

## 状态

进行中。数据面已就绪（2026-10-13：手机自带存储，`/mnt/ssd/bio_data/projects/default/line1_bulk/raw_data/` 已有测试数据），
步骤清单按本文件独立设计（2026-10-13 拍板另起炉灶，不沿用底座旧脚本编号）。

已落地（全部真实数据面 + 界面验收 exit 0，台账 completed/passed）：
- 步骤 1+2（GEO 下载/预处理）→ `scripts/prep_matrix`：expr_genes.tsv 20019 基因 × 16 样本 / group_map.tsv / prep_report.txt；
- 步骤 4（QC）→ `scripts/qc_matrix`：qc_report.txt / sample_qc.tsv（组内 Spearman 0.95-0.99，无离群）；
- 步骤 6（PCA）→ `scripts/pca_matrix`：pca_scores.tsv / pca_report.txt / pca_plot.pdf（top2000 高变基因，PC1 26.6% / PC2 20.3%）；
- 步骤 7 差异分析部分 → `scripts/deg_limma`：limma NLS-LS，deg_all.tsv / deg_sig.tsv / deg_report.txt / deg_volcano.pdf。
  **0 显著基因是真实结果**（8v8 小样本，min adj.P.Val=0.4524，阈值不随结果调整）；
- 步骤 5（分组）已并入 prep_matrix（group_map.tsv）；
- `scripts/probe_env` 为环境自检冒烟脚本（S0 部署通道验证桩），不计入线内步骤。

**2026-10-13 晚补齐（用户拍板"样本量小也能做，容忍精度不高"）**：
- 步骤 7 WGCNA → `scripts/wgcna_modules`：signed 网络，power=26（R²=0.748 未达 0.8 如实记录），
  40 模块（含 grey 2602 基因），与分组显著相关 2 个（tan n=248 cor=-0.563 p=0.023、plum1 n=34 cor=+0.522 p=0.038）；
  产物 wgcna_modules.tsv / wgcna_module_trait.tsv / wgcna_softpower.pdf / wgcna_module_trait.pdf / wgcna_report.txt。
- 步骤 8 富集 → `scripts/enrichment_bulk`：GSEA（gseGO，全基因按 limma t 降序，**不依赖显著阈值**，
  适配 DEG 0 显著）+ WGCNA 显著模块 ORA + KEGG（外网可达）；
  GSEA 3453 terms/1059 显著、模块 ORA 1010 行、KEGG 304 行；产物 enrichment_gsea_go.tsv /
  enrichment_module_ora.tsv / enrichment_kegg.tsv / enrichment_report.txt。
  **出图（`scripts/enrichment_figures`，2026-10-14 补）**：3 张 PNG 落 `line1_bulk/figures/`：
  l1_13_gsea_top.png（GSEA top20，条形=NES 红激活/蓝抑制，标注 NES + 校正 p）、
  l1_14_module_ora_top.png（模块 ORA top20，条形=-log10 校正 p，标注 GeneRatio + 校正 p）、
  l1_15_kegg_top.png（KEGG top20，同上）。
- 步骤 8 PPI → `scripts/ppi_string`：STRING API（species=9606，required_score=400），
  输入 = WGCNA 显著模块基因（282 个）→ 669 边 / 188 hub；产物 ppi_edges.tsv / ppi_hubs.tsv /
  l1_07_ppi_network.png / l1_08_ppi_hubs.png / ppi_report.txt。
- 步骤 9 交集关键基因 → `scripts/key_genes`：DEG（**放宽到 nominal p<0.05，如实标注非 FDR**）∩
  WGCNA 显著模块 ∩ PPI hub(top50) = **25 个三线交集基因**；产物 key_genes.tsv / l1_09_key_genes.png / key_genes_report.txt。
- 步骤 10 ML → `scripts/ml_model`：特征 = 25 交集基因，logreg(L2,C=1)+RF(100,md3)，
  留一交叉验证 LOOCV（LR AUC=0.797 / RF AUC=0.680，探索性）；
  产物 ml_feature_importance.tsv / l1_10_ml_roc.png / l1_11_ml_importance.png / ml_report.txt。
- 步骤 11 外部验证 → `scripts/external_validation`：raw_data 无第二个独立数据集，
  用**分层留出法冻结评估**作内部近似（特征与超参在训练集冻结、测试集只 predict），
  **明确标注 validation_type=internal_holdout_approximation（非独立外部验证）**；
  holdout AUC=1.000 / Acc=0.667（测试集仅 6 样本，置信区间极宽）；
  产物 external_validation_preds.tsv / external_frozen_coefs.tsv / l1_12_external_roc.png / external_validation_report.txt。

**出图**：`scripts/bulk_figures` 产出 15 张**单图**（不拼多面板）：相关热图 / PCA+95%椭圆 /
火山图×2（FDR + nominal）/ top50 变异热图 / QC×2 / MA×2 / PPI 网络 / PPI hub / 交集 / ML ROC /
ML 重要性 / 外部验证 ROC，落 `line1_bulk/figures/`。

仍受数据面阻塞（不伪造结果，待数据就绪）：
- 步骤 3 整合去批次：raw_data 仅一套 bulk 数据集，无第二数据集可整合去批次（非环境问题）。

