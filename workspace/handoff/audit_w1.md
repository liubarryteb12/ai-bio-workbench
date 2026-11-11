# 图件真实性审计 W1

审计范围：`references/05.可参考生信代码/可用代码预筛选/源码/L2_组学常用图/` 下 12 张 `*_verified.png`。
判定方式：逐张打开 PNG 目视核对，以图内坐标轴、图例与几何形态为准，不以文件名为准。

| 文件名 | 实际图型 | 内容摘要 |
|---|---|---|
| L2_heatmap_verified.png | 层次聚类热图 | 行 30 个基因（GENE1 到 GENE30）、列 8 个样本（S1 到 S8），上下双树状图，顶部 Group 注释条分 Ctrl（浅蓝）与 Treat（粉），色标 Z 从 -6 到 4；样本列按聚类重排，非原始顺序。 |
| L2_pca_verified.png | PCA 散点图 | 横轴 PC1（28.4%），纵轴 PC2（16.1%），Ctrl（蓝）与 Treat（橙）两组各约 60 个样本点，带组内置信椭圆，两组沿 PC1 明显分离。 |
| L2_volcano_verified.png | 火山图 | 横轴 log2(Fold Change) 从 -5 到 5，纵轴 -log10(adjusted P)；阈值线 log2FC=±1 与 adj p=0.05，红点 Up（n=121）、蓝点 Down（n=124）、灰点 NS（n=3755），标注 GENE1、GENE16、GENE121 等；图注写明 4000 基因、245 显著。 |
| L2p_konetwork_verified.png | 调控网络图 | 标题 Differential regulation network (knockout)，橙色 KO TARGET 节点经边连接 11 个蓝色 TF 节点（TF01 到 TF11），再连 22 个灰色 GENE 节点（GENE000 到 GENE021），无坐标轴。 |
| L2p_bar_verified.png | 柱状图（带误差棒） | 横轴富集条目 GO:50002 到 GO:50004 共 12 项，纵轴 Gene count 从 0 到 120，按计数降序排列，每柱带误差棒，最高约 118。 |
| L2p_box_verified.png | 箱线图 | 横轴分组 G0 到 G5 共 6 组，纵轴 Expression（对数刻度）约 0.4 到 30，橙色中位线，中位数随组号递增，组内离散度较大。 |
| L2p_enrichment_verified.png | ORA 气泡图 | 标题 Over-representation analysis，横轴 -log10(adjusted p) 从 2 到 9，纵轴 overlap genes 从 5 到 40，气泡大小与颜色映射 combined score（约 100 到 1200），标注 HALLMARK pathway 01 到 13；右上角标签互相重叠。 |
| L2p_gsea_verified.png | GSEA NES 横向条形图 | 标题 GSEA NES by cell type，横轴 Normalized enrichment score (NES) 从 -2 到 3，纵轴 4 类细胞（immune_infiltrate、hair_follicle、suprabasal、basal_keratinocyte），水平条形以 0 为基线，正负方向与渐变填充表示 NES 符号与大小；非经典 running enrichment score 曲线。 |
| L2p_heatmap_verified.png | 模块-性状相关性热图 | 标题 Module-trait correlation，行 10 个模块 M00 到 M09，列 6 个性状 T0 到 T5，色标为相关系数 r（-1 到 1）的红白蓝发散配色，无聚类树。 |
| L2p_scatter_verified.png | 火山图（文件名与图型不符） | 横轴 log2(Fold Change) 从 -4 到 4，纵轴 -log10(adj.P) 从 0 到 7；灰色 NS、橙色 DE 两类点，纵向 0 处虚线与横向约 1.3 处阈值虚线，呈典型火山口对称分布；该文件不是普通散点图。 |
| L2p_dotplot_verified.png | 点图 | 横轴分组 G0 到 G5，纵轴 cluster 0 到 3，点大小映射 Fraction of cells in group (%)（图例 10 到 60），点颜色映射 Mean expression in group（0 到 3，viridis）；各 cluster 在 G2、G3、G5 有高表达高占比点。 |
| L2p_violin_verified.png | 小提琴图（6 联小多图） | 每个面板对应一个分组 G0 到 G5，横轴 leiden cluster 0 到 3，纵轴表达量约 -4 到 8，四色区分 cluster，白色横线为中位数；G2 的 cluster 2、G5 的 cluster 3 分布明显上移。 |

## 需注意

- `L2p_scatter_verified.png` 实为火山图，与 `L2_volcano_verified.png` 图型重复，命名需修正或确认是否为有意保留的第二版火山图。
- `L2p_gsea_verified.png` 是 NES 汇总条形图，缺少经典 GSEA 的 running enrichment score 折线与 hit 条带，若模板定位为经典 GSEA 图则需补图。
- `L2p_enrichment_verified.png` 右上角 HALLMARK 标签严重重叠，可读性不达标。
