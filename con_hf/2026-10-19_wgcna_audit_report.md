# WGCNA 分析模块未完整执行 · 定位与修复报告

> 日期：2026-10-19
> 项目：`PRJ_E2E_GSE277173` / `line1_bulk`（GSE277173，16 样本，8 对配对，LS vs NLS）
> 脚本：`src/line1_bulk/scripts/wgcna_modules`（部署于 `/mnt/ssd/bio_data/bin/line1_bulk/wgcna_modules`）
> 结论：**不是运行时崩溃，而是"配置与实现不一致 + 标准工作流节点缺失"**。6 次执行全部 exit 0、checkpoint passed，但关键基因筛选（kME/GS）从未执行，且设计要求的"方差前 5000 基因"未落地。

---

## 0. 前置准备完成情况

### 0.1 出图规范复查

| 范围 | 方法 | 结果 |
|---|---|---|
| line1 交付图件 30 张 | 逐张目视 + `figure_audit_scan.py` + `figure_score.py` | **30/30 PASS，均分 100.0**（阈值 75） |
| line2 / line3 出图代码 | `figure_code_audit.py --root src`（C1–C7 静态扫描） | **no issue found**（三线全部脚本） |
| line2 / line3 交付图件 | 本项目 `outputs/` 仅有 line1，无该两线本地副本 | 未做交付侧扫描（无样本可扫），源码级已过 |

用户点名的 6 张图逐张验收（复扫时额外发现 `l1_29` 图注被裁，一并修正）：

| 图件 | 问题 | 修正 | 验收 |
|---|---|---|---|
| `l1_04_topvar_heatmap.png` | Y 轴 50 个基因名重叠 | 模板不再压扁脚本 figsize（见根因） | ✅ 4035×4219，基因名清晰 |
| `l1_13_gsea_top.png` | 标注压 Y 轴标签 / 右侧出框 | 标注拆两行，`span` 2.4→1.9 | ✅ 全部在框内 |
| `l1_15_kegg_top.png` | 右侧 `adj p=4.6e-13` 被裁 | 标注拆两行，`xmax` 1.9→2.0 | ✅ 完整 |
| `l1_14_module_ora_top.png` | 顶端标注出框 | 同上 | ✅ 完整 |
| `l1_26_shap_waterfall.png` | 右侧标注出框、图例轴内 | x 右界按标注宽度留位 + 图例外置 | ✅ 完整 |
| `l1_23_cluster_heatmap.png` | colorbar 与 group 图例相压 | colorbar 独立 cax 固定最右，图例紧贴热图 | ✅ 分列不重叠 |
| `l1_28_wgcna_softpower.png` | 阈值线不可见 | ylim 扩到 0.95 + 阈值线/选中 power 竖线/文字 | ✅ 阈值线与标注均可见 |
| `l1_29_wgcna_module_trait.png` | 底部图注超出画布右缘被裁（`case=LS vs c...`） | 图注拆两行 + `outer=TRUE` 占满整幅宽度 | ✅ 两行完整 |

> 打分口径说明：`figure_score.py` 的 B1–B4 / D2–D3 仍按默认满分计（FE-012 待修），
> 这 6 张图的几何问题另由逐张目视验收覆盖；A/C 类为机器实测。

**共同根因（已修）**：`ops/layout_helper.py`、`ops/layout_autoload/sitecustomize.py`、`ops/layout_autoload/Rprofile` 三端无条件用模板 16:9 覆盖脚本 figsize，把 14in 高的热图压到 4.05in。现统一改为 `max(脚本尺寸, 模板尺寸)`——**模板只能放大、不能缩小**。

### 0.2 临时/冗余/缓存清理

已删除：

- `BioanalysDesktop/old_useless/`（空残目录 + 带尾随空格的坏目录，曾导致全仓 Grep 报错）
- `cn_debug/__pycache__/`、`cn_debug/figcheck/`、`enrich_review/`、`mlhub_review/`、`newfigs_review/`、`fig_caption_check/`、`2026-10-18_tmp_scenic_audit/`
- 一次性补丁脚本 7 个（`patch_*.py`、`repair_layout_guard.py`、`rollout_layout_fix.py`、`probe_wrap_tick.py`）
- 临时探针 `_probe_sse.mjs`、`diag_runtask.mjs`
- 已归档日志 6 个（frpc/portal/scenic）
- `outputs/_bak_figures_20261014/`（1.7 MB 旧图备份）
- 空目录 `portal/`、`.trae-html-share-packages/`

