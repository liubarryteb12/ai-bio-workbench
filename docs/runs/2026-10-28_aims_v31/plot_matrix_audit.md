# 27 入口 script_plot_matrix 只读审计

生成时间：2026-10-28，Asia/Shanghai

审计性质：只读核对。未修改代码、aims、注册表、台账、参考母版或 Git 状态。本报告是本次任务唯一新增文件。

## 顶部结论

1. `reference/05.可参考出图代码` 当前共有 28 个 R/Python 代码文件。按 `L3_高级组合图/_QUARANTINE_NOTE.md` 排除 `L3_multippanel_code.R` 后，得到 27 个非隔离入口。
2. 27 个入口分为。9 个既有 runner 入口、13 个主目录独立拆分入口、5 个扩展入口。
3. 当前 27 个入口的 source SHA256 全部与既有 K40 矩阵 payload 中的 source SHA256 一致。既有实跑台账位于 `con_hf/runs/2026-10-27_plotting_feasibility/plot_matrix_20261027_153500/result/plot_matrix.json`，其 SHA256 为 `2b1743bc1327c9f450878f019d398e94c17f5edc743322ae1c8df91364c1bf5c`。
4. 既有矩阵记录 27 个非隔离入口全部 `exit_code=0`、`marker_found=true`、`run_status=pass`、`artifact_status=pass`。这只是前序实跑证据，不是最终 T-FT-02 交付物。
5. 正式目标文件 `reference/05.可参考出图代码/_meta/script_plot_matrix.json` 当前不存在。因此 T-FT-02 尚未闭合，不能把既有 `con_hf` 运行报告直接充当最终注册表。
6. 按原始字节且不改写源码的严格口径，无法直接实跑的入口为 1 个，即 `L1_基础统计图/L1_boxplot_code.R`。该文件固定写入 `/tmp/figlib`，既有运行使用改写副本，执行副本 SHA256 为 `a2fd4f2fc9aa468455e80b38eed80284ed1217ce8c87c198f1bd06c4ecd57a33`，不等于源文件 SHA256 `325c3badd16bc2a7996f3adaef332258774db964240bf74659d1dcf51e5cbfd4`。其 compat pair 为 `_meta/R453_compat/L1_boxplot_code.R`，兼容版可通过 `R453_OUT_DIR` 在隔离目录直接执行。
7. 其余 26 个入口可以按自身 exact SHA256 直接执行。六个 compat 入口本身也属于这 26 个 direct 入口。
8. G4 当前仍是红色。正式版与 compat 版箱线图都各保留一处 `tip.length = 0.01`，分别位于第二个 `stat_pvalue_manual`。既有箱线图产物不能作为“纯水平横线”的最终验收证据。
9. 26 个入口硬编码 `set.seed(42)` 或 `random_state=42`，没有读取 `BIOANALYS_SEED=20261013`。只有 `L3_multipanel_code.R` 强制读取外部 seed。固定种子可复现，但不满足工作区“外部注入 seed”的规范。
10. 24 个入口使用源码内合成数据，2 个入口使用 R 内置 `Titanic`，1 个入口读取真实 `input_data.csv`。现有 `L1_基础统计图/input_data.csv` 与 `L2_组学常用图/input_data.csv` 没有被对应脚本读取。
11. 所有可用产物都是单张 PNG 或单张 PDF。aggregate 入口会一次产出多张独立文件，没有把多图合并成一张交付图。既有 contact sheet 仅为 QA，不可作为使用单元。
12. T-FT-02 的最终矩阵必须记录 300 DPI 证据、PNG 像素方差数值、每个产物 SHA256 和远端回传哈希。当前既有运行只记录了“PIL 通过”和 PNG 宽高，没有保存 DPI 元数据与方差数值，PDF 也只检查头部。

## 证据来源

| 证据 | 用途 |
| --- | --- |
| `aims/01_aims_20261027_1204.md` | 27 入口拆分口径，9 个既有 runner、13 个独立拆分、5 个扩展入口 |
| `aims/02_aimstodolist_20261027_1204.md` | T-FT-01 与 T-FT-02 的验收命令和动作 |
| `aims/03_aims_20261027_1204.md` | `script_plot_matrix.json` 目标 schema 与 27 入口要求 |
| `con_hf/runs/2026-10-27_plotting_feasibility/agent_static_inventory.md` | 28 个代码文件、隔离文件、fixture 与历史证据 |
| `con_hf/runs/2026-10-27_plotting_feasibility/agent_verifier_audit.md` | 9 runner、13 split、PNG/PDF 校验缺口 |
| `con_hf/runs/2026-10-27_plotting_feasibility/agent_registry_mapping.md` | 27 个入口与模板、富集图未映射关系 |
| `con_hf/runs/2026-10-27_plotting_feasibility/plot_matrix_20261027_153500/result/plot_matrix.json` | 27/27 前序 K40 实跑、输出 SHA256、尺寸与执行副本哈希 |
| `reference/05.可参考出图代码/_meta/R453_compat/README.md` | compat pair 的用途和 `R453_OUT_DIR` 隔离输出约定 |
| `reference/05.可参考出图代码/L3_高级组合图/_QUARANTINE_NOTE.md` | 排除 `L3_multippanel_code.R` 的正式依据 |

