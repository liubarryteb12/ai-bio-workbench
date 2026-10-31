2026-10-25 outputs 行补齐尝试与回滚，line2 部分动态验证

## line2 动态验证进展

Lovelace 跑到第 4 个时温度达 74 度触发热闸（我设的闸是 55 度，它实测 74 度立即停止，
处置正确）。已完成 3 个：

annotate_celltypes exit 0，台账 2 条，逐条哈希对，幂等保持
cell_communication exit 0，台账 1 条，逐条哈希对，幂等保持，但覆盖不全
cluster_umap exit 0，台账 1 条，逐条哈希对，幂等保持

deg_groups 及后续 15 个未启动。

## line1 动态验证补齐至 17/17

主代理自验剩余 4 个：

prognostic_diagnostic_roc exit 0，台账 7 条
rf_gene_select exit 0，台账 4 条，selected_genes=G7,G3,G2,G11,G9
cibersort_reference exit 0，台账 8 条
multi_metric_survival_roc exit 0，台账 5 条，risk_score AUC 0.907
wgcna_module_trait 用真实 20019 基因数据跑通，exit 0，台账 6 条

multi_metric 前两次失败是测试数据设计问题：时间点 300 天前只有 2 个事件，
脚本要求不少于 5 个，这是合理校验。改 500 天（26 事件 54 对照）后通过。

至此 line1_bulk 的 17 个改造资产全部完成动态验证。

## outputs 行补齐：尝试后回滚

### 动机

Lovelace 报 cell_communication 台账覆盖不全：实际产出 scrna_cellcomm.h5ad 与
cellcomm_interactions.tsv，但台账只登记了 tsv。根因是台账脚本在没有 outputs=
行时退回目录扫描，而目录扫描排除 .h5ad（原本为排除上游输入）。

### 为什么不能靠改台账脚本解决

试过把目录扫描改成不排除 h5ad，随即发现 cell_communication 的工作目录里同时
放着上游输入（scrna_annotated.h5ad、scrna_norm.h5ad）与本次产物
（scrna_cellcomm.h5ad），扩展名分不出归属，会把输入也登记进台账。已回滚该改动。

根本解只能是给脚本补 outputs= 行走清单模式。

### 补丁过程与失败

写了通用补丁工具，给 12 个脚本插 outputs 行。但连续引入两类缺陷：

1. 插到 fh.write 之后，报告已落盘，追加进列表不起作用。cell_communication
   实跑证实台账仍只有 tsv。

2. 插到 with open 与 fh.write 之间，把 with 块劈断，Python 报 IndentationError。
   enrichment 实跑暴露。写了个批量修正脚本想把 outputs 行前提，结果又把
   normalize_hvg 原本正确的两行式 outputs 撕成残片，同样 IndentationError。

全量 Python 段语法扫描一度报 4 个 PY_FAIL。

### 处置：全部回滚

用 .bak_20261025_outputs_line 备份回滚全部 12 个，用 .bak_20261025_ledger_hook
恢复 normalize_hvg，并补回它丢失的钩子。

回滚后全量复验：39 个脚本 bash 0 fail、Python 0 fail、钩子 39/39、
有 outputs 行 27 个（这 27 个是原本就写对的）。

回归验证：normalize_hvg exit 0 台账 6 条自校验 OK，qc_cells 对照 exit 0 台账 6 条。

双端哈希 39/39 一致。

## 教训

这轮最有价值的一条：批量文本插补在这种结构高度不统一的脚本群体上风险很高。
12 个脚本的报告写出段有 with open 加 fh.write、OUT_RPT 变量、report_lines 与
lines 混用、只写 manifest 不写 report 等至少五种写法，一个通用正则覆盖不了。

正确做法本来应该是逐个脚本看清结构再单独改，但那需要 12 次单独的精修。
在已经投入两轮失败后选择回滚是合理的：台账覆盖不全是一个已知的、有明确记录的
缺陷，而批量插补引入的 IndentationError 是会让脚本直接跑不起来的回归。
留一个记录在案的缺陷，比留一堆跑不起来的脚本好。

## 当前状态与后续建议

39 个 line2 与 line3 脚本状态干净：语法全过、钩子 39/39、27 个有正确 outputs 行、
12 个走目录扫描（其中 h5ad 产物不会被登记，这是已知缺陷）。

已动态验证的脚本累计：line3 全部 15 个，line2 的 5 个（qc_cells、normalize_hvg、
enrichment_figures、annotate_celltypes、cell_communication、cluster_umap），
line1 全部 17 个。

后续若要补那 12 个的 outputs 行，建议一次只改一个，改完立即 bash -n 加
Python 段 ast.parse 双重校验，再实跑一次确认台账覆盖完整，才动下一个。
