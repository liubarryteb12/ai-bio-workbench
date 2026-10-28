import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LINES } from './domain.js';
import { indexMods } from './workflow_graph.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const REGISTRY = path.join(REPO, 'src', 'figure_templates.json');
const FIGURE_ROOT = 'reference/05.可参考出图代码';
const PROJECTS_ROOT = '/mnt/ssd/bio_data/projects';
let cache = null;

function indexModsByBareId() {
  const indexed = new Map();
  for (const [, entry] of indexMods()) indexed.set(entry.mod.id, entry);
  return indexed;
}

export function loadFigureTemplates() {
  if (cache) return cache;
  cache = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  return cache;
}

export function reloadFigureTemplates() {
  cache = null;
  return loadFigureTemplates();
}

function isPathInsideFigureRoot(relative) {
  const normalized = relative.split('\\').join('/');
  return normalized === FIGURE_ROOT || normalized.startsWith(`${FIGURE_ROOT}/`);
}

function validateReadyPath(item, pathKey, hashKey, errors) {
  const relative = item[pathKey];
  if (typeof relative !== 'string' || relative.length === 0 || !isPathInsideFigureRoot(relative)) {
    errors.push(`${item.id}: ${pathKey} 必须位于 ${FIGURE_ROOT}`);
    return;
  }
  const target = path.join(REPO, relative);
  if (!fs.existsSync(target)) {
    errors.push(`${item.id}: ${pathKey} 磁盘缺失`);
  } else {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
    if (item[hashKey] !== actual) {
      errors.push(`${item.id}: ${hashKey} 与磁盘文件不一致`);
    }
  }
}

function validateAdaptDeclaration(item, errors) {
  if (!item.adapt_vars || Array.isArray(item.adapt_vars) || typeof item.adapt_vars !== 'object') {
    errors.push(`${item.id}: adapt_vars 必须是字段声明对象`);
    return;
  }
  const keys = Object.keys(item.adapt_vars);
  if (keys.length === 0) {
    errors.push(`${item.id}: adapt_vars 至少声明一个可变字段`);
    return;
  }
  for (const key of keys) {
    const value = item.adapt_vars[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      errors.push(`${item.id}: adapt_vars.${key} 缺少说明`);
    }
  }
}

export function validateFigureStepInputs(item, modEntry) {
  if (!modEntry) return [`${item.id}: analysis_step 引用的 mod 不存在`];
  const declaredOutputs = new Set(modEntry.mod.produces || []);
  const errors = [];
  for (const inputTable of item.input_tables || []) {
    if (!declaredOutputs.has(inputTable)) {
      errors.push(`${item.id}: input_tables.${inputTable} 不是 ${item.analysis_step} 的 produces`);
    }
  }
  return errors;
}

function validateReadyMapping(item, mods, errors) {
  if (!Array.isArray(item.lines) || item.lines.length === 0) {
    errors.push(`${item.id}: ready 模板 lines 必须为非空数组`);
  } else if (item.lines.some((line) => !LINES.includes(line))) {
    errors.push(`${item.id}: ready 模板 lines 含非法分析线`);
  }
  if (typeof item.analysis_step !== 'string' || !item.analysis_step) {
    errors.push(`${item.id}: ready 模板 analysis_step 缺失`);
  } else if (!mods.has(item.analysis_step)) {
    errors.push(`${item.id}: analysis_step 引用不存在的 mod '${item.analysis_step}'`);
  } else {
    errors.push(...validateFigureStepInputs(item, mods.get(item.analysis_step)));
  }
  for (const key of ['input_tables', 'produces']) {
    if (!Array.isArray(item[key]) || item[key].length === 0) {
      errors.push(`${item.id}: ready 模板 ${key} 必须为非空数组`);
    }
  }
  if (typeof item.output_glob !== 'string' || !item.output_glob) {
    errors.push(`${item.id}: ready 模板 output_glob 缺失`);
  }
  if (typeof item.canonical_output !== 'string' || !item.canonical_output) {
    errors.push(`${item.id}: ready 模板 canonical_output 缺失`);
  }
  if (typeof item.sample_project_output !== 'string' || !item.sample_project_output.startsWith('local_projects/')) {
    errors.push(`${item.id}: ready 模板 sample_project_output 必须指向 local_projects`);
  } else if (!fs.existsSync(path.join(REPO, item.sample_project_output))) {
    errors.push(`${item.id}: sample_project_output 磁盘缺失`);
  }
}