## 阻断项编码

| 编码 | 含义 | 影响 |
| --- | --- | --- |
| B1 | 箱线图仍有 `tip.length = 0.01` | G4 产物不合规，必须修改两处并重跑 |
| B2 | 箱线图固定写 `/tmp/figlib` | 原始字节不能在隔离目录内完成，必须改输出变量或使用 compat pair |
| B3 | 脚本硬编码 seed 42 | 实跑可复现，但不满足外部 seed 注入契约 |
| B4 | 产物没有正式 figure id | 图能生成，但无法完成模板强映射 |
| B5 | 箱线图图例与绘图区重叠 | 产物可用性不合格，需要版式修复 |
| B6 | README 契约与实现或输出名不一致 | 入口可运行，但文档和验收口径不一致 |

全局阻断项：

| 编码 | 含义 | 当前证据 |
| --- | --- | --- |
| G-A | 正式 `_meta/script_plot_matrix.json` 缺失 | 当前只有 `con_hf` 运行目录中的 `result/plot_matrix.json` |
| G-B | PNG 300 DPI 元数据未验证 | `inspect_png()` 只记录宽高、PIL 解码和非空白 |
| G-C | 非空白像素方差数值未落盘 | 只保留 `"PIL verify+load and nonblank check passed"` 文本 |
| G-D | PDF 仅验证 `%PDF-` 头 | 既有报告明确标记 `full validation not performed` |
| G-E | 运行产物与回传产物未做二次哈希对账 | 当前台账只有远端路径 SHA256 |

## 入口分类与执行模式

| 分类 | 数量 | 入口 |
| --- | ---: | --- |
| 既有 runner | 9 | 6 个 compat 入口、`l2p_more`、`l2p_umap`、`l3_multipanel` |
| 主目录独立拆分 | 13 | `L1_boxplot`、`L1_density`、`L1_groupedbar`、`L1_histogram`、`L1_scatter`、`L2_enrichment`、`L2_heatmap`、`L2_pca`、`L2_umap`、`L2_volcano`、`L2p_dotplot`、`L2p_violin`、`L2p_volcano` |
| 扩展入口 | 5 | `L1_rest`、`L1_violin`、`L2_core`、`L2_more`、`L3_sankey` |
| 隔离排除 | 1 | `L3_高级组合图/L3_multippanel_code.R` |

| 执行模式 | 数量 | 判定 |
| --- | ---: | --- |
| `direct_exact_sha256` | 26 | 保持源文件字节不变，在独立工作目录直接执行 |
| `adapted_copy_required` | 1 | `L1_boxplot` 需要隔离输出改写，并配套 compat pair 证据 |
| 无法在指定模式下产出图件 | 0 | 既有 K40 证据显示所有入口依赖均能满足 |
| 无法按原始字节直接执行 | 1 | `L1_boxplot` 主目录版 |

## 27 入口执行表

说明：

- `script_path` 与 `expected_outputs` 均相对 `reference/05.可参考出图代码`。
- `fixture.exists=true` 仅表示实跑所需 fixture 已具备，不表示 fixture 已达到生产数据契约。
- `compat_pair` 为 `null` 时，T-FT-02 直接执行该入口自身。
- 所有 `source_sha256` 均由本轮读取当前文件字节重新计算，并与既有 K40 payload 对账一致。
- `prior_k40=pass` 指既有 15:10 运行，不等于最终验收通过。

