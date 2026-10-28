import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProjectExecutionPlan,
  buildTaskExecutionSequence,
  mergeFigureProjectTasks,
} from '../server/figure_execution_plan.js';
import { buildProjectMeta } from '../server/project.js';

const pipelineDag = [
  { order: 1, stepId: 'prep_matrix', mod_id: 'l1_ingest_prep' },
  { order: 2, stepId: 'deg_limma', mod_id: 'l1_de_limma' },
  { order: 3, stepId: 'enrichment_figures', mod_id: 'l1_enrich_figures' },
];

const figureTasks = [
  {
    task_id: 'task_adapt_fig_l2_volcano',
    step: 'adapt_fig_l2_volcano',
    depends_on_step: 'l1_de_limma',
    adapted: true,
  },
  {
    task_id: 'task_adapt_fig_l1_groupedbar',
    step: 'adapt_fig_l1_groupedbar',
    depends_on_step: 'l1_enrich_figures',
    adapted: true,
  },
];

test('定制图任务插在对应分析步骤之后，并保留同依赖的选择顺序', () => {
  const secondFigure = {
    task_id: 'task_adapt_fig_l1_density',
    step: 'adapt_fig_l1_density',
    depends_on_step: 'l1_de_limma',
    adapted: true,
  };
  const result = buildTaskExecutionSequence(pipelineDag, [
    figureTasks[0],
    secondFigure,
    figureTasks[1],
  ]);

  assert.equal(result.ok, true, result.errors.join('; '));
  assert.deepEqual(result.tasks.map((task) => task.step), [
    'prep_matrix',
    'deg_limma',
    'adapt_fig_l2_volcano',
    'adapt_fig_l1_density',
    'enrichment_figures',
    'adapt_fig_l1_groupedbar',
  ]);
  assert.deepEqual(result.tasks.map((task) => task.kind), [
    'analysis',
    'analysis',
    'adapted_figure',
    'adapted_figure',
    'analysis',
    'adapted_figure',
  ]);
});

test('图模板依赖的分析步骤不在计划中时 fail closed', () => {
  const result = buildTaskExecutionSequence(pipelineDag, [{
    task_id: 'task_adapt_fig_unknown',
    step: 'adapt_fig_unknown',
    depends_on_step: 'l1_not_selected',
    adapted: true,
  }]);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /l1_not_selected/);
});

test('旧 pipelineDag 只有母版名时仍可通过注册表反查依赖', () => {
  const legacy = pipelineDag.map(({ order, stepId }) => ({ order, stepId }));
  const result = buildTaskExecutionSequence(legacy, [figureTasks[0]], 'line1_bulk');

  assert.equal(result.ok, true, result.errors.join('; '));
  assert.deepEqual(result.tasks.map((task) => task.step), [
    'prep_matrix',
    'deg_limma',
    'adapt_fig_l2_volcano',
    'enrichment_figures',
  ]);
});

test('项目元数据持久化定制图任务，供后续执行计划读取', () => {
  const meta = buildProjectMeta({
    id: 'project_plan',
    pipelineDag,
    figureTasks,
  });

  assert.deepEqual(meta.figure_tasks, figureTasks);
});

test('项目执行计划从 project.json 结构恢复标准步骤与定制图顺序', () => {
  const result = buildProjectExecutionPlan({
    line_id: 'line1_bulk',
    pipeline_dag: pipelineDag,
    figure_tasks: [figureTasks[0]],
  });

  assert.equal(result.ok, true, result.errors.join('; '));
  assert.deepEqual(result.tasks.map((task) => task.step), [
    'prep_matrix',
    'deg_limma',
    'adapt_fig_l2_volcano',
    'enrichment_figures',
  ]);
});

test('新增图模板按 step 替换旧任务，不重复执行同一模板', () => {
  const oldTask = { ...figureTasks[0], task_id: 'old_volcano' };
  const unrelated = { ...figureTasks[1], task_id: 'old_groupedbar' };
  const replacement = { ...figureTasks[0], task_id: 'new_volcano' };

  assert.deepEqual(mergeFigureProjectTasks([oldTask, unrelated], [replacement]), [
    unrelated,
    replacement,
  ]);
});
