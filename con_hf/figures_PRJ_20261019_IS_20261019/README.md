# 图件索引（PRJ_20261019_IS_lactylation）

> 回搬时间：2026-10-20（合规重制版）；共 20 张 PNG，300 DPI。
> 合规状态：**19/20 满分 100**（`cn_debug/figure_score.py`：几何审计 19 图 0 fail + 源码审计 0 issue + caption 登记 20/20）；
> 1 张 UNVERIFIED = `l1_03_volcano_limma.png`（母版 R png() 图件，规范 §七已知边界：几何审计不覆盖 R，走人工审查登记）。
> 服务器正本：`/mnt/ssd/bio_data/projects/PRJ_20261019_IS_lactylation/<line>/figures/`
> 工作台预览副本：`outputs/PRJ_20261019_IS_lactylation/<line>/figures/`

## line1_bulk（10 张）

| 文件 | 内容 | 关键数字 |
|---|---|---|
| l1_03_volcano_limma.png | DEG 火山图（母版 deg_limma 步骤级，R 图件） | 12 显著（9↑/3↓） |
| l1_32_lrg_deg_heatmap.png | IS 相关 LRG-DEG 热图（Python 合规版） | 33 候选，敏感口径 basis 已标注 |
| l1_33_ml_roc.png | **M1** ROC：LOOCV + 外部 GSE16561 | 0.9585 / **0.8237**（sens 0.590 / spec 1.000） |
| l1_34_ml_calibration.png | **M1** 校准曲线（十分位） | — |
| l1_35_ml_overlap.png | **M1** 五方法筛选规模 | LASSO26/RF13/Boruta/XGBoost/单因素 |
| l1_36_ml_importance.png | **M1** 重要性（RF Gini + GBDT Gini） | seed=20261013 |
| l1_37_ml_roc_m2.png | **M2** ROC（候选池 45，含 line2 12） | 0.9579 / 0.7682（sens 1.000 / spec 0.625） |
| l1_38_ml_calibration_m2.png | **M2** 校准曲线 | — |
| l1_39_ml_overlap_m2.png | **M2** 五方法筛选规模 | — |
| l1_40_ml_importance_m2.png | **M2** 重要性（6 基因） | — |

## line2_scrna（7 张）

| 文件 | 内容 | 关键数字 |
|---|---|---|
| l2_01_lac_group_celltype.png | 三分组×细胞类型构成热图 | 57225 细胞 / 10 类 |
| l2_02_score_distributions.png | composite 得分分布（箱线带个体点 + 直方图） | LLS 14306 / LDTS 28613 / LHS 14306 |
| l2_03_five_algorithm_corr.png | 五算法评分 Spearman 相关 | 6000 细胞抽样 |
| l2_04_wgcna_modules.png | WGCNA 模块（ρ 条形 + 规模条形） | 16 模块 / 9 正相关 / 328 枢纽 |
| l2_05_candidates_evidence.png | 12 候选基因三源交集证据（分组条形） | Cald1/Mbp/S100a4/Calr/Tpm4/… |
| l2_06_pseudotime.png | Monocle2 伪时间 + 得分关系 | ρ=−0.0066 p=0.61（无单调关系） |
| l2_07_comm_top.png | liana top15 LR 交互 | LHS 富集类型内部 1460 对 |

## line3_spatial（3 张）

| 文件 | 内容 | 关键数字 |
|---|---|---|
| l3_mouse_01_region_score_boxplot.png | spot 得分按区域箱线（带个体点 + n） | KW H=68.96 p=1.0e-16 |
| l3_mouse_02_regions_umap.png | UMAP 按区域着色 | 3 core 簇 1715 spots，100% MCAO |
| l3_mouse_03_target_genes_heatmap.png | 11 目标基因×簇 z-score 热图 | MAPK14 ρ=0.248 / DNMT1 ρ=0.231 |

## M1 与 M2 的区别（务必区分）
- **M1**：候选池 = 本线 LRG 差异 33 个 → hub = CBR1, HNRNPL, SMARCA4, TST, VIM（5）
- **M2**：候选池 = 45（M1 的 33 + line2 三源交集 12）→ hub = CBR1, DCXR, PGK1, SMARCA4, TST, VIM（6）
- 并入 line2 候选后**外部泛化下降**（0.8237 → 0.7682），两版均留档；外部稳健优先建议交付 M1。

## 出图脚本（project_data/Ischemic Stroke/ 下，已部署服务器 scripts/）
- `line1_scripts/l1_ml_figures_spec`（8 张；statsmodels GLM 重拟合，AUC 与台账核对一致才落盘）
- `line1_scripts/l1_lrg_heatmap_spec`（1 张）
- `line2_scripts/l2_figures_spec`（7 张；h5py 直读 obs 不加载表达矩阵）
- `line3_scripts/l3_figures_spec`（3 张）
- 旧版不合规图件（l1_ml_*.png / l1_lrg_heatmap.png / m2_l1_ml_*.png / l3_regions_*.png / l3_region_*.png / l3_target_*.png）已全部删除并由合规版取代

## 审计产物（cn_debug/is_fig_audit/）
- `audit_all.csv`：几何审计 19 图全 PASS（A 标注在框内 / B 图例外置 / C 图注不交轴框 / D 不重叠）
- `code_all.csv`：源码审计 0 issue（无轴内 loc / 无 <8pt / 无中文 / 命名合规）
- 打分：figs=20 PASS=19 FIX=0 FAIL=0 UNVERIFIED=1 avg=99.0

## 注意事项
- line3 图件为**无空间坐标口径**：GSE233814 补充包不含 tissue_positions，故不做像素空间特征图与 Moran's I。
- 本目录用于本地目视复核；正式交付打包时从服务器项目目录收集并按 `docs/delivery_package_spec.md` 脱敏校验。
- 美观与可读性请亲自打开确认；机器判定只覆盖几何/命名/字号/caption 等可量化项。
