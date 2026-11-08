# k40 算力面脚本漂移审计（2026-11-05）

## 为什么有这份文档

第三十七轮基准跑动时，`ml_hub_analysis` 在真机上要求 `project.json` 的 `grouping_design` 主对照，
而仓库母版里没有这段逻辑，整步 failed。查下来不是单个脚本的事：**仓库已经不是算力面的真源**。
这份文档记录审计证据与收敛计划，避免下次再从一次真实失败里反推。

## 审计方法

拉回 `k40:/mnt/ssd/bio_data/bin/line1_bulk` 全部 27 个脚本到 `.tmp/k40_drift_audit/remote/`，
与仓库 `src/line1_bulk/scripts/` 逐文件 sha256 对比，再按函数/产物/特征标记做语义甄别。

## 审计结果（line1_bulk）

- 仓库 16 个，远端 27 个；**逐字节相同 7 个，分叉 9 个，远端野生 11 个，仓库独有 0 个**。

### 分叉 9 个

| 脚本 | 差异规模 | 判定 | 依据 |
|---|---|---|---|
| ml_hub_analysis | +81/-28 | **远端更新，已吸收** | 远端多 `resolve_groups`（读 grouping_design 主对照），仓库无独有函数或产物 |
| ml_model | +92/-11 | **远端更新，已吸收** | 远端多 `project_metadata`，仓库无独有函数或产物 |
| bulk_figures | +68/-130 | 仓库更新 | 仓库有 `cutoffs` 阈值真源接线（T1-4 成果），远端没有 |
| deg_limma | +24/-73 | 仓库更新 | 同上，仓库读 cutoffs |
| cox_analysis | +39/-3 | **远端更新，已吸收** | 远端多 `read_project_meta`（读 project.json 的 project_id/train_dataset），并把 GSE277173 硬编码说明改成按项目元数据取值 |
| enrichment_figures | +7/-1 | **远端更新，已吸收** | 远端对空输入表做 `EmptyDataError` 容错并记 skip，仓库版会直接抛错 |
| prep_matrix | +54/-20 | **远端更新，已吸收** | 远端兼容两种 grouping 结构（每样本一行 `GSM<TAB>group` 与每组一行），tissue 派生分组失败时回退用户分组表并留痕 |
| external_validation | +274/-253 | **真双向分叉，待合并** | 仓库独有 6 个排版函数（`_install_layout_guard`/`caption`/`fit_text_edges`/`layout_fix`/`legend_out`/`wrap_label`）；远端独有 `parse_frozen_model`/`project_datasets` 与产物 `external_validation_metrics.tsv`。两侧都是有效逻辑，需人工合并 |
| qc_matrix | +8/-10 | **待裁定（闸门放宽）** | 远端把「检出离群样本即 fail」改成「标记 review_required、保留样本、不阻断下游」。这是 QC 闸门口径变更，不能静默吸收 |

### 远端野生 11 个（仓库无对应物）

`geo_pca_scatter`、`geo_tcga_common_deg`、`gsva_pathway_score`、`lasso_cox_model`、
`lasso_feature_select`、`limma_deg_analysis`、`multi_metric_survival_roc`、
`multivariate_cox_model`、`roc_diagnostic_curve`、`univariate_cox_screen`、`wgcna_module_trait`。

这 11 个看起来是**旧 GEO/生存分析一代**的脚本（cox/survival/ROC/lasso 组合），
与当前 `workflows.json` 的 mod 契约不对应。判定：归档，不进母版；是否删除远端待裁定。

## 收敛纪律（按 Argon 第三十七轮）

1. **禁止直接用仓库旧版覆盖远端**：远端分叉里有生产必需的新逻辑（grouping_design），覆盖即回退。
2. 逐个甄别后**把远端有效逻辑反向吸收进仓库**（本文件已做 2 个），再谈对齐。
3. 全部收敛后加 **SHA256 同源门禁**（`tools/ops/k40_script_parity.mjs`），把「仓库即生产、分叉即报警」变成机器判据。

