# Aims v3.1 图模板映射只读审计

审计日期：2026-10-28  
审计范围：`aims/01_aims_20261027_1204.md`、`aims/03_aims_20261027_1204.md`、`src/figure_templates.json`、`src/workflows.json`、`ops/build_figure_templates.cjs`、`local_projects/PRJ_AIMS_V3_20261027/figures`  
审计方式：静态机器核对加图件目视抽查。未修改代码、注册表、aims、台账或 Git，未执行 K40。

## 一、结论摘要

当前 T-FT-03 不能按 aims 表原样直接填写字段。按现状严格审计，主要结论如下：

1. `src/figure_templates.json` 当前确有 82 个模板，其中 `ready=16`、`pending=65`、`blocked_r453=1`，但 16 个 `ready` 的 `lines`、`analysis_step`、`produces`、`output_glob`、`sample_project_output` 全部为空，非空率均为 `0/16`。证据：`src/figure_templates.json:98`、`465`、`510`、`538`、`595`、`767`、`829`、`864`、`980`、`1573`、`1863`、`2037`、`2096`、`2208`、`2237`、`2325`。
2. aims 映射表中有 7 个模板 ID 在当前注册表不存在：`fig_l1_grouped_bar`、`fig_l2_kegg_bar`、`fig_l2_enrich_bubble`、`fig_l2_sankey`、`fig_l2_umap_general`、`fig_l3_scrna_dotplot`、`fig_l3_scrna_umap`。证据：`aims/03_aims_20261027_1204.md:87-97` 与上述注册表 ready ID 清单。
3. aims 表使用的 8 个唯一分析步骤 ID 中，只有 `l1_qc_pca` 和 `l1_enrich_figures` 真实存在，其余 6 个不存在。证据：`aims/03_aims_20261027_1204.md:82-97`，真实步骤见 `src/workflows.json:83`、`109`、`175`、`242`、`263`、`301`、`476`、`493`、`520`、`538`、`979`、`805`、`1286`。
4. aims 表的 16 个 `sample_project_output` 只有 4 个路径存在，12 个缺失。4 个存在的路径中，只有 `l1_02_pca.png` 与 PCA 图型语义严格对应。`l1_24_corr_network.png` 是共表达网络而非相关性散点，`l1_20_hub_overlap.png` 是方法交集柱状图而非桑基图，`l1_12_external_roc.png` 是 ROC 曲线而非多面板组合图。证据：对应图件位于 `local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/`，并已目视抽查。
5. aims 表有 9 行声明多线共享，但每行只有一个 `analysis_step` 和一个 `sample_project_output`。当不同线使用不同步骤时，单值字段无法表达按线映射。证据：`aims/03_aims_20261027_1204.md:85-92`、`95-97`。
6. 当前构建器不生成任何映射字段，手动修改注册表后运行 `node ops/build_figure_templates.cjs` 会覆盖修改。必须先改生成器，再生成注册表。证据：`ops/build_figure_templates.cjs:199-213`。
7. 当前测试和注册表校验也没有要求这 5 个字段非空，因此空映射仍能通过现有测试。证据：`BioanalysDesktop/tests/figure_templates_parity.test.js:45-60`、`BioanalysDesktop/server/figure_graph.js:73-106`。

## 二、当前注册表真实状态

### 2.1 字段完整度

| 字段 | 当前 ready 非空数 | 目标 |
| :--- | ---: | ---: |
| `lines` | 0/16 | 16/16 或明确降级 |
| `analysis_step` | 0/16 | 16/16 或明确降级 |
| `produces` | 0/16 | 16/16 或明确降级 |
| `output_glob` | 0/16 | 16/16 或明确降级 |
| `sample_project_output` | 0/16 | 16/16 或明确降级 |

证据：逐项读取 `src/figure_templates.json` 的 16 个 `deps_status=ready` 对象，上述键均不存在。

### 2.2 生成器会覆盖手填字段

`ops/build_figure_templates.cjs:199-213` 的 `templates.push` 对象只输出 `id`、`name`、`level`、`category`、`language`、`source`、`source_sha256`、`preview`、`preview_sha256`、`verified`、`deps_status`、`deps`、`linked_mods`、`adapt_vars`、`deprecated`。它没有映射字段。

因此 T-FT-03 的直接施工顺序必须是：

