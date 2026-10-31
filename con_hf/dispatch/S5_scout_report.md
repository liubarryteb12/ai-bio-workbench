# S5-scout 侦察报告 · Step 4「美化包替换点」清单

> 切片：S5-scout（只读侦察，不改代码）
> 执行：子 Agent · 2026-10-19
> 依据：`con_hf/dispatch/SUBAGENT_CONTRACT.md`、`con_hf/2026-10-19_figure_polish_plan.md`、`docs/figure_spec.md`（v2.2）、`con_hf/踩坑台账.md` #190 / #192、`con_hf/figure_manual_review.md`
> 本文件是本次唯一写入的仓库文件；`src/`、`ops/`、`docs/` 一字未改（见 §9 证据）。

---

## 1. 任务理解

主 Agent 要一份"哪些手搓出图实现可以换成已装包、换了有什么收益、有什么风险"的可执行清单，用于派发 S5 实施切片。本报告只做**侦察与排序**，不实施、不连远端、不跑分析脚本。

判定基线（来自 `docs/figure_spec.md`，下文简称"规范"）：

- §三之二：图内文字**不得互相重叠**，标签靠 `adjust_text` 自动避让；图例一律轴框外，**源级也不得写轴内 `loc`**。
- §三之三：**网络类节点标签必须自动避让**（`adjust_text`）；阈值标注固定贴左缘/顶缘。
- §二.3：箱线**须显示个体点**（n 小时必须）；热图行=基因列=观测，聚类树可选但须与数值口径一致。
- §三：二分类固定色 ctrl=`#3B4992` / case=`#EE0000`；连续量单色系 ramp（viridis 默认），禁彩虹。
- §八.2：出图代码**不得硬编码组名**。
- §七：B1-B4/D2/D3 只能来自机器判决，导不到即 UNVERIFIED。

---

## 2. 侦察范围与方法（A1）

### 2.1 出图脚本清单（三线共 21 个，与规范 §六 一致）

| 线 | 脚本 | 语言 | 图数 | 图类型 |
|---|---|---|---|---|
| line1_bulk | `bulk_figures` | Python | 9 | 相关性热图 / PCA 散点+置信椭圆 / 火山×2 / topvar 热图 / QC 条形×2 / MA×2 |
| line1_bulk | `pca_matrix` | **R ggplot** | 1 | `l1_02_pca_step3` 步骤级 PCA 散点 + `stat_ellipse` |
| line1_bulk | `deg_limma` | **R ggplot** | 1 | `l1_03_volcano_limma` 火山图 + `annotate` 阈值标注 |
| line1_bulk | `wgcna_modules` | **R base** | 4 | 软阈值双 panel（`mfrow`）/ 模块-性状 `labeledHeatmap` / 样本树+分组色条 / MM-GS 散点+文本标签 |
| line1_bulk | `ppi_string` | Python | 2 | PPI 网络（nx + adjustText + 边权 colorbar）/ hub 条形 |
| line1_bulk | `key_genes` | Python | 1 | 交集规模条形 |
| line1_bulk | `ml_model` | Python | 2 | ROC / 重要性双条形 |
| line1_bulk | `external_validation` | Python | 1 | 外部验证 ROC |
| line1_bulk | `ml_hub_analysis` | Python | 10 | LASSO 路径/ CV 曲线 / RFE 曲线 / 单因素条形 / 交集条形 / 重要性 / SHAP / SHAP 瀑布 / 聚类热图 / 共表达网络 |
| line1_bulk | `enrichment_figures` | Python | 4 | GSEA GO / 模块 ORA / KEGG ORA / KEGG GSEA（全 barh + 双标注） |
| line1_bulk | `cox_analysis` | **R base** | 1 | `l1_27` 森林图（本项目无生存数据 → 不产出） |
| line2_scrna | `scrna_figures` | Python | 28 | UMAP×4 / 堆叠组成 / 组成箱线×13 / marker 热图 / 火山×7 / 计数条形 / PCA |
| line2_scrna | `scenic_figures` | Python | 2 | regulon 活性热图 / 特异性条形 |
| line2_scrna | `gsva_pathways` | Python | 1 | GSVA 通路热图 |
| line2_scrna | `target_gene_localization` | Python | 1 | 目标基因 dotplot |
| line2_scrna | `enrichment_figures` | Python | 2 | ORA / GSEA barh |
| line2_scrna | `dr_post_analysis` | Python | 3 | DR GSEA barh / DR 调控网络（含 adjustText）/ 交集条形 |
| line3_spatial | `spatial_figures` | Python | 每物种：`01_domains`×n 样本、`02_target_gene`×n、`03_ko_dr`×n、`04_morans`、`05_knockout`、`06_umap`、`07_composition`、`08/09_by_domain` | 空间域散点 / viridis 表达图 / magma KO 表达图 / 条形 |
| line3_spatial | `celltype_annotation` | Python | 每物种 2 | 去卷积 UMAP / 域内 celltype 堆叠 barh |
| line3_spatial | `dr_post_analysis` | Python | 每物种 2 | DR GSEA barh / DR∩域 marker 条形 |
| line3_spatial | `enrichment_figures` | Python | 每物种 2 | 域 marker ORA / GSEA barh |

实测图件数（本地 `outputs/`，`ls …/*.png | wc -l`）：
`PRJ_E2E_GSE277173/line1_bulk = 33`、`line2_scrna = 37`、`line3_spatial = 69`（`default/line1_bulk = 29` 为旧基线）。

### 2.2 方法