保留（有引用/可复用）：`cn_debug/samples/`（`tests/ledger.test.js` 依赖）、`cn_debug/scenic_db/`（SCENIC 数据库）、`cn_debug/*verification*`（可复现验证脚本）、`workbench_out.log` / `workbench_err.log`（8787 服务正在写入）。

---

## 1. WGCNA-1 执行节点核对

对照"标准 WGCNA 工作流完整节点清单"与脚本实际执行路径：

| # | 标准节点 | 实际执行 | 证据 | 状态 |
|---|---|---|---|---|
| 1 | 原始数据预处理（转置、样本/基因质量） | 转置 + `goodSamplesGenes` | 脚本 L84–98、L186–190 | ✅ 完成 |
| 1a | 样本离群检测（样本聚类 / Z.k） | **未执行** | 脚本无 `hclust`/`Z.k`/离群判定 | ❌ 缺失 |
| 2 | 方差前 5000 基因过滤（aims Step 3 设计） | **未执行**，全量 20019 基因入网 | `wgcna_report.txt: genes_used=20019`；脚本直接读全表 | ❌ 缺失 |
| 3 | 软阈值自动选择 | `pickSoftThreshold`，powers 1–30 | `power=26`，`scale_free_R2_ok=FALSE`（最高 R²=0.75） | ✅ 完成（未达标，已注明） |
| 4 | 共表达网络构建 | `blockwiseModules`，signed / signed TOM | 脚本 L236–241 | ✅ 完成（受默认 `maxBlockSize=5000` 分块） |
| 5 | 模块划分与合并 | `minModuleSize=20`、`mergeCutHeight=0.25`、`deepSplit=2` | `modules=40`（含 grey） | ✅ 完成 |
| 6 | 模块-性状关联 | Pearson `cor(MEs, trait)`，主对比对 + 各组指示列 | 脚本 L248–280；`LS_vs_NLS (case=LS vs ctrl=NLS)` | ✅ 完成（图仅展示主对比对，符合规范） |
| 7 | 模块特征基因（MEs）导出 | **未导出** | `processed/` 无 `wgcna_module_eigengenes.tsv` | ❌ 缺失 |
| 8 | 关键基因筛选（kME / GS / 模块内 hub） | **未执行** | 全仓无 `kME`/`moduleMembership`/`geneSignificance`；`key_genes` 直接取显著模块全部基因 | ❌ 缺失 |
| 9 | 模块间关系（ME 相关 / 聚类） | **未执行** | 无对应产物 | ⚠️ 可选节点缺失 |
| 10 | 标准化结果导出 | 2 个 TSV + report + 2 张 PNG | `wgcna_modules.tsv`、`wgcna_module_trait.tsv`、`wgcna_report.txt`、`l1_28`、`l1_29` | ⚠️ 部分（`results/` 为空，`outputs` 未声明） |

**缺失环节清单（结构化）**

1. `N-WGCNA-01` 方差前 5000 基因过滤节点（设计有、实现无）
2. `N-WGCNA-02` 样本离群检测节点（标准流程有、实现无）
3. `N-WGCNA-03` kME / GS 计算节点（标准流程有、实现无）
4. `N-WGCNA-04` 模块内 hub 基因筛选与导出（标准流程有、实现无）
5. `N-WGCNA-05` 模块特征基因 MEs 导出（标准流程有、实现无）
6. `N-WGCNA-06` 模块间相关 / ME 聚类（可选节点缺失）
7. `N-WGCNA-07` 标准化结果暂存与产物声明（`results/` 空、`io_files.output=[]`）

---

## 2. WGCNA-2 配置全字段合规校验

### 2.1 项目配置（`project.json`）

| 字段 | 值 | 判定 |
|---|---|---|
| `data_source.sampleCount` | 16 | ✅ 与表达矩阵一致 |
| `experimental_design.is_paired` | `true`，8 对 donor | ✅ 与设计一致 |
| `grouping_design.groups` | NLS（reference）/ LS（disease_stage） | ✅ |
| `grouping_design.contrasts` | `LS_vs_NLS`，case=LS，ctrl=NLS，`isPrimary=true` | ✅ 脚本正确读取 |
| `analysis_cutoffs` | padj 0.05 / log2FC 1 / p 0.05 | ✅（WGCNA 模块显著性另用 p<0.05，见下） |
| `plot_layout_config` | `template_2_cell_wide`、16:9、300dpi | ✅（模板压扁问题已在 ops 修复） |
| `wgcna_config` | **不存在** | ❌ 关键参数未入项目配置 |

