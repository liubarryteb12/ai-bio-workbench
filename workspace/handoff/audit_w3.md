# PRJ_AIMS_V3_20261027 图件实型审计（W3）

审计日期：2026-11-10
审计对象：9 张 PNG，逐一打开目视判型，只读，不改动任何图件或代码。
路径基准：`workspace/projects/PRJ_AIMS_V3_20261027/figures/`

| 文件名 | 实际图型 | 内容摘要 |
|---|---|---|
| l2_01_umap_celltype.png | UMAP 散点图（细胞类型着色） | 单细胞降维图，13 类细胞（Langerhans_cell、NK_ILC、T_cell、activated/basal/channel/progenitor/suprabasal keratinocyte、macrophage_mDC、melanocyte、mitotic、pDC、unknown），UMAP1/UMAP2 无刻度，图例右侧，角质细胞群在中部连片，T/NK 在右侧独立岛。 |
| l2_07_comm_top.png | 未找到 | line2 目录无任何细胞通讯图；同项目仅 line3 有 `custom_fig_l3_cellcomm_chord.png`（弦图）。 |
| l2_07_marker_top5.png | 热图（marker 表达矩阵） | 25 个基因（FABP5、S100A8、HLA-DRA、COL17A1、KRTDAP、CD3D 等）× 21 个 cluster（C0–C20）的表达热图，色标 0.5–3.0 无标题；无细胞类型注释，行列近似随机无分块，且行数 25 与文件名 "top5"（21 簇 × 5 应 105 行）不符。 |
| custom_fig_l2_networkplot.png | 网络图（差异调控网络） | 标题 "Differential regulation network (knockout)"，约 40 个转录因子节点、橙色 hub（PEA15、KLF6、PLK2、PHTF2、PDE4D 等），灰色边示调控关系，无图例、无阈值或节点大小说明。 |
| l3_mouse_01_domains_B1-D1.png | 未找到 | mouse 域图按样本命名，实有 BH001、CAP002、JBO001–JBO012 共 10 个，无 B1-D1 样本。 |
| l3_mouse_15_deconv_composition.png | 堆叠柱状构成图（反卷积比例） | 10 个样本（BH001、CAP002、JBO001–JBO012）的细胞类型占比，y 轴 Deconvolved Fraction 0–1，每样本 5–7 个类型（d0–d6），双列图例约 50 项。 |
| l3_mouse_02_target_gene_B1-D1.png | 未找到 | 同名规则下实有 10 个样本版本，无 B1-D1。 |
| l3_mouse_04_morans_top.png | 排序水平条形图（Moran's I） | Top15 空间自相关基因，Cyp2c29 至 Mup17，Moran's I 约 0.52–0.60，x 轴 Moran's I Autocorrelation；榜单含 mt-Nd2、mt-Co2、mt-Co3、mt-Co1、mt-Atp6 等线粒体基因与 Mup 家族。 |
| l3_mouse_19_communication.png | 未找到 | line3 编号最大到 16，无 19 号图；通讯类图仅 `custom_fig_l3_cellcomm_chord.png`。 |

## 需回看的三处

- `l2_07_marker_top5.png` 名实不符：文件名指每簇 Top5 marker，图内是 25 行基因 × 21 簇的矩阵，且无分块特异性。按 marker 图对外交付会被质疑。
- `l3_mouse_04_morans_top.png` 的 Top15 混入 5 个线粒体基因，空间自相关排名被技术性基因占据，建议过滤后重算。
- 4 张缺失图中，`l3_mouse_01_domains_B1-D1.png` 与 `l3_mouse_02_target_gene_B1-D1.png` 的 B1-D1 命名与现有样本编号体系（BH/CAP/JBO）完全不匹配，疑似工单编号与产出编号未对齐。
