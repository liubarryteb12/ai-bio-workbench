/**
 * 项目管理（数据面按项目分文件夹的落地）
 *
 * 一个"项目"= 一套独立的三条线数据目录（raw_data/processed/results/figures），
 * 项目之间物理隔离，互不干扰。脚本 bin/ 与环境声明 envs/ 全局共用一份，
 * public_references/ 与 system_logs/ 全局共享。
 *
 * 本模块只做纯逻辑（消毒、解析、命令构造），不发 ssh；远端调用在 index.js。
 */

import {
  LINES, PROJECTS_ROOT, LINE_SUBDIRS, sanitizeProjectId,
  normalizeDataSource, normalizeDataSourceMode, isValidSampleId,
  DATA_TYPE_IDS, SPECIES_ENUM, DOMAIN_ENUM,
} from './domain.js';
import { validateProjectFields } from './tumor_blacklist.js';

/** 项目元数据文件名（放项目根） */
export const PROJECT_META_FILE = 'project.json';

/** 项目元数据 schema 版本（v2 支持四段式；v2.1 增加 aims v3.0 的 intake 契约块） */
export const PROJECT_SCHEMA_VERSION = 3;

/**
 * 统计阈值三档预设（aims v3.0 模块 C 第四级）。
 * 客户不懂 log2FC/FDR，只要选"多严格"；具体数值在此锁定，前端只展示档位说明。
 */
export const ANALYSIS_CUTOFFS = {
  standard_sci: { log2fc: 1.0, padj: 0.05, p: null },
  sensitive: { log2fc: 0.585, padj: null, p: 0.05 },
  strict: { log2fc: 1.5, padj: 0.01, p: null },
};
export const CUTOFF_PROFILES = Object.keys(ANALYSIS_CUTOFFS);

/** 虚拟敲除靶基因检出率不足时的兜底策略 */
export const KO_FALLBACK_POLICIES = ['strict_abort', 'auto_recommend'];

/**
 * 归一化统计阈值档位。
 * 未给 profile 用标准档（默认）；profile 非法时按标准档处理并在返回值里标记，
 * 不静默扩散一个没定义过的档位名到下游脚本。
 */
export function normalizeAnalysisCutoffs(cutoffs) {
  const requested = String(cutoffs?.profile || '').trim();
  const preset = ANALYSIS_CUTOFFS[requested] ? requested : 'standard_sci';
  const base = ANALYSIS_CUTOFFS[preset];
  return {
    profile: preset,
    // 只在"给了值但不是合法档位"时标记回落；没给等于选默认档，不算回退
    profileFallback: requested.length > 0 && !ANALYSIS_CUTOFFS[requested],
    log2fc_threshold: Number(cutoffs?.log2fc_threshold ?? base.log2fc),
    padj_threshold: Number(cutoffs?.padj_threshold ?? base.padj ?? 0.05),
    p_threshold: Number(cutoffs?.p_threshold ?? base.p ?? 0.05),
    max_mt_percent: Number(cutoffs?.max_mt_percent ?? 15),
  };
}

/**
 * 归一化 WGCNA 参数（aims Step 3 契约 + WGCNA 审计 C-04/P1-1）。
 * 建项时写入 project.json 的 wgcna_config，母版脚本 wgcna_modules 读不到该字段时
 * 用同一批默认值，并在 wgcna_report.txt 里写明来源（project.json|default）。
 * 非有限数/越界值一律回落默认值，不抛错——建项流程不能被一个非法参数卡住。
 */
export const WGCNA_CONFIG_DEFAULTS = {
  top_n_genes: 5000,
  min_module_size: 20,
  merge_cut_height: 0.25,
  deep_split: 2,
  power_rule: 'first_r2_ge_0.8_else_max',
  module_p_threshold: 0.05,
  hub_kme_min: 0.8,
  hub_gs_min: 0.2,
  max_block_size: 5000,
};

export function normalizeWgcnaConfig(config) {
  const src = config && typeof config === 'object' ? config : {};
  const num = (key, min, max) => {
    const v = Number(src[key]);
    return Number.isFinite(v) && v >= min && v <= max
      ? v
      : WGCNA_CONFIG_DEFAULTS[key];
  };
  const powerRule = String(src.power_rule ?? '').trim();
  return {
    top_n_genes: Math.round(num('top_n_genes', 500, 50000)),
    min_module_size: Math.round(num('min_module_size', 5, 500)),
    merge_cut_height: num('merge_cut_height', 0.05, 0.5),
    deep_split: Math.round(num('deep_split', 0, 4)),
    power_rule: powerRule === 'first_r2_ge_0.8_else_max' || powerRule === 'max_r2'
      ? powerRule
      : WGCNA_CONFIG_DEFAULTS.power_rule,
    module_p_threshold: num('module_p_threshold', 0.001, 0.5),
    hub_kme_min: num('hub_kme_min', 0.3, 0.99),
    hub_gs_min: num('hub_gs_min', 0.05, 0.9),
    max_block_size: Math.round(num('max_block_size', 1000, 50000)),
  };
}