### 2.2 脚本参数与设计口径

| 参数 | 设计要求（aims / project.js） | 脚本实际 | 判定 |
|---|---|---|---|
| 入网基因数 | 方差前 **5000** | 全量 **20019** | ❌ **配置与实现不一致** |
| 网络类型 | signed | signed | ✅ |
| TOM 类型 | signed | signed | ✅ |
| `nThreads` | 3 | 3 | ✅ |
| `minModuleSize` | 未在项目配置中约定 | 20（硬编码） | ⚠️ 不可配置 |
| `mergeCutHeight` | 未约定 | 0.25（硬编码） | ⚠️ 不可配置 |
| `deepSplit` | 未约定 | 2（硬编码） | ⚠️ 不可配置 |
| 软阈值规则 | 首个 R²≥0.8，否则取最大 | 首个 R²≥0.8，否则取最大 → 26 | ✅（已注明未达标） |
| 模块显著性 | 未约定 | `p_group < 0.05`（硬编码） | ⚠️ 不可配置 |
| `maxBlockSize` | 未声明 | 未设置（WGCNA 默认 5000） | ❌ 未声明、未记录 |
| 输出声明 | 应列全产物 | 任务提交 `outputs=[]` | ❌ 台账无产物清单 |
| 产物命名 | `wgcna_module_trait.tsv` | `project.js` 写 `module_trait.tsv` | ❌ 命名漂移 |

**关键推论**：20019 基因 / 默认 `maxBlockSize=5000` → `blockwiseModules` 至少分 **5 个块**，模块**不能跨块**。这不是脚本报错，但会让"全基因共表达网络"退化为"分块共表达网络"，与设计口径不符。设计写"方差前 5000"正是为了让全部基因落在**一个块**内，同时把 TOM 内存从约 3.2 GB 降到约 200 MB。

### 2.3 样本信息完整性

- 表达矩阵 16 列、`group_map` 16 行，样本名完全对齐（脚本 L96 有硬校验）。
- `is_paired=true`，但 WGCNA 未使用配对结构（模块-性状相关按样本级 Pearson）。这是方法学选择，不是错误；报告已注明探索性。
- `goodSamplesGenes` 未剔除样本（6 次运行均未打印剔除日志）。

---

## 3. WGCNA-3 全量执行日志回溯

### 3.1 时间轴（服务器 `system_logs/` 全部 WGCNA 台账）

| # | 开始（UTC） | 结束（UTC） | 耗时 | status | exit | checkpoint | error_log | outputs |
|---|---|---|---|---|---|---|---|---|
| 1 | 10-18 17:14:46 | 17:20:30 | 5:44 | completed | 0 | passed | 无 | `[]` |
| 2 | 10-19 02:19:03 | 02:24:50 | 5:47 | completed | 0 | passed | 无 | `[]` |
| 3 | 10-19 02:30:39 | 02:36:54 | 6:15 | completed | 0 | passed | 无 | `[]` |
| 4 | 10-19 02:37:53 | 02:44:27 | 6:34 | completed | 0 | passed | 无 | `[]` |
| 5 | 10-19 03:12:19 | 03:18:11 | 5:52 | completed | 0 | passed | 无 | `[]` |
| 6 | 10-19 04:34:17 | 04:40:18 | 6:01 | completed | 0 | passed | 无 | `[]` |
| 7 | 10-19 05:06:25 | 05:12:18 | 5:53 | completed | 0 | passed | 无 | `[]` |
| 8 | 10-19 05:18:53 | 05:25:03 | 6:10 | completed | 0 | passed | 无 | `[]` |

### 3.2 判定