1. 逐脚本通读 heredoc 内的出图块（不只看 grep 命中行），确认每张图的绘制路径。
2. 对每个候选点核对：规范条款 → 是否已有替代实现（同仓库其他脚本）→ 是否有已记录问题（台账/人工审查清单）。
3. 用 `grep` 做横向一致性核对（`adjust_text` 覆盖、`cmap` 分布、`loc=` 分布、图名字面量），结果作为"漏网点"的证据。
4. **未运行任何脚本**：`ops/audit_figure_layout.py --runner bash` 是真跑脚本并重写报告/图件（#190），本切片禁止。所有"当前是否 FAIL"的判断都标注为**未验证**。

---

## 3. 可替换点（按脚本组织，六要素齐全）

> 工作量口径：小 = ≤10 行；中 = 单图块重写但不动数据；大 = 需重写该图/换语言。
> 所有"包已装"均引自派发单声明（R patchwork 1.2.0 / cowplot 1.1.3 / aplot 0.3.2 / ggrepel 0.9.5 / ggsignif 0.6.4 / ComplexHeatmap 2.18 / viridis 0.6.5 / enrichplot 1.22；Python seaborn 0.13.2 / adjustText 1.4.0），**本任务未连远端核实**。

### 3.1 line1_bulk

#### S5-01 · `ml_hub_analysis` l1_24 共表达网络：节点标签缺自动避让 → `adjustText`

- **位置**：`src/line1_bulk/scripts/ml_hub_analysis:864`（图 `l1_24_corr_network.png`）
- **现状**：
  ```python
  nx.draw_networkx_labels(G, pos, ax=ax, font_size=8)
  ax.axis("off")
  ```
- **目标调用**：
  ```python
  from adjustText import adjust_text
  adjust_text(ax.texts, ax=ax, expand=(1.4, 1.6),
              arrowprops=dict(arrowstyle="-", color="0.75", lw=0.4))
  ```
  （与 `ppi_string:330-332`、`dr_post_analysis(l2):380-382` 完全同款）
- **理由**：规范 §三之三 硬规则"网络类节点标签必须自动避让"。三张网络图里 `l1_07`（`ppi_string:326-332`）与 `l2_16`（`dr_post_analysis:376-382`）都做了，**`l1_24` 是唯一漏网**。标签由 `draw_networkx_labels` 落在 `ax.texts`，几何审计 D 项（`ops/audit_figure_layout.py:82-90`，重叠 >6px² 判违规）可直接覆盖，属可机器判决项。
- **风险与回归面**：
  - 数值：**不改**（只挪文本位置；`spring_layout(G, seed=SEED)` 在 851 行已固定）。
  - 图幅：`layout_fix`→`fit_text_edges`（`ml_hub_analysis:280-320`）会把越出轴框的标签收进框内，靠**扩 xlim/ylim** 实现 → 标签被推远后可能触发扩轴，节点云整体缩放。`l1_07` 同样机制，属既有行为，但需目视确认图幅未被压扁。
  - 依赖：无新增（adjustText 已装，脚本内已有同类用法可参照）。
  - 确定性：同数据同种子可复现；**图件 md5 必变**（文本位移），须按"重渲染"登记，不得当"字节不变"。
  - 与 §三之三 的负对照：若回退这 4 行后审计**仍不报 D**，说明当前数据下标签本就不压字 → 只能宣称"补齐 §三之三 硬规则"，**不得宣称"修好了压字"**。
- **工作量**：小（+4 行）

#### S5-02 · `ml_hub_analysis` l1_23 聚类热图：手搓 gridspec+树+colorbar → `seaborn.clustermap`

- **位置**：`src/line1_bulk/scripts/ml_hub_analysis:807-844`（38 行）
- **现状**：
  ```python
  gs = fig.add_gridspec(3, 1, height_ratios=[1.1, 0.22, 3.2], hspace=0.06)
  d = dendrogram(link, ax=ax_d, no_labels=True, color_threshold=0)
  cax = fig.add_axes([0.90, 0.38, 0.018, 0.28])   # 840 行：必须在 subplots_adjust 之后建
  ```
- **目标调用**：
  ```python
  import seaborn as sns
  g = sns.clustermap(Z, row_linkage=link, col_cluster=False,
                     row_colors=pd.Series(y, index=core, name="group"),
                     cmap="RdBu_r", center=0, vmin=-2, vmax=2,
                     cbar_kws={"label": "expression z-score"},
                     dendrogram_ratio=0.12, colors_ratio=0.02, figsize=(...))
  ```
- **理由**：消掉 840 行"cax 必须在 `subplots_adjust` 之后建，否则位置被重排覆盖"这类位置魔法数（注释本身就在说这块很脆）；行/列对齐、树与热图间隙、colorbar 由库负责。规范 §二.3"聚类树须与数值口径一致"→ 传 `row_linkage=link` 即由构造保证与现状**同一棵树、同一叶序**。
- **风险与回归面**：
  - **必须传 `row_linkage=link`**：`clustermap` 默认 `method="average"/metric="euclidean"`，不传则叶序与现状（`linkage(Z, method="ward")`，494 行）不同，图与 ARI 说明对不上。
  - 数值：`link` 与 `ari`（494-496 行）不动 → `ml_core_hub_genes.tsv` 应字节不变（可作回归锚点）。
  - 图幅：figsize / 边距 / colorbar 位置全变，A-E 几何项需重审；`layout_fix` 对多轴图只做文本收边、不搬图例（`ml_hub_analysis:342-357`），组图例要挂到 `g.ax_col_colors` / `g.ax_heatmap` 手工给。
  - 依赖：seaborn 0.13.2（已装），`ml_hub_analysis` 现未 import seaborn。
  - 确定性：叶序由 `link` 决定 → 可复现；色条位置固定 → 无随机性。
