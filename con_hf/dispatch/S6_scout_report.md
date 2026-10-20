# S6-scout 报告：line2 / line3 出图源码合规侦察（只读）

- 日期：2026-10-19
- 执行者：项目实现型子 Agent（派发单 S6-scout）
- 项目根：`D:\00.AIagent\codespace\AI辅助生信分析流程工作台`
- 依据：`con_hf/dispatch/SUBAGENT_CONTRACT.md`、`con_hf/2026-10-19_figure_polish_plan.md`、`docs/figure_spec.md`（v2.2）
- 边界：**未连远端**（未用 adb/ssh/8787/8080），**未跑任何分析脚本**，**未改 src/ 与 ops/**；
  仅运行三个只读审计/统计工具（`figure_code_audit.py`、`figure_audit_scan.py` 与两段本地统计脚本）。
- 证据基础：本地源码 + 本地图件存档 `outputs/default/line2_scrna/figures`（37 张）、
  `outputs/default/line3_spatial/figures`（69 张）+ 本地 `processed/` 副本（line2 47 文件 / line3 74 文件）。

---

## 1. 任务理解

对 line2_scrna / line3_spatial 做**源码级**出图合规侦察，产出五张清单（A1–A5），
作为后续"真实数据重渲染 + 机器判决"的前置输入。不改代码、不连远端、不跑分析。
判定口径只认 `docs/figure_spec.md` v2.2 的 §一 / §二 / §三 / §三之二 / §三之三，
读不出的写"无法从源码判断"，不把"看着像"写成"是"。

---

## 2. 实现摘要（侦察结果）

### 2.0 总览（先看这 6 条）

| # | 结论 | 证据 |
|---|---|---|
| 1 | line2/line3 出图**全部是 Python matplotlib**（10 个脚本、106 张图），无 R `png()`/`ggsave` | 见 §2.2 A1；`grep -nE "savefig\("` 命中 10 个脚本，无 `png(`/`ggsave` |
| 2 | 因此 line2/line3 **可以被 `ops/audit_figure_layout.py` 几何审计全覆盖**（它 patch `Figure.savefig`），不像 line1 那 6 张 R 图存在判决盲区 | 同上；plan §0 已实证 R 图 `figs=0` |
| 3 | 源码级扫描**零 issue**，但 `cn_debug/code_audit.csv` **没有被重写**（工具在无 issue 时提前 return）→ 磁盘上仍是 11:35 的旧 CSV，含 2 条 line1 记录 | §2.1 |
| 4 | `figure_score.py` 的 C2 命名正则不允许大写字母 → **50/106 张 line2/line3 图会被一票否决判 FAIL**（line2 5 张、line3 45 张） | §2.5 前段 |
| 5 | `figure_score.py` 的 **C3/C4 硬编码 True**（`put("C3", True)` / `put("C4", True)`）→ 即使 STEP_CATALOG 与实际产物大面积不一致也照样满分 10 分 | `cn_debug/figure_score.py:244-245` |
| 6 | `STEP_CATALOG` **没有 line 维度**，且 `enrichment` 键在 line2（L225）与 line3（L395）**重复定义**，后者覆盖前者 | §2.5；AST 解析：`TOTAL_KEYS_DECLARED=47 UNIQUE=46`，`DUPES: [('enrichment', [225, 395])]` |

### 2.1 任务项 1：源码扫描（实测）

```
$ python cn_debug/figure_code_audit.py --root src --csv cn_debug/code_audit.csv
code_audit: no issue found
EXIT=0
```

- 三线 `src/` 全树零命中（C1–C9 全过）。
- **但 CSV 未落盘**：`main()` 在 `if not issues: print(...); return 0` 处提前返回
  （`cn_debug/figure_code_audit.py:158-160`），`--csv` 写入代码在 170 行之后，永远走不到。
  实测 mtime 未变：

```
$ ls -la --time-style=full-iso cn_debug/code_audit.csv
-rw-r--r-- 1 18765 197609 229 2026-10-19 11:35:54 +0800
$ date   # 本次运行时间
2026-10-19 19:59:21
```

- 磁盘上那份 CSV 仍是旧内容（2 条 line1 记录，属早前负样本/整改前留痕）：

```
kind,file,line,snippet
C1_LEGEND_INSIDE,src\line1_bulk\scripts\bulk_figures,396,"ax.legend(fontsize=8, loc=""upper right"", frameon=True)"
C4_TINY_CEX,src\line1_bulk\scripts\cox_analysis,212,"adj = 0, cex = 0.65, xpd = TRUE)"
```

  → **风险**：`figure_score.py --code-csv` 吃的是这份旧 CSV，会把 2 条已修的 line1 问题当作 D2/D3 判决输入。
- **C1 有盲区（已构造负样本复现）**：`C1` 只在显式写了 `loc=` 且落在轴内位置词时才报，
  对"不写 `loc`（matplotlib 默认 `best`，仍是轴内）"完全静默。探针（仓库外 scratch 目录）：

```
$ python cn_debug/figure_code_audit.py --root <scratch>/s6probe
code_audit: no issue found          # 探针内容含 ax.legend(title="diagnosis")
EXIT=0
```

  line2/line3 里正好有 2 处这种写法（见 A2 的 §三之二 行）。

### 2.2 A1：脚本 → 图件清单

**line2_scrna（6 个出图脚本 / 37 张图）**

| 脚本 | 图件（源码字面量或模板） | 图类型 | 张数 | 落盘入口 | layout guard |
|---|---|---|---|---|---|
| `scrna_figures` | `l2_%02d_umap_%s.png`（L302）→ l2_01_umap_celltype / 02_umap_diagnosis / 03_umap_donor / 04_umap_leiden | UMAP 分类散点 | 4 | `save()` → `fig.savefig(OUT/name)` L90；`OUT="../figures"` L77 | ✓ `def caption` L96、`_install_layout_guard()` L236 |
| 〃 | `l2_05_composition_stack.png`（L337） | 堆叠柱 | 1 | 同上 | ✓ |
| 〃 | `l2_06_composition_box_%s.png`（L367，按 celltype 动态） | 箱线 + 个体点 | 13 | 同上 | ✓ |
| 〃 | `l2_07_marker_top5.png`（L402） | 热图（imshow） | 1 | 同上 | ✓ |
| 〃 | `l2_08_deg_volcano_%s.png`（L447，按 celltype 动态） | 火山散点 | 7 | 同上 | ✓ |
| 〃 | `l2_09_deg_sig_bar.png`（L461） | 柱状 | 1 | 同上 | ✓ |
| 〃 | `l2_10_pca_diagnosis.png`（L481） | PCA 散点 + 95% 椭圆 | 1 | 同上 | ✓ |
| `scenic_figures` | `l2_scenic_01_regulon_heatmap.png`（L229）、`l2_scenic_02_top_regulons.png`（L244） | 热图 / 条形 | 2 | `save()` L63，`OUT="../figures"` L53 | ✓ L69 / L209 |
| `enrichment_figures` | `l2_11_ora_top.png`（L287）、`l2_12_gsea_top.png`（L326） | 横向条形 | 2 | `save()` L79，`OUT=workdir/../figures` L66 | ✓ L85 / L225 |
| `target_gene_localization` | `l2_13_target_gene_dotplot.png`（L359） | 点图 dotplot | 1 | 直接 `fig.savefig` L359 | ✓ L84 / L224 |
| `gsva_pathways` | `l2_14_gsva_heatmap.png`（L354） | 热图 | 1 | 直接 `fig.savefig` L354 | ✓ L179 / L317 |
| `dr_post_analysis` | `l2_15_dr_gsea_top.png`（L326）、`l2_16_dr_regulatory_network.png`（L392）、`l2_17_dr_overlap.png`（L454） | 横向条形 / 网络 / 柱状 | 3 | 直接 `fig.savefig` | ✓ L81 / L219 |
| **合计** | | | **37** | 全部 PNG / 300dpi | 6/6 有 guard |

**line3_spatial（4 个出图脚本 / 69 张图）**

| 脚本 | 图件（模板） | 图类型 | 张数 | 落盘入口 | layout guard |
|---|---|---|---|---|---|
| `spatial_figures` | `%s_01_domains_%s.png`（L272，按样本） | 空间散点（域着色） | 15（human 5 + mouse 10） | `save()` L86，`OUT="../figures"` L76 | ✓ L92 / L232 |
| 〃 | `%s_02_target_gene_%s.png`（L291） | 空间散点（连续量） | 15 | 同上 | ✓ |
| 〃 | `%s_08_target_gene_by_domain.png`（L307） | 横向条形（域统计） | 2 | 同上 | ✓ |
| 〃 | `%s_03_ko_dr_%s.png`（L324） | 空间散点（连续量） | 15 | 同上 | ✓ |
| 〃 | `%s_09_ko_dr_by_domain.png`（L338） | 横向条形（域统计） | 2 | 同上 | ✓ |
| 〃 | `%s_04_morans_top.png`（L351）、`%s_05_knockout_dr.png`（L376）、`%s_06_umap_sample.png`（L393）、`%s_07_domain_composition.png`（L420） | 条形 / 柱状 / UMAP / 堆叠条形 | 8 | 同上 | ✓ |
| `celltype_annotation` | `l3_%s_14_deconv_umap.png`（L404）、`l3_%s_15_deconv_composition.png`（L448） | UMAP / 堆叠条形 | 4 | 直接 `fig.savefig`，`FIGDIR=../figures` L75 | ✓ L88 / L228 |
| `dr_post_analysis` | `l3_%s_10_dr_gsea_top.png`（L359）、`l3_%s_11_dr_overlap.png`（L409） | 横向条形 / 柱状 | 4 | 直接 `fig.savefig` | ✓ L86 / L224 |
| `enrichment_figures` | `l3_%s_12_ora_top.png`（L299）、`l3_%s_13_gsea_top.png`（L338） | 横向条形 | 4 | `save()` L81 | ✓ L87 / L227 |
| **合计** | | | **69** | 全部 PNG / 300dpi | 4/4 有 guard |

- 计数校验：line3 = 每物种 `3×样本数 + 6`（spatial_figures）+ 2 + 2 + 2。
  human 5 样本 → 21+6=27；mouse 10 样本 → 36+6=42；合计 69 ✓ 与本地存档一致。
- 落盘路径：全部 `../figures` 或 `workdir/../figures`，即 `<line>/figures/`，**无一张写进 `processed/`**。
- 全部为 PNG，源码中 line2/line3 **零 `savefig(*.pdf)` / 零 `ggsave`**（C6 无命中）。
- 实测图件格式（`figure_audit_scan.py`，只读）：`line2 figs=37 pass=37 fail=0`、`line3 figs=69 pass=69 fail=0`，全部 `dpi=300.0`、`edge=0.000`。

### 2.3 A2：规范符合性三态清单

三态 = 符合 / 不符合 / 无法从源码判断。不符合项均给 `文件:行号:片段`。

#### §一 落点 / 命名 / DPI / 字号

| 条款 | 判定 | 证据 / 说明 |
|---|---|---|
| 目录一律 `<line>/figures/` | 符合 | 10/10 脚本 `OUT`/`FIGDIR` 均指向 `../figures` |
| 命名 `<line前缀>_<序号>_<语义>.png` | **部分不符合** | 源码字面量符合规范示例（`l3_human_10_dr_gsea_top.png`）。但 `figure_score.py:72` 的 `NAME_RE` 为 `^l[123]_(?:[a-z]+_)?[0-9]{2}[ab]?_[a-z0-9_]+\.png$`，**不允许大写**：`l3_human_01_domains_JBO014.png`（样本号 JBO014）、`l2_06_composition_box_T_cell.png`（细胞类型含大写）全部不匹配 → C2 一票否决。实测 50/106 张命中（line2 5、line3 45） |
| 扩展名 PNG，禁 PDF/SVG | 符合 | 无 `savefig(*.pdf)`；37+69 张实测 `im.format == PNG` |
| DPI 显式声明（Python rcParams `savefig.dpi`） | 符合 | 10/10 脚本 `"savefig.dpi": 300`；实测 106 张 `dpi=300.0` |
| 字号 ≥8pt | 符合 | `font.size` 为 9（line2 6 个 + line3 2 个）或 8（`line3/spatial_figures:69`、`line3/dr_post_analysis:54`）；扫描无 `fontsize<8`、无 `cex<0.7` |
| 尺寸按 12×8 基准缩放 | 符合（有偏离） | figsize 6.8×5.5 ~ 13×10 不等，按内容缩放，无异常小图 |
| 元数据（report 登记口径） | **无法从源码判断** | line2/line3 的 `processed/*.txt` 报告**均不含图文件名**（`grep -l "l2_"`/`"l3_"` 零命中），台账 `outputs/system_logs/*.json` 也没有 `wrote l2_`/`wrote l3_`。图名→脚本的映射目前只能靠 `figure_score.load_src_figures()` 静态扫源码 |

#### §二 分类必备元素

| 条款 | 判定 | 证据 |
|---|---|---|
| §二.1 嵌入类：颜色=分类标签 + 图例 + caption 注明来源步骤 | 符合 | `l2_01~04` caption 含 `X_umap from step5 cluster_umap`（`scrna_figures:300`）；`l3_06` caption 含 `X_umap from step4 dim_reduce`（`spatial_figures:389`） |
| §二.1 不跨样本混色 | 符合 | 每图单一 obs 列着色 |
| §二.2 空间类：逐样本画、标题注明坐标系 | 符合 | `l3_01/02/03` 按 `sample_id` 循环（`spatial_figures:253,278,313`），caption 写 `coords = sample-local (obsm['spatial'])` |
| §二.2 连续量单色 ramp、禁彩虹 | 符合（有偏离） | `l3_02` 用 `viridis`（`:281`）；`l3_03` 用 `magma`（`:316`）——属感知均匀单色系 ramp，非 jet/rainbow，但偏离"viridis 默认" |
| §二.2 目标基因/DR 映射给"表达值 + 域统计"双视图 | 符合 | `_08_target_gene_by_domain`（:307）、`_09_ko_dr_by_domain`（:338） |
| §二.3 箱线显示个体点 + 标注 n | 符合 | `scrna_figures:356` 散点叠加；caption `n=%d/%d`（:359） |
| §二.3 火山阈值线注明 + 位置合规 | 符合 | `adj p=0.05` 贴左内缘（`scrna_figures:431`），`log2FC=±1` 顶部竖排（:435-437） |
| §二.3 热图行=基因列=观测 | 符合 | `l2_07` `mat[gene, celltype]`（:383-391）；`l2_14` 行=通路列=细胞类型 |
| §二.3 富集条形双标注 + 按显著性排序 | 符合 | `l2_11` 按 adj p 升序 + `OR / adj p`（:261,277）；`l2_12` 按 FDR→\|NES\| + `NES / FDR q`（:298,315） |
| §二.4 网络：节点/边 + **边权标注** | **不符合** | `l2_16` 边统一 `edge_color="#888888", width=0.7`（`dr_post_analysis:368-369`），SCENIC regulon 边本身无权重，caption 也未说明"权重省略原因"（:389） |
| §二.4 大网络只画 top N 并注明截断规则 | 符合 | `MAX_NODES=80`（:358），caption 写 `nodes=%d (cap %d by degree)`（:390） |
| §二.4 spring 固定种子 | 符合 | `nx.spring_layout(G, seed=SEED, k=0.7)`（:363） |

#### §三 样式基线

| 条款 | 判定 | 证据 |
|---|---|---|
| `matplotlib.use("Agg")` | 符合 | 10/10 脚本 |
| rcParams 基线（dpi/font/grid/cmap） | 符合 | 10/10 脚本显式声明 6 项 |
| **二分类标准色 `#3B4992`(ctrl)/`#EE0000`(case)** | **不符合** | line2 Healthy vs Psoriasis 用 `#4C72B0`/`#C44E52`：`scrna_figures:352`（`zip(bp["boxes"], ["#4C72B0", "#C44E52"])`）、`scrna_figures:468`（`[("Healthy", "#4C72B0"), ("Psoriasis", "#C44E52")]`）。全 line2/line3 源码中 `#3B4992`/`#EE0000` 出现次数 = 0（line1 有 8 行命中，含 1 行注释） |
| 虚拟 KO 图角标 `[Virtual KO - DR Genes]` | 符合 | `l2_15/16/17`（`dr_post_analysis:322,388,450`）、`l3_10/11`（`line3/dr_post_analysis:355,406`） |
| 每图 `plt.close` | 符合（等价实现） | 全部 `plt.close(fig)`，非 `close("all")`，单图即关，无泄漏 |
| 图内中文禁用 | 符合 | 图内文本全英文；中文只出现在注释/echo/报告 |

#### §三之二 图注与图例位置

| 条款 | 判定 | 证据 |
|---|---|---|
| caption 置轴框外（横版下方 / 竖版右上） | 符合 | 10/10 脚本 `caption()` 与规范代码逐字一致（横版 `(0.01,-0.02)`，竖版 `(1.02,1.0)`） |
| caption 一条一行 | 符合 | `"\n".join(parts)` |
| 调用处不用 `set_title`/`suptitle` | 符合 | `grep -nE "set_title|suptitle"` 在 line2/line3 **零命中** |
| 图例一律移轴框外（源级也不得写轴内 loc） | **不符合（2 处）** | `scrna_figures:480:ax.legend(title="diagnosis")`、`spatial_figures:387:ax.legend(markerscale=3, fontsize=8, ncol=2, frameon=False)` —— 均未写 `loc`，matplotlib 默认 `best`（轴内）。源码扫描 C1 抓不到（见 §2.1 探针）。渲染时 `layout_fix` 会兜底外移，但规范明确"guard 只是兜底" |
| 图例 `frameon=False` | **不符合（1 处）** | `scrna_figures:362-365` 箱线图例无 `frameon=False`（同脚本其它图例均有） |
| colorbar 必须带 label | 符合 | `l2_07` `label="z"`（:401）、`l2_13` `mean expr (log-norm)`（:347）、`l2_14` `GSVA z-score`（:352）、`l2_scenic_01` `z`（:228）、`l3_02` `expr`（:290）、`l3_03` `KO DR expr`（:323） |
| 任何颜色编码分类的图必须有图例 | **不符合（≥3 处，条件触发）** | 分类数 >20 时脚本主动放弃图例、只写图注：<br>`celltype_annotation:389-399`（`if n_ct_show <= 20:` 有图例，`else:` 只加 caption note）<br>`celltype_annotation:439-444`（composition 同款分支）<br>`line3/enrichment_figures:281-296`（`if 1 < len(uniq) <= 20:` 才有图例）<br>mouse 域数 57（规范 §六 自述），故 `l3_mouse_14_deconv_umap`、`l3_mouse_15_deconv_composition` **确定无图例** |
| 分类数 >20 扩 60 色板 | 符合 / 无法判断 | `l2_05`/`l3_07`/`celltype_annotation`/`enrichment_figures` 均用 `tab20+tab20b+tab20c`；**但** `spatial_figures:235-238` 的 `cat_colors()` 只用 `tab20`（20 色）——用于 `_01_domains` 的**每样本域**着色，是否撞色取决于单样本域数（数据相关，源码不可判） |

#### §三之三 落盘前收口

| 条款 | 判定 | 证据 |
|---|---|---|
| 每脚本内嵌同一份 canonical helper（caption/wrap_label/fit_text_edges/legend_out/layout_fix/_install_layout_guard） | 符合 | 10/10 脚本 `grep -l "def caption("` 与 `_install_layout_guard` 全部命中，函数体逐字一致 |
| tick 标签不换行 | 符合 | 无 `set_xticklabels(wrap_label(...))`；全部 `rotation=` 交 matplotlib 处理 |
| 阈值标注位置（p 贴左内缘、log2FC 顶部竖排） | 符合 | 见 §二.3 行 |
| 网络节点标签自动避让 | 符合 | `dr_post_analysis:380-382` `adjust_text(ax.texts, expand=(1.4,1.6), arrowprops=...)` |
| 轴内标注不出框 | **无法从源码判断** | 需 `ops/audit_figure_layout.py` 真渲染判决（本切片不跑分析，未做） |
| 图注不与轴框相交、图例不压数据、条目互不重叠 | **无法从源码判断** | 同上，B1–B4 只能来自几何审计 |

#### 额外发现（文档漂移，P2）

- 11 个脚本的头注释写 `Agg/150dpi`，代码实际 `savefig.dpi=300`（如 `scrna_figures:12`、`spatial_figures:9`、`enrichment:20`）——注释陈旧，会误导后续审查。
- 规范 §六 表格写 line3 `spatial_figures` "每物种 11 张"，实际公式是 `3×样本数+6`（human 27 / mouse 42）。总数 69 与实测一致，是"每物种 11 张"这句写错了。

### 2.4 A3：caption 登记差距表（`BioanalysDesktop/server/figures.js`）

匹配规则：`captionFor()` 按 `match` 子串、**首个命中生效**（顺序敏感）。
实测方法：复刻该规则跑本地 106 张真实图名（脚本见 §5）。

| 线 | 图件数 | 已登记 | 未登记 | 备注 |
|---|---|---|---|---|
| line2_scrna | 37 | **37** | **0** | `l2_06_*` 13 张走 `composition_box` 通配；`l2_scenic_01/02` 走 `scenic_01/02` |
| line3_spatial | 69 | **69** | **0** | 逐样本图走 `domains`/`target_gene`/`ko_dr` 通配；`_by_domain` 两条 pattern 排在基础 pattern 之前，命中正确 |
| 合计 | 106 | **106** | **0** | 无未登记图件 |

反向校验：

- 登记表共 **74** 条 pattern（`figure_score.load_captions()` 解析同为 74 条，双引号 text 也能正确解析）。
- 零命中的 pattern **7 条**，全部是 line1 的 R 图（`l1_02_pca_step3`、`l1_03_volcano_limma`、`l1_27_cox_forest`、`l1_28~l1_31`）——它们只存在于 `outputs/PRJ_E2E_GSE277173/line1_bulk/figures`，不在 `outputs/default/` 存档里，**属正常**，非死条目。
- 语义抽查无错配：`l3_human_08_target_gene_by_domain.png`→`target_gene_by_domain`（不是 `target_gene`）、`l3_human_09_ko_dr_by_domain.png`→`ko_dr_by_domain`（不是 `ko_dr`）、`l3_human_05_knockout_dr.png`→`knockout_dr`（不是 `ko_dr`）、`l3_human_07_domain_composition.png`→`domain_composition`（不是 `domains`）。

**结论**：C1 项在 line2/line3 上**不会丢分**（6 分全拿）。真正会丢分/被否决的是 C2（见 §2.5）。

### 2.5 A4：STEP_CATALOG 声明 vs 实际产物

`ops/build_client_report.py:66-402`。先给两条结构性缺陷，再给逐步骤表。

**结构缺陷 1：键没有 line 维度，`enrichment` 重复定义**

```
TOTAL_KEYS_DECLARED=47 UNIQUE=46
DUPES: [('enrichment', [225, 395])]
```

- L225 是 line2 的 `enrichment`（`results/enrichment_ora.tsv`、`results/enrichment_gsea.tsv`），
  L395 是 line3 的 `enrichment`（只有 `results/enrichment_ora.tsv`）。
- Python dict 字面量后者覆盖前者 → **line2 的 enrichment 条目在运行时不存在**（label/legend 丢失，line3 的声明生效）。
- 同类问题：`dr_post_analysis` 只有一条（L288，按 line2 写），line3 复用；
  `enrichment_figures` 只有一条（L112，按 line1 写）；`scenic_figures` **完全没有条目**。

**结构缺陷 2：图名声明与实际产物大范围不符（C3 口径）**

| 线 | 步骤 | 声明图件 | 实际写出 | 判定 |
|---|---|---|---|---|
| line2 | `cluster_umap` | `figures/l2_01_umap_clusters.png` | 该步骤**不出图**；`l2_01_umap_celltype.png` 由 `scrna_figures` 产 | ✗ 声明产物不存在 |
| line2 | `scrna_composition` | `figures/l2_05_composition.png` | `l2_05_composition_stack.png` + 13×`l2_06_composition_box_*.png` | ✗ 名称不符 |
| line2 | `deg_groups` | `figures/l2_08_deg_volcano.png` | 7×`l2_08_deg_volcano_<celltype>.png` | ✗ 名称不符（缺后缀） |
| line2 | `cell_communication` | `figures/l2_10_cellchat.png` | **无此图**；`l2_10` 已被 `l2_10_pca_diagnosis.png` 占用 | ✗ 声明产物不存在 + 序号冲突 |
| line2 | `target_gene_localization` | `figures/l2_13_target_gene.png` | `l2_13_target_gene_dotplot.png` | ✗ 名称不符 |
| line2 | `gsva_pathways` | `figures/l2_14_gsva.png` | `l2_14_gsva_heatmap.png` | ✗ 名称不符 |
| line2 | `dr_post_analysis` | （未声明图） | `l2_15/16/17_*.png` | ✗ 漏登记 3 张 |
| line2 | `scrna_figures` | `figures/l2_01_umap_clusters.png` | 28 张（`l2_01`~`l2_10` 族） | ✗ 声明产物不存在 |
| line2 | `scenic_figures` | **无条目** | `l2_scenic_01/02_*.png` | ✗ 步骤未登记 |
| line3 | `spatial_domains` | `figures/l3_domains.png` | 图由 `spatial_figures` 产：`l3_<sp>_01_domains_<sample>.png` | ✗ |
| line3 | `spatial_autocorr` | `figures/l3_moran.png` | `l3_<sp>_04_morans_top.png` | ✗ |
| line3 | `spatial_localization` | `figures/l3_target_spatial_map.png` | `l3_<sp>_02_target_gene_<sample>.png` | ✗ |
| line3 | `celltype_annotation` | `figures/l3_14_deconv_umap.png`、`l3_15_deconv_composition.png` | `l3_<mouse\|human>_14_deconv_umap.png` 等（缺物种段） | ✗ 报告按声明名找不到文件 |
| line3 | `spatial_figures` | `figures/l3_domains.png` | 57 张（`l3_<sp>_01`~`_09`） | ✗ |
| line3 | `dr_post_analysis` | 复用 line2 条目（`results/dr_enrichment.tsv` 等，无图） | `dr_enrichment_<sp>.tsv`、`dr_overlap_<sp>.tsv` + `l3_<sp>_10/11_*.png` | ✗ 名称不符 + 漏登记 |
| line3 | `enrichment_figures` | **无条目** | `l3_<sp>_12_ora_top.png`、`_13_gsea_top.png` | ✗ 步骤未登记 |

**数据产物逐步骤对照（line2）**

| 步骤 | 声明 outputs | 实际写出（源码） | 判定 |
|---|---|---|---|
| `ingest_counts` | `processed/scrna_raw.h5ad` | `scrna_counts.h5ad`、`ingest_report.txt` | ✗ 名称不符 |
| `qc_cells` | `processed/scrna_qc.h5ad`、`results/qc_report.txt` | `scrna_qc.h5ad`、`qc_cell_metrics.tsv`、`qc_report.txt`（cwd=`processed/`） | ✗ 报告落点不符 |
| `normalize_hvg` | `processed/scrna_norm.h5ad` | `scrna_norm.h5ad`、`hvg_genes.tsv` | ✓（`hvg_genes.tsv` 漏登记） |
| `integrate_harmony` | `processed/scrna_harmony.h5ad` | `scrna_integrated.h5ad`、`integrate_report.txt` | ✗ 名称不符 |
| `cluster_umap` | `processed/scrna_clustered.h5ad`、图 | `scrna_clustered.h5ad`、`cluster_report.txt`；**无图** | ✗ 图不存在 |
| `annotate_celltypes` | `processed/scrna_annotated.h5ad` | `scrna_annotated.h5ad`、`cluster_markers.tsv` | ✓（marker 表漏登记） |
| `scrna_composition` | `results/celltype_composition.tsv`、图 | `celltype_composition.tsv`、`scrna_composition.h5ad`、`composition_report.txt` | 数据 ✓ / 图 ✗ |
| `deg_groups` | `results/deg_all_by_celltype.tsv`、图 | `deg_all_by_celltype.tsv`、`deg_significant_by_celltype.tsv`、`scrna_deg.h5ad`、`deg_report.txt` | 数据 ✓ / 图 ✗ |
| `subcluster` | `processed/subcluster.h5ad`、`results/subcluster_markers.tsv` | `scrna_subcluster.h5ad`、`scrna_deg_subclustered.h5ad`、`subcluster_markers.tsv`、`subcluster_diagnosis_crosstab.tsv` | ✗ h5ad 名称不符 |
| `enrichment`（line2 条目被覆盖） | `results/enrichment_ora.tsv`、`results/enrichment_gsea.tsv` | 同名 ✓ | ✓ 数据；但**条目在运行时已被 line3 覆盖** |
| `pseudotime` | `processed/pseudotime.h5ad`、`results/track_genes.tsv` | `scrna_pseudotime.h5ad`、`pseudotime_report.txt`；**未见 `track_genes.tsv` 写出** | ✗ 名称不符 + 声明产物缺失 |
| `cell_communication` | `results/cellchat_lr.tsv`、图 | `cellcomm_interactions.tsv`、`scrna_cellcomm.h5ad`、`cellcomm_report.txt`；无图 | ✗✗ |
| `scenic_tf` | `results/scenic_regulons.csv`、`results/tf_activity.tsv` | `scenic_regulons.csv` ✓、`scenic_adjacencies.tsv`、`scenic_auc_mtx.tsv`、`scenic_regulon_by_celltype.tsv`、`scenic_tf_summary.tsv`（均漏登记）；`tf_activity.tsv` 由 `tf_activity` 步骤写 | 部分 ✗ |
| `tf_activity` | `results/tf_activity.tsv` | `tf_activity.tsv` ✓ | ✓ |
| `virtual_knockout` | `results/ko_dr_genes.tsv`、`processed/scrna_knockout.h5ad` | 同名 ✓ | ✓ |
| `summarize_dr` | `results/dr_genes_summary.tsv`、`results/dr_summary_report.txt` | 同名 ✓ | ✓ |
| `target_gene_localization` | `results/target_gene_localization.tsv`、图 | 同名 tsv ✓、`_wide.tsv`、`scrna_localization.h5ad`、`localization_report.txt`；图名 ✗ | 部分 ✗ |
| `gsva_pathways` | `results/gsva_scores.tsv`、图 | `gsva_scores.tsv` ✓、`scrna_gsva.h5ad`、`gsva_report.txt`；图名 ✗ | 部分 ✗ |
| `dr_post_analysis` | `results/dr_enrichment.tsv`、`dr_regulatory_network.tsv`、`dr_overlap.tsv` | 三表同名 ✓；3 张图未声明 | 数据 ✓ / 图 ✗ |
| `scrna_figures` | `figures/l2_01_umap_clusters.png` | 28 张，无此名 | ✗ |
| `scenic_figures` | 无条目 | 2 张 | ✗ 未登记 |

**数据产物逐步骤对照（line3）**

| 步骤 | 声明 outputs | 实际写出 | 判定 |
|---|---|---|---|
| `ingest_spatial` | `processed/spatial_raw.h5ad` | `spatial_counts_<sp>.h5ad`、`samples_meta.tsv`、`ingest_report.txt` | ✗ 名称不符 |
| `qc_spots` | `processed/spatial_qc.h5ad`、`results/spot_qc_metrics.tsv` | `spatial_qc_<sp>.h5ad`、`spot_qc_metrics.tsv` | ✓（带物种后缀） |
| `dim_reduce` | `processed/spatial_dimred.h5ad` | `spatial_dimred_<sp>.h5ad` | ✓（带后缀） |
| `spatial_domains` | `processed/spatial_domains.h5ad`、图 | `spatial_domains_<sp>.h5ad` ✓；图 ✗ | 部分 ✗ |
| `spatial_markers` | `results/domain_markers.tsv`、`processed/spatial_marker.h5ad` | `domain_markers_<sp>.tsv`、`spatial_marker_<sp>.h5ad` | ✓ |
| `spatial_autocorr` | `results/gene_autocorr.tsv`、`figures/l3_moran.png` | `gene_autocorr_<sp>.tsv` ✓；图 ✗ | 部分 ✗ |
| `spatial_cooccurrence` | `results/domain_cooccurrence.tsv` | `domain_cooccurrence_<sp>.tsv` | ✓ |
| `spatial_composition` | `results/sample_composition.tsv` | `sample_composition_<sp>.tsv` | ✓ |
| `spatial_communication` | `results/sample_communication.tsv` | `sample_communication_<sp>.tsv` | ✓ |
| `spatial_localization` | `results/gene_localization.tsv`、图 | `gene_localization_<sp>.tsv` ✓；图 ✗ | 部分 ✗ |
| `spatial_knockout` | `results/ko_dr_genes.tsv`、`processed/spatial_knockout.h5ad` | `ko_dr_genes_<sp>.tsv`、`spatial_knockout_<sp>.h5ad` | ✓ |
| `celltype_annotation` | 2 tsv + 2 图 | `celltype_scores_<sp>.tsv`、`celltype_annotation_<sp>.tsv` ✓；`spatial_deconv_<sp>.h5ad`、`deconv_report.txt`（漏登记）；图缺物种段 ✗ | 部分 ✗ |
| `spatial_figures` | `figures/l3_domains.png` | 57 张 | ✗ |
| `enrichment`（line3 生效条目） | `results/enrichment_ora.tsv` | `enrichment_ora_<sp>.tsv`、`enrichment_gsea_<sp>.tsv`、`enrichment_report.txt` | ✗ 名称不符 + 漏 gsea |
| `dr_post_analysis`（复用 line2 条目） | `results/dr_enrichment.tsv` 等 3 表 | `dr_enrichment_<sp>.tsv`、`dr_overlap_<sp>.tsv`（**不写** `dr_regulatory_network.tsv`） | ✗ |
| `enrichment_figures` | 无条目 | 4 张 | ✗ 未登记 |

**影响链**：`chapter3()` 用 `STEP_CATALOG.get(step)` 取 label/legend（`build_client_report.py:962`），
`find_step_results_dir()` 用声明的 `results/*` 反查产物（`:928-936`）。
上面这些名称不符会直接导致：① 客户报告步骤标题退化成 stepId；② 反查失败 → "未找到可解析汇总表"；
③ `figure_score.py` 的 C3（图件与 STEP_CATALOG 一致，6 分）本应大面积扣分，但因 C3 硬编码 True 而永远满分。

### 2.6 A5：补跑前置清单

**运行环境事实**

- 本地 Python 3.14 **缺** `matplotlib` / `pandas` / `anndata` / `scanpy` / `scipy` / `networkx` / `adjustText` / `gseapy`
  （实测：仅 `numpy`、`PIL` 可用）→ **本地无法重渲染**。
- 本地 `outputs/default/line2_scrna/processed/`（47 文件）与 `outputs/default/line3_spatial/processed/`（74 文件）
  **输入产物齐全**（含 `scrna_deg.h5ad`、`scenic_regulons.csv`、`spatial_knockout_{mouse,human}.h5ad`、
  `domain_markers_{mouse,human}.tsv`、`enrichment_*.tsv` 等）→ 说明上游分析已跑过，重渲染**不需要重跑上游**。
- 出图脚本均以 `cwd = <line>/processed` 运行（`OUT="../figures"`、`workdir/../figures`），
  输入按 cwd 相对名读取。

**逐脚本输入 / 外网 / 可渲染性**

| 脚本 | 必需输入 | 缺失行为 | 外网 | 算力端可立即渲染 |
|---|---|---|---|---|
| `line2/scrna_figures` | `scrna_deg.h5ad`（obs: celltype/diagnosis/donor/leiden；obsm: X_umap/X_pca_harmony/X_pca；uns: composition/deg/cluster_markers） | 缺 h5ad → exit 2；缺 `deg_all_by_celltype.tsv` → **跳过火山 7 张**（静默降级） | 无 | ✓（本地副本齐全） |
| `line2/scenic_figures` | `scenic_regulon_by_celltype.tsv`、`scenic_tf_summary.tsv` | 缺则 exit 2 | 无 | ✓ |
| `line2/enrichment_figures` | `enrichment_ora.tsv`、`enrichment_gsea.tsv` | 缺哪个跳哪张（不报错） | 无 | ✓ |
| `line2/target_gene_localization` | `scrna_deg.h5ad`（需 `layers['counts']`）、`deg_all_by_celltype.tsv`、`ko_dr_genes.tsv` | 缺则 fail exit 1 | 无 | ✓ |
| `line2/gsva_pathways` | `scrna_norm.h5ad`、`scrna_deg.h5ad`、`../references/gmt_cache/*.gmt`、**R `GSVA`+`GSEABase`** | 缺 gmt → fail；R 包缺失 → 整步失败 | 无（只读 gmt 缓存） | ✓ 但**会重算 GSVA**（R 侧耗时） |
| `line2/dr_post_analysis` | `scrna_knockout.h5ad`、`ko_dr_genes.tsv`、`scenic_regulons.csv`、`deg_all_by_celltype.tsv`、`scrna_deg.h5ad`、`../references/gmt_cache/*.gmt` | 缺 gmt → fail（不联网兜底） | 无 | ✓ 但**会重跑 GSEA**（`gseapy.prerank` × 库数 × 1000 置换） |
| `line3/spatial_figures` | `spatial_knockout_mouse.h5ad`、`spatial_knockout_human.h5ad`（obs: sample_id/domain/target_gene_expr/ko_dr_expr；obsm: spatial/X_umap；var: morans_i_mean/morans_z_mean；uns: localization/knockout） | 缺任一 → exit 2 | 无 | ✓（纯渲染，最快） |
| `line3/celltype_annotation` | `spatial_marker_{mouse,human}.h5ad`、`domain_markers_{mouse,human}.tsv` | 缺则 fail | 无 | ✓ 但**会重算 NNLS**（逐 spot 求解 + score_genes） |
| `line3/dr_post_analysis` | `spatial_knockout_{sp}.h5ad`、`ko_dr_genes_{sp}.tsv`、`domain_markers_{sp}.tsv`、`../references/gmt_cache/*.gmt` | 缺 gmt → `load_lib()` 走 `gseapy.get_library()` **联网下载**（失败则跳过该库） | **有**（缓存缺失时） | ✓ 但**会重跑 GSEA**，且可能触网 |
| `line3/enrichment_figures` | `enrichment_ora_{mouse,human}.tsv`、`enrichment_gsea_{sp}.tsv` | 缺哪个跳哪张 | 无 | ✓ |

**补跑顺序建议（最小代价优先）**

1. 纯渲染、零重算、零外网：`line3/spatial_figures`（57 张）→ `line3/enrichment_figures`（4 张）→ `line2/enrichment_figures`（2 张）→ `line2/scenic_figures`（2 张）。
2. 需重算但不触网：`line2/scrna_figures`（28 张）、`line2/target_gene_localization`（1 张）、`line2/gsva_pathways`（1 张，R）。
3. 重算且慢：`line2/dr_post_analysis`（3 张，GSEA）、`line3/dr_post_analysis`（4 张，GSEA + 可能触网）、`line3/celltype_annotation`（4 张，NNLS）。

**外网依赖汇总**：line2 出图脚本 0 个需要外网；line3 出图脚本仅 `dr_post_analysis` 在 gmt 缓存缺失时需外网。
（`STRING`/`liana`/`pyscenic` 依赖都在**上游分析步骤**（`line1/ppi_string`、`line2/cell_communication`、`line2/scenic_tf`），
不在本切片的 10 个出图脚本里。）

**"可立即渲染"的严格结论**：本地 = **0 项**（缺 matplotlib 等依赖）；
算力端 = **10/10 脚本的输入产物都在本地 `processed/` 副本中可见**，按 §A5 顺序可跑，
但需主 Agent 授权连远端（本切片明令禁止）。

---

## 3. 文件变更清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `con_hf/dispatch/S6_scout_report.md` | **新建** | 本报告（派发单允许的唯一新文件） |
| `cn_debug/code_audit.csv` | **未改动** | 派发单允许写，但工具在 `no issue` 时提前 return，实际未写；mtime 仍为 2026-10-19 11:35:54 |
| `src/**`、`ops/**`、`BioanalysDesktop/**` | 未触碰 | 只读 |
| 仓库外 scratch | 4 个临时统计脚本 + 1 个 C1 盲区探针 | 位于 `C:\Users\18765\AppData\Local\hermes\profiles\sw-engineer\cache\scratch\`，不在项目内 |

---

## 4. 接口与交互实现说明

本切片不改代码，此处记录**本次侦察对下游接口的影响**：

1. `figure_score.py --code-csv`：当前 `cn_debug/code_audit.csv` 与源码不一致（旧 2 条 line1 记录），
   直接喂进去会把已修问题算成 D2/D3 FAIL。
2. `figure_score.py` 的 C2/C3/C4：C2 正则与真实文件名冲突（50/106 一票否决）；
   C3/C4 硬编码 True，等于 10 分白送。
3. `build_client_report.py` 的 `STEP_CATALOG`：缺 line 维度 + `enrichment` 键被覆盖 +
   8 处图名声明与实际不符 + 2 个步骤（`scenic_figures`、line3 `enrichment_figures`）未登记。
4. `figures.js` 的 `FIGURE_CAPTIONS`：106/106 覆盖，无需补登记。

---

## 5. 测试与验证记录

| # | 命令 / 方法 | 结果 |
|---|---|---|
| 1 | `python cn_debug/figure_code_audit.py --root src --csv cn_debug/code_audit.csv` | `code_audit: no issue found`，`EXIT=0`；CSV 未重写（mtime 11:35:54 未变） |
| 2 | C1 盲区探针：仓库外写 `ax.legend(title="diagnosis")` 的伪脚本，跑同一审计器 | `no issue found`，`EXIT=0` → 证实 C1 漏报"默认 loc" |
| 3 | `python cn_debug/figure_audit_scan.py --dir outputs/default/line2_scrna/figures` | `scan: figs=37 pass=37 fail=0`，全部 `dpi=300.0 edge=0.000` |
| 4 | 同上，`--dir outputs/default/line3_spatial/figures` | `scan: figs=69 pass=69 fail=0` |
| 5 | AST 解析 `ops/build_client_report.py` 的 `STEP_CATALOG` | `TOTAL_KEYS_DECLARED=47 UNIQUE=46`，`DUPES: [('enrichment', [225, 395])]` |
| 6 | 复刻 `figures.js` 的 `captionFor()` 子串规则跑 106 张真实图名 | line2 37/37、line3 69/69 全部命中，未登记 0；74 条 pattern 中 7 条零命中（均为不在 `outputs/default/` 的 line1 R 图） |
| 7 | 用 `figure_score.py:72` 的 `NAME_RE` 跑 106 张真实图名 | C2 不合规：line2 5 张、line3 45 张，合计 50 张 |
| 8 | `grep -c "#3B4992\|#EE0000"` line1 vs line2/line3 | line1 8 行命中（`pca_matrix` 3 行含 1 注释 / `deg_limma` / `cox_analysis` / `wgcna_modules` 3 行）；line2/line3 **0 行** |
| 9 | `grep -nE "savefig\("` / `"def caption("` / `"_install_layout_guard"` 两线脚本 | 10 个出图脚本全命中 guard；无 `png(`/`ggsave` |
| 10 | 本地依赖探测（scratch 脚本 `import` 12 个包） | 仅 `numpy`、`PIL` 可用；`matplotlib`/`pandas`/`anndata`/`scanpy`/`scipy`/`networkx`/`adjustText`/`gseapy` 全缺 |

未运行（本切片禁止）：`ops/audit_figure_layout.py` 几何审计（B1–B4）、`figure_score.py` 打分、任何分析脚本、任何远端命令。

---

## 6. 假设与风险

| # | 假设 / 风险 | 依据与影响 |
|---|---|---|
| 1 | 假设 `outputs/default/*/figures` 的 106 张图就是当前源码产物 | 与脚本模板逐名对得上（含 13 张 box、7 张 volcano、57 张 l3），但**未验证是否由最新源码渲染**（本地无 matplotlib，无法重跑比对 md5） |
| 2 | C2 一票否决的判定依赖 `figure_score.py` 当前正则；若主 Agent 改正则（允许大写），则 50 张图不丢分 | 这是**工具与命名契约冲突**，不是单纯代码缺陷，需主 Agent 定口径 |
| 3 | "mouse 57 域"取自 `docs/figure_spec.md:260` 的自述，未用数据复核 | 若实际域数 ≤20，则 `l3_mouse_14/15` 的无图例分支不会触发，那 2 条不符合降级为"潜在风险" |
| 4 | `l3_human_*` 的域数未知 | 决定 human 侧 `_14/_15/_12` 是否有图例，源码不可判 |
| 5 | 图注/图例/标注的**几何合规**未验证 | 必须靠 `audit_figure_layout.py` 真渲染，本切片未跑；B1–B4 目前一律 UNVERIFIED |
| 6 | 图件序号存在历史冲突（`l2_10` 既是 `pca_diagnosis` 又是 STEP_CATALOG 里的 `cellchat`） | 不影响文件本身，但会让客户报告按名反查失败 |

---

## 7. 架构/接口变更建议

1. **`figure_code_audit.py`**：`main()` 在 `no issue` 时也应写一份只含表头的 CSV（或至少 `--csv` 时清空旧文件），
   否则"零 issue"与"旧 CSV 有 issue"并存，下游打分读到脏判决。另：C1 应把"未写 `loc` 的 `ax.legend()`"计入轴内图例（当前探针已证明漏报）。
2. **`figure_score.py`**：C3/C4 应改成"可从 `STEP_CATALOG` + 台账反查则判、判不到记 UNVERIFIED"，与 FE-012 的三态判决保持一致；
   `NAME_RE` 需与 §一 命名契约对齐（是否允许样本号大写，须先定契约）。
3. **`build_client_report.py`**：`STEP_CATALOG` 增加 line 维度（`{(line, step): meta}` 或每线独立 dict），
   先消除 `enrichment` 键覆盖；再按本报告 §2.5 的清单校正图名/数据名声明，补齐 `scenic_figures`、line3 `enrichment_figures`、line3 `dr_post_analysis`。
4. **出图脚本**（后续切片，非本次）：
   - `scrna_figures:352,468` 换标准二分类色；
   - `scrna_figures:480`、`spatial_figures:387` 显式写 `bbox_to_anchor`；
   - `scrna_figures:362` 补 `frameon=False`；
   - `celltype_annotation:389-399,439-444` 与 `line3/enrichment_figures:281-296` 的"超 20 类放弃图例"分支需改为"合并小类/分组图例/导出对照表"以满足"颜色编码必须有图例"；
   - `dr_post_analysis:368` 网络边权标注（或图注声明省略原因）；
   - `spatial_figures:235-238` 的 `cat_colors` 与其它脚本统一为 60 色板；
   - 11 个脚本头注释的 `150dpi` 改为 `300dpi`。

---

## 8. 待主 Agent 决策事项

1. **C2 命名契约**：样本号/细胞类型含大写（`JBO014`、`T_cell`）是否算合规？
   - 选项 A：改 `NAME_RE` 允许 `[A-Za-z0-9_]`（50 张图免于否决，但命名规范要同步放宽）；
   - 选项 B：图名统一小写（要重渲染 50 张 + 改 3 个脚本的 `%s` 拼接处 + 同步 `figures.js` 的 match 是否仍命中，因匹配是 lowercase 的，安全）。
2. **C3/C4 默认满分**是否本轮就关掉（改 UNVERIFIED）？关掉后 line2/line3 全量会变 UNVERIFIED，需先补 STEP_CATALOG。
3. **STEP_CATALOG 重构范围**：只补 line2/line3 的 16 处名称，还是顺带加 line 维度（会影响 `find_step_results_dir` 与 chapter3 的调用）。
4. **"超 20 类无图例"的处置口径**：mouse 57 域，逐域图例不可读是客观事实。是允许"图注替代图例"（则需改规范 §三之二 加豁免条款），还是要求图例分列/滚动分组？
5. **重渲染授权**：本切片禁止连远端，line2/line3 的真实渲染与几何审计需另行派发（含是否允许 line3 `dr_post_analysis` 触网取 gmt）。

---

## 9. 建议下一步

1. 主 Agent 先裁决 §8 的 1/2 两项（决定 line2/line3 的"判决口径"），否则重渲染出来的图会被自己的评分器判 FAIL。
2. 派发"STEP_CATALOG 校正"切片（纯 ops/ 改动，可独立验收：`build_client_report.py --dry-run` 或单测）。
3. 派发"line2/line3 重渲染 + 几何审计"切片：按 §2.6 顺序，先跑 4 个纯渲染脚本拿 `audit_figure_layout.py --csv`，
   把 B1–B4 从 UNVERIFIED 打到 PASS/FAIL；再跑需重算的 6 个脚本。
4. 重渲染后回归：`figure_code_audit.py`（应仍 0 issue，且需先修 §7.1 的 CSV 落盘缺陷）+ `figure_audit_scan.py` + `figure_score.py` 三件套。