```jsonl
{"entry_id":"l1_boxplot","category":"split_13","language":"r","role":"primary","script_path":"L1_基础统计图/L1_boxplot_code.R","source_sha256":"325c3badd16bc2a7996f3adaef332258774db964240bf74659d1dcf51e5cbfd4","figure_ids":["fig_l1_boxplot"],"fixture":{"exists":true,"kind":"internal_synthetic","paths":[]},"compat_pair":"_meta/R453_compat/L1_boxplot_code.R","execution_mode":"adapted_copy_required","expected_outputs":["L1_boxplot_verified.png","L1_boxplot_verified.pdf"],"prior_executed_sha256":"a2fd4f2fc9aa468455e80b38eed80284ed1217ce8c87c198f1bd06c4ecd57a33","prior_k40":"pass","blockers":["B1","B2","B3","B5"]}
{"entry_id":"l1_density","category":"split_13","language":"r","role":"primary","script_path":"L1_基础统计图/L1_density_code.R","source_sha256":"6c378e562da381ecd4bb32f575c6311025e2f344150b0c84ca38babe6e94043b","figure_ids":["fig_l1_density"],"fixture":{"exists":true,"kind":"internal_synthetic","paths":[]},"compat_pair":null,"execution_mode":"direct_exact_sha256","expected_outputs":["L1_density_verified.png","L1_density_verified.pdf"],"prior_executed_sha256":"6c378e562da381ecd4bb32f575c6311025e2f344150b0c84ca38babe6e94043b","prior_k40":"pass","blockers":["B3"]}
{"entry_id":"l1_groupedbar","category":"split_13","language":"r","role":"primary","script_path":"L1_基础统计图/L1_groupedbar_code.R","source_sha256":"cdf5dff2d0b040033e428968ad3ab6f4067fdedfc276b99053dda42c864f3c10","figure_ids":["fig_l1_groupedbar"],"fixture":{"exists":true,"kind":"internal_synthetic","paths":[]},"compat_pair":null,"execution_mode":"direct_exact_sha256","expected_outputs":["L1_groupedbar_verified.png","L1_groupedbar_verified.pdf"],"prior_executed_sha256":"cdf5dff2d0b040033e428968ad3ab6f4067fdedfc276b99053dda42c864f3c10","prior_k40":"pass","blockers":["B3"]}
{"entry_id":"l1_histogram","category":"split_13","language":"r","role":"primary","script_path":"L1_基础统计图/L1_histogram_code.R","source_sha256":"ba32de5540890ed6a23b6601d3c4f32f8e027dc35b2ed05480f31e096beffa81","figure_ids":["fig_l1_histogram"],"fixture":{"exists":true,"kind":"internal_synthetic","paths":[]},"compat_pair":null,"execution_mode":"direct_exact_sha256","expected_outputs":["L1_histogram_verified.png","L1_histogram_verified.pdf"],"prior_executed_sha256":"ba32de5540890ed6a23b6601d3c4f32f8e027dc35b2ed05480f31e096beffa81","prior_k40":"pass","blockers":["B3"]}
{"entry_id":"l1_rest","category":"extension_5","language":"r","role":"aggregate","script_path":"L1_基础统计图/L1_rest_code.R","source_sha256":"da21074542cef95ffa7c033a5b6bb291b49384f034b2ef9eb79e3322d98213e8","figure_ids":["fig_l1_histogram","fig_l1_density","fig_l1_scatter","fig_l1_groupedbar"],"fixture":{"exists":true,"kind":"internal_synthetic","paths":[]},"compat_pair":"_meta/R453_compat/L1_rest_code.R","execution_mode":"direct_exact_sha256","expected_outputs":["L1_histogram_verified.png","L1_histogram_verified.pdf","L1_density_verified.png","L1_density_verified.pdf","L1_scatter_verified.png","L1_scatter_verified.pdf","L1_groupedbar_verified.png","L1_groupedbar_verified.pdf"],"prior_executed_sha256":"da21074542cef95ffa7c033a5b6bb291b49384f034b2ef9eb79e3322d98213e8","prior_k40":"pass","blockers":["B3"]}
{"entry_id":"l1_scatter","category":"split_13","language":"r","role":"primary","script_path":"L1_基础统计图/L1_scatter_code.R","source_sha256":"5929584971504681ff374b2eed708f468ea9214605360c4450c037dfb4d56419","figure_ids":["fig_l1_scatter"],"fixture":{"exists":true,"kind":"internal_synthetic","paths":[]},"compat_pair":null,"execution_mode":"direct_exact_sha256","expected_outputs":["L1_scatter_verified.png","L1_scatter_verified.pdf"],"prior_executed_sha256":"5929584971504681ff374b2eed708f468ea9214605360c4450c037dfb4d56419","prior_k40":"pass","blockers":["B3"]}
{"entry_id":"l1_violin","category":"extension_5","language":"r","role":"primary","script_path":"L1_基础统计图/L1_violin_code.R","source_sha256":"9470bc63b49396ee5fc0fe0725063254849047e37e2482799db7ba54979e259a","figure_ids":["fig_l1_violin"],"fixture":{"exists":true,"kind":"internal_synthetic","paths":[]},"compat_pair":"_meta/R453_compat/L1_violin_code.R","execution_mode":"direct_exact_sha256","expected_outputs":["L1_violin_verified.png","L1_violin_verified.pdf"],"prior_executed_sha256":"9470bc63b49396ee5fc0fe0725063254849047e37e2482799db7ba54979e259a","prior_k40":"pass","blockers":["B3"]}
{"entry_id":"l2_core","category":"extension_5","language":"r","role":"aggregate","script_path":"L2_组学常用图/L2_core_code.R","source_sha256":"d60ecbf24668aacf3498168ac4d7279bb9347f26c1e6106c548e87eba9bcc07b","figure_ids":["fig_l2_volcano","fig_l2_heatmap"],"fixture":{"exists":true,"kind":"internal_synthetic","paths":[]},"compat_pair":"_meta/R453_compat/L2_core_code.R","execution_mode":"direct_exact_sha256","expected_outputs":["L2_volcano_verified.png","L2_volcano_verified.pdf","L2_enrichment_verified.png","L2_enrichment_verified.pdf","L2_heatmap_verified.pdf"],"prior_executed_sha256":"d60ecbf24668aacf3498168ac4d7279bb9347f26c1e6106c548e87eba9bcc07b","prior_k40":"pass","blockers":["B3","B4"]}
{"entry_id":"l2_enrichment","category":"split_13","language":"r","role":"primary","script_path":"L2_组学常用图/L2_enrichment_code.R","source_sha256":"bed8048e178a6b62e6f6212dc4b9e702e9221ae6e1828d2f339bf9b0372e33f9","figure_ids":[],"fixture":{"exists":true,"kind":"internal_synthetic","paths":[]},"compat_pair":null,"execution_mode":"direct_exact_sha256","expected_outputs":["L2_enrichment_verified.png","L2_enrichment_verified.pdf"],"prior_executed_sha256":"bed8048e178a6b62e6f6212dc4b9e702e9221ae6e1828d2f339bf9b0372e33f9","prior_k40":"pass","blockers":["B3","B4"]}
{"entry_id":"l2_heatmap","category":"split_13","language":"r","role":"primary","script_path":"L2_组学常用图/L2_heatmap_code.R","source_sha256":"3daea9a96edf5b74ff01db57149ae4b0dd535cddc18b7226af10dddab17b8409","figure_ids":["fig_l2_heatmap"],"fixture":{"exists":true,"kind":"internal_synthetic","paths":[]},"compat_pair":null,"execution_mode":"direct_exact_sha256","expected_outputs":["L2_heatmap_verified.png","L2_heatmap_verified.pdf"],"prior_executed_sha256":"3daea9a96edf5b74ff01db57149ae4b0dd535cddc18b7226af10dddab17b8409","prior_k40":"pass","blockers":["B3"]}
{"entry_id":"l2_more","category":"extension_5","language":"r","role":"aggregate","script_path":"L2_组学常用图/L2_more_code.R","source_sha256":"0b5342dd0cac39eb87615aa1220d44c09c440b8801e93af288d9ab778f0c6c1d","figure_ids":["fig_l2_heatmap","fig_l2_umap","fig_l2_pca"],"fixture":{"exists":true,"kind":"internal_synthetic","paths":[]},"compat_pair":"_meta/R453_compat/L2_more_code.R","execution_mode":"direct_exact_sha256","expected_outputs":["L2_heatmap_verified.png","L2_umap_verified.png","L2_umap_verified.pdf","L2_pca_verified.png","L2_pca_verified.pdf"],"prior_executed_sha256":"0b5342dd0cac39eb87615aa1220d44c09c440b8801e93af288d9ab778f0c6c1d","prior_k40":"pass","blockers":["B3"]}
{"entry_id":"l2_pca","category":"split_13","language":"r","role":"primary","script_path":"L2_组学常用图/L2_pca_code.R","source_sha256":"013b73e0bdcdf98c6014c8d89709c1e4bc8753a7243f83e5902ec4d3284d2507","figure_ids":["fig_l2_pca"],"fixture":{"exists":true,"kind":"internal_synthetic","paths":[]},"compat_pair":null,"execution_mode":"direct_exact_sha256","expected_outputs":["L2_pca_verified.png","L2_pca_verified.pdf"],"prior_executed_sha256":"013b73e0bdcdf98c6014c8d89709c1e4bc8753a7243f83e5902ec4d3284d2507","prior_k40":"pass","blockers":["B3"]}
{"entry_id":"l2_umap","category":"split_13","language":"r","role":"primary","script_path":"L2_组学常用图/L2_umap_code.R","source_sha256":"be72b0a34e9a7b00d995d13f998c22f3e24c594bfced6bc0e759a3c5a1cd2a07","figure_ids":["fig_l2_umap"],"fixture":{"exists":true,"kind":"internal_synthetic","paths":[]},"compat_pair":null,"execution_mode":"direct_exact_sha256","expected_outputs":["L2_umap_verified.png","L2_umap_verified.pdf"],"prior_executed_sha256":"be72b0a34e9a7b00d995d13f998c22f3e24c594bfced6bc0e759a3c5a1cd2a07","prior_k40":"pass","blockers":["B3"]}
{"entry_id":"l2_volcano","category":"split_13","language":"r","role":"primary","script_path":"L2_组学常用图/L2_volcano_code.R","source_sha256":"8829922ca03484afccb9d5931d01691360eb39c10df6c07290f62351589990fe","figure_ids":["fig_l2_volcano"],"fixture":{"exists":true,"kind":"internal_synthetic","paths":[]},"compat_pair":null,"execution_mode":"direct_exact_sha256","expected_outputs":["L2_volcano_verified.png","L2_volcano_verified.pdf"],"prior_executed_sha256":"8829922ca03484afccb9d5931d01691360eb39c10df6c07290f62351589990fe","prior_k40":"pass","blockers":["B3"]}
{"entry_id":"l2p_dotplot","category":"split_13","language":"python","role":"primary","script_path":"L2_组学常用图/L2p_dotplot_code.py","source_sha256":"f03f820c0cb61bb92d4747711dd99b0828a3b950b321631b854534d7b02b8a71","figure_ids":["fig_l2p_dotplot"],"fixture":{"exists":true,"kind":"internal_synthetic","paths":[]},"compat_pair":null,"execution_mode":"direct_exact_sha256","expected_outputs":["figures/dotplot__L2p_dotplot_verified.png"],"prior_executed_sha256":"f03f820c0cb61bb92d4747711dd99b0828a3b950b321631b854534d7b02b8a71","prior_k40":"pass","blockers":["B3"]}
{"entry_id":"l2p_more","category":"runner_9","language":"python","role":"aggregate","script_path":"L2_组学常用图/L2p_more_code.py","source_sha256":"01d5bd21b306677947aa771ccc8f70b97d225919470d5f95536442c4ff8472e6","figure_ids":["fig_l2p_volcano","fig_l2p_dotplot","fig_l2p_violin"],"fixture":{"exists":true,"kind":"internal_synthetic","paths":[]},"compat_pair":null,"execution_mode":"direct_exact_sha256","expected_outputs":["L2p_volcano_verified.png","L2p_volcano_verified.pdf","figures/dotplot__L2p_dotplot_verified.png","figures/violin_L2p_violin_verified.png"],"prior_executed_sha256":"01d5bd21b306677947aa771ccc8f70b97d225919470d5f95536442c4ff8472e6","prior_k40":"pass","blockers":["B3"]}
{"entry_id":"l2p_umap","category":"runner_9","language":"python","role":"primary","script_path":"L2_组学常用图/L2p_umap_code.py","source_sha256":"64d5a860832237813e556edb7eb1b3de2edf386367d41dd69482ef38add72002","figure_ids":["fig_l2p_umap"],"fixture":{"exists":true,"kind":"internal_synthetic","paths":[]},"compat_pair":null,"execution_mode":"direct_exact_sha256","expected_outputs":["umap_L2p_umap_verified.png"],"prior_executed_sha256":"64d5a860832237813e556edb7eb1b3de2edf386367d41dd69482ef38add72002","prior_k40":"pass","blockers":["B3"]}
{"entry_id":"l2p_violin","category":"split_13","language":"python","role":"primary","script_path":"L2_组学常用图/L2p_violin_code.py","source_sha256":"64ba619196f58a783808f3ce1576e87a41e8f7563e8e6edcfe4ec7dd51ad9d51","figure_ids":["fig_l2p_violin"],"fixture":{"exists":true,"kind":"internal_synthetic","paths":[]},"compat_pair":null,"execution_mode":"direct_exact_sha256","expected_outputs":["figures/violin_L2p_violin_verified.png"],"prior_executed_sha256":"64ba619196f58a783808f3ce1576e87a41e8f7563e8e6edcfe4ec7dd51ad9d51","prior_k40":"pass","blockers":["B3"]}
{"entry_id":"l2p_volcano","category":"split_13","language":"python","role":"primary","script_path":"L2_组学常用图/L2p_volcano_code.py","source_sha256":"ce8a09237091d8ddd0621738414995778c747ff2f1b3e28fa6a92669b00e403f","figure_ids":["fig_l2p_volcano"],"fixture":{"exists":true,"kind":"internal_synthetic","paths":[]},"compat_pair":null,"execution_mode":"direct_exact_sha256","expected_outputs":["L2p_volcano_verified.png","L2p_volcano_verified.pdf"],"prior_executed_sha256":"ce8a09237091d8ddd0621738414995778c747ff2f1b3e28fa6a92669b00e403f","prior_k40":"pass","blockers":["B3"]}
{"entry_id":"l3_multipanel","category":"runner_9","language":"r","role":"primary","script_path":"L3_高级组合图/L3_multipanel_code.R","source_sha256":"2d57dfd823386971dfdd423af101da48a4c3db6d100729e428e4190e080213c1","figure_ids":["fig_l3_multipanel"],"fixture":{"exists":true,"kind":"external_csv","paths":["L3_高级组合图/input_data.csv"]},"compat_pair":null,"execution_mode":"direct_exact_sha256","expected_outputs":["L3_multipanel_verified.png","L3_multipanel_verified.pdf","L3_multipanel_report.txt"],"prior_executed_sha256":"2d57dfd823386971dfdd423af101da48a4c3db6d100729e428e4190e080213c1","prior_k40":"pass","blockers":["B6"]}
{"entry_id":"l3_sankey","category":"extension_5","language":"r","role":"primary","script_path":"L3_高级组合图/L3_sankey_code.R","source_sha256":"6c94fe74a10569e0b43ea0d79047a69156411d1883920eaf285234ae548438d8","figure_ids":["fig_l3_sankey"],"fixture":{"exists":true,"kind":"builtin_r_dataset","paths":["datasets::Titanic"]},"compat_pair":"_meta/R453_compat/L3_sankey_code.R","execution_mode":"direct_exact_sha256","expected_outputs":["L3_sankey_verified.png","L3_sankey_verified.pdf"],"prior_executed_sha256":"6c94fe74a10569e0b43ea0d79047a69156411d1883920eaf285234ae548438d8","prior_k40":"pass","blockers":["B3","B6"]}
{"entry_id":"compat_l1_boxplot","category":"runner_9","language":"r","role":"compat","script_path":"_meta/R453_compat/L1_boxplot_code.R","source_sha256":"c70390207ae5f949694bc8f352b61a8d8311729d76fa20e252fc6f0472e91ed0","figure_ids":["fig_l1_boxplot"],"fixture":{"exists":true,"kind":"internal_synthetic","paths":[]},"compat_pair":null,"execution_mode":"direct_exact_sha256","expected_outputs":["L1_boxplot_verified.png","L1_boxplot_verified.pdf"],"prior_executed_sha256":"c70390207ae5f949694bc8f352b61a8d8311729d76fa20e252fc6f0472e91ed0","prior_k40":"pass","blockers":["B1","B3","B5"]}
{"entry_id":"compat_l1_rest","category":"runner_9","language":"r","role":"compat","script_path":"_meta/R453_compat/L1_rest_code.R","source_sha256":"da21074542cef95ffa7c033a5b6bb291b49384f034b2ef9eb79e3322d98213e8","figure_ids":["fig_l1_histogram","fig_l1_density","fig_l1_scatter","fig_l1_groupedbar"],"fixture":{"exists":true,"kind":"internal_synthetic","paths":[]},"compat_pair":null,"execution_mode":"direct_exact_sha256","expected_outputs":["L1_histogram_verified.png","L1_histogram_verified.pdf","L1_density_verified.png","L1_density_verified.pdf","L1_scatter_verified.png","L1_scatter_verified.pdf","L1_groupedbar_verified.png","L1_groupedbar_verified.pdf"],"prior_executed_sha256":"da21074542cef95ffa7c033a5b6bb291b49384f034b2ef9eb79e3322d98213e8","prior_k40":"pass","blockers":["B3"]}
{"entry_id":"compat_l1_violin","category":"runner_9","language":"r","role":"compat","script_path":"_meta/R453_compat/L1_violin_code.R","source_sha256":"9470bc63b49396ee5fc0fe0725063254849047e37e2482799db7ba54979e259a","figure_ids":["fig_l1_violin"],"fixture":{"exists":true,"kind":"internal_synthetic","paths":[]},"compat_pair":null,"execution_mode":"direct_exact_sha256","expected_outputs":["L1_violin_verified.png","L1_violin_verified.pdf"],"prior_executed_sha256":"9470bc63b49396ee5fc0fe0725063254849047e37e2482799db7ba54979e259a","prior_k40":"pass","blockers":["B3"]}
{"entry_id":"compat_l2_core","category":"runner_9","language":"r","role":"compat","script_path":"_meta/R453_compat/L2_core_code.R","source_sha256":"d60ecbf24668aacf3498168ac4d7279bb9347f26c1e6106c548e87eba9bcc07b","figure_ids":["fig_l2_volcano","fig_l2_heatmap"],"fixture":{"exists":true,"kind":"internal_synthetic","paths":[]},"compat_pair":null,"execution_mode":"direct_exact_sha256","expected_outputs":["L2_volcano_verified.png","L2_volcano_verified.pdf","L2_enrichment_verified.png","L2_enrichment_verified.pdf","L2_heatmap_verified.pdf"],"prior_executed_sha256":"d60ecbf24668aacf3498168ac4d7279bb9347f26c1e6106c548e87eba9bcc07b","prior_k40":"pass","blockers":["B3","B4"]}
{"entry_id":"compat_l2_more","category":"runner_9","language":"r","role":"compat","script_path":"_meta/R453_compat/L2_more_code.R","source_sha256":"0b5342dd0cac39eb87615aa1220d44c09c440b8801e93af288d9ab778f0c6c1d","figure_ids":["fig_l2_heatmap","fig_l2_umap","fig_l2_pca"],"fixture":{"exists":true,"kind":"internal_synthetic","paths":[]},"compat_pair":null,"execution_mode":"direct_exact_sha256","expected_outputs":["L2_heatmap_verified.png","L2_umap_verified.png","L2_umap_verified.pdf","L2_pca_verified.png","L2_pca_verified.pdf"],"prior_executed_sha256":"0b5342dd0cac39eb87615aa1220d44c09c440b8801e93af288d9ab778f0c6c1d","prior_k40":"pass","blockers":["B3"]}
{"entry_id":"compat_l3_sankey","category":"runner_9","language":"r","role":"compat","script_path":"_meta/R453_compat/L3_sankey_code.R","source_sha256":"6c94fe74a10569e0b43ea0d79047a69156411d1883920eaf285234ae548438d8","figure_ids":["fig_l3_sankey"],"fixture":{"exists":true,"kind":"builtin_r_dataset","paths":["datasets::Titanic"]},"compat_pair":null,"execution_mode":"direct_exact_sha256","expected_outputs":["L3_sankey_verified.png","L3_sankey_verified.pdf"],"prior_executed_sha256":"6c94fe74a10569e0b43ea0d79047a69156411d1883920eaf285234ae548438d8","prior_k40":"pass","blockers":["B3","B6"]}
```

