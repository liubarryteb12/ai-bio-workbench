# S17 报告 · line2 首张组合图 `l2_20_composition_panel.png`

> 切片：S17（Step 5 组图契约第二单，line2 第一张组合图）。执行者：子 Agent（profile sw-engineer）。
> 日期：2026-10-20。本文件按进度逐段追加，最后一段是完整回报。

## 0. 任务理解（照派发单，不改口径）

- 只改 `src/line2_scrna/scripts/scrna_figures`（新增组合图段）+ `BioanalysDesktop/server/figures.js`
  （只加一条 `l2_20_composition_panel` caption 登记）。
- 组合图 `l2_20_composition_panel.png`：三面板 A=`l2_05_composition_stack`、
  B=`l2_06_composition_box_basal_keratinocyte`、C=`l2_01_umap_celltype`；横版；
  三张成员单图必须继续出且不变坏。
- 契约主体是 `con_hf/2026-10-19_figure_polish_plan.md` 的「Step 5 组图契约」G1-G5。
- 跑场 `default` 项目（`projects/default/line2_scrna/processed` 有真实数据），
  **seed=20261018**（与磁盘版本同种子，#199 同族纪律；禁止 20261013）。
- 验收：A1-A8（见派发单）。

## 1. 读码与可复用性确认（已完成）

`scrna_figures` 是 bash 包装 + 单块 `PYSCRIPT` heredoc，全部数据在模块级作用域，组合图可零重算复用：

| 面板 | 复用的已算数组 | 来源 |
|---|---|---|
| A 堆叠条 | `donors_s` / `prop_s` / `diag` / `order` / `celltypes` / `cat_colors()` | `uns["composition"]`（步骤 14） |
| B 箱线 | `prop[:, ci]`（`ci=celltypes.index("basal_keratinocyte")`）/ `perm_p` | 同上 + `uns["composition"]["group_tests_json"]` |
| C UMAP | `umap`（`obsm["X_umap"]`）/ `obs["celltype"]` | 步骤 5 `cluster_umap` |

- `perm_p_by_celltype()` 已在脚本内，读 `group_tests_json` 的 diagnosis 级 `per_celltype[].perm_p`，
  **不重算**；`composition_report.txt` 实测 `basal_keratinocyte ... perm_p=0.03509`，与图上括号同源。
- 数据面实测（`composition_report.txt`）：`celltypes=13 donors=8`，
  `n_donors={'Healthy': 3, 'Psoriasis': 5}`；case/ctrl 由 `resolve_case_ctrl()` 运行期解析。
- 三张成员单图的绘图代码一行未动，组合图段插在箱线循环之后（同一 `if comp is not None:` 块内）。

（后续段落随进度追加）
