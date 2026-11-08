2026-10-25 改造任务收尾总台账

## 本轮完成状态

交接时剩余 6 个改造任务（B 类 3 个加 C 类 3 个），本轮全部完成并验收。加上此前已完成的 15 个，K40 上线改造资产共 17 个，全部 mode 755，母版 10 个脚本完好未被触碰。

### 本轮新增 4 个

survival_analysis（3.生存分析，B 类）
rf_gene_select（30.随机森林筛选基因，C 类）
cibersort_reference（73.WGCNA筛选免疫调控基因，C 类，定性为 CIBERSORT）
oncopredict_ridge 与 drug_sensitivity_correlation（51 与 52，C 类，两个脚本）

### 环境修复 3 项

1. shim 注入 R_PROFILE_USER，解除出图模板不挂载的阻塞
2. Rprofile 修掉 ggsave 未传尺寸时的零长度条件报错
3. 裸 Rscript 路径统一，15 个生产入口改显式 shim，消除登录 shell 命中 R 4.6.1 的隐患

### 共性缺陷修复 1 项

12 个改造脚本硬编码 read.delim 导致 CSV 全部读失败，修为按内容探测分隔符。

## 17 个改造资产最终哈希（前 16 位）

gsva_pathway_score ad79ff7380af23f3
lasso_cox_model 1524b5d9175acec9
wgcna_module_trait a66daa4a99b606e2
geo_tcga_common_deg adfd8c4d3bc58735
limma_deg_analysis 7ee8ecb66cfe7d02
roc_diagnostic_curve 7f3302823e40f531
geo_pca_scatter e8e26bca432f6ef1
univariate_cox_screen 28047f18f45e1c6f
multivariate_cox_model b6baa4bda4aa3f17
lasso_feature_select c01a603258fc545f
multi_metric_survival_roc 2aa66a258878ae6e
prognostic_diagnostic_roc cc07de3f9d4d2fe7
survival_analysis 8d601b259e7f5370
rf_gene_select 03a3ceeae08a06b9
cibersort_reference 4bf0632f2c8ae7b8
oncopredict_ridge 9bd7f7d9cf74200c
drug_sensitivity_correlation 5107c0c54d24e647

部署根目录 /mnt/ssd/bio_data/bin/line1_bulk/。

## 依赖安装 6 个

randomForest 4.7-1.2（CRAN 阿里云）
e1071 1.7-17（CRAN 阿里云，连带 proxy）
locfit 1.5.9.12（CRAN 阿里云）
genefilter 1.92.0（Bioconductor）
edgeR 4.8.2（Bioconductor）
sva 3.58.0（Bioconductor）

后三个 Bioconductor 包采用分段下载加本地安装：R 原生 download 频繁超时，curl 秒下，再 install.packages 本地文件离线装。安装用 setsid nohup 后台执行避免 SSH 长连接中断。

## 两个重要的方法学结论

1. oncoPredict 官方包无法安装。它不在 Bioconductor 官方仓库，GitHub 上多个候选仓库地址全部 404，GitHub 搜索页与 API 均无结果。GDSC2_Expr.rds 训练矩阵也不在 K40。因此按已发表方法学自行实现 ridge 回归版本，脚本头部写明定位，报告固定 external_validation=not_performed。

2. 73 号目录定性修正。名义是 WGCNA，实际主代码是 CIBERSORT v1.03 免疫浸润评估。生产 WGCNA 已有 wgcna_module_trait，故将该脚本定位为离线算法参考并明确声明不上生产主线，未重复造 WGCNA。

## 本轮抓出并修掉的自身缺陷

这些缺陷都是实跑才暴露的，靠读代码发现不了，逐条记录以防复发：

1. MeanDecreaseAccuracy 自校验误判负值。该指标是置换后准确率下降量，为负属正常。
2. file.rename 返回值泄漏到 stdout 污染台账。
3. R 命名向量双方括号越界抛错走 exit 1 而非 exit 2，共三处（未知参数、非法 --sep、矩阵按列名取列）。R 的 [[ 对命名向量用不存在名字索引会抛 subscript out of bounds，不是返回 NA。
4. nu-SVR 支持向量系数与签名矩阵维度不匹配。
5. 支持向量索引取 rownames(fit$SV) 是局部序号而非原始行号，应取 fit$index。
6. stats::reshape 参数用错导致行数不匹配。
7. 关联分析脚本无法自动判断表达矩阵行列方向，用户记错布局即 exit 2。

第 3 条在本轮多个脚本反复出现，是最值得记的坑：凡是用命名向量做参数白名单或分隔符映射，必须先用 %in% 判断成员关系再索引。

## 一个假阴性诊断

CIBERSORT 最初测试得 SEED_MATTERS=NO，一度怀疑种子契约失效。排查确认是测试数据问题：信号极强时 p 值被置换次数的离散格点锁死，不同种子落在同一格点输出自然相同。改用高噪声数据并提高置换次数后，同种子复现与换种子变化均正常。此诊断避免误改正确代码。

## 本地一致性缺口（未闭合）

本轮所有脚本只落在 K40 的 /mnt/ssd/bio_data/bin/line1_bulk/。本地工作区 src/line1_bulk/scripts/ 的副本未能同步，本地 exec 通道整轮不可用（helper_unknown_error，exec 与 node_repl 均故障，属系统级进程创建问题）。

已准备好 ops/sync_line1_assets.ps1，含 17 个资产的哈希比对与拉取逻辑，支持 -CheckOnly 模式。本地通道恢复后执行即可闭合缺口：

pwsh -File ops/sync_line1_assets.ps1 -CheckOnly
pwsh -File ops/sync_line1_assets.ps1

K40 无回连 Windows 的路径（无 adb、/mnt 下仅 ssd、容器内代理端口不可达），无法由远端反向推送。

## 编码整顿（未开始）

CRLF 转 LF、GBK 转 UTF-8 的体检任务两次因子代理限流被打断，尚未执行。本地 exec 通道恢复后可先跑只读扫描产出待改清单，再分批转换。
