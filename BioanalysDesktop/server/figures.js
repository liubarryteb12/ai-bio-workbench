/**
 * 结果图件浏览（可视化界面）
 *
 * aims 第 4 节「可视化界面」：渲染 PCA/UMAP/Spatial Feature Plot 等图表。
 * 本模块把三条线各自 figures/ 目录下的 PNG 列出来，并可按需取回图像字节。
 *
 * 边界规则与 files.js 一致：只允许线内 figures/ 子目录，越界一律拒。
 * 图像取回用 ssh + base64（复用 index.js 的 runRemote 模式），不落地中间文件。
 */

import { LINES, projectLineDir, sanitizeProjectId } from './domain.js';

/** 每条线的图件目录（相对线根） */
export const FIGURES_SUBDIR = 'figures';

/** 允许的图件扩展名 */
const IMAGE_EXT = /\.(png|jpg|jpeg|gif|webp|svg)$/i;

/**
 * 校验图件请求是否在本项目本线的 figures 目录。
 * @returns {{ok: boolean, reason: string|null, dir: string}}
 */
export function assertFiguresPath(projectId, lineId, name = '') {
  if (!LINES.includes(lineId)) {
    return { ok: false, reason: `line_id 非法: ${lineId}`, dir: null };
  }
  const safeProject = sanitizeProjectId(projectId);
  if (!safeProject) {
    return { ok: false, reason: `project_id 非法: ${projectId}`, dir: null };
  }
  const dir = `${projectLineDir(safeProject, lineId)}/${FIGURES_SUBDIR}`;
  if (name && !IMAGE_EXT.test(name)) {
    return { ok: false, reason: `只允许图像文件: ${name}`, dir };
  }
  // 文件名不允许含路径分隔符或 ..，防目录穿越
  if (name && (name.includes('/') || name.includes('\\') || name.includes('..'))) {
    return { ok: false, reason: `文件名非法: ${name}`, dir };
  }
  return { ok: true, reason: null, dir };
}

/**
 * 解析 `ls -la` 风格输出为图件列表。
 * 期望每行格式：`<name>|<size_bytes>|<mtime_epoch>`（由调用方用 find/ls 拼出）。
 */
