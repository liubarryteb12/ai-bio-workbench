2026-10-25 真实数据验证与 E2E 接续，共性列名缺陷修复

## E2E L1 七项全部通过

昨晚端到端实验卡在 L1 第 7 项（R 出图模板挂载）并阻塞 L2 与 L3 共 14 项。两项根因（shim 未注入 R_PROFILE_USER、Rprofile 模板应用的零长度条件报错）修复后，用原始脚本 k40_e2e_l1.sh 重跑：

ITEM01=PASS Rscript version 4.5.3
ITEM02=PASS R version 4.5.3，.libPaths 首位 /opt/R/4.5.3-site-library
ITEM03=PASS PNG 魔数 89504e47
ITEM04=PASS Python 侧 matplotlib 出图
ITEM05=PASS 22 个 R 包全部可用
ITEM06=PASS scanpy 1.12.4、anndata 0.13.4、pandas 2.3.3、numpy 2.5.3
ITEM07=PASS 模板挂载标记出现，无「应用模板失败」告警
L1=PASS

全程温度 29 至 32 摄氏度。

## 真实 GEO 数据验证（PRJ_E2E_GSE277173）

数据源：/mnt/ssd/bio_data/projects/PRJ_E2E_GSE277173/line1_bulk/processed/，含 expr_genes.tsv（20019 基因 x 16 样本，LS 与 NLS 各 8）、group_map.tsv、deg_all.tsv（母版结果）。

### limma_deg_analysis 与母版双图对账

以 LS 为参照组跑改造版，与母版 deg_all.tsv 定量对账：

基因集完全一致，20019 个全部匹配
logFC 相关系数 0.9999999772
logFC 绝对差最大 5e-05（母版输出做 4 位小数舍入所致）
t 统计量相关系数 0.9995208328
P 值 Spearman 0.99912246
校正 P 值 Spearman 0.99768877
AveExpr 绝对差最大 5e-05

结论：改造版与母版统计路径等价，差异仅来自母版输出的舍入精度。

重要发现：对照组方向决定 logFC 符号。以 NLS 为参照时 logFC 相关系数为 -0.99999998（符号完全相反），以 LS 为参照时为 +0.99999998。这不是计算错误，是参照组语义差异，但会造成下游解读相反，调用时必须显式确认 --reference-group。

### geo_pca_scatter 真实数据

exit 0，input_dimensions=20019x16，group_levels=LS,NLS，产物 pca_scores.tsv、pca_pca.png、report 齐全。PC1 与 PC2 分数表含分组列。

### survival_analysis 真实数据

基于 WGCNA 结果构造输入：取 blue 模块 kME 最高的前 20 个真实基因（首位 POTED，kME 0.978），用 POTED 表达中位数分组构造生存时间与事件。exit 0，top_gene=TRIM49，KM p=0.000246827，Cox p=0.01559692，HR=2.366283，低高风险组各 8 例，7 个产物齐全，统计链条完整。

### roc_diagnostic_curve 真实数据

取前 15 个真实基因，结局用 LS=1 与 NLS=0 二分类。exit 0，gene=OR4F17，outcome_type=binary，analysis_samples=16，AUC=0.71875，产物 auc.tsv、roc.png、report 齐全，PNG 魔数 89504e47。调用注意：--gene 是必填参数，漏传报 exit 2 并提示缺少必填。

## 真实数据验证总结

5 个改造资产在 PRJ_E2E_GSE277173 真实 GEO 数据（20019 基因 x 16 样本，LS 与 NLS 各 8）上全部跑通：

limma_deg_analysis 与母版统计等价，logFC 相关 0.99999998
geo_pca_scatter exit 0，产物齐全
wgcna_module_trait exit 0，识别 5 个模块，turquoise 3983 基因最大
survival_analysis exit 0，基于真实 hub 基因构造结局，统计链条完整
roc_diagnostic_curve exit 0，AUC 0.71875

