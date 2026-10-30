#!/usr/bin/env node
'use strict';

/**
 * Build the figure registry from project-owned catalog sources.
 *
 * The old registry was generated from a CSV plus an R 4.5.3 report. The current
 * reference package is a chart-code database, so the stable inputs are now:
 *   1. src/figure_sources/manifest.json (explicit catalog-to-template mapping)
 *   2. src/figure_sources/<template>.R|py (materialized reference code)
 *   3. src/figure_previews/<template>.png (reference or transparent sample preview)
 *
 * Non-ready inventory entries are preserved from the existing registry. Only
 * the explicit single-plot mappings are promoted or demoted here.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const REGISTRY_PATH = path.join(REPO, 'src', 'figure_templates.json');
const MANIFEST_PATH = path.join(REPO, 'src', 'figure_sources', 'manifest.json');
const CATALOG_DB = 'reference/05.可参考出图代码/图码对应库_交付包/图码对应库_交付包/chart_code_library.db';
const SOURCE_MANIFEST = 'src/figure_sources/manifest.json';
const READY_IDS = new Set([
  'fig_l1_boxplot',
  'fig_l1_density',
  'fig_l1_groupedbar',
  'fig_l1_histogram',
  'fig_l1_scatter',
  'fig_l1_violin',
  'fig_l2_heatmap',
  'fig_l2_pca',
  'fig_l2_umap',
  'fig_l2_volcano',
  'fig_l2p_dotplot',
  'fig_l2p_umap',
  'fig_l2p_violin',
  'fig_l2p_volcano',
  'fig_l3_sankey',
]);

const FIGURE_LAYOUTS = Object.freeze({
  fig_l2_pca: Object.freeze({ width_mm: 88, height_mm: 80, column: 'single', legend_position: 'right' }),
  fig_l2_heatmap: Object.freeze({ width_mm: 180, height_mm: 120, column: 'wide', legend_position: 'right' }),
  fig_l2_volcano: Object.freeze({ width_mm: 88, height_mm: 80, column: 'single', legend_position: 'right' }),
  fig_l2p_dotplot: Object.freeze({ width_mm: 88, height_mm: 60, column: 'single', legend_position: 'right' }),
  fig_l2p_volcano: Object.freeze({ width_mm: 88, height_mm: 80, column: 'single', legend_position: 'right' }),
  fig_l2p_umap: Object.freeze({ width_mm: 88, height_mm: 80, column: 'single', legend_position: 'right' }),
  fig_l1_groupedbar: Object.freeze({ width_mm: 88, height_mm: 60, column: 'single', legend_position: 'right' }),
  fig_l1_scatter: Object.freeze({ width_mm: 88, height_mm: 75, column: 'single', legend_position: 'right' }),
  fig_l1_boxplot: Object.freeze({ width_mm: 88, height_mm: 60, column: 'single', legend_position: 'none' }),
  fig_l1_density: Object.freeze({ width_mm: 88, height_mm: 60, column: 'single', legend_position: 'none' }),
  fig_l1_histogram: Object.freeze({ width_mm: 88, height_mm: 60, column: 'single', legend_position: 'none' }),
  fig_l1_violin: Object.freeze({ width_mm: 88, height_mm: 60, column: 'single', legend_position: 'none' }),
  fig_l2_umap: Object.freeze({ width_mm: 180, height_mm: 90, column: 'wide', legend_position: 'right' }),
  fig_l2p_violin: Object.freeze({ width_mm: 180, height_mm: 85, column: 'wide', legend_position: 'none' }),
  fig_l3_sankey: Object.freeze({ width_mm: 130, height_mm: 100, column: 'medium', legend_position: 'none' }),
});

function figureLayout(id) {
  const contract = FIGURE_LAYOUTS[id];
  if (!contract) throw new Error(`missing figure layout: ${id}`);
  if (!['none', 'right', 'top', 'inside'].includes(contract.legend_position)) {
    throw new Error(`invalid legend position: ${id}`);
  }
  return {
    width_mm: contract.width_mm,
    height_mm: contract.height_mm,
    min_width_mm: Math.round(contract.width_mm * 0.75),
    min_height_mm: Math.round(contract.height_mm * 0.75),
    dpi: 300,
    column: contract.column,
    legend_position: contract.legend_position,
  };
}

const STRING_LIST_VARS = new Set(['label_genes', 'axis_cols']);

const TEMPLATE_MAPPINGS = Object.freeze({
  fig_l2_heatmap: {
    lines: ['line1_bulk'],
    analysis_step: 'l1_ingest_prep',
    input_tables: ['expr_genes.tsv'],
    produces: ['custom_fig_l2_heatmap.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l2_heatmap.png',
    canonical_output: 'L2_heatmap_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/l1_04_topvar_heatmap.png',
    adapt_vars: {
      input_data: 'Project-local read-only input file path',
      row_col: 'Gene or feature column',
      column_col: 'Sample or observation column',
      value_col: 'Expression or score column',
      group_col: 'Sample group column',
    },
  },
  fig_l2_pca: {
    lines: ['line1_bulk'],
    analysis_step: 'l1_qc_pca',
    input_tables: ['pca_scores.tsv'],
    produces: ['custom_fig_l2_pca.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l2_pca.png',
    canonical_output: 'L2_pca_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/l1_02_pca.png',
    adapt_vars: {
      input_data: 'Project-local read-only input file path',
      group_col: 'Sample group column',
    },
  },
  fig_l2_volcano: {
    lines: ['line1_bulk'],
    analysis_step: 'l1_de_limma',
    input_tables: ['deg_all.tsv'],
    produces: ['custom_fig_l2_volcano.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l2_volcano.png',
    canonical_output: 'L2_volcano_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/l1_03_volcano_limma.png',
    adapt_vars: {
      input_data: 'Project-local read-only input file path',
      group_col: 'Comparison group column',
      label_genes: 'Genes to label; may be empty',
    },
  },
  fig_l2p_dotplot: {
    lines: ['line2_scrna'],
    analysis_step: 'l2_ko_localization',
    input_tables: ['target_gene_localization.tsv'],
    produces: ['custom_fig_l2p_dotplot.png'],
    output_glob: 'figures/line2_scrna/custom_fig_l2p_dotplot.png',
    canonical_output: 'dotplot__L2p_dotplot_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/l2_13_target_gene_dotplot.png',
    adapt_vars: {
      input_data: 'Project-local read-only input file path',
      group_col: 'Cell type or group column',
    },
  },
  fig_l2p_umap: {
    lines: ['line3_spatial'],
    analysis_step: 'l3_dimred_reduce',
    input_tables: ['spatial_dimred_human.h5ad'],
    produces: ['custom_fig_l2p_umap.png'],
    output_glob: 'figures/line3_spatial/custom_fig_l2p_umap.png',
    canonical_output: 'umap_L2p_umap_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line3_spatial/l3_human_06_umap_sample.png',
    adapt_vars: {
      input_data: 'Project-local read-only input file path',
      group_col: 'Cell type or cluster column',
    },
  },
  fig_l2p_volcano: {
    lines: ['line2_scrna'],
    analysis_step: 'l2_profile_deg',
    input_tables: ['deg_all_by_celltype.tsv'],
    produces: ['custom_fig_l2p_volcano.png'],
    output_glob: 'figures/line2_scrna/custom_fig_l2p_volcano.png',
    canonical_output: 'L2p_volcano_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/l2_08_deg_volcano_basal_keratinocyte.png',
    adapt_vars: {
      input_data: 'Project-local read-only input file path',
      group_col: 'Cell type column',
      label_genes: 'Genes to label; may be empty',
    },
  },
  fig_l1_groupedbar: {
    lines: ['line1_bulk'],
    analysis_step: 'l1_enrich_bulk',
    input_tables: ['enrichment_gsea_go.tsv'],
    produces: ['custom_fig_l1_groupedbar.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l1_groupedbar.png',
    canonical_output: 'L1_groupedbar_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_groupedbar.png',
    adapt_vars: {
      input_data: 'Project-local read-only input file path',
      x_col: 'Category column',
      value_col: 'Numeric value column',
      group_col: 'Facet or ontology column',
    },
  },
  fig_l1_scatter: {
    lines: ['line1_bulk'],
    analysis_step: 'l1_ml_hub',
    input_tables: ['ml_core_hub_genes.tsv'],
    produces: ['custom_fig_l1_scatter.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l1_scatter.png',
    canonical_output: 'L1_scatter_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_scatter.png',
    adapt_vars: {
      input_data: 'Project-local read-only input file path',
      x_col: 'X-axis numeric column',
      y_col: 'Y-axis numeric column',
      label_genes: 'Genes to label; may be empty',
    },
  },
  fig_l1_boxplot: {
    lines: ['line1_bulk'],
    analysis_step: 'l1_de_limma',
    input_tables: ['deg_all.tsv'],
    produces: ['custom_fig_l1_boxplot.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l1_boxplot.png',
    canonical_output: 'L1_boxplot_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_boxplot.png',
    adapt_vars: {
      input_data: 'Project-local read-only input file path',
      value_col: 'Effect-size or measurement column',
    },
  },
  fig_l1_density: {
    lines: ['line1_bulk'],
    analysis_step: 'l1_ingest_prep',
    input_tables: ['expr_genes.tsv'],
    produces: ['custom_fig_l1_density.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l1_density.png',
    canonical_output: 'L1_density_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_density.png',
    adapt_vars: {
      input_data: 'Project-local read-only input file path',
    },
  },
  fig_l1_histogram: {
    lines: ['line1_bulk'],
    analysis_step: 'l1_ingest_prep',
    input_tables: ['expr_genes.tsv'],
    produces: ['custom_fig_l1_histogram.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l1_histogram.png',
    canonical_output: 'L1_histogram_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_histogram.png',
    adapt_vars: {
      input_data: 'Project-local read-only input file path',
    },
  },
  fig_l1_violin: {
    lines: ['line1_bulk'],
    analysis_step: 'l1_de_limma',
    input_tables: ['deg_all.tsv'],
    produces: ['custom_fig_l1_violin.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l1_violin.png',
    canonical_output: 'L1_violin_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_violin.png',
    adapt_vars: {
      input_data: 'Project-local read-only input file path',
      value_col: 'Effect-size or measurement column',
    },
  },
  fig_l2_umap: {
    lines: ['line2_scrna'],
    analysis_step: 'l2_integrate_cluster',
    input_tables: ['scrna_clustered.h5ad'],
    produces: ['custom_fig_l2_umap.png'],
    output_glob: 'figures/line2_scrna/custom_fig_l2_umap.png',
    canonical_output: 'umap_L2_umap_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/custom_fig_l2_umap.png',
    language: 'python',
    linked_mods: ['l2_figures_scrna'],
    adapt_vars: {
      input_data: 'Project-local read-only input file path',
      group_col: 'Cell group or cluster column',
    },
  },
  fig_l2p_violin: {
    lines: ['line2_scrna'],
    analysis_step: 'l2_profile_composition',
    input_tables: ['celltype_composition.tsv'],
    produces: ['custom_fig_l2p_violin.png'],
    output_glob: 'figures/line2_scrna/custom_fig_l2p_violin.png',
    canonical_output: 'violin_L2p_violin_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/custom_fig_l2p_violin.png',
    adapt_vars: {
      input_data: 'Project-local read-only input file path',
      group_col: 'Cell type column',
      value_col: 'Composition proportion column',
    },
  },
  fig_l3_sankey: {
    lines: ['line1_bulk'],
    analysis_step: 'l1_de_wgcna',
    input_tables: ['wgcna_modules.tsv'],
    produces: ['custom_fig_l3_sankey.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l3_sankey.png',
    canonical_output: 'L3_sankey_verified.png',
    sample_project_output: 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l3_sankey.png',
    adapt_vars: {
      input_data: 'Project-local read-only input file path',
      module_col: 'Module column',
    },
  },
});

const ADAPT_VAR_DEFAULTS = Object.freeze({
  input_data: {
    type: 'string',
    required: true,
    default: null,
  },
  group_col: {
    type: 'string',
    required: true,
    default: 'group',
  },
  value_col: {
    type: 'string',
    required: true,
    default: null,
  },
  module_col: {
    type: 'string',
    required: true,
    default: 'module',
  },
  label_genes: {
    type: 'string_list',
    required: false,
    default: [],
  },
});

const ADAPT_VAR_OVERRIDES = Object.freeze({
  'fig_l2_heatmap.value_col': 'expr',
  'fig_l2_heatmap.column_col': 'sample',
  'fig_l2p_violin.value_col': 'prop',
  'fig_l2p_volcano.group_col': 'celltype',
  'fig_l2p_dotplot.group_col': 'celltype',
  'fig_l2p_umap.group_col': 'group',
  'fig_l1_groupedbar.value_col': 'NES',
  'fig_l1_groupedbar.x_col': 'Description',
  'fig_l1_groupedbar.group_col': 'ont',
  'fig_l1_scatter.x_col': 'rf_importance',
  'fig_l1_scatter.y_col': 'gbdt_importance',
  'fig_l1_boxplot.value_col': 'log2FC',
  'fig_l1_violin.value_col': 'log2FC',
  'fig_l3_sankey.module_col': 'module',
});

function adaptDeclaration(templateId, key, description) {
  const base = ADAPT_VAR_DEFAULTS[key] || {
    type: 'string',
    required: true,
    default: null,
  };
  const override = ADAPT_VAR_OVERRIDES[`${templateId}.${key}`];
  return {
    description,
    type: base.type,
    required: base.required,
    default: override ?? base.default,
  };
}

function fail(message) {
  console.error(message);
  process.exitCode = 2;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assertRelativePath(value, field) {
  const normalized = String(value || '').split('\\').join('/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)
    || normalized.split('/').includes('..') || !/^[A-Za-z0-9._/-]+$/.test(normalized)) {
    throw new Error(`${field} is not a safe project-relative path: ${value}`);
  }
  return normalized;
}

function buildRegistry() {
  const current = readJson(REGISTRY_PATH);
  const manifest = readJson(MANIFEST_PATH);
  const byTemplate = new Map((manifest.sources || []).map((item) => [item.template_id, item]));
  if (byTemplate.size !== READY_IDS.size) {
    throw new Error(`source manifest count ${byTemplate.size} != ready count ${READY_IDS.size}`);
  }

  const templates = current.templates.map((item) => {
    const mapping = TEMPLATE_MAPPINGS[item.id];
    const sourceEntry = byTemplate.get(item.id);
    if (mapping && sourceEntry) {
      const source = assertRelativePath(sourceEntry.source, `${item.id}.source`);
      const preview = assertRelativePath(sourceEntry.preview, `${item.id}.preview`);
      const sourceAbs = path.join(REPO, source);
      const previewAbs = path.join(REPO, preview);
      if (!fs.existsSync(sourceAbs)) throw new Error(`ready source missing: ${source}`);
      if (!fs.existsSync(previewAbs)) throw new Error(`ready preview missing: ${preview}`);
      const sourceSha = sha256(sourceAbs);
      const previewSha = sha256(previewAbs);
      if (sourceSha !== sourceEntry.source_sha256) {
        throw new Error(`source hash drift: ${item.id}`);
      }
      if (previewSha !== sourceEntry.preview_sha256) {
        throw new Error(`preview hash drift: ${item.id}`);
      }
      const adaptVars = Object.fromEntries(
        Object.entries(mapping.adapt_vars).map(([key, description]) => (
          [key, adaptDeclaration(item.id, key, description)]
        )),
      );
      return {
        ...item,
        language: mapping.language || item.language,
        source,
        source_sha256: sourceSha,
        preview,
        preview_sha256: previewSha,
        verified: true,
        deps_status: 'ready',
        linked_mods: mapping.linked_mods || item.linked_mods,
        adapt_vars: adaptVars,
        figure_layout: figureLayout(item.id),
        lines: mapping.lines,
        analysis_step: mapping.analysis_step,
        input_tables: mapping.input_tables,
        produces: mapping.produces,
        output_glob: mapping.output_glob,
        canonical_output: mapping.canonical_output,
        sample_project_output: mapping.sample_project_output,
        deprecated: false,
        catalog_id: sourceEntry.catalog_id,
        catalog_title: sourceEntry.catalog_title,
        catalog_page_url: sourceEntry.catalog_page_url,
        catalog_language: sourceEntry.catalog_language,
        source_match: sourceEntry.source_match,
      };
    }

    if (item.id === 'fig_l3_multipanel') {
      return {
        ...item,
        source: null,
        source_sha256: null,
        preview: null,
        preview_sha256: null,
        verified: false,
        deps_status: 'pending',
        lines: [],
        analysis_step: null,
        input_tables: [],
        produces: [],
        output_glob: null,
        canonical_output: null,
        sample_project_output: null,
        deprecated: true,
        pending_reason: 'reference/03出图规范 v3.0 forbids multi-panel composition',
        catalog_id: null,
        catalog_title: null,
        catalog_page_url: null,
        catalog_language: null,
        source_match: null,
      };
    }

    if (item.deps_status === 'ready') {
      return {
        ...item,
        source: null,
        source_sha256: null,
        preview: null,
        preview_sha256: null,
        verified: false,
        deps_status: 'pending_mapping',
        lines: [],
        analysis_step: null,
        input_tables: [],
        produces: [],
        output_glob: null,
        canonical_output: null,
        sample_project_output: null,
        catalog_id: null,
        catalog_title: null,
        catalog_page_url: null,
        catalog_language: null,
        source_match: null,
      };
    }

    return {
      ...item,
      catalog_id: item.catalog_id ?? null,
      catalog_title: item.catalog_title ?? null,
      catalog_page_url: item.catalog_page_url ?? null,
      catalog_language: item.catalog_language ?? null,
      source_match: item.source_match ?? null,
    };
  });

  const counts = templates.reduce((acc, item) => {
    acc[item.deps_status] = (acc[item.deps_status] || 0) + 1;
    return acc;
  }, {});
  if (templates.length !== 82) throw new Error(`template count ${templates.length} != 82`);
  if (counts.ready !== 15) throw new Error(`ready count ${counts.ready} != 15`);
  if (counts.pending !== 66) throw new Error(`pending count ${counts.pending} != 66`);
  if ((counts.pending_mapping || 0) !== 0) {
    throw new Error(`pending_mapping count ${counts.pending_mapping || 0} != 0`);
  }
  if (counts.blocked_r453 !== 1) throw new Error(`blocked count ${counts.blocked_r453} != 1`);

  return {
    schema_version: 1,
    generated_from: {
      database: CATALOG_DB,
      source_manifest: SOURCE_MANIFEST,
      source_match_policy: 'exact | analogous',
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
      fail('figure_templates.json is out of sync; run node ops/build_figure_templates.cjs');
      return;
    }
    console.log('figure_templates.check=ok');
    return;
  }
  if (args.length !== 0) {
    fail('usage: node ops/build_figure_templates.cjs [--check]');
    return;
  }
  fs.writeFileSync(REGISTRY_PATH, registryText(), { encoding: 'utf8', mode: 0o644 });
  console.log('figure_templates.generated=82');
}

if (require.main === module) main();

module.exports = {
  READY_IDS,
  TEMPLATE_MAPPINGS,
  buildRegistry,
  registryText,
};
