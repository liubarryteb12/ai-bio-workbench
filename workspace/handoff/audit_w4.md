# W4 图件审计（DCM_CHAIN_20261109）

审计对象：`workspace/projects/DCM_CHAIN_20261109/report/figures/`
审计方式：逐张 PNG 目视判读，只读，未改动图件。

| 文件名 | 实际图型 | 内容摘要 |
|---|---|---|
| L1_gsea_top.png | 横向条形图（GSEA NES） | x 轴为 NES（约 -4 到 4），y 轴为 GO term；蓝色为 GO BP（负 NES，下调，如氧化磷酸化、电子传递链），粉色为 GO MF（正 NES，上调，如泛素连接酶、组蛋白修饰）；条形旁标注 NES 与 adj p，取 top-20。 |
| L1_hub_overlap.png | 分组柱状图 | x 轴为筛选方法及交集（LASSO 9、RFE 2、univariate 50、LASSO&RFE 0、LASSO&uni 9、RFE&uni 2、3-way 0、core used 11），y 轴为 gene count（0 到 60）；深蓝单方法、浅蓝交集、橙色下游 core。 |
| L3_ATM_Ctrl.png | 空间表达图（组织切片叠加 spot） | 无刻度坐标轴，底图为 H&E 组织切片，上覆六边形 Visium spot；色标 log expr（灰 0 到红 1.2 以上），标题为 ATM / A_Ctrl，>0 expression 68 spots。 |
| L1_within_group_cor.png | 分组柱状图 | x 轴为样本（GSM 编号），y 轴为 median within-group cor（0 到 1）；Ctrl 为蓝色、DCM 为红色，红色虚线阈值 0.9。 |
| L1_topvar_heatmap.png | 热图（基因 × 样本） | 行为 top-50 高变基因（XIST、CD99、NPPA 等），列为 24 个 GSM 样本；颜色为行 z-score（-2 到 2，蓝低红高），图内无分组条带。 |
| L1_pca.png | PCA 散点图（95% CI 椭圆） | x 轴 PC1、y 轴 PC2；Ctrl 为蓝色点（PC1 约 55 到 80），DCM 为红色点（PC1 约 -25 到 5），两组沿 PC1 明显分离，n=70。 |
| L1_wgcna_mm_gs.png | 散点图（模块成员度 vs 基因显著性） | x 轴 module membership 绝对值（0 到 1.0），y 轴 gene significance 绝对值（0 到 1.0）；turquoise 蓝、blue 红、brown 绿；虚线 kME=0.80 与 GS=0.20，标注 CD99、RALGAPA1、MS4A6A。 |
| L2_umap_celltype.png | UMAP 降维散点图 | x 轴 UMAP1、y 轴 UMAP2（无刻度）；按 celltype 着色 10 类：B_cell、T_cell、cardiomyocyte、endothelial、fibroblast、macrophage、pericyte、schwann_nerve、smooth_muscle、unknown。 |
| L1_volcano_limma.png | 火山图 | x 轴 log2 fold change、y 轴 -log10 adj p；红色 Up n=3260、蓝色 Down n=389、灰色 NS n=39449；虚线为 abs(log2FC)=1 与 adj p=0.05，共 43098 个基因。 |
| L1_ma_fdr.png | MA 图 | x 轴 AveExpr（mean normalized expression，0 到 15 以上），y 轴 log2FC（DCM vs Ctrl，约 -7.5 到 10）；红色 up、蓝色 down、灰色 NS，虚线 log2FC=±1，标注 adj p=0.05。 |
| L1_genes_detected.png | 分组柱状图 | x 轴为样本（GSM 编号），y 轴为 genes detected（0 到 27000）；Ctrl 为蓝色、DCM 为红色，各样本检出基因数约 22000 到 27000。 |
| L1_wgcna_module_trait.png | 模块-性状相关性热图 | 行为 8 个模块（turquoise、blue、brown、grey、green、yellow、red、black），列为 Ctrl 与 DCM；色标 correlation r（-1 到 1），格内标数值，turquoise/blue 与分组强相关（约 ±0.97）。 |
| L1_ppi_network.png | PPI 网络图（STRING） | 节点为基因，边为蛋白互作；主体为核糖体蛋白簇（RPS/RPL 家族），另有 ESR1-JUN 与 CD8A-CD4 两个小连接；边色为 combined score（0.900 到 1.075），取 top 30 hubs / top 100 edges。 |
| L1_volcano.png | 火山图 | 与 L1_volcano_limma.png 字节及画面完全一致（重复文件）：x 轴 log2 fold change、y 轴 -log10 adj p，Up 3260、Down 389、NS 39449，阈值 abs(log2FC)=1 与 adj p=0.05。 |
| L2_celltype_composition.png | 堆叠柱状图（细胞类型组成） | x 轴为供体（DCM1 到 DCM4、Fetal1 到 Fetal3、Young1 到 Young3），y 轴为 cell fraction per donor（0 到 1）；按 10 类 celltype 堆叠，心肌细胞、成纤维细胞占比最高。 |
| L2_qc_nfeature_by_sample.png | 小提琴图（含箱线） | x 轴为样本（DCM1 到 DCM4、Fetal1 到 Fetal3、Young1 到 Young3），y 轴为 genes detected per nucleus（0 到 12000 以上）；Ctrl 蓝、DCM 红、Fetal 绿，n nuclei=77436。 |

## 备注

- 16 张图全部找到，无缺失。
- `L1_volcano.png` 与 `L1_volcano_limma.png` 为同一文件内容的重复命名（大小同为 143799 字节）。
