2026-10-25 完成度审计与双端同步闭合

## 本轮发现并修复的关键缺口

完成度审计时逐项对比本地与 K40 的 17 个改造资产哈希，发现双端严重不同步：

in_sync 仅 1 个（survival_analysis）
differ 8 个（本地版本落后，仍是台账补齐与列名兼容之前的旧版）
remote_only 8 个（本地完全缺失，含 rf_gene_select、cibersort_reference、
oncopredict_ridge、drug_sensitivity_correlation 等本轮新增资产）

上一轮台账把这一项轻描淡写为「两个分组表工具未同步」，实际范围是 17 个改造资产
里的 16 个。这是审计的价值所在：不逐项比对哈希就发现不了。

### 修复过程

1. 发现 ops/sync_line1_assets.ps1 的资产清单只有 13 个，缺本轮新增的 4 个。
   补齐到 17 个。
2. 先 -CheckOnly 预演，确认 16 个待同步、0 个远端缺失。
3. 执行同步，16 个全部拉取成功。
4. 复跑 -CheckOnly，17/17 全部 IN_SYNC。
5. 抽查 3 个同步后脚本在 K40 实跑，确认功能未被破坏。

### 同步后功能回归

limma_deg_analysis exit 0，输出 sha256 与历史基线
57eed9a42fe0489c077b5496d6e7140fc559e7ab155d92b654beb8de3b888902 完全一致
geo_pca_scatter exit 0，PNG 正常
rf_gene_select exit 0，4 条 sha256 台账，top_gene=G1 正确识别注入信号

## 最终状态核验

K40 侧 17 个改造资产全部在位，CR 与 BOM 均为 0
本地侧 17 个脚本与 K40 哈希逐项一致
本地 5 个工具（build_grouping_master.py、grouping_master.py、scan_encoding.ps1、
fix_encoding.ps1、sync_line1_assets.ps1）均无 BOM、纯 LF
全库编码扫描 needing_action=0，1372 个文件全部合规

## 累计交付清单

### 改造资产（17 个，双端哈希一致）

gsva_pathway_score、lasso_cox_model、wgcna_module_trait、geo_tcga_common_deg、
limma_deg_analysis、roc_diagnostic_curve、geo_pca_scatter、univariate_cox_screen、
multivariate_cox_model、lasso_feature_select、multi_metric_survival_roc、
prognostic_diagnostic_roc、survival_analysis、rf_gene_select、
cibersort_reference、oncopredict_ridge、drug_sensitivity_correlation

全部含：--sample-col、种子契约、退出码分层、分隔符内容探测、sha256 产物台账、
原子写、读回自校验、PNG 魔数检查。

### 分组总表（6 张，validate 6/6 VALID）

PRJ_20261019_IS_lactylation 195 样本
PRJ_E2E_GSE277173 16 样本
default 16 样本
PRJ_20261020_DKD_bulk、DKD_scrna、RIF_spatial 空表待补录

配套 ops/build_grouping_master.py 与 ops/grouping_master.py，双端哈希一致。

### E2E 三层验证（20 项全过）

L1 七项：R 4.5.3 环境、PNG/PDF 出图、Python 侧出图、22 个 R 包、
scanpy 等 5 个 Python 包、出图模板挂载
L2 五项：limma、PCA、WGCNA 在真实 GEO 数据实跑，种子可复现，PNG 魔数
L3 八项：与母版统计对账、特征守恒、PNG 魔数、报告齐备、sha256 台账、
文本产物 LF、温度门禁

### 编码整顿

全库 needing_action=0，286 个文件已转 UTF-8 无 BOM 加 LF，原始文件备份在
ops/encoding_backup/。工具 ops/scan_encoding.ps1 与 ops/fix_encoding.ps1。

### 环境修复

R 4.3.3 已彻底删除，全线迁移到 R 4.5.3。shim 注入 R_PROFILE_USER 使出图模板
挂载生效。裸 Rscript 统一到 shim，消除登录 shell 命中 Termux R 4.6.1 的隐患。

## 经验记录

本轮最有价值的一条：上一轮的台账说「两个分组表工具未同步」，听起来是小遗漏，
实际逐项哈希比对后发现是 16 个资产未同步。台账的措辞会缩小问题的感知范围，
只有逐项比对才能得到真实范围。后续凡涉及双端一致，一律以哈希比对结果为准，
不以台账描述为准。
