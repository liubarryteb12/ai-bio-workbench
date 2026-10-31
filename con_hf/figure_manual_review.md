# R 图件人工审查清单（机器判决不可用部分的补充）

> 制定：2026-10-19（主 Agent）。对应 `con_hf/2026-10-19_figure_polish_plan.md` §待决策 1。
> **决策**：不为 R 出图单独建几何审计器（要 hook `grDevices::png`/`plot`，工程量大且 R 版式
> 规则与 Python 不完全同构），改为"机器能查的照查 + 查不了的列清单交人工"。
> 人工审查完成后，在表末"审查记录"里补日期与结论，**未审查前状态一律是未目视**。

## 1. 为什么需要这份清单

`ops/audit_figure_layout.py` 靠 monkeypatch `matplotlib.figure.Figure.savefig` 做几何判定，
**只覆盖 Python 出图**。R 脚本（`png()` 设备）跑审计得到 `figs=0 fail=0`:
那既不是通过也不是失败，是**没有判决**。实测证据：`wgcna_modules`、`pca_matrix`、
`deg_limma` 三个脚本跑审计均 `figs=0`（2026-10-19）。

本项目 `PRJ_E2E_GSE277173 / line1_bulk` 共 6 张 R 图：

| 图件 | 出图脚本 | 类型 |
|---|---|---|
| `l1_02_pca_step3.png` | `pca_matrix` | PCA 散点 |
| `l1_03_volcano_limma.png` | `deg_limma` | 火山图 |
| `l1_28_wgcna_softpower.png` | `wgcna_modules` | 软阈值诊断双Panel |
| `l1_29_wgcna_module_trait.png` | `wgcna_modules` | 模块-性状热图 |
| `l1_30_wgcna_sample_tree.png` | `wgcna_modules` | 样本聚类树 + 分组色条 |
| `l1_31_wgcna_mm_gs.png` | `wgcna_modules` | MM vs GS 散点 |

## 2. 机器已经覆盖的部分（无需人工重复）

本地 `cn_debug/figure_audit_scan.py` 对这 6 张与其他图一视同仁，已判定
（2026-10-19，`outputs/PRJ_E2E_GSE277173/line1_bulk/figures`）：

| 项 | 结论 |
|---|---|
| 扩展名 PNG / DPI==300 / 最短边≥1200px / 非空白 / 边缘无裁切 | **6/6 PASS**（并入 33/33 fail=0） |
| 命名符合 `l<n>_<序号>_<语义>.png` | PASS |
| 源码级（C1-C9：轴内图例/低DPI/低字号/错目录/PDF/res=/dpi） | 对应脚本 `no issue found` |
| 同种子复现性 | `pca_matrix` 连跑两次图件 md5 均为 `b9db6bd4…`；WGCNA 产物 V1-V10 全过 |

## 3. 机器没有判决、需要人眼看的（每张图的检查点）

通用三条（`docs/figure_spec.md` §三之二/§三之三）：**图例不压数据且在轴框外**、
**图注一条一行且不与轴框相交**、**图内文字互不重叠**、字号≥8pt。

| 图件 | 专项检查点 |
|---|---|
| `l1_02_pca_step3` | 点=样本；分组色 ctrl=`#3B4992`/case=`#EE0000`；caption 注明来源步骤与"PCA scores from step"；轴标签含基因数/样本数 |
| `l1_03_volcano_limma` | 阈值线标注贴**左侧轴框内缘**（`p=0.05`）与**轴框顶部**（`log2FC=1`）且不被点云压；轴标签带 ID 类型；显著基因数在图注 |
| `l1_28_wgcna_softpower` | `R²=0.8` 阈值线**可见**（ylim 已放到 0.95 之上）；`chosen power` 竖线与文字标注不互压；右图 mean connectivity 同样标注 chosen power |
| `l1_29_wgcna_module_trait` | **一个组一列**（NLS/LS 两列，2026-10-19 改）；colorbar 带 `correlation r` label；图注三要素（每列是什么 / case-ctrl / trait 来源）；行序按 \|cor\| 降序 |
| `l1_30_wgcna_sample_tree` | 分组色条组名不被裁（左侧 margin 已留 9 行）；`\|Z.k\|>2.5` 离群样本在树上有标识；图注含 n/genes/离群数 |
| `l1_31_wgcna_mm_gs` | 两条阈值虚线（kME/GS）与文字标注不互压；每模块 top1 基因标签不叠字；图例在轴框外右侧且不超画布 |

## 4. 现状与关闭条件

- **状态：6/6 未目视**（主 Agent 所在环境没有图像查看能力，不能替人下"已审"结论）。
- 关闭条件：① 人工逐张核对 §3 检查点；② 在下方"审查记录"填日期/审查人/结论；
  ③ 若有问题，先落 `con_hf/figure_error_ledger.md` 再修，修完重跑同种子复现验证。
- 在关闭前，这 6 张在 `figure_score.py` 里保持 `B1?~B4?` 的 UNVERIFIED 状态，
  **不得因"看起来没问题"改判 PASS**。

## 审查记录

| 日期 | 审查人 | 图件 | 结论 | 备注 |
|---|---|---|---|---|
| （空） | | | | |