export function validateRegistry() {
  const registry = loadFigureTemplates();
  const errors = [];
  const mods = indexModsByBareId();
  const seen = new Set();
  const counts = { ready: 0, pending: 0, pending_mapping: 0, blocked: 0 };

  if (registry.schema_version !== 1) errors.push('schema_version 必须为 1');
  if (!Array.isArray(registry.templates)) errors.push('templates 必须是数组');

  for (const item of Array.isArray(registry.templates) ? registry.templates : []) {
    if (typeof item.id !== 'string' || item.id.length === 0) {
      errors.push('模板 id 缺失');
      continue;
    }
    if (seen.has(item.id)) errors.push(`${item.id}: id 重复`);
    seen.add(item.id);

    const required = [
      'name', 'level', 'category', 'language', 'source', 'source_sha256', 'preview',
      'preview_sha256', 'verified', 'deps_status', 'linked_mods', 'adapt_vars', 'deprecated',
      'lines', 'analysis_step', 'input_tables', 'produces', 'output_glob',
      'canonical_output', 'sample_project_output',
    ];
    for (const key of required) {
      if (!(key in item)) errors.push(`${item.id}: 缺 ${key}`);
    }

    if (item.deps_status === 'ready' && item.verified) counts.ready += 1;
    else if (item.deps_status === 'pending_mapping') counts.pending_mapping += 1;
    else if (item.deps_status === 'blocked_r453') counts.blocked += 1;
    else counts.pending += 1;

    if (!['L1', 'L2', 'L3'].includes(item.level)) errors.push(`${item.id}: level 非法`);
    if (!['r', 'python'].includes(item.language)) errors.push(`${item.id}: language 非法`);
    if (!['ready', 'pending', 'pending_mapping', 'blocked_r453'].includes(item.deps_status)) {
      errors.push(`${item.id}: deps_status 非法`);
    }
    if (typeof item.deprecated !== 'boolean') errors.push(`${item.id}: deprecated 必须是布尔值`);

    validateAdaptDeclaration(item, errors);

    if (item.deps_status === 'ready' && item.verified) {
      validateReadyPath(item, 'source', 'source_sha256', errors);
      validateReadyPath(item, 'preview', 'preview_sha256', errors);
      validateReadyMapping(item, mods, errors);
    } else if (item.deps_status === 'ready' && !item.verified) {
      errors.push(`${item.id}: deps_status=ready 必须先通过验证`);
    } else if (item.deps_status !== 'ready' && !item.verified) {
      const nullable = ['source', 'source_sha256', 'preview', 'preview_sha256'];
      for (const key of nullable) {
        if (item[key] !== null) errors.push(`${item.id}: 未验证模板的 ${key} 必须为 null`);
      }
    } else if (item.deps_status !== 'ready' && item.verified) {
      errors.push(`${item.id}: 未 ready 模板不得标 verified=true`);
    }

    if (!Array.isArray(item.linked_mods) || item.linked_mods.length === 0) {
      errors.push(`${item.id}: linked_mods 必须至少关联一个 mod`);
    }
    for (const modId of item.linked_mods || []) {
      const entry = mods.get(modId);
      if (!entry) {
        errors.push(`${item.id}: linked_mods 引用不存在的 mod '${modId}'`);
        continue;
      }
      if (entry.mod.language.toLowerCase() !== item.language) {
        errors.push(`${item.id}: linked_mods 语言不匹配，模板 ${item.language} 与 ${modId} ${entry.mod.language}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    stats: {
      templates: seen.size,
      ready: counts.ready,
      pending: counts.pending,
      pending_mapping: counts.pending_mapping,
      blocked: counts.blocked,
    },
  };
}

function normalizePathLike(value) {
  return String(value).split('\\').join('/').toLowerCase();
}

function isPathLike(value) {
  return typeof value === 'string' && /[/\\]|\.[a-z0-9]+$/i.test(value);
}

function validateAdaptValue(value, lineId, projectId, context, errors) {
  if (Array.isArray(value)) {
    for (const child of value) validateAdaptValue(child, lineId, projectId, context, errors);
    return;
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return;
  if (typeof value !== 'string') {
    errors.push(`${context}: adapt_vars 值必须是标量或字符串数组`);
    return;
  }
  if (!isPathLike(value)) return;
  const normalized = normalizePathLike(value);
  if (/^[a-z]:[\\\/]/.test(normalized) || normalized.startsWith('/')) {
    errors.push(`${context}: adapt_vars 路径必须使用本项目相对路径`);
  }
  if (normalized.includes('../') || normalized.endsWith('/..')) {
    errors.push(`${context}: adapt_vars 路径禁止跨项目`);
  }
  for (const foreign of LINES.filter((line) => line !== lineId)) {
    if (normalized.includes(foreign.toLowerCase())) {
      errors.push(`${context}: adapt_vars 路径禁止跨线取值，发现 ${foreign}`);
    }
  }
  if (normalized.includes('local_projects/')) {
    const after = normalized.slice(normalized.indexOf('local_projects/') + 'local_projects/'.length);
    const segment = after.split('/')[0];
    if (segment !== projectId.toLowerCase()) {
      errors.push(`${context}: adapt_vars 路径禁止跨项目，发现 ${segment || 'unknown'}`);
    }
  }
  const segments = normalized.replace(/^\.\/+/, '').split('/').filter(Boolean);
  const allowedRoots = new Set(['data', 'figures', 'processed', 'results', 'local_projects']);
  if (segments.length > 1 && !allowedRoots.has(segments[0])) {
    errors.push(`${context}: adapt_vars 路径必须位于本项目 data、figures、processed、results 或 local_projects 下`);
  }
}

export function resolveFigure(templateId, lineId, projectId, adaptVars = {}, selectedModIds = []) {
  const validation = validateRegistry();
  const errors = [...validation.errors];
  if (!validation.ok) return { ok: false, errors, template: null, selected_mods: [], master_path: null };

  const template = loadFigureTemplates().templates.find((item) => item.id === templateId);
  if (!template) {
    errors.push(`未知图模板 '${templateId}'`);
    return { ok: false, errors, template: null, selected_mods: [], master_path: null };
  }
  if (!LINES.includes(lineId)) {
    errors.push(`未知分析线 ${lineId}`);
  }
  if (typeof projectId !== 'string' || projectId.trim().length === 0) {
    errors.push('projectId 缺失');
  }
  if (template.deps_status !== 'ready') {
    errors.push(`${templateId}: deps_status=${template.deps_status}，当前不可派发`);
  }

  const mods = indexModsByBareId();
  const lineLinked = (template.linked_mods || []).filter((modId) => {
    const entry = mods.get(modId);
    return entry && entry.series.id === lineId;
  });
  if (!LINES.includes(lineId) || lineLinked.length === 0) {
    errors.push(`图模板 ${templateId} 与 ${lineId} 跨线，无本线 linked_mods`);
  }

  const requested = selectedModIds.length > 0 ? selectedModIds : lineLinked;
  const selectedMods = [];
  for (const modId of requested) {
    const entry = mods.get(modId);
    if (!entry) {
      errors.push(`linked_mods 引用不存在的 mod '${modId}'`);
      continue;
    }
    if (entry.series.id !== lineId) {
      errors.push(`跨线选中：${modId} 属于 ${entry.series.id}，不是 ${lineId}`);
      continue;
    }
    if (!(template.linked_mods || []).includes(modId)) {
      errors.push(`${modId} 未关联该图模板（linked_mods）`);
      continue;
    }
    if (entry.mod.language.toLowerCase() !== template.language) {
      errors.push(`语言不匹配：模板 ${template.language} 与 mod ${modId} ${entry.mod.language}`);
      continue;
    }
    selectedMods.push(modId);
  }

  const declared = Object.keys(template.adapt_vars || {});
  for (const key of declared) {
    if (!(key in adaptVars)) errors.push(`adapt_vars 缺必填字段 ${key}`);
  }
  for (const [key, value] of Object.entries(adaptVars)) {
    validateAdaptValue(value, lineId, projectId, `${templateId}.${key}`, errors);
  }

  return {
    ok: errors.length === 0,
    errors,
    template,
    selected_mods: selectedMods,
    master_path: template.source ? path.join(REPO, template.source) : null,
  };
}

export function buildAdaptedFigureTasks({
  projectId,
  lineId,
  selectedFigures = [],
  templatesRegistry = [],
}) {
  const errors = [];
  const tasks = [];
  if (!LINES.includes(lineId)) errors.push(`未知分析线 ${lineId}`);
  if (!selectedFigures.length) errors.push('未选择图模板');
  for (const selection of selectedFigures) {
    const templateId = String(selection.template_id || selection.id || '');
    const template = templatesRegistry.find((item) => item.id === templateId);
    if (!template) {
      errors.push(`未知图模板 '${templateId}'`);
      continue;
    }
    if (template.deps_status !== 'ready' || template.verified !== true) {
      errors.push(`${templateId}: 模板不是 ready，禁止派发`);
      continue;
    }
    if (!Array.isArray(template.lines) || !template.lines.includes(lineId)) {
      errors.push(`${templateId}: 不支持分析线 ${lineId}`);
      continue;
    }
    if (!template.analysis_step) errors.push(`${templateId}: analysis_step 缺失`);
    const adaptVars = selection.adapt_vars && typeof selection.adapt_vars === 'object'
      ? selection.adapt_vars : {};
    for (const [key, value] of Object.entries(adaptVars)) {
      validateAdaptValue(value, lineId, projectId, `${templateId}.${key}`, errors);
    }
    const extension = template.language === 'python' ? '.py' : '.R';
    const localScript = `local_projects/${projectId}/figures/adapt/adapt_${templateId}${extension}`;
    const remoteScript = `${PROJECTS_ROOT}/${projectId}/${lineId}/scripts/adapt_${templateId}${extension}`;
    const customOutput = (template.produces || [`custom_${templateId}.png`])[0];
    tasks.push({
      task_id: `task_adapt_${templateId}`,
      depends_on_step: template.analysis_step,
      step: `adapt_${templateId}`,
      language: template.language,
      script_path: remoteScript,
      local_script: localScript,
      remote_script: remoteScript,
      canonical_output: template.canonical_output,
      custom_output: customOutput,
      outputs: [`${PROJECTS_ROOT}/${projectId}/${lineId}/figures/${customOutput}`],
      env_vars: {
        BIO_PROJECT_ID: projectId,
        BIO_LINE_ID: lineId,
        BIO_ADAPT_VARS: JSON.stringify(adaptVars),
      },
      selected_template: templateId,
    });
  }
  return { ok: errors.length === 0, errors, tasks };
}

export function authorizeOverwrite({ projectId, templateId, overwrite, references = [] }) {
  if (!overwrite) return { ok: true, reason: '新增派生副本，不覆写母版' };
  const projectIds = references.map((item) => (
    typeof item === 'object' && item !== null ? item.projectId : item
  )).filter(Boolean);
  const impact = new Set(projectIds).size;
  if (impact > 3) {
    return {
      ok: false,
      reason: `母版被 ${impact} 个项目引用，超过 3：必须另存新模板，旧模板标 deprecated=true`,
    };
  }
  return { ok: true, reason: `母版影响面 ${impact}/3` };
}