## Fixture 对账

| Fixture 类型 | 数量 | 说明 |
| --- | ---: | --- |
| `internal_synthetic` | 24 | 脚本在源码内构造 data.frame、矩阵、向量或 AnnData |
| `builtin_r_dataset` | 2 | `L3_sankey_code.R` 与 compat 版使用 `datasets::Titanic` |
| `external_csv` | 1 | `L3_multipanel_code.R` 使用 `L3_高级组合图/input_data.csv` |

已存在但未被使用的 fixture：

| 文件 | 当前读取者 |
| --- | --- |
| `L1_基础统计图/input_data.csv` | 无。L1 脚本忽略该文件 |
| `L2_组学常用图/input_data.csv` | 无。L2 与 L2p 脚本忽略该文件 |
| `L3_高级组合图/input_data.csv` | `L3_multipanel_code.R` |

这意味着 T-FT-02 的“fixture 已存在”必须分两层记录：

1. 脚本级实跑 fixture 已存在，27/27 可执行。
2. 生产项目数据 fixture 尚未接通，除 `L3_multipanel` 外都没有消费真实分析产物表。

## compat pair 关系

| compat 入口 | 主目录对应入口 | 哈希关系 | 是否需要 compat 才能运行 |
| --- | --- | --- | --- |
| `_meta/R453_compat/L1_boxplot_code.R` | `L1_基础统计图/L1_boxplot_code.R` | 不同 | 是，主版写死 `/tmp/figlib` |
| `_meta/R453_compat/L1_rest_code.R` | `L1_基础统计图/L1_rest_code.R` | 完全相同 | 否 |
| `_meta/R453_compat/L1_violin_code.R` | `L1_基础统计图/L1_violin_code.R` | 完全相同 | 否 |
| `_meta/R453_compat/L2_core_code.R` | `L2_组学常用图/L2_core_code.R` | 完全相同 | 否 |
| `_meta/R453_compat/L2_more_code.R` | `L2_组学常用图/L2_more_code.R` | 完全相同 | 否 |
| `_meta/R453_compat/L3_sankey_code.R` | `L3_高级组合图/L3_sankey_code.R` | 完全相同 | 否 |

