/**
 * work_order/v2 运行时校验与归一化。
 *
 * v2 是产品化正式工单，输入用 snake_case 单文件表达，内部继续复用编排器的
 * camelCase 执行契约。归一化后 schema_version 回落为 work_order/v1，
 * 原始版本保留在 sourceSchemaVersion，供回执与审计读取。
 *
 * 本模块不引入依赖，不读文件，不调用接口，只做纯校验与形态转换。
 * 失败返回 { ok:false, errors[], codes[] }，errors 是中文人话，
 * 每条形如 "ERR_CODE: 说明"，codes 供程序按错误码分流。
 */
import { validateRequirement } from './requirement_schema.mjs';

export const WORK_ORDER_V2_SCHEMA_VERSION = 'work_order/v2';
export const INTERNAL_WORK_ORDER_SCHEMA_VERSION = 'work_order/v1';

export const WORK_ORDER_LINES = Object.freeze(['line1_bulk', 'line2_scrna', 'line3_spatial']);
export const COMPUTE_ADAPTERS = Object.freeze(['adb', 'mock']);

const SAFE_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function errorCode(line) {
  const index = line.indexOf(':');
  return index > 0 ? line.slice(0, index) : line;
}

function normalizeSafeName(value, label, push) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!SAFE_NAME_RE.test(text) || text.startsWith('.')) {
    push('ERR_UNSAFE_NAME', `${label} 非法：只允许字母、数字、点、下划线、连字符，1 到 64 位，且不以点开头，当前 ${JSON.stringify(value ?? null)}`);
    return '';
  }
  return text;
}

function normalizeRelativePath(value, label, push) {
  if (typeof value !== 'string' || !value.trim()) {
    push('ERR_UNSAFE_PATH', `${label} 必须是非空相对路径字符串，当前 ${JSON.stringify(value ?? null)}`);
    return '';
  }
  const text = value.trim();
  const segments = text.split('/');
  const unsafe = text.startsWith('/')
    || text.startsWith('\\')
    || /^[A-Za-z]:/.test(text)
    || text.includes('\\')
    || segments.some((segment) => segment === '..' || segment === '');
  if (unsafe) {
    push('ERR_UNSAFE_PATH', `${label} 必须是包内相对路径，禁止绝对路径、反斜杠、空段与 .. 段，当前 ${JSON.stringify(value)}`);
    return '';
  }
  return text;
}

function normalizeSha256(value, label, push, required) {
  if (value === undefined || value === null) {
    if (required) push('ERR_SHA256', `${label} 缺失，必须是 64 位小写十六进制 SHA-256`);
    return null;
  }
  if (typeof value !== 'string' || !SHA256_RE.test(value)) {
    push('ERR_SHA256', `${label} 必须是 64 位小写十六进制 SHA-256，当前 ${JSON.stringify(value)}`);
    return null;
  }
  return value;
}

function normalizeInputs(rawInputs, push) {
  if (rawInputs === undefined) return [];
  if (!Array.isArray(rawInputs)) {
    push('ERR_INPUTS_SHAPE', 'inputs 必须是数组');
    return [];
  }
  return rawInputs.map((raw, index) => {
    const at = `inputs[${index}]`;
    if (!isPlainObject(raw)) {
      push('ERR_INPUTS_SHAPE', `${at} 必须是 JSON 对象`);
      return null;
    }
    const role = typeof raw.role === 'string' ? raw.role.trim() : '';
    if (!role) push('ERR_INPUTS_SHAPE', `${at}.role 必须是非空字符串`);
    const inputPath = normalizeRelativePath(raw.path, `${at}.path`, push);
    const filename = typeof raw.filename === 'string' ? raw.filename.trim() : '';
    if (!filename || filename === '.' || filename === '..' || /[\\/]/.test(filename)) {
      push('ERR_INPUTS_SHAPE', `${at}.filename 必须是纯文件名，不能含路径分隔符`);
    }
    const size = raw.size;
    if (!Number.isInteger(size) || size < 0) {
      push('ERR_INPUTS_SHAPE', `${at}.size 必须是非负整数，当前 ${JSON.stringify(raw.size ?? null)}`);
    }
    const sha256 = normalizeSha256(raw.sha256, `${at}.sha256`, push, true);
    let format = null;
    if (raw.format !== undefined) {
      if (typeof raw.format !== 'string' || !raw.format.trim()) {
        push('ERR_INPUTS_SHAPE', `${at}.format 必须是非空字符串`);
      } else {
        format = raw.format.trim();
      }
    }
    return { role, path: inputPath, filename, size, sha256, format };
  }).filter(Boolean);
}

