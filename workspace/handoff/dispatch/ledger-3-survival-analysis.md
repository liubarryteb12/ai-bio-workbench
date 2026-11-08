# 3.生存分析 K40 生产化台账

日期：2026-10-25

状态：K40 六项验收通过。最终脚本已部署，本地与远端 sha256 一致。

## 来源与产物

来源目录：

```text
D:\00.AIagent\codespace\AI辅助生信分析流程工作台\reference\00a.可参考代码库\3.生存分析
```

源目录只有一份文件：

```text
生存筛选.R
```

最终本地脚本：

```text
D:\00.AIagent\codespace\AI辅助生信分析流程工作台\src\line1_bulk\scripts\survival_analysis
```

K40 部署路径：

```text
/mnt/ssd/bio_data/bin/line1_bulk/survival_analysis
```

K40 备份：

```text
/mnt/ssd/bio_data/bin/line1_bulk/survival_analysis.bak_20261025_pre_ci_fix
/mnt/ssd/bio_data/bin/line1_bulk/survival_analysis.bak_20261025_pre_seed_bound_fix
```

## 母版问题清单

1. `library(tidyverse)` 引入整栈。生产版只加载 `survival`、`ggplot2`、`digest`，其余逻辑用 base R。
2. 使用 `class(x) == "matrix"`。该写法在 matrix 上可能返回长度大于 1 的逻辑向量，生产版改用 `is.matrix()`。
3. 无参数解析，输入文件名写死为 `diffGeneExp.txt` 和 `time.txt`。
4. 无种子契约，无 `BIOANALYS_SEED`，无 `--seed` 覆盖。
5. 无显式退出码分层，输入错误、计算错误和自校验错误不可区分。
6. 无输入文件存在性检查，无列名、重复样本、时间、状态和数值范围检查。
7. 无 `--sample-col`，标准样本行表会因样本列被当成特征而失败。
8. 硬编码 TCGA 的 `-01A` 筛选和 barcode 截断，不能处理普通标准表。
9. 用 `rt[, gene]` 和未限定列名构造 Cox，遇到特殊字符或列冲突时风险高。
10. 5 年生存率依赖“最后一个小于 5 年的事件点”，没有事件点时结果不稳定。
11. 常数组、中位数单组、Cox 不可估计、KM 不可估计均无显式处理。
12. 直接写 `.xls`，实际为制表符文本，且未启用 `qmethod="double"`。
13. 无 locale 校验，无原子写，无读回校验，无 PNG 校验，无 report 台账，无 sha256。
14. 源脚本没有图，但生产版若新增 PNG，必须同时传 `device=png` 和 `type="cairo"`。生产版已满足。
15. 源脚本对可选参数没有判空框架。生产版对可选数值参数使用显式默认值和 `length()` 检查，避免 `as.numeric(NULL)` 后进入零长度 `if`。

## 最终接口

调用入口固定使用显式 shim：

```bash
/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript \
  /mnt/ssd/bio_data/bin/line1_bulk/survival_analysis \
  --input <expression.tsv> \
  [--clinical <clinical.tsv>] \
  --output <prefix> \
  [--sample-col none|sample_id] \
  [--time-col futime] \
  [--status-col fustat] \
  [--clinical-sample-col auto] \
  [--time-divisor 365] \
  [--p-threshold 0.05] \
  [--five-year-diff 0.15] \
  [--min-sd 0.1] \
  [--horizon-years 5] \
  [--seed <integer>]
```

输入方向：

- `--sample-col none`：首列为基因或变量名，其余列名为样本名，对应母版方向。
- `--sample-col sample_id`：样本为行，首列为样本 ID，基因或变量从第二列开始。
- 提供 `--clinical` 时，表达表和临床表按样本 ID 求交集。
- 不提供 `--clinical` 时，标准输入表必须同时含 `futime` 和 `fustat`。

种子契约：