1. 在生成器中增加按模板 ID 的映射覆盖表。
2. 在生成器中校验映射字段。
3. 生成 `src/figure_templates.json`。
4. 再运行 `--check` 和测试。

只编辑 `src/figure_templates.json` 不构成可维持的修复。

### 2.3 现有测试无法拦住 G1

`BioanalysDesktop/tests/figure_templates_parity.test.js:45-60` 的 required 列表没有 `lines`、`analysis_step`、`produces`、`output_glob`、`sample_project_output`。`BioanalysDesktop/server/figure_graph.js:93` 的注册表校验字段清单同样没有这些字段。

T-FT-03 必须同步增加以下断言：

- `ready` 模板的 `lines` 是非空数组。
- `analysis_step` 能在对应线的 `src/workflows.json` 中找到。
- `produces` 是非空数组。
- `output_glob` 是非空字符串。
- `sample_project_output` 非空且文件真实存在。
- 多线模板必须有按线步骤映射，或明确限制为单线。

## 三、模板 ID 对账

### 3.1 aims 有但当前注册表没有的 ID

| aims ID | 当前真实 ID 或处置 | 说明 | 证据 |
| :--- | :--- | :--- | :--- |
| `fig_l1_grouped_bar` | `fig_l1_groupedbar` | 仅命名差异，应统一为注册表现有 ID | `aims/03_aims_20261027_1204.md:87`，`src/figure_templates.json:98` |
| `fig_l2_kegg_bar` | 无 exact ID | `fig_kegg_pathway` 是 `blocked_r453`，不得冒充 ready | `aims/03_aims_20261027_1204.md:91`，`reference/05.可参考出图代码/_meta/bizard_index.csv:50` |
| `fig_l2_enrich_bubble` | 无 exact ID | 需要新增正式模板条目，不能直接绑定到当前 ready 集合 | `aims/03_aims_20261027_1204.md:92`，`reference/05.可参考出图代码/_meta/bizard_index.csv:12-13` |
| `fig_l2_sankey` | `fig_l3_sankey` | 当前真实 ID 是 `fig_l3_sankey`，且没有真实项目样例图 | `aims/03_aims_20261027_1204.md:93`，`src/figure_templates.json:2325` |
| `fig_l2_umap_general` | 拆成 `fig_l2_umap` 与 `fig_l2p_umap` | 当前注册表没有通用 UMAP ID，R 与 Python 已分列 | `aims/03_aims_20261027_1204.md:95`，`src/figure_templates.json:595`、`2096` |
| `fig_l3_scrna_dotplot` | `fig_l2p_dotplot` | 当前真实 ID 是 Python 点图 | `aims/03_aims_20261027_1204.md:96`，`src/figure_templates.json:2037` |
| `fig_l3_scrna_umap` | `fig_l2p_umap` | 当前真实 ID 是 Python UMAP | `aims/03_aims_20261027_1204.md:97`，`src/figure_templates.json:2096` |

### 3.2 当前 ready 有但 aims 没有的 ID

当前 16 个 ready ID 与 aims 16 行精确交集只有 9 个。当前额外 7 个是：

- `fig_l1_groupedbar`
- `fig_l2_umap`
- `fig_l2p_dotplot`
- `fig_l2p_umap`
- `fig_l2p_violin`
- `fig_l2p_volcano`
- `fig_l3_sankey`

证据：`src/figure_templates.json:98`、`595`、`2037`、`2096`、`2208`、`2237`、`2325`。

## 四、分析步骤 ID 对账

| aims 步骤 ID | 是否存在 | 真实步骤 ID | 真实产物 | 证据 |
| :--- | :--- | :--- | :--- | :--- |
| `l1_qc_pca` | 是 | `l1_qc_pca` | `pca_scores.tsv`、`pca_report.txt` | `src/workflows.json:83-98` |
| `l1_enrich_figures` | 是 | `l1_enrich_figures` | `l1_13_gsea_top.png`、`l1_14_module_ora_top.png`、`figures_manifest.txt` | `src/workflows.json:175-192` |
| `l1_deg_limma` | 否 | `l1_de_limma` | `deg_all.tsv`、`deg_sig.tsv`、`deg_report.txt` | `src/workflows.json:109-126` |
| `l1_hub_coexpr` | 否 | `l1_ml_hub` | `ml_core_hub_genes.tsv` | `src/workflows.json:263-279` |
| `l1_ml_lasso_rfe` | 否 | `l1_ml_model` | `ml_report.txt`、`ml_roc.png` | `src/workflows.json:242-260` |
| `l1_external_val` | 否 | `l1_ml_external` | `external_validation_preds.tsv`、`external_validation_report.txt` | `src/workflows.json:301-318` |
| `l2_harmony_umap` | 否 | `l2_integrate_cluster` | `scrna_clustered.h5ad`、`cluster_report.txt` | `src/workflows.json:476-490` |
| `l2_marker_dotplot` | 否 | `l2_ko_localization` 或 `l2_integrate_annotate` | `target_gene_localization.tsv` 或 `cluster_markers.tsv` | `src/workflows.json:805-819`、`493-509` |

