import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareFigureProjectTasks, validateFigureSchedule, injectAdaptVarsFromProject } from '../server/figure_project_plan.js';
import { loadFigureTemplates } from '../server/figure_graph.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

test('建项前把图模板选择转换成可持久化的自动执行任务', (t) => {
  fs.mkdirSync(path.join(REPO, '.tmp'), { recursive: true });
  const root = fs.mkdtempSync(path.join(REPO, '.tmp', 'figure-project-plan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = prepareFigureProjectTasks({
    root,
    projectId: 'project_plan',
    lineId: 'line1_bulk',
    selectedModIds: ['l1_figures_bulk'],
    analysisModIds: ['l1_de_limma', 'l1_figures_bulk'],
    selections: [{
      template_id: 'fig_l2_volcano',
      adapt_vars: {
        input_data: 'data/line1_bulk/processed/deg_all.tsv',
        group_col: 'group',
        label_genes: ['ELOVL2'],
        log2fc_cutoff: 1,
        padj_cutoff: 0.05,
      },
    }],
  });

  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.tasks.length, 1);
  const task = result.tasks[0];
  assert.equal(task.step, 'adapt_fig_l2_volcano');
  assert.equal(task.depends_on_step, 'l1_de_limma');
  assert.equal(task.adapted, true);
  assert.deepEqual(task.inputs, [
    '/mnt/ssd/bio_data/projects/project_plan/line1_bulk/processed/deg_all.tsv',
  ]);
  assert.match(task.scriptPath, /line1_bulk\/scripts\/adapt_fig_l2_volcano\.R$/);
  assert.equal(fs.existsSync(result.local_scripts[0]), true);
});

test('任一图模板选择非法时整批 fail closed', () => {
  const result = prepareFigureProjectTasks({
    root: path.join(REPO, '.tmp', 'figure-project-plan-invalid'),
    projectId: 'project_plan',
    lineId: 'line1_bulk',
    selectedModIds: ['l1_figures_bulk'],
    selections: [{
      template_id: 'fig_l2p_umap',
      adapt_vars: {
        input_data: 'data/line3_spatial/processed/spatial_dimred_human.h5ad',
        group_col: 'group',
      },
    }],
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /跨线|line1_bulk/);
});

test('MUT-FIG-B 基线：缺前置 producing Mod 时 validateFigureSchedule 必须 UNSCHEDULABLE_FIGURE', () => {
  const registry = loadFigureTemplates().templates;
  const selections = [{ template_id: 'fig_l3_banksy_domain' }];
  const missing = validateFigureSchedule(['l3_figures_spatial'], selections, registry);
  assert.equal(missing.ok, false);
  assert.equal(missing.violations[0].code, 'UNSCHEDULABLE_FIGURE');
  assert.ok(missing.violations[0].missing_mod_ids.includes('l3_dimred_domains'));

  const covered = validateFigureSchedule(['l3_dimred_domains', 'l3_figures_spatial'], selections, registry);
  assert.equal(covered.ok, true);
});

test('MUT-FIG-C 基线：draft 图件调度必须 ERR_FIGURE_NOT_READY', () => {
  const registry = loadFigureTemplates().templates;
  const draft = registry.find((t) => t.status === 'draft');
  const result = validateFigureSchedule(['l1_figures_bulk'], [{ template_id: draft.id }], registry);
  assert.equal(result.ok, false);
  assert.equal(result.violations[0].code, 'ERR_FIGURE_NOT_READY');
});

test('prepareFigureProjectTasks 显式 selectedMods 缺 producing Mod 时 fail closed 并带结构化违约', (t) => {
  fs.mkdirSync(path.join(REPO, '.tmp'), { recursive: true });
  const root = fs.mkdtempSync(path.join(REPO, '.tmp', 'figure-plan-schedule-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = prepareFigureProjectTasks({
    root,
    projectId: 'project_plan',
    lineId: 'line1_bulk',
    selectedModIds: ['l1_figures_bulk'],
    analysisModIds: ['l1_figures_bulk'],
    selections: [{
      template_id: 'fig_l2_volcano',
      adapt_vars: { input_data: 'data/line1_bulk/processed/deg_all.tsv', group_col: 'group', label_genes: ['ELOVL2'], log2fc_cutoff: 1, padj_cutoff: 0.05 },
    }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.schedule_violations[0].code, 'UNSCHEDULABLE_FIGURE');
  assert.ok(result.schedule_violations[0].missing_mod_ids.includes('l1_de_limma'));
});

test('injectAdaptVarsFromProject 按 schema 确定性填充缺失键且不覆盖显式值', () => {
  const template = {
    data_contract: { input_artifact: 'deg_all.tsv' },
    portal_binding: { adapt_vars_schema: [
      { key: 'input_data', source_field: 'data_contract.input_artifact' },
      { key: 'padj_cutoff', source_field: 'analysisCutoffs.padj' },
      { key: 'group_col', source_field: 'groupingDesign.byLine' },
    ] },
  };
  const merged = injectAdaptVarsFromProject(template, { group_col: 'explicit' }, {
    analysisCutoffs: { padj: 0.05 },
    groupingDesign: { byLine: 'auto_group' },
  });
  assert.equal(merged.input_data, 'deg_all.tsv');
  assert.equal(merged.padj_cutoff, 0.05);
  assert.equal(merged.group_col, 'explicit');
});
