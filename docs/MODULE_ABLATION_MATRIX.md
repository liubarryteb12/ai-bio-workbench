# 54 模块功能级消融与兼容性矩阵

日期 2026-11-08T23:46:45.495Z

本报告按 `tools/bio/workflows.json` 真源逐模块检查母版、输入、产物、seed、退出码、独立运行闭包、相邻模块承接与故障注入判据。脚本不重跑生信分析，不连接设备。

## 汇总

- 模块：54，分析线：3
- 相邻兼容性边：121
- remove-one-module 与故障注入场景：486
- Ready 单图：39，退役组合图：3
- 静态守卫：4
- 缺口：0

## 逐模块表

| Mod | 线 | Stage | 母版 | 独立运行 | 上游闭包 | 兼容边 | 问题 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| l1_ingest_prep | line1_bulk | ingest#1 | prep_matrix | 是 | 0 | 3 | 无 |
| l1_qc_matrix | line1_bulk | qc#2 | qc_matrix | 否 | 1 | 2 | 无 |
| l1_qc_pca | line1_bulk | qc#2 | pca_matrix | 否 | 1 | 2 | 无 |
| l1_de_limma | line1_bulk | de#3 | deg_limma | 否 | 1 | 2 | 无 |
| l1_de_wgcna | line1_bulk | de#3 | wgcna_modules | 否 | 1 | 2 | 无 |
| l1_enrich_bulk | line1_bulk | enrich#4 | enrichment_bulk | 否 | 3 | 2 | 无 |
| l1_enrich_figures | line1_bulk | enrich#4 | enrichment_figures | 否 | 4 | 2 | 无 |
| l1_enrich_ppi | line1_bulk | enrich#4 | ppi_string | 否 | 2 | 2 | 无 |
| l1_ml_keygenes | line1_bulk | ml#5 | key_genes | 否 | 4 | 5 | 无 |
| l1_ml_model | line1_bulk | ml#5 | ml_model | 否 | 5 | 3 | 无 |
| l1_ml_hub | line1_bulk | ml#5 | ml_hub_analysis | 否 | 5 | 4 | 无 |
| l1_ml_diag | line1_bulk | ml#5 | ml_diagnostics | 否 | 6 | 3 | 无 |
| l1_ml_external | line1_bulk | ml#5 | external_validation | 否 | 5 | 3 | 无 |
| l1_ml_cox | line1_bulk | ml#5 | cox_analysis | 否 | 5 | 3 | 无 |
| l1_figures_bulk | line1_bulk | figures#6 | bulk_figures | 是 | 0 | 1 | 无 |
| l2_ingest_counts | line2_scrna | ingest#1 | ingest_counts | 是 | 0 | 3 | 无 |
| l2_qc_cells | line2_scrna | qc#2 | qc_cells | 否 | 1 | 1 | 无 |
| l2_qc_normalize | line2_scrna | qc#2 | normalize_hvg | 否 | 2 | 1 | 无 |
| l2_integrate_harmony | line2_scrna | integrate#3 | integrate_harmony | 否 | 3 | 1 | 无 |
| l2_integrate_cluster | line2_scrna | integrate#3 | cluster_umap | 否 | 4 | 1 | 无 |
| l2_integrate_annotate | line2_scrna | integrate#3 | annotate_celltypes | 否 | 5 | 1 | 无 |
| l2_profile_composition | line2_scrna | profile#4 | scrna_composition | 否 | 6 | 1 | 无 |
| l2_profile_deg | line2_scrna | profile#4 | deg_groups | 否 | 7 | 1 | 无 |
| l2_profile_subcluster | line2_scrna | profile#4 | subcluster | 否 | 8 | 1 | 无 |
| l2_branches_enrich | line2_scrna | branches#5 | enrichment | 否 | 8 | 2 | 无 |
| l2_branches_enrich_fig | line2_scrna | branches#5 | enrichment_figures | 否 | 9 | 2 | 无 |
| l2_branches_pseudotime | line2_scrna | branches#5 | pseudotime | 否 | 6 | 1 | 无 |
| l2_branches_cellcomm | line2_scrna | branches#5 | cell_communication | 否 | 6 | 2 | 无 |
| l2_branches_gsva | line2_scrna | branches#5 | gsva_pathways | 否 | 8 | 2 | 无 |
| l2_tf_scenic | line2_scrna | tf#6 | scenic_tf | 否 | 6 | 2 | 无 |
| l2_tf_scenic_fig | line2_scrna | tf#6 | scenic_figures | 是 | 0 | 1 | 无 |
| l2_tf_activity | line2_scrna | tf#6 | tf_activity | 否 | 8 | 2 | 无 |
| l2_ko_virtual | line2_scrna | ko#7 | virtual_knockout | 否 | 6 | 3 | 无 |
| l2_ko_summarize | line2_scrna | ko#7 | summarize_dr | 否 | 7 | 2 | 无 |
| l2_ko_localization | line2_scrna | ko#7 | target_gene_localization | 否 | 9 | 3 | 无 |
| l2_ko_drpost | line2_scrna | ko#7 | dr_post_analysis | 否 | 10 | 4 | 无 |
| l2_figures_scrna | line2_scrna | figures#8 | scrna_figures | 否 | 8 | 1 | 无 |
| l3_ingest_spatial | line3_spatial | ingest#1 | ingest_spatial | 是 | 0 | 4 | 无 |
| l3_qc_spots | line3_spatial | qc#2 | qc_spots | 否 | 1 | 2 | 无 |
| l3_qc_normalize | line3_spatial | qc#2 | normalize_hvg | 否 | 2 | 2 | 无 |
| l3_dimred_reduce | line3_spatial | dimred#3 | dim_reduce | 否 | 3 | 2 | 无 |
| l3_dimred_domains | line3_spatial | dimred#3 | spatial_domains | 否 | 4 | 2 | 无 |
| l3_dimred_markers | line3_spatial | dimred#3 | spatial_markers | 否 | 5 | 2 | 无 |
| l3_stats_autocorr | line3_spatial | spatial_stats#4 | spatial_autocorr | 否 | 6 | 2 | 无 |
| l3_stats_cooccur | line3_spatial | spatial_stats#4 | spatial_cooccurrence | 否 | 7 | 2 | 无 |
| l3_stats_composition | line3_spatial | spatial_stats#4 | spatial_composition | 否 | 8 | 2 | 无 |
| l3_stats_communication | line3_spatial | spatial_stats#4 | spatial_communication | 否 | 9 | 2 | 无 |
| l3_branches_celltype | line3_spatial | branches#5 | celltype_annotation | 否 | 6 | 4 | 无 |
| l3_branches_localization | line3_spatial | branches#5 | spatial_localization | 否 | 10 | 2 | 无 |
| l3_branches_enrich | line3_spatial | branches#5 | enrichment | 否 | 6 | 2 | 无 |
| l3_branches_enrich_fig | line3_spatial | branches#5 | enrichment_figures | 否 | 7 | 4 | 无 |
| l3_ko_spatial | line3_spatial | ko#6 | spatial_knockout | 否 | 11 | 2 | 无 |
| l3_ko_drpost | line3_spatial | ko#6 | dr_post_analysis | 否 | 12 | 6 | 无 |
| l3_figures_spatial | line3_spatial | figures#7 | spatial_figures | 否 | 12 | 2 | 无 |

