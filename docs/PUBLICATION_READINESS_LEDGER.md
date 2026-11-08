# 非肿瘤非免疫发表准备度复核台账

日期 2026-11-08｜复核对象 L1 bulk / L2 scRNA / L3 spatial 共 54 个模块与项目 `PRJ_DCM_BENCH_20261105`

## 1. 裁决

本报告以当前仓库代码、模块注册表、项目适配器产物和门禁实测为准，外部审核只作为风险清单参考。

**当前工作台是功能覆盖较宽的探索性平台，不是可直接满足绝大多数中高分非肿瘤非免疫文章发表要求的成品流水线。**

- 工程功能覆盖：L1 15 个模块，L2 22 个模块，L3 17 个模块，合计 54 个模块。
- 适用场景：流程贯通演示、候选基因发现、图件生成、方法学对照、探索性公共数据重分析。
- 2 到 4 分探索性文章：补齐独立 GEO 队列或实验验证后，可作为主体分析。
- 5 到 8 分、2 区专业期刊：当前不足，需先完成 P0 与 P1 核心补强。
- 8 分以上、1 区或机制型文章：当前差距明显，需多中心队列、空间样本重复、正式 ortholog、病灶梯度、实验验证与机制闭环。

## 2. 外部审核中成立的风险

| 风险 | 当前证据 | 判定 |
| :--- | :--- | :--- |
| L1 冻结模型依赖断裂 | 审核时 `ml_model` 写 `external_frozen_model.tsv`，`external_validation` 定义 `parse_frozen_model` 但未调用，仍用 `StratifiedShuffleSplit` 内部留出 | 当时成立，已在 P0 修复 |
| L1 真正外部队列不足 | 无第二数据集时仍写 `validation_type=internal_holdout_approximation` | 数据边界成立；代码已支持 `external_cohort_frozen`，仍需外部数据集 |
| L2 逐细胞 Wilcoxon 伪重复 | 审核时 `deg_groups` 只有 `rank_genes_groups(method='wilcoxon')` | 当时成立，已在 P0 补 donor × celltype pseudobulk，并把逐细胞结果降级为探索性 |
| L2 缺常态化 doublet 模拟与 ambient RNA 清洗 | 项目 QC 默认 `BIO_QC_SCRUBLET=0`，报告如实写未做 doublet 检出 | 成立，列入 P1 |
| 非肿瘤专属机制面板不足 | L2 已有可配置 GSVA，但铁死亡、自噬、ER stress、SASP、线粒体、脂质代谢未作为默认策划库和跨线评分 | 成立，列入 P1 |
| L2 到 L3 规则与实现分叉 | 审核时 `workflows.json` 与 `docs/isolation.md` 禁止跨线取参考，项目适配器实际读取 Line 2 `signatures.tsv` | 当时成立，已在 P0 改为受控桥接事实源 |
| L3 缺病变梯度、niche、空间轨迹 | 当前有像素 KNN 空间通讯，未定义 lesion distance gradient 模块 | 成立，列入 P1 |
| 跨线叙事未成为一等公民 | L1 hub 到 L2 细胞类型到 L3 空间定位在报告里可解释，但注册表无受控跨线 DAG | 成立，列入 P1 |

## 3. 外部审核中已过时或需改写的条目

| 外部主张 | 当前事实 |
| :--- | :--- |
| L1 缺 DCA / Nomogram | `ml_diagnostics` 已实现 DCA、校准、概率分布、Platt 敏感性曲线；Nomogram 按 `min_class>=40` 与 `EPV>=10` 门槛跳过，不是漏做。DCA 当前是负结果：5% 到 20% 区间 raw 与 Platt 都未高于 treat-all |
| L1 把原始 counts 直接喂 limma | `prep_matrix` 已支持 `counts_rnaseq` 到 CPM 到 `log2(CPM+1)`，`deg_limma` 有 `q75>50` 尺度守卫。缺口是 voom / DESeq2 分支，不是当前跑批 live bug |
| L3 完全不用空间坐标 | 母版默认旧路径仍成立，但项目适配器报告记录 `native_cKDTree`、6 邻空间图、47 个域；核心图件已按项目链重渲染 |
| L3 自签名自解卷积 | 母版 `celltype_annotation` 仍明确写域 marker 自签名；项目 `deconv_visium.sh` 读 Line 2 `signatures.tsv`，9 类细胞、14,678 个匹配基因、7,078/7,078 NNLS 求解 |
| 必须上 RCTD / Cell2location | 与 8GB ARM 生产面硬件红线冲突。当前正确路线是提纯 marker、正式 ortholog、外部参考图谱、轻量 `scipy.optimize.nnls` 与充分验证 |
| 缺 SVM / XGBoost 是发表硬伤 | 现有 LASSO、RFE、RF、SHAP、Firth、DCA、校准已能构成常规诊断模型框架；多模型堆叠是加分项，不是硬指标 |
| 无条件加 ComBat 即可 | 当前 DCM 基准分组与队列高度共线，直接 ComBat 会把疾病信号一起抹掉。正确路线是干净单队列、队列协变量或多中心 batch-aware 设计 |

## 4. 当前功能覆盖判断

