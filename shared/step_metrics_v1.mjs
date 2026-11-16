/**
 * step_metrics/v1 运行时校验与槽位解析真源。
 *
 * 存在理由：Pi CLI 只能读千字节级指标卡，不能读原始矩阵。指标卡一旦可以被
 * 手工或模型写入未经计算的数字，整条「防幻觉」链路就只剩一层文字功夫。
 * 所以校验放在这里，报告渲染与门禁共用同一份实现，不另造第二套判据。
 *
 * 两条硬约束（任一不满足即拒绝）：
 *   1. 单文件序列化后严格小于 MAX_METRICS_BYTES（32 KB 上限，含缩进）。
 *   2. mod_id 必须出现在 workflows.json 登记表里，不接受自由命名。
 */
import fs from 'node:fs';
import path from 'node:path';

export const STEP_METRICS_SCHEMA_VERSION = 'step_metrics/v1';

/** 指标卡字节上限：32768 字节。上界写死在这里，调用方不得放宽。 */
export const MAX_METRICS_BYTES = 32 * 1024;

export const STEP_METRICS_LINES = Object.freeze(['line1_bulk', 'line2_scrna', 'line3_spatial']);

export const STEP_METRICS_STATUS = Object.freeze(['ok', 'warn', 'blocked', 'failed']);

export const QC_FLAG_CODES = Object.freeze([
  'DEG_COUNT_LOW',
  'DEG_COUNT_HIGH',
  'WGCNA_SCALE_FREE_LOW',
  'VALIDATION_OVERFIT_SUSPECT',
  'SPOT_COUNT_LOW',
  'CELL_COUNT_LOW',
  'DECONV_RESIDUAL_HIGH',
  'SCALEBAR_UNVERIFIED',
]);

const PROJECT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MOD_ID_RE = /^[a-z0-9_]+$/;

/**
 * 从 workflows.json 收集全部登记 Mod ID。注册表是唯一真源，指标卡不得自造 Mod。
 */
export function collectRegisteredModIds(workflowsPath) {
  const raw = JSON.parse(fs.readFileSync(workflowsPath, 'utf8'));
  const ids = new Set();
  for (const series of raw.series || []) {
    for (const stage of series.stages || []) {
      for (const mod of stage.mods || []) {
        if (mod?.id) ids.add(String(mod.id));
      }
    }
  }
  return ids;
}

/**
 * 结构校验。返回 { ok, errors, bytes }，不抛异常，调用方决定是拒绝还是打印。
 * bytes 用的是紧凑序列化口径（与落盘时的真实字节数一致）。
 */