/** 归一化生物学先验：focus_genes（1~5 个 Symbol）与敲除靶基因及兜底策略 */
export function normalizeBiologicalPriors(priors) {
  const raw = Array.isArray(priors?.focusGenes)
    ? priors.focusGenes
    : (typeof priors?.focusGenes === 'string' ? priors.focusGenes.split(/[\s,;，；]+/) : []);
  const focusGenes = raw
    .map((g) => String(g ?? '').trim())
    .filter(Boolean)
    .slice(0, 5);
  const koPolicy = KO_FALLBACK_POLICIES.includes(String(priors?.koFallbackPolicy || '').trim())
    ? String(priors.koFallbackPolicy).trim()
    : 'strict_abort';
  return {
    focus_genes: focusGenes,
    target_ko_gene: String(priors?.targetKoGene ?? '').trim(),
    ko_fallback_policy: koPolicy,
  };
}

/** 单图 SCI 排版两档（aims v3.0 模块 D；与 docs/figure_spec.md 同源）
 *
 * 2026-10-19 用户拍板：客户端只保留 4:3 / 16:9 两档，原三套模板收敛为按画幅比驱动的两档。
 * 与 ops/layout_helper.py 的 TEMPLATES 同值（两端各自持有副本，不共享代码）。
 */
export const PLOT_LAYOUT_TEMPLATES = {
  template_4x3: { aspect_ratio: '4:3', legend_position: 'outside_right', legend_direction: 'vertical', axis_style: 'classic_L', x_label_rotation: 'auto_45', show_footnote_panel: false },
  template_16x9: { aspect_ratio: '16:9', legend_position: 'bottom_center', legend_direction: 'horizontal', axis_style: 'boxed', x_label_rotation: 'auto_45', show_footnote_panel: true },
};
export const DEFAULT_TEMPLATE_ID = 'template_4x3';

/** 旧 id 兼容：收敛前 project.json 里落的是这三套 id。
 * 先映射到新 id 再查表——映射后规则逐字段相同，已交付项目（如 PRJ_E2E_GSE277173
 * 写的是 template_2_cell_wide）不重建项目也必须零视觉变化。
 */
export const LEGACY_TEMPLATE_IDS = {
  template_1_nature_side: 'template_4x3',
  template_2_cell_wide: 'template_16x9',
  template_3_clinical_note: 'template_4x3',
};

/** 归一化排版配置：模板缺失或非法时回落到默认模板，并如实标记 */
export function normalizePlotLayoutConfig(config) {
  const requested = String(config?.templateId || '').trim();
  const templateId = Object.prototype.hasOwnProperty.call(LEGACY_TEMPLATE_IDS, requested)
    ? LEGACY_TEMPLATE_IDS[requested]
    : requested;
  const known = Object.prototype.hasOwnProperty.call(PLOT_LAYOUT_TEMPLATES, templateId);
  const base = known ? PLOT_LAYOUT_TEMPLATES[templateId] : PLOT_LAYOUT_TEMPLATES[DEFAULT_TEMPLATE_ID];
  return {
    template_id: known ? templateId : DEFAULT_TEMPLATE_ID,
    templateFallback: !known,
    dpi: 300,
    theme_rules: { ...base },
  };
}

/** 归一化配对设计与协变量：驱动下游自动切配对统计模型 */
export function normalizeExperimentalDesign(design) {
  const isPaired = design?.isPaired === true;
  const pairMap = (design?.pairMap && typeof design.pairMap === 'object') ? design.pairMap : {};
  const cov = (design?.covariates && typeof design.covariates === 'object') ? design.covariates : {};
  return {
    is_paired: isPaired,
    pair_map: isPaired ? pairMap : {},
    cov: {
      batch_col: String(cov.batchCol ?? '').trim(),
      adjusted_variables: Array.isArray(cov.adjustedVariables) ? cov.adjustedVariables.map(String) : [],
    },
  };
}

/**
 * 归一化独立验证集分组映射（aims v3.0 模块 B 第四分区）。
 *
 * 验证集常混有与本研究无关的样本（其它分组、其它平台），必须在建项时
 * 明确标出哪些属于对照、哪些属于处理，下游冻结评估才能精准剔除无关样本。
 * 只能填字符串数组；给错类型一律记 `invalid` 并回落空数组，不把脏数据带进冻结评估。
 */
export function normalizeValidationGroupMapping(mapping) {
  const m = (mapping && typeof mapping === 'object') ? mapping : {};
  const toList = (v) => (Array.isArray(v) ? v.map((s) => String(s ?? '').trim()).filter(Boolean) : []);
  // 键名兼容三种口径：前端 camelCase、aims 契约的 snake_case、aims 示例里的 gsms 后缀
  const control = m.valControlSamples ?? m.val_control_samples ?? m.val_control_gsms;
  const treat = m.valTreatSamples ?? m.val_treat_samples ?? m.val_treat_gsms;
  const valControl = toList(control);
  const valTreat = toList(treat);
  const invalid = !Array.isArray(control) || !Array.isArray(treat);
  // 任一侧不合法就整块作废：只保留一半映射会让下游拿残缺样本集做冻结评估，
  // 比没有映射更危险（结果看似有效，实际对照/处理不配对）。
  if (invalid) {
    return { val_control_samples: [], val_treat_samples: [], invalid: true };
  }
  // 两侧样本编号不能重叠，否则同一个验证集样本既是对照又是处理，评估直接失真
  const overlap = valControl.filter((s) => valTreat.includes(s));
  if (overlap.length) {
    throw new Error(`验证集分组映射中以下样本同时出现在对照与处理两侧: ${JSON.stringify(overlap.slice(0, 5))}`);
  }
  return { val_control_samples: valControl, val_treat_samples: valTreat, invalid: false };
}