- **无步骤跳过**：8 次均从软阈值一路跑到 `wgcna_modules_done`，产物时间戳与步骤顺序一致。
- **无显性报错中断**：`error_log` 全为 `null`，`exit_code` 全 0。
- **无资源不足证据**：耗时稳定在 5:44–6:34；运行峰值 RSS 约 0.6–0.8 GB，CPU 63%–75%，未见 OOM/被杀。
- **隐性逻辑异常**：无异常退出，但存在"静默偏离设计"——全量基因入网、未做 kME/GS、未导出 MEs，脚本不会因此报错，台账也不会提示。
- **可观测性缺口**：
  - `resource_usage.max_cpu_percent / max_memory_gb / disk_io_peak_mb_s` 全为 `null`，没有资源峰值证据。
  - 全量 stdout/stderr 不落盘（`run.js` 只在失败时保留 stderr 尾部 2 KB），事后无法逐行回溯。
  - `io_files.output` 全为 `[]`，台账不能自证产物清单。

---

## 4. WGCNA-4 工作流完整性校验

### 4.1 对照"初始设计"（aims Step 3 + `project.js`）

设计要求：**方差前 5000 基因 → signed 网络（nThreads=3）→ 模块-表型关联 → DEG ∩ WGCNA 关键模块 → 候选基因**。

| 设计环节 | 落地 | 判定 |
|---|---|---|
| 方差前 5000 基因 | 未落地（20019 全量） | ❌ |
| signed 网络 + nThreads=3 | 落地 | ✅ |
| 模块-表型关联 | 落地（主对比对 + 分组指示列） | ✅ |
| DEG ∩ WGCNA 关键模块 | 落地（`key_genes`） | ✅ |

**初始设计层面缺 1 项：方差前 5000 过滤。**

### 4.2 对照"标准 WGCNA 全流程"

标准链路：**预处理 → 软阈值 → 建网 → 模块划分 → 模块-性状 → 关键基因筛选 → 结果导出**。

| 环节 | 判定 |
|---|---|
| 原始数据预处理 | ⚠️ 有转置与缺失检查，缺样本离群检测 |
| 软阈值自动选择 | ✅ |
| 共表达网络构建 | ✅（但未按设计过滤，触发分块） |
| 模块划分 | ✅ |
| 模块-性状关联 | ✅ |
| **关键基因筛选** | ❌ **完全缺失（无 kME/GS，无模块内 hub）** |
| 标准化结果导出 | ⚠️ 有表/图/report，缺 MEs、缺 `results/` 暂存、缺 outputs 声明 |

**工作流设计层面缺 5 项**：样本离群检测、kME/GS、模块内 hub 导出、MEs 导出、标准化暂存。

---

## 5. WGCNA-5 问题定位、根因归类与修复方案

### 5.1 问题与根因（严格三类）

#### A. 配置疏漏（4 项）

| ID | 问题 | 根因 | 影响 |
|---|---|---|---|
| `C-01` | 设计要求方差前 5000，脚本用全量 20019 | aims/project.js 与脚本实现长期脱节，缺"配置→代码"一致性校验 | 触发默认 5000 分块，模块不能跨块；内存与耗时上升；与交付口径不符 |
| `C-02` | 任务提交 `outputs=[]` | 流水线调用方未声明产物；服务端允许空数组 | 台账无产物清单，打包/复核依赖目录扫描，漏产物无法发现 |
| `C-03` | `project.js` 写 `module_trait.tsv`，实际 `wgcna_module_trait.tsv` | 命名未随脚本演进同步 | 下游/交付按声明取文件会找不到 |
| `C-04` | WGCNA 参数全部硬编码，项目配置无 `wgcna_config` | 参数未产品化 | 不同项目无法调阈值；审计无法从配置复现口径 |

#### B. 执行运行时异常（0 项）

8 次执行全部 `completed / exit 0 / checkpoint passed / error_log=null`，无跳过、无中断、无资源不足证据。**本轮不存在运行时异常**。

但存在**运行时监控缺失**（归入运维缺口，不计为异常）：

| ID | 问题 | 根因 | 影响 |
|---|---|---|---|
| `R-01` | `resource_usage` 全 null | 未采集 CPU/内存/磁盘峰值 | 无法量化"资源不足"风险 |
| `R-02` | 全量日志不落盘 | `run.js` 只保留失败时 stderr 尾部 2 KB | 事后无法逐行回溯隐性异常 |

#### C. 工作流设计缺失（5 项）

