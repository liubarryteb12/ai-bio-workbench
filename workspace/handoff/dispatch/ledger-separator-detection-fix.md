2026-10-25 分隔符兼容修复（CSV 读取失败共性缺陷）

## 缺陷

12 个改造脚本的输入读取硬编码 read.delim（Tab 分隔），逗号分隔 CSV 被当成单列读入，触发列数校验失败并 exit 2。此前六项验收全部通过，原因是自建测试数据均使用 TSV，CSV 路径从未被覆盖。

## 修复方案

改为按内容探测分隔符，不按扩展名判断：

- 读文件前 5 个非空行，逐字符遍历，遇双引号翻转 inside_quote 状态，只累计引号外的分隔符出现次数，带引号字段内含逗号或分号不干扰判定
- 候选为 Tab、逗号、分号，对每个候选取各行计数的最大值，再跨候选取最大者胜出，该判据同时覆盖列数维度与跨行一致性
- 两个候选并列第一判为歧义，exit 2 并要求显式指定，不静默猜测；三个候选取值均为 0 同样 exit 2
- 空格不纳入自动探测，基因名与样本 ID 中空格过于常见，仅接受显式 --sep space
- 读取层由 read.delim 换成 read.table，探测值通过 sep 传入
- 读取成功后打印 sep_detected=<tab|comma|semicolon> 便于审计

范本为 survival_analysis（由 3.生存分析 改造任务的子代理先行实现），本次修复从其移植并适配各脚本的函数签名与错误处理函数。

## 涉及脚本与哈希

远端母版位置 /mnt/ssd/bio_data/bin/line1_bulk/，每个脚本均留 .bak_20261025_pre_sep_fix 备份，mode 755。

limma_deg_analysis 6cff75ba2859383e 改为 7ee8ecb66cfe7d02
roc_diagnostic_curve a06b66afa85607ba 改为 7f3302823e40f531
univariate_cox_screen 522081bbd6c0630d 改为 28047f18f45e1c6f
gsva_pathway_score c07a46b8a8885fc9 改为 ad79ff7380af23f3
geo_pca_scatter e5dce5b11e751d4a 改为 e8e26bca432f6ef1
lasso_cox_model a9bed7a27886fe94 改为 1524b5d9175acec9
wgcna_module_trait 17eaa18cd645da6a 改为 a66daa4a99b606e2
multivariate_cox_model fc263865a57daa59 改为 b6baa4bda4aa3f17
lasso_feature_select 13c9c083aa15dd21 改为 c01a603258fc545f
multi_metric_survival_roc 7f8c7cc47215a04a 改为 2aa66a258878ae6e
prognostic_diagnostic_roc e71cae9a59cb（改造上线版）改为 cc07de3f9d4d2fe7
survival_analysis c12bdcf4215e60af 改为 8d601b259e7f5370（由 3.生存分析 任务的子代理完成，本次未重复修改）

geo_tcga_common_deg 未纳入本轮，它已有按扩展名分支的 read.csv 与 read.delim，属可接受范式。

## 实测证据

以下均为 算力节点 实跑，Rscript 一律用显式路径 /mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript。

limma_deg_analysis 逗号 CSV：exit 0，sep_detected=comma 出现两次（表达式表与分组表各自探测），input_dimensions=8x8，产物 out_deg.tsv、out_significant_deg.tsv、out_volcano.png、out_report.txt 齐全。

limma_deg_analysis 制表符 TSV：exit 0，sep_detected=tab，input_dimensions=8x8。

分隔符等价性证据：同一份数据、同一种子、同一布局，仅分隔符不同，CSV 与 TSV 两条路径的 out_deg.tsv sha256 完全一致，均为 d9330e9e77387c2dced0431fa776eea7a9f1ab3b611b26226c20e2cf42611bee。说明分隔符只影响解析，不影响统计结果。

roc_diagnostic_curve 逗号 CSV：exit 0，sep_detected=comma 两次，input_dimensions=4x12，产物 out_auc.tsv、out_roc.png、out_report.txt 齐全。

univariate_cox_screen 带 sample_id 首列 CSV：exit 0，sep_detected=comma，sample_col=sample_id，input_dimensions=12x4，产物 out_univariate_cox.tsv、out_forest.png、out_samples.tsv、out_report.txt 齐全。证明分隔符探测与 --sample-col 机制无冲突。

geo_pca_scatter 逗号 CSV：exit 0，sep_detected=comma 两次，input_dimensions=8x8，group_levels=Ctrl,Treat，产物 out_scores.tsv、out_pca.png、out_report.txt 齐全。

gsva_pathway_score 逗号 CSV 表达矩阵加真 Tab 的 GMT 基因集：exit 0，sep_detected=comma，产物与 report 齐全。GMT 读取保持 read.delim 未改，因 GMT 为标准格式规定 Tab 分隔。

## 语法与回归检查

11 个 bash 加 R heredoc 结构脚本 bash -n 全部通过；prognostic_diagnostic_roc 为纯 R 脚本（shebang 指向 shim），R parse 通过。10 个母版脚本确认未被本轮触碰，grep detect_separator 均为未动。

## 未覆盖项

- 多字符分隔符如 :: 与固定宽度文件不在探测范围，需上游预处理
- 引号规则按 R 默认双引号转义，未实现嵌套引号与转义引号的完整 CSV 方言
- 编码假定 UTF-8，未探测 GBK
- 未显式剥离 BOM，带 BOM 的 CSV 首列名可能残留 BOM 字符

## 双端一致性缺口

本轮修复只落在远端 /mnt/ssd/bio_data/bin/line1_bulk/。本地工作区 src/line1_bulk/scripts/ 下的副本未能同步，原因是本地 exec 通道整轮不可用（helper_unknown_error）。远端为唯一母版且资产完整，服务不中断，但本地通道恢复后需补同步。