结论：8 个唯一步骤 ID 中 6 个无效，不能直接写入注册表。

## 五、输入表对账

| aims 输入表 | 是否存在 | 真实输入 | 说明 |
| :--- | :--- | :--- | :--- |
| `expr_genes.tsv` | 是 | `data/line1_bulk/processed/expr_genes.tsv` | 可直接绑定 |
| `group_map.tsv` | 是 | `data/line1_bulk/processed/group_map.tsv` | 可直接绑定 |
| `deg_all.tsv` | 是 | `data/line1_bulk/processed/deg_all.tsv` | 可直接绑定 |
| `pca_scores.tsv` | 是 | `data/line1_bulk/processed/pca_scores.tsv` | 可直接绑定 |
| `enrichment_kegg.tsv` | 是 | `data/line1_bulk/processed/enrichment_kegg.tsv` | 可直接绑定 |
| `ml_core_hub_genes.tsv` | 是 | `data/line1_bulk/processed/ml_core_hub_genes.tsv` | 文件存在，但 `l1_ml_hub` 的 `produces` 只登记了这一张表，`ml_corr_network.tsv` 未登记 |
| `external_validation_preds.tsv` | 是 | `data/line1_bulk/processed/external_validation_preds.tsv` | 可直接绑定 |
| `enrichment_go.tsv` | 否 | `enrichment_gsea_go.tsv` 或 `enrichment_module_ora.tsv` | aims 行 87 使用了不存在的表名 |
| `00_sc_harmony.h5ad` | 否 | `scrna_integrated.h5ad`、`scrna_clustered.h5ad` | aims 行 95、97 使用了不存在的表名 |
| `sc_annotated.rds` | 否 | `scrna_annotated.h5ad`、`cluster_markers.tsv` | aims 行 96 使用了不存在的文件名 |

证据：`local_projects/PRJ_AIMS_V3_20261027/data/line1_bulk/processed/`、`data/line2_scrna/processed/` 实际文件清单；`src/workflows.json:36`、`83`、`109`、`157`、`263`、`301`、`458`、`476`、`493`。

## 六、实际项目图件存在性

项目 `local_projects/PRJ_AIMS_V3_20261027/figures` 当前有 146 张 PNG：

- `line1_bulk`: 36 张
- `line2_scrna`: 39 张
- `line3_spatial`: 71 张

aims 的 16 个 `sample_project_output` 中，只有以下 4 个存在：

- `local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/l1_24_corr_network.png`
- `local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/l1_02_pca.png`
- `local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/l1_20_hub_overlap.png`
- `local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/l1_12_external_roc.png`

以下 12 个路径不存在：

- `line1_bulk/l1_03_deg_boxplot.png`
- `line1_bulk/l1_01_qc_density.png`
- `line1_bulk/l1_01_qc_hist.png`
- `line1_bulk/l1_04_hub_violin.png`
- `line1_bulk/l1_05_go_barplot.png`
- `line1_bulk/l1_03_deg_heatmap.png`
- `line1_bulk/l1_03_volcano.png`
- `line1_bulk/l1_06_kegg_dotplot.png`
- `line1_bulk/l1_06_kegg_bubble.png`
- `line2_scrna/01_umap_clusters.png`
- `line2_scrna/03_marker_dotplot.png`
- `line2_scrna/02_umap_celltype.png`

此外，4 个存在路径中有 3 个语义不匹配：

- `l1_24_corr_network.png` 是共表达网络，不是相关性散点图。
- `l1_20_hub_overlap.png` 是方法交集柱状图，不是桑基图。
- `l1_12_external_roc.png` 是单张 ROC 曲线，不是多面板组合图。

因此 aims 表的 `sample_project_output` 不能直接作为 T-FT-03 的真实样例映射。

