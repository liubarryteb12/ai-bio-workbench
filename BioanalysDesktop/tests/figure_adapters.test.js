import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const { buildAdaptedFigureSource } = await import('../server/figure_adapters.js');

const registry = JSON.parse(
  fs.readFileSync(path.join(REPO, 'src', 'figure_templates.json'), 'utf8'),
);
const registryById = new Map(
  registry.templates.map((item) => [item.id, item]),
);

const SUPPORTED_IDS = [
  'fig_l2_pca',
  'fig_l2_heatmap',
  'fig_l2_volcano',
  'fig_l2p_dotplot',
  'fig_l2p_volcano',
  'fig_l2p_umap',
  'fig_l1_groupedbar',
  'fig_l1_scatter',
  'fig_l1_boxplot',
  'fig_l1_density',
  'fig_l1_histogram',
  'fig_l1_violin',
  'fig_l2_umap',
  'fig_l3_multipanel',
  'fig_l2p_violin',
  'fig_l3_sankey',
];

const PROJECT_ID = 'PRJ_AIMS_V3_20261027';

const CASES = {
  fig_l2_pca: {
    lineId: 'line1_bulk',
    adaptVars: { input_data: 'data/line1_bulk/processed/pca_scores.tsv', group_col: 'group' },
    inputPath: 'data/line1_bulk/processed/pca_scores.tsv',
    truth: { columns: ['sample', 'group', 'PC1', 'PC2'], language: 'r' },
  },
  fig_l2_heatmap: {
    lineId: 'line1_bulk',
    adaptVars: {
      input_data: 'data/line1_bulk/processed/expr_genes.tsv',
      row_col: 'gene',
      column_col: 'sample',
      value_col: 'expr',
      group_col: 'group',
    },
    inputPath: 'data/line1_bulk/processed/expr_genes.tsv',
    truth: { columns: ['gene'], language: 'r' },
  },
  fig_l2_volcano: {
    lineId: 'line1_bulk',
    adaptVars: {
      input_data: 'data/line1_bulk/processed/deg_all.tsv',
      group_col: 'group',
      label_genes: ['ELOVL2'],
    },
    inputPath: 'data/line1_bulk/processed/deg_all.tsv',
    truth: { columns: ['gene', 'log2FC', 'adj_P_Val'], language: 'r' },
  },
  fig_l2p_dotplot: {
    lineId: 'line2_scrna',
    adaptVars: {
      input_data: 'data/line2_scrna/processed/target_gene_localization.tsv',
      group_col: 'celltype',
    },
    inputPath: 'data/line2_scrna/processed/target_gene_localization.tsv',
    truth: { columns: ['gene', 'celltype', 'pct_expressing'], language: 'python' },
  },
  fig_l2p_volcano: {
    lineId: 'line2_scrna',
    adaptVars: {
      input_data: 'data/line2_scrna/processed/deg_all_by_celltype.tsv',
      group_col: 'celltype',
      label_genes: ['S100A8'],
    },
    inputPath: 'data/line2_scrna/processed/deg_all_by_celltype.tsv',
    truth: { columns: ['celltype', 'gene_symbol', 'log2fc', 'pvals_adj'], language: 'python' },
  },
  fig_l2p_umap: {
    lineId: 'line3_spatial',
    adaptVars: {
      input_data: 'data/line3_spatial/processed/spatial_dimred_human.h5ad',
      group_col: 'celltype',
    },
    inputPath: 'data/line3_spatial/processed/spatial_dimred_human.h5ad',
    truth: { extension: '.h5ad', language: 'python' },
  },
  fig_l1_groupedbar: {
    lineId: 'line1_bulk',
    adaptVars: {
      input_data: 'data/line1_bulk/processed/enrichment_gsea_go.tsv',
      x_col: 'Description',
      value_col: 'NES',
      group_col: 'ont',
    },
    inputPath: 'data/line1_bulk/processed/enrichment_gsea_go.tsv',
    truth: { columns: ['Description', 'NES', 'ont'], language: 'r' },
  },
  fig_l1_scatter: {
    lineId: 'line1_bulk',
    adaptVars: {
      input_data: 'data/line1_bulk/processed/ml_core_hub_genes.tsv',
      x_col: 'rf_importance',
      y_col: 'gbdt_importance',
      label_genes: ['CXCL16'],
    },
    inputPath: 'data/line1_bulk/processed/ml_core_hub_genes.tsv',
    truth: { columns: ['gene', 'rf_importance', 'gbdt_importance'], language: 'r' },
  },
  fig_l1_boxplot: {
    lineId: 'line1_bulk',
    adaptVars: {
      input_data: 'data/line1_bulk/processed/deg_all.tsv',
      value_col: 'log2FC',
    },
    inputPath: 'data/line1_bulk/processed/deg_all.tsv',
    truth: { columns: ['gene', 'log2FC', 'adj_P_Val'], language: 'r' },
  },
  fig_l1_density: {
    lineId: 'line1_bulk',
    adaptVars: { input_data: 'data/line1_bulk/processed/expr_genes.tsv' },
    inputPath: 'data/line1_bulk/processed/expr_genes.tsv',
    truth: { columns: ['gene'], language: 'r' },
  },
  fig_l1_histogram: {
    lineId: 'line1_bulk',
    adaptVars: { input_data: 'data/line1_bulk/processed/expr_genes.tsv' },
    inputPath: 'data/line1_bulk/processed/expr_genes.tsv',
    truth: { columns: ['gene'], language: 'r' },
  },
  fig_l1_violin: {
    lineId: 'line1_bulk',
    adaptVars: {
      input_data: 'data/line1_bulk/processed/deg_all.tsv',
      value_col: 'log2FC',
    },
    inputPath: 'data/line1_bulk/processed/deg_all.tsv',
    truth: { columns: ['gene', 'log2FC', 'adj_P_Val'], language: 'r' },
  },
  fig_l2_umap: {
    lineId: 'line2_scrna',
    adaptVars: {
      input_data: 'data/line2_scrna/processed/scrna_clustered.h5ad',
      group_col: 'leiden',
    },
    inputPath: 'data/line2_scrna/processed/scrna_clustered.h5ad',
    truth: { extension: '.h5ad', language: 'python' },
  },
  fig_l3_multipanel: {
    lineId: 'line1_bulk',
    adaptVars: {
      input_data: 'data/line1_bulk/processed/external_validation_preds.tsv',
      group_col: 'true',
      value_col: 'prob_LS',
    },
    inputPath: 'data/line1_bulk/processed/external_validation_preds.tsv',
    truth: { columns: ['true', 'pred', 'prob_LS'], language: 'r' },
  },
  fig_l2p_violin: {
    lineId: 'line2_scrna',
    adaptVars: {
      input_data: 'data/line2_scrna/processed/celltype_composition.tsv',
      group_col: 'celltype',
      value_col: 'prop',
    },
    inputPath: 'data/line2_scrna/processed/celltype_composition.tsv',
    truth: { columns: ['celltype', 'prop'], language: 'python' },
  },
  fig_l3_sankey: {
    lineId: 'line1_bulk',
    adaptVars: {
      input_data: 'data/line1_bulk/processed/wgcna_modules.tsv',
      module_col: 'module',
    },
    inputPath: 'data/line1_bulk/processed/wgcna_modules.tsv',
    truth: { columns: ['gene', 'module'], language: 'r' },
  },
};

