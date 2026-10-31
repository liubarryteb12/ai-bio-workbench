#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REPO = path.resolve(__dirname, '..');
const FIGURE_ROOT = 'reference/05.可参考出图代码';
const CSV_PATH = path.join(REPO, FIGURE_ROOT, '_meta', 'bizard_index.csv');
const REPORT_PATH = path.join(REPO, FIGURE_ROOT, '_meta', 'r453_verification_report.json');
const REGISTRY_PATH = path.join(REPO, 'src', 'figure_templates.json');

function fail(message) {
  console.error(message);
  process.exitCode = 2;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let index = 0;

  while (index < text.length) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      field = '';
      if (row.some((value) => value.trim().length > 0)) rows.push(row);
      row = [];
    } else if (char !== '\r') {
      field += char;
    }
    index += 1;
  }

  row.push(field);
  if (row.some((value) => value.trim().length > 0)) rows.push(row);
  return rows;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function snakeCase(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function dependencies(raw) {
  if (!raw || raw === '-') return [];
  return raw
    .replace(/[`”]/g, '')
    .replace(/[；、]/g, ';')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
}

function linkedMods(row, status) {
  if (row.language === 'python') {
    return ['l2_figures_scrna', 'l3_figures_spatial'];
  }
  if (row.enName === 'KeggPathwayPlot') return ['l1_enrich_figures'];
  return ['l1_figures_bulk'];
}

function adaptVars(row) {
  const name = row.enName.toLowerCase();
  const common = {
    input_data: '项目本线只读输入文件路径，相对于本项目根目录',
  };

  if (name.includes('histogram') || name.includes('density')) {
    return { ...common, value_col: '数值列名', group_col: '分组列名' };
  }
  if (name.includes('scatter') || name.includes('bubble') || name.includes('biplot')) {
    return { ...common, x_col: '横轴列名', y_col: '纵轴列名', label_genes: '需要标注的基因清单，可为空' };
  }
  if (name.includes('heatmap') || name === 'complexheatmap' || name === 'bubbleheatmap') {
    return {
      ...common, row_col: '行注释列名', column_col: '列注释列名',
      value_col: '表达或差异数值列', group_col: '样本分组列名',
    };
  }
  if (name.includes('pca') || name.includes('umap')) {
    return { ...common, group_col: '细胞或样本分组列名' };
  }
  if (name.includes('volcano')) {
    return { ...common, group_col: '比较方向定义使用的分组列名', label_genes: '需要标注的基因清单，可为空' };
  }
  if (name.includes('violin') || name.includes('boxplot')) {
    return { ...common, group_col: '分组列名', value_col: '表达或测量值列名' };
  }
  if (name.includes('groupedbar') || name.includes('barplot') || name.includes('radial')) {
    return {
      ...common, group_col: '分组列名', x_col: '横轴类别列名',
      value_col: '均值或计数列名', error_col: '误差列名，可为空',
    };
  }
  if (name.includes('multipanel') || name.includes('panel')) {
    return { ...common, panel_col: '分面面板列名', group_col: '分组列名', value_col: '数值列名' };
  }
  if (name.includes('sankey')) {
    return { ...common, axis_cols: '按顺序排列的流轴列名', value_col: '流量数值列名', flow_col: '流向分类列名' };
  }
  return { ...common, group_col: '分组列名' };
}

const TEMPLATE_MAPPINGS = {
  fig_l2_heatmap: {
    lines: ['line1_bulk'],
    analysis_step: 'l1_ingest_prep',
    input_tables: ['expr_genes.tsv'],
    produces: ['custom_fig_l2_heatmap.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l2_heatmap.png',
    canonical_output: 'L2_heatmap_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/l1_04_topvar_heatmap.png',
  },
  fig_l2_pca: {
    lines: ['line1_bulk'],
    analysis_step: 'l1_qc_pca',
    input_tables: ['pca_scores.tsv'],
    produces: ['custom_fig_l2_pca.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l2_pca.png',
    canonical_output: 'L2_pca_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/l1_02_pca.png',
  },
  fig_l2_volcano: {
    lines: ['line1_bulk'],
    analysis_step: 'l1_de_limma',
    input_tables: ['deg_all.tsv'],
    produces: ['custom_fig_l2_volcano.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l2_volcano.png',
    canonical_output: 'L2_volcano_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/l1_03_volcano_limma.png',
  },
  fig_l2p_dotplot: {
    lines: ['line2_scrna'],
    analysis_step: 'l2_ko_localization',
    input_tables: ['target_gene_localization.tsv'],
    produces: ['custom_fig_l2p_dotplot.png'],
    output_glob: 'figures/line2_scrna/custom_fig_l2p_dotplot.png',
    canonical_output: 'figures/dotplot__L2p_dotplot_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/l2_13_target_gene_dotplot.png',
  },
  fig_l2p_umap: {
    lines: ['line3_spatial'],
    analysis_step: 'l3_dimred_reduce',
    input_tables: ['spatial_dimred_human.h5ad'],
    produces: ['custom_fig_l2p_umap.png'],
    output_glob: 'figures/line3_spatial/custom_fig_l2p_umap.png',
    canonical_output: 'umap_L2p_umap_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line3_spatial/l3_human_06_umap_sample.png',
  },
  fig_l2p_volcano: {
    lines: ['line2_scrna'],
    analysis_step: 'l2_profile_deg',
    input_tables: ['deg_all_by_celltype.tsv'],
    produces: ['custom_fig_l2p_volcano.png'],
    output_glob: 'figures/line2_scrna/custom_fig_l2p_volcano.png',
    canonical_output: 'L2p_volcano_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/l2_08_deg_volcano_basal_keratinocyte.png',
  },
  fig_l1_groupedbar: {
    lines: ['line1_bulk'], analysis_step: 'l1_enrich_bulk',
    input_tables: ['enrichment_gsea_go.tsv'],
    produces: ['custom_fig_l1_groupedbar.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l1_groupedbar.png',
    canonical_output: 'L1_groupedbar_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_groupedbar.png',
    adapt_vars: {
      input_data: '项目本线只读输入文件路径，相对于本项目根目录',
      x_col: '横轴类别列名',
      value_col: '数值列名',
      group_col: '分组或本体列名',
    },
  },
  fig_l1_scatter: {
    lines: ['line1_bulk'], analysis_step: 'l1_ml_hub',
    input_tables: ['ml_core_hub_genes.tsv'],
    produces: ['custom_fig_l1_scatter.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l1_scatter.png',
    canonical_output: 'L1_scatter_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_scatter.png',
    adapt_vars: {
      input_data: '项目本线只读输入文件路径，相对于本项目根目录',
      x_col: '横轴数值列名',
      y_col: '纵轴数值列名',
      label_genes: '需要标注的基因清单，可为空',
    },
  },
  fig_l1_boxplot: {
    lines: ['line1_bulk'], analysis_step: 'l1_de_limma',
    input_tables: ['deg_all.tsv'],
    produces: ['custom_fig_l1_boxplot.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l1_boxplot.png',
    canonical_output: 'L1_boxplot_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_boxplot.png',
    adapt_vars: {
      input_data: '项目本线只读输入文件路径，相对于本项目根目录',
      value_col: '效应量列名',
    },
  },
  fig_l1_density: {
    lines: ['line1_bulk'], analysis_step: 'l1_ingest_prep',
    input_tables: ['expr_genes.tsv'],
    produces: ['custom_fig_l1_density.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l1_density.png',
    canonical_output: 'L1_density_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_density.png',
    adapt_vars: {
      input_data: '项目本线只读输入文件路径，相对于本项目根目录',
    },
  },
  fig_l1_histogram: {
    lines: ['line1_bulk'], analysis_step: 'l1_ingest_prep',
    input_tables: ['expr_genes.tsv'],
    produces: ['custom_fig_l1_histogram.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l1_histogram.png',
    canonical_output: 'L1_histogram_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_histogram.png',
    adapt_vars: {
      input_data: '项目本线只读输入文件路径，相对于本项目根目录',
    },
  },
  fig_l1_violin: {
    lines: ['line1_bulk'], analysis_step: 'l1_de_limma',
    input_tables: ['deg_all.tsv'],
    produces: ['custom_fig_l1_violin.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l1_violin.png',
    canonical_output: 'L1_violin_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_violin.png',
    adapt_vars: {
      input_data: '项目本线只读输入文件路径，相对于本项目根目录',
      value_col: '效应量列名',
    },
  },
  fig_l2_umap: {
    lines: ['line2_scrna'], analysis_step: 'l2_integrate_cluster',
    input_tables: ['scrna_clustered.h5ad'],
    produces: ['custom_fig_l2_umap.png'],
    output_glob: 'figures/line2_scrna/custom_fig_l2_umap.png',
    canonical_output: 'umap_L2p_umap_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/custom_fig_l2_umap.png',
    language: 'python',
    linked_mods: ['l2_figures_scrna'],
    source_runner_id: 'py_l2p_umap',
    source_override: `${FIGURE_ROOT}/L2_组学常用图/L2p_umap_code.py`,
    preview_override: `${FIGURE_ROOT}/L2_组学常用图/L2p_umap_verified.png`,
    adapt_vars: {
      input_data: '项目本线只读输入文件路径，相对于本项目根目录',
      group_col: '细胞分组列名',
    },
  },
  fig_l3_multipanel: {
    lines: ['line1_bulk'], analysis_step: 'l1_ml_external',
    input_tables: ['external_validation_preds.tsv'],
    produces: ['custom_fig_l3_multipanel.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l3_multipanel.png',
    canonical_output: 'L3_multipanel_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l3_multipanel.png',
    adapt_vars: {
      input_data: '项目本线只读输入文件路径，相对于本项目根目录',
      group_col: '真实标签列名',
      value_col: '预测概率列名',
    },
  },
  fig_l2p_violin: {
    lines: ['line2_scrna'], analysis_step: 'l2_profile_composition',
    input_tables: ['celltype_composition.tsv'],
    produces: ['custom_fig_l2p_violin.png'],
    output_glob: 'figures/line2_scrna/custom_fig_l2p_violin.png',
    canonical_output: 'figures/violin_L2p_violin_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/custom_fig_l2p_violin.png',
    adapt_vars: {
      input_data: '项目本线只读输入文件路径，相对于本项目根目录',
      group_col: '细胞类型列名',
      value_col: '组成比例列名',
    },
  },
  fig_l3_sankey: {
    lines: ['line1_bulk'], analysis_step: 'l1_de_wgcna',
    input_tables: ['wgcna_modules.tsv'],
    produces: ['custom_fig_l3_sankey.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l3_sankey.png',
    canonical_output: 'L3_sankey_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l3_sankey.png',
    adapt_vars: {
      input_data: '项目本线只读输入文件路径，相对于本项目根目录',
      module_col: '模块列名',
    },
  },
};

function buildRegistry() {
  const rows = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
  const header = rows[0];
  const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  const runnerByArtifact = new Map();
  const runnerByFile = new Map();
  for (const [runnerId, runner] of Object.entries(report.l3.runners || {})) {
    runnerByFile.set(runnerId, runner);
  }
  const readyIdByFile = new Map();
  for (const figure of report.l3.figures || []) {
    if (figure.status !== 'ready') continue;
    for (const artifact of figure.artifacts || []) {
      const runner = runnerByFile.get(artifact.runner);
      const artifactBasename = path.basename(artifact.file);
      const levelStart = artifactBasename.search(/L[123]p?_/);
      const basename = levelStart >= 0 ? artifactBasename.slice(levelStart) : artifactBasename;
      runnerByArtifact.set(basename, { runner, id: figure.id });
      if (basename.endsWith('.png')) readyIdByFile.set(basename, figure.id);
    }
  }

  const templates = [];
  const seenIds = new Set();
  for (const raw of rows.slice(1)) {
    if (raw.length !== header.length) fail(`CSV 字段数错误：${raw.length}，期望 ${header.length}`);
    const [level, name, category, enName, languageRaw, , , dependenciesRaw, statusRaw, locationRaw] = raw;
    const language = languageRaw.toLowerCase();
    const normalizedLevel = level.toUpperCase();
    const status = statusRaw === '待采集' ? 'pending' : statusRaw;
    const reportId = readyIdByFile.get(path.basename(locationRaw));
    const isReady = status === 'ready';
    const isBlocked = status === 'blocked_r453';
    const id = isReady || isBlocked
      ? (isReady ? reportId : 'fig_kegg_pathway')
      : `fig_${language === 'python' ? `${normalizedLevel.toLowerCase()}p` : normalizedLevel.toLowerCase()}_${snakeCase(enName)}`;
    if (seenIds.has(id)) fail(`模板 id 重复：${id}`);
    seenIds.add(id);

    let source = null;
    let sourceSha256 = null;
    let preview = null;
    let previewSha256 = null;
    let verified = false;
    let blockReason = null;
    let activeStatus = status;
    const mapping = TEMPLATE_MAPPINGS[id] || null;
    const effectiveLanguage = mapping?.language || language;

    if (isReady) {
      if (!mapping) fail(`ready 行缺少真实产物映射：${id}`);
      if (!reportId) fail(`ready 行缺少 r453 报告匹配：${enName}`);
      const artifactInfo = runnerByArtifact.get(path.basename(locationRaw));
      if (!artifactInfo) fail(`ready 行缺少 PNG artifact：${locationRaw}`);
      const runner = mapping.source_runner_id
        ? report.l3.runners?.[mapping.source_runner_id]
        : artifactInfo.runner;
      if (!runner) fail(`ready 行缺少 runner：${id}`);
      source = mapping.source_override || `${FIGURE_ROOT}/${runner.source}`;
      preview = mapping.preview_override || `${FIGURE_ROOT}/${locationRaw}`;
      const sourceFile = path.join(REPO, source);
      const previewFile = path.join(REPO, preview);
      if (!fs.existsSync(sourceFile)) fail(`ready source 缺失：${source}`);
      if (!fs.existsSync(previewFile)) fail(`ready preview 缺失：${preview}`);
      sourceSha256 = sha256(sourceFile);
      previewSha256 = sha256(previewFile);
      if (sourceSha256 !== runner.source_sha256) fail(`source 哈希与报告不一致：${source}`);
      verified = true;
      if (!mapping.sample_project_output) {
        activeStatus = 'pending_mapping';
        verified = false;
        source = null;
        sourceSha256 = null;
        preview = null;
        previewSha256 = null;
        blockReason = '尚无与模板语义、语言和分析步骤一致的真实项目样例图';
      } else {
        const sampleFile = path.join(REPO, mapping.sample_project_output);
        if (!fs.existsSync(sampleFile)) {
          fail(`ready sample_project_output 缺失：${mapping.sample_project_output}`);
        }
      }
    } else if (isBlocked) {
      const blockedFigure = (report.l3.figures || []).find((figure) => figure.id === 'fig_kegg_pathway');
      if (!blockedFigure) fail('r453 报告缺少 fig_kegg_pathway');
      blockReason = blockedFigure.reason;
    }

    templates.push({
      id,
      name,
      level: normalizedLevel,
      category,
      language: effectiveLanguage,
      source,
      source_sha256: sourceSha256,
      preview,
      preview_sha256: previewSha256,
      verified,
      deps_status: activeStatus,
      deps: dependencies(dependenciesRaw),
      ...(blockReason ? { block_reason: blockReason } : {}),
      linked_mods: mapping?.linked_mods || linkedMods(raw ? { enName, language } : null, status),
      adapt_vars: mapping?.adapt_vars || adaptVars({ enName, language }),
      lines: mapping ? mapping.lines : [],
      analysis_step: mapping ? mapping.analysis_step : null,
      input_tables: mapping ? mapping.input_tables : [],
      produces: mapping ? mapping.produces : [],
      output_glob: mapping ? mapping.output_glob : null,
      canonical_output: mapping ? mapping.canonical_output || null : null,
      sample_project_output: activeStatus === 'ready' ? mapping.sample_project_output : null,
      deprecated: false,
    });
  }

  if (templates.length !== 82) fail(`模板数不是 82：${templates.length}`);
  const counts = templates.reduce((acc, item) => {
    acc[item.deps_status] = (acc[item.deps_status] || 0) + 1;
    return acc;
  }, {});
  if (counts.ready !== 16) fail(`ready 数不是 16：${counts.ready}`);
  if (counts.pending !== 65) fail(`pending 数不是 65：${counts.pending}`);
  if ((counts.pending_mapping || 0) !== 0) fail(`pending_mapping 数不是 0：${counts.pending_mapping || 0}`);
  if (counts.blocked_r453 !== 1) fail(`blocked_r453 数不是 1：${counts.blocked_r453}`);

  return {
    schema_version: 1,
    generated_from: {
      csv: `${FIGURE_ROOT}/_meta/bizard_index.csv`,
      report: `${FIGURE_ROOT}/_meta/r453_verification_report.json`,
    },
    templates,
  };
}

function registryText() {
  return `${JSON.stringify(buildRegistry(), null, 2)}\n`;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--check') {
    const actual = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const expected = registryText();
    if (actual !== expected) {
      fail('figure_templates.json 与 CSV/r453 证据不同步，请运行 build_figure_templates.cjs');
      return;
    }
    console.log('figure_templates.check=ok');
    return;
  }
  if (args.length !== 0) {
    fail('用法：node ops/build_figure_templates.cjs [--check]');
    return;
  }
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, registryText(), { encoding: 'utf8', mode: 0o644 });
  console.log(`figure_templates.generated=${templatesCount}`);
}

const templatesCount = buildRegistry().templates.length;

if (require.main === module) main();

module.exports = {
  buildRegistry,
  registryText,
};