- **工作量**：中（38 行 → 约 25 行，逐项对齐色条/图例/tick）

#### S5-03 · `bulk_figures` / `enrichment_figures` 热图：`imshow` 保留（不建议换 seaborn）

见 §4-N8，此处不重复。

#### S5-04 · `pca_matrix` l1_02_pca_step3：无样本标签 → `ggrepel::geom_text_repel`

- **位置**：`src/line1_bulk/scripts/pca_matrix:115-127`
- **现状**：
  ```r
  p <- ggplot(scores, aes(x = PC1, y = PC2, color = group)) +
    geom_point(size = 3) + stat_ellipse(aes(color = group), type = "norm")
  ggsave(pca_png, p, width = 6, height = 5, dpi = 300)
  ```
- **目标调用**：`+ ggrepel::geom_text_repel(aes(label = sample), size = 2.8, max.overlaps = Inf, show.legend = FALSE, seed = as.integer(seed))`
- **理由**：规范 §二.1 嵌入类"点=观测，颜色=分类标签，图例可读"；同一语义的 `l1_02_pca`（`bulk_figures:306-310`）已用 `adjust_text` 给样本标签，**步骤级图却无标签**，两图信息量不一致。ggrepel 满足 §三之二"图内文字不得互相重叠"，且是 R 侧唯一能落地的避让方案（`adjustText` 是 Python）。
- **风险与回归面**：
  - 数值：**不改**（只加文本层）；`pca_scores.tsv` 不受影响。
  - 图幅：`width=6` 装 16 个样本标签会挤，需放到 7×5.5（仍在 §一 12×8 基准内）；标签可能被 `ggsave` 裁边 → 落盘后需目视。
  - 依赖：ggrepel 0.9.5（已装）；**必须 `seed=`**，否则 ggrepel 的抖动不可复现（违反 §一元数据/可复现）。
  - `max.overlaps` 必须设 `Inf`：默认会**静默丢标签**，丢标签=信息缺失且不报错。
  - 判决面：R 图无几何审计（`figure_manual_review.md` §1），改完只能进人工清单 → 6 张变 7 张，状态仍为"未目视"。
- **工作量**：小（+1 行 + 图幅调整）

#### S5-05 · `deg_limma` l1_03_volcano_limma：无基因标签 → `ggrepel::geom_text_repel`（**需决策**）

- **位置**：`src/line1_bulk/scripts/deg_limma:115-145`
- **现状**：
  ```r
  p <- ggplot(deg_table, aes(x = log2FC, y = -log10(P_Value))) +
    geom_point(aes(color = is_sig), alpha = 0.6, size = 1.2) +
    geom_vline(xintercept = c(-logfc_cut, logfc_cut), linetype = "dashed")
  ```
- **目标调用**：
  ```r
  if (nrow(sig_table) > 0)
    p <- p + ggrepel::geom_text_repel(
      data = head(sig_table[order(sig_table$adj_P_Val)], 10),
      aes(label = gene), size = 2.8, max.overlaps = Inf, seed = as.integer(seed))
  ```
- **理由**：规范 §二.3 只要求"阈值线注明 + 轴标签带 ID 类型"，**未要求基因标签** → 这是**内容增补**，不是合规修复。价值在可读性（火山图不标基因时读者无法定位具体基因）。
- **风险与回归面**：
  - **必须先决策**：属"加内容"而非"换实现"，会改变图注与信息量；主 Agent 未批准前不得实施。
  - **0 显著是真实路径**：本项目 E2E 的 `deg_limma` 就是 0 显著（`deg_report.txt` 有专门分支，164-170 行），`sig_table` 为空时 `geom_text_repel(data = 空 df)` 会报错 → 必须加 `if (nrow(sig_table) > 0)` 守卫。
  - 依赖/可复现同上（`seed=` 必填）；R 图无机器判决，只能人工登记。
- **工作量**：小-中（+4 行含守卫 + 图注一行）

#### S5-06 · `wgcna_modules` l1_31 MM-GS 标签：**不换 ggrepel**（见 §4-N9）

#### S5-07 · `wgcna_modules` l1_29 模块-性状热图：**不换 ComplexHeatmap**（见 §4-N4）

#### S5-08 · `cox_analysis` l1_27 森林图：**不建议现在换**（见 §4-N11）

### 3.2 line2_scrna

#### S5-09 · `scrna_figures` l2_06 组成箱线（13 张）：手搓 boxplot+点 → `seaborn.boxplot` + `seaborn.stripplot`

- **位置**：`src/line2_scrna/scripts/scrna_figures:350-367`
- **现状**：
  ```python
  bp = ax.boxplot(data, tick_labels=labs, widths=0.5, patch_artist=True)
  for patch, col in zip(bp["boxes"], ["#4C72B0", "#C44E52"]): patch.set_facecolor(col)
  pts = ax.scatter(np.full(len(vals), j + 1), vals, s=18, color="k", zorder=3)   # 356 行：无抖动
  ```
- **目标调用**：
  ```python
  sns.boxplot(data=df, x="diagnosis", y="prop", ax=ax, width=0.5, showfliers=False,
              palette={"Healthy": "#3B4992", "Psoriasis": "#EE0000"})
  sns.stripplot(data=df, x="diagnosis", y="prop", ax=ax, jitter=0.12, size=4, color="k")
  ```