function readHeader(relativePath) {
  const absolute = path.join(REPO, 'local_projects', PROJECT_ID, relativePath);
  return fs.readFileSync(absolute, 'utf8').split('\n')[0].split('\t');
};

function buildSource(templateId) {
  const testCase = CASES[templateId];
  return buildAdaptedFigureSource({
    template: registryById.get(templateId),
    masterSource: fs.readFileSync(path.join(REPO, registryById.get(templateId).source), 'utf8'),
    inputPath: testCase.inputPath,
    projectId: PROJECT_ID,
    lineId: testCase.lineId,
    adaptVars: testCase.adaptVars,
  });
}

test('all ready templates have real project inputs with expected extensions', () => {
  assert.deepEqual(
    registry.templates.filter((item) => item.deps_status === 'ready').map((item) => item.id).sort(),
    [...SUPPORTED_IDS].sort(),
  );
  for (const templateId of SUPPORTED_IDS) {
    const template = registryById.get(templateId);
    const inputPath = CASES[templateId].inputPath;
    assert.ok(template.input_tables.some((name) => inputPath.endsWith(`/${name}`)));
    const extension = path.posix.extname(inputPath);
    if (CASES[templateId].truth.extension === '.h5ad') {
      assert.equal(extension, '.h5ad');
    } else {
      assert.equal(extension, '.tsv');
      const columns = readHeader(inputPath);
      for (const column of CASES[templateId].truth.columns) {
        assert.ok(columns.includes(column), `${templateId}: ${column} missing from input header`);
      }
    }
  }
});

