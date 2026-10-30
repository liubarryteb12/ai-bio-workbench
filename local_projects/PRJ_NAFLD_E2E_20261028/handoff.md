# 项目交接

## 项目背景

本项目用于验证 AI 辅助生信分析流程工作台的 line1_bulk 端到端能力。训练集为 GSE48452/GPL11532，包含 73 个肝脏活检样本，其中 Disease 32 个、Normal 41 个；独立外部验证集为 GSE89632/GPL14951，包含 63 个样本，其中 Disease 39 个、Normal 24 个。全流程固定随机种子 `20261013`，计算只在 K40 Linux 容器执行，本地负责提交、回搬与核验。

## 当前进度

- `probe_env` 与 15 个 line1_bulk 分析步骤已在 K40 实跑完成，共 16/16 个入口为 `completed / exit 0`。
- 训练矩阵为 19767 个基因、73 个样本；limma 在 BH 校正后为 0 个显著差异基因，最小 adj.P.Val 为 0.00032，最大绝对 log2FC 为 1.03，结果按真实值保留。
- WGCNA 使用方差最高的 5000 个基因，得到 22 个模块，其中 8 个模块与分组表型显著相关；`GSM1179010` 被标记为相关性离群，但按既定策略保留。
- 机器学习使用 9 个交集基因，最终核心 Hub 为 EXO1、KAT2A、MCM2、SNRNP70；73 样本结果仅作探索性证据。
- 独立外部验证只加载训练集冻结模型，未合并表达、未做跨平台 ComBat、未重选特征、未重训模型。9 个冻结特征中 8 个在验证平台可用，CDC45 用训练集均值补缺，基因覆盖率为 0.889。
- GSE89632 外部验证真实指标为 AUC 0.659、Accuracy 0.619、Balanced Accuracy 0.500、Sensitivity 1.000、Specificity 0.000、Brier Score 0.380952。该结果保留为真实外部表现，不通过反向调参修饰。
- `cox_analysis` 因 GSE48452 没有生存时间与事件终点，按契约输出 `SKIPPED_NO_SURVIVAL_ENDPOINT`，未伪造 Cox 结果。
- 142 个远端文件已回搬并通过字节校验，包括 72 个数据产物、38 个图件和完整机器台账；项目本地自包含目录已建立。
- Pi Agent 默认模型已切换为 `zai/glm-5.3-flash`，备用白名单为 `deepseek/deepseek-v4.1-flash`，服务端模型接口已实测返回新默认值。
- Pi Agent 只读专项审计任务 `task-8142b9861fac4279` 已完成，5 个审计项全部 PASS，1 项性能解释 WARN；报告见 `debug/pi_agent_nafld_readonly_audit_20261029.md`。

## 已知坑

- `prep_matrix` 的 grouping 文件存在每组一行和每样本一行两种结构，且芯片样本主键必须统一使用 GSM。旧解析器使用 GEO title 作为样本键，会让后续分组与矩阵连接失败。
- `qc_matrix` 发现的离群样本不能静默删除。本项目采用 `mark_only_not_removed`，`GSM1179010` 保留，QC 门禁为 `review_required`。
- KEGG 结果为空时仍会生成零字节 TSV，下游绘图必须把 `EmptyDataError` 当作可跳过的空结果，不能把空文件当成有效表。
- 不同表达平台禁止合并表达值后做 ComBat 再评估。外部验证只能用训练集冻结的标准化参数、系数与截距直接预测。
- 训练集只有 73 个样本，LOOCV 与特征筛选均可能过拟合，不能把 AUC 或外部单点指标表述为临床性能。
- 本数据集没有生存终点，Cox 回归不可执行。只有提供 `sample`、`futime`、`fustat` 的 `survival_meta.tsv` 后才可启用。
- Pi Agent 运行在 Termux 侧，读取 K40 容器文件必须通过 `proot-distro login ubuntu`。dispatch 旧上限 90 秒会早于慢任务完成，现已调整为 240 秒。

## 下一步

1. 若继续生物学解释，应优先复核 EXO1、KAT2A、MCM2、SNRNP70 的外部方向一致性与已有文献证据，不调整冻结模型。
2. 若需要 Cox 分析，先补齐合规生存元数据，再只重跑 `cox_analysis`。
3. 若需要提升泛化证据，新增独立队列后按相同冻结模型评估，禁止使用验证集重新选特征。
4. 项目资产索引使用 `python ops/ledger_indexer.py index --project-id PRJ_NAFLD_E2E_20261028` 刷新，交接完整性使用 `python ops/ledger_indexer.py --check-handoff --project PRJ_NAFLD_E2E_20261028` 校验。
