# T-FT-05 真实输入适配闭环报告

日期：2026-10-28  
状态：PASS（最终代码，6/6 ready 模板）

## 范围

本切片关闭 G2 的真实输入语义缺口。上一轮已证明派生脚本能上传、执行、回搬并落台账，但母版仍使用合成数据。本轮新增 `figure_adapters.js`，为当前全部 6 个 `ready` 模板生成真实数据覆盖层。

真实数据覆盖层先执行，成功后立即 `quit` 或 `SystemExit`。母版源码继续保留在派生文件中用于 `Master-SHA256` 字节级审计，但位于退出语句之后，不再产生合成中间图。

## 真实输入结果

| 模板 | 分析线 | K40 task | 真实输入 | 结果标记 | 本地 PNG |
| --- | --- | --- | --- | --- | --- |
| `fig_l2_pca` | line1_bulk | `1d610790-9f4d-49ae-b042-8c80f63e8f9c` | `pca_scores.tsv` | 16 samples | 67129 bytes, `9679b07d...4076` |
| `fig_l2_heatmap` | line1_bulk | `05f705f5-b867-4371-a95a-c6d8a7df9460` | `expr_genes.tsv` | 50 genes x 16 samples | 61676 bytes, `d2c6cc16...a6dc0` |
| `fig_l2_volcano` | line1_bulk | `97558737-f8b0-4f48-9e7c-47a1802f4dc8` | `deg_all.tsv` | 20019 rows | 59036 bytes, `6bc5c714...84c07` |
| `fig_l2p_dotplot` | line2_scrna | `73d813e9-c575-4682-bf95-19be0c3b9a8a` | `target_gene_localization.tsv` | 143 rows | 172982 bytes, `8bb194db...e774` |
| `fig_l2p_volcano` | line2_scrna | `31590942-04f7-425d-84af-918c400395de` | `deg_all_by_celltype.tsv` | 5000 plotted rows | 157242 bytes, `491b8733...1817` |
| `fig_l2p_umap` | line3_spatial | `21628f40-e5ed-4fad-b0c3-84e81a7e766a` | `spatial_dimred_human.h5ad` | 6877 cells, 2 groups | 470562 bytes, `bdae88f6...0ef5` |

以上 6 个任务在 K40 均为：

- `status=completed`
- `exit_code=0`
- `checkpoint_status=passed`
- `random_seed=20261013`

## 验证

- 6 张本地回搬 PNG 全部通过 `ops/validate_plot_artifacts.py` 的 Pillow verify 与 load，`invalid=0`。
- 6 张 PNG 已逐张目视检查，图内容分别对应真实 PCA、表达热图、差异火山图、细胞类型点图、细胞类型火山图和空间 UMAP。
- `ADAPT_REAL_INPUT_OK` 标记在 6 个 K40 任务日志中全部出现。
- Node 全量测试：974/974 PASS。
- Playwright：15/15 PASS。
- TypeScript：PASS。
- Vite build：PASS。
- 注册表检查：`figure_templates.check=ok`。
- Plot Matrix strict：27/27 PASS。
- 工程防线检查：`git diff --check` PASS。

## 双轴评审修复

Standards 轴发现并已修复：

- 母版路径原本只限制在仓库根内，现收紧到 `reference/05.可参考出图代码/`，越界直接 fail closed。
- adapted 任务的 canonical 缺失错误文案统一走 `shellQuote`。
- `canonical_output` 与项目输入路径增加字符白名单与穿越拒绝，失败不进入生成代码。

Spec 轴发现并已修复：

- 覆盖层不再先执行母版合成逻辑，真实数据代码成功后先退出。
- Python 任务通过 shell `BIOANALYS_SEED` 环境变量继承种子，并新增接口级断言。

Spec 轴报告的 `task.js` 多节点代码属于评审基线 `HEAD` 中已存在的并行工作，不在本切片新增范围内。

## 证据

- `real_input_results.csv`
- `artifact_validation.tsv`
- `markers.txt`
- `FINAL_CHECKS.txt`
- `fig_l2_pca_ledger.json`
- `fig_l2_heatmap_ledger.json`
- `fig_l2_volcano_ledger.json`
- `fig_l2p_dotplot_ledger.json`
- `fig_l2p_volcano_ledger.json`
- `fig_l2p_umap_ledger.json`
- `run_remaining_adapters.ps1`
- `con_hf/runs/2026-10-28_aims_v31/review_standards.md`
- `con_hf/runs/2026-10-28_aims_v31/review_spec.md`

## 结论

T-FT-05 的执行基础设施与真实数据语义均完成闭环。当前注册表只有 6 个模板具备语义匹配的真实项目样例，因此本轮 6/6 全部验证；aims 中旧的 16 个 ready 计数不再作为当前真值。