- 环境变量为 `BIOANALYS_SEED`。
- `--seed` 可覆盖环境变量。
- 两者都没有、非整数、超出 R 可表示整数范围时退出 3。
- 负整数允许，实测 `--seed -42` 和 `BIOANALYS_SEED=-7` 均通过。

退出码：

| 退出码 | 含义 |
|---|---|
| 0 | 成功，产物和台账齐备 |
| 1 | 自校验失败 |
| 2 | 参数错误或输入契约失败 |
| 3 | 种子缺失、非法或超出范围 |

产物：

```text
<prefix>_survival_genes.tsv
<prefix>_significant_genes.tsv
<prefix>_significant_expression.tsv
<prefix>_sample_groups.tsv
<prefix>_km_curve.tsv
<prefix>_km.png
<prefix>_report.txt
```

## 静态与部署校验

本地脚本：

```text
bytes=44152
lines=1215
crlf=0
bom=False
sha256=c12bdcf4215e60af26383d3b296e93a490069f4933954b11dcf77cea6f2ad99a
```

K40：

```text
-rwxr-xr-x. 1 root root 44152 Oct 24 18:21 /mnt/ssd/bio_data/bin/line1_bulk/survival_analysis
c12bdcf4215e60af26383d3b296e93a490069f4933954b11dcf77cea6f2ad99a
```

R 4.5.3 解析：

```text
R_PARSE_OK
```

静态检索未命中：

```text
tidyverse
class(x) == "matrix"
as.numeric(NULL)
子进程 Rscript
```

包版本：

```text
survival=3.8.12
ggplot2=4.0.3
digest=0.6.39
```

## 验收 1：正常路径

命令：

```bash
/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript \
  /mnt/ssd/bio_data/bin/line1_bulk/survival_analysis \
  --input /mnt/ssd/bio_data/projects/default/line1_bulk/processed/survival_analysis_test/expression_sample_rows.tsv \
  --clinical /mnt/ssd/bio_data/projects/default/line1_bulk/processed/survival_analysis_test/clinical.tsv \
  --output /mnt/ssd/bio_data/projects/default/line1_bulk/processed/survival_analysis_test/results/final_normal \
  --sample-col sample_id \
  --seed -42
```

关键输出：

```text
normal_exit=0
sample_col=sample_id
matched_samples=24
significant_feature_count=1
top_gene=GENE_RISK
top_gene_km_p=2.311996e-05
top_gene_cox_p=0.0003978971
top_gene_hr=1.482124
total_elapsed_seconds=0.699
png_magic=89504e47
```

结论：通过。7 个产物全部生成，PNG 魔数为 `89504e47`，report 非空。

## 验收 2：退出码矩阵

实测：

```text
missing_seed_exit=3
non_integer_seed_exit=3
out_of_range_seed_exit=3
unknown_arg_exit=2
missing_required_exit=2
missing_input_exit=2
missing_sample_col_exit=2
```

关键错误：

```text
seed contract failure: BIOANALYS_SEED is not set and --seed was not provided
seed contract failure: seed is not an integer: abc
seed contract failure: seed is outside the R integer range: -2147483648
input contract failure: unknown argument: --bogus
input contract failure: required arguments are --input and --output
input contract failure: input file does not exist
input contract failure: sample column does not exist: no_such_col
```

结论：通过。退出码分层符合 2/3 契约。

## 验收 3：种子可复现

同一份数据、同一输出口径，使用 `--seed 20261025` 连跑两次。

```text
final_rep1_exit=0
final_rep2_exit=0
```

关键产物 sha256：

