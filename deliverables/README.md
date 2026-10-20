# 图件索引（PRJ_20261019_IS_lactylation）

回搬时间：2026-10-20　来源：算力端 `projects/PRJ_20261019_IS_lactylation/`（服务器保留运行态正本）

| 文件 | 线 | 内容 | 对应步骤 |
|---|---|---|---|
| `l1_03_volcano_limma.png` | line1 | IS vs 对照 差异火山图（训练集合并 132 样本） | DEG（limma） |
| `l1_lrg_heatmap.png` | line1 | IS 显著变化 LRG 表达热图（敏感口径 33 个） | LRG-DEG |
| `l1_ml_roc.png` | line1 **M1** | ROC：训练 LOOCV + 外部 GSE16561 冻结曲线（5 hub） | 五算法 + 逻辑回归 |
| `l1_ml_calibration.png` | line1 **M1** | 校准曲线（LOOCV，十分位） | 诊断模型 |
| `l1_ml_overlap.png` | line1 **M1** | 五方法各自入选基因数与命中枢纽情况 | 五算法筛选 |
| `l1_ml_importance.png` | line1 **M1** | 枢纽基因重要性（RF + XGBoost） | 五算法筛选 |
| `m2_l1_ml_roc.png` | line1 **M2** | 同上，但候选池 = 45（并入 line2 的 12 个）（6 hub） | M2 重跑 |
| `m2_l1_ml_calibration.png` | line1 **M2** | 校准曲线（M2） | M2 重跑 |
| `m2_l1_ml_overlap.png` | line1 **M2** | 五方法入选与命中（M2） | M2 重跑 |
| `m2_l1_ml_importance.png` | line1 **M2** | 枢纽重要性（M2） | M2 重跑 |
| `l3_target_genes_heatmap.png` | line3 | 11 个重点基因 × 14 个转录谱簇 的 z-score 热图（无坐标口径） | L3-5 |

## M1 与 M2 的区别（务必区分）
- **M1**：候选池 = 本线 LRG 差异 33 个 → hub = CBR1, HNRNPL, SMARCA4, TST, VIM（5）
  内部 LOOCV AUC **0.9585**，外部 GSE16561 **0.8237**（sens 0.590 / spec 1.000）
- **M2**：候选池 = 45（M1 的 33 + line2 三源交集 12）→ hub = CBR1, DCXR, PGK1, SMARCA4, TST, VIM（6）
  内部 LOOCV AUC 0.9579，外部 **0.7682**（sens 1.000 / spec 0.625）

并入 line2 候选后**外部泛化下降**（0.8237 → 0.7682），两版均留档；若要求外部稳健优先，建议交付 M1。

## 注意事项
- line3 图件为**无空间坐标口径**：GSE233814 补充包不含 tissue_positions，故不做像素空间特征图与 Moran's I。
- 本目录仅用于本地目视复核；正式交付打包时图件应从服务器项目目录收集并按 `docs/delivery_package_spec.md` 脱敏与校验。
- 我无法真正看图，尺寸/结构合规已由 `ops/audit_figure_layout.py` 等工具判定过；**美观与可读性请你亲自打开确认**。
