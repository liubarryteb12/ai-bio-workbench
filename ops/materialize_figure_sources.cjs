#!/usr/bin/env node
'use strict';

/**
 * Materialize the selected chart-code library rows into project-owned files.
 *
 * The external reference package is intentionally ignored by git. Ready figure
 * templates must still have an auditable, immutable source in this repository,
 * so this script copies the selected catalog rows once and records provenance.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const REPO = path.resolve(__dirname, '..');
const LIBRARY_ROOT = path.join(
  REPO,
  'reference',
  '05.可参考出图代码',
  '图码对应库_交付包',
  '图码对应库_交付包',
);
const DATABASE = path.join(LIBRARY_ROOT, 'chart_code_library.db');
const IMAGE_ROOT = path.join(LIBRARY_ROOT, '可参考真实图');
const SOURCE_ROOT = path.join(REPO, 'src', 'figure_sources');
const PREVIEW_ROOT = path.join(REPO, 'src', 'figure_previews');

const SELECTED = Object.freeze([
  {
    template_id: 'fig_l2_heatmap',
    catalog_id: 227,
    source_match: 'exact',
    preview: 'reference:R__79-levelplot-with-ggplot2__0.png',
  },
  {
    template_id: 'fig_l2_pca',
    catalog_id: 484,
    source_match: 'analogous',
    preview: 'reference:Python__515-intro-pca-graph-python__0.png',
  },
  {
    template_id: 'fig_l2_volcano',
    catalog_id: 329,
    source_match: 'analogous',
    preview: 'sample:local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/l1_03_volcano_limma.png',
  },
  {
    template_id: 'fig_l2p_dotplot',
    catalog_id: 414,
    source_match: 'analogous',
    preview: 'sample:local_projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/l2_13_target_gene_dotplot.png',
  },
  {
    template_id: 'fig_l2p_volcano',
    catalog_id: 683,
    source_match: 'analogous',
    preview: 'sample:local_projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/l2_08_deg_volcano_basal_keratinocyte.png',
  },
  {
    template_id: 'fig_l2p_umap',
    catalog_id: 505,
    source_match: 'analogous',
    preview: 'sample:local_projects/PRJ_AIMS_V3_20261027/figures/line3_spatial/l3_human_06_umap_sample.png',
  },
  {
    template_id: 'fig_l1_groupedbar',
    catalog_id: 215,
    source_match: 'exact',
    preview: 'sample:local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_groupedbar.png',
  },
  {
    template_id: 'fig_l1_scatter',
    catalog_id: 329,
    source_match: 'exact',
    preview: 'reference:R__web-scatterplot-and-ggrepel__0.png',
  },
  {
    template_id: 'fig_l1_boxplot',
    catalog_id: 232,
    source_match: 'exact',
    preview: 'reference:R__89-box-and-scatter-plot-with-ggplot2__0.png',
  },
  {
    template_id: 'fig_l1_density',
    catalog_id: 61,
    source_match: 'exact',
    preview: 'reference:R__21-distribution-plot-using-ggplot2__0.png',
  },
  {
    template_id: 'fig_l1_histogram',
    catalog_id: 68,
    source_match: 'exact',
    preview: 'reference:R__220-basic-ggplot2-histogram__0.png',
  },
  {
    template_id: 'fig_l1_violin',
    catalog_id: 298,
    source_match: 'exact',
    preview: 'reference:R__violin_and_boxplot_ggplot2__0.png',
  },
  {
    template_id: 'fig_l2_umap',
    catalog_id: 505,
    source_match: 'analogous',
    preview: 'sample:local_projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/custom_fig_l2_umap.png',
  },
  {
    template_id: 'fig_l2p_violin',
    catalog_id: 472,
    source_match: 'exact',
    preview: 'reference:Python__502-violinplot-and-swarmplot__0.png',
  },
  {
    template_id: 'fig_l3_sankey',
    catalog_id: 328,
    source_match: 'exact',
    preview: 'reference:R__web-sankey-diagram-with-highlight__0.png',
  },
]);

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalizeLf(text) {
  return String(text || '').replace(/\r\n?/g, '\n');
}

function sourceExtension(language) {
  return String(language).toLowerCase() === 'python' ? 'py' : 'R';
}

function sourceFilename(templateId, language) {
  return `${templateId}.${sourceExtension(language)}`;
}

function materializedSource(row, selection) {
  const header = [
    `# Catalog-ID: ${row.id}`,
    `# Catalog-Title: ${row.title}`,
    `# Catalog-Page: ${row.page_url}`,
    `# Catalog-Language: ${row.lang}`,
    `# Source-Match: ${selection.source_match}`,
    '# Materialized-From: chart_code_library.db',
    '# The adapter keeps this source after its real-data overlay for byte-level audit.',
    '',
  ].join('\n');
  return `${header}${normalizeLf(row.code).replace(/\n?$/, '\n')}`;
}

function resolvePreview(spec) {
  const [kind, relative] = String(spec).split(':', 2);
  if (kind === 'reference') return path.join(IMAGE_ROOT, relative);
  if (kind === 'sample') return path.join(REPO, relative);
  throw new Error(`unknown preview source: ${spec}`);
}

function main() {
  if (!fs.existsSync(DATABASE)) throw new Error(`catalog database missing: ${DATABASE}`);
  fs.mkdirSync(SOURCE_ROOT, { recursive: true });
  fs.mkdirSync(PREVIEW_ROOT, { recursive: true });

  const db = new DatabaseSync(DATABASE, { readOnly: true });
  const select = db.prepare('SELECT * FROM charts WHERE id = ?');
  const manifest = [];

  for (const selection of SELECTED) {
    const row = select.get(selection.catalog_id);
    if (!row) throw new Error(`catalog row missing: ${selection.catalog_id}`);
    if (!row.has_code || !String(row.code || '').trim()) {
      throw new Error(`catalog row has no code: ${selection.catalog_id}`);
    }
    if (!row.img_ok) {
      throw new Error(`catalog row has no verified image: ${selection.catalog_id}`);
    }

    const sourceText = materializedSource(row, selection);
    const sourceRel = path.posix.join(
      'src',
      'figure_sources',
      sourceFilename(selection.template_id, row.lang),
    );
    const sourceAbs = path.join(REPO, sourceRel);
    fs.writeFileSync(sourceAbs, sourceText, 'utf8');

    const previewSource = resolvePreview(selection.preview);
    if (!fs.existsSync(previewSource)) {
      throw new Error(`preview missing for ${selection.template_id}: ${previewSource}`);
    }
    const previewRel = path.posix.join(
      'src',
      'figure_previews',
      `${selection.template_id}.png`,
    );
    const previewAbs = path.join(REPO, previewRel);
    fs.copyFileSync(previewSource, previewAbs);

    manifest.push({
      template_id: selection.template_id,
      catalog_id: row.id,
      catalog_title: row.title,
      catalog_page_url: row.page_url,
      catalog_language: row.lang,
      source_match: selection.source_match,
      source: sourceRel,
      source_sha256: sha256(Buffer.from(sourceText, 'utf8')),
      preview: previewRel,
      preview_sha256: sha256(fs.readFileSync(previewAbs)),
      preview_origin: selection.preview,
    });
  }

  const manifestPath = path.join(SOURCE_ROOT, 'manifest.json');
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify({ schema_version: 1, database: path.relative(REPO, DATABASE).split(path.sep).join('/'), sources: manifest }, null, 2)}\n`,
    'utf8',
  );
  console.log(`materialized=${manifest.length} manifest=${path.relative(REPO, manifestPath)}`);
}

if (require.main === module) main();

module.exports = { SELECTED, sourceFilename };
