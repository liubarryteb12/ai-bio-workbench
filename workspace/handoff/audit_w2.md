# W2 图件真实性审计

审计日期：2026-11-10
方法：逐张 `view_image` 目检，共 12 张，全部定位成功。

| 文件名 | 实际图型 | 内容摘要 |
|---|---|---|
| L3_cellcomm_chord_verified.png | 弦图（chord diagram） | 标题 Cell-cell communication (LIANA)，13 个细胞类型沿圆周均布（T_cell、NK_ILC、B_cell、plasma、pDC、cDC、Langerhans_cell、melanocyte、keratinocyte、fibroblast、endothelial、smooth_muscle、pericyte），无坐标轴，蓝与橙红两组连接带穿过圆心，带宽表示通讯强度。 |
| L3_sankey_verified.png | 三段式桑基图（Sankey） | 横轴为 Class（1st、2nd、3rd、Crew）到 Sex（Male、Female）到 Age（Child、Adult）三阶段，纵轴为 Passengers（0 到 2000 以上），红带为 No (died)、蓝带为 Yes (survived)，带宽为真实乘客数（泰坦尼克基准数据）。 |
| custom_fig_l3_cellcomm_chord.png | 弦图（chord diagram） | 标题 Cell-cell communication，pairs = 169，13 个细胞类型沿圆周均布（Langerhans_cell、NK_ILC、T_cell、activated_keratinocyte、basal_keratinocyte、channel_keratinocyte、macrophage_mDC、melanocyte、mitotic、pDC、progenitor_keratinocyte、suprabasal_keratinocyte、unknown），无坐标轴，蓝紫色连接带，带宽表示互作对数。 |
| custom_fig_l3_sankey.png | 两列桑基图（Sankey） | 标题 WGCNA module composition，左列为 WGCNA 模块（turquoise、blue、brown、yellow、green、red、black、pink、magenta、purple），右列为基因数分箱（genes=117 到 genes=1066），无坐标轴，带宽表示模块基因数。 |
| custom_fig_l1_connectedscatter.png | 连线散点图（connected scatter） | 横轴 Moran's I (spatial autocorrelation) 约 0.1 到 0.75，纵轴 -Geary's C (spatial gradient) 约 -0.9 到 -0.25，19613 个基因以灰点铺底，top 500 以橙点加折线连成上升曲线，末端标注若干 MT- 前缀线粒体基因。 |
| custom_fig_l1_scatter.png | 散点图（带连续色标） | 横轴 rf_importance 约 0.29 到 0.37，纵轴 gbdt_importance 约 0 到 0.7，点色映射 -log10(P) 约 1.40 到 1.52，仅标注 CXCL10、KCNAB2、ITGB2 三个基因。 |
| custom_fig_l2_umap.png | UMAP 散点图 | 横轴 UMAP 1（约 -8 到 28），纵轴 UMAP 2（约 -10 到 22），按 21 个聚类着色，右侧图例编号 0 到 20，无细胞类型文字标签。 |
| custom_fig_l2p_enrichmentplot.png | ORA 气泡图（bubble dot plot） | 标题 Over-representation analysis (top 15)，横轴 -log10(adjusted p) 约 3.9 到 7.6，纵轴 overlap genes 约 3.5 到 11，点大小为 overlap genes，点色为 -log10(padj) 约 4 到 7，标注 RNA Polymerase II Transcription Regulatory、Cis-Regulatory Region Sequence-Specific DNA、Herpes simplex virus 1 infection、ABC transporters 等通路。 |
| custom_fig_l2p_gseaplot.png | 水平条形加密度曲线图（GSEA NES） | 标题 GSEA NES by cell type，横轴 Normalized enrichment score (NES) 约 -2.5 到 2，纵轴 7 个细胞类型（mitotic、basal_keratinocyte、unknown、melanocyte、progenitor_keratinocyte、suprabasal_keratinocyte、channel_keratinocyte），0 处有虚线，条形按细胞类型着色，全部 NES 为正。 |
| l2_13_target_gene_dotplot.png | 点图（dot plot） | 横轴 13 个细胞类型（Langerhans_cell 到 unknown），纵轴 11 个 target gene（JUN、ZWINT、ZSCAN26、ZNF883、A2M、A2ML1、ABCA6、ABCB1、ABCC9、ZNF84、ZNF835），点大小为 % expressing，点色为 mean expr (log-norm) 0 到 3.0，脚注 n=4587 cells。 |
| l3_human_06_umap_sample.png | UMAP 散点图（按样本着色） | 横纵轴为 UMAP 1 与 UMAP 2，刻度与轴标题已移除，按 5 个样本着色（JBO014、JBO015、JBO018、JBO019、JBO022），脚注 n=5 samples。 |
| l2_08_deg_volcano_mitotic.png | 火山图（volcano plot） | 横轴 log2 Fold Change 约 -25 到 35，纵轴 -log10(adj P-value) 约 0 到 37，蓝点为 Down (20)、橙点为 Up (147)、灰点为不显著，含 log2FC 与显著性两条虚线阈值。 |

## 备注

- `custom_fig_l1_scatter.png` 的基因标签与数据点、色标重叠，CXCL10、KCNAB2、ITGB2 字形可辨但排版有遮挡。
- `custom_fig_l2p_enrichmentplot.png` 标题写 top 15，图内可见约 11 个通路点，存在点重叠或数量不符。
- `l3_human_06_umap_sample.png` 的 UMAP 两轴无刻度与轴标题，只保留样本分组图例。
