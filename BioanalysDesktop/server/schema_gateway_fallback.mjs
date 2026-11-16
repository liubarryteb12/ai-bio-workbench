/**
 * Schema 网关的 JS 回退实现（仅桌面离线运行面使用）。
 *
 * 真源仍是 schemas/schema_gateway.py（Pydantic 模型）。本文件只镜像其中
 * project / requirement / run_task / figure_template 四个已注册 Schema 的字段约束，
 * 供干净 Windows 未安装 Python 时保持核心流程可用。
 *
 * 启用条件：BIO_ALLOW_SCHEMA_GATEWAY_FALLBACK=1 且找不到 Python。
 * 未满足条件时调用方必须按 Fail-Closed 返回 ERROR，不允许静默放行。
 * 字段口径变化时，两边必须同一提交更新，并由
 * tests/schema_gateway_fallback_golden.test.js 固定行为。
 */

const LINES = new Set(['line1_bulk', 'line2_scrna', 'line3_spatial']);
const DOMAINS = new Set(['心脑血管', '神经退行', '代谢', '纤维化', '发育', '免疫', '其他非肿瘤']);
const DATA_TYPES = new Set(['microarray', 'bulk_rnaseq', 'scrna', 'spatial']);
const GROUP_ROLES = new Set(['reference', 'disease_stage']);
const FIGURE_STATUSES = new Set(['ready', 'draft']);

function err(path, message, type = 'value_error') {
  return { path, message, type };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkString(value, path, { required = true, minLength = 0, allowNull = false } = {}) {
  if (value === undefined || value === null) {
    if (!required) return null;
    return [err(path, 'Field required', 'missing')];
  }
  if (allowNull && value === null) return null;
  if (typeof value !== 'string') return [err(path, 'Input should be a valid string', 'string_type')];
  if (value.trim().length < Math.max(1, minLength)) {
    return [err(path, minLength > 1 ? `String should have at least ${minLength} characters` : 'String should have at least 1 character', 'string_too_short')];
  }
  return null;
}

function checkEnum(value, path, allowed, { required = true } = {}) {
  if (value === undefined || value === null) {
    if (!required) return null;
    return [err(path, 'Field required', 'missing')];
  }
  if (typeof value !== 'string' || !allowed.has(value)) {
    return [err(path, `Input should be one of ${JSON.stringify([...allowed])}`, 'enum')];
  }
  return null;
}

function checkStringList(value, path, { required = true, minLength = 0 } = {}) {
  if (value === undefined || value === null) {
    if (!required) return null;
    return [err(path, 'Field required', 'missing')];
  }
  if (!Array.isArray(value)) return [err(path, 'Input should be a valid list', 'list_type')];
  if (value.length < minLength) return [err(path, `List should have at least ${minLength} items`, 'too_short')];
  const errors = [];
  value.forEach((item, index) => {
    if (typeof item !== 'string') errors.push(err(`${path}.${index}`, 'Input should be a valid string', 'string_type'));
  });
  return errors;
}

function checkBool(value, path, { required = true } = {}) {
  if (value === undefined || value === null) {
    if (!required) return null;
    return [err(path, 'Field required', 'missing')];
  }
  if (typeof value === 'boolean') return null;
  if (value === 0 || value === 1) return null;
  if (value === 'true' || value === 'false') return null;
  return [err(path, 'Input should be a valid boolean', 'bool_type')];
}

function checkInt(value, path, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (!required) return null;
    return [err(path, 'Field required', 'missing')];
  }
  if (Number.isInteger(value)) return null;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return null;
  return [err(path, 'Input should be a valid integer', 'int_type')];
}

export function validateProjectPayload(payload = {}) {
  const errors = [];
  const projectId = payload.project_id;
  if (projectId === undefined || projectId === null) {
    errors.push(err('project_id', 'Field required', 'missing'));
  } else if (typeof projectId !== 'string' || projectId.trim().length === 0) {
    errors.push(err('project_id', 'String should have at least 1 character', 'string_too_short'));
  } else if (projectId.includes('..') || projectId.includes('/') || projectId.includes('\\')) {
    errors.push(err('project_id', 'project_id 包含越界字符', 'value_error'));
  }
  const nameError = checkString(payload.project_name, 'project_name', { required: false });
  if (nameError) errors.push(...nameError);
  const pipelineError = checkEnum(payload.pipeline, 'pipeline', LINES, { required: false });
  if (pipelineError) errors.push(...pipelineError);
  const speciesError = checkString(payload.species, 'species', { required: false });
  if (speciesError) errors.push(...speciesError);
  const createdError = checkString(payload.created_at, 'created_at', { required: false });
  if (createdError) errors.push(...createdError);
  return errors;
}

