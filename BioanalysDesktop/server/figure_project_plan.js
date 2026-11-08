import { PROJECTS_ROOT } from './domain.js';
import { buildAdaptedFigureTasks, resolveFigure, loadFigureTemplates } from './figure_graph.js';
import { deriveAdaptedFigure } from './task.js';
import { validateFigureSchedule } from './figure_schedule.js';

// Argon 第 75 轮 Q5：调度准入纯函数独立成模块（便于变异反证），此处复导出保持调用方兼容。
export { validateFigureSchedule };

/**
 * Argon 第 75 轮：按 portal_binding.adapt_vars_schema 从项目强类型字段确定性注入 adapt_vars，
 * 废除自由文本盲猜。仅填充缺失键，不覆盖调用方已显式提供的值。
 */
export function injectAdaptVarsFromProject(template, adaptVars = {}, projectMeta = {}) {
  const merged = { ...adaptVars };
  const schema = template?.portal_binding?.adapt_vars_schema || [];
  const sourceValues = {
    'data_contract.input_artifact': template?.data_contract?.input_artifact,
    'groupingDesign.byLine': projectMeta?.groupingDesign?.byLine,
    'analysisCutoffs.log2fc': projectMeta?.analysisCutoffs?.log2fc,
    'analysisCutoffs.padj': projectMeta?.analysisCutoffs?.padj,
    'targetGenes.topHubs': projectMeta?.targetGenes?.topHubs,
    'spatialCalibration.umPerPx': projectMeta?.spatialCalibration?.umPerPx,
  };
  for (const entry of schema) {
    if (merged[entry.key] !== undefined && merged[entry.key] !== null && merged[entry.key] !== '') continue;
    const value = sourceValues[entry.source_field];
    if (value !== undefined && value !== null) merged[entry.key] = value;
  }
  return merged;
}

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
  projectMeta = {},
  analysisModIds = [],
}) {
  if (!Array.isArray(selections) || selections.length === 0) {
    return { ok: true, errors: [], tasks: [], local_scripts: [], manifest_entries: [], schedule_violations: [] };
  }

  const errors = [];
  const tasks = [];
  const localScripts = [];
  const manifestEntries = [];
  const scheduleViolations = [];
  const registry = loadFigureTemplates().templates;
  for (const [index, selection] of selections.entries()) {
    const templateId = String(selection?.template_id || '').trim();
    let adaptVars = selection?.adapt_vars && typeof selection.adapt_vars === 'object'
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
    // Argon 第 75 轮 Q5：显式提供分析 Mod 全集时强校验前置 Mod 覆盖（Fail-Closed 422）。
    // analysisModIds 是项目 DAG 的分析步骤全集，区别于 selectedModIds（渲染 linked_mods 子集）。
    if (Array.isArray(analysisModIds) && analysisModIds.length > 0) {
      const schedule = validateFigureSchedule(analysisModIds, [selection], registry);
      if (!schedule.ok) {
        for (const violation of schedule.violations) {
          errors.push(violation.message);
          scheduleViolations.push(violation);
        }
        continue;
      }
    }
    adaptVars = injectAdaptVarsFromProject(resolved.template, adaptVars, projectMeta);
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
    return { ok: false, errors, tasks: [], local_scripts: [], manifest_entries: [], schedule_violations: scheduleViolations };
  }
  return { ok: true, errors: [], tasks, local_scripts: localScripts, manifest_entries: manifestEntries, schedule_violations: scheduleViolations };
}