## 故障注入语义

| 缺陷 | 应触发的判据 | 期望 |
| :--- | :--- | :--- |
| remove_registration | workflow_graph.validateRegistry | fail closed |
| remove_master | workflow_graph.validateRegistry | fail closed |
| remove_requires | workflow_graph.validateRegistry | fail closed |
| remove_produces | workflow_graph.validateRegistry | fail closed |
| empty_result | task_fsm + ledger_receipt | fail closed |
| missing_upstream | figure_execution_plan + task_submit_validation | fail closed |
| wrong_upstream | figure_execution_plan + task_submit_validation | fail closed |
| stale_upstream | task_fsm + ledger_receipt | fail closed |
| cross_line_reference | isolated_bridge_gate | fail closed |

## 相邻兼容性判据

- 产物名按 `requires` 与 `produces` 闭合，跨线引用只放行 `public_references/celltype_signatures/<project_id>/` 冻结签名桥。
- `.h5ad` 检查 `obs`、`var`、`obsm`、`uns`、`X` 的声明面，`.rds` 检查跨语言桥接守卫，`.tsv` 检查 `gene_symbol`、`logFC`、`pvalue`、`padj`、`term`、`NES`、`sample_id`、`donor_id` 的 schema 绑定面。
- 缺上游、错上游、旧版本上游、空结果都归到任务回执或完成回执校验，不允许写成部分成功。
- 图件只消费 Ready 单图，退役组合图不得带 preview 或 render evidence。

## 缺口清单

- 无

MODULE_ABLATION_MATRIX_OK