| ID | 问题 | 根因 | 影响 |
|---|---|---|---|
| `W-01` | 无 kME / GS 计算 | 初始设计只做"模块级交集"，未设计模块内基因排序 | WGCNA 侧无法给出 hub 基因，`key_genes` 把 282 个模块基因等同对待，信号被摊平 |
| `W-02` | 无模块内 hub 基因导出 | 同 W-01 | 下游 ML 输入池缺少 WGCNA 原生排序依据 |
| `W-03` | 无样本离群检测 | 预处理只做 `goodSamplesGenes` | 16 样本小样本下，单个离群样本可显著改变模块结构 |
| `W-04` | 无 MEs 导出 | 未设计模块级表型复用 | 下游无法做模块-性状的样本级复算 |
| `W-05` | 无模块间相关 / ME 聚类 | 未设计（可选节点） | 模块冗余度不可评估 |

### 5.2 可直接落地的修复方案

#### P0（必须，修复"未完整执行"）

**P0-1 落实方差前 5000 过滤（对应 C-01）**

在 `wgcna_modules` 读入表达矩阵后、转置前增加：

```r
top_n <- 5000L
gv <- apply(expr, 1, var)
keep <- names(sort(gv, decreasing = TRUE))[seq_len(min(top_n, length(gv)))]
expr <- expr[keep, , drop = FALSE]
writeLines(keep, "wgcna_input_genes.txt")
log(sprintf("variance filter: %d -> %d genes", length(gv), nrow(expr)))
```

并在 `wgcna_report.txt` 写 `genes_input=<n>`、`max_block_size=<n>`、`n_blocks=<ceil(n/maxBlockSize)>`。

**P0-2 增加 kME / GS 与模块内 hub 导出（对应 W-01/W-02）**

```r
# 模块特征基因与基因显著性
gene_module <- data.frame(gene = colnames(datExpr), module = moduleColors,
                          module_label = moduleLabels, stringsAsFactors = FALSE)
kme <- numeric(nrow(gene_module)); gs <- numeric(nrow(gene_module)); gs_p <- numeric(nrow(gene_module))
trait_vec <- trait_kept[[trait_col]]
for (i in seq_len(nrow(gene_module))) {
  g <- gene_module$gene[i]; lab <- gene_module$module_label[i]
  kme[i] <- cor(datExpr[, g], MEs[, paste0("ME", lab)], use = "p")
  ct <- cor.test(datExpr[, g], trait_vec, method = "pearson")
  gs[i] <- ct$estimate; gs_p[i] <- ct$p.value
}
gene_module$kME <- signif(kme, 4)
gene_module$GS <- signif(gs, 4)
gene_module$p.GS <- signif(gs_p, 4)
write.table(gene_module, "wgcna_gene_traits.tsv", sep = "\t", quote = FALSE, row.names = FALSE)

# 显著模块内 hub：|kME| >= 0.8 且 |GS| >= 0.2，每模块最多 20 个
sig_colors <- mod_rows$module[mod_rows$significant]
hub <- subset(gene_module, module %in% sig_colors & abs(kME) >= 0.8 & abs(GS) >= 0.2)
hub <- do.call(rbind, lapply(split(hub, hub$module), function(d) head(d[order(-abs(d$kME)), ], 20)))
write.table(hub, "wgcna_hub_genes.tsv", sep = "\t", quote = FALSE, row.names = FALSE)
```

新增图 `l1_27_wgcna_mm_gs.png`：MM（kME）vs GS 散点，按显著模块分面，标注 top hub 基因名。

**P0-3 导出 MEs（对应 W-04）**

```r
me_out <- data.frame(sample = rownames(MEs), MEs, check.names = FALSE)
write.table(me_out, "wgcna_module_eigengenes.tsv", sep = "\t", quote = FALSE, row.names = FALSE)
```

**P0-4 样本离群检测（对应 W-03）**

```r
sample_tree <- hclust(dist(datExpr), method = "average")
ZT <- scale(datExpr)
Z.k <- scale(apply(ZT, 1, function(x) mean(abs(x))))
outliers <- names(which(abs(Z.k) > 2.5))
writeLines(sprintf("sample=%s Z.k=%.3f%s", names(Z.k), as.numeric(Z.k),
                   ifelse(names(Z.k) %in% outliers, " *outlier", "")), "wgcna_sample_outliers.txt")
```

新增图 `l1_30_wgcna_sample_tree.png`（样本聚类树 + 分组色条）。是否剔除离群样本由报告显式给出建议，不自动删（16 样本删一个代价大）。

