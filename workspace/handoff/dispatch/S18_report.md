# S18 报告 · line3 首张组合图 `l3_20_domain_panel.png`（Step 5 第三单）

> 切片：S18（Step 5 组图契约第三单，line3 第一张组合图）。执行者：子 Agent（profile sw-engineer）。
> 日期：2026-10-20。**本切片在任务项 1（读码确认面板）即触发派发单预设的阻断条款，
> 未做任何代码改动、未部署、未重跑、未审计。** 本文件按进度追加，最后一段是完整回报。

## 0. 任务理解（照派发单，不改口径）

- 只改 `src/line3_spatial/scripts/spatial_figures`（新增组合图段）+ `BioanalysDesktop/server/figures.js`
  （只加一条 `l3_20_domain_panel` caption 登记）。
- 组合图三面板：A=空间域散点（`l3_01_*`）、B=HE 形态学图（`l3_02_*`）、
  C=各空间域乳酸化评分差异（`l3_03_*`）；横版 GridSpec；共享域色码图例下方居中一次。
- 派发单明文：「先读脚本确认这三个面板对应的真实图名……**若某面板在脚本里不存在，
  停下来上报，不要自己造一个等价物**」。
- 跑场 `default` 项目，契约主体是 `con_hf/2026-10-19_figure_polish_plan.md` G1–G5，验收 A1–A8。

## 1. 读码与面板映射确认（已完成 —— 这是本切片唯一完成的步骤）

`src/line3_spatial/scripts/spatial_figures`（bash 包装 + 单块 PYSCRIPT heredoc，426 行，
md5 `1fd7ab9107603775bae9c31f669e4019`，本地 = 远端 `bin/line3_spatial/` 逐字节一致）实际产图：

| 脚本内图号 | 真实内容 | 与派发单面板的对应 |
|---|---|---|
| `l3_{sp}_01_domains_{sample}.png`（L252-272） | 逐样本空间域散点（域分类色，图例外置右侧） | **A 存在**；但是**逐样本**图（mouse 10 张 + human 5 张 = 15 张），不是单张 |
| `l3_{sp}_02_target_gene_{sample}.png`（L274-291） | 逐样本 target gene 表达空间散点（viridis） | **不是 HE 形态学图** —— B 面板所指内容在脚本中不存在 |
| `l3_{sp}_03_ko_dr_{sample}.png`（L309-324） | 逐样本 KO DR 表达空间散点（magma） | **不是评分箱线/小提琴** —— C 面板所指内容在脚本中不存在 |
| `l3_{sp}_08_target_gene_by_domain.png`（L293-307） | 各域 target gene 均值**横向条形图** | 域级统计视图，但非 score 分布图 |
| `l3_{sp}_09_ko_dr_by_domain.png`（L326-338） | 各域 KO DR 均值横向条形图 | 同上 |
| `04_morans_top` / `05_knockout_dr` / `06_umap_sample` / `07_domain_composition` | Moran's I top20 / KO DR top10 / 按样本 UMAP / 域组成堆叠条 | 与 A/B/C 规格无关 |

line3 其余出图脚本（全目录 grep `savefig`，只有 4 个脚本出图）：
`enrichment_figures`（12_ora_top / 13_gsea_top）、`dr_post_analysis`（10_dr_gsea_top /
11_dr_overlap）、`celltype_annotation`（14_deconv_umap / 15_deconv_composition）。
**四个脚本里没有任何 H&E 图、没有任何"评分按域分布"图。**

证据（全部实测，非推断）：

1. **无 H&E 图**：`grep -in "h&e\|he_image\|tissue_lowres\|hi_res"` 在 line3 全部脚本中只命中
   `ingest_spatial` 的注释与装配逻辑——低倍组织图按 scanpy 约定存在
   `uns['spatial'][sample_id]['images']`（远端读 h5ad 实测 entry keys = `['images','metadata','scalefactors']`），
   但**没有任何出图脚本渲染它**。
