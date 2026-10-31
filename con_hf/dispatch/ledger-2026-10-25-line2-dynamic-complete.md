# 2026-10-25 line2_scrna 剩余脚本动态实跑，两个契约缺陷修毕

## 规模

剩余 6 个脚本分三路推进：两个子代理分线实跑，主代理接手被限流打挂的第三路，
并同步修掉两个已确认的接口缺陷。

## 本轮实跑结果

### virtual_knockout（主代理实跑）

exit 0，耗时 22 秒，ko_gene=TNF，dr_genes=1225，显著 adj p<0.05 共 5 个
（含敲除基因自身 1 个，不含则 4 个），敲除基因按 p-value 排第 1。
top DR 为 TMEM45A（Z=4.675, FC=595.2, padj=1.131e-128）与 S100A9
（Z=4.664, FC=580.1, padj=1.437e-125），与 2026-10-13 上游结果一致。
QC 后矩阵 1225 基因 x 2531 细胞（输入 2000 x 2747，剔 216 细胞 775 基因），
与上游口径相同。memory_peak 各阶段峰值 721 MB，全程 7 个阶段恒定为该值。
温度采样起始 41.3 度、结束 48.6 度、观测最高至少 48.6 度，未触闸。
产物字节数与上游几乎一致：ko_dr_genes.tsv 131996（上游 132058）、
scrna_knockout.h5ad 54039698（上游 54039418）。台账 3 条，两次执行段数恒为 3。

### dr_post_analysis（主代理实跑，契约缺陷已修）

exit 0，耗时 28 秒。cwd 起始为空目录（0 个文件），五个输入全部经 --input
绝对路径注入，证明契约修复生效。ko_gene=TNF，n_dr=1225，DR 富集 1975 条
（GO BP/CC/MF、KEGG_2021_Human、Reactome_Pathways_2024 五个库），
top 富集为 T Cell Receptor Signaling Pathway（NES=2.36 FDR q=0）、
Antigen Receptor-Mediated Signaling（NES=2.35）、TCR Signaling（NES=2.30）。
调控网络 59 边、29 TF、9 DR 靶。DR 显著 4 个、DEG 显著 179 个、marker 78 个，
交集 DR_sig 与 DEG_sig 为 0、DR_sig 与 marker 为 3、3-way 为 0。
产物字节数与上游几乎一致：dr_enrichment.tsv 346951（上游 346973）、
dr_overlap.tsv 9338（一致）、dr_regulatory_network.tsv 1072（一致）。
台账两次执行均 6 条，幂等稳定。

### target_gene_localization（子代理实跑，closed fh 缺陷已修）

首跑 exit 1：四个约定产物全部正确产出后，报告文件已关闭又写一次，
报 ValueError: I/O operation on closed file。输入已确认含 layers['counts']
与 obs['celltype']，判定为脚本缺陷而非输入契约问题。根因是 outputs 行被插到
with open 块之后，既劈断写入又导致报告缺 outputs 行，台账因此只能目录扫描、
只登记 2 个 TSV，漏掉 h5ad 与 PNG。

修法：把 outputs 行并入 lines 列表随报告一次性写出，删除块后的 fh.write，
并补上此前漏登记的 l2_13_target_gene_dotplot.png。

复跑 exit 0：cells=4587、genes=2000、target genes=11（ko TNF 加各类型 top5 DEG）、
长表 143 行 = 11 基因 x 13 细胞类型。四个产物字节数与上游完全一致
（7686、1363、报告 2101 含台账，h5ad 88094758）。台账自动登记 4 个产物含 PNG，
两次执行段数恒定，逐条哈希一致。

### scrna_figures（子代理实跑）

exit 0，耗时 21 秒，manifest 登记 22 张 PNG，22/22 通过 PIL 解码。
覆盖 UMAP（celltype/diagnosis/donor/leiden）、组成堆叠图与 13 个细胞类型箱线图、
marker top5、DEG 显著条形图、PCA diagnosis。台账 22 条，自动钩子与两次手工
执行段数均恒定，22 条逐条哈希一致。温度最高 43.6 度，未触闸。
一处非阻断元数据异常：manifest 首行步骤名显示为 step=-。

### scenic_tf 与 scenic_figures（scenic_tf 未完成）

scenic_tf 仅见进入 GRNBoost2 的日志，未完成；当前已无进程，且无正式产物。
退出原因未知。

## 修掉的两个缺陷

### 缺陷 1：dr_post_analysis 的 --input 契约完全失效

bash 层第 31 行收下 INPUTS 数组，Python 层却只读 cwd 固定文件名，
传入的绝对路径被整体丢弃。

修法分两层。bash 层按文件名特征把 INPUTS 分流为五个角色并 export
（IN_KO_H5AD、IN_KO_DR_TSV、IN_SCENIC_CSV、IN_DEG_TSV、IN_DEG_H5AD），
Python 层新增 resolve_input() 优先读环境变量、缺失时回落到 cwd 固定名，
保持旧调用方式可用。首轮修补漏了 export，Python 读不到变量报缺少输入，
复跑加 export 后通过。这个坑记下来：heredoc 传参必须显式 export，
小写局部变量不会进子进程环境。

### 缺陷 2：target_gene_localization 向已关闭文件写 outputs 行

见上。同类风险需全库复查：所有 outputs 行都必须落在 with open 块内。

## 全库待复查项

1. line3_spatial 的 dr_post_analysis 有同样的 cwd 固定文件名模式
   （第 256 到 259 行 spatial_knockout_%s.h5ad 等），但 line3 的 --input
   分流是否同样失效尚未验证，需单独确认。
2. 全库 39 个脚本逐个确认 outputs 行位置，排查是否还有插到 with open 块外的。
3. line2 剩余 scenic_figures 待收口。

## 温度与环境

本轮最高温度 48.6 度，全程未触 60 度门禁。R 4.5.3 与 shim 未受影响。
