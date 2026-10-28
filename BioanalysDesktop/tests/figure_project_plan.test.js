import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareFigureProjectTasks } from '../server/figure_project_plan.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

test('建项前把图模板选择转换成可持久化的自动执行任务', (t) => {
  const root = fs.mkdtempSync(path.join(REPO, '.tmp', 'figure-project-plan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = prepareFigureProjectTasks({
    root,
    projectId: 'project_plan',
    lineId: 'line1_bulk',
    selectedModIds: ['l1_figures_bulk'],
    selections: [{
      template_id: 'fig_l2_volcano',
      adapt_vars: {
        input_data: 'data/line1_bulk/processed/deg_all.tsv',
        group_col: 'group',
        label_genes: ['ELOVL2'],
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