```text
87eb3246978a75379ab3b45ebaae83d23c698bb8ec954c94f6f3e4d45ba8d77f  final_rep1_survival_genes.tsv
87eb3246978a75379ab3b45ebaae83d23c698bb8ec954c94f6f3e4d45ba8d77f  final_rep2_survival_genes.tsv
086e053fa320f6b0a9c32fbab2249cdda6bedf723cfda6fb4383cb53649017f1  final_rep1_sample_groups.tsv
086e053fa320f6b0a9c32fbab2249cdda6bedf723cfda6fb4383cb53649017f1  final_rep2_sample_groups.tsv
564273d52c15f3eaf6c936edc32e5ed3771ac391f7fd99f2436c1e7be6273d0e  final_rep1_km_curve.tsv
564273d52c15f3eaf6c936edc32e5ed3771ac391f7fd99f2436c1e7be6273d0e  final_rep2_km_curve.tsv
23c0fa17349cc6328cc2334d9b954129715fcb8e84a92bcb0c9dd2d964cea699  final_rep1_km.png
23c0fa17349cc6328cc2334d9b954129715fcb8e84a92bcb0c9dd2d964cea699  final_rep2_km.png
```

结论：通过。结果表、分组表、KM 曲线和 PNG 均逐字节一致。

## 验收 4：sample_id 首列标准表

命令：

```bash
/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript \
  /mnt/ssd/bio_data/bin/line1_bulk/survival_analysis \
  --input /mnt/ssd/bio_data/projects/default/line1_bulk/processed/survival_analysis_test/merged_sample_id.tsv \
  --output /mnt/ssd/bio_data/projects/default/line1_bulk/processed/survival_analysis_test/results/final_sample_id \
  --sample-col sample_id \
  --seed 20261025
```

关键输出：

```text
sample_id_merged_exit=0
input_layout=sample_rows_feature_columns
sample_col=sample_id
matched_samples=24
significant_feature_count=1
top_gene=GENE_RISK
top_gene_low_group_n=12
top_gene_high_group_n=12
km_png_sha256=23c0fa17349cc6328cc2334d9b954129715fcb8e84a92bcb0c9dd2d964cea699
```

兼容复验：

```text
gene_rows_none_exit=0
input_layout=feature_rows_sample_columns
sample_col=none
matched_samples=24
```

结论：通过。标准样本行表和母版基因行表均可运行。

## 验收 5：数据正确性

测试数据为 24 例。设计真值：

- `S01` 到 `S12` 为高风险表达组，12 例全部发生事件。
- `S13` 到 `S24` 为低风险表达组，其中 3 例发生事件，9 例删失。
- 高表达组生存时间短，低表达组生存时间长。

独立 Python 断言输出：

```text
final_data_correctness=PASS
km_p=2.31199590348251e-05
cox_p=0.000397897113931485
hr=1.48212367459802
low_n=12
high_n=12
five_year_diff=0.75
```

核对项：

- `S01` 到 `S12` 全部归入 `high`。
- `S13` 到 `S24` 全部归入 `low`。
- 两组各 12 例，低风险组事件 3 例，高风险组事件 12 例。
- KM p 小于 0.05。
- Cox p 小于 0.05。
- HR 大于 1。
- 5 年生存差为 0.75。

结论：通过。KM 分组、风险组样本数、事件数、Cox HR 和 p 值与设计真值一致。

## 验收 6：资源与温度

实测：

```text
perf_exit=0
max_rss_kb=268876
total_elapsed_seconds=0.789
temp_before_millicelsius=32656
temp_after_millicelsius=33600
```

结论：通过。峰值 RSS 约 263 MiB，耗时约 0.79 秒，运行前后最高有效温度约 32.7 到 33.6 摄氏度，低于 60 摄氏度停止线。

## 最终 sha256

脚本：

```text
c12bdcf4215e60af26383d3b296e93a490069f4933954b11dcf77cea6f2ad99a
```

正常路径关键产物：

```text
survival_genes       87eb3246978a75379ab3b45ebaae83d23c698bb8ec954c94f6f3e4d45ba8d77f
significant_genes    eb1fe68cb719ede79e6874292cbb9ea175623abf78a164efabc807c142a2a17a
sample_groups        086e053fa320f6b0a9c32fbab2249cdda6bedf723cfda6fb4383cb53649017f1
km_curve             564273d52c15f3eaf6c936edc32e5ed3771ac391f7fd99f2436c1e7be6273d0e
km_png               23c0fa17349cc6328cc2334d9b954129715fcb8e84a92bcb0c9dd2d964cea699
```