- **理由**：
  1. 规范 §二.3"箱线须显示个体点":现 356 行把点全部画在 `x = j+1` **同一竖线上**，同值点完全重合（供体 3 vs 5，见 `composition_report.txt:9` 的 `n_donors={'Healthy': 3, 'Psoriasis': 5}`，重合概率不低）；`stripplot(jitter=)` 才真正可读。
  2. 现面色 `#4C72B0/#C44E52` **违反** §三 / §八.5（ctrl=`#3B4992`、case=`#EE0000`）；同仓库 R 侧（`pca_matrix:110`、`deg_limma:118`）用的是规范色，同一交付内配色不一致。
- **风险与回归面**：
  - 数值：箱体统计口径不变（seaborn 默认 1.5×IQR 须线，与 `matplotlib.boxplot` 相同）；`prop` 矩阵计算（341-349 行）不动。
  - 图例：现手工从 `bp["boxes"]` 取 handle（362-365 行），seaborn 返回的 artist 不同 → **图例代码必须重写**；`layout_fix`→`legend_out` 会在 savefig 时外移（单轴图），但 handle 来源要改对。
  - 图幅：13 张全部重渲染 → md5 全变，须登记；`fig.subplots_adjust(left=0.12, right=0.70, ...)`（366 行）需按新图例宽度重调。
  - 依赖：seaborn 0.13.2（已装），`scrna_figures` 现未 import。
  - 确定性：无随机性（jitter 在 seaborn 0.13 默认 `jitter=True` 时**有随机性** → 显式传数值 `jitter=0.12`，并注意其抖动由 numpy 随机数产生，需在脚本前段 `np.random.seed(SEED)` 固定，否则 13 张图每次不同）。
- **工作量**：中（图块 18 行 → 14 行 + 图例重写 + 抖动种子）

#### S5-10 · `scrna_figures` l2_10 PCA：硬编码色值（非包替换）

- **位置**：`src/line2_scrna/scripts/scrna_figures:468`
- **现状**：`for g, col in [("Healthy", "#4C72B0"), ("Psoriasis", "#C44E52")]:`
- **目标**：`("Healthy", "#3B4992"), ("Psoriasis", "#EE0000")`
- **理由**：§三 / §八.5 二分类固定色。与 seaborn 无关，属**颜色契约修复**；列入本报告是因为它和 S5-09 落在同一图块族，同批改省一次重渲染。
- **风险**：纯色值替换，无数值影响；图件 md5 变；`conf_ellipse` 取同一 col（474 行）自动跟随。
- **工作量**：小（改 2 个字符串）

#### S5-11 · `scrna_figures` / `spatial_figures` 堆叠条形：**不换 seaborn**（见 §4-N6）

#### S5-12 · `scrna_figures` / `spatial_figures` UMAP 散点：**不换 seaborn**（见 §4-N7）

#### S5-13 · `target_gene_localization` l2_13 dotplot：手搓 scatter → `seaborn.scatterplot`（P2）

- **位置**：`src/line2_scrna/scripts/target_gene_localization:337-353`
- **现状**：
  ```python
  sc_plot = ax.scatter(xs, ys, s=[30 + 320 * v for v in sizes], c=colors,
                       cmap="viridis", edgecolors="k", linewidths=0.4)
  for frac in [0.25, 0.5, 0.75, 1.0]:
      ax.scatter([], [], s=30 + 320 * frac, facecolors="none", ...)   # 手工造 size 图例
  ```
- **目标调用**：`sns.scatterplot(data=long_df, x="celltype", y="gene", size="pct_expressing", hue="mean_expr_lognorm", palette="viridis", ax=ax)`
- **理由**：§二.3 只要求"点大小/颜色编码可读"，现状已满足（size 图例 + colorbar label 齐全）。换成 seaborn 的收益是省掉手工 size 图例，但 **seaborn 的 size 图例是连续档位，要还原"25/50/75/100%" 四档离散图例仍需手工** → 收益≈0。
- **风险**：seaborn 的 `hue` 会生成离散 colorbar 替代图例，与现 `fig.colorbar(label="mean expr (log-norm)")` 冲突，需 `legend=False` 再手工补 → 改动量不小于现状。
- **工作量**：中（且净收益为负）→ **P2，不建议**。

### 3.3 line3_spatial

#### S5-14 · `spatial_figures` 表达图色阶：**不换**（见 §4-N3）

#### S5-15 · `spatial_figures` `cat_colors` 只 20 色（潜在 §三之二 违规）

- **位置**：`src/line3_spatial/scripts/spatial_figures:235-238`
- **现状**：
  ```python
  cmap = plt.get_cmap("tab20")
  return {c: cmap(i % 20) for i, c in enumerate(cats)}, cats
  ```
- **目标**：与同仓库另三处对齐 : `scrna_figures:255-262`、`enrichment_figures(l2):243-249`、`enrichment_figures(l3):245-251`、`celltype_annotation:231-237` 都是 `tab20+tab20b+tab20c` 拼 60 色。
- **理由**：§三之二 硬约束"分类数超过 20 色必须拼接更大色板，否则循环撞色后同色不同类，图例失效"。`l3_07_domain_composition` 的域数可达 57（`spatial_figures:399-404` 注释已承认），但**同一脚本的 `cat_colors` 仍是 20 色**:`01_domains` 逐样本图若某样本域数 >20 就撞色。
- **风险**：不改数值；只影响 `01_domains` 的配色（逐样本域数通常 <20，故当前产物**可能**未撞色:**未验证**，需查每样本域数）。改动后 `01_domains` 全部重渲染。
- **工作量**：小（4 行，复制同仓库既有实现）

