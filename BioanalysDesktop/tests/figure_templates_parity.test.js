import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  loadFigureTemplates,
  reloadFigureTemplates,
  validateRegistry,
  resolveFigure,
  buildAdaptedFigureTasks,
  authorizeOverwrite,
  validateFigureStepInputs,
} from '../server/figure_graph.js';
import { indexMods } from '../server/workflow_graph.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const GENERATOR = path.join(REPO, 'ops', 'build_figure_templates.cjs');
const REGISTRY = path.join(REPO, 'src', 'figure_templates.json');
const SOURCE_MANIFEST = path.join(REPO, 'src', 'figure_sources', 'manifest.json');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function resolveRepoFile(relative) {
  return path.join(REPO, relative);
}

test('registry is generated from bizard index and r453 evidence', () => {
  assert.ok(fs.existsSync(GENERATOR), 'ops/build_figure_templates.cjs missing');
  assert.ok(fs.existsSync(REGISTRY), 'src/figure_templates.json missing');
  execFileSync(process.execPath, [GENERATOR, '--check'], { cwd: REPO, stdio: 'pipe' });
});

test('registry contains the exact 82 figure inventory and verification counts', () => {
  const registry = reloadFigureTemplates();
  assert.equal(registry.schema_version, 1);
  assert.equal(registry.templates.length, 82);
  assert.equal(new Set(registry.templates.map((item) => item.id)).size, 82);
  assert.equal(registry.templates.filter((item) => item.deps_status === 'ready').length, 15);
  assert.equal(registry.templates.filter((item) => item.deps_status === 'pending').length, 66);
  assert.equal(registry.templates.filter((item) => item.deps_status === 'pending_mapping').length, 0);
  assert.equal(registry.templates.filter((item) => item.deps_status === 'blocked_r453').length, 1);

  const required = [
    'id', 'name', 'level', 'category', 'language', 'source', 'source_sha256',
    'preview', 'preview_sha256', 'verified', 'deps_status', 'linked_mods',
    'adapt_vars', 'deprecated', 'lines', 'analysis_step', 'input_tables',
    'produces', 'output_glob', 'canonical_output', 'sample_project_output',
  ];
  for (const item of registry.templates) {
    assert.deepEqual(
      required.filter((key) => !(key in item)),
      [],
      `${item.id}: required field missing`,
    );
    assert.ok(['L1', 'L2', 'L3'].includes(item.level));
    assert.ok(['r', 'python'].includes(item.language));
    assert.ok(['ready', 'pending', 'pending_mapping', 'blocked_r453'].includes(item.deps_status));
    assert.equal(typeof item.name, 'string');
    assert.ok(item.name.length > 0);
    assert.equal(typeof item.adapt_vars, 'object');
    assert.equal(item.adapt_vars === null, false);
    assert.ok(Object.keys(item.adapt_vars).length > 0);
    assert.ok(Array.isArray(item.linked_mods));
    assert.ok(item.linked_mods.length > 0);
    assert.equal(typeof item.deprecated, 'boolean');
  }
});

test('ready template adapt vars expose contract defaults, types and options', () => {
  const registry = reloadFigureTemplates();
  const ready = registry.templates.filter((item) => item.deps_status === 'ready');
  assert.equal(ready.length, 15);
  for (const template of ready) {
    for (const [key, declaration] of Object.entries(template.adapt_vars)) {
      assert.ok(declaration && typeof declaration === 'object' && !Array.isArray(declaration));
      assert.equal(typeof declaration.description, 'string');
      assert.ok(declaration.description.length > 0);
      assert.ok(['string', 'string_list'].includes(declaration.type));
      assert.ok('default' in declaration, `${template.id}.${key}: default missing`);
      assert.equal(declaration.required, key !== 'label_genes');
      if (Array.isArray(declaration.options)) {
        assert.ok(declaration.options.length > 0);
      }
    }
  }
  const pca = registry.templates.find((item) => item.id === 'fig_l2_pca');
  assert.deepEqual(pca.adapt_vars.group_col, {
    description: 'Sample group column',
    type: 'string',
    required: true,
    default: 'group',
  });
  const volcano = registry.templates.find((item) => item.id === 'fig_l2_volcano');
  assert.deepEqual(volcano.adapt_vars.label_genes, {
    description: 'Genes to label; may be empty',
    type: 'string_list',
    required: false,
    default: [],
  });
  const umap = registry.templates.find((item) => item.id === 'fig_l2_umap');
  assert.deepEqual(umap.adapt_vars.group_col, {
    description: 'Cell group or cluster column',
    type: 'string',
    required: true,
    default: 'group',
  });
});