## 七、跨线错误

aims 表声明多线的 9 行中，均只有一个 `analysis_step` 和一个 `sample_project_output`：

| 模板 ID | aims lines | aims step | 问题 |
| :--- | :--- | :--- | :--- |
| `fig_l1_violin` | line1, line2 | `l1_deg_limma` | line2 被绑定到 line1 步骤 |
| `fig_l1_grouped_bar` | line1, line2 | `l1_enrich_figures` | line2 被绑定到 line1 步骤 |
| `fig_l2_heatmap` | line1, line2 | `l1_deg_limma` | line2 被绑定到 line1 步骤 |
| `fig_l2_volcano` | line1, line2 | `l1_deg_limma` | line2 被绑定到 line1 步骤 |
| `fig_l2_kegg_bar` | line1, line2 | `l1_enrich_figures` | line2 被绑定到 line1 步骤 |
| `fig_l2_enrich_bubble` | line1, line2, line3 | `l1_enrich_figures` | line2 和 line3 均被绑定到 line1 步骤 |
| `fig_l2_umap_general` | line2, line3 | `l2_harmony_umap` | line3 被绑定到 line2 步骤 |
| `fig_l3_scrna_dotplot` | line2, line3 | `l2_marker_dotplot` | line3 被绑定到 line2 步骤 |
| `fig_l3_scrna_umap` | line2, line3 | `l2_harmony_umap` | line3 被绑定到 line2 步骤 |

这是 schema 级冲突，不是简单字段填错。`FigureTemplateEntry.analysis_step` 是单字符串，无法表达 `line2` 与 `line3` 各自不同步骤。T-FT-03 必须二选一：

1. 收敛期将多线模板拆成按线独立模板。
2. 将契约升级为 `analysis_steps: { line1_bulk?: string, line2_scrna?: string, line3_spatial?: string }`，并同步修改生成器、校验器和测试。

## 八、T-FT-03 精确修正表

### 8.1 建议保留 ready 的 9 个模板

本表使用当前注册表真实 ID，不引入 aims 中不存在的 ID。`produces` 和 `output_glob` 统一采用 `custom_<fig_id>.png` 命名，只输出单张 PNG。

| 当前 ID | lines | analysis_step | input_table | produces | output_glob | sample_project_output |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `fig_l1_groupedbar` | `["line2_scrna"]` | `l2_profile_composition` | `celltype_composition.tsv` | `["custom_fig_l1_groupedbar.png"]` | `figures/line2_scrna/custom_fig_l1_groupedbar.png` | `local_projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/l2_05_composition_stack.png` |
| `fig_l2_heatmap` | `["line1_bulk"]` | `l1_ingest_prep` | `expr_genes.tsv` | `["custom_fig_l2_heatmap.png"]` | `figures/line1_bulk/custom_fig_l2_heatmap.png` | `local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/l1_04_topvar_heatmap.png` |
| `fig_l2_pca` | `["line1_bulk"]` | `l1_qc_pca` | `pca_scores.tsv`, `group_map.tsv` | `["custom_fig_l2_pca.png"]` | `figures/line1_bulk/custom_fig_l2_pca.png` | `local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/l1_02_pca.png` |
| `fig_l2_umap` | `["line2_scrna"]` | `l2_integrate_cluster` | `scrna_clustered.h5ad` | `["custom_fig_l2_umap.png"]` | `figures/line2_scrna/custom_fig_l2_umap.png` | `local_projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/l2_01_umap_celltype.png` |
| `fig_l2_volcano` | `["line1_bulk"]` | `l1_de_limma` | `deg_all.tsv` | `["custom_fig_l2_volcano.png"]` | `figures/line1_bulk/custom_fig_l2_volcano.png` | `local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/l1_03_volcano_limma.png` |
| `fig_l3_multipanel` | `["line3_spatial"]` | `l3_ko_spatial` | `spatial_knockout_human.h5ad` | `["custom_fig_l3_multipanel.png"]` | `figures/line3_spatial/custom_fig_l3_multipanel.png` | `local_projects/PRJ_AIMS_V3_20261027/figures/line3_spatial/l3_human_16_domain_panel.png` |
| `fig_l2p_dotplot` | `["line2_scrna"]` | `l2_ko_localization` | `target_gene_localization.tsv` | `["custom_fig_l2p_dotplot.png"]` | `figures/line2_scrna/custom_fig_l2p_dotplot.png` | `local_projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/l2_13_target_gene_dotplot.png` |
| `fig_l2p_umap` | `["line3_spatial"]` | `l3_dimred_reduce` | `spatial_dimred_human.h5ad` | `["custom_fig_l2p_umap.png"]` | `figures/line3_spatial/custom_fig_l2p_umap.png` | `local_projects/PRJ_AIMS_V3_20261027/figures/line3_spatial/l3_human_06_umap_sample.png` |
| `fig_l2p_volcano` | `["line2_scrna"]` | `l2_profile_deg` | `deg_all_by_celltype.tsv` | `["custom_fig_l2p_volcano.png"]` | `figures/line2_scrna/custom_fig_l2p_volcano.png` | `local_projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/l2_08_deg_volcano_basal_keratinocyte.png` |

