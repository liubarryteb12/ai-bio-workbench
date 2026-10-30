#!/usr/bin/env node
/** Generate real-data adapter scripts for single-figure layout verification. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  figureLayoutContract,
  buildAdaptedFigureSource,
} from '../BioanalysDesktop/server/figure_adapters.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ID = 'PRJ_AIMS_V3_20261027';
const LINES = new Set(['line1_bulk', 'line2_scrna', 'line3_spatial']);

const CASES = {
  fig_l2_pca: {
    lineId: 'line1_bulk',
    inputPath: 'data/line1_bulk/processed/pca_scores.tsv',
    adaptVars: {
      input_data: 'data/line1_bulk/processed/pca_scores.tsv',
      group_col: 'group',
    },
  },
  fig_l2_heatmap: {
    lineId: 'line1_bulk',
    inputPath: 'data/line1_bulk/processed/expr_genes.tsv',
    adaptVars: {
      input_data: 'data/line1_bulk/processed/expr_genes.tsv',
      row_col: 'gene',
      column_col: 'sample',
      value_col: 'expr',
      group_col: 'group',
    },
  },
  fig_l2_volcano: {
    lineId: 'line1_bulk',
    inputPath: 'data/line1_bulk/processed/deg_all.tsv',
    adaptVars: {
      input_data: 'data/line1_bulk/processed/deg_all.tsv',
      group_col: 'group',
      label_genes: ['ELOVL2'],
    },
  },
  fig_l1_groupedbar: {
    lineId: 'line1_bulk',
    inputPath: 'data/line1_bulk/processed/enrichment_gsea_go.tsv',
    adaptVars: {
      input_data: 'data/line1_bulk/processed/enrichment_gsea_go.tsv',
      x_col: 'Description',
      value_col: 'NES',
      group_col: 'ont',
    },
  },
  fig_l1_boxplot: {
    lineId: 'line1_bulk',
    inputPath: 'data/line1_bulk/processed/deg_all.tsv',
    adaptVars: {
      input_data: 'data/line1_bulk/processed/deg_all.tsv',
      value_col: 'log2FC',
    },
  },
  fig_l1_density: {
    lineId: 'line1_bulk',
    inputPath: 'data/line1_bulk/processed/expr_genes.tsv',
    adaptVars: {
      input_data: 'data/line1_bulk/processed/expr_genes.tsv',
    },
  },
  fig_l1_histogram: {
    lineId: 'line1_bulk',
    inputPath: 'data/line1_bulk/processed/expr_genes.tsv',
    adaptVars: {
      input_data: 'data/line1_bulk/processed/expr_genes.tsv',
    },
  },
  fig_l1_scatter: {
    lineId: 'line1_bulk',
    inputPath: 'data/line1_bulk/processed/ml_core_hub_genes.tsv',
    adaptVars: {
      input_data: 'data/line1_bulk/processed/ml_core_hub_genes.tsv',
      x_col: 'rf_importance',
      y_col: 'gbdt_importance',
      label_genes: ['CXCL16'],
    },
  },
  fig_l1_violin: {
    lineId: 'line1_bulk',
    inputPath: 'data/line1_bulk/processed/deg_all.tsv',
    adaptVars: {
      input_data: 'data/line1_bulk/processed/deg_all.tsv',
      value_col: 'log2FC',
    },
  },
  fig_l3_sankey: {
    lineId: 'line1_bulk',
    inputPath: 'data/line1_bulk/processed/wgcna_modules.tsv',
    adaptVars: {
      input_data: 'data/line1_bulk/processed/wgcna_modules.tsv',
      module_col: 'module',
    },
  },
  fig_l2p_dotplot: {
    lineId: 'line2_scrna',
    inputPath: 'data/line2_scrna/processed/target_gene_localization.tsv',
    adaptVars: {
      input_data: 'data/line2_scrna/processed/target_gene_localization.tsv',
      group_col: 'celltype',
    },
  },
  fig_l2p_volcano: {
    lineId: 'line2_scrna',
    inputPath: 'data/line2_scrna/processed/deg_all_by_celltype.tsv',
    adaptVars: {
      input_data: 'data/line2_scrna/processed/deg_all_by_celltype.tsv',
      group_col: 'celltype',
      label_genes: ['S100A8'],
    },
  },
  fig_l2p_umap: {
    lineId: 'line3_spatial',
    inputPath: 'data/line3_spatial/processed/spatial_dimred_human.h5ad',
    adaptVars: {
      input_data: 'data/line3_spatial/processed/spatial_dimred_human.h5ad',
      group_col: 'celltype',
    },
  },
  fig_l2_umap: {
    lineId: 'line2_scrna',
    inputPath: 'data/line2_scrna/processed/scrna_clustered.h5ad',
    adaptVars: {
      input_data: 'data/line2_scrna/processed/scrna_clustered.h5ad',
      group_col: 'leiden',
    },
  },
  fig_l2p_violin: {
    lineId: 'line2_scrna',
    inputPath: 'data/line2_scrna/processed/celltype_composition.tsv',
    adaptVars: {
      input_data: 'data/line2_scrna/processed/celltype_composition.tsv',
      group_col: 'celltype',
      value_col: 'prop',
    },
  },
};

function parseOutput(argv) {
  const index = argv.indexOf('--output');
  if (index < 0 || !argv[index + 1]) {
    throw new Error('usage: node ops/render_figure_layout_contracts.mjs --output <dir>');
  }
  return path.resolve(argv[index + 1]);
}

const outputDir = parseOutput(process.argv.slice(2));
const registry = JSON.parse(
  fs.readFileSync(path.join(REPO, 'src', 'figure_templates.json'), 'utf8'),
);
const templates = new Map(registry.templates.map((item) => [item.id, item]));
fs.mkdirSync(outputDir, { recursive: true });
const outputs = new Set();
const inputs = new Set();
for (const [templateId, testCase] of Object.entries(CASES)) {
  const template = templates.get(templateId);
  if (!template) throw new Error(`template missing: ${templateId}`);
  if (template.deps_status !== 'ready') throw new Error(`template not ready: ${templateId}`);
  if (!template.lines.includes(testCase.lineId)) {
    throw new Error(`template line mismatch: ${templateId}`);
  }
  if (!template.input_tables.some((name) => testCase.inputPath.endsWith(`/${name}`))) {
    throw new Error(`template input mismatch: ${templateId}`);
  }
  if (!template.canonical_output
    || template.canonical_output !== path.posix.basename(template.canonical_output)) {
    throw new Error(`canonical_output must be a basename: ${templateId}`);
  }
  if (outputs.has(template.canonical_output)) {
    throw new Error(`duplicate canonical_output: ${template.canonical_output}`);
  }
  const inputKey = `${templateId}:${testCase.lineId}:${testCase.inputPath}`;
  if (inputs.has(inputKey)) {
    throw new Error(`duplicate template input: ${templateId}`);
  }
  if (!path.posix.join(testCase.inputPath).startsWith(`data/${testCase.lineId}/`)) {
    throw new Error(`input leaves its line directory: ${templateId}`);
  }
  outputs.add(template.canonical_output);
  inputs.add(`${testCase.lineId}:${testCase.inputPath}`);
}

const manifest = [];
for (const [templateId, testCase] of Object.entries(CASES)) {
  const template = templates.get(templateId);
  if (!template) throw new Error(`template missing: ${templateId}`);
  const masterSource = fs.readFileSync(path.join(REPO, template.source), 'utf8');
  const source = buildAdaptedFigureSource({
    template,
    masterSource,
    inputPath: testCase.inputPath,
    projectId: PROJECT_ID,
    lineId: testCase.lineId,
    adaptVars: testCase.adaptVars,
  });
  const extension = template.language === 'python' ? '.py' : '.R';
  const filename = `${templateId}${extension}`;
  fs.writeFileSync(path.join(outputDir, filename), source, 'utf8');
  manifest.push({
    template_id: templateId,
    language: template.language,
    line_id: testCase.lineId,
    filename,
    canonical_output: template.canonical_output,
    output_dir: `figures/${testCase.lineId}`,
    output_png: `figures/${testCase.lineId}/${template.canonical_output}`,
    output_pdf: `figures/${testCase.lineId}/${path.posix.basename(
      template.canonical_output,
      path.posix.extname(template.canonical_output),
    )}.pdf`,
    output_object: `figures/${testCase.lineId}/${path.posix.basename(
      template.canonical_output,
      path.posix.extname(template.canonical_output),
    )}_plot.${template.language === 'python' ? 'pkl' : 'rds'}`,
    output_report: `figures/${testCase.lineId}/${path.posix.basename(
      template.canonical_output,
      path.posix.extname(template.canonical_output),
    )}_report.txt`,
    width_mm: template.figure_layout.width_mm,
    height_mm: template.figure_layout.height_mm,
    dpi: template.figure_layout.dpi,
    legend_position: template.figure_layout.legend_position,
    object_kind: template.language === 'python' ? 'pkl' : 'rds',
  });
}

fs.writeFileSync(
  path.join(outputDir, 'manifest.json'),
  `${JSON.stringify({ project_id: PROJECT_ID, figures: manifest }, null, 2)}\n`,
  'utf8',
);
console.log(`generated=${manifest.length} output=${outputDir}`);