test('ready templates declare physical layout and export metadata', () => {
  const registry = reloadFigureTemplates();
  const expected = {
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
  for (const template of registry.templates.filter((item) => item.deps_status === 'ready')) {
    const layout = template.figure_layout;
    assert.deepEqual(
      { width_mm: layout.width_mm, height_mm: layout.height_mm, column: layout.column },
      expected[template.id],
    );
    assert.equal(typeof layout.min_width_mm, 'number');
    assert.equal(typeof layout.min_height_mm, 'number');
    assert.equal(typeof layout.dpi, 'number');
  }
});

test('ready templates point to verified source and preview bytes', () => {
  const registry = reloadFigureTemplates();
  const ready = registry.templates.filter((item) => item.deps_status === 'ready');
  for (const item of ready) {
    assert.equal(item.verified, true);
    assert.notEqual(item.source, null);
    assert.notEqual(item.preview, null);
    const source = resolveRepoFile(item.source);
    const preview = resolveRepoFile(item.preview);
    assert.ok(fs.existsSync(source), `${item.id}: source missing`);
    assert.ok(fs.existsSync(preview), `${item.id}: preview missing`);
    assert.equal(item.source_sha256, sha256(source), `${item.id}: source fingerprint drift`);
    assert.equal(item.preview_sha256, sha256(preview), `${item.id}: preview fingerprint drift`);
    assert.ok(Array.isArray(item.lines) && item.lines.length > 0, `${item.id}: lines missing`);
    assert.ok(typeof item.analysis_step === 'string' && item.analysis_step.length > 0);
    assert.ok(Array.isArray(item.input_tables) && item.input_tables.length > 0);
    assert.ok(Array.isArray(item.produces) && item.produces.length > 0);
    assert.ok(typeof item.output_glob === 'string' && item.output_glob.length > 0);
    assert.ok(typeof item.canonical_output === 'string' && item.canonical_output.length > 0);
    assert.ok(typeof item.sample_project_output === 'string' && item.sample_project_output.length > 0);
    assert.ok(fs.existsSync(resolveRepoFile(item.sample_project_output)), `${item.id}: sample output missing`);
  }
});

test('ready templates use unique canonical output names', () => {
  const registry = reloadFigureTemplates();
  const ready = registry.templates.filter((item) => item.deps_status === 'ready');
  const outputs = new Map();
  for (const item of ready) {
    const prior = outputs.get(item.canonical_output);
    assert.equal(
      prior,
      undefined,
      `${item.id}: canonical_output collides with ${prior}`,
    );
    outputs.set(item.canonical_output, item.id);
  }
  assert.equal(outputs.get('umap_L2p_umap_verified.png'), 'fig_l2p_umap');
  assert.equal(outputs.get('umap_L2_umap_verified.png'), 'fig_l2_umap');
});

test('ready template source, preview and sample files are git-trackable', () => {
  const registry = reloadFigureTemplates();
  for (const item of registry.templates.filter((row) => row.deps_status === 'ready')) {
    for (const relative of [item.source, item.preview, item.sample_project_output]) {
      const result = spawnSync('git', ['check-ignore', '-q', relative], {
        cwd: REPO,
        windowsHide: true,
      });
      assert.equal(result.status, 1, `${item.id}: ${relative} is still ignored`);
    }
  }
});

test('non-ready templates stay unregistered until independently verified', () => {
  const registry = reloadFigureTemplates();
  for (const item of registry.templates.filter((row) => row.deps_status !== 'ready')) {
    assert.equal(item.verified, false);
    assert.equal(item.source, null);
    assert.equal(item.source_sha256, null);
    assert.equal(item.preview, null);
    assert.equal(item.preview_sha256, null);
  }
  const kegg = registry.templates.find((item) => item.id === 'fig_kegg_pathway');
  assert.equal(kegg.deps_status, 'blocked_r453');
  assert.match(kegg.block_reason, /pathview|KEGG/i);
});

test('registry validation enforces linked mods, language and line affinity', () => {
  const result = validateRegistry();
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.stats.ready, 15);
  assert.equal(result.stats.pending, 66);
  assert.equal(result.stats.pending_mapping, 0);
  assert.equal(result.stats.blocked, 1);
});