report 含完成时间，不做跨运行逐字节比较。其自身 sha256 由每次运行 stdout 和 report 内记录给出。

## 遗留项

1. K40 登录 shell 的裸 `Rscript` PATH 仍由另一条任务统一修复。当前生产调用必须使用显式 shim，本次所有 R 验证均使用该 shim。
2. 本次只用确定性合成数据验证统计路径，未用真实 TCGA 或 GEO 生存队列重跑。真实数据仍需按项目目录和临床字段命名执行一次入线验收。
3. 母版 TCGA `-01A` 自动筛选和 barcode 截断未作为隐式行为保留。生产版通过 `--sample-col`、样本 ID 对齐和标准表输入显式处理，避免把 TCGA 规则写死为全库规则。
4. 未运行任何禁止的母版分析脚本。K40 实际执行的业务入口只有新写的 `survival_analysis`。

## 返工记录 2026-10-25：CSV 输入被 read.delim 读成单列

主代理独立复核发现的真实缺陷，已修复并重跑验收。

### 缺陷根因

原实现的输入读取层无条件调用 `read.delim()`，固定按 Tab 分隔解析。逗号分隔 CSV 因此被当成单列读入，列数为 1，触发基因行模式下的列数下限校验而退出 2。

主代理复现命令：

```bash
/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript \
  /mnt/ssd/bio_data/bin/line1_bulk/survival_analysis \
  --input expr.csv --clinical clin.csv --output out \
  --time-col futime --status-col fustat --seed 20261025
```

修复前关键输出：

```text
step_executed=survival_analysis:read_input
survival_analysis input contract failure: gene-row expression input needs one feature column and at least 2 sample columns
EXIT=2
```

同一个文件用 R 的 `read.csv` 读取为 13 列 3 行，数据本身正常，问题在分隔符假设。

此前验收全过，是因为自建测试数据统一用了 TSV，没有覆盖 CSV。

### 分隔符探测实现

原则是内容探测，不按扩展名硬判。扩展名只影响人的预期，不影响解析，`expr_tab.txt` 这类扩展名与内容不一致的文件必须照样读对。

探测函数在读取前取文件前 5 个非空行，对候选分隔符统计出现次数：

```r
count_separator_outside_quotes(text_line, separator)
```

统计按字符逐位遍历，遇到双引号翻转 `inside_quote` 状态，只累计引号外的出现次数。带引号字段里含逗号或分号时，引号内容不会干扰判定。

候选为 Tab、逗号、分号三项。对每个候选取各行计数的最大值，再取三个候选中最大者为胜出。该判据同时利用列数维度和跨行一致性：

- 正确分隔符让每行字段数等于列数，误判分隔符只让某一行多出几个字符，跨行不稳定。
- 取每候选项的行内最大值再跨候选取最大，等价于要求该分隔符在至少一行给出最多字段。

两个候选并列第一时判定为歧义，退出 2 并提示用 `--sep` 显式指定，不做静默猜测。三项取值均为 0 时同样退出 2 并提示。

空格不参与自动探测。空格在基因名、样本 ID 和文本字段里太常见，自动判定容易误判，空格分隔只通过显式 `--sep space` 启用。

读取层改为按探测结果传 `sep`，用 `read.table` 替代固定的 `read.delim`，并把探测值作为 `sep` 参数传入，其余参数保持不变。表达式表和临床表各自探测一次，两个文件可以用不同分隔符。

新增 `--sep` 参数，取值 `auto`（默认）、`tab`、`comma`、`semicolon`、`space`，也可直接传分隔符字符。非法值退出 2。显式 `--sep` 优先于自动探测，给异常文件留出手动通道。

### na.strings 的评估

`na.strings = c("NA", "NaN", "")` 中的空串保留。作用是把真正的空字段读成 `NA`，后续由数值转换检查和样本 ID 检查给出明确报错。原缺陷里它让问题更难诊断，是因为分隔符误判后整行变成单列，空串语义被放大成整表结构异常。分隔符修对后，空串回到原本语义，不影响正确文件解析。