test('supported figures keep the master source and bind real input and canonical output', () => {
  for (const templateId of SUPPORTED_IDS) {
    const masterSource = fs.readFileSync(
      path.join(REPO, registryById.get(templateId).source), 'utf8',
    );
    const template = registryById.get(templateId);
    const source = buildSource(templateId);
    assert.ok(
      source.includes(masterSource),
      `${templateId}: adapted source must retain the master bytes`,
    );
    assert.ok(
      source.includes(CASES[templateId].inputPath),
      `${templateId}: real project-relative input path missing`,
    );
    assert.ok(
      source.includes(template.canonical_output),
      `${templateId}: canonical output missing`,
    );
    assert.equal(source.includes('\r\n'), false, `${templateId}: source must remain LF`);
  }
});

test('real-data adapter exits before the retained master source can execute', () => {
  for (const templateId of SUPPORTED_IDS) {
    const template = registryById.get(templateId);
    const masterSource = fs.readFileSync(path.join(REPO, template.source), 'utf8');
    const source = buildSource(templateId);
    const masterIndex = source.indexOf(masterSource);
    assert.ok(masterIndex > 0, `${templateId}: master source must remain auditable`);
    if (template.language === 'r') {
      const exitIndex = source.indexOf('quit(status = 0)');
      assert.ok(exitIndex > 0 && exitIndex < masterIndex, `${templateId}: R master must be unreachable`);
    } else {
      const exitIndex = source.indexOf('raise SystemExit(0)');
      assert.ok(exitIndex > 0 && exitIndex < masterIndex, `${templateId}: Python master must be unreachable`);
    }
  }
});

test('R adapted sources declare the BIOANALYS_SEED contract', () => {
  const rIds = SUPPORTED_IDS.filter((templateId) => registryById.get(templateId).language === 'r');
  assert.equal(rIds.length, 11);
  for (const templateId of rIds) {
    const source = buildSource(templateId);
    assert.match(source, /BIOANALYS_SEED/);
    assert.match(source, /seed_value\s*<-\s*Sys\.getenv\("BIOANALYS_SEED", unset\s*=\s*""\)/);
    assert.match(source, /if\s*\(\s*nchar\(seed_value\)\s*==\s*0\s*\)\s*quit\(status\s*=\s*3\)/);
    assert.doesNotMatch(source, /adapt_vars\s*<-\s*list\([\s\S]*?,\s*\)/);
  }
});