export function validateRequirementPayload(payload = {}) {
  const errors = [];
  const basic = payload.basicInfo;
  if (!isPlainObject(basic)) {
    errors.push(err('basicInfo', 'Input should be a valid dictionary', 'model_type'));
  } else {
    const nameError = checkString(basic.name, 'basicInfo.name');
    if (nameError) errors.push(...nameError);
    const domainError = checkEnum(basic.domain, 'basicInfo.domain', DOMAINS);
    if (domainError) errors.push(...domainError);
  }

  const source = payload.dataSource;
  if (!isPlainObject(source)) {
    errors.push(err('dataSource', 'Input should be a valid dictionary', 'model_type'));
  } else {
    const sourceError = checkString(source.source, 'dataSource.source');
    if (sourceError) errors.push(...sourceError);
    const typeError = checkEnum(source.dataType, 'dataSource.dataType', DATA_TYPES);
    if (typeError) errors.push(...typeError);
    if (!Array.isArray(source.datasets)) {
      errors.push(err('dataSource.datasets', 'Input should be a valid list', 'list_type'));
    } else {
      if (source.datasets.length < 1) {
        errors.push(err('dataSource.datasets', 'List should have at least 1 item', 'too_short'));
      }
      source.datasets.forEach((item, index) => {
        if (!isPlainObject(item)) {
          errors.push(err(`dataSource.datasets.${index}`, 'Input should be a valid dictionary', 'dict_type'));
        }
      });
    }
  }

  const grouping = payload.groupingDesign;
  if (!isPlainObject(grouping)) {
    errors.push(err('groupingDesign', 'Input should be a valid dictionary', 'model_type'));
  } else {
    const modeError = checkString(grouping.mode, 'groupingDesign.mode');
    if (modeError) errors.push(...modeError);
    if (!Array.isArray(grouping.groups)) {
      errors.push(err('groupingDesign.groups', 'Input should be a valid list', 'list_type'));
    } else {
      if (grouping.groups.length < 2) {
        errors.push(err('groupingDesign.groups', 'List should have at least 2 items', 'too_short'));
      }
      grouping.groups.forEach((group, index) => {
        const base = `groupingDesign.groups.${index}`;
        if (!isPlainObject(group)) {
          errors.push(err(base, 'Input should be a valid dictionary', 'dict_type'));
          return;
        }
        const groupNameError = checkString(group.groupName, `${base}.groupName`);
        if (groupNameError) errors.push(...groupNameError);
        const roleError = checkEnum(group.role, `${base}.role`, GROUP_ROLES);
        if (roleError) errors.push(...roleError);
        const sampleErrors = checkStringList(group.sampleIds, `${base}.sampleIds`);
        if (sampleErrors) errors.push(...sampleErrors);
      });
    }
    if (!Array.isArray(grouping.contrasts)) {
      errors.push(err('groupingDesign.contrasts', 'Input should be a valid list', 'list_type'));
    } else {
      if (grouping.contrasts.length < 1) {
        errors.push(err('groupingDesign.contrasts', 'List should have at least 1 item', 'too_short'));
      }
      grouping.contrasts.forEach((contrast, index) => {
        const base = `groupingDesign.contrasts.${index}`;
        if (!isPlainObject(contrast)) {
          errors.push(err(base, 'Input should be a valid dictionary', 'dict_type'));
          return;
        }
        for (const key of ['name', 'case', 'ctrl']) {
          const itemError = checkString(contrast[key], `${base}.${key}`);
          if (itemError) errors.push(...itemError);
        }
        const primaryError = checkBool(contrast.isPrimary, `${base}.isPrimary`);
        if (primaryError) errors.push(...primaryError);
      });
    }
  }

  const cutoffs = payload.analysisCutoffs;
  if (cutoffs !== undefined && cutoffs !== null && !isPlainObject(cutoffs)) {
    errors.push(err('analysisCutoffs', 'Input should be a valid dictionary or null', 'dict_type'));
  }
  return errors;
}

