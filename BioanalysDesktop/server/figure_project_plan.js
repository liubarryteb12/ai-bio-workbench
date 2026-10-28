import { PROJECTS_ROOT } from './domain.js';
import { buildAdaptedFigureTasks, resolveFigure } from './figure_graph.js';
import { deriveAdaptedFigure } from './task.js';

function remoteTaskInput(rawPath, projectId, lineId) {
  const normalized = String(rawPath || '').split('\\').join('/').replace(/^\.\/+/, '');
  if (normalized.startsWith(`data/${lineId}/`)) {
    return `${PROJECTS_ROOT}/${projectId}/${normalized.slice('data/'.length)}`;
  }
  if (normalized.startsWith(`figures/${lineId}/`)) {
    return `${PROJECTS_ROOT}/${projectId}/${normalized}`;
  }
  if (normalized.startsWith('processed/') || normalized.startsWith('results/')) {
    return `${PROJECTS_ROOT}/${projectId}/${lineId}/${normalized}`;
  }
  if (!normalized.includes('/')) {
    return `${PROJECTS_ROOT}/${projectId}/${lineId}/processed/${normalized}`;
  }
  return `${PROJECTS_ROOT}/${projectId}/${normalized}`;
}

/**
 * 建项时把门户/工作台选择的 ready 图模板变成项目私有任务。
 *
 * 所有模板先逐项通过同一 Registry 与跨线校验，再生成派生脚本。任何一项失败
 * 都整批拒绝，避免 project.json 里出现“部分图已登记、部分脚本缺失”的半闭环。
 */
export function prepareFigureProjectTasks({
  root,
  projectId,
  lineId,
  selectedModIds = [],
  selections = [],
}) {
  if (!Array.isArray(selections) || selections.length === 0) {
    return { ok: true, errors: [], tasks: [], local_scripts: [], manifest_entries: [] };
  }

  const errors = [];
  const tasks = [];
  const localScripts = [];
  const manifestEntries = [];
  for (const [index, selection] of selections.entries()) {
    const templateId = String(selection?.template_id || '').trim();
    const adaptVars = selection?.adapt_vars && typeof selection.adapt_vars === 'object'
      && !Array.isArray(selection.adapt_vars) ? selection.adapt_vars : null;
    if (!templateId || !adaptVars) {
      errors.push(`figure_templates[${index}] 缺少 template_id 或 adapt_vars`);
      continue;
    }
    const resolved = resolveFigure(templateId, lineId, projectId, adaptVars, selectedModIds);
    if (!resolved.ok) {
      errors.push(...resolved.errors.map((item) => `${templateId}: ${item}`));
      continue;
    }
    const derivation = deriveAdaptedFigure({
      root,
      projectId,
      lineId,
      templateId,
      template: resolved.template,
      adaptVars,
    });
    if (!derivation.ok) {
      errors.push(...derivation.errors.map((item) => `${templateId}: ${item}`));
      continue;
    }
    const adapted = buildAdaptedFigureTasks({
      projectId,
      lineId,
      selectedFigures: [{ template_id: templateId, adapt_vars: adaptVars }],
      templatesRegistry: [resolved.template],
    });
    if (!adapted.ok || adapted.tasks.length !== 1) {
      errors.push(...adapted.errors.map((item) => `${templateId}: ${item}`));
      continue;
    }
    const base = adapted.tasks[0];
    tasks.push({
      ...base,
      kind: 'adapted_figure',
      adapted: true,
      scriptPath: derivation.remote_path,
      canonicalOutput: resolved.template.canonical_output,
      inputs: [remoteTaskInput(adaptVars.input_data, projectId, lineId)],
      master_sha256: derivation.master_sha256,
    });
    localScripts.push(derivation.local_path);
    manifestEntries.push(derivation.manifest_entry);
  }

  if (errors.length > 0) {
    return { ok: false, errors, tasks: [], local_scripts: [], manifest_entries: [] };
  }
  return { ok: true, errors: [], tasks, local_scripts: localScripts, manifest_entries: manifestEntries };
}