这 9 个模板的 `sample_project_output` 均已存在，且图型语义可对应。证据：`local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/`、`figures/line2_scrna/`、`figures/line3_spatial/` 实际文件；步骤证据见 `src/workflows.json:36`、`83`、`109`、`476`、`520`、`538`、`805`、`979`、`1230`。

### 8.2 建议降级为 pending_mapping 的 7 个模板

这 7 个模板当前没有可用的真实项目样例图，或现有样例图语义不匹配。不要为了凑 `16/16` 把缺失路径填成伪映射。

| 当前 ID | lines | analysis_step | input_table | 需要的 produces/output_glob | 当前状态 | 原因 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `fig_l1_scatter` | `["line1_bulk"]` | `l1_ml_hub` | `ml_corr_network.tsv` | `figures/line1_bulk/custom_fig_l1_scatter.png` | `pending_mapping` | 现有 `l1_24_corr_network.png` 是网络图，不是散点图 |
| `fig_l1_boxplot` | `["line1_bulk"]` | `l1_de_limma` | `expr_genes.tsv`, `group_map.tsv`, `deg_all.tsv` | `figures/line1_bulk/custom_fig_l1_boxplot.png` | `pending_mapping` | 现有线 2 箱线图有竖直端点，且跨线；线 1 目标图缺失 |
| `fig_l1_density` | `["line1_bulk"]` | `l1_ingest_prep` | `expr_genes.tsv`, `group_map.tsv` | `figures/line1_bulk/custom_fig_l1_density.png` | `pending_mapping` | 项目中没有密度图 |
| `fig_l1_histogram` | `["line1_bulk"]` | `l1_ingest_prep` | `expr_genes.tsv`, `group_map.tsv` | `figures/line1_bulk/custom_fig_l1_histogram.png` | `pending_mapping` | 项目中没有直方图 |
| `fig_l1_violin` | `["line1_bulk"]` | `l1_de_limma` | `expr_genes.tsv`, `group_map.tsv`, `deg_all.tsv` | `figures/line1_bulk/custom_fig_l1_violin.png` | `pending_mapping` | 项目中没有小提琴图 |
| `fig_l2p_violin` | `["line2_scrna"]` | `l2_profile_composition` | `celltype_composition.tsv` | `figures/line2_scrna/custom_fig_l2p_violin.png` | `pending_mapping` | 项目中没有小提琴图，组成箱线图不能替代 |
| `fig_l3_sankey` | `["line1_bulk"]` | `l1_ml_hub` | `wgcna_modules.tsv`, `enrichment_kegg.tsv`, `ml_core_hub_genes.tsv` | `figures/line1_bulk/custom_fig_l3_sankey.png` | `pending_mapping` | 项目中没有桑基图，`l1_20_hub_overlap.png` 不能替代 |

如果 T-FT-03 必须在当前批次保持 `ready=16`，则必须先真实渲染上述 7 个目标 PNG，再把这些路径写入 `sample_project_output`。否则应接受 `ready=9`、`pending_mapping=7`、`blocked_r453=1` 的新计数，并同步更新生成器和测试。

### 8.3 箱线图额外约束

`fig_l1_boxplot` 不得直接绑定现有线 2 箱线图作为 ready 样例。`l2_06_composition_box_T_cell.png` 目视仍有带竖线端点的括号标注，不符合用户要求和 D-18。

同时，两份箱线图母版仍未完成 D-18 修改：

- `reference/05.可参考出图代码/L1_基础统计图/L1_boxplot_code.R:32`
- `reference/05.可参考出图代码/_meta/R453_compat/L1_boxplot_code.R:32`