/**
 * 客户上传的数据文件清单归一化。
 *
 * path 必须是提交包内的相对路径（`PKG_.../raw_data/...`），不允许绝对路径与穿越：
 * 建项时服务端要拿它去 portal/inbox 里找源文件并复制到远端项目目录，
 * 一旦允许 `../` 就能把任意本地文件搬进项目。
 */
export function normalizeDataFiles(files) {
  if (!Array.isArray(files)) return [];
  const out = [];
  for (const f of files) {
    if (!f || typeof f !== 'object') continue;
    const rel = String(f.path ?? '').trim();
    const role = String(f.role ?? '').trim();
    const name = String(f.name ?? '').trim();
    if (!rel || !name) continue;
    if (rel.includes('..') || rel.startsWith('/') || rel.includes('\\')) {
      throw new Error(`数据文件路径非法（只允许提交包内的相对路径）: ${rel}`);
    }
    out.push({
      role,
      bind: String(f.bind ?? '').trim(),
      name,
      path: rel,
      size: Number(f.size) || 0,
      sha256: typeof f.sha256 === 'string' ? f.sha256 : '',
    });
  }
  return out;
}

/** 三条分析线可选步骤（前端级联勾选用，与 bin/<line>/ 已部署脚本对应） */
export const LINE_STEPS = {
  line1_bulk: [
    'prep_matrix', 'qc_matrix', 'pca_matrix', 'deg_limma', 'wgcna_modules',
    'enrichment_bulk', 'enrichment_figures', 'ppi_string', 'key_genes',
    'ml_model', 'ml_hub_analysis', 'ml_diagnostics', 'external_validation', 'bulk_figures',
  ],
  line2_scrna: [
    'ingest_counts', 'qc_cells', 'normalize_hvg', 'integrate_harmony',
    'cluster_umap', 'annotate_celltypes', 'scrna_composition', 'deg_groups',
    'subcluster', 'enrichment', 'enrichment_figures', 'pseudotime',
    'cell_communication', 'scenic_tf', 'scenic_figures', 'tf_activity',
    'virtual_knockout', 'summarize_dr', 'target_gene_localization',
    'gsva_pathways', 'dr_post_analysis', 'scrna_figures',
  ],
  line3_spatial: [
    'ingest_spatial', 'qc_spots', 'normalize_hvg', 'dim_reduce',
    'spatial_domains', 'spatial_markers', 'spatial_autocorr',
    'spatial_cooccurrence', 'spatial_composition', 'spatial_communication',
    'celltype_annotation', 'spatial_localization', 'spatial_knockout',
    'dr_post_analysis', 'enrichment', 'enrichment_figures', 'spatial_figures',
  ],
};

/**
 * 步骤节点功能说明字典（前端模块 C 展示用）。
 * 每个步骤含：desc（功能简介）、tool（核心工具）、io（输入/输出产物）、note（条件/算力提示）。
 */
