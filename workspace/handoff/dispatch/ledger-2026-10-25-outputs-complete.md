2026-10-25 台账 outputs 行 12 个全部补齐，line2/line3 契约统一完成

## 结果

line2_scrna 与 line3_spatial 共 39 个脚本，`outputs=` 行覆盖从 27 个补到 39 个，
缺行归零。全量核验：bash 语法 0 fail、Python 段 AST 0 fail、台账钩子 39/39。
双端哈希 39/39 一致。

## 为什么这轮成了，上轮没成

上轮用通用正则批量插补，连续引入两类缺陷后全部回滚。这轮改成一次一个脚本、
双校验定位、改完立即 bash -n 加 AST 加实跑三项验证，通过才动下一个。

关键经验是插入点定位必须双重校验：既匹配 `with open(...)` 行，又校验它的上一行
或相邻内容是预期的（`elapsed_seconds` 或 `]`）。单一定位会插错。

另一个关键点是先判断是情况 A（字面量列表 `lines = [ ... ]`，outputs 作为最后
元素插在 `]` 前）还是情况 B（append 方式，插在最后一个 append 之后、
with open 之前）。enrichment 两者看似都有可能，实际是 B，判断错了就插不进去。

## 分工

主代理：cell_communication、deg_groups、gsva_pathways、enrichment 共 4 个
Plato 子代理：dr_post_analysis、subcluster、summarize_dr、tf_activity、
virtual_knockout，以及 line3 的 celltype_annotation、dr_post_analysis、
enrichment 共 8 个

Plato 8 个全成功，台账覆盖完整（最多 celltype_annotation 10 条），逐条哈希对，
幂等保持。它报的两个失败（enrichment 超时、gsva 输入不符）主代理接手处理。

## 顺手修掉 gsva_pathways 的三个真缺陷

Plato 用 scrna_integrated.h5ad 作输入被自校验拒绝（含负值），换成脚本首选的
scrna_norm.h5ad 后又连踩三个：

1. R 段 `pattern = "\.gmt$"` 是非法转义，R 报 unrecognized escape。 heredoc 是
   单引号不做替换，R 收到的就是字面 `"\."`。改成 `"\\."` 后 R_PARSE_OK。

2. `fail <- function(msg)` 单参数定义，第 212 行却传三个参数，报 unused
   arguments。改成 `function(...)` 可变参数。已扫其余 38 个脚本无同类。

3. 出图段用了 `NORM` 但该段没定义，NameError。第一段通过 BIO_GSVA_NORM 环境
   变量拿，第二段漏了，补同样的读取。

另有一次是我自己的失误：插 outputs 时写成 `report_lines.append`，而该段变量名
   是 `lines`，报 NameError。改成 lines.append 后通过。

## 各脚本台账覆盖实例

cell_communication：scrna_cellcomm.h5ad、cellcomm_interactions.tsv（2 条）
deg_groups：scrna_deg.h5ad、deg_all_by_celltype.tsv、deg_significant_by_celltype.tsv（3 条）
subcluster：2 h5ad 加 2 tsv（4 条）
virtual_knockout：knockout h5ad、ko_dr_genes.tsv、memory_peak（3 条）
line3 celltype_annotation：2 species x 5 文件（10 条）
line3 dr_post_analysis：2 species x 4 文件（8 条）
gsva_pathways：scrna_gsva.h5ad、gsva_scores.tsv（2 条，7174 条通路）
enrichment：enrichment_ora.tsv、enrichment_gsea.tsv（2 条，GSEA 18669 行）

全部逐条实算哈希一致，二次执行段数恒为 1。

## 温度

本轮全部实跑峰值 43.2 度（Plato）与 58 度（主代理跑 gsva 与 enrichment 时），
未触 60 度门禁。enrichment 的 GSEA 对 13 个 celltype x 3 库跑 prerank，
250 秒不够，给到 880 秒才完成，是计算量不是缺陷。

## 当前资产状态

line1_bulk 17 个改造资产：动态验证 17/17
line2_scrna 22 个脚本：动态验证 6 个（qc_cells、normalize_hvg、
enrichment_figures、annotate_celltypes、cell_communication、cluster_umap、
deg_groups、gsva_pathways、enrichment），outputs 行 22/22
line3_spatial 17 个脚本：动态验证 15/15，outputs 行 17/17

line2 剩余未动态实跑的 13 个已有 outputs 行与钩子，契约层面完整，实跑属运行期
验收范围。
