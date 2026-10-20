# IS 乳酸化干实验 · 推进计划（PRJ_20261019_IS_lactylation）

> 2026-10-19 主代理制定。用户六节方案 → 三线架构的映射与本项目实际执行计划。
> 唯一权威状态台账：本文件 + `con_hf/handoff.md` 的 IS 项目节；项目契约：`projects/PRJ_20261019_IS_lactylation/project.json`。
> 恢复顺序：按本文件 §3 的顺序执行；每步的"验收"是硬门槛，不过不进入下一步。

## 1. 数据集与已核验事实

| 线 | 数据集 | 物种/组织 | 分组事实 | 状态 |
|---|---|---|---|---|
| line1 | GSE22255 (GPL570) | 人 PBMC | 20 IS + 20 Control | raw_data 就位+md5 校验 |
| line1 | GSE58294 (GPL570) | 人外周血 | 69 IS(心源性) + 23 Control | 同上 |
| line1 | GSE16561 (GPL6883) | 人全血 | 39 IS + 24 Control | 同上，**独立外部验证集（冻结）** |
| line2 | GSE174574 (GPL21103) | 小鼠 MCAO 脑 | 3 sham + 3 MCAO，10x 标准矩阵，Ensembl+symbol，27998 基因 | raw_data 就位+md5 校验 |
| line3 | GSE233814 (GPL24247) | 小鼠 MCAO 脑 Visium | control + 1d/3d/7d 病灶，5 样本，含 HE tif 与 scalefactors json | 同上 |
| 公共 | LRG 基因集 371 个 | 人符号 | 论文补充表（PMC12241668，md5 9cf120f5…） | 就位，鼠源映射走 org.Mm.eg.db |

## 2. 六节方案 → 三线步骤映射

### 方案一（数据获取与预处理）
- line1：prep_matrix ×3 ✅ 已完成验收（21755×40 / 21755×92 / 17494×63，GSE16561 null 基因内中位数插补 24427 处）
- line2：ingest_counts → qc_cells → normalize → 降维整合 → cluster → 细胞注释（Seurat/scanpy，母版 script 适配）
- line3：ingest_spatial → qc_spots → normalize → dim_reduce → 聚类
- LRG 基因集 ✅

### 方案二（乳酸化评分与 IQR 分型）— 全在 line2
- 五算法（AUCell/UCell/singscore/GSVA/AddModuleScore）细胞级评分 → 各自 min-max 归一 → 综合得分（均值）
- IQR 分型：<P25=LLS、P25~P75=LDTS、>P75=LHS
- LHS vs LLS DEG（线内 Seurat FindMarkers，adj p<0.05）

### 方案三（hdWGCNA 与候选基因筛选）— line2
- hdWGCNA（仅 LHS 细胞，Seurat object）→ 与 LHS 得分显著正相关模块 → 模块内枢纽（kME/kIM 阈值）
- 三源交集：hdWGCNA hub ∩ (LHS-LLS DEG) ∩ (线2 MCAO/sharm 变化的 LRG，小鼠口径)
- 产出候选基因清单（含每基因来源标注）

### 方案四（空间转录组）— line3，隔离红线口径
- 标准化/整合/聚类逐样本域识别
- HE 形态 + 域 marker 注释三区域：缺血核心区 / 半暗带 / 对侧正常区
- 区域乳酸化评分比较（spot 级评分 + 区域间检验）
- **11 个重点目标基因空间定位出图**（AKT1/BCL2L1/CASP1/DNMT1/HSP90AB1/MAPK14/MDM2/MMP9/ABCA1/ORMDL3/PLEKHA1，小鼠 Title case）
- 反卷积：**不使用 line2 参考**（用户拍板）。RCTD 参考来源未定（public_references 无批准的小鼠脑 scRNA）→ 默认跳过并在最终报告如实记录；如后续获得公共参考再补。空间的"高乳酸化富集验证"用线内 spot 级评分 + 区域定位完成。

### 方案五（ML 筛选枢纽 LRG + 诊断模型）— line1
- 主体 ✅ 已完成：候选=33 个（线1 LRG 敏感口径）；LASSO 23/RF 16/Boruta 21/XGBoost 6/单因素logistic 33 → 交集 hub=CBR1/HNRNPL/SMARCA4/TST/VIM；LOOCV AUC 0.9585；GSE16561 冻结验证 AUC 0.8237（Sens 0.590/Spec 1.000）；ROC/校准/交集/重要性 4 图
- 衔接步（待 line2 候选产出后）：把 line2 候选基因并入候选池重跑五算法 → 最终 hub → 用最终 hub 重跑逻辑回归 + GSE16561 冻结验证（里程碑 M2）
- 已知标注：单因素 Cox 因无生存数据用单因素 logistic 替代（报告已注明）

### 方案六（下游分析）
- line1：CIBERSORT 免疫浸润（IS vs Control 比例 + hub 基因相关性）；GO/KEGG/GSEA 富集（hub/LRG 层面）
- line2：Monocle2 伪时间（LHS 细胞定位）；CellChat（LHS vs 神经元/内皮通讯）
- 交付：分型框架 + 诊断标志物汇总报告（`docs/delivery_package_spec.md` 七章模板口径）