export const PIPELINE_STEP_META = {
  // line1_bulk
  prep_matrix: { label: 'GEO 数据获取与探针注释', desc: '拉取 GEO 矩阵与 GPL 注释，探针转 Gene Symbol，多探针取中位数', tool: 'GEOquery, Biobase', io: 'expr_genes.tsv, group_map.tsv', note: '训练集与验证集分目录' },
  qc_matrix: { label: '样本质控', desc: '检出基因数、组内中位相关性，标注离群样本', tool: 'limma, ggplot2', io: 'qc_report.txt, l1_05a/05b', note: '' },
  pca_matrix: { label: 'PCA 与样本相关性', desc: 'PCA 分组验证 + 样本相关性热图', tool: 'limma, ggplot2', io: 'pca_scores.tsv, l1_01/02', note: '' },
  deg_limma: { label: '差异表达分析 (DEG)', desc: 'limma 两组比较，火山图 + MA 图', tool: 'limma', io: 'deg_all.tsv, deg_sig.tsv, l1_03/06', note: 'DEG 0 显著时放宽到 nominal p' },
  wgcna_modules: { label: 'WGCNA 共表达模块', desc: '方差前 5000 基因建网，模块-表型相关性 + 模块内 hub（kME/GS）', tool: 'WGCNA', io: 'wgcna_modules.tsv, wgcna_module_trait.tsv, wgcna_gene_traits.tsv, wgcna_hub_genes.tsv, wgcna_module_eigengenes.tsv, l1_28/29/30/31', note: 'nThreads=3 防溢出；单块建网' },
  enrichment_bulk: { label: '功能富集 (GO/KEGG/GSEA)', desc: 'GO BP/CC/MF 三本体 GSEA + KEGG ORA/GSEA + 模块 ORA', tool: 'clusterProfiler (gseGO/gseKEGG/enrichGO/enrichKEGG)', io: 'enrichment_gsea_go.tsv, enrichment_gsea_kegg.tsv, enrichment_kegg.tsv, enrichment_module_ora.tsv', note: 'KEGG 需外网' },
  enrichment_figures: { label: '富集出图', desc: '富集条形 top20 双标注', tool: 'matplotlib', io: 'l1_13/14/15/25', note: '' },
  ppi_string: { label: 'PPI 网络 + Hub 初筛', desc: 'STRING 互作网络 Degree 筛 Top hub', tool: 'STRING API', io: 'ppi_edges.tsv, ppi_hubs.tsv, l1_07/08', note: '需外网 STRING' },
  key_genes: { label: '交集关键基因', desc: 'DEG ∩ WGCNA 显著模块 ∩ PPI hub', tool: 'pandas', io: 'key_genes.tsv, l1_09', note: 'DEG 判据放宽时如实标注' },
  ml_model: { label: 'ML 建模 (LR+RF+LOOCV)', desc: '逻辑回归 + 随机森林 LOOCV ROC', tool: 'sklearn', io: 'ml_report.txt, l1_10/11', note: '探索性，不可当临床性能' },
  ml_hub_analysis: { label: 'Hub 基因 ML 精筛 + 重要性评估', desc: 'LASSO+RFE+单因素筛选 → RF/GBDT/SHAP/聚类/共表达网络', tool: 'glmnet(R), sklearn, shap, networkx, scipy', io: 'ml_lasso_*, ml_core_hub_genes.tsv, ml_importance.tsv, l1_16..26', note: 'SHAP 瀑布图展示单样本贡献' },
  external_validation: { label: '外部验证冻结评估', desc: '冻结模型在独立 GEO 验证集上 ROC', tool: 'pROC', io: 'external_validation_preds.tsv, l1_12', note: '零数据泄漏：不重新筛基因/调参' },
  bulk_figures: { label: 'Bulk 出图', desc: '相关性/PCA/火山/MA/topvar/QC 出图', tool: 'matplotlib', io: 'l1_01..06', note: '' },
  // line2_scrna
  ingest_counts: { label: '单细胞数据读入', desc: '读取 .mtx/.h5ad 原始矩阵', tool: 'Scanpy', io: 'scrna_raw.h5ad', note: '' },
  qc_cells: { label: '细胞质控', desc: '过滤低质量细胞与双细胞，线粒体百分比', tool: 'Scanpy', io: 'scrna_qc.h5ad, qc_report.txt', note: '' },
  normalize_hvg: { label: '标准化与高变基因', desc: 'normalize_total + log1p + HVG 筛选', tool: 'Scanpy', io: 'scrna_norm.h5ad', note: 'layers["counts"] 保留原始计数' },
  integrate_harmony: { label: '批次校正 (Harmony)', desc: '多样本 Harmony 去批次', tool: 'harmonypy', io: 'scrna_harmony.h5ad', note: '' },
  cluster_umap: { label: '降维聚类 UMAP', desc: 'PCA → Leiden 聚类 → UMAP 可视化', tool: 'Scanpy', io: 'scrna_clustered.h5ad', note: '' },
  annotate_celltypes: { label: '细胞类型注释', desc: '基于 marker 的细胞类型注释', tool: 'Scanpy', io: 'scrna_annotated.h5ad', note: '' },
  scrna_composition: { label: '细胞类型比例/组成分析', desc: '量化各细胞类型丰度消长与统计显著性', tool: 'Scanpy, scipy.stats', io: 'celltype_composition.tsv, l2_05/06', note: 'KW 含 tie 校正' },
  deg_groups: { label: '组间差异表达 (DEG)', desc: '固定细胞类型内 Treat vs Control 转录丰度变化', tool: 'Scanpy (rank_genes_groups)', io: 'deg_all_by_celltype.tsv, l2_08/09', note: '' },
  subcluster: { label: '目标细胞亚群再聚类', desc: '提取核心细胞群重跑 HVG+PCA+聚类', tool: 'Scanpy', io: 'subcluster.h5ad, subcluster_markers.tsv', note: '' },
  enrichment: { label: '单细胞多维功能富集', desc: 'GO/KEGG/Reactome ORA + GSEA（5 库并行）', tool: 'gseapy', io: 'enrichment_ora.tsv, enrichment_gsea.tsv, l2_11/12', note: 'GO BP/CC/MF + KEGG + Reactome' },
  enrichment_figures: { label: '单细胞富集出图', desc: '富集条形 top20 双标注', tool: 'matplotlib', io: 'l2_11/12', note: '' },
  pseudotime: { label: '拟时序/轨迹分析', desc: '核心亚群状态转换伪时间轨迹', tool: 'Scanpy (PAGA/DPT)', io: 'pseudotime.h5ad, track_genes.tsv', note: 'Control 组为起点' },
  cell_communication: { label: '细胞通讯分析', desc: '配受体互作强度与信号流变化', tool: 'liana consensus LR', io: 'cellchat_lr.tsv, l2_10', note: 'workers=2' },
  scenic_tf: { label: '转录因子调控分析 (SCENIC)', desc: 'GRNBoost2 → cisTarget motif → AUCell regulon 活性', tool: 'pySCENIC CLI', io: 'scenic_regulons.csv, tf_activity.tsv, l2_scenic_01/02', note: '--num_workers 3' },
  scenic_figures: { label: 'SCENIC 出图', desc: 'regulon 活性热图 + 特异性条形', tool: 'matplotlib', io: 'l2_scenic_01/02', note: '' },
  tf_activity: { label: 'TF 活性打分 (ORA 近似)', desc: 'TF 靶基因 ORA 近似活性打分', tool: 'gseapy', io: 'tf_activity.tsv, tf_report.txt', note: 'SCENIC 的对照路线' },
  virtual_knockout: { label: '虚拟敲除 (scTenifoldKnk)', desc: 'WT/Control 矩阵模拟敲除目标基因，输出 DR Genes', tool: 'scTenifoldKnk (R)', io: 'ko_dr_genes.tsv, scrna_knockout.h5ad', note: '【需指定 target_ko_gene】仅输入 WT/Control 矩阵' },
  summarize_dr: { label: 'DR 基因汇总', desc: 'DR 基因多运行稳健交集 + 显著性排序', tool: 'pandas', io: 'dr_genes_summary.tsv, dr_summary_report.txt', note: '建议 3 次独立运行取交集' },
  target_gene_localization: { label: '目标基因表达定位', desc: '敲除基因 ∪ celltype 差异 top5 的表达定位', tool: 'Scanpy, matplotlib', io: 'target_gene_localization.tsv, l2_13', note: '从 layers["counts"] 重算 lognorm' },
  gsva_pathways: { label: 'GSVA 通路活性打分', desc: 'pseudobulk → R GSVA → top30 变异通路热图', tool: 'GSVA (R), gseapy', io: 'gsva_scores.tsv, l2_14', note: '全基因输入保通路覆盖' },
  dr_post_analysis: { label: 'DR 后续分析', desc: 'DR 富集(GSEA) + 调控网络(SCENIC regulon ∩ DR) + DR∩DEG∩marker 交集', tool: 'gseapy, networkx', io: 'dr_enrichment.tsv, dr_regulatory_network.tsv, dr_overlap.tsv, l2_15/16/17', note: 'DR ≠ DEG' },
  scrna_figures: { label: '单细胞出图', desc: 'UMAP×4/组成×14/marker/DEG 火山×7/计数/PCA', tool: 'matplotlib', io: 'l2_01..10', note: '' },
  // line3_spatial
  ingest_spatial: { label: '空间数据读入', desc: '读取空间表达矩阵与坐标', tool: 'Scanpy', io: 'spatial_counts_mouse.h5ad, spatial_counts_human.h5ad, samples_meta.tsv', note: '两物种分文件落盘（原写 spatial_raw.h5ad 与母版实际产物不符）' },
  qc_spots: { label: 'Spot 质控', desc: '过滤低质量 spot，线粒体百分比', tool: 'Scanpy', io: 'spatial_qc.h5ad, spot_qc_metrics.tsv', note: '' },
  dim_reduce: { label: '降维 (PCA/UMAP)', desc: 'PCA → UMAP 空间可视化', tool: 'Scanpy', io: 'spatial_dimred.h5ad', note: '' },
  spatial_domains: { label: '空间域识别', desc: '转录谱 + 空间坐标识别解剖/病理结构域', tool: 'Scanpy (Leiden)', io: 'spatial_domains.h5ad', note: '域身份样本私有' },
  spatial_markers: { label: '空间域 Marker', desc: '各域 wilcoxon top200 marker', tool: 'Scanpy (rank_genes_groups)', io: 'domain_markers.tsv, spatial_marker.h5ad', note: '' },
  spatial_autocorr: { label: '空间自相关 (Moran\'s I)', desc: '全切片基因 Moran\'s I 空间聚集梯度', tool: 'Squidpy', io: 'gene_autocorr.tsv', note: '' },
  spatial_cooccurrence: { label: '空间邻域/共现', desc: '微米尺度物理毗邻偏好（共定位 vs 排斥）', tool: 'Squidpy', io: 'domain_cooccurrence.tsv', note: '' },
  spatial_composition: { label: '区域组成差异', desc: '不同切片/微区域的结构组成变化', tool: 'Scanpy, scipy.stats', io: 'sample_composition.tsv', note: 'KW 检验' },
  spatial_communication: { label: '空间通讯分析', desc: 'KNN 邻域 domain 对级 LR 强度打分', tool: 'liana consensus LR', io: 'sample_communication.tsv', note: '' },
  spatial_localization: { label: '目标基因空间定位', desc: '目标基因在空间域中的表达分布', tool: 'Scanpy', io: 'gene_localization.tsv', note: '' },
  spatial_knockout: { label: '空间虚拟敲除', desc: 'WT/Control 空间矩阵模拟敲除，输出 DR Genes', tool: 'scTenifoldKnk (R)', io: 'ko_dr_genes_mouse.tsv, ko_dr_genes_human.tsv, spatial_knockout_mouse.h5ad, spatial_knockout_human.h5ad', note: '【需指定 target_ko_gene】逐样本 spot 级运行（域聚合路线实测废弃）' },
  celltype_annotation: { label: '反卷积/细胞类型注释', desc: '域 marker top5 签名 → NNLS 逐 spot 解卷积 → 比例归一化', tool: 'scipy.optimize.nnls, Scanpy', io: 'celltype_scores.tsv, celltype_annotation.tsv, l3_14/15', note: '轻量方案，不依赖 R Seurat/CARD/RCTD' },
  spatial_figures: { label: '空间出图', desc: '域图/目标基因/KO DR 逐样本 + 域统计 + Moran/DR/UMAP/组成', tool: 'matplotlib', io: 'l3_*_*', note: '逐样本画，跨样本坐标不可比' },
};