**P0-5 声明 outputs 与命名对齐（对应 C-02/C-03）**

- 流水线提交 `wgcna_modules` 时 `outputs` 至少列：
  `wgcna_modules.tsv`、`wgcna_module_trait.tsv`、`wgcna_gene_traits.tsv`、`wgcna_hub_genes.tsv`、`wgcna_module_eigengenes.tsv`、`wgcna_report.txt`、`l1_27`/`l1_28`/`l1_29`/`l1_30` PNG。
- `BioanalysDesktop/server/project.js:205` 的 `io` 改为实际文件名。

#### P1（应做，参数化与可观测性）

**P1-1 参数入项目配置（对应 C-04）**

在 `project.json` 增加：

```json
"wgcna_config": {
  "top_n_genes": 5000,
  "min_module_size": 20,
  "merge_cut_height": 0.25,
  "deep_split": 2,
  "power_rule": "first_r2_ge_0.8_else_max",
  "module_p_threshold": 0.05,
  "hub_kme_min": 0.8,
  "hub_gs_min": 0.2,
  "max_block_size": 5000
}
```

脚本读不到时用上述默认值，并在 report 打印 `wgcna_config_source=project.json|default`。

**P1-2 全量日志与资源采集（对应 R-01/R-02）**

- 每次任务把 stdout+stderr 落 `system_logs/<date>_<proj>_<line>_<step>_<id>.log`，ledger 增加 `log_path`。
- 用 `/usr/bin/time -v` 或 cgroup 采样填 `resource_usage`。

**P1-3 `results/` 标准化暂存（对应 W-05 的交付侧）**

任务结束把交付级产物复制到 `results/`，或明确废弃该目录并在 `docs` 中说明；不允许"目录存在但永远为空"。

#### P2（可选）

- 模块间 ME 相关热图 + ME 聚类树（评估模块冗余）。
- 模块-性状热图展示全部性状列（当前只展示主对比对，符合规范；可在补充材料给全列）。

### 5.3 后续执行步骤建议

1. 改 `src/line1_bulk/scripts/wgcna_modules`（P0-1 ~ P0-4）。
2. 改 `BioanalysDesktop/server/project.js` 的 `io` 字段（P0-5）。
3. `pwsh -File ops/06_deploy_scripts.ps1 -Line line1_bulk -Force` 部署。
4. 通过 `/api/tasks/submit` 重跑 `wgcna_modules`，`outputs` 按 P0-5 声明。
5. 校验产物、复跑下游 `key_genes`（改为优先用 `wgcna_hub_genes.tsv` 作 WGCNA 侧输入）。
6. 重跑 `figure_code_audit.py` / `figure_audit_scan.py` / `figure_score.py`。
7. 更新 `docs/figure_spec.md` 图件清单（新增 `l1_27`、`l1_30`）与 `aims/aims.txt` 的 WGCNA 节点说明。

### 5.4 可量化验证标准

| # | 验证项 | 通过标准 |
|---|---|---|
| V1 | 入网基因数 | `genes_input == 5000`（±0） |
| V2 | 分块数 | `n_blocks == 1`（`maxBlockSize >= 5000`） |
| V3 | kME/GS 表 | `wgcna_gene_traits.tsv` 行数 == 保留基因数；`kME`、`GS` ∈ [-1,1]；无 NA |
| V4 | hub 表 | 每个显著模块 ≥1 个 hub；所有 hub `|kME| >= 0.8` |
| V5 | MEs 表 | 行数 == 样本数；列数 == 模块数 |
| V6 | 离群检测 | 报告列出全部样本 Z.k；`|Z.k| > 2.5` 的样本被显式标注 |
| V7 | 台账 | `exit_code=0`、`checkpoint_status=passed`、`error_log=null`、`io_files.output` 长度 ≥ 6 |
| V8 | 图件 | `l1_27/28/29/30` 均 300dpi PNG、最短边 ≥1200px、五维打分 ≥75 |
| V9 | 复现性 | 同 seed 连跑两次，`power`、模块数、显著模块集合完全一致 |
| V10 | 下游一致 | `key_genes` 的 WGCNA 侧基因集来源字段写明 `wgcna_hub_genes.tsv`，且非空 |

---

## 6. 工作规划与执行计划

