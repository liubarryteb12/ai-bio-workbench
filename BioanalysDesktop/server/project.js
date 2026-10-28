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
import { loadWorkflows, modToScriptMap } from './workflow_graph.js';

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

/**
 * 三条分析线可选步骤（前端级联勾选用，与 bin/<line>/ 已部署脚本对应）。
 *
 * 2026-10-23 起改为**从 mod 注册表派生**，不再手写清单。
 * 单一事实源是 `src/workflows.json`；此处只做「母版名」视图的兼容输出
 * （旧前端与既有断言按母版名消费，故值取 mod.script 而非 mod.id）。
 * 注册表改名不会让这里漂移——它没有自己的清单。
 */
export const LINE_STEPS = buildLineSteps();

function buildLineSteps() {
  const out = {};
  for (const series of loadWorkflows().series) {
    out[series.id] = series.stages.flatMap((st) => st.mods.map((m) => m.script || m.id));
  }
  return out;
}

/**
 * 步骤节点功能说明字典（前端模块 C 展示用）。
 * 每个步骤含：desc（功能简介）、tool（核心工具）、io（输入/输出产物）、note（条件/算力提示）。
/**
 * 步骤节点功能说明字典（前端模块 C 展示用）。
 * 每个步骤含：label（功能名）、desc（功能简介）、tool（核心工具）、io（输入/输出产物）、note（条件/算力提示）。
 *
 * 2026-10-23 起改为**从 mod 注册表派生**（单一事实源 src/workflows.json），不再手写 47 条。
 * label / desc / note 直接来自注册表的 name / notes / risk；
 * tool 与 io 按母版名查 SCRIPT_TOOLING——这两个字段只随母版实现变化，
 * 放注册表会让"换个工具包"也要动依赖图，故按母版名索引（母版名稳定，mod id 会演进）。
 */