## 产物与使用单元

既有 K40 运行产物统计：

| 指标 | 数值 | 结论 |
| --- | ---: | --- |
| 非隔离入口执行数 | 27 | 全部 exit 0 |
| 入口级 artifact pass | 27 | 全部通过当前弱校验 |
| 产物总数 | 78 | 含 PNG、PDF、TXT |
| PNG | 41 | 全部通过 PIL 解码与非空白检查 |
| 唯一 PNG SHA256 | 21 | aggregate 与 compat 重复渲染 |
| PDF | 36 | 仅头部检查 |
| TXT | 1 | `L3_multipanel_report.txt` |
| contact sheet | 1 | QA only，不属于交付单图 |

单图使用口径已经满足。aggregate 入口虽然一次执行产出多张图，但每张图独立保存，没有任何入口要求把多图合并成一张交付图。

## T-FT-02 执行前必须处理的顺序

1. 先关闭 T-FT-01。将 `L1_基础统计图/L1_boxplot_code.R` 和 `_meta/R453_compat/L1_boxplot_code.R` 的第二处 `tip.length = 0.01` 改为 `0`，更新两者 SHA256，重新生成箱线图产物。
2. 修正主目录箱线图的输出路径。推荐读取 `R453_OUT_DIR`，未设置时回退到脚本目录，禁止写死 `/tmp/figlib`。否则主入口无法满足 exact SHA256 与工作区隔离同时成立。
3. 为 26 个硬编码 seed 42 的入口决定处理策略。若 T-FT-02 只记录历史实跑，需要明确标记 `seed_mode=hardcoded_42`。若按 aims 的 `seed=20261013` 验收，则必须在执行证据中写明脚本实际没有读取 `BIOANALYS_SEED`，不得写成外部 seed 已验证。
4. 先决定 `L2_enrichment` 的正式 figure id。当前它可以出图，但 `figure_ids=[]`。建议在 T-FT-03 绑定为 `fig_l2_enrich_bubble`，或在矩阵中显式标 `unmapped`。
5. 在每个入口独立 run 目录执行。R 脚本使用 `Rscript --no-save --no-restore --no-site-file --no-environ`，Python 使用 `/root/venvs/bio-py/bin/python3`。
6. 每个入口必须记录 marker、exit code、source SHA256、执行副本 SHA256、seed 实际来源、fixture SHA256、每个产物 SHA256、PNG 宽高、PNG DPI、像素方差、PDF 头和回传哈希。
7. 生成 `reference/05.可参考出图代码/_meta/script_plot_matrix.json` 时，27 个入口必须一一对应，不得把 aggregate 或 compat 证据合并成模糊 runner 状态。
8. 只有上述矩阵落盘并通过 strict 校验后，T-FT-02 才能由未完成改为完成。