### 验收 7：逗号 CSV，基因行模式

命令：

```bash
/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript \
  /mnt/ssd/bio_data/bin/line1_bulk/survival_analysis \
  --input .../survival_analysis_sepfix/expr_comma.csv \
  --clinical .../survival_analysis_sepfix/clin_comma.csv \
  --output .../results/csv_gene_rows \
  --time-col futime --status-col fustat --seed 20261025
```

关键输出：

```text
csv_gene_rows_exit=0
sample_col=none
sep=auto
input_layout=feature_rows_sample_columns
matched_samples=24
significant_feature_count=1
top_gene=GENE_RISK
total_elapsed_seconds=0.761
png_magic=89504e47
```

产物 7 个齐全。这是主代理复现失败的同一条命令路径。

### 验收 8：制表符 TSV，基因行模式

关键输出：

```text
tsv_gene_rows_exit=0
sample_col=none
sep=auto
input_layout=feature_rows_sample_columns
matched_samples=24
significant_feature_count=1
top_gene=GENE_RISK
total_elapsed_seconds=0.797
png_magic=89504e47
```

产物 7 个齐全。原有 TSV 能力未因探测改动回退。

### 验收 9：sample_rows 模式的 CSV

命令：

```bash
/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript \
  /mnt/ssd/bio_data/bin/line1_bulk/survival_analysis \
  --input .../expr_sample_rows.csv \
  --output .../results/csv_sample_rows \
  --sample-col sample_id --seed 20261025
```

关键输出：

```text
csv_sample_rows_exit=0
sample_col=sample_id
sep=auto
input_layout=sample_rows_feature_columns
matched_samples=24
significant_feature_count=1
top_gene=GENE_RISK
png_magic=89504e47
```

### 验收 10：带引号 CSV

样本列名改为带引号的 `S01_notes` 形式。

关键输出：

```text
csv_quoted_exit=0
sep=auto
matched_samples=24
top_gene=GENE_RISK
```

引号外计数逻辑生效，引号内容未干扰分隔符判定。

### 验收 11：分隔符与内容一致性

`.txt` 扩展名但实际为 Tab 分隔：

```text
txt_tab_exit=0
sep=auto
matched_samples=24
top_gene=GENE_RISK
```

分号分隔完整数据集：

```text
semicolon_full_exit=0
sep=auto
matched_samples=24
top_gene=GENE_RISK
```

空格分隔显式覆盖：

```text
space_full_exit=0
sep=space
input_layout=sample_rows_feature_columns
matched_samples=24
top_gene=GENE_RISK
```

混合分隔符的非法文件给出明确失败而非静默误读：

```text
mixed_sep_exit=2
survival_analysis input contract failure: unable to read expression input : line 1 did not have 3 elements
```

非法 `--sep` 取值：

```text
invalid_sep_value_exit=2
survival_analysis input contract failure: --sep must be one of: auto, tab, comma, semicolon, space
```

### 分隔符等价性

同一份数据、同一布局、同一 seed，仅分隔符不同，结果表逐字节一致：

```text
87eb3246978a75379ab3b45ebaae83d23c698bb8ec954c94f6f3e4d45ba8d77f  csv_gene_rows_survival_genes.tsv
87eb3246978a75379ab3b45ebaae83d23c698bb8ec954c94f6f3e4d45ba8d77f  tsv_gene_rows_survival_genes.tsv
87eb3246978a75379ab3b45ebaae83d23c698bb8ec954c94f6f3e4d45ba8d77f  csv_sample_rows_survival_genes.tsv
87eb3246978a75379ab3b45ebaae83d23c698bb8ec954c94f6f3e4d45ba8d77f  csv_quoted_survival_genes.tsv
```

CSV 路径独立数据正确性断言：

```text
csv_data_correctness=PASS
csv_hr=1.48212367459802 km_p=2.31199590348251e-05 cox_p=0.000397897113931485
```