/**
 * S24/R11+R12 建项契约校验（只对新建项目入口生效，见 buildProjectMetaStrict）。
 *
 * 兼容性红线：buildProjectMeta 的直接调用（三十余条既有契约断言）不传 strict，
 * 走原有宽松行为；这里只拦"经建项 API 新建项目"时的脏值。
 * 逐条失败即抛错，index.js 的建项路由把异常转成 400 + error 点名字段。
 */
function validateCreateContract(params) {
  // species：非空且在枚举（拼错会让下游选错 OrgDb / 注释分支）
  const species = String(params.basicInfo?.species ?? '').trim() || 'Homo sapiens';
  if (!SPECIES_ENUM.includes(species)) {
    throw new Error(`species 非法: "${species}"，只能是 ${SPECIES_ENUM.join(' / ')}`);
  }
  // domain：非空且在枚举（缺省空串静默落盘是 R11 点名的脏值）
  const domain = String(params.basicInfo?.domain ?? '').trim();
  if (!DOMAIN_ENUM.includes(domain)) {
    throw new Error(`domain（研究领域）缺失或非法: "${domain}"，只能是 ${DOMAIN_ENUM.join(' / ')}`);
  }
  // dataType：决定选线与数据部署落点，缺失/拼错会让文件部署到错误分析线
  const dataType = String(params.dataSource?.dataType ?? '').trim();
  if (!DATA_TYPE_IDS.includes(dataType)) {
    throw new Error(`dataType 缺失或非法: "${dataType}"，只能是 ${DATA_TYPE_IDS.join(' / ')}`);
  }
  // sampleCount：正整数（0/负数/小数/字符串一律拒；数字字符串也拒——类型必须是 number）
  const rawSampleCount = params.dataSource?.sampleCount;
  const sampleCount = Number(rawSampleCount);
  if (typeof rawSampleCount !== 'number' || !Number.isInteger(sampleCount) || sampleCount < 1) {
    throw new Error(`sampleCount 必须是正整数（>=1），当前值: ${JSON.stringify(rawSampleCount ?? null)}`);
  }
  // contrasts：case/ctrl 必须引用存在的组名；给了对比就恰好一条 primary。
  // 两条 contrasts 都为空（二组模式）时不强制 primary——工作台在 <3 组时不生成对比。
  const contrasts = Array.isArray(params.groupingDesign?.contrasts) ? params.groupingDesign.contrasts : [];
  if (contrasts.length) {
    const groupNames = (Array.isArray(params.groupingDesign.groups) ? params.groupingDesign.groups : [])
      .map((g) => String(g?.groupName ?? '').trim());
    for (const c of contrasts) {
      for (const side of ['case', 'ctrl']) {
        const ref = String(c?.[side] ?? '').trim();
        if (!groupNames.includes(ref)) {
          throw new Error(`contrasts 对比 "${c?.name || '(未命名)'}" 的 ${side} 引用了不存在的组名: "${ref}"`);
        }
      }
    }
    const primaries = contrasts.filter((c) => c?.isPrimary === true);
    if (primaries.length !== 1) {
      throw new Error(`contrasts 有且仅允许 1 条主对比（primary），当前 ${primaries.length} 条`);
    }
  }
  // R12 联动：DAG 含虚拟敲除步骤而靶基因为空 → 拒（否则要跑到 virtual_knockout 步才失败）
  const dag = Array.isArray(params.pipelineDag) ? params.pipelineDag : [];
  const hasKnockout = dag.some((d) => String(d?.stepId ?? '').toLowerCase().includes('knockout'));
  const koTarget = normalizeBiologicalPriors(params.biologicalPriors).target_ko_gene;
  if (hasKnockout && !koTarget) {
    throw new Error('含虚拟敲除步骤必须提供靶基因（biologicalPriors.targetKoGene / target_ko_gene）');
  }
}