## T-FT-02 建议字段映射

| 建议字段 | 本报告来源 | 要求 |
| --- | --- | --- |
| `entry_id` | `entry_id` | 27 个稳定 ID |
| `script_path` | `script_path` | 相对 reference root |
| `source_sha256` | `source_sha256` | 实跑前重算 |
| `language` | `language` | `r` 或 `python` |
| `role` | `role` | primary、aggregate、compat |
| `figure_ids` | `figure_ids` | 无映射时写空数组并加 `unmapped=true` |
| `fixture` | `fixture` | 记录类型、路径与 SHA256 |
| `compat_pair` | `compat_pair` | 仅记录实际需要的兼容关系 |
| `execution_mode` | `execution_mode` | `direct_exact_sha256` 或明确列出改写项 |
| `expected_outputs` | `expected_outputs` | 每项写文件名、类型、SHA256、尺寸 |
| `k40_exit_code` | 新实跑 | 必须为 0 |
| `marker_found` | 新实跑 | 必须找到 `RENDER_OK` |
| `seed_mode` | 源码核对 | 记录 hardcoded、external 或 unsupported |
| `blockers` | `blockers` | 不得把 B1、B2、B4 静默标成 ready |
| `evidence_run_id` | 新实跑 | 指向完整台账 |

## 完成判据核对