#### S5-16 · `spatial_figures` KO DR 表达用 `magma`（**保留**）

- **位置**：`src/line3_spatial/scripts/spatial_figures:316`
- **现状**：`sc = ax.scatter(..., c=koe[m], cmap="magma", ...)`
- **判定**：规范 §二.2 要求"连续量用单色系 ramp（viridis 默认），**禁彩虹色系（jet）**"。`magma` 是感知均匀序列 ramp、非彩虹，且与 `02_target_gene` 的 viridis **刻意区分两个不同生物学量**（目标基因表达 vs KO DR 均值）:同图族里两种连续量用同一色阶才是可读性问题。→ **保留，不换**。

---

## 4. 不建议替换清单（A4：避免"为转而转"）

| 编号 | 候选 | 判定 | 依据（可复核） |
|---|---|---|---|
| N1 | **patchwork / cowplot** 多面板拼图 | **无落地位置** | R 侧 6 张图里 4 张是 base R（`wgcna_modules` 的 `png()+par/plot/labeledHeatmap`、`cox_analysis` 的 `segments/points`），patchwork 只能组合 ggplot 对象；另 2 张 ggplot（`pca_matrix:115`、`deg_limma:115`）本就是单图，无拼合需求。Step 5 的三张组图目标全在 Python 线（line1 四联 / line2 UMAP 网格 / line3 逐样本组合）→ patchwork 用不上；Python 侧应走 matplotlib `subplot_mosaic`/`GridSpec`。 |
| N2 | **ggsignif** 包 | **包不适用，但需求成立** | ggsignif 是 ggplot2 扩展，唯一的组间箱线图是 `l2_06`（13 张，Python）→ **包本身用不上**。但"要不要标显著性"是另一个问题：`scrna_composition` 已算好逐 celltype 的 KW + 2 组精确置换 p（存于 `adata.uns["composition"]["group_tests_json"]`，`scrna_composition:365,439`），n=3 vs 5（`composition_report.txt:9`），`perm_p=0.03509` 已显著（basal / suprabasal / unknown 三类，`composition_report.txt:10-12`）→ 想标是**有数据支撑**的。落地方案是 Python 侧手绘括号（2 条 `ax.plot` + 1 个 `ax.text`，约 6 行），不是 ggsignif。见 S5-17。 |
| N3 | **viridis**（R 包）/ 统一色阶 | **无适用点** | Python 侧 17 个出图脚本的 rcParams **全部**声明 `"image.cmap": "viridis"`（`grep -c '"image.cmap": "viridis"'` = 17，与 17 个装 layout guard 的脚本数一致）；空间表达图 `spatial_figures:281` 已 viridis。R 侧唯一连续色是 `wgcna_modules:547` 的 `blueWhiteRed(50)`:±1 相关的**发散色阶是正确的**，换 viridis 会丢掉"正/负"语义。 |
| N4 | **ComplexHeatmap** 换 R 热图 | **不建议** | R 侧热图只有 `l1_29`（`labeledHeatmap`，`wgcna_modules:543-547`），是 WGCNA 官方标准图；换 ComplexHeatmap 要重写 cell 数值标注 / colorbar label（`mtext("correlation r", side=4)`，553 行）/ 行序，收益是外观统一，风险是 **R 图无几何审计**（`figure_manual_review.md` §1：`figs=0`），改完只能目视。 |
| N5 | **enrichplot** 换富集图 | **不建议** | 三线 8 张富集图全是 Python `barh`（`enrichment_figures`×3、`dr_post_analysis`×2），带 `caption()` / `legend_out()` 体系。改用 enrichplot 需把出图整块搬到 R，丢掉 layout guard 与 caption 契约，工作量"大"、回归面覆盖三线。 |
| N6 | **seaborn** 换堆叠条形（`scrna_figures:322-336`、`spatial_figures:408-411`、`celltype_annotation:430-435`） | **不建议** | seaborn 0.13 无原生 stacked bar（`barplot` 只聚合不堆叠）；`pandas.plot(kind="bar", stacked=True)` 也不是 seaborn。换过去不减少代码，只多一层索引对齐。 |
| N7 | **seaborn** 换 UMAP 分类散点（`scrna_figures:265-276`、`spatial_figures:260-263`） | **不建议（净负收益）** | 现 `cat_colors` 是确定性 60 色映射，满足 §三之二">20 类必须扩色板"；seaborn `hue` 要传 dict 才能保住"同一类同一色"，且分类数 >20 时默认 palette 会循环撞色 → 反而引入违规风险。 |
| N8 | **seaborn.heatmap** 换 `imshow` 热图（`bulk_figures:266,284`、`scrna_figures:393`、`gsva_pathways:343`、`scenic_figures:221`、`ml_hub_analysis:823`） | **不建议** | 现写法 `imshow(vmin,vmax) + fig.colorbar(label=)` 已是 2-4 行且显式锁定色域；seaborn 需 `cbar_kws`，默认 colorbar 位置与 `shrink` 行为不同 → 要写回等价参数，收益≈0。 |
| N9 | **ggrepel** 换 `wgcna_modules:518` 的 `text(..., pos=3)` | **不建议** | 该图是 base R `plot()`（503-521 行），ggrepel 需要 ggplot 对象 → 必须整图重写为 ggplot（大）。且 518 行上方注释已说明"只标每模块 top1"消掉了记录的压字（ITGB2/IFI30/CD68 叠字，2026-10-19 实测）→ 问题已闭环。 |
| N10 | `bulk_figures:297-310` PCA 的 `adjust_text` | **无需替换** | 已在用（`adjustText` 1.4.0），是本仓库最早的避让实现。 |
| N11 | `cox_analysis:195-216` 森林图 base R → ggplot `geom_errorbarh` | **不建议现在做** | 本项目无生存数据，该步骤不产图（`l1_27` 为空号，规范 §六 已记）；改了**无法验证**（没有 before/after 产物），属不可验收改动。 |