/**
 * 构造一个项目的元数据对象。
 * v2 支持四段式（basic_info / data_source / pipeline_dag / acl_and_output），
 * 向下兼容旧版（只传 id/name/description 时生成 v1 结构包裹在 basic_info 里）。
 * @param {object} params
 * @param {string} params.id
 * @param {string} [params.name]
 * @param {string} [params.description]
 * @param {object} [params.basicInfo] v2 段：{name, domain, disease, species, nonTumorVerified}
 * @param {object} [params.dataSource] v2 段：{source, dataType, datasets:[{gse,gpl,role}], sampleCount, tissue}
 * @param {object} [params.groupingDesign] v2 段：{mode, groups:[{groupId,groupName,role,stageOrder,colorHex,sampleIds}], contrasts:[{name,case,ctrl,isPrimary}]}
 * @param {Array} [params.pipelineDag] v2 段：[{order, stepId, tool, lang, params}]
 * @param {object} [params.aclAndOutput] v2 段：{members, role, expectedFormats}
 * @param {string} [params.notes] 客户备注 / 分析需求补充说明（自由文本，参与非肿瘤合规校验）
 * @param {Array} [params.references] 客户上传的参考文献元数据：[{name, path, size}]
 * @param {string} [params.lineId] 建项请求的分析线（aims.txt:96 契约的 line_id 字段）
 * @param {{strict?: boolean}} [options] strict=true 时启用 R11/R12/line_id 建项契约校验
 * @returns {object}
 */