2. **无乳酸化评分**：远端读 `spatial_knockout_mouse.h5ad` 的 obs 列为
   `barcode/sample_id/gsm/species/platform_id/strain/condition/condition_class/group/tissue/
   in_tissue/array_row/array_col/pxl_row_fullres/pxl_col_fullres/ncount/nfeature/total_counts/
   n_genes_by_counts/pct_mito/domain/domain_same_frac/domain_same_z/domain_rank/domain_prop/
   lr_score_recv/target_gene_expr/ko_dr_expr` —— **没有乳酸化/评分字段**。
   唯一的 spot 级打分是 `lr_score_recv`（`spatial_communication:558` 写入的配体-受体接收分），
   grep 证实四个出图脚本无一绘制它；`celltype_annotation` 的 `score_genes` 是 NNLS
   解卷积的内部验证分，也不出图。
3. **line3 现到 15 不是 19**：本地 `outputs/default/line3_spatial/figures` 69 张、
   远端 `projects/default/line3_spatial/figures` 69 张，最大序号均为 15
   （派发单「line3 现到 19，从 20 起」与实测不符；G3 顺延规则下应为 16）。
4. **default 项目 line3 空间链产物是 seed 20261013 算的**（与派发单「line3 产物是
   20261018 算的」不符）：远端 h5ad `uns.seed=20261013`、`knockout.seed=20261013`、
   `localization.seed=20261013`；`knockout_report.txt`/`localization_report.txt` 首行
   `seed=20261013`。注意 #199 中 20261018 指的是 `dr_post_analysis` 的
   `dr_enrichment*.tsv`（另一步骤、seed 敏感）；`spatial_figures` 是纯渲染步骤，
   种子只进 stdout 回显，不改 PNG 内容。
5. 本地与远端 `system_logs` 均**查不到 `spatial_figures` 的任务台账**
   （远端 201 个台账无匹配），磁盘 69 张图的原始运行台账不在档。

## 2. 阻断上报（按派发单预设条款执行，未造等价物）

**B 面板（HE 形态学图）与 C 面板（各空间域乳酸化评分差异）在 line3 全部出图脚本中不存在。**
按派发单「若某面板在脚本里不存在，停下来上报，不要自己造一个等价物」，本切片停止实现，
未写任何代码、未加 caption、未部署、未重跑、未跑三件套审计。

连带待决（都属于契约级冲突，须主 Agent 裁决，不由子 Agent 自行选边）：

1. **编号**：G3 要求"序号从该线当前最大号顺延"，实测 line3 最大 15 → 组合图应编 16；
   派发单写死 `l3_20_domain_panel.png`（会留 16–19 空号）。二者只能取一。
2. **物种约定**：line3 现存 69 张图全部带物种 token（`l3_mouse_*` / `l3_human_*`），
   派发单图名无物种 token。若沿用惯例应为 `l3_{sp}_20_domain_panel.png`（每物种一张）。
3. **A 面板逐样本**：`l3_01_domains_*` 是 15 张逐样本图，组合图需要样本选取规则
   （全部样本拼行？代表样本？），派发单未定义。
4. **图注口径**：派发单要求 caption 写"评分算法口径（line3 用了哪套 score）"，
   line3 无评分算法可照写。
5. **重跑种子**：派发单禁止 20261013（#199 同族）并要求 20261018，但 #199 的
   seed 敏感步骤是 `dr_post_analysis` 而非 `spatial_figures`；本步骤为纯渲染，
   两种子下 PNG 应字节相同（未实测，因为尚未重跑）。若主 Agent 要求留证，
   可由主 Agent 指定口径后补测。

## 3. 完整回报（按 SUBAGENT_CONTRACT 输出契约）

### 3.1 任务理解

在保留三张既有单图的前提下，于 `spatial_figures` 新增 line3 首张组合图
`l3_20_domain_panel.png`（A=空间域散点、B=HE 形态学图、C=各空间域乳酸化评分差异），
满足 G1–G5 并跑通三件套审计。**实际执行结果：任务项 1 即触发派发单预设阻断条款，
未进入实现。**

### 3.2 实现摘要

无实现。未修改任何源码、未新增 caption、未部署、未提交任务、未跑审计。
原因：派发单规格中的 B/C 两个面板在 line3 全部出图脚本中不存在对应图件，
按派发单「不要自己造一个等价物」条款停止。

### 3.3 文件变更清单

| 文件 | 变更 | 说明 |
|---|---|---|
| `con_hf/dispatch/S18_report.md` | 新建（本文件） | 读码结论 + 阻断上报 + 待决事项 |
| 其他 | **零改动** | 未触碰 `src/`、`figures.js`、`ops/`、任何数据与产物 |

### 3.4 接口与交互实现说明