| 线 | 工程覆盖 | 发表级短板 |
| :--- | :--- | :--- |
| L1 bulk | 中高：差异、WGCNA、PPI、ML、校准、DCA、内部留出、可选冻结外部验证、Cox、图件齐全 | 独立验证数据集、多队列接入、counts voom/DESeq2 分支、非肿瘤机制评分、临床可用模型证据 |
| L2 scRNA | 高：QC、Harmony、注释、组成、逐细胞 DEG、pseudobulk、富集、DPT、LIANA、GSVA、SCENIC、虚拟敲除、DR 后分析 | doublet、ambient RNA、单细胞代谢流、人工注释门禁；pseudobulk 的 R 后端可用性需在目标项目上实测 |
| L3 spatial | 中：空间域、Moran's I、共现、通讯、NNLS、定位、KO、富集、图件 | 历史基准与母版双轨、ortholog、n=1 vs 1、病变梯度、niche、空间轨迹 |

## 5.1 2026-11-08 P0 补丁落地状态

本轮按上表裁决完成四项 P0 补强，并用 `GATE_ALL_OK 21 道全绿（262 秒）` 验证。

| P0 项 | 当前状态 |
| :--- | :--- |
| L1 冻结模型契约 | `external_validation` 新增 `external_cohort_frozen`，真正调用 `parse_frozen_model`；无独立验证集时保留 `internal_holdout_approximation`。`workflows.json` 已声明冻结模型为可选模式 |
| L2 donor × celltype pseudobulk | `deg_groups` 新增 `deg_pseudobulk_by_celltype.tsv`，逐细胞 Wilcoxon 保留但标注 `exploratory_cell_level`；R 后端按 DESeq2、edgeR、limma-voom 顺序探测，fallback 明确只能筛选 |
| 受控 L2 到 L3 桥 | `docs/isolation.md` 升到 version 2，`workflows.json` 新增 `allowed_cross_series_bridges`，`ops/isolated_bridge_gate.mjs` 守事实源；默认仍 `forbidden_cross_series=true` |
| 母版 L3 空间图 | `spatial_domains` 默认使用 `obsm['spatial']` 的 cKDTree 6 邻图，`BIO_SPATIAL_GRAPH=0` 才走旧纯表达 PCA Leiden 对照；BANKSY 保持独立特征平滑 |

补充说明：`deg_groups` 因新增 R 后端成为第 5 个 bilingual 母版，已补 `bridge_guard.sh` 前置调用；`task_comment_strip` 与 `bridge_guard_invariant` 契约同步为五个 bilingual 母版。三个新增 P0 母版与 K40 生产面已用 ADB 同源部署，57 个脚本逐字节一致。

## 5.2 项目内容消融（2026-11-08）

新增组件级消融实验，验证删除旧报告、legacy 图件、组图、旧来源配置与旧 SSH runner 后，客户端项目发现、图件清单、来源清单接口与出图门禁仍自洽。详细场景、删除清单与逐项验证见 `docs/PROJECT_CONTENT_ABLATION_REPORT.md`。

结论：五个消融场景全部通过，项目内容清理不影响分析功能与门禁判据。消融只在 `.tmp/project_content_ablation/` 的临时副本上进行，真实 `local_projects` 未改动。

## 6. 上下游依赖合理性

线内依赖总体通畅：L2 的注释到组成到 DEG 到富集、通讯、SCENIC、虚拟敲除、DR 后分析接口最完整。

L1 末端此前存在冻结模型断裂：`ml_model` 产冻结参数，`external_validation` 没有消费它。此项已由 P0 补丁修复。

L3 当前存在双轨：母版链是 13 域、自签名，项目链是 47 域、Line 2 签名。上一轮已把核心图件、来源清单和项目脚本对齐；本轮已把 `workflows.json` 与 `docs/isolation.md` 改为正式承认受控桥接，但历史基准仍保留旧路径作为执行事实，不作为后续项目输入契约。

跨线叙事的科研逻辑成立，受控桥接事实源已成立；一等公民级别的跨线 DAG 仍待 P1 完成。

## 7. 整改优先级

### P0，消除拒稿硬伤（已完成）

1. 修复 L1 冻结模型契约，区分 `internal_holdout_approximation` 与 `external_cohort_frozen`。
2. L2 新增 donor × celltype pseudobulk DEG，逐细胞 Wilcoxon 降级为探索性。
3. 正式定义受控 L2 到 L3 桥，更新 `workflows.json` 与 `docs/isolation.md`，记录参考来源、物种映射、版本、哈希和允许条件。
4. 母版 L3 空间域默认使用空间邻接图，纯表达 PCA Leiden 降级为显式对照。

### P1，达到 2 区发表主干（待办）

1. L1 增加多队列接入与 batch-aware 建模，避免无条件 ComBat。
2. 新项目默认启用 Scrublet 或等效 doublet 评分，SoupX / CellBender 视原始 droplet 可得性决定。
3. 内置非肿瘤机制 GMT 策划库，统一 L1 样本级、L2 细胞级、L3 spot 级 GSVA / ssGSEA 评分。
4. L3 增加病灶边界距离梯度、niche、空间轨迹。
5. 接入正式 ortholog 表，替换大写 symbol 同名映射。
6. 用受控跨线 DAG 把 L1 发现、L2 细胞解析、L3 原位构架串成可追溯叙事。

### P2，冲 1 区或机制型高影响力文章

1. 多切片、每组多生物学重复的空间队列。
2. 实验验证或独立临床队列。
3. 更高质量细胞类型参考与更充分的解卷积验证。
4. 机制实验或扰动证据，把虚拟敲除从计算模拟推进到可验证假说。

## 8. 与项目封存状态的关系

`FINAL_SEAL_REPORT.md` 声明 `PRJ_DCM_BENCH_20261105` 作为基准项目封存。本台账只修母版、注册表、治理文档和后续项目准入门槛，不改写基准项目的生物学结论，不在封存基准上继续声称新增科学发现。