export function buildProjectMeta(params, options = {}) {
  const id = sanitizeProjectId(params.id);
  if (!id) throw new Error(`项目 ID 非法: ${params.id}`);

  // line_id（aims.txt:96 契约示例）：取值来自建项请求的 lineId。
  // strict（建项 API 入口）缺失或不在三线枚举直接拒；既有契约测试直接调
  // buildProjectMeta 不带 lineId，落 null 不抛，保持向下兼容。
  const lineIdRaw = String(params.lineId ?? '').trim();
  const lineIdValid = LINES.includes(lineIdRaw);
  if (options?.strict === true && !lineIdValid) {
    throw new Error(`line_id 缺失或不在三线枚举: "${lineIdRaw || '(空)'}"，只能是 ${LINES.join(' / ')}`);
  }
  if (options?.strict === true) {
    validateCreateContract(params);
  }

  // 非肿瘤黑名单校验（后端第二道防线，前端是第一道）
  const fieldsToCheck = {
    name: params.name || params.basicInfo?.name,
    description: params.description || params.basicInfo?.description,
    disease: params.basicInfo?.disease,
    tissue: params.dataSource?.tissue,
    // 客户备注是自由文本，同样纳入非肿瘤黑名单扫描
    notes: params.notes,
  };
  // 分组名也纳入黑名单扫描
  if (params.groupingDesign?.groups) {
    for (const g of params.groupingDesign.groups) {
      if (g.groupName) fieldsToCheck[`group_${g.groupId || g.groupName}`] = g.groupName;
    }
  }
  // focus_genes 同样过黑名单（客户可能把肿瘤相关基因写进关注列表）
  const focusGenes = normalizeBiologicalPriors(params.biologicalPriors).focus_genes;
  for (const gene of focusGenes) {
    fieldsToCheck[`focus_gene_${gene}`] = gene;
  }
  const blResult = validateProjectFields(fieldsToCheck);
  if (blResult.hit) {
    throw new Error(
      `非肿瘤合规拦截：字段"${blResult.field}"含违规词 ${JSON.stringify(blResult.matches)}。` +
      `本平台专精非肿瘤领域。`
    );
  }

  // 分组设计校验：样本跨组重复检测 + 样本编号格式（按数据源模式切换）
  const dataSourceMode = normalizeDataSourceMode(params.dataSource?.data_source_mode);
  if (params.groupingDesign?.groups) {
    const allSamples = [];
    for (const g of params.groupingDesign.groups) {
      if (g.sampleIds) allSamples.push(...g.sampleIds);
    }
    const seen = new Set();
    const dupes = [];
    for (const s of allSamples) {
      if (seen.has(s)) dupes.push(s);
      else seen.add(s);
    }
    if (dupes.length) {
      throw new Error(`样本编号跨组重复分配: ${JSON.stringify(dupes)}`);
    }
    // 样本编号格式：公共库要求 GSM 前缀，自有上传解除该限制
    const badSamples = allSamples.filter((s) => !isValidSampleId(s, dataSourceMode));
    if (badSamples.length) {
      const hint = dataSourceMode === 'IN_HOUSE_UPLOAD'
        ? '自有上传模式允许字母、数字、下划线、连字符与点'
        : '公共数据库模式只接受 GSM 开头的编号';
      throw new Error(`样本编号格式非法（${hint}）: ${JSON.stringify(badSamples.slice(0, 5))}`);
    }
    // 至少 2 组
    if (params.groupingDesign.groups.length < 2) {
      throw new Error('分组数至少 2 组');
    }
    // 必须有且只有一个 reference 组
    const refs = params.groupingDesign.groups.filter((g) => g.role === 'reference');
    if (refs.length !== 1) {
      throw new Error(`有且仅允许 1 个基准对照组(reference)，当前 ${refs.length} 个`);
    }
  }

  // 数据源段归一化：双模态，IN_HOUSE 模式下补齐 accession_and_platform
  const normalizedSource = normalizeDataSource(params.dataSource, id);

  // v2 四段式
  const basicInfo = params.basicInfo || {
    name: (params.name || id).trim() || id,
    description: (params.description || '').trim(),
    domain: '',
    disease: '',
    species: 'Homo sapiens',
    non_tumor_verified: true,
  };

  return {
    schema_version: PROJECT_SCHEMA_VERSION,
    project_id: id,
    // aims.txt:96 建项契约示例的顶层 line_id；请求未带或非法时落 null（strict 模式已在上面拒绝）
    line_id: lineIdValid ? lineIdRaw : null,
    basic_info: {
      name: basicInfo.name || id,
      description: basicInfo.description || '',
      domain: basicInfo.domain || '',
      disease: basicInfo.disease || '',
      species: basicInfo.species || 'Homo sapiens',
      non_tumor_verified: basicInfo.non_tumor_verified !== false,
    },
    data_source: normalizedSource.accession
      ? {
        data_source_mode: normalizedSource.mode,
        accession_and_platform: normalizedSource.accession,
        datasets: normalizedSource.datasets,
        datasets_inferred: normalizedSource.inferred,
      }
      : (params.dataSource && typeof params.dataSource === 'object'
        // 公共库：落归一化后的配对表，每行带 dataType / sampleCount / tissue。
        // 直接透传原始 params 会把"行级未填、项目级有值"的兜底丢掉，
        // 下游脚本就得自己再实现一遍继承规则（两端规则漂移的老坑）。
        ? {
          ...params.dataSource,
          datasets: normalizedSource.datasets,
          datasets_inferred: normalizedSource.inferred,
        }
        : null),
    grouping_design: params.groupingDesign || null,
    pipeline_dag: params.pipelineDag || null,
    acl_and_output: params.aclAndOutput || null,
    // aims v3.0 的 intake 契约四块：生物学先验 / 统计阈值 / 排版配置 / 实验设计
    biological_priors: normalizeBiologicalPriors(params.biologicalPriors),
    analysis_cutoffs: normalizeAnalysisCutoffs(params.analysisCutoffs),
    // WGCNA 参数契约（aims Step 3）：母版脚本读不到时用同名默认值，来源写进报告
    wgcna_config: normalizeWgcnaConfig(params.wgcnaConfig),
    plot_layout_config: normalizePlotLayoutConfig(params.plotLayoutConfig),
    experimental_design: normalizeExperimentalDesign(params.experimentalDesign),
    // aims v3.0 模块 B 第四分区：独立验证集分组映射（无验证集时为两个空数组）
    validation_group_mapping: normalizeValidationGroupMapping(params.validationGroupMapping),
    // 客户侧补充材料：备注原文 + 参考文献元数据（文件本体留在用户端收件箱 refs/ 下）
    notes: typeof params.notes === 'string' ? params.notes.trim() : '',
    references: Array.isArray(params.references) ? params.references : [],
    // 客户上传的数据文件：path 是提交包内的相对路径（PKG_.../raw_data/...），
    // 建项时由服务端复制到本项目对应分析线的 raw_data/，并回写 deployed_path
    data_files: normalizeDataFiles(params.dataFiles),
    created_at: params.createdAt || new Date().toISOString(),
    lines: [...LINES],
  };
}

