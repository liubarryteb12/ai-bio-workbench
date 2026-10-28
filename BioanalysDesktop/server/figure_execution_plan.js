import { scriptToModMap } from './workflow_graph.js';

function pipelineModId(entry, lineId, scriptMods) {
  if (typeof entry.mod_id === 'string' && entry.mod_id.length > 0) return entry.mod_id;
  if (!lineId) return '';
  return scriptMods.get(`${lineId}:${entry.stepId}`) || '';
}

/**
 * 把标准分析步骤与定制图任务合成一个顺序执行计划。
 *
 * 定制图任务必须挂在一个已经选中的 analysis_step 后面。依赖匹配同时接受
 * mod id 与母版名，旧 pipeline_dag 没有 mod_id 时再通过注册表反查。
 */
export function buildTaskExecutionSequence(pipelineDag, figureTasks = [], lineId = '') {
  if (!Array.isArray(pipelineDag)) {
    return { ok: false, errors: ['pipelineDag 必须是数组'], tasks: [] };
  }
  if (!Array.isArray(figureTasks)) {
    return { ok: false, errors: ['figureTasks 必须是数组'], tasks: [] };
  }

  const scriptMods = lineId ? scriptToModMap(lineId) : new Map();
  const ordered = pipelineDag
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (
      Number(a.entry?.order ?? a.index + 1) - Number(b.entry?.order ?? b.index + 1)
    ) || (a.index - b.index));

  const errors = [];
  const dependencyIndex = new Map();
  const normalizedAnalysis = ordered.map(({ entry }, index) => {
    const step = String(entry?.stepId || entry?.step || '').trim();
    const modId = pipelineModId(entry || {}, lineId, scriptMods);
    if (!step) errors.push(`pipelineDag[${index}] 缺少 stepId`);
    for (const key of [step, modId].filter(Boolean)) {
      if (dependencyIndex.has(key)) errors.push(`pipelineDag 依赖键重复: ${key}`);
      else dependencyIndex.set(key, index);
    }
    return {
      ...entry,
      kind: 'analysis',
      step,
      ...(modId ? { mod_id: modId } : {}),
    };
  });

  const figuresAfter = new Map();
  const seenFigureSteps = new Set();
  for (const [index, figure] of figureTasks.entries()) {
    const step = String(figure?.step || '').trim();
    const dependency = String(figure?.depends_on_step || '').trim();
    if (!step) errors.push(`figureTasks[${index}] 缺少 step`);
    if (!dependency) errors.push(`figureTasks[${index}] 缺少 depends_on_step`);
    if (seenFigureSteps.has(step)) errors.push(`定制图任务 step 重复: ${step}`);
    seenFigureSteps.add(step);
    if (figure?.adapted !== true) errors.push(`${step || `figureTasks[${index}]`}: adapted 必须为 true`);
    const targetIndex = dependencyIndex.get(dependency);
    if (targetIndex === undefined) {
      errors.push(`${step || `figureTasks[${index}]`}: depends_on_step=${dependency || '(空)'} 不在执行计划中`);
      continue;
    }
    const bucket = figuresAfter.get(targetIndex) || [];
    bucket.push({ ...figure, kind: 'adapted_figure', step });
    figuresAfter.set(targetIndex, bucket);
  }

  if (errors.length > 0) return { ok: false, errors, tasks: [] };

  const tasks = [];
  for (const [index, task] of normalizedAnalysis.entries()) {
    tasks.push(task);
    tasks.push(...(figuresAfter.get(index) || []));
  }
  return { ok: true, errors: [], tasks };
}

export function buildProjectExecutionPlan(meta = {}) {
  return buildTaskExecutionSequence(
    meta.pipeline_dag || meta.pipelineDag || [],
    meta.figure_tasks || meta.figureTasks || [],
    String(meta.line_id || meta.lineId || ''),
  );
}

export function mergeFigureProjectTasks(existingTasks = [], incomingTasks = []) {
  const incomingSteps = new Set(
    (Array.isArray(incomingTasks) ? incomingTasks : [])
      .map((task) => String(task?.step || ''))
      .filter(Boolean),
  );
  const retained = (Array.isArray(existingTasks) ? existingTasks : [])
    .filter((task) => !incomingSteps.has(String(task?.step || '')));
  return [...retained, ...(Array.isArray(incomingTasks) ? incomingTasks : [])];
}