| 阶段 | 任务 | 依赖 | 验收 |
|---|---|---|---|
| S1 | 落地 P0-1 ~ P0-4（脚本改造） | 无 | 静态语法检查 + 本地/远端试跑 |
| S2 | 落地 P0-5（outputs 与命名） | S1 | 提交后台账 `io_files.output` 非空 |
| S3 | 重跑 `wgcna_modules` + 下游 `key_genes` | S1/S2 | V1–V10 全过 |
| S4 | 新增图件纳入规范与打分 | S1 | `l1_27`/`l1_30` 扫描 PASS |
| S5 | 参数化 + 日志/资源采集（P1） | S3 | 配置可复现、日志可回溯 |
| S6 | 全链回归（line1 全部 11 步） | S3 | 30+ 图全 PASS，227 测试全过 |

**风险与约束**

- 16 样本处于 WGCNA 可靠区间下沿：所有结论保持"探索性"表述，不得写成"可靠共表达网络"。
- R² 最高 0.75，未达 0.8：power=26 是数据驱动结果，报告必须保留 `scale_free_R2_ok=FALSE`。
- 手机端内存有限：top-5000 过滤是必须项，不建议用 `maxBlockSize=20000` 硬扛。

---

## 7. 交接清单（给后续 AI）

### 7.1 必读

1. 本报告
2. `con_hf/踩坑台账.md` #181（WGCNA 分组契约）、#183–#185（本轮新增）
3. `con_hf/figure_error_ledger.md` FE-013 ~ FE-015（本轮新增）
4. `docs/figure_spec.md` v2.2 §八（"vs" 契约）
5. `aims/aims.txt` Step 3 与 §5.4

### 7.2 待办（按顺序）

- [ ] `src/line1_bulk/scripts/wgcna_modules`：加 top-5000 过滤、kME/GS、hub 导出、MEs 导出、样本离群检测
- [ ] `BioanalysDesktop/server/project.js:205`：`io` 字段改名
- [ ] 任务提交模板：`outputs` 列全产物
- [ ] `docs/figure_spec.md`：登记 `l1_27_wgcna_mm_gs`、`l1_30_wgcna_sample_tree`
- [ ] `key_genes`：WGCNA 侧优先读 `wgcna_hub_genes.tsv`（回退到显著模块全量）
- [ ] 重跑 + V1–V10 验证
- [ ] 更新 `con_hf/handoff.md`

### 7.3 关键路径与命令

```powershell
# 部署
pwsh -File ops/06_deploy_scripts.ps1 -Line line1_bulk -Force

# 重跑（示例，outputs 需按 P0-5 补全）
$body = '{"lineId":"line1_bulk","projectId":"PRJ_E2E_GSE277173","step":"wgcna_modules","inputs":["/mnt/ssd/bio_data/projects/PRJ_E2E_GSE277173/line1_bulk/processed/expr_genes.tsv","/mnt/ssd/bio_data/projects/PRJ_E2E_GSE277173/line1_bulk/processed/group_map.tsv"],"outputs":["..."],"seed":20261013}'
Invoke-RestMethod -Uri http://127.0.0.1:8787/api/tasks/submit -Method Post -ContentType 'application/json' -Body $body

# 复扫
python cn_debug/figure_code_audit.py --root src
python cn_debug/figure_audit_scan.py --dir outputs/PRJ_E2E_GSE277173/line1_bulk/figures
python cn_debug/figure_score.py --dir outputs/PRJ_E2E_GSE277173/line1_bulk/figures
```

### 7.4 不要动

- 母版只读边界：`/mnt/ssd/bio_data/bin/<line>/` 只通过部署脚本写入
- `test_use_data/`
- 远端项目 `raw_data/`
- line2 / line3 数据与脚本（本轮只做源码级审查）

---

## 8. 本轮闭环证据

| 项 | 证据 |
|---|---|
| 6 张图修正 | 远端重跑 `wgcna_modules` / `enrichment_figures` / `ml_hub_analysis` / `bulk_figures` 全部 `completed` |
| 图件扫描 | `30/30 PASS`，`avg=100.0` |
| 源码审查 | `no issue found`（三线） |
| WGCNA 运行 | 第 8 次 05:18:53 → 05:25:03，`completed`、`exit 0`、`checkpoint passed`（图件修正后） |
| 清理 | 见 §0.2，`old_useless` 已删，全仓 Grep 恢复正常 |