function normalizeFigureSelections(executionFigures, requirementTemplates, push) {
  const byId = new Map();
  const ordered = [];

  const add = (raw, label) => {
    if (!isPlainObject(raw)) {
      push('ERR_FIGURE_SELECTION', `${label} 必须是 JSON 对象`);
      return;
    }
    const templateId = typeof raw.template_id === 'string' ? raw.template_id.trim() : '';
    if (!templateId) {
      push('ERR_FIGURE_SELECTION', `${label} 缺少 template_id`);
      return;
    }
    if (byId.has(templateId)) {
      const existing = byId.get(templateId);
      for (const [key, value] of Object.entries(raw)) {
        if (existing[key] === undefined) existing[key] = value;
      }
      if (raw.adapt_vars !== undefined) existing.adapt_vars = raw.adapt_vars;
      return;
    }
    const selection = { ...raw, template_id: templateId };
    byId.set(templateId, selection);
    ordered.push(selection);
  };

  const executionList = executionFigures === undefined ? [] : executionFigures;
  if (!Array.isArray(executionList)) {
    push('ERR_FIGURE_SELECTION', 'execution.figure_selections 必须是数组');
  } else {
    executionList.forEach((item, index) => add(item, `execution.figure_selections[${index}]`));
  }

  const requirementList = requirementTemplates === undefined ? [] : requirementTemplates;
  if (!Array.isArray(requirementList)) {
    push('ERR_FIGURE_SELECTION', 'requirement.figure_templates 必须是数组');
  } else {
    requirementList.forEach((item, index) => add(item, `requirement.figure_templates[${index}]`));
  }

  return ordered;
}