两处仍为 `tip.length = 0.01`。因此即使新建线 1 箱线图样例，也必须先完成 T-FT-01，再生成 `custom_fig_l1_boxplot.png`。

## 九、aims 缺失 ID 的处置建议

| aims ID | T-FT-03 处置 |
| :--- | :--- |
| `fig_l1_grouped_bar` | 统一改为 `fig_l1_groupedbar`，不要在注册表新增重复条目 |
| `fig_l2_kegg_bar` | 当前无 exact 模板。`fig_kegg_pathway` 仍是 `blocked_r453`。只有新增独立 KEGG 柱状图母版并完成验证后才能进入 ready |
| `fig_l2_enrich_bubble` | 可新增正式模板，canonical 母版和预览证据可来自 `L2_core_code.R` 与 `L2_enrichment_verified.png`，但必须再生成真实项目样例图后才能进入 ready |
| `fig_l2_sankey` | 使用现有 `fig_l3_sankey`，并在生成真实样例图前保持 `pending_mapping` |
| `fig_l2_umap_general` | 拆成 `fig_l2_umap` 与 `fig_l2p_umap`，分别绑定 line2 与 line3 |
| `fig_l3_scrna_dotplot` | 使用 `fig_l2p_dotplot`，并明确其样例来自 `l2_13_target_gene_dotplot.png` |
| `fig_l3_scrna_umap` | 使用 `fig_l2p_umap`，绑定 line3 的 `l3_dimred_reduce` |

## 十、T-FT-03 建议实施顺序

1. 在 `ops/build_figure_templates.cjs` 增加 `READY_MAPPING` 表，键为当前真实模板 ID。
2. 将 `lines`、`analysis_step`、`produces`、`output_glob`、`sample_project_output` 注入生成对象。
3. 扩展 `deps_status` 允许值，加入 `pending_mapping`，或在本批次先用 `pending` 并在门户标注原因。
4. 将生成器计数从固定 `ready=16` 改为可配置校验，否则降级 7 个模板会直接失败。证据：`ops/build_figure_templates.cjs:224-226`。
5. 更新 `figure_graph.js` 的 required 字段和状态白名单。证据：`BioanalysDesktop/server/figure_graph.js:93`、`105`。
6. 更新 `figure_templates_parity.test.js`，断言 5 个字段非空、步骤存在、样例文件存在、跨线无冲突。证据：`BioanalysDesktop/tests/figure_templates_parity.test.js:45-60`、`101-104`。
7. 重新运行 `node ops/build_figure_templates.cjs` 和 `node ops/build_figure_templates.cjs --check`。
8. 再运行 `npm test`，确认所有 ready 模板的 `sample_project_output` 都能真实解析。

## 十一、最高风险

### P0: 生成器会覆盖映射

只修改 `src/figure_templates.json` 后，`node ops/build_figure_templates.cjs` 或 `--check` 会按旧生成器重建空字段。证据：`ops/build_figure_templates.cjs:199-213`。

### P0: aims 的模板 ID 与注册表不一致

7 个 aims ID 不存在，直接实现会对空对象写入或抛错。证据：`aims/03_aims_20261027_1204.md:87-97`，`src/figure_templates.json` 的 16 个 ready ID。

### P0: 多线模板无法用单 `analysis_step` 表达

9 个多线模板只有一个步骤字段，line2 和 line3 会被错误绑定到 line1 或 line2 步骤。证据：`aims/03_aims_20261027_1204.md:85-97`。

### P1: 12 个样例图缺失，3 个存在的样例图语义不匹配

如果直接填 aims 路径，T-FT-04 的存在性断言会失败，或者会把错误预览继续暴露给用户。证据：`local_projects/PRJ_AIMS_V3_20261027/figures` 实际文件清单。

### P1: 箱线图母版仍保留 `tip.length = 0.01`

这与用户明确要求和 D-18 冲突，也会污染 `fig_l1_boxplot` 的真实样例图。证据：两份箱线图母版第 32 行。

## 十二、审计边界

本报告只做只读审计和 T-FT-03 修正建议，未修改：

- `src/figure_templates.json`
- `ops/build_figure_templates.cjs`
- `aims/`
- `con_hf/ledger/`
- 项目图件
- Git 状态

未执行 K40 重跑、渲染或测试套件。