/** 母版名 -> 核心工具与产物（由母版头注释提取，母版改名才需同步）。 */
const SCRIPT_TOOLING = {
  annotate_celltypes: { tool: 'wilcoxon', io: 'scrna_annotated.h5ad, cluster_markers.tsv, annotate_report.txt' },
  bulk_figures: { tool: '', io: 'l1_01_correlation.png, l1_02_pca.png, l1_03_volcano.png, l1_04_topvar_heatmap.png' },
  cell_communication: { tool: 'liana', io: 'scrna_cellcomm.h5ad, cellcomm_interactions.tsv, cellcomm_report.txt' },
  celltype_annotation: { tool: 'scipy.optimize.nnls', io: 'celltype_scores_{species}.tsv, celltype_annotation_{species}.tsv, deconv_report.txt, l3_{species}_14_deconv_umap.png' },
  cluster_umap: { tool: 'UMAP, Leiden, igraph', io: 'scrna_clustered.h5ad, cluster_report.txt' },
  cox_analysis: { tool: 'Cox, LASSO-Cox', io: 'cox_univariate.tsv, cox_multivariate.tsv, cox_forest.pdf, cox_report.txt' },
  deg_groups: { tool: 'scanpy', io: 'scrna_deg.h5ad, deg_all_by_celltype.tsv, deg_significant_by_celltype.tsv, deg_report.txt' },
  deg_limma: { tool: 'limma', io: 'deg_all.tsv, deg_sig.tsv, deg_report.txt, l1_03_volcano_limma.png' },
  dim_reduce: { tool: 'scanpy', io: 'spatial_dimred_mouse.h5ad, spatial_dimred_human.h5ad, dimred_report.txt' },
  dr_post_analysis: { tool: 'GSEA, SCENIC', io: 'dr_enrichment*.tsv, dr_regulatory_network.tsv, dr_overlap*.tsv, dr_post_report.txt' },
  enrichment: { tool: 'gseapy', io: 'enrichment_ora*.tsv, enrichment_gsea*.tsv, enrichment_report.txt' },
  enrichment_bulk: { tool: 'gseGO, gseKEGG, enrichGO, enrichKEGG', io: 'enrichment_gsea_go.tsv, enrichment_gsea_kegg.tsv, enrichment_module_ora.tsv, enrichment_kegg.tsv' },
  enrichment_figures: { tool: '', io: 'l1_13_gsea_top.png / l2_11_ora_top.png / l3_*_12_ora_top.png, l3_*_13_gsea_top.png' },
  external_validation: { tool: '', io: 'external_validation_preds.tsv, external_frozen_coefs.tsv, external_validation_report.txt, l1_12_external_roc.png' },
  gsva_pathways: { tool: 'GSVA', io: 'gsva_scores.tsv, scrna_gsva.h5ad, gsva_report.txt, l2_14_gsva_heatmap.png' },
  ingest_counts: { tool: 'AnnData', io: 'scrna_counts.h5ad, ingest_report.txt' },
  ingest_spatial: { tool: 'AnnData, scanpy', io: 'spatial_counts_mouse.h5ad, spatial_counts_human.h5ad, samples_meta.tsv, ingest_report.txt' },
  integrate_harmony: { tool: 'scanpy, harmonypy', io: 'scrna_integrated.h5ad, integrate_report.txt' },
  key_genes: { tool: '', io: 'key_genes.tsv, key_genes_report.txt, l1_09_key_genes.png' },
  ml_diagnostics: { tool: 'LogisticRegression, liblinear', io: 'ml_diag_metrics.tsv, ml_diag_dca.tsv, ml_diag_pergene_roc.tsv, ml_diagnostics_report.txt' },
  ml_hub_analysis: { tool: 'glmnet, RFE, LASSO, random forest, gradient boosting, SHAP', io: 'ml_core_hub_genes.tsv, ml_importance.tsv, ml_shap.tsv, ml_hub_report.txt' },
  ml_model: { tool: 'logistic regression, random forest, LOOCV', io: 'ml_feature_importance.tsv, ml_report.txt, l1_10_ml_roc.png, l1_11_ml_importance.png' },
  normalize_hvg: { tool: 'scanpy', io: 'scrna_norm.h5ad, hvg_genes.tsv / spatial_norm_*.h5ad, hvg_genes_*.tsv' },
  pca_matrix: { tool: 'prcomp', io: 'pca_scores.tsv, pca_report.txt, l1_02_pca_step3.png' },
  ppi_string: { tool: 'STRING v12.0, networkx', io: 'ppi_edges.tsv, ppi_hubs.tsv, ppi_report.txt, l1_07_ppi_network.png' },
  prep_matrix: { tool: '', io: 'expr_genes.tsv, group_map.tsv, prep_report.txt' },
  pseudotime: { tool: 'scanpy', io: 'scrna_pseudotime.h5ad, pseudotime_report.txt' },
  qc_cells: { tool: '', io: 'scrna_qc.h5ad, qc_cell_metrics.tsv, qc_report.txt' },
  qc_matrix: { tool: '', io: 'qc_report.txt, sample_qc.tsv' },
  qc_spots: { tool: '', io: 'spatial_qc_*.h5ad, spot_qc_metrics.tsv, qc_report.txt' },
  scenic_figures: { tool: '', io: 'l2_scenic_01_regulon_heatmap.png, l2_scenic_02_top_regulons.png' },
  scenic_tf: { tool: 'pyscenic, GRNBoost2, AUCell', io: 'scenic_adjacencies.tsv, scenic_regulons.csv, scenic_auc_mtx.tsv, scenic_report.txt' },
  scrna_composition: { tool: 'KW, eta2', io: 'scrna_composition.h5ad, celltype_composition.tsv, composition_report.txt' },
  scrna_figures: { tool: '', io: 'l2_01_umap_celltype.png, l2_05_composition_stack.png, l2_08_deg_volcano_*.png, l2_10_pca_diagnosis.png' },
  spatial_autocorr: { tool: 'esda, squidpy, scanpy', io: 'spatial_autocorr_mouse.h5ad, spatial_autocorr_human.h5ad, gene_autocorr_mouse.tsv, gene_autocorr_human.tsv' },
  spatial_communication: { tool: 'liana', io: 'spatial_communication_mouse.h5ad, spatial_communication_human.h5ad, sample_communication_mouse.tsv, sample_communication_human.tsv' },
  spatial_composition: { tool: 'KW, Wilcoxon, eta2', io: 'spatial_composition_mouse.h5ad, spatial_composition_human.h5ad, sample_composition_mouse.tsv, sample_composition_human.tsv' },
  spatial_cooccurrence: { tool: 'squidpy', io: 'spatial_cooccurrence_mouse.h5ad, spatial_cooccurrence_human.h5ad, domain_cooccurrence_mouse.tsv, domain_cooccurrence_human.tsv' },
  spatial_domains: { tool: 'scanpy', io: 'spatial_domains_mouse.h5ad, spatial_domains_human.h5ad, domains_report.txt' },
  spatial_figures: { tool: '', io: 'l3_{sp}_01_domains.png, l3_{sp}_02_target_gene.png, l3_{sp}_03_ko_dr.png, l3_{sp}_07_domain_composition.png' },
  spatial_knockout: { tool: 'scTenifoldpy, scTenifold', io: 'spatial_knockout_mouse.h5ad, spatial_knockout_human.h5ad, ko_dr_genes_mouse.tsv, ko_dr_genes_human.tsv' },
  spatial_localization: { tool: 'wilcoxon', io: 'gene_localization_{species}.tsv, spatial_localization_{species}.h5ad, localization_report.txt' },
  spatial_markers: { tool: 'scanpy', io: 'spatial_marker_mouse.h5ad, spatial_marker_human.h5ad, domain_markers_mouse.tsv, domain_markers_human.tsv' },
  subcluster: { tool: 'HVG, PCA, Leiden, UMAP, wilcoxon', io: 'scrna_subcluster.h5ad, scrna_deg_subclustered.h5ad, subcluster_markers.tsv, subcluster_report.txt' },
  summarize_dr: { tool: '', io: 'dr_genes_summary.tsv, dr_summary_report.txt' },
  target_gene_localization: { tool: 'normalize_total, log1p', io: 'target_gene_localization.tsv, target_gene_localization_wide.tsv, scrna_localization.h5ad, localization_report.txt' },
  tf_activity: { tool: 'gseapy, pySCENIC', io: 'tf_activity.tsv, tf_report.txt' },
  virtual_knockout: { tool: 'scTenifoldpy, scTenifoldKnk', io: 'scrna_knockout.h5ad, ko_dr_genes.tsv, knockout_report.txt' },
  wgcna_modules: { tool: 'WGCNA', io: 'wgcna_modules.tsv, wgcna_module_trait.tsv, wgcna_hub_genes.tsv, wgcna_report.txt' },
};