function normalizeSourcePackage(raw, push) {
  if (raw === undefined) {
    push('ERR_SOURCE_PACKAGE', '缺少 source_package（提交包来源）');
    return null;
  }
  if (!isPlainObject(raw)) {
    push('ERR_SOURCE_PACKAGE', 'source_package 必须是 JSON 对象');
    return null;
  }
  const sourcePackage = {
    packageDir: normalizeRelativePath(raw.package_dir, 'source_package.package_dir', push),
    requirementPath: normalizeRelativePath(raw.requirement_path, 'source_package.requirement_path', push),
    manifestPath: normalizeRelativePath(raw.manifest_path, 'source_package.manifest_path', push),
  };
  const shaKeys = ['sha256', 'package_sha256', 'manifest_sha256', 'requirement_sha256'];
  for (const key of shaKeys) {
    if (raw[key] !== undefined) {
      const value = normalizeSha256(raw[key], `source_package.${key}`, push, false);
      if (value) sourcePackage[key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    }
  }
  return sourcePackage;
}

function normalizeDelivery(raw, push) {
  if (raw === undefined) return null;
  if (!isPlainObject(raw)) {
    push('ERR_DELIVERY', 'delivery 必须是 JSON 对象');
    return null;
  }
  const delivery = {
    profile: null,
    reportMd: null,
    reportHtml: null,
    deliveryTarPattern: null,
  };
  if (raw.profile !== undefined) {
    if (typeof raw.profile !== 'string' || !raw.profile.trim()) {
      push('ERR_DELIVERY', 'delivery.profile 必须是非空字符串');
    } else {
      delivery.profile = raw.profile.trim();
    }
  }
  const paths = {
    report_md: 'reportMd',
    report_html: 'reportHtml',
    delivery_tar_pattern: 'deliveryTarPattern',
  };
  for (const [key, target] of Object.entries(paths)) {
    if (raw[key] !== undefined) {
      delivery[target] = normalizeRelativePath(raw[key], `delivery.${key}`, push);
    }
  }
  return delivery;
}

function normalizeControls(raw, push) {
  const controls = {
    requireAdminReview: true,
    resume: false,
    resumeSince: null,
    forceReportBuild: false,
  };
  if (raw === undefined || raw === null) return controls;
  if (!isPlainObject(raw)) {
    push('ERR_CONTROLS', 'controls 必须是 JSON 对象');
    return controls;
  }
  if (raw.require_admin_review !== undefined) {
    if (typeof raw.require_admin_review !== 'boolean') {
      push('ERR_CONTROLS', 'controls.require_admin_review 必须是布尔');
    } else {
      controls.requireAdminReview = raw.require_admin_review;
    }
  }
  for (const [key, target] of [['resume', 'resume'], ['force_report_build', 'forceReportBuild']]) {
    if (raw[key] === undefined) continue;
    if (raw[key] !== null && typeof raw[key] !== 'boolean') {
      push('ERR_CONTROLS', `controls.${key} 必须是布尔或 null`);
    } else {
      controls[target] = raw[key];
    }
  }
  if (raw.resume_since !== undefined) {
    const value = raw.resume_since;
    if (value === null || typeof value === 'boolean') {
      controls.resumeSince = value;
    } else if (typeof value === 'string' && value.trim() && !Number.isNaN(Date.parse(value))) {
      controls.resumeSince = value.trim();
    } else {
      push('ERR_CONTROLS', 'controls.resume_since 必须是 null、布尔或可解析的时间字符串');
    }
  }
  return controls;
}

/**
 * 校验并归一化 work_order/v2。
 *
 * @param {unknown} payload 原始 v2 工单
 * @returns {{ok: boolean, errors: string[], codes: string[], workOrder?: object}}
 */
export function normalizeWorkOrderV2(payload) {
  const errors = [];
  const push = (code, message) => {
    errors.push(`${code}: ${message}`);
  };
  const done = (workOrder) => ({
    ok: errors.length === 0,
    errors,
    codes: errors.map(errorCode),
    ...(errors.length === 0 && workOrder ? { workOrder } : {}),
  });

  if (!isPlainObject(payload)) {
    push('ERR_WORK_ORDER_SHAPE', '工单必须是 JSON 对象');
    return done();
  }

  if (String(payload.schema_version || '') !== WORK_ORDER_V2_SCHEMA_VERSION) {
    push('ERR_WORK_ORDER_V2_VERSION', `schema_version 必须是 ${WORK_ORDER_V2_SCHEMA_VERSION}，当前 ${JSON.stringify(payload.schema_version ?? null)}`);
    return done();
  }

  const workOrderId = normalizeSafeName(payload.work_order_id, 'work_order_id', push);
  const projectId = normalizeSafeName(payload.project_id, 'project_id', push);

  const requirement = isPlainObject(payload.requirement) ? payload.requirement : null;
  if (!requirement) {
    push('ERR_REQUIREMENT', '缺少 requirement（需求单四段）');
  } else {
    const checked = validateRequirement({
      basicInfo: requirement.basicInfo,
      dataSource: requirement.dataSource,
      groupingDesign: requirement.groupingDesign,
      analysisCutoffs: requirement.analysisCutoffs,
      biologicalPriors: requirement.biologicalPriors,
    });
    for (const message of checked.errors) push('ERR_REQUIREMENT', message);
  }

  const execution = isPlainObject(payload.execution) ? payload.execution : null;
  if (!execution) push('ERR_WORK_ORDER_SHAPE', '缺少 execution（执行参数）');

  const lineId = String(execution?.line_id || '').trim();
  if (!WORK_ORDER_LINES.includes(lineId)) {
    push('ERR_UNKNOWN_LINE', `execution.line_id 必须是 ${WORK_ORDER_LINES.join('、')} 之一，当前 ${JSON.stringify(execution?.line_id ?? null)}`);
  }

  let modIds = [];
  if (!Array.isArray(execution?.mod_ids) || execution.mod_ids.length === 0) {
    push('ERR_MOD_IDS', 'execution.mod_ids 必须是非空字符串数组');
  } else {
    modIds = execution.mod_ids.map((item, index) => {
      if (typeof item !== 'string' || !item.trim()) {
        push('ERR_MOD_IDS', `execution.mod_ids[${index}] 必须是非空字符串`);
        return '';
      }
      return item.trim();
    }).filter(Boolean);
    if (!modIds.length) push('ERR_MOD_IDS', 'execution.mod_ids 至少需要一个有效 Mod');
  }

  let seed;
  if (execution?.seed !== undefined && execution.seed !== null) {
    if (!Number.isInteger(execution.seed) || execution.seed <= 0) {
      push('ERR_SEED', `execution.seed 必须是正整数或缺省，当前 ${JSON.stringify(execution.seed)}`);
    } else {
      seed = execution.seed;
    }
  }

  let computeAdapter = 'adb';
  if (execution?.compute_adapter !== undefined) {
    const text = typeof execution.compute_adapter === 'string' ? execution.compute_adapter.trim() : '';
    if (!COMPUTE_ADAPTERS.includes(text)) {
      push('ERR_COMPUTE_ADAPTER', `execution.compute_adapter 必须是 ${COMPUTE_ADAPTERS.join('、')} 之一，当前 ${JSON.stringify(execution.compute_adapter)}`);
    } else {
      computeAdapter = text;
    }
  }

  const allowSsh = false;

  let speciesScope = [];
  if (execution?.species_scope !== undefined) {
    if (!Array.isArray(execution.species_scope)) {
      push('ERR_WORK_ORDER_SHAPE', 'execution.species_scope 必须是字符串数组');
    } else {
      speciesScope = execution.species_scope.map((item, index) => {
        if (typeof item !== 'string' || !item.trim()) {
          push('ERR_WORK_ORDER_SHAPE', `execution.species_scope[${index}] 必须是非空字符串`);
          return '';
        }
        return item.trim();
      }).filter(Boolean);
    }
  }

  const figureSelections = normalizeFigureSelections(
    execution?.figure_selections,
    requirement?.figure_templates,
    push,
  );

  const inputs = normalizeInputs(payload.inputs, push);

  const sourcePackage = normalizeSourcePackage(payload.source_package, push);
  const delivery = normalizeDelivery(payload.delivery, push);
  const controls = normalizeControls(payload.controls, push);

  const rawCreatePayload = payload.create_payload ?? payload.createPayload;
  let createPayload;
  if (rawCreatePayload !== undefined) {
    if (!isPlainObject(rawCreatePayload)) {
      push('ERR_WORK_ORDER_SHAPE', 'create_payload 必须是 JSON 对象');
    } else {
      createPayload = rawCreatePayload;
    }
  }

  const workOrder = {
    schema_version: INTERNAL_WORK_ORDER_SCHEMA_VERSION,
    sourceSchemaVersion: WORK_ORDER_V2_SCHEMA_VERSION,
    workOrderId,
    projectId,
    lineId,
    modIds,
    figureSelections,
    inputs,
    uploads: [],
    computeAdapter,
    allowSsh,
    speciesScope,
    basicInfo: requirement?.basicInfo ?? {},
    dataSource: requirement?.dataSource ?? {},
    groupingDesign: requirement?.groupingDesign ?? {},
    analysisCutoffs: requirement?.analysisCutoffs,
    biologicalPriors: requirement?.biologicalPriors,
    sourcePackage,
    delivery,
    controls,
    resume: controls.resume,
    resumeSince: controls.resumeSince,
    forceReportBuild: controls.forceReportBuild,
    ...(seed === undefined ? {} : { seed }),
    ...(createPayload ? { createPayload } : {}),
  };

  return done(workOrder);
}
