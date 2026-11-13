2026-10-25 基因表达与药物敏感性关联分析上线（52.oncoPredict包基因表达与药物敏感性）

## 与 51 的链路关系

本脚本是 oncopredict_ridge 的下游。51 负责用 ridge 回归预测目标队列的 IC50，本脚本负责解释哪些基因驱动了预测值。已用 51 的真实输出作为输入实测链路衔接，端到端跑通。

原交接计划中 52 的任务是「删未用的 ggExtra 依赖」。经核查，算力节点 上没有任何脚本引用 ggExtra，该包也未安装，因此该缺陷在本管线不存在，无需处理。真正的缺口是 52 描述的关联分析能力，本次补齐。

## 契约实现

- shebang 指向显式 shim /mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript
- 种子契约：BIOANALYS_SEED 优先，--seed 可覆盖，缺失或非整数 exit 3，允许负整数
- 退出码：0 成功，1 自校验失败，2 参数或输入契约违背，3 种子缺失或非法
- 输入读取按内容探测分隔符，与本轮其余脚本一致，预测表与表达矩阵各自探测
- 布局自动探测：未指定 --sample-col 时，用预测表的样本 ID 反推表达矩阵朝向，列表头重叠多判为 feature_rows，首列取值重叠多判为 sample_rows，并打印 layout_autodetected 供审计。指定 --sample-col 时按用户意图走
- 统计方法：Spearman 相关系数与 p 值，BH 法多重检验校正输出 q 值。选 Spearman 而非 Pearson，不假设线性关系与正态性，对小样本更稳
- 自校验覆盖：相关系数在 [-1,1]、q 值在 [0,1]、至少一个基因有有限相关性、表行数匹配特征数、两张 PNG 魔数
- 产物：相关性排序表、火山图、top 基因散点图、报告
- 原子写、读回自校验、产物 sha256 台账

## 算力节点 实测验收

部署位置 /mnt/ssd/bio_data/bin/line1_bulk/drug_sensitivity_correlation，mode 755，sha256 5107c0c54d24e6475567fcdbac39ed781243230f981e9e66eaaaa4480a756500。

1. 链路衔接：以 oncopredict_ridge 在 12 个目标样本上的真实预测输出为输入，exit 0。layout_autodetected=sample_rows_feature_columns，shared_samples=12，feature_count=30。4 个产物齐全，两张 PNG 魔数均为 89504e47。

2. 退出码矩阵 8 项全部达标：正常 0，缺种子 3，非整数种子 3，未知参数 2，缺必填 2，预测表不存在 2，--ic50-col 不存在列 2，--top-n 非正 2。

3. 种子可复现：同种子 20261025 两次运行，相关性表 sha256 一致，REPRODUCIBLE=YES。

4. 数据正确性：top_gene=G4，top_rho=-0.6993007，top_q=0.42806869。significant_gene_count_q05=0 属合理结果，因为目标队列 IC50 本身是预测值且样本仅 12 个，q 值达不到 0.05 阈值。相关性表 sha256 714aed3153db46b997149205472b646e8bb839469bd776bc71b24d57b8cb76ea。

5. 布局探测有效性：首次未传 --sample-col 时 shared_samples=0 并 exit 2，暴露用户记错布局就失败的问题；补布局自动探测后正确识别为 sample_rows 并跑通。

## 开发中修掉的两个自身缺陷

1. 矩阵列索引越界。aligned_expression[[gene_name]] 用双方括号按列名取值会抛 subscript out of bounds，因为双方括号对矩阵是按位置索引而非按列名。改为 aligned_expression[, gene_name] 单括号加逗号按列名取列。

2. 布局方向无法自动判断。用户未传 --sample-col 时脚本按 feature_rows 硬解，若实际是 sample_rows 布局则样本 ID 全不匹配，直接 exit 2。补了用预测表样本 ID 反推朝向的逻辑，并打印判定结果。

## 遗留项

- 本地工作区副本未同步，已提供 ops/sync_line1_assets.ps1 待本地 exec 通道恢复后执行
- 关联分析的解释力受样本量限制，12 样本下 q 值普遍不显著，需更大队列才能产出稳定结论
- 未做外部验证，预测 IC50 本身是模型输出，与之做相关性不等于独立验证
