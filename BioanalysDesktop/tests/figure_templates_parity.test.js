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
const BOXPLOT_MASTERS = [
  path.join(REPO, 'reference', '05.可参考出图代码', 'L1_基础统计图', 'L1_boxplot_code.R'),
  path.join(REPO, 'reference', '05.可参考出图代码', '_meta', 'R453_compat', 'L1_boxplot_code.R'),
];
const PLOT_MATRIX = path.join(REPO, 'reference', '05.可参考出图代码', '_meta', 'script_plot_matrix.json');

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
  // 水位线口径（2026-11-02）：ready 只设下限不倒退，pending 由总数派生，
  // 准入新模板不必再手改这里的数字；结构性不变量（和为 82、blocked 为 1）照旧钉死。
  const READY_BASELINE = 16;
  const byStatus = (status) => registry.templates.filter((item) => item.deps_status === status).length;
  assert.ok(byStatus('ready') >= READY_BASELINE,
    `ready 从基线 ${READY_BASELINE} 倒退：${byStatus('ready')}`);
  assert.equal(byStatus('pending_mapping'), 0);
  assert.equal(byStatus('blocked_r453'), 1);
  assert.equal(
    byStatus('ready') + byStatus('pending') + byStatus('pending_mapping') + byStatus('blocked_r453'),
    82,
    '四类状态之和必须等于 82',
  );

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
  // 水位线口径（2026-11-02）：ready 只设下限不倒退，pending 由总数派生，
  // 准入新模板不必再手改这里的数字。
  assert.ok(result.stats.ready >= 16, `ready 从基线 16 倒退：${result.stats.ready}`);
  assert.equal(result.stats.pending_mapping, 0);
  assert.equal(result.stats.blocked, 1);
  assert.equal(result.stats.ready + result.stats.pending + result.stats.pending_mapping + result.stats.blocked, 82);
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

test('boxplot masters use only horizontal significance lines', () => {
  for (const file of BOXPLOT_MASTERS) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /tip(?:\.|_)length\s*=\s*0\.01/, `${file}: endpoint tip found`);
    assert.ok(
      (text.match(/tip(?:\.|_)length\s*=\s*0\b/g) || []).length >= 2,
      `${file}: horizontal significance lines missing`,
    );
  }
});

test('formal script plot matrix contains 27 passing exact-source entries', () => {
  const matrix = JSON.parse(fs.readFileSync(PLOT_MATRIX, 'utf8'));
  assert.equal(matrix.schema_version, '1.0.0');
  assert.equal(matrix.entries.length, 27);
  for (const entry of matrix.entries) {
    assert.equal(entry.status, 'pass', `${entry.entry_id}: status`);
    assert.equal(entry.k40_exit_code, 0, `${entry.entry_id}: exit code`);
    assert.equal(entry.marker_found, true, `${entry.entry_id}: marker`);
    assert.ok(entry.artifacts.length > 0, `${entry.entry_id}: artifacts`);
    assert.ok(entry.artifacts.every((item) => item.ok), `${entry.entry_id}: invalid artifact`);
    assert.match(entry.source_sha256, /^[0-9a-f]{64}$/);
    const source = path.join(REPO, 'reference', '05.可参考出图代码', entry.script_path);
    assert.ok(fs.existsSync(source), `${entry.entry_id}: source missing`);
    assert.equal(sha256(source), entry.source_sha256);
    const relative = path.relative(REPO, source).split(path.sep).join('/');
    const ignored = spawnSync('git', ['check-ignore', '-q', relative], {
      cwd: REPO,
      windowsHide: true,
    });
    assert.equal(ignored.status, 1, `${entry.entry_id}: source is still ignored`);
  }
});

test('figure registry inputs and boxplot masters are git-trackable', () => {
  const paths = [
    'reference/05.可参考出图代码/_meta/bizard_index.csv',
    'reference/05.可参考出图代码/_meta/r453_verification_report.json',
    ...BOXPLOT_MASTERS.map((file) => path.relative(REPO, file).split(path.sep).join('/')),
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
  assert.match(request.master_path, /figure_templates|L2_core_code\.R|reference/);
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
