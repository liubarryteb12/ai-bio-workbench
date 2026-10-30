import crypto from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const {
  buildAdaptedFigureSource,
  figureLayoutContract,
} = await import('../server/figure_adapters.js');
const { buildTaskScript } = await import('../server/task.js');

const registry = JSON.parse(
  fs.readFileSync(path.join(REPO, 'src', 'figure_templates.json'), 'utf8'),
);
const registryById = new Map(
  registry.templates.map((item) => [item.id, item]),
);

const TMP_ROOT = path.join(HERE, '.tmp-tests');

function makeTempDir(prefix) {
  const dir = path.join(TMP_ROOT, `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function decodeMasterBlock(source) {
  const lines = source.split('\n').filter((line) => line.startsWith('# MASTER-B64: '));
  assert.ok(lines.length > 0, 'master base64 block missing');
  const encoded = lines.map((line) => line.slice('# MASTER-B64: '.length)).join('');
  return Buffer.from(encoded, 'base64');
}

const hasPython = spawnSync('python3', ['--version']).status === 0;
const hasR = spawnSync('Rscript', ['--version']).status === 0;

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
    truth: {
      columns: ['gene', 'rf_importance', 'gbdt_importance', 'p_value', 'importance_rank'],
      language: 'r',
    },
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

const EXPECTED_SIZE_CONTRACTS = {
  fig_l2_pca: { width_mm: 88, height_mm: 80, column: 'single' },
  fig_l2_heatmap: { width_mm: 180, height_mm: 120, column: 'wide' },
  fig_l2_volcano: { width_mm: 88, height_mm: 80, column: 'single' },
  fig_l2p_dotplot: { width_mm: 88, height_mm: 60, column: 'single' },
  fig_l2p_volcano: { width_mm: 88, height_mm: 80, column: 'single' },
  fig_l2p_umap: { width_mm: 88, height_mm: 80, column: 'single' },
  fig_l1_groupedbar: { width_mm: 88, height_mm: 60, column: 'single' },
  fig_l1_scatter: { width_mm: 88, height_mm: 75, column: 'single' },
  fig_l1_boxplot: { width_mm: 88, height_mm: 60, column: 'single' },
  fig_l1_density: { width_mm: 88, height_mm: 60, column: 'single' },
  fig_l1_histogram: { width_mm: 88, height_mm: 60, column: 'single' },
  fig_l1_violin: { width_mm: 88, height_mm: 60, column: 'single' },
  fig_l2_umap: { width_mm: 180, height_mm: 90, column: 'wide' },
  fig_l2p_violin: { width_mm: 180, height_mm: 85, column: 'wide' },
  fig_l3_sankey: { width_mm: 130, height_mm: 100, column: 'medium' },
};

const EXPECTED_LEGEND_POSITIONS = {
  fig_l2_pca: 'right',
  fig_l2_heatmap: 'right',
  fig_l2_volcano: 'right',
  fig_l2p_dotplot: 'right',
  fig_l2p_volcano: 'right',
  fig_l2p_umap: 'right',
  fig_l1_groupedbar: 'right',
  fig_l1_scatter: 'right',
  fig_l1_boxplot: 'none',
  fig_l1_density: 'none',
  fig_l1_histogram: 'none',
  fig_l1_violin: 'none',
  fig_l2_umap: 'right',
  fig_l2p_violin: 'none',
  fig_l3_sankey: 'none',
};

function derivedLegendPosition(source, language) {
  if (language === 'r') {
    const matches = [...source.matchAll(/legend\.position\s*=\s*"([^"]+)"/g)]
      .map((item) => item[1]);
    return matches.length ? matches.at(-1) : 'none';
  }
  const legends = [...source.matchAll(/ax\.legend\(\s*([\s\S]*?)\n\s*\)/g)];
  if (!legends.length) return 'none';
  const positions = legends.map((match) => {
    const anchor = match[1].match(/bbox_to_anchor=\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
    if (!anchor) return 'inside';
    const x = Number(anchor[1]);
    const y = Number(anchor[2]);
    if (y > 1) return 'top';
    if (x > 1) return 'right';
    return 'inside';
  });
  assert.equal(new Set(positions).size, 1, 'Python legends must use one position');
  return positions[0];
}

test('all ready figure templates lock the physical size declared by their source', () => {
  assert.deepEqual(
    Object.fromEntries(
      SUPPORTED_IDS.map((id) => {
        const layout = figureLayoutContract(registryById.get(id));
        return [id, {
          width_mm: layout.width_mm,
          height_mm: layout.height_mm,
          column: layout.column,
        }];
      }),
    ),
    EXPECTED_SIZE_CONTRACTS,
  );

  for (const templateId of SUPPORTED_IDS) {
    const contract = EXPECTED_SIZE_CONTRACTS[templateId];
    const template = registryById.get(templateId);
    const source = buildSource(templateId);
    const adaptedPrefix = source.split('# Retained master source')[0];
    const contractComment = [
      '# Figure-Contract:',
      `width_mm=${contract.width_mm};`,
      `height_mm=${contract.height_mm};`,
      `dpi=${template.figure_layout.dpi};`,
      `column=${contract.column}`,
    ].join(' ');

    assert.ok(
      adaptedPrefix.includes(contractComment),
      `${templateId}: missing physical size contract`,
    );
    assert.match(adaptedPrefix, /BIOANALYS_LAYOUT_PRESERVE_FIGSIZE/);
    assert.match(adaptedPrefix, /BIOANALYS_LAYOUT_FIXED_CANVAS/);
    assert.doesNotMatch(adaptedPrefix, /bbox_inches\s*=\s*["']tight["']/);
    assert.doesNotMatch(adaptedPrefix, /loc\s*=\s*["']best["']/);

    if (template.language === 'r') {
      assert.match(
        adaptedPrefix,
        new RegExp(
          `width_mm\\s*=\\s*width_mm,\\s*height_mm\\s*=\\s*height_mm`,
        ),
        `${templateId}: R save size does not match the reference`,
      );
    } else {
      assert.match(
        adaptedPrefix,
        new RegExp(
          `fig\\.set_size_inches\\(width_mm\\s*/\\s*25\\.4,\\s*height_mm\\s*/\\s*25\\.4\\)`,
        ),
        `${templateId}: Python figure size does not match the reference`,
      );
      assert.match(
        adaptedPrefix,
        /def bioanalys_save_single\(fig, path, dpi=300, template_id="unknown", dims="", stats=""[^)]*\):[\s\S]*?fig\.savefig\(target,\s*dpi=dpi,\s*bbox_inches=None\)/,
        `${templateId}: Python export helper must keep the fixed canvas`,
      );
      assert.match(
        adaptedPrefix,
        /bioanalys_save_single\(\s*fig, output_file, dpi=dpi, template_id=/,
        `${templateId}: Python save must keep the fixed canvas`,
      );
    }
  }
});

test('ready templates report the legend position used by generated code', () => {
  for (const templateId of SUPPORTED_IDS) {
    const template = registryById.get(templateId);
    const expected = EXPECTED_LEGEND_POSITIONS[templateId];
    assert.equal(
      template.figure_layout.legend_position,
      expected,
      `${templateId}: registry legend position drift`,
    );
    const adaptedPrefix = buildSource(templateId).split('# Retained master source')[0];
    const declarationPattern = template.language === 'r'
      ? /^legend_position\s*<-\s*"([^"]+)"$/m
      : /^legend_position\s*=\s*"([^"]+)"$/m;
    const declaration = adaptedPrefix.match(declarationPattern);
    assert.ok(declaration, `${templateId}: generated legend_position missing`);
    assert.equal(declaration[1], expected, `${templateId}: generated legend position drift`);
    assert.equal(
      derivedLegendPosition(adaptedPrefix, template.language),
      expected,
      `${templateId}: generated legend call does not match report metadata`,
    );
    assert.doesNotMatch(adaptedPrefix, /legend_position=outside/);
    if (template.language === 'r') {
      assert.match(adaptedPrefix, /paste0\("legend_position=", legend_position\)/);
    } else {
      assert.match(adaptedPrefix, /f"legend_position=\{legend_position\}"/);
    }
  }
});

test('adapted task copies canonical output from figures line directory', () => {
  const script = buildTaskScript({
    projectId: PROJECT_ID,
    lineId: 'line2_scrna',
    step: 'adapt_fig_l2p_dotplot',
    inputs: [],
    outputs: [`/mnt/ssd/bio_data/projects/${PROJECT_ID}/line2_scrna/figures/custom_fig_l2p_dotplot.png`],
    seed: 42,
    adapted: true,
    scriptPath: `/mnt/ssd/bio_data/projects/${PROJECT_ID}/line2_scrna/scripts/adapt_fig_l2p_dotplot.py`,
    language: 'python',
    canonicalOutput: 'dotplot__L2p_dotplot_verified.png',
  });
  assert.match(
    script,
    new RegExp(`/line2_scrna/scripts/figures/line2_scrna/dotplot__L2p_dotplot_verified\\.png`),
  );
  assert.doesNotMatch(script, /figures\/figures/);
  assert.doesNotMatch(script, /line2_scrna\/figures\/line2_scrna\/figures/);
});

test('R layout autoload normalizes reference millimetres before preserving size', () => {
  const rprofile = fs.readFileSync(
    path.join(REPO, 'ops', 'layout_autoload', 'Rprofile'),
    'utf8',
  );
  assert.match(rprofile, /mm\s*=\s*value\s*\/\s*25\.4/);
  assert.match(rprofile, /BIOANALYS_LAYOUT_PRESERVE_FIGSIZE/);
  assert.doesNotMatch(rprofile, /max\(cur_w,\s*tpl\[1\]\)/);
  assert.doesNotMatch(rprofile, /max\(cur_h,\s*tpl\[2\]\)/);
});

test('ready canonical outputs are line-relative basenames', () => {
  for (const templateId of SUPPORTED_IDS) {
    const template = registryById.get(templateId);
    assert.equal(
      template.canonical_output,
      path.posix.basename(template.canonical_output),
      `${templateId}: canonical_output must omit figures/<line>/`,
    );
  }
});

test('generated adapters add exactly one figures and line prefix', () => {
  for (const templateId of SUPPORTED_IDS) {
    const expectedPath = `figures/${CASES[templateId].lineId}/${
      registryById.get(templateId).canonical_output
    }`;
    const source = buildSource(templateId);
    const matches = [...source.matchAll(/^output_file\s*(?:<-|=)\s*"([^"]+)"$/gm)]
      .map((item) => item[1]);
    assert.equal(matches.length, 1, `${templateId}: output_file declaration missing`);
    const [generatedPath] = matches;
    assert.equal(
      generatedPath,
      expectedPath,
      `${templateId}: output path must add figures/<line>/ exactly once`,
    );
  }
});

test('adapters reject canonical outputs that already carry a figures prefix', () => {
  const template = registryById.get('fig_l2_pca');
  const masterSource = fs.readFileSync(path.join(REPO, template.source), 'utf8');
  assert.throws(
    () => buildAdaptedFigureSource({
      template: { ...template, canonical_output: 'figures/line1_bulk/L2_pca_verified.png' },
      masterSource,
      inputPath: CASES.fig_l2_pca.inputPath,
      projectId: PROJECT_ID,
      lineId: 'line1_bulk',
      adaptVars: CASES.fig_l2_pca.adaptVars,
    }),
    /canonical_output/,
  );
});

test('adapted single plots use title-free themes and complete edge fitting', () => {
  for (const templateId of SUPPORTED_IDS) {
    const template = registryById.get(templateId);
    const adaptedPrefix = buildSource(templateId).split('# Retained master source')[0];
    assert.doesNotMatch(adaptedPrefix, /rotation\s*=\s*45/);
    assert.doesNotMatch(adaptedPrefix, /ggtitle\s*\(/);
    assert.doesNotMatch(adaptedPrefix, /labs\s*\([^)]*title\s*=/s);
    assert.match(adaptedPrefix, /plot_title=empty/);
    if (template.language === 'r') {
      assert.match(
        adaptedPrefix,
        /plot\.title\s*=\s*ggplot2::element_blank\(\)/,
        `${templateId}: R title must be blank`,
      );
      assert.match(
        adaptedPrefix,
        /bioanalys_export_ggplot <- function\([\s\S]*?saveRDS\(plot_obj, paths\$rds/,
        `${templateId}: R three-file export helper missing`,
      );
    } else {
      assert.match(
        adaptedPrefix,
        /ax\.set_title\(""\)/,
        `${templateId}: Python title must be blank`,
      );
      assert.match(
        adaptedPrefix,
        /ax\.xaxis\.label[\s\S]*?ax\.yaxis\.label[\s\S]*?extra_ax\.get_legend\(\)/,
        `${templateId}: edge fitting must include axis labels and legends`,
      );
      assert.match(
        adaptedPrefix,
        /bioanalys_save_single\(\s*fig, output_file, dpi=dpi, template_id=/,
        `${templateId}: Python fixed-canvas export missing`,
      );
      if ([
        'fig_l2p_dotplot',
        'fig_l2p_volcano',
        'fig_l2p_umap',
        'fig_l2_umap',
      ].includes(templateId)) {
        assert.match(
          adaptedPrefix,
          /loc="upper left",\s*bbox_to_anchor=\(1\.02,\s*1\.0\)/,
          `${templateId}: legend must be outside the axis frame`,
        );
      }
      if (templateId === 'fig_l2p_volcano') {
        assert.match(
          adaptedPrefix,
          /textwrap\.fill\(str\(group\),\s*width=10\)/,
          'volcano legend labels must wrap instead of widening beyond the canvas',
        );
        assert.match(
          adaptedPrefix,
          /handlelength=1\.0[\s\S]*?columnspacing=0\.8/,
          'volcano legend spacing must stay inside the fixed canvas',
        );
      }
    }
  }
});

test('L1 overlays fail closed on required values and reconcile plotted counts', () => {
  const scatter = buildSource('fig_l1_scatter');
  assert.match(
    scatter,
    /required <- c\("gene", x_col, y_col, "p_value", "importance_rank"\)/,
  );
  assert.match(
    scatter,
    /is\.finite\(hub\$p_value\)[\s\S]*?is\.finite\(hub\$importance_rank\)/,
  );

  const density = buildSource('fig_l1_density');
  assert.match(density, /expanded_values <- length\(values\)/);
  assert.match(density, /if \(!length\(values\)\) stop\("density input has no finite values"\)/);
  assert.doesNotMatch(density, /sample_names/);

  const histogram = buildSource('fig_l1_histogram');
  assert.match(histogram, /bins <- 60L/);
  assert.match(
    histogram,
    /stopifnot\(length\(values\) > 0L, length\(values\) <= expanded_values, bins == 60L\)/,
  );

  for (const templateId of ['fig_l1_boxplot', 'fig_l1_violin']) {
    const source = buildSource(templateId);
    assert.match(
      source,
      new RegExp(`if \\(sum\\(counts\\) != nrow\\(deg\\)\\) stop\\("${templateId === 'fig_l1_boxplot' ? 'boxplot' : 'violin'} direction counts do not reconcile"\\)`),
      `${templateId}: direction counts must reconcile with plotted rows`,
    );
  }
});

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
    const template = registryById.get(templateId);
    const source = buildSource(templateId);
    const masterBytes = decodeMasterBlock(source);
    const masterHash = crypto.createHash('sha256').update(masterBytes).digest('hex');
    assert.equal(
      masterHash, template.source_sha256,
      `${templateId}: decoded master bytes do not match registry sha256`,
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
    const source = buildSource(templateId);
    const marker = '# Retained master source for byte-level audit';
    const markerIndex = source.indexOf(marker);
    assert.ok(markerIndex > 0, `${templateId}: master audit block missing`);
    if (template.language === 'r') {
      const exitIndex = source.indexOf('quit(status = 0)');
      assert.ok(exitIndex > 0 && exitIndex < markerIndex, `${templateId}: R master must be unreachable`);
    } else {
      const exitIndex = source.indexOf('raise SystemExit(0)');
      assert.ok(exitIndex > 0 && exitIndex < markerIndex, `${templateId}: Python master must be unreachable`);
    }
  }
});

test('R adapted sources declare the BIOANALYS_SEED contract', () => {
  const rIds = SUPPORTED_IDS.filter((templateId) => registryById.get(templateId).language === 'r');
  assert.equal(rIds.length, 10);
  for (const templateId of rIds) {
    const source = buildSource(templateId);
    const adaptedPrefix = source.split('# Retained master source')[0];
    assert.match(source, /BIOANALYS_SEED/);
    assert.match(source, /seed_value\s*<-\s*Sys\.getenv\("BIOANALYS_SEED", unset\s*=\s*""\)/);
    assert.match(source, /if\s*\(\s*nchar\(seed_value\)\s*==\s*0\s*\)\s*quit\(status\s*=\s*3\)/);
    assert.doesNotMatch(adaptedPrefix, /adapt_vars\s*<-\s*list\([\s\S]*?,\s*\)/);
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

test('source manifest and registry provenance agree for every ready template', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(REPO, 'src', 'figure_sources', 'manifest.json'), 'utf8'),
  );
  assert.equal(manifest.schema_version, 1);
  assert.deepEqual(
    manifest.sources.map((item) => item.template_id).sort(),
    [...SUPPORTED_IDS].sort(),
  );

  for (const sourceEntry of manifest.sources) {
    const template = registryById.get(sourceEntry.template_id);
    assert.ok(template, `${sourceEntry.template_id}: registry entry missing`);
    assert.equal(template.source, sourceEntry.source);
    assert.equal(template.preview, sourceEntry.preview);
    assert.equal(template.source_sha256, sourceEntry.source_sha256);
    assert.equal(template.preview_sha256, sourceEntry.preview_sha256);
    assert.equal(template.catalog_id, sourceEntry.catalog_id);
    assert.equal(template.catalog_title, sourceEntry.catalog_title);
    assert.equal(template.catalog_page_url, sourceEntry.catalog_page_url);
    assert.equal(template.catalog_language, sourceEntry.catalog_language);
    assert.equal(template.source_match, sourceEntry.source_match);
    assert.ok(Number.isInteger(sourceEntry.catalog_id) && sourceEntry.catalog_id > 0);
    assert.match(sourceEntry.catalog_page_url, /^https?:\/\//);
    assert.ok(['exact', 'analogous'].includes(sourceEntry.source_match));

    const catalogLanguage = sourceEntry.catalog_language.toLowerCase();
    const expectedExtension = catalogLanguage === 'python' ? '.py' : '.R';
    assert.equal(
      path.extname(sourceEntry.source),
      expectedExtension,
      `${sourceEntry.template_id}: source must match catalog language`,
    );
    if (sourceEntry.source_match === 'exact') {
      assert.equal(
        template.language,
        catalogLanguage,
        `${sourceEntry.template_id}: exact source cannot change implementation language`,
      );
    }
  }
});

test('generated python adapters compile with python3 py_compile', { skip: hasPython ? false : 'python3 not available' }, async () => {
  for (const templateId of SUPPORTED_IDS.filter((id) => registryById.get(id).language === 'python')) {
    const source = buildSource(templateId);
    const tempDir = makeTempDir('py-compile');
    const scriptPath = path.join(tempDir, 'script.py');
    fs.writeFileSync(scriptPath, source, 'utf8');
    try {
      const result = spawnSync('python3', ['-m', 'py_compile', scriptPath], {
        encoding: 'utf8',
      });
      assert.equal(
        result.status, 0,
        `${templateId}: py_compile failed (exit ${result.status})\n${result.stderr || result.stdout}`,
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test('generated R adapters parse with a real R parser', { skip: hasR ? false : 'Rscript not available locally, remote parse pending' }, async () => {
  for (const templateId of SUPPORTED_IDS.filter((id) => registryById.get(id).language === 'r')) {
    const source = buildSource(templateId);
    const tempDir = makeTempDir('r-parse');
    const scriptPath = path.join(tempDir, 'script.R');
    fs.writeFileSync(scriptPath, source, 'utf8');
    try {
      const result = spawnSync('Rscript', ['-e', 'parse(file=commandArgs(TRUE)[1])', scriptPath], {
        encoding: 'utf8',
      });
      assert.equal(
        result.status, 0,
        `${templateId}: R parse failed (exit ${result.status})\n${result.stderr || result.stdout}`,
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test('cross-language master audit block is host-parseable and hash-faithful', () => {
  const templateId = 'fig_l2_pca';
  const template = registryById.get(templateId);
  assert.equal(template.language, 'r');
  assert.equal(template.catalog_language, 'Python');
  const source = buildSource(templateId);
  const masterBytes = decodeMasterBlock(source);
  const masterHash = crypto.createHash('sha256').update(masterBytes).digest('hex');
  assert.equal(masterHash, template.source_sha256);
  assert.equal(
    source.includes('import numpy'),
    false,
    'python master source must stay inside the base64 audit block',
  );
});

test('legend position override defaults to the registry contract', () => {
  for (const templateId of SUPPORTED_IDS) {
    const template = registryById.get(templateId);
    const source = buildSource(templateId);
    const pattern = template.language === 'r'
      ? /^legend_position\s*<-\s*"([^"]+)"$/m
      : /^legend_position\s*=\s*"([^"]+)"$/m;
    const match = source.match(pattern);
    assert.ok(match, `${templateId}: generated legend_position declaration missing`);
    assert.equal(
      match[1],
      template.figure_layout.legend_position,
      `${templateId}: default legend position drift`,
    );
  }
});

test('legend position override writes a real script variable and report metadata', () => {
  for (const override of ['none', 'right', 'top', 'inside']) {
    const template = registryById.get('fig_l2_pca');
    const source = buildAdaptedFigureSource({
      template,
      masterSource: fs.readFileSync(path.join(REPO, template.source), 'utf8'),
      inputPath: CASES.fig_l2_pca.inputPath,
      projectId: PROJECT_ID,
      lineId: CASES.fig_l2_pca.lineId,
      adaptVars: CASES.fig_l2_pca.adaptVars,
      legendPositionOverride: override,
    });
    assert.match(
      source,
      /^legend_position\s*<-\s*"(none|right|top|inside)"$/m,
      `override ${override}: generated variable missing`,
    );
    assert.match(
      source,
      new RegExp(`^legend_position\\s*<-\\s*"${override}"$`, 'm'),
      `override ${override}: variable value mismatch`,
    );
    assert.match(
      source,
      /paste0\("legend_position=", legend_position\)/,
      `override ${override}: report must read the runtime variable`,
    );
    assert.match(
      source,
      new RegExp(`paste0\\("legend_position=", legend_position\\)`),
      `override ${override}: report must read the runtime variable`,
    );
  }
});

test('legend position override fails closed on illegal values', () => {
  const template = registryById.get('fig_l2_pca');
  for (const illegal of ['outside', 'bottom', 'left', '', '  right  ']) {
    assert.throws(
      () => buildAdaptedFigureSource({
        template,
        masterSource: fs.readFileSync(path.join(REPO, template.source), 'utf8'),
        inputPath: CASES.fig_l2_pca.inputPath,
        projectId: PROJECT_ID,
        lineId: CASES.fig_l2_pca.lineId,
        adaptVars: CASES.fig_l2_pca.adaptVars,
        legendPositionOverride: illegal,
      }),
      /legend_position/,
      `illegal override "${illegal}" must throw`,
    );
  }
  assert.throws(
    () => buildAdaptedFigureSource({
      template,
      masterSource: fs.readFileSync(path.join(REPO, template.source), 'utf8'),
      inputPath: CASES.fig_l2_pca.inputPath,
      projectId: PROJECT_ID,
      lineId: CASES.fig_l2_pca.lineId,
      adaptVars: CASES.fig_l2_pca.adaptVars,
      legendPositionOverride: 42,
    }),
    /legend_position/,
    'numeric override must throw',
  );
});

test('legend position override propagates to the Python adapter runtime variable', () => {
  const template = registryById.get('fig_l2p_dotplot');
  const source = buildAdaptedFigureSource({
    template,
    masterSource: fs.readFileSync(path.join(REPO, template.source), 'utf8'),
    inputPath: CASES.fig_l2p_dotplot.inputPath,
    projectId: PROJECT_ID,
    lineId: CASES.fig_l2p_dotplot.lineId,
    adaptVars: CASES.fig_l2p_dotplot.adaptVars,
    legendPositionOverride: 'top',
  });
  assert.match(source, /^legend_position\s*=\s*"top"$/m);
  assert.match(source, /f"legend_position=\{legend_position\}"/);
  assert.match(source, /f"legend_position=\{legend_position\}"/);
});

test('heatmap z-score palette uses a diverging RdBu scale centred on white', () => {
  const source = buildSource('fig_l2_heatmap');
  assert.match(
    source,
    /scale_fill_gradient2\(/,
    'heatmap must use a diverging gradient2 scale',
  );
  assert.match(
    source,
    /midpoint\s*=\s*0/,
    'heatmap diverging scale must centre on zero',
  );
  assert.match(
    source,
    /low\s*=\s*"#2166AC"/,
    'heatmap low end must be the RdBu blue',
  );
  assert.match(
    source,
    /mid\s*=\s*"#F7F7F7"/,
    'heatmap mid must be near-white',
  );
  assert.match(
    source,
    /high\s*=\s*"#B2182B"/,
    'heatmap high end must be the RdBu red',
  );
  assert.match(
    source,
    /palette\s*=\s*"RdBu_r"/,
    'heatmap report must record the RdBu_r palette',
  );
  assert.doesNotMatch(
    source.split('# Retained master source')[0],
    /scale_fill_viridis_c/,
    'heatmap adapter prefix must not use viridis',
  );
});
