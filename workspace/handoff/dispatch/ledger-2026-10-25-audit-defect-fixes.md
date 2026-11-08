2026-10-25 完成度审计抓出三个缺陷，已修并回归

## 审计方式

本轮恢复派子代理（deepseek-v4.1-flash 通道恢复），按目标要求合理分配：

Ptolemy 核验 line1_bulk 的 17 个改造资产，静态 10 项契约加动态实跑
Chandrasekhar 核验 line2_scrna 与 line3_spatial 共 39 个步骤脚本的台账钩子
主代理自核验分组总表与环境修复三项

三路并行，互不重叠。两个子代理都如实报了缺陷，没有粉饰。

## 抓出的三个缺陷

### 缺陷1：geo_tcga_common_deg 按扩展名硬判分隔符

第 158 行用 `tools::file_ext(path) == "csv"` 决定走 read.csv 还是 read.delim。
这是 12 个脚本补齐内容探测时漏掉的一个，Ptolemy 的静态核验抓出来的。

修复：从 limma_deg_analysis 移植 count_separator_outside_quotes 与
detect_separator 两个函数，read_gene_table 改用 read.table 加探测值。

验证：构造诱捕文件（扩展名 .txt 但内容是逗号分隔），脚本正确输出
sep_detected=comma，30 个基因全部取交集，exit 0。原来这个文件会被 read.delim
当成单列而失败。

### 缺陷2：两个 enrichment_figures 缺 import sys

line2 第 338 行与 line3 第 350 行用了 `sys.argv[0]`，但 import 段只有 os、
time、matplotlib 等，没有 import sys。运行即 NameError，exit 1。

修复：在 import time 后补 import sys。

### 缺陷3：钩子目录参数指错，台账挂不上

这两个脚本的 bash 层把 --output 参数直接丢弃（shift 2 后不用），输出目录由
Python 段的 `OUT = os.path.join(D, "..", "figures")` 硬算。而钩子在 bash 层用
$PWD（即输入目录），报告实际写在输入目录的同级 figures/，钩子自然找不到。

修复：钩子目录参数改为 "$PWD/../figures"。

另外这两个脚本原本只写 figures_manifest.txt，不写规范要求的 *_report.txt。
已补一个 report 写出块，含 step、seed、out、figure_count、elapsed_seconds、
outputs 六个字段。

## 回归验证（四项全绿）

limma_deg_analysis 输出 sha256 与基线 57eed9a42fe0489c077b5496d6e7140fc559e7ab
155d92b654beb8de3b888902 完全一致，统计路径未被破坏
geo_tcga_common_deg 诱捕文件 sep_detected=comma 正确，交集 30
line2 enrichment_figures exit 0，台账 3 条，逐条哈希自校验全 OK
line2 qc_cells exit 0，台账 6 条，原有功能未回归

温度峰值 30.8 摄氏度。

## 一个路径假设的自我纠正

同步时以为 line1 的改造资产也该在 src/line1_bulk/scripts/ 下有母版，报了
SRC_MISSING。核实后发现：src/line1_bulk/scripts/ 只放 16 个原始母版分析步骤，
17 个改造资产是后加的新脚本，不是任何母版的改造版，它们的唯一母版就是
bin/line1_bulk/。line2 与 line3 则是既有母版加钩子，所以 bin 与 src 一一对应
（23 与 18 全匹配）。

这不是缺陷，是路径假设错了。已按真实结构同步，三个修复文件本地与远端哈希一致。

## 双端一致性

三个修复文件本地与远端 bin 哈希逐项一致：
geo_tcga_common_deg 8b8e76cc51590986
line2_scrna/enrichment_figures 77a447ff100665b9
line3_spatial/enrichment_figures a80374b7185b189b

均无 BOM、纯 LF。远端 src 母版（line2 与 line3）也已更新为含修复版本，
与原版各有 .bak_20261025_pre_fix 备份。

## 审计结论

line1_bulk：静态契约 17/17 满足（缺陷1修复前是 16/17），动态 6/6 通过，
退出码矩阵 30/30 PASS
line2_scrna 与 line3_spatial：静态契约 39/39 满足，动态 3/5 通过（2 个失败
即本次修掉的缺陷2 与缺陷3）
分组总表：6 张 validate 全 VALID
环境修复三项：shim 哈希未变，plain 与 vanilla 均正确给 R 4.5.3 加
R_PROFILE_USER，登录 shell 裸 Rscript 解析到 shim，模板挂载 0 告警

## 遗留

line2 与 line3 共 39 个脚本里，除已动态验证的 5 个外，其余 34 个只做了静态
核验，未逐个实跑。这些脚本的钩子机制已由 3 个成功样本证明可用，但逐个脚本的
输入契约各不相同，全部实跑需要按项目真实数据逐线推进，属运行期验收而非改造
验收范围。