---

## 5. 优先级表（A3：每条带可执行的验证方式）

> 纪律前提（#190）：`--runner bash` 的几何审计**是真跑脚本**，会重写 `*_report.txt` 与图件。任何 before/after 对比都必须：
> ① 先记录 `processed/` 与 `figures/` 的 md5；② 审计必须传**项目真种子 `20261013`**（`--seed 20261013`），否则 seed 行被写成 20261018；③ 事后 `diff` md5 清单。

### P0（收益高、风险低，建议先做）

| 编号 | 内容 | 工作量 | 验证方式（具体命令 / 判据） |
|---|---|---|---|
| S5-01 | `ml_hub_analysis:864` 网络标签加 `adjust_text` | 小 | ① 基线：`ssh k40-ubuntu 'cd /mnt/ssd/bio_data/projects/PRJ_E2E_GSE277173/line1_bulk/processed && md5sum *.tsv *_report.txt > /tmp/before.md5 && md5sum ../figures/*.png > /tmp/before_fig.md5'`<br>② 改后审计（真跑）：`ssh k40-ubuntu 'cd /mnt/ssd/bio_data && python3 ops/audit_figure_layout.py --script /mnt/ssd/bio_data/bin/line1_bulk/ml_hub_analysis --cwd projects/PRJ_E2E_GSE277173/line1_bulk/processed --runner bash --seed 20261013 --csv /tmp/audit_ml_hub.csv'`<br>③ 判据：CSV 里 `l1_24` 的 A/B/C/D 全 PASS；`processed/*.tsv` md5 与 ① 逐项一致（只有 `*_report.txt` 允许 seed/耗时行变化）<br>④ 源码：`python cn_debug/figure_code_audit.py --root src` → `no issue found`<br>⑤ **负对照（必须做）**：临时回退这 4 行再跑一次 ②；若 D 项**不报**重叠，则本项结论只能写"补齐 §三之三 硬规则"，**不得写"修复压字"** |

### P1（收益明确，需 before/after 对照）

| 编号 | 内容 | 工作量 | 验证方式 |
|---|---|---|---|
| S5-09 | `scrna_figures:350-367` 组成箱线 → seaborn box+strip（13 张）+ 同步 S5-10 色值 | 中 | ① 数值锚：`md5sum processed/*composition*` 前后一致（本图块只读 `prop`，不改表）<br>② 箱体口径：改前用同一份 `data` 数组算 `np.percentile(vals, [25, 50, 75])` 作期望值；改后从 `ax.artists[i].get_path().vertices[:, 1]` 读回箱体上下缘，两者必须逐值相等（一次性探针，不落盘）<br>③ 审计：`--script .../bin/line2_scrna/scrna_figures --cwd projects/PRJ_E2E_GSE277173/line2_scrna/processed --runner bash --seed 20261013 --csv /tmp/audit_scrna.csv` → 13 张 `l2_06_*` A-E 全 PASS<br>④ 色值：`grep -n '#4C72B0\|#C44E52' src/line2_scrna/scripts/scrna_figures` 在 `06/10` 图块内必须 0 命中<br>⑤ 确定性：同种子连跑两次，13 张 md5 逐一相同（验证 jitter 种子已固定） |
| S5-02 | `ml_hub_analysis:807-844` 热图 → `sns.clustermap(row_linkage=link)` | 中 | ① 数值锚：`md5sum processed/ml_core_hub_genes.tsv` 前后**必须完全一致**（`link`/`ari` 路径未动）<br>② 叶序：由 `row_linkage=link` 构造保证；若改为不传 linkage，则必须证明 `leaves_list(linkage(Z, method="ward"))` 与 `leaves_list(clustermap.row_linkage)` 逐位相同<br>③ 审计同上（`ml_hub_analysis`，`--seed 20261013`）→ `l1_23` A/B/C/D 全 PASS；注意 `layout_fix` 对多轴图**不搬图例**，组图例位置需单独目视<br>④ ARI 图注数值不变：`ari` 由 `adjusted_rand_score(y, clusters)` 算出（494-496 行），本项不动该路径 → 由 ① 的 `ml_core_hub_genes.tsv` md5 已覆盖；图注字符串（836 行）源不变即值不变 |
| S5-04 | `pca_matrix:115-127` 加 `geom_text_repel` 样本标签 | 小 | ① 数值锚：`md5sum processed/pca_scores.tsv` 不变<br>② 可复现：同种子连跑两次 `l1_02_pca_step3.png` md5 相同（验证 `seed=` 生效）<br>③ 无机器判决（R）→ 进 `con_hf/figure_manual_review.md` §3 清单，状态写"未目视"，**不得改 PASS**<br>④ 目视判据：16 个样本标签全部可见（`max.overlaps=Inf` 生效，无静默丢弃）、无叠字、未超画布 |

### P2（先不做，或需先决策）