test('ready template input tables must be declared outputs of the bound step', () => {
  const registry = reloadFigureTemplates();
  const mods = new Map([...indexMods()].map(([, entry]) => [entry.mod.id, entry]));
  for (const template of registry.templates.filter((item) => item.deps_status === 'ready')) {
    const errors = validateFigureStepInputs(template, mods.get(template.analysis_step));
    assert.deepEqual(errors, [], `${template.id}: ${errors.join('; ')}`);
  }
  const template = registry.templates.find((item) => item.id === 'fig_l2_pca');
  const bad = { ...template, input_tables: [...template.input_tables, 'not_a_step_output.tsv'] };
  const errors = validateFigureStepInputs(bad, mods.get(bad.analysis_step));
  assert.match(errors.join('\n'), /not_a_step_output\.tsv/);
});

test('source manifest carries verified catalog provenance for all ready figures', () => {
  const registry = reloadFigureTemplates();
  const manifest = JSON.parse(fs.readFileSync(SOURCE_MANIFEST, 'utf8'));
  const ready = registry.templates.filter((item) => item.deps_status === 'ready');
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.sources.length, ready.length);
  assert.deepEqual(
    manifest.sources.map((item) => item.template_id).sort(),
    ready.map((item) => item.id).sort(),
  );
  for (const entry of manifest.sources) {
    assert.ok(Number.isInteger(entry.catalog_id) && entry.catalog_id > 0);
    assert.match(entry.catalog_page_url, /^https?:\/\//);
    assert.ok(['exact', 'analogous'].includes(entry.source_match));
    assert.match(entry.source_sha256, /^[0-9a-f]{64}$/);
    assert.match(entry.preview_sha256, /^[0-9a-f]{64}$/);
    assert.equal(sha256(resolveRepoFile(entry.source)), entry.source_sha256);
    assert.equal(sha256(resolveRepoFile(entry.preview)), entry.preview_sha256);
  }
});

test('multi-panel template is explicitly retired by the single-plot standard', () => {
  const registry = reloadFigureTemplates();
  const multipanel = registry.templates.find((item) => item.id === 'fig_l3_multipanel');
  assert.ok(multipanel);
  assert.equal(multipanel.deps_status, 'pending');
  assert.equal(multipanel.verified, false);
  assert.equal(multipanel.deprecated, true);
  assert.match(multipanel.pending_reason, /single-plot|multi-panel|v3\.0/i);
});

test('figure source manifest, sources and previews are git-trackable', () => {
  const manifest = JSON.parse(fs.readFileSync(SOURCE_MANIFEST, 'utf8'));
  const paths = [
    'src/figure_sources/manifest.json',
    ...manifest.sources.flatMap((item) => [item.source, item.preview]),
  ];
  for (const relative of paths) {
    const result = spawnSync('git', ['check-ignore', '-q', relative], {
      cwd: REPO,
      windowsHide: true,
    });
    assert.equal(result.status, 1, `${relative} is still ignored`);
  }
});

test('ready figure selections become executable adapted tasks', () => {
  const registry = reloadFigureTemplates();
  const result = buildAdaptedFigureTasks({
    projectId: 'project_alpha',
    lineId: 'line1_bulk',
    selectedFigures: [{
      template_id: 'fig_l2_pca',
      adapt_vars: {
        input_data: 'figures/line1_bulk/pca_scores.tsv',
        group_col: 'group',
      },
    }],
    templatesRegistry: registry.templates,
  });
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].step, 'adapt_fig_l2_pca');
  assert.equal(result.tasks[0].depends_on_step, 'l1_qc_pca');
  assert.match(result.tasks[0].script_path, /scripts\/adapt_fig_l2_pca\.R$/);
  assert.match(result.tasks[0].outputs[0], /custom_fig_l2_pca\.png$/);
});