无。未定义任何新接口；组合图所需的成员图有两项缺位，接口契约无法成立。

### 3.5 测试与验证记录（全部真跑，贴原文摘要）

1. `ls outputs/default/line3_spatial/figures`（本地）与
   `ssh k40-ubuntu 'ls /mnt/ssd/bio_data/projects/default/line3_spatial/figures'`（远端）
   → 各 69 张，最大序号 15（`l3_*_15_deconv_composition.png`）。
2. `grep -ln savefig src/line3_spatial/scripts/*` → 仅
   `celltype_annotation / dr_post_analysis / enrichment_figures / spatial_figures` 四个脚本出图。
3. `grep -in "h&e\|tissue_lowres\|hi_res\|lactylation\|lactate" src/line3_spatial/scripts/*`
   → H&E 仅命中 `ingest_spatial` 注释（图存 `uns['spatial'][*]['images']`，无图渲染它）；
   乳酸化相关 0 命中。
4. 远端读 h5ad：obs 27 列（无评分/乳酸化字段）、`uns['spatial']['BH001']` keys =
   `['images','metadata','scalefactors']`。
5. `md5sum` 本地 vs 远端 `bin/line3_spatial/spatial_figures` →
   两侧均 `1fd7ab9107603775bae9c31f669e4019`（426 行），排除"远端有隐藏新版"。
6. 远端 h5ad/report seed 实测：`uns.seed=20261013`、`knockout.seed=20261013`、
   `localization.seed=20261013`；`knockout_report.txt`/`localization_report.txt`
   `seed=20261013`。
7. `grep -rl spatial_figures` 本地/远端 system_logs → 无该步骤台账。

### 3.6 假设与风险

1. **假设（已证伪）**：派发单"line3 现到 19""line3 产物是 20261018 算的"
   "`l3_02_*` 是 HE 图""`l3_03_*` 是 score 箱线"—— 四条均与仓库/远端实测不符
   （见 §1 证据 1-4）。推测来源：把 line2 的号段与 S17 语境套到了 line3 上。
2. **风险（若强行实现）**：自造 H&E 面板需从 `uns['spatial']` 低倍图新起一张单图，
   自造 score 面板需先定义"乳酸化评分"口径（数据中不存在该量）——两者都会
   违反派发单"不要自己造等价物"与"禁止改统计口径/评分算法"。
3. **未验证**：组合图布局、G1/G2 探针、几何审计、打分 —— 全部未运行（无图可验）。

### 3.7 架构/接口变更建议

无（本切片未触架构）。附带一条观察：line3 图件带物种 token 而 line1/line2 组合图不带，
三线组图命名若要统一，宜由主 Agent 一次性定调，避免逐线漂移。

### 3.8 待主 Agent 决策事项

1. **B/C 面板缺位如何处置**（核心）：
   - 方案甲：改用 line3 现存图件重组三面板（如 A=`l3_01_domains_*`、
     B=`l3_07_domain_composition` 或 `l3_08/09_*_by_domain`、C=`l3_06_umap_sample`
     或 `l3_14_deconv_umap`），语义改为"域面板"，不动数据；
   - 方案乙：保留原语义，先立新切片补 H&E 单图（`uns['spatial']` 低倍图 + spot 叠加）
     与评分单图（需先定义评分口径，如 `lr_score_recv` 或 target gene 按域分布），
     再组图 —— 属范围扩大，需用户拍板评分口径。
2. **编号**：认 `l3_20`（G3 例外，留 16–19 空号）还是改顺延 `l3_16`？
3. **物种**：单图名不带物种（与 line3 69 张存量不一致）还是每物种一张
   `l3_{sp}_20_domain_panel.png`？
4. **A 面板样本选取规则**（逐样本图组图时必须定义）。
5. **重跑种子口径**：`spatial_figures` 为纯渲染步骤，种子只进 stdout；
   若沿用"与磁盘同种子"纪律，磁盘证据指向 20261013（h5ad/report），
   与派发单禁止项冲突 —— 请主 Agent 明确传哪个种子并说明理由。

### 3.9 建议下一步

主 Agent 就 §3.8-1 拍板面板方案后重派 S18（或拆分 S18a 补单图 + S18b 组图）；
在面板映射有脚本依据之前，不建议为了赶进度让子 Agent"先按最接近的图做着"——
那正是派发单明令禁止的造等价物。