export function parseFigureList(raw) {
  return String(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((row) => {
      const [name, size, mtime] = row.split('|');
      return {
        name,
        size: Number(size) || 0,
        mtime: Number(mtime) || 0,
      };
    })
    .filter((entry) => entry.name && IMAGE_EXT.test(entry.name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * 图件中文说明登记表（供目视审核时知道每张图在看什么）。
 *
 * 匹配规则：按文件名特征子串匹配，先命中者生效。顺序敏感，具体模式在前。
 * 新增出图步骤时在这里补一条即可，前端与后端预览页共用同一份说明。
 */
const FIGURE_CAPTIONS = [
  // line1 bulk（用 l1_ 前缀精确匹配，避免与 line2/line3 同名片段冲突）
  { match: 'l1_01_correlation', text: '样本相关性热图：样本间表达谱相关（8 LS vs 8 NLS）' },
  { match: 'l1_02_pca_step3', text: '步骤级 PCA（pca_matrix）：PC1/PC2 散点 + 95% 置信椭圆，蓝=对照 / 红=疾病' },
  { match: 'l1_02_pca', text: 'PCA 主成分图：样本在 PC1/PC2 分布，虚线为分组 95% 置信椭圆' },
  { match: 'l1_03_volcano_limma', text: '步骤级 DEG 火山图（deg_limma）：红=达阈值，灰=未达阈值，虚线=阈值线' },
  { match: 'l1_03_volcano', text: 'DEG 火山图（单图，FDR / nominal 两口径各一张）：红上调/蓝下调/灰非显著，虚线=阈值线' },
  { match: 'l1_04_topvar', text: 'top50 变异基因热图：行=基因，列=样本（行 z-score）' },
  { match: 'l1_05a', text: '样本质控：每样本检出基因数（红=LS，蓝=NLS）' },
  { match: 'l1_05b', text: '样本质控：每样本组内中位相关性（红虚线=0.9 阈值）' },
  { match: 'l1_06_ma', text: 'MA 图（单图，FDR / nominal 两口径各一张）：log2FC vs 平均表达' },
  { match: 'l1_07_ppi_network', text: 'PPI 网络：top30 hub / top100 边，边色深浅=STRING 综合得分' },
  { match: 'l1_08_ppi_hubs', text: 'PPI hub 基因：按 degree 排序 top30' },
  { match: 'l1_09_key_genes', text: '关键基因交集：DEG / WGCNA / PPI 三来源交集规模' },
  { match: 'l1_10_ml_roc', text: 'ML 模型 LOOCV ROC 曲线（探索性）' },
  { match: 'l1_11_ml_importance', text: 'ML 特征重要性：LR 系数 + RF 置换重要性 top20' },
  { match: 'l1_12_external_roc', text: '冻结模型留出评估 ROC（内部近似，非独立外部数据集）' },
  { match: 'l1_13_gsea_top', text: 'GSEA GO BP top20：条形=NES（红激活/蓝抑制），标注 NES + 校正 p' },
  { match: 'l1_14_module_ora_top', text: 'WGCNA 模块 ORA top20：条形=-log10 校正 p，标注 GeneRatio + 校正 p' },
  { match: 'l1_15_kegg_top', text: 'KEGG ORA top20：条形=-log10 校正 p，标注 GeneRatio + 校正 p' },
  { match: 'l1_25_kegg_gsea_top', text: 'KEGG GSEA top20：条形=NES（红激活/蓝抑制），标注 NES + 校正 p' },
  { match: 'l1_16_lasso_path', text: 'LASSO 系数路径（glmnet binomial）：hub 基因系数随 log(lambda) 收缩，红色=选中' },
  { match: 'l1_17_lasso_cv', text: 'LASSO 交叉验证曲线：二项偏差 vs log(lambda)，虚线为 lambda.min / lambda.1se' },
  { match: 'l1_18_rfe_curve', text: 'RFE 递归特征消除曲线：选中基因数 vs 4 折交叉验证 AUC' },
  { match: 'l1_19_univariate', text: '单因素 logistic 筛选：-log10(p)，红=显著(p<0.05 加星)，蓝深浅~p 值，虚线 p=0.05' },
  { match: 'l1_20_hub_overlap', text: 'hub 基因筛选交集规模：深蓝=单方法，浅蓝=交集，橙=下游使用的核心集' },
  { match: 'l1_21_importance', text: '核心 hub 基因重要性：随机森林(蓝) + 梯度提升(红)，条形附数值标注' },
  { match: 'l1_22_shap', text: 'SHAP 特征重要性：mean|SHAP|（TreeExplainer on RF）' },
  { match: 'l1_23_cluster_heatmap', text: '样本聚类热图：核心 hub 基因（行=基因，列=样本），附树状图与分组色条' },
  { match: 'l1_24_corr_network', text: '核心 hub 基因共表达网络：边=Spearman r（宽度∝|r|），节点大小=度' },
  { match: 'l1_26_shap_waterfall', text: 'SHAP 瀑布图：单样本预测分解，红=推向 LS / 蓝=推向 NLS，条形标注基因贡献值' },
  { match: 'l1_27_cox_forest', text: 'Cox 回归森林图：HR + 95% CI，红=风险基因(HR>1)，蓝=保护基因(HR<1)' },
  { match: 'l1_28_wgcna_softpower', text: 'WGCNA 软阈值诊断：左=无标度拟合 R²（红虚线 0.8），右=平均连通度' },
  { match: 'l1_29_wgcna_module_trait', text: 'WGCNA 模块-性状相关热图：行=模块，列=分组，数值=相关系数' },
  { match: 'l1_30_wgcna_sample_tree', text: 'WGCNA 样本聚类树：叶标签=样本，色条=分组（红 LS / 蓝 NLS），用于离群样本检查' },
  { match: 'l1_31_wgcna_mm_gs', text: 'WGCNA 模块内 hub 筛选：x=|kME|，y=|GS|，红虚线=阈值（kME 0.8 / GS 0.2）' },
  // line1 组图（Step 5 组图契约 G3：新号段从 32 起，语义 overview/panel/summary）
  { match: 'l1_32_deg_overview', text: 'DEG 总览四联组合图：A=火山图(FDR) / B=MA图(FDR) / C=PCA散点(95%置信椭圆) / D=top50 变异基因热图，下方共享 group 图例' },
  // line2 scrna
  { match: 'umap_celltype', text: 'UMAP 按细胞类型着色：13 类细胞的簇分离' },
  { match: 'umap_diagnosis', text: 'UMAP 按诊断着色：Healthy vs Psoriasis 分布' },
  { match: 'umap_donor', text: 'UMAP 按供体着色：8 个供体的批次分布' },
  { match: 'umap_leiden', text: 'UMAP 按 Leiden 簇着色：无监督聚类结果' },
  { match: 'composition_stack', text: '细胞组成堆叠条：每供体内 13 类占比谱（诊断标注）' },
  { match: 'composition_box', text: '细胞组成箱线（逐细胞类型）：Healthy vs Psoriasis，点=个体供体' },
  { match: 'marker_top5', text: '细胞类型 marker 热图：每类 top5 marker 平均表达（行=基因，列=细胞类型）' },
  { match: 'deg_volcano', text: 'DEG 火山图（逐细胞类型）：Psoriasis vs Healthy，红上调/蓝下调，虚线=阈值线' },
  { match: 'deg_sig_bar', text: 'DEG 计数条：每细胞类型显著基因数' },
  { match: 'pca_diagnosis', text: 'PCA 按诊断着色（harmony 嵌入）：95% 置信椭圆' },
  { match: 'scenic_01', text: 'SCENIC regulon 活性热图：top30 regulon × 细胞类型（行=regulon，列=细胞类型）' },
  { match: 'scenic_02', text: 'SCENIC top20 regulon 特异性：条形=特异性 z，标注首选细胞类型' },
  { match: 'l2_11_ora_top', text: 'ORA top20：条形=-log10 校正 p，按细胞类型分色，标注 odds ratio + 校正 p' },
  { match: 'l2_12_gsea_top', text: 'GSEA top20：条形=NES（红激活/蓝抑制），标注 NES + FDR q 值' },
  { match: 'l2_13_target_gene_dotplot', text: '目标基因表达定位：点大小=%表达，颜色=平均表达（log-norm），行=基因，列=细胞类型' },
  { match: 'l2_14_gsva_heatmap', text: 'GSVA 通路活性热图：top30 变异通路（行=通路，列=细胞类型），z-score' },
  { match: 'l2_15_dr_gsea_top', text: 'DR 基因 GSEA top20：条形=NES，标注 NES + FDR q（DR 非 DEG）' },
  { match: 'l2_16_dr_regulatory_network', text: 'DR 调控网络：SCENIC regulon TF→DR 边（蓝=TF，红=DR 基因）' },
  { match: 'l2_17_dr_overlap', text: 'DR / DEG / 细胞类型 marker 交集规模' },
  // ===== PRJ_20261019_IS_lactylation（IS 乳酸化，方案 A 沙盒产物，2026-10-20 追加）=====
  // line2：五算法评分+IQR 三分型/WGCNA/Monocle2/liana（项目内合规版，几何审计 7/7 PASS）
  { match: 'l2_01_lac_group_celltype', text: '乳酸化三分组×细胞类型构成：行=细胞类型，列=LLS/LDTS/LHS，列归一化百分比热图' },
  { match: 'l2_02_score_distributions', text: 'composite 乳酸化得分分布：左=按细胞类型 top6 箱线（带个体点+n），右=LLS/LDTS/LHS 直方图（IQR 分型）' },
  { match: 'l2_03_five_algorithm_corr', text: '五算法评分 Spearman 相关热图：AUCell/UCell/singscore/ssGSEA/AddModuleScore（6000 细胞抽样）' },
  { match: 'l2_04_wgcna_modules', text: 'WGCNA 模块：左=模块ME vs 乳酸化得分 ρ（红=正相关 adj.P<0.05），右=模块规模条形+条末 hub 数' },
  { match: 'l2_05_candidates_evidence', text: '12 候选基因三源交集证据：分组条形=DEG(LHS-LLS) 与 LRG(MCAO-sham) avg_log2FC，条末标注 kME' },
  { match: 'l2_06_pseudotime', text: 'Monocle2 伪时间：左=各 state 分布，右=伪时间 vs 乳酸化得分散点（ρ 与 p 标注于图注）' },
  { match: 'l2_07_comm_top', text: 'LHS 富集细胞类型间 top15 LR 交互（liana lrscore，替代 CellChat）：条色=靶细胞类型' },
  // line1：LRG-DEG 热图 + 五算法 ML M1/M2（项目内合规版，几何审计 9/9 PASS）
  { match: 'l1_32_lrg_deg_heatmap', text: 'IS 相关 LRG-DEG 热图：33 候选（敏感口径 basis 已标注），行 z-score，列=132 训练样本（按数据集/分组排序）' },
  { match: 'l1_33_ml_roc', text: 'M1 枢纽 LRG 诊断模型 ROC：训练 LOOCV AUC=0.9585（红）/ 外部 GSE16561 AUC=0.8237（蓝虚线，冻结评估）' },
  { match: 'l1_34_ml_calibration', text: 'M1 模型校准曲线：LOOCV 预测概率十分位 vs 观测 IS 比例（虚线=完美校准）' },
  { match: 'l1_35_ml_overlap', text: 'M1 五方法筛选规模：LASSO/RF/Boruta/XGBoost/单因素各自筛出基因数（红=含枢纽基因）' },
  { match: 'l1_36_ml_importance', text: 'M1 枢纽基因重要性：RF Gini + GBDT Gini 分组条形（seed=20261013 重拟合）' },
  { match: 'l1_37_ml_roc_m2', text: 'M2（+line2 12 候选）诊断模型 ROC：训练 LOOCV AUC=0.9579 / 外部 GSE16561 AUC=0.7682' },
  { match: 'l1_38_ml_calibration_m2', text: 'M2 模型校准曲线：LOOCV 预测概率十分位 vs 观测 IS 比例' },
  { match: 'l1_39_ml_overlap_m2', text: 'M2 五方法筛选规模（候选集=DEG∩LRG 33 + line2 12 合并 45）' },
  { match: 'l1_40_ml_importance_m2', text: 'M2 枢纽基因重要性：RF Gini + GBDT Gini（6 基因，seed=20261013）' },
  // line3：spot 级乳酸化 + 区域注释 + 目标基因（项目内合规版，几何审计 3/3 PASS）
  { match: 'l3_mouse_01_region_score_boxplot', text: 'spot 级乳酸化得分按区域箱线：core vs unassigned，带个体点+n，KW 统计标注（p=1.0e-16）' },
  { match: 'l3_mouse_02_regions_umap', text: 'spot UMAP 按区域着色：core=3 个缺血核心样簇（1715 spots，100% MCAO），unassigned=其余 11 簇' },
  { match: 'l3_mouse_03_target_genes_heatmap', text: '11 个重点目标基因×转录谱簇表达热图（小鼠符号，行 z-score；DNMT1 为两份清单交集）' },
  // line2 组图（Step 5 组图契约 G3：新号段从 20 起，语义 overview/panel/summary）
  { match: 'l2_20_composition_panel', text: '细胞组成三联组合图：A=每供体细胞类型占比堆叠条 / B=basal_keratinocyte 组成箱线（Healthy vs Psoriasis，括号=供体级置换 perm p） / C=细胞类型 UMAP，下方共享 cell type 图例' },
  // line3 组图（Step 5 组图契约 G3：line3 现到 15，组合图从 16 起、逐物种各一张；
  // match 用物种不变子串，同时覆盖 l3_mouse_16_domain_panel 与 l3_human_16_domain_panel）
  { match: '16_domain_panel', text: '空间域三联组合图（每物种一张）：A=代表样本空间域散点 / B=每样本域占比堆叠条 / C=目标基因域均值条形，下方共享 spatial domain 图例（60 色板，条目 >12 按列分组）' },
  // line3 spatial（具体模式在前：*_by_domain 先于同名基础图，domain_composition 先于 domains）
  { match: 'l3_mouse_10_dr_gsea_top', text: '小鼠 DR 基因 GSEA top20（KEGG/WikiPathways 小鼠库）：条形=NES，标注 NES + FDR q' },
  { match: 'l3_human_10_dr_gsea_top', text: '人源 DR 基因 GSEA top20（KEGG/GO BP/Reactome 人库）：条形=NES，标注 NES + FDR q' },
  { match: 'l3_mouse_11_dr_overlap', text: '小鼠 DR / 空间域 marker 交集规模' },
  { match: 'l3_human_11_dr_overlap', text: '人源 DR / 空间域 marker 交集规模' },
  { match: 'l3_mouse_12_ora_top', text: '小鼠空间域 marker ORA top20：条形=-log10 校正 p，按域分色，标注 odds ratio + 校正 p' },
  { match: 'l3_mouse_13_gsea_top', text: '小鼠空间域 marker GSEA top20：条形=NES，标注 NES + FDR q' },
  { match: 'l3_human_12_ora_top', text: '人源空间域 marker ORA top20：条形=-log10 校正 p，标注 odds ratio + 校正 p' },
  { match: 'l3_human_13_gsea_top', text: '人源空间域 marker GSEA top20：条形=NES，标注 NES + FDR q' },
  { match: 'l3_mouse_14_deconv_umap', text: '小鼠 NNLS 反卷积细胞类型 UMAP：按首选 celltype 着色（无监督近似，非外部参考）' },
  { match: 'l3_human_14_deconv_umap', text: '人源 NNLS 反卷积细胞类型 UMAP：按首选 celltype 着色（无监督近似，非外部参考）' },
  { match: 'l3_mouse_15_deconv_composition', text: '小鼠域内细胞类型组成条形：NNLS 反卷积 top5 celltype 均值比例' },
  { match: 'l3_human_15_deconv_composition', text: '人源域内细胞类型组成条形：NNLS 反卷积 top5 celltype 均值比例' },
  { match: 'target_gene_by_domain', text: '目标基因域均值（域统计视图）：每空间域的目标基因平均表达' },
  { match: 'ko_dr_by_domain', text: 'KO DR 域均值（域统计视图）：每空间域的敲除 DR 平均表达' },
  { match: 'domain_composition', text: '空间域组成：每样本的域占比谱' },
  { match: 'target_gene', text: '目标基因空间表达（逐样本）：top 目标基因在组织上的表达分布' },
  { match: 'knockout_dr', text: '敲除 top10 DR 基因：-log10 adj p（标注显著样本数 n）' },
  { match: 'ko_dr', text: '敲除 DR 基因空间分布（逐样本）：显著 DR 基因平均表达' },
  { match: 'morans', text: "Moran's I top20：空间自相关最强的基因" },
  { match: 'domains', text: '空间域图（逐样本）：每样本 spot 的空间域着色' },
  { match: 'umap_sample', text: 'UMAP 按样本着色' },
];

/** 按文件名取中文说明，命中不到返回空串 */
export function captionFor(name) {
  const lower = String(name).toLowerCase();
  for (const entry of FIGURE_CAPTIONS) {
    if (lower.includes(entry.match)) return entry.text;
  }
  return '';
}

/** 给图件列表补上说明与人类可读大小 */
export function decorateFigures(figures) {
  return figures.map((fig) => ({
    ...fig,
    caption: captionFor(fig.name),
    sizeLabel: formatBytes(fig.size),
  }));
}

/** 字节数格式化为人类可读 */
export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** exponent;
  return `${scaled.toFixed(1)} ${units[exponent]}`;
}