## 本轮已完成 / 未完成

- 已完成：取证拉回 + 逐文件对比 + **5 个远端更新脚本吸收进仓库**（`ml_hub_analysis`、`ml_model`、
  `cox_analysis`、`enrichment_figures`、`prep_matrix`），仓库母版规范测试 9/9 通过。
- 已完成判定：`bulk_figures`、`deg_limma` 仓库更新（有 `read_cutoffs` 阈值真源），保留仓库版，
  部署时应以仓库覆盖远端。
- 未完成：`external_validation` 双向合并、`qc_matrix` 闸门口径裁定、11 个野生脚本处置、同源门禁。

## 复现

```
ssh k40-ubuntu 'cd /mnt/ssd/bio_data/bin/line1_bulk && for f in *; do echo "$(sha256sum $f | cut -c1-16) $f"; done'
scp -r k40-ubuntu:/mnt/ssd/bio_data/bin/line1_bulk/* .tmp/k40_drift_audit/remote/
python .tmp/k40_drift_audit/audit.py      # 逐文件对比
python .tmp/k40_drift_audit/feature_diff.py  # 函数/产物集合差异
```

## 收敛结果（第 38 轮完成）

起点 8 个分叉，终点 **0 个**：55 个共有脚本逐字节一致。

### 判决依据（逐个甄别，不盲目覆盖）

| 脚本 | 差异 | 判决 | 依据 |
|---|---|---|---|
| bulk_figures | 有 | 仓库更新 | 带 `read_cutoffs` 阈值真源 |
| deg_limma | 有 | 仓库更新 | 同上 |
| qc_matrix | 有 | 仓库更新 | 远端把「离群即失败」放宽为「仅标记」，属闸门口径变更；本轮保留仓库的严格口径，若确需放宽应由产品决定而不是靠部署覆盖 |
| normalize_hvg | 有 | 仓库更新 | 仓库有分块就地标准化（BLOCK_ROWS=4000），远端仍是全量 `normalize_total`，大样本必 OOM |
| enrichment_figures (line2) | 有 | 仓库更新 | 仓库配色 `#3B4992/#EE0000` 符合 `docs/figure_spec.md` 第 65/483 行；远端 `spec-v110` 的 Okabe-Ito 是旧规范 |
| enrichment_figures (line3) | 有 | 仓库更新 | 同上 |
| scrna_figures | 有 | 仓库更新 | 仓库版本既有规范配色又有 `read_cutoffs`；远端只有旧配色 |
| external_validation | 有 | **双向合并** | 远端有 `project_datasets` / `parse_frozen_model`（读 project.json 训练集角色、按 record_type 拆冻结模型）；仓库有六个排版函数（`caption`/`wrap_label`/`fit_text_edges`/`legend_out`/`layout_fix`/`_install_layout_guard`）。两个增量互不重叠，merge 进仓库版本 |

### 机器判据

`tools/ops/k40_script_parity.mjs`：

```
node tools/ops/k40_script_parity.mjs            # 连真机比对（需要 ssh k40-ubuntu）
node tools/ops/k40_script_parity.mjs --offline  # 用上次清单，不连真机
node tools/ops/k40_script_parity.mjs --json     # 机器可读
```

口径：
- 共有脚本内容不同 = 失败（打印双方短哈希）；
- 单侧独有 = 警告（野生脚本需人工裁定，不自动删）；
- 连不上真机 = 显式 SKIP 并 exit 2，不静默放行。

结果清单落 `.ops_state/k40_script_manifest.json`（已 gitignore，是本机缓存不是真源）。

### 还剩下的

11 个 line1 野生脚本（`geo_pca_scatter`、`limma_deg_analysis`、`lasso_cox_model` 等旧 GEO/生存分析一代）仍在远端。它们与当前 `workflows.json` 的 mod 契约不对应，判定为**归档**而不是回流；是否从远端删除待产品确认（删除不可逆，不在本轮做）。
