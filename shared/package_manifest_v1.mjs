/**
 * package_manifest 增强字段校验与归一化（D4.2 / 专家裁定 A2，additive 演进）。
 *
 * 裁定口径：不新建第二清单文件，直接增强既有 package_manifest.json。
 * 新增可选字段：format_hint（每数据文件的格式先验）、autonomy_grants（AI 自主授权）。
 * 旧包（无新字段）完全不受影响，from-package 照常 legacy 放行。
 * 本模块纯函数：不读文件，portal 与 from-package 共用同一份校验。
 */

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const KNOWN_FORMAT_HINT_KEYS = Object.freeze([
  'delimiter', 'gene_id_type', 'is_log_transformed', 'has_header', 'index_column',
]);
const KNOWN_GRANT_KEYS = Object.freeze([
  'allow_l3_data_adaptation', 'allow_l2_grace_auto_pass', 'max_adaptation_retries',
]);

function errorCode(line) {
  const index = line.indexOf(':');
  return index > 0 ? line.slice(0, index) : line;
}

function pushError(list, code, message) {
  list.push(`${code}: ${message}`);
}

/**
 * 校验单个数据文件条目的可选 format_hint。
 * 已知键值校验类型；未知键直接拒绝（演进先改本真源）。
 * 返回归一化后的对象（无 hint 时返回 undefined）。
 */
export function normalizeFormatHint(raw, label, errors) {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw)) {
    pushError(errors, 'ERR_FORMAT_HINT', `${label}.format_hint 必须是对象`);
    return undefined;
  }
  const hint = {};
  for (const key of Object.keys(raw)) {
    if (!KNOWN_FORMAT_HINT_KEYS.includes(key)) {
      pushError(errors, 'ERR_FORMAT_HINT_KEY', `${label}.format_hint.${key} 不是登记的提示字段`);
      continue;
    }
    hint[key] = raw[key];
  }
  if (hint.delimiter !== undefined && typeof hint.delimiter !== 'string') {
    pushError(errors, 'ERR_FORMAT_HINT_DELIMITER', `${label}.format_hint.delimiter 必须是字符串`);
  }
  if (hint.gene_id_type !== undefined && typeof hint.gene_id_type !== 'string') {
    pushError(errors, 'ERR_FORMAT_HINT_GENE_ID', `${label}.format_hint.gene_id_type 必须是字符串`);
  }
  if (hint.is_log_transformed !== undefined && typeof hint.is_log_transformed !== 'boolean') {
    pushError(errors, 'ERR_FORMAT_HINT_LOG', `${label}.format_hint.is_log_transformed 必须是布尔值`);
  }
  if (hint.has_header !== undefined && typeof hint.has_header !== 'boolean') {
    pushError(errors, 'ERR_FORMAT_HINT_HEADER', `${label}.format_hint.has_header 必须是布尔值`);
  }
  if (hint.index_column !== undefined && !Number.isInteger(hint.index_column)) {
    pushError(errors, 'ERR_FORMAT_HINT_INDEX', `${label}.format_hint.index_column 必须是整数`);
  }
  return Object.keys(hint).length ? hint : undefined;
}

/**
 * 校验包级 autonomy_grants（AI 自主授权凭证，Pi propose_adaptation 的先验）。
 * 未知键拒绝；retries 上限钉死 3（与 autonomy_policy_v1 预算一致）。
 */
export function normalizeAutonomyGrants(raw, errors) {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw)) {
    pushError(errors, 'ERR_GRANTS_SHAPE', 'manifest.autonomy_grants 必须是对象');
    return undefined;
  }
  const grants = {};
  for (const key of Object.keys(raw)) {
    if (!KNOWN_GRANT_KEYS.includes(key)) {
      pushError(errors, 'ERR_GRANTS_KEY', `manifest.autonomy_grants.${key} 不是登记的授权字段`);
      continue;
    }
    grants[key] = raw[key];
  }
  for (const key of ['allow_l3_data_adaptation', 'allow_l2_grace_auto_pass']) {
    if (grants[key] !== undefined && typeof grants[key] !== 'boolean') {
      pushError(errors, 'ERR_GRANTS_BOOL', `manifest.autonomy_grants.${key} 必须是布尔值`);
    }
  }
  if (grants.max_adaptation_retries !== undefined) {
    const value = grants.max_adaptation_retries;
    if (!Number.isInteger(value) || value < 0 || value > 3) {
      pushError(errors, 'ERR_GRANTS_RETRIES', 'manifest.autonomy_grants.max_adaptation_retries 必须是 0 到 3 的整数（与策略预算一致）');
    }
  }
  return Object.keys(grants).length ? grants : undefined;
}

/**
 * 校验整个 manifest 的新增可选字段。返回 { ok, errors, codes, normalized }。
 * normalized.formatHints 是按 data_files 下标对齐的数组（无 hint 项为 undefined）。
 */
export function validateManifestExtensions(manifest) {
  const errors = [];
  if (!isPlainObject(manifest)) {
    pushError(errors, 'ERR_PACKAGE_SHAPE', 'package_manifest.json 必须是 JSON 对象');
    return { ok: false, errors, codes: errors.map(errorCode), normalized: null };
  }
  const dataFiles = Array.isArray(manifest.data_files) ? manifest.data_files : [];
  const formatHints = dataFiles.map((entry, index) =>
    normalizeFormatHint(entry?.format_hint, `manifest.data_files[${index}]`, errors));
  const autonomyGrants = normalizeAutonomyGrants(manifest.autonomy_grants, errors);
  return {
    ok: errors.length === 0,
    errors,
    codes: errors.map(errorCode),
    normalized: { formatHints, autonomyGrants },
  };
}