## 3. 执行顺序与依赖

```
line2 主体（步骤 1-7）──────────┐
                                ├─→ line1 ML 重跑（并入 line2 候选）─→ line1 富集+CIBERSORT ─┐
line3 主体（步骤 1-5，独立）────┘                                                              ├─→ 交付报告
line2 Monocle2 + CellChat ──────→（汇入报告）─────────────────────────────────────────────────┘
```

**当前断点：line2 步骤 1（ingest_counts）未开始。**

### line2 步骤（待办 8 步）
| # | 步骤 | 输入 | 验收标准 |
|---|---|---|---|
| L2-1 | ingest_counts（6 样本 tar→h5ad，小鼠） | GSE174574_RAW.tar | 细胞/基因对账+md5+回读验证 |
| L2-2 | qc_cells（线2 阈值：nCount/nFeature/mt%） | L2-1 | metrics 全表+剔除理由 |
| L2-3 | normalize + HVG + 整合（3+3 样本 batch=sham/MCAO） | L2-2 | 嵌入+批次诊断 |
| L2-4 | cluster_umap + annotate_celltypes | L2-3 | 21+ 簇→细胞类型（小鼠 marker） |
| L2-5 | 乳酸化五算法评分 + IQR 分型 + LHS/LLS DEG | L2-4 | 每组细胞数、DEG 表 |
| L2-6 | hdWGCNA（LHS 子集）→ 模块→hub | L2-5 | 网络参数+模块正相关证据 |
| L2-7 | 三源交集候选基因清单 | L2-5/L2-6/线2 LRG-DEG | 交集表+来源标注 |
| L2-8 | Monocle2 伪时间 + CellChat（LHS vs 神经元/内皮） | L2-4/L2-5 | 轨迹+通讯通路输出 |

### line3 步骤（待办 5 步）
| # | 步骤 | 输入 | 验收标准 |
|---|---|---|---|
| L3-1 | ingest_spatial（5 样本 Visium） | GSE233814_RAW.tar | spot/基因对账+图/scalefactors 保留 |
| L3-2 | qc_spots + normalize_hvg + dim_reduce | L3-1 | QC 指标+嵌入 |
| L3-3 | 逐样本空间域 + HE 区域注释（核心区/半暗带/对侧） | L3-2 | 域图+区域归属表 |
| L3-4 | spot 级乳酸化评分 + 区域间比较 | L3-3 | 区域得分分布+统计 |
| L3-5 | 11 个目标基因空间定位出图 | L3-3 | 逐基因样本图（300dpi 合规） |

### line1 收尾（待办 3 步）
| # | 步骤 | 验收标准 |
|---|---|---|
| L1-A | line2 候选并入重跑五算法 ML + 冻结验证（M2） | 新 hub+新 AUC，与第一轮对比表 |
| L1-B | CIBERSORT 免疫浸润（IS vs Control + hub 相关性） | LM22/参考库来源需先定（见 §5） |
| L1-C | GO/KEGG/GSEA 富集（hub+LRG 层面） | 显著 term 表+富集图 |

## 4. 隔离与数据流规则（本计划执行红线）

1. line3 不读 line2 任何数据；反卷积参考仅限 public_references 批准源或线内数据（用户 2026-10-19 拍板）。
2. line2 候选基因清单 → line1 ML：基因清单级传递（非数据集），project.json notes 已记录；L1-A 的候选来源须在报告中注明占比。
3. line2/line3 基因符号小鼠 Title case，LRG 映射走 org.Mm.eg.db 并记录未命中数。
4. 论文补充包内该论文自身结果数据（GBM DEGs/hub）严禁引入（防答案泄漏，handoff 已记）。
5. 全局 seed=20261013，所有任务经 run_throttled_task.sh 台账；出图 300dpi 遵守 figure_spec v2.2。
6. 每步链：探针/测试跑 → 回读验证 → 台账 completed → 07 回搬本地 outputs/。

## 5. 未决决策点（需用户确认才动，不自行选边）

| 项 | 选项 | 影响 | 当前默认 |
|---|---|---|---|
| CIBSERSORT 参考库来源 | LM22 下载（cibersort.stanford.edu，可能被拦）/ 换 immunedeconv（Bioc）/ 换 MCPcounter 等 | L1-B 能否称为"CIBERSORT 原算法" | 未定，先试 LM22 |
| line3 反卷积 | 跳过 / 待批准的公共小鼠脑参考 | 方案四后半节 | 跳过并如实记录 |
| line2 细胞注释参考 | 小鼠经典 marker 人工集（需整理）/ public reference | L2-4 精度 | 人工 marker 集 |

## 6. 里程碑

- **M1（已达成）**：line1 五算法 + 逻辑回归 + GSE16561 冻结验证 + 4 图（hub=CBR1/HNRNPL/SMARCA4/TST/VIM，外部 AUC 0.8237）
- **M2**：line2 主体完成（评分/分型/hdWGCNA/候选）→ line1 ML 重跑产出最终 hub
- **M3**：line2 Monocle2+CellChat、line3 主体完成
- **M4**：line1 富集+CIBERSORT + 全项目交付报告