export function validateRunTaskPayload(payload = {}) {
  const errors = [];
  const lineError = checkEnum(payload.lineId, 'lineId', LINES);
  if (lineError) errors.push(...lineError);
  const stepError = checkString(payload.step, 'step');
  if (stepError) errors.push(...stepError);
  const projectError = checkString(payload.projectId, 'projectId');
  if (projectError) errors.push(...projectError);
  const inputErrors = checkStringList(payload.inputs, 'inputs', { required: false });
  if (inputErrors) errors.push(...inputErrors);
  const outputErrors = checkStringList(payload.outputs, 'outputs', { required: false });
  if (outputErrors) errors.push(...outputErrors);
  const seedError = checkInt(payload.seed, 'seed', { required: false });
  if (seedError) errors.push(...seedError);
  return errors;
}

export function validateFigureTemplatePayload(payload = {}) {
  const errors = [];
  const idError = checkString(payload.id, 'id', { minLength: 3 });
  if (idError) errors.push(...idError);
  const statusError = checkEnum(payload.status, 'status', FIGURE_STATUSES);
  if (statusError) errors.push(...statusError);
  const producingError = checkString(payload.producing_mod_id, 'producing_mod_id', { required: false });
  if (producingError) errors.push(...producingError);
  const requiredModsError = checkStringList(payload.required_mod_ids, 'required_mod_ids', { required: false });
  if (requiredModsError) errors.push(...requiredModsError);
  const previewError = checkString(payload.preview_sha256, 'preview_sha256', { required: false });
  if (previewError) errors.push(...previewError);
  const contract = payload.data_contract;
  if (contract !== undefined && !isPlainObject(contract)) {
    errors.push(err('data_contract', 'Input should be a valid dictionary', 'dict_type'));
  } else if (isPlainObject(contract)) {
    for (const key of ['input_artifact', 'format']) {
      const itemError = checkString(contract[key], `data_contract.${key}`, { required: false });
      if (itemError) errors.push(...itemError);
    }
    for (const key of ['required_columns', 'required_obs_keys', 'required_obsm_keys']) {
      const itemErrors = checkStringList(contract[key], `data_contract.${key}`, { required: false });
      if (itemErrors) errors.push(...itemErrors);
    }
  }
  if (payload.render_evidence !== undefined && payload.render_evidence !== null && !isPlainObject(payload.render_evidence)) {
    errors.push(err('render_evidence', 'Input should be a valid dictionary or null', 'dict_type'));
  }

  if (payload.status === 'ready') {
    if (typeof payload.producing_mod_id !== 'string' || payload.producing_mod_id.trim() === '') {
      errors.push(err('', 'ready 模板必须具备 producing_mod_id（硬外键）', 'value_error'));
    }
    const inputArtifact = isPlainObject(contract) ? contract.input_artifact : undefined;
    if (typeof inputArtifact !== 'string' || inputArtifact.trim() === '') {
      errors.push(err('', 'ready 模板 data_contract.input_artifact 不得为空', 'value_error'));
    }
    if (typeof payload.preview_sha256 !== 'string' || payload.preview_sha256.trim() === '') {
      errors.push(err('', 'ready 模板必须具备 preview_sha256 实证', 'value_error'));
    }
  } else if (payload.status === 'draft') {
    if (payload.preview_sha256 || payload.render_evidence) {
      errors.push(err('', 'draft 模板严禁携带 preview_sha256/render_evidence（防伪证）', 'value_error'));
    }
  }
  return errors;
}

const CHECKERS = {
  project: validateProjectPayload,
  project_metadata: validateProjectPayload,
  requirement: validateRequirementPayload,
  run_task: validateRunTaskPayload,
  figure_template: validateFigureTemplatePayload,
};

/**
 * 与 schema_gateway.py 同形返回：{ allowed, status, errors, exitCode }。
 */
export function validateWithFallback(schemaName, payload) {
  const checker = CHECKERS[schemaName];
  if (!checker) {
    return {
      allowed: false,
      status: 'ERROR',
      errors: [err('', `未注册的 Schema: ${schemaName}`, 'unknown_schema')],
      exitCode: 1,
    };
  }
  let errors;
  try {
    errors = checker(payload ?? {});
  } catch (cause) {
    return {
      allowed: false,
      status: 'ERROR',
      errors: [err('', `网关内部异常: ${cause.message}`, 'internal_error')],
      exitCode: 1,
    };
  }
  if (Array.isArray(errors) && errors.length > 0) {
    return { allowed: false, status: 'DENY', errors, exitCode: 2 };
  }
  return { allowed: true, status: 'ALLOW', errors: [], exitCode: 0 };
}