test('ready figure tasks carry actual submitted adapt values', () => {
  const registry = reloadFigureTemplates();
  const result = buildAdaptedFigureTasks({
    projectId: 'project_alpha',
    lineId: 'line1_bulk',
    selectedFigures: [{
      template_id: 'fig_l2_volcano',
      adapt_vars: {
        input_data: 'figures/line1_bulk/de_results.csv',
        group_col: 'condition_x',
        label_genes: ['TNF'],
      },
    }],
    templatesRegistry: registry.templates,
  });
  assert.equal(result.ok, true, result.errors.join('\n'));
  const env = result.tasks[0].env_vars.BIO_ADAPT_VARS;
  assert.deepEqual(JSON.parse(env), {
    input_data: 'figures/line1_bulk/de_results.csv',
    group_col: 'condition_x',
    label_genes: ['TNF'],
  });
});

test('non-ready figure selections are rejected', () => {
  const registry = reloadFigureTemplates();
  const result = buildAdaptedFigureTasks({
    projectId: 'project_alpha',
    lineId: 'line1_bulk',
    selectedFigures: [{ template_id: 'fig_l1_circularpacking', adapt_vars: {} }],
    templatesRegistry: registry.templates,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /不是 ready/);
});

test('figure resolution accepts a same-line linked mod and complete adapt vars', () => {
  const request = resolveFigure(
    'fig_l2_volcano',
    'line1_bulk',
    'project_alpha',
    {
      input_data: 'figures/line1_bulk/de_results.csv',
      group_col: 'condition',
      label_genes: [],
    },
    ['l1_figures_bulk'],
  );
  assert.equal(request.ok, true, request.errors.join('\n'));
  assert.equal(request.template.id, 'fig_l2_volcano');
  assert.deepEqual(request.selected_mods, ['l1_figures_bulk']);
  assert.match(request.master_path, /src[\\/]figure_sources[\\/]fig_l2_volcano\.R$/);
});

test('figure resolution rejects missing adapt vars and non-linked mods', () => {
  const missing = resolveFigure(
    'fig_l2_volcano',
    'line2_scrna',
    'project_alpha',
    { group_col: 'celltype' },
    ['l2_figures_scrna'],
  );
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join('\n'), /input_data/);

  const unlinked = resolveFigure(
    'fig_l2_volcano',
    'line2_scrna',
    'project_alpha',
    { input_data: 'figures/line2_scrna/de_results.csv', group_col: 'celltype', label_genes: [] },
    ['l2_ko_virtual'],
  );
  assert.equal(unlinked.ok, false);
  assert.match(unlinked.errors.join('\n'), /未关联|linked_mods/);
});

test('figure resolution rejects cross-line templates and adapt values', () => {
  const lineMismatch = resolveFigure(
    'fig_l2p_volcano',
    'line1_bulk',
    'project_alpha',
    { input_data: 'figures/line1_bulk/de_results.csv', group_col: 'celltype', label_genes: [] },
    ['l1_figures_bulk'],
  );
  assert.equal(lineMismatch.ok, false);
  assert.match(lineMismatch.errors.join('\n'), /跨线/);

  const foreignLineValue = resolveFigure(
    'fig_l2p_volcano',
    'line2_scrna',
    'project_alpha',
    { input_data: 'figures/line1_bulk/de_results.csv', group_col: 'celltype', label_genes: [] },
    ['l2_figures_scrna'],
  );
  assert.equal(foreignLineValue.ok, false);
  assert.match(foreignLineValue.errors.join('\n'), /跨线取值/);

  const foreignProjectValue = resolveFigure(
    'fig_l2p_volcano',
    'line2_scrna',
    'project_alpha',
    { input_data: '../project_beta/figures/line2_scrna/de_results.csv', group_col: 'celltype', label_genes: [] },
    ['l2_figures_scrna'],
  );
  assert.equal(foreignProjectValue.ok, false);
  assert.match(foreignProjectValue.errors.join('\n'), /跨项目/);
});

test('masters referenced by more than three projects reject in-place overwrite', () => {
  const references = ['project_1', 'project_2', 'project_3', 'project_4'];
  const blocked = authorizeOverwrite({
    projectId: 'project_1',
    templateId: 'fig_l2_volcano',
    overwrite: true,
    references,
  });
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /超过 3|另存新模板/);

  const allowed = authorizeOverwrite({
    projectId: 'project_1',
    templateId: 'fig_l2_volcano',
    overwrite: true,
    references: ['project_1', 'project_2', 'project_3'],
  });
  assert.equal(allowed.ok, true);
});
