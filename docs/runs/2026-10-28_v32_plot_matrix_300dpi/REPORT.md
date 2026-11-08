# AIMS v3.2 Figure Pipeline Increment

日期：2026-10-28

状态：PASS（本增量范围）

## 目标

关闭上一轮严格审核发现的五个实质缺口：

1. 图模板派生任务必须自动挂在分析步骤之后。
2. 真实门户票据必须能够执行定制图模板。
3. 16 个模板必须具备真实项目样例与完整强映射。
4. 门户必须支持标准 Fixture 与真实项目产出的双轨切换。
5. Plot Matrix 必须把 300 DPI 作为硬门槛。

## 结果摘要

| 检查 | 结果 |
| --- | --- |
| ready 图模板 | 16/16 |
| pending_mapping | 0 |
| 新增真实适配模板 | 10/10 |
| 新增模板 K40 任务 | 10/10 completed / exit 0 / checkpoint passed |
| 适配种子 | 20261013 |
| 本地与远端产物哈希 | 10/10 一致 |
| 新增样例图片校验 | 10/10 valid |
| Plot Matrix | 27/27 PASS |
| Plot Matrix PNG | 41 张，invalid=0 |
| PNG DPI | 最小 299.999，最大 299.999 |
| Node 全量回归 | 985/985 PASS |
| Playwright | 16/16 PASS |
| TypeScript | PASS |
| Vite build | PASS |
| Python verifier tests | 16/16 PASS |

## 关键修改

### 执行计划与依赖

- 新增 `BioanalysDesktop/server/figure_execution_plan.js`。
- 新增 `BioanalysDesktop/server/figure_project_plan.js`。
- `/api/projects/figures/apply` 可把图模板选择写入既有项目。
- `/api/projects/execution-plan` 支持 GET 与 POST，并可按票据 pipelineDag 生成执行序列。
- 定制图提交要求 `dependsOnStep` 已存在成功台账，否则返回 409。

### 图模板映射

- `src/figure_templates.json` 从 6 ready / 10 pending_mapping 提升到 16 ready / 0 pending_mapping。
- 新增的真实样例位于 `local_projects/PRJ_AIMS_V3_20261027/figures/`。
- 每个新增模板都有 source、preview、analysis_step、input_tables、produces、
  output_glob、canonical_output 与 sample_project_output。
- `fig_l3_multipanel` 绑定到 line1 外部验证数据，`fig_l2_umap` 使用 line2 的 Python module graph。

### 门户双轨预览

- 每个 ready 卡片支持标准 Fixture 与真实项目产出切换。
- 新增受控路由 `/api/figure-templates/project-preview`。
- Playwright 覆盖 16 个 ready 模板的切换与图片解码。

### 300 DPI 硬门槛

- `ops/verify_plot_matrix.py` 新增 `MIN_PNG_DPI=299.0`。
- 缺少 DPI 或低于 299 的 PNG 直接失败。
- Scanpy 母版补上 `dpi_save=300`。
- K40 重跑生成新的 `script_plot_matrix.json`，全部 PNG 为 299.999 DPI。

## 证据

- `plot_matrix_plan.json`
- `strict.log`
- `strict_after_write.log`
- `remote_result/script_plot_matrix.json`
- `new_adapter_results.csv`
- `new_adapter_audit.json`
- `new_samples_validation.tsv`
- `new_samples_qc.json`
- `new_samples_contact_sheet.png`
- `node_tests.log`

## 残余

- 真实门户票据含 figure_templates 的独立 T-SYNC 演练仍需在合并 A2A 主线前执行。
- 本报告只陈述生信图模板增量，不代表最新 `aims/A2A` 四卷已经完成。