test('Python sources choose readers by the real input type', () => {
  const dotplot = buildSource('fig_l2p_dotplot');
  assert.match(dotplot, /pd\.read_csv\(\s*input_data,\s*sep\s*=\s*"\\t"/);
  assert.ok(!dotplot.includes('scanpy.read_h5ad('), 'dotplot uses a TSV, not an h5ad object');

  const umap = buildSource('fig_l2p_umap');
  assert.match(umap, /sc\.read_h5ad\(input_data\)/);
  assert.ok(!umap.includes('pd.read_csv('), 'umap input is an h5ad object');
});

test('unknown ready templates fail closed', () => {
  const template = registryById.get('fig_l2_pca');
  assert.throws(
    () => buildAdaptedFigureSource({
      template: { ...template, id: 'fig_unknown_ready' },
      masterSource: fs.readFileSync(path.join(REPO, template.source), 'utf8'),
      inputPath: CASES.fig_l2_pca.inputPath,
      projectId: PROJECT_ID,
      lineId: 'line1_bulk',
      adaptVars: CASES.fig_l2_pca.adaptVars,
    }),
    /未知 ready 图模板/,
  );
});

test('project, line and input path boundaries reject cross-context values', () => {
  const base = CASES.fig_l2_pca;
  const template = registryById.get('fig_l2_pca');
  const masterSource = fs.readFileSync(path.join(REPO, template.source), 'utf8');
  const call = (overrides = {}) => buildAdaptedFigureSource({
    template,
    masterSource,
    inputPath: base.inputPath,
    projectId: PROJECT_ID,
    lineId: 'line1_bulk',
    adaptVars: base.adaptVars,
    ...overrides,
  });

  assert.throws(
    () => call({ inputPath: 'local_projects/PRJ_OTHER/figures/line1_bulk/pca.tsv' }),
    /inputPath.*跨项目|跨项目.*inputPath/,
  );
  assert.throws(() => call({ projectId: 'bad id' }), /projectId/);
  assert.throws(() => call({ lineId: 'line2_scrna' }), /lineId.*跨线|跨线.*lineId/);
  assert.throws(() => call({ lineId: 'not_a_line' }), /lineId/);
  assert.throws(() => call({ inputPath: 'data/line2_scrna/processed/deg_all_by_celltype.tsv' }), /inputPath.*跨线|跨线.*inputPath/);
  assert.throws(() => call({ inputPath: '../PRJ_OTHER/data/line1_bulk/processed/pca_scores.tsv' }), /inputPath.*跨项目|跨项目.*inputPath/);
  assert.throws(() => call({ inputPath: '/mnt/ssd/bio_data/projects/PRJ_AIMS_V3_20261027/data/line1_bulk/processed/pca_scores.tsv' }), /inputPath.*相对路径|相对路径.*inputPath/);
  assert.throws(() => call({ inputPath: "data/line1_bulk/processed/x.tsv';touch" }), /inputPath.*非法字符/);
  assert.throws(() => call({ adaptVars: { ...base.adaptVars, input_data: 'data/line2_scrna/processed/x.tsv' } }), /跨线/);
});

test('artifact paths fail closed before entering generated code', () => {
  const template = registryById.get('fig_l2_pca');
  const masterSource = fs.readFileSync(path.join(REPO, template.source), 'utf8');
  assert.throws(
    () => buildAdaptedFigureSource({
      template: { ...template, canonical_output: "x'; touch /tmp/pwn; #" },
      masterSource,
      inputPath: CASES.fig_l2_pca.inputPath,
      projectId: PROJECT_ID,
      lineId: 'line1_bulk',
      adaptVars: CASES.fig_l2_pca.adaptVars,
    }),
    /canonical_output/,
  );
});

const CANDIDATE_ADAPTERS = {
  fig_l1_groupedbar: {
    source: 'reference/05.可参考出图代码/_meta/R453_compat/L1_rest_code.R',
    language: 'r',
    lineId: 'line1_bulk',
    inputPath: 'data/line1_bulk/processed/enrichment_gsea_go.tsv',
    canonicalOutput: 'L1_groupedbar_verified.png',
    adaptVars: {
      input_data: 'data/line1_bulk/processed/enrichment_gsea_go.tsv',
      x_col: 'Description',
      value_col: 'NES',
      group_col: 'ont',
    },
    marker: 'groupedbar',
  },
  fig_l1_scatter: {
    source: 'reference/05.可参考出图代码/_meta/R453_compat/L1_rest_code.R',
    language: 'r',
    lineId: 'line1_bulk',
    inputPath: 'data/line1_bulk/processed/ml_core_hub_genes.tsv',
    canonicalOutput: 'L1_scatter_verified.png',
    adaptVars: {
      input_data: 'data/line1_bulk/processed/ml_core_hub_genes.tsv',
      x_col: 'rf_importance',
      y_col: 'gbdt_importance',
      label_genes: ['CXCL16'],
    },
    marker: 'scatter',
  },
  fig_l1_boxplot: {
    source: 'reference/05.可参考出图代码/_meta/R453_compat/L1_boxplot_code.R',
    language: 'r',
    lineId: 'line1_bulk',
    inputPath: 'data/line1_bulk/processed/deg_all.tsv',
    canonicalOutput: 'L1_boxplot_verified.png',
    adaptVars: {
      input_data: 'data/line1_bulk/processed/deg_all.tsv',
      value_col: 'log2FC',
    },
    marker: 'boxplot',
  },
  fig_l1_density: {
    source: 'reference/05.可参考出图代码/_meta/R453_compat/L1_rest_code.R',
    language: 'r',
    lineId: 'line1_bulk',
    inputPath: 'data/line1_bulk/processed/expr_genes.tsv',
    canonicalOutput: 'L1_density_verified.png',
    adaptVars: { input_data: 'data/line1_bulk/processed/expr_genes.tsv' },
    marker: 'density',
  },
  fig_l1_histogram: {
    source: 'reference/05.可参考出图代码/_meta/R453_compat/L1_rest_code.R',
    language: 'r',
    lineId: 'line1_bulk',
    inputPath: 'data/line1_bulk/processed/expr_genes.tsv',
    canonicalOutput: 'L1_histogram_verified.png',
    adaptVars: { input_data: 'data/line1_bulk/processed/expr_genes.tsv' },
    marker: 'histogram',
  },
  fig_l1_violin: {
    source: 'reference/05.可参考出图代码/_meta/R453_compat/L1_violin_code.R',
    language: 'r',
    lineId: 'line1_bulk',
    inputPath: 'data/line1_bulk/processed/deg_all.tsv',
    canonicalOutput: 'L1_violin_verified.png',
    adaptVars: {
      input_data: 'data/line1_bulk/processed/deg_all.tsv',
      value_col: 'log2FC',
    },
    marker: 'violin',
  },
  fig_l2_umap: {
    source: 'reference/05.可参考出图代码/L2_组学常用图/L2p_umap_code.py',
    language: 'python',
    lineId: 'line2_scrna',
    inputPath: 'data/line2_scrna/processed/scrna_clustered.h5ad',
    canonicalOutput: 'umap_L2p_umap_verified.png',
    adaptVars: {
      input_data: 'data/line2_scrna/processed/scrna_clustered.h5ad',
      group_col: 'leiden',
    },
    marker: 'umap',
  },
  fig_l3_multipanel: {
    source: 'reference/05.可参考出图代码/L3_高级组合图/L3_multipanel_code.R',
    language: 'r',
    lineId: 'line1_bulk',
    inputPath: 'data/line1_bulk/processed/external_validation_preds.tsv',
    canonicalOutput: 'L3_multipanel_verified.png',
    adaptVars: {
      input_data: 'data/line1_bulk/processed/external_validation_preds.tsv',
      group_col: 'true',
      value_col: 'prob_LS',
    },
    marker: 'multipanel',
  },
  fig_l2p_violin: {
    source: 'reference/05.可参考出图代码/L2_组学常用图/L2p_violin_code.py',
    language: 'python',
    lineId: 'line2_scrna',
    inputPath: 'data/line2_scrna/processed/celltype_composition.tsv',
    canonicalOutput: 'figures/violin_L2p_violin_verified.png',
    adaptVars: {
      input_data: 'data/line2_scrna/processed/celltype_composition.tsv',
      group_col: 'celltype',
      value_col: 'prop',
    },
    marker: 'violin',
  },
  fig_l3_sankey: {
    source: 'reference/05.可参考出图代码/_meta/R453_compat/L3_sankey_code.R',
    language: 'r',
    lineId: 'line1_bulk',
    inputPath: 'data/line1_bulk/processed/wgcna_modules.tsv',
    canonicalOutput: 'L3_sankey_verified.png',
    adaptVars: {
      input_data: 'data/line1_bulk/processed/wgcna_modules.tsv',
      module_col: 'module',
    },
    marker: 'sankey',
  },
};

test('remaining figure templates build real-data adapters before promotion', () => {
  for (const [templateId, candidate] of Object.entries(CANDIDATE_ADAPTERS)) {
    const base = registryById.get(templateId);
    const template = {
      ...base,
      source: candidate.source,
      source_sha256: 'a'.repeat(64),
      canonical_output: candidate.canonicalOutput,
      language: candidate.language,
      lines: [candidate.lineId],
      adapt_vars: Object.fromEntries(
        Object.keys(candidate.adaptVars).map((key) => [key, key]),
      ),
    };
    const source = buildAdaptedFigureSource({
      template,
      masterSource: fs.readFileSync(path.join(REPO, candidate.source), 'utf8'),
      inputPath: candidate.inputPath,
      projectId: PROJECT_ID,
      lineId: candidate.lineId,
      adaptVars: candidate.adaptVars,
    });
    assert.match(source, new RegExp(`ADAPT_REAL_INPUT_OK ${candidate.marker}`), templateId);
    assert.ok(source.includes(candidate.canonicalOutput), templateId);
    assert.ok(source.includes('Retained master source'), templateId);
  }
});