export function validateStepMetrics(raw, options = {}) {
  const errors = [];
  const registeredModIds = options.registeredModIds || null;

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['指标卡必须是 JSON 对象'], bytes: 0 };
  }

  if (raw.schema_version !== STEP_METRICS_SCHEMA_VERSION) {
    errors.push(`schema_version 必须为 ${STEP_METRICS_SCHEMA_VERSION}，实际 ${JSON.stringify(raw.schema_version)}`);
  }
  if (!MOD_ID_RE.test(String(raw.mod_id || ''))) {
    errors.push('mod_id 必须匹配 ^[a-z0-9_]+$');
  } else if (registeredModIds && !registeredModIds.has(raw.mod_id)) {
    errors.push(`mod_id '${raw.mod_id}' 未在 workflows.json 登记（幽灵 Mod 一律拒绝）`);
  }
  if (!STEP_METRICS_LINES.includes(raw.line_id)) {
    errors.push(`line_id 必须是 ${STEP_METRICS_LINES.join(' / ')} 之一`);
  }
  if (!PROJECT_ID_RE.test(String(raw.project_id || ''))) {
    errors.push('project_id 必须匹配 ^[A-Za-z0-9_-]{1,64}$');
  }
  if (!STEP_METRICS_STATUS.includes(raw.status)) {
    errors.push(`status 必须是 ${STEP_METRICS_STATUS.join(' / ')} 之一`);
  }
  if (typeof raw.generated_at !== 'string' || Number.isNaN(Date.parse(raw.generated_at))) {
    errors.push('generated_at 必须是可解析的 ISO 时间字符串');
  }
  if (raw.seed !== undefined && raw.seed !== null && !Number.isInteger(raw.seed)) {
    errors.push('seed 必须是整数或 null');
  }

  const fp = raw.input_fingerprint;
  if (!fp || typeof fp !== 'object' || typeof fp.inputs_digest !== 'string' || fp.inputs_digest.length < 8) {
    errors.push('input_fingerprint.inputs_digest 必须是长度 >= 8 的字符串');
  }

  if (!raw.metrics || typeof raw.metrics !== 'object' || Array.isArray(raw.metrics)) {
    errors.push('metrics 必须是对象');
  }

  if (raw.qc_flags !== undefined) {
    if (!Array.isArray(raw.qc_flags)) {
      errors.push('qc_flags 必须是数组');
    } else {
      raw.qc_flags.forEach((flag, index) => {
        if (!flag || typeof flag !== 'object') {
          errors.push(`qc_flags[${index}] 必须是对象`);
          return;
        }
        if (!QC_FLAG_CODES.includes(flag.code)) {
          errors.push(`qc_flags[${index}].code '${flag.code}' 不在受控枚举内`);
        }
        if (!['info', 'warn', 'block'].includes(flag.severity)) {
          errors.push(`qc_flags[${index}].severity 必须是 info / warn / block`);
        }
        if (typeof flag.message !== 'string' || flag.message.length > 400) {
          errors.push(`qc_flags[${index}].message 必须是 <= 400 字符的字符串`);
        }
      });
    }
  }

  if (raw.figures !== undefined) {
    if (!Array.isArray(raw.figures)) {
      errors.push('figures 必须是数组');
    } else {
      raw.figures.forEach((fig, index) => {
        if (!fig || typeof fig !== 'object') {
          errors.push(`figures[${index}] 必须是对象`);
          return;
        }
        if (!fig.template_id || !fig.producing_mod_id) {
          errors.push(`figures[${index}] 必须同时给出 template_id 与 producing_mod_id`);
        }
        if (fig.panel_count !== undefined && fig.panel_count !== 1) {
          errors.push(`figures[${index}].panel_count 必须为 1（组合图严禁混入）`);
        }
      });
    }
  }

  const bytes = Buffer.byteLength(JSON.stringify(raw), 'utf8');
  if (bytes >= MAX_METRICS_BYTES) {
    errors.push(`指标卡 ${bytes} 字节超过上限 ${MAX_METRICS_BYTES}（千字节级契约）`);
  }

  return { ok: errors.length === 0, errors, bytes };
}

/**
 * 把嵌套指标对象压平为 `a.b.c -> 值` 的槽位索引。
 *
 * 报告正文只能通过 {{metric:<mod_id>.<path>}} 引用数值，槽位解析必须来自这里，
 * 不允许模型自己拼 key。数组按下标压平（Top20 基因表就是数组）。
 */
export function flattenMetricSlots(metricCard) {
  const slots = new Map();
  const modId = metricCard?.mod_id || 'unknown';
  const walk = (value, trail) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${trail}[${index}]`));
      return;
    }
    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        walk(child, trail ? `${trail}.${key}` : key);
      }
      return;
    }
    slots.set(`${modId}.${trail}`, value);
  };
  walk(metricCard?.metrics || {}, '');
  if (metricCard?.seed !== undefined && metricCard?.seed !== null) {
    slots.set(`${modId}.seed`, metricCard.seed);
  }
  return slots;
}

/** 合并多张指标卡的槽位索引。同名 key 由后写入者覆盖，并记录冲突。 */
export function mergeMetricSlots(cards = []) {
  const slots = new Map();
  const conflicts = [];
  for (const card of cards) {
    for (const [key, value] of flattenMetricSlots(card)) {
      if (slots.has(key) && slots.get(key) !== value) conflicts.push(key);
      slots.set(key, value);
    }
  }
  return { slots, conflicts };
}