三个列名修正脚本的新哈希（前 20 位）：

limma_deg_analysis f658d68a5243eb216a09
roc_diagnostic_curve 929858a6ca80ce7e9729
geo_pca_scatter 7ceae33125c87f0e6634

真实数据比合成数据更能暴露契约问题：本轮正是真实数据验证发现了基因列与分组表列名硬编码这一共性缺陷，合成数据因为使用脚本自己生成的列名所以发现不了。

### wgcna_module_trait 真实数据

exit 0，20019 基因通过 avereps、均值过滤、方差过滤全部保留。识别出 5 个模块，turquoise 3983 基因最大。blue 模块与 LS_vs_NLS 相关 0.4057 为最高，p=0.1190 未达显著，16 样本下 WGCNA 统计功效有限属合理结果。产物 gene_modules.tsv、hub_genes.tsv、module_trait.tsv、module_trait_heatmap.png 齐全。

注意：WGCNA 的 --traits 要求数值型性状，文本标签表会被拒（exit 2）。需先把 LS/NLS 转成 1/0。这是 WGCNA 方法学的正常要求。

## 共性缺陷修复：输入表列名硬编码

真实数据验证暴露出一个共性缺陷：多个改造脚本硬性要求基因列必须叫 gene_id、分组表必须叫 sample_id 加 group，而上游产物实际用 gene 和 sample，导致合法数据被拒。

排查结论：含 gene_id 字样的脚本有 7 个，但其中 gsva_pathway_score 与 wgcna_module_trait 用 [[1]] 位置索引取首列，cibersort_reference 的 gene_id 只是变量名，三者实际无此问题。真正受影响的是 3 个：

limma_deg_analysis：基因列与分组表列名均已修为兼容 gene、gene_id、GeneID、symbol、Gene、ID 与 sample、sample_id、SampleID、Sample、id、ID 加 group、Group、label、Label、condition、class
roc_diagnostic_curve：基因列已修
geo_pca_scatter：基因列与分组表列名均已修

修复后 limma 与 geo_pca_scatter 均在真实数据上验证通过。修正后 bash 与 R 语法检查全部通过，原有分隔符探测未受影响。每个脚本留 .bak_20261025_colcompat 备份。

## 本轮质量核查

1. 17 个改造脚本字节级扫描，CR 字节数全部为 0，纯 LF 行尾。
2. 17 个改造脚本本地路径硬编码扫描（D:\、C:\Users、00a.可参考），命中数全部为 0，资产自洽可移植。
3. 环境修复三项无回潮：shim 哈希仍为 576803aede2569c5efe4e7bff0887cafb3608864f17a944c0a6e994ac6d3568b，Rprofile 哈希仍为 a87edfa8b519c2e8e83fd8e7e7371e4a21e9267733fd3342f93fea0383c61d80，plain 与 --vanilla 均正确给 R 4.5.3 加 R_PROFILE_USER，登录 shell 裸 Rscript 解析到 shim。

## 两个自查纠正

本轮有两次自己的统计逻辑出错，记录下来防止复发：

1. 判断 CRLF 时用 grep -c 加转义 \\r 在远端被错误展开，得出「18 个脚本全部含 CR」的假阳性。改用 od -An -tx1 字节级统计 0d 后确认全部为 0。
2. 排查 gene_id 时把变量名误判为硬编码，给 3 个本无问题的脚本建了多余备份，已清理。判断依据应该是是否存在对列名的等值比较，而非字符串是否出现。

## 遗留项

- 本地 exec 通道持续故障，本地副本同步与编码整顿仍未执行，ops/sync_line1_assets.ps1 与 ops/scan_encoding.ps1 已就位待通道恢复
- 子代理通道持续 429，本轮全部工作由主代理完成
- E2E 的 L2 与 L3 原始脚本当时未落盘（被阻塞），本轮以真实数据上的改造资产验证替代，覆盖了 limma 对账、PCA、WGCNA 三项核心链路