CSV 路径资源与温度：

```text
perf_csv_exit=0
max_rss_kb=271268
total_elapsed_seconds=1.133
temp_before_millicelsius=30677
temp_after_millicelsius=31651
```

### 原有六项验收回归

返工后重跑，全部维持原结论：

```text
reg_normal_exit=0
matched_samples=24
significant_feature_count=1
top_gene=GENE_RISK
top_gene_km_p=2.311996e-05
top_gene_cox_p=0.0003978971
top_gene_hr=1.482124
total_elapsed_seconds=0.71
png_magic=89504e47
```

退出码矩阵：

```text
reg_missing_seed_exit=3
reg_bad_seed_exit=3
reg_seed_int_min_exit=3
reg_unknown_arg_exit=2
reg_missing_required_exit=2
reg_missing_input_exit=2
reg_missing_sample_col_exit=2
```

输入模式与可复现性：

```text
reg_sample_id_exit=0
input_layout=sample_rows_feature_columns
sample_col=sample_id
matched_samples=24

reg_gene_rows_none_exit=0
input_layout=feature_rows_sample_columns
sample_col=none
matched_samples=24

reg_rep1_exit=0
reg_rep2_exit=0
```

同种子两次运行关键产物哈希一致：

```text
87eb3246978a75379ab3b45ebaae83d23c698bb8ec954c94f6f3e4d45ba8d77f  reg_rep1_survival_genes.tsv
87eb3246978a75379ab3b45ebaae83d23c698bb8ec954c94f6f3e4d45ba8d77f  reg_rep2_survival_genes.tsv
086e053fa320f6b0a9c32fbab2249cdda6bedf723cfda6fb4383cb53649017f1  reg_rep1_sample_groups.tsv
086e053fa320f6b0a9c32fbab2249cdda6bedf723cfda6fb4383cb53649017f1  reg_rep2_sample_groups.tsv
23c0fa17349cc6328cc2334d9b954129715fcb8e84a92bcb0c9dd2d964cea699  reg_rep1_km.png
23c0fa17349cc6328cc2334d9b954129715fcb8e84a92bcb0c9dd2d964cea699  reg_rep2_km.png
```

主代理已确认无需改动的几点，返工后仍保持：种子边界含负值下界、无 tidyverse 残留、无 `class(...) == "matrix"` 写法、未知参数退出 2、缺种子退出 3。

### 返工后的 sha256

旧版，即本次备份内容：

```text
c12bdcf4215e60af26383d3b296e93a490069f4933954b11dcf77cea6f2ad99a
```

新版：

```text
8d601b259e7f5370fc13528eed57cd6fad28214f76f5998722c01094f5d97ce2
```

K40 部署状态：

```text
/mnt/ssd/bio_data/bin/line1_bulk/survival_analysis mode=755 size=47572
/mnt/ssd/bio_data/bin/line1_bulk/survival_analysis.bak_20261025_pre_sep_fix mode=755 size=44152
```

本地与远端 sha256 一致，均为新版哈希。本地文件 `crlf=0`、`bom=False`。

### 输入格式覆盖情况

已覆盖：

- 逗号 CSV，自动探测。
- 制表符 TSV，自动探测。
- 分号分隔，自动探测。
- 带引号字段 CSV，引号外计数生效。
- 空格分隔，显式 `--sep space`。
- `.txt` 扩展名但 Tab 分隔，内容探测优先于扩展名。

未覆盖或仅部分覆盖：

- 空格分隔未纳入自动探测，必须显式指定。基因名和样本 ID 含空格时无法自动判定，这是有意取舍。
- 固定宽度、多字符分隔符如 `::` 不在探测范围，需要上游预处理。
- 引号规则只按 R 默认的双引号转义处理，未做嵌套引号和转义引号的完整 CSV 方言解析。
- 编码假定 UTF-8，未探测 GBK 等编码。
- BOM 未做显式剥离，带 BOM 的 CSV 首列名可能残留 BOM 字符。