| 编号 | 内容 | 工作量 | 说明 / 验证方式 |
|---|---|---|---|
| S5-05 | `deg_limma` 火山图加 top10 基因标签 | 小-中 | **需主 Agent 决策**（内容增补）。批准后：数值锚 `deg_all.tsv`/`deg_sig.tsv` md5 不变；0 显著路径（`nrow(sig_table)==0`）必须仍能跑通 → 用 `deg_report.txt` 的 0 显著分支做回归；同种子两次 md5 一致 |
| S5-17 | `scrna_figures:350-367` 把**已有的** `perm_p` 标到箱线上（Python 手绘括号，非 ggsignif） | 小 | **需主 Agent 决策**（内容增补）。数据已就绪：`uns["composition"]["group_tests_json"]`（`scrna_composition:439`）。批准后判据：①括号只出现在有 `perm_p` 的 celltype 上，无值时静默不画且不报错；②括号文本与 `composition_report.txt` 的 `perm_p` 逐值一致（写一次性断言比对 `uns` 与 report，不落盘）；③审计 A/B/C/D 全 PASS（括号文字极易触发 A 项出框，靠 `fit_text_edges` 兜底，须实测）；④13 张图重渲染并登记 |
| S5-15 | `spatial_figures:235-238` `cat_colors` 20 色 → 60 色 | 小 | 先查每样本域数：若全部 ≤20 则本项是"预防性合规"，`01_domains` 重渲染后 md5 变但视觉应等价；判据 = `grep -c 'tab20b' src/line3_spatial/scripts/spatial_figures` ≥1 且审计 `l3_*_01_domains_*` 全 PASS |
| S5-13 | `target_gene_localization:337-353` dotplot → seaborn | 中 | 净收益为负，不建议；若仍要做，判据 = 四档 size 图例（25/50/75/100%）仍存在 + colorbar label 仍为 `mean expr (log-norm)` |
| S5-07 | 源码级 in-axes `loc` 清理（见 §7-F1） | 小 | 与包替换无关，但**必须在任何图块改写之前修**，否则改完拿到的 `no issue` 仍是假阴性。判据：`python cn_debug/figure_code_audit.py --root src` 报 0 条 C1，且人工 `grep -n 'loc="' src/line*/scripts/* | grep -v bbox_to_anchor` 逐条确认是轴外 |

---

## 6. 与派发单假设的偏差（重要）

派发单把 patchwork / ggsignif / viridis / ComplexHeatmap / enrichplot 列为"已知高价值"方向。侦察结论是**这五个包在本仓库当前形态下都不能直接落地**（ggsignif 的需求成立，但要用 Python 手绘实现）：

| 派发单假设 | 实测 |
|---|---|
| 标签压字 → ggrepel / adjustText | **成立，但覆盖面比预期小**：Python 侧 4 处避让已有 3 处（`bulk_figures:309`、`ppi_string:331`、`dr_post_analysis(l2):381`），只漏 `ml_hub_analysis:864`；R 侧目前**完全没有标签**（`pca_matrix` 无样本标签、`deg_limma` 无基因标签），所以 ggrepel 的收益是"加信息"而非"修压字" |
| 组间显著性 → ggsignif | **包不适用，需求成立**：组间箱线/组成图全在 Python（`l2_06` 13 张），ggsignif 是 R 包用不上；但 p 值已由 `scrna_composition` 算好并存进 `uns["composition"]["group_tests_json"]`（n=3 vs 5，`perm_p=0.03509` 已显著），要标只需 Python 手绘括号 → 见 S5-17 |
| 多面板拼图 → patchwork / cowplot | **不成立**：R 图全是 base R 或单图 ggplot；组图目标全在 Python（见 N1） |
| 连续色 → viridis | **已全覆盖**，R 侧唯一的 `blueWhiteRed` 是正确选择（见 N3） |
| 热图 → ComplexHeatmap / pheatmap | **只剩 1 张可换（`l1_29`），且不值得**（见 N4） |
| 箱线/小提琴/条形 → seaborn | **仅 `l2_06` 一张族（13 张）有真实收益**（点未抖动 + 色值违规）；堆叠条形/UMAP/热图换成 seaborn 是净负收益（N6-N8） |

**给主 Agent 的建议**：S5 实施切片不要按"包"派发（"用 seaborn 改一批图"），按**图块**派发（S5-01 / S5-02 / S5-09+10 / S5-04 四个独立切片），每片自带 before/after 与负对照。

---

## 7. 附带发现（不在本切片范围，但影响 Step 4 验收）

### F1 · `figure_code_audit.py` 的 C1（轴内图例）存在系统性漏检

证据（读 `cn_debug/figure_code_audit.py:97-103`）：

```python
if "ax.legend(" in stripped or "plt.legend(" in stripped:
    window = stripped + " " + (lines[i] if i < len(lines) else "")   # 只拼当前行 + 下一行
    if "bbox_to_anchor" not in window:
        lm = re.search(r"loc\s*=\s*['\"]([^'\"]+)['\"]", window)
```

两类漏网，均已在源码中实测存在（`grep -n 'loc="' src/line*/scripts/* | grep -v bbox_to_anchor`）：

| 类型 | 位置 | 为什么漏 |
|---|---|---|
| 跨行 `loc=` | `enrichment_figures(l1):280-282`（`lower right`）、`ml_hub_analysis:545-547`（`upper left`）、`ml_hub_analysis:629-631`（`lower right`）、`ml_hub_analysis:667-670`（`upper left`） | `loc` 落在 `ax.legend(` 之后第 3 行，2 行窗口看不到 |
| 裸 `ax.legend()` | `ml_model:298`、`ml_model:325`、`external_validation:281` | 默认 `loc="best"`（轴内），但正则只匹配**显式** `loc=` 字符串 |