| 判据 | 当前状态 | 证据 |
| --- | --- | --- |
| 27 个非隔离入口全部识别 | 通过 | 本报告 27 行 |
| 27 个入口 source SHA256 固定 | 通过 | 当前文件哈希与既有 payload 一致 |
| 27 个入口有前序 K40 实跑 | 通过 | 27/27 exit 0、marker true、artifact pass |
| 27 个入口 direct exact 证据 | 未通过 | 26 direct，1 个需要 adapted copy |
| 正式 `script_plot_matrix.json` 落盘 | 未通过 | 文件不存在 |
| 箱线图纯水平横线 | 未通过 | 主版与 compat 版各有一处 `tip.length = 0.01` |
| 所有硬编码 seed 消除 | 未通过 | 26 个入口硬编码 seed 42 |
| 富集图正式模板映射 | 未通过 | `L2_enrichment` 无 figure id |
| PNG 300 DPI 证据 | 未通过 | 当前仅宽高，无 DPI 元数据 |
| PNG 像素方差数值 | 未通过 | 当前仅非空白布尔结论 |
| PDF 完整校验 | 未通过 | 当前仅头部检查 |
| 单图使用口径 | 通过 | 每张 PNG/PDF 独立列示，contact sheet 为 QA |

## 最终计数

| 问题 | 数量 |
| --- | ---: |
| 非隔离代码入口 | 27 |
| 可复用历史 K40 通过证据的入口 | 27 |
| 可直接 exact SHA256 执行的入口 | 26 |
| 无法按原始字节直接实跑的入口 | 1 |
| 需要主入口 compat pair 的入口 | 1 |
| 硬编码 seed 42 的入口 | 26 |
| 使用外部 seed 的入口 | 1 |
| 内部合成 fixture 的入口 | 24 |
| 内置数据集 fixture 的入口 | 2 |
| 外部 CSV fixture 的入口 | 1 |
| 未映射正式 figure id 的入口 | 1 |
| 仍违反 G4 箱线图横线要求的源文件 | 2 |
| 正式 `script_plot_matrix.json` 是否存在 | 否 |

最终判定：27 个入口具备明确的脚本级前序实跑基础，但 T-FT-02 当前仍为未完成。当前无法直接实跑的历史入口数量为 1，即 `L1_基础统计图/L1_boxplot_code.R`。在修正 G4、建立正式矩阵、补齐 DPI、像素方差、产物哈希与回传哈希之后，27 个入口才可以进入最终 strict 验收。