function buildStepMeta() {
  const out = {};
  for (const series of loadWorkflows().series) {
    for (const stage of series.stages) {
      for (const mod of stage.mods) {
        const script = mod.script || mod.id;
        const tooling = SCRIPT_TOOLING[script] || { tool: '', io: '' };
        out[script] = {
          label: mod.name,
          desc: mod.notes || mod.name,
          tool: tooling.tool,
          io: tooling.io,
          note: mod.risk || '',
          mod_id: mod.id,
          stage: stage.id,
          est_minutes: mod.est_minutes,
          optional: !!mod.optional,
          ko_gene: !!mod.ko_gene,
        };
      }
    }
  }
  return out;
}

/**
 * 把建项请求里的步骤信息统一成 pipeline_dag。
 *
 * 三种入参形态都要认：
 *   ① pipelineDag 已给（旧客户端 / runner 直跑）→ 原样返回；
 *   ② seriesId + modIds（mod 化后的客户端）→ 按注册表合成，
 *      stepId 用母版名（下游台账与 lineFromPipeline 都按母版名消费）；
 *   ③ 都没给 → null。
 * 顺带把 koGene 并入 biologicalPriors.target_ko_gene，让 R12 的敲除校验能拦住。
 */
export function buildPipelineDag(params) {
  if (Array.isArray(params.pipelineDag) && params.pipelineDag.length) {
    return params.pipelineDag;
  }
  const modIds = Array.isArray(params.modIds) ? params.modIds.filter(Boolean) : [];
  if (!modIds.length) return params.pipelineDag || null;

  const modToScript = modToScriptMap();
  const seriesId = String(params.seriesId || '').trim();
  const series = loadWorkflows().series.find((s) => s.id === seriesId);
  if (!series) {
    throw new Error(`seriesId 未知: "${seriesId || '(空)'}"，无法解析 modIds`);
  }
  // 按阶段 order 排序，同阶段内保持客户端勾选顺序——执行序必须稳定可复现
  const rank = new Map();
  for (const st of series.stages) for (const m of st.mods) rank.set(m.id, st.order);
  const ordered = modIds
    .map((id, i) => ({ id, i, order: rank.get(id) ?? 999 }))
    .sort((a, b) => (a.order - b.order) || (a.i - b.i))
    .map((x) => x.id);

  return ordered.map((id, i) => ({
    order: i + 1,
    stepId: modToScript.get(id) || id,
    mod_id: id,
  }));
}

export const PIPELINE_STEP_META = buildStepMeta();
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
  // 用 buildPipelineDag 而不是裸 params.pipelineDag：mod 化后的客户端只传
  // seriesId + modIds，不传 pipelineDag，裸读会漏掉整条敲除校验。
  const dag = buildPipelineDag(params) || [];
  // 敲除识别双形态：母版名含 knockout（virtual_knockout / spatial_knockout），
  // mod id 是 l2_ko_virtual / l3_ko_spatial（不含 knockout 字样），两套都要认。
  const hasKnockout = dag.some((d) => {
    const id = String(d?.stepId ?? '').toLowerCase();
    const modId = String(d?.mod_id ?? '').toLowerCase();
    return id.includes('knockout') || /^l\d_ko_/.test(modId) || modId.includes('_ko_');
  });
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
    // 兼容两种客户端形态：
    //   旧：直接给 pipelineDag [{order, stepId, ...}]（母版名）
    //   新：给 seriesId + modIds（mod id，如 l2_tf_scenic）+ koGene
    // 服务台内部一律用 pipeline_dag，所以新形态在这里合成，下游无感。
    // 母版名由 modToScriptMap 翻出来——台账与 lineFromPipeline 都按母版名消费。
    pipeline_dag: buildPipelineDag(params),
    acl_and_output: params.aclAndOutput || null,
    // aims v3.0 的 intake 契约四块：生物学先验 / 统计阈值 / 排版配置 / 实验设计
    // params.koGene 是 mod 化客户端传的靶基因（顶层字段），并进 biologicalPriors，
    // 让既有下游（R12 校验 / project.json / 任务下发）无感拿到。
    biological_priors: normalizeBiologicalPriors({
      ...(params.biologicalPriors && typeof params.biologicalPriors === 'object' ? params.biologicalPriors : {}),
      target_ko_gene: String(params.koGene || '').trim()
        || normalizeBiologicalPriors(params.biologicalPriors).target_ko_gene,
    }),
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