/**
 * 建项 API 入口专用：开启 R11/R12/line_id 严格校验的 buildProjectMeta。
 * 既有单元契约测试直接调 buildProjectMeta 保持原宽松行为（契约护栏不许动）。
 */
export function buildProjectMetaStrict(params) {
  return buildProjectMeta(params, { strict: true });
}

/**
 * 解析 `find <projects_root> -mindepth 1 -maxdepth 1 -type d -printf '%f|%T@\n'` 的输出为项目 ID 列表。
 * 每行形如 `<目录名>|<mtime>`（也兼容绝对路径行）；先剥 mtime 段再取末段目录名。
 * 非法 ID（含穿越/隐藏/`|` 残留）一律丢弃。
 * @param {string} raw
 * @returns {string[]} 排序后的合法项目 ID
 */
export function parseProjectList(raw) {
  return String(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    // 剥掉 `|mtime` 段（buildProjectListCommand 用 %f|%T@ 输出）
    .map((line) => line.split('|')[0].trim())
    .filter(Boolean)
    .map((line) => line.split('/').filter(Boolean).pop())
    .map((name) => sanitizeProjectId(name))
    .filter((id) => id !== null)
    .filter((id, index, arr) => arr.indexOf(id) === index)
    .sort();
}

/**
 * 建项目命令：建三线数据子目录 + 写 project.json。
 *
 * 幂等保护：项目目录已存在时直接报 EXISTS 并以非零码退出，避免误覆盖已有项目。
 * project.json 用 base64 写入，防 JSON 里的引号/中文被 shell 层破坏（同 run.js 落台账）。
 *
 * @param {string} projectId
 * @param {object} meta buildProjectMeta 的产物
 * @returns {{command: string, remoteDir: string, metaPath: string}}
 */
export function buildCreateProjectCommand(projectId, meta) {
  const id = sanitizeProjectId(projectId);
  if (!id) throw new Error(`项目 ID 非法: ${projectId}`);
  const remoteDir = `${PROJECTS_ROOT}/${id}`;
  const metaPath = `${remoteDir}/${PROJECT_META_FILE}`;

  const subdirs = LINES.flatMap((line) => LINE_SUBDIRS.map((sub) => `${remoteDir}/${line}/${sub}`));
  const payload = Buffer.from(JSON.stringify(meta, null, 2)).toString('base64');

  const command = [
    `if [ -e '${remoteDir}' ]; then echo EXISTS; exit 3; fi`,
    `mkdir -p ${subdirs.map((d) => `'${d}'`).join(' ')}`,
    `echo ${payload} | base64 -d > '${metaPath}'`,
    `echo CREATED '${remoteDir}'`,
  ].join(' && ');

  return { command, remoteDir, metaPath };
}

/**
 * 解析项目元数据 JSON 文本；坏 JSON 返回 null 不抛（列表接口要能容忍单个坏文件）。
 * @param {string} text
 * @returns {object|null}
 */
export function parseProjectMeta(text) {
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object') return null;
    if (!sanitizeProjectId(data.project_id)) return null;
    return data;
  } catch {
    return null;
  }
}

/** 列出项目目录命令 */
export function buildProjectListCommand() {
  return `find '${PROJECTS_ROOT}' -mindepth 1 -maxdepth 1 -type d -printf '%f|%T@\\n' 2>/dev/null`;
}

/** 读单个项目 project.json 命令（base64 中转，防 JSON 变形） */
export function buildReadProjectMetaCommand(projectId) {
  const id = sanitizeProjectId(projectId);
  if (!id) throw new Error(`项目 ID 非法: ${projectId}`);
  return `base64 -w0 '${PROJECTS_ROOT}/${id}/${PROJECT_META_FILE}' 2>/dev/null || true`;
}