**当前是否可见缺陷：大概率否** : 这 7 处都在单轴图里，`_install_layout_guard()` 在 `savefig` 前调 `layout_fix()`→`legend_out()` 会把图例搬到轴框外（17 个脚本都装了 guard，`grep -c '^_install_layout_guard()'` = 17）。但：
1. 规范 §三之二 明确"**源级也不得写轴内 `loc`**，`layout_fix` 只是兜底"；
2. 审计报 `no issue` 是**假阴性**:Step 4 任何图块改写后，若仍靠这条审计证明"没引入违规"，结论不可信。
**未验证**：未跑审计（#190 禁止），故"当前产物无 B 项违规"是推断，不是实测。

### F2 · 二分类色值不统一（§三 / §八.5）

| 位置 | 现色 | 规范色 |
|---|---|---|
| `bulk_figures:256` `GCOLOR = {"LS": "#C44E52", "NLS": "#4C72B0"}` | `#C44E52` / `#4C72B0` | case `#EE0000` / ctrl `#3B4992` |
| `scrna_figures:352`（箱线面色） | `#4C72B0` / `#C44E52` | 同上 |
| `scrna_figures:468`（PCA 点色） | `#4C72B0` / `#C44E52` | 同上 |
| `pca_matrix:110`、`deg_limma:118`（R 侧） | `#3B4992` / `#EE0000` | ✅ 已合规 |

语义方向没错（case=红、ctrl=蓝），但**同一份交付里 line1 的 R 图与 Python 图对同一对比用了不同红蓝**，审图会当成不一致。与包替换无关，建议并入 S5-09 同批改（同一次重渲染）。

### F3 · 出图代码硬编码组名（§八.2）

`bulk_figures:256` `GCOLOR = {"LS": ..., "NLS": ...}`、`bulk_figures:365/393` 轴标签 `"log2FC (LS vs NLS)"`、`scrna_figures:438` `"log2FC (Psoriasis vs Healthy)"`。规范 §八.2 要求"出图与统计代码不得写死组名，组名从 `group_map.tsv` 与 `project.json` 读；写死会让换项目时静默算错方向"。
**影响面**：`GCOLOR.get(g, "gray")`（302 行）在换项目后会把所有组画成灰色且不报错:静默降级。属独立缺陷，不在 S5 范围，但**改这些图块时不得原样保留**。

---

## 8. 假设与风险

1. **包版本未核实**：所有"已装"均引自派发单声明；本任务禁止连远端。若实施切片发现某包实际缺失/版本不符，属阻断，须回主 Agent。
2. **所有"当前是否 FAIL"均未验证**：未跑任何脚本/审计（#190 纪律）。报告中"当前可能未撞色""大概率无 B 项违规"等措辞均为**推断**，已逐条标注。
3. **R 图件无机器判决**：`pca_matrix` / `deg_limma` / `wgcna_modules` 的改动只能进 `figure_manual_review.md` 人工清单，`figure_score.py` 会保持 `B1?~B4?` UNVERIFIED，不得因"看着没问题"改 PASS。
4. **图件 md5 必然变化**：本报告涉及的所有替换都会重渲染，`md5` 对比只能用于 `processed/` 数值锚，不能用于 `figures/`（§七 三态判决允许"重渲染 + 逐张审计 + 目视登记"，不允许"md5 不变"作为唯一证据）。
5. **seaborn 与 layout guard 的交互未验证**：`legend_out()` 从 `ax.get_legend()` 取 handle 并重建图例；seaborn 的 boxplot/stripplot 图例来源不同，重建后 handle 是否仍是"箱体 + 个体点"需实测（S5-09 风险项已列）。

---

## 9. 执行边界自查（证据）

- 只写入本文件：`con_hf/dispatch/S5_scout_report.md`。
- `src/`、`ops/`、`docs/` 未修改：本切片全程只读（`read_file` / `search_files` / `grep` / `sed -n` / `ls`）。
- 未连远端：未执行任何 `ssh` / `adb` / 8787 / 8080 调用。
- 未跑分析脚本：未执行 `bash src/...`、`Rscript`、`python3` 出图脚本、`audit_figure_layout.py`（其 `--runner bash` 会真跑并重写产物）。
- 唯一执行的 Python 尝试（`execute_code` 统计图名）被运行时策略拦截，未产生副作用；改用 `grep -oE` 完成同一统计。

---

## 10. 待主 Agent 决策

1. **S5-05 是否批准给 `deg_limma` 火山图加 top10 基因标签**（属内容增补，非合规修复）。
2. **S5-17 是否批准把已有的 `perm_p` 标到 `l2_06` 箱线上**（数据已就绪，Python 手绘括号；不是 ggsignif）。
3. **F1（C1 审计漏检）是否先修再派 S5**：若不修，任何 S5 切片的"源码扫描 no issue"结论都不可信。
4. **F2/F3（色值 / 硬编码组名）是否并入 S5-09 同批**：同批改省一次 13 张重渲染，但会把"包替换切片"变成"替换 + 契约修复"混合切片，验收面变大。
5. **Step 4 派发粒度**：建议按图块派发（4 个独立切片），不按包派发:理由见 §6。

## 11. 建议下一步

1. 主 Agent 裁决上述 4 项。
2. 先派 **S5-01**（P0，4 行，风险最低）做一次完整闭环：基线 md5 → 改 → 审计（`--seed 20261013`）→ 负对照 → 登记。跑通这条链路后，后续切片的验证模板就固定了。
3. **不要派** patchwork / ggsignif / viridis / ComplexHeatmap / enrichplot 的实施切片（§4 N1-N5 已给出可复核理由）。
4. Step 5 组图若启动，Python 侧用 `subplot_mosaic`/`GridSpec`，不要引入 patchwork。
