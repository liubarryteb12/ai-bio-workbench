/**
 * 统一作业回执 receipt/v1。
 *
 * 本模块只做形态、状态机、摘要与原子落盘，不调用接口，不读业务数据。
 * 权威文件由编排器写 workspace/projects/<project_id>/report/receipt.v1.json，
 * 旧 work_order.receipt.json 只作为成功投影保留，文件名与哨兵不变。
 */
import crypto from 'node:crypto';
import { atomicWriteFileSync } from './atomic_write.js';

export const RECEIPT_V1_SCHEMA_VERSION = 'receipt/v1';
export const RECEIPT_V1_SENTINEL = 'PRODUCTIZATION_RECEIPT_OK';
export const RECEIPT_STATUSES = Object.freeze(['queued', 'running', 'completed', 'failed', 'blocked']);

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'blocked']);
const TRANSITIONS = Object.freeze({
  queued: Object.freeze(['running', 'failed', 'blocked']),
  running: Object.freeze(['completed', 'failed', 'blocked']),
  completed: Object.freeze([]),
  failed: Object.freeze([]),
  blocked: Object.freeze([]),
});
const SHA256_RE = /^[0-9a-f]{64}$/;
const RECEIPT_ID_RE = /^[0-9a-f]{24}$/;
const RELATIVE_PATH_RE = /^(?!\/)(?!^[A-Za-z]:)(?!.*\\)(?!.*\/\/)(?!.*\/$)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/;
const PROTECTED_KEYS = new Set(['schema_version', 'receipt_id', 'work_order_digest', 'started_at', 'producer']);

function receiptError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value && typeof value === 'object') {
    const ordered = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) ordered[key] = canonicalize(value[key]);
    }
    return ordered;
  }
  return value;
}

export function computeWorkOrderDigest(workOrderObject) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(workOrderObject)))
    .digest('hex');
}

function receiptIdFor(workOrderDigest, startedAt) {
  return crypto
    .createHash('sha256')
    .update(`${workOrderDigest}${startedAt}`)
    .digest('hex')
    .slice(0, 24);
}

export function createReceiptV1({
  workOrderDigest,
  workOrderId,
  projectId,
  lineId,
  startedAt,
  sourceSchemaVersion,
  seed,
  computeAdapter,
  actors = null,
  actorTrace = null,
} = {}) {
  const digest = String(workOrderDigest || '');
  if (!SHA256_RE.test(digest)) {
    throw receiptError('ERR_RECEIPT_DIGEST', 'workOrderDigest 必须是 64 位小写十六进制 SHA-256');
  }
  const start = String(startedAt || new Date().toISOString());
  const receipt = {
    schema_version: RECEIPT_V1_SCHEMA_VERSION,
    receipt_id: receiptIdFor(digest, start),
    work_order_digest: digest,
    work_order_id: String(workOrderId || ''),
    project_id: String(projectId || ''),
    line_id: String(lineId || ''),
    status: 'queued',
    started_at: start,
    finished_at: null,
    failure_stage: null,
    source_schema_version: String(sourceSchemaVersion || 'work_order/v1'),
    seed: Number.isInteger(seed) ? seed : null,
    compute_adapter: computeAdapter ? String(computeAdapter) : null,
    dag: [],
    stages: [],
    upload_receipts: [],
    task_receipts: [],
    acceptance: null,
    delivery: null,
    artifacts: [],
    summary: null,
    error: null,
    sentinel: null,
    producer: Object.freeze({ name: 'work_order_orchestrator', version: '1.0.0' }),
  };
  // 可选字段：只有调用方给出主体时才写入，旧回执与新回执都能通过同一份 schema。
  if (actors && typeof actors === 'object') receipt.actors = { ...actors };
  if (Array.isArray(actorTrace) && actorTrace.length) receipt.actor_trace = actorTrace.map((row) => ({ ...row }));
  return receipt;
}

/**
 * 追加一条操作留痕。actors 取对应动作的最后一条，供列表与详情快速展示。
 * 顺序固定为追加，不改历史。
 */
export function appendActorTrace(receipt, entry = {}) {
  if (!receipt || typeof receipt !== 'object') {
    throw receiptError('ERR_RECEIPT_SHAPE', '回执必须是 JSON 对象');
  }
  const action = String(entry.action || '');
  const actor = entry.actor && entry.actor.kind ? entry.actor : null;
  if (!action || !actor) {
    throw receiptError('ERR_ACTOR_TRACE', 'actor_trace 记录需要 action 与 actor');
  }
  if (!Array.isArray(receipt.actor_trace)) receipt.actor_trace = [];
  receipt.actor_trace.push({
    action,
    actor: { kind: actor.kind, id: String(actor.id || actor.kind), role: String(actor.role || 'admin') },
    at: String(entry.at || new Date().toISOString()),
    lease_id: entry.lease_id ? String(entry.lease_id) : null,
    request_id: entry.request_id ? String(entry.request_id) : null,
  });
  if (!receipt.actors || typeof receipt.actors !== 'object') receipt.actors = {};
  const field = {
    'work_order.created': 'created_by',
    'work_order.approved': 'approved_by',
  }[action];
  if (field) receipt.actors[field] = { ...receipt.actor_trace[receipt.actor_trace.length - 1].actor };
  receipt.actors.last_updated_by = { ...receipt.actor_trace[receipt.actor_trace.length - 1].actor };
  return receipt;
}

export function updateReceiptStatus(receipt, status, extras = {}) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw receiptError('ERR_RECEIPT_SHAPE', '回执必须是 JSON 对象');
  }
  const current = String(receipt.status || '');
  if (!RECEIPT_STATUSES.includes(status)) {
    throw receiptError('ERR_RECEIPT_STATUS', `回执状态必须是 ${RECEIPT_STATUSES.join('、')} 之一，当前 ${JSON.stringify(status)}`);
  }
  if (!RECEIPT_STATUSES.includes(current)) {
    throw receiptError('ERR_RECEIPT_STATUS', `回执当前状态非法: ${JSON.stringify(receipt.status)}`);
  }
  if (current !== status) {
    if (TERMINAL_STATUSES.has(current)) {
      throw receiptError('ERR_RECEIPT_TERMINAL', `回执终态不可逆: ${current} 不能变为 ${status}`);
    }
    const allowed = TRANSITIONS[current] || [];
    if (!allowed.includes(status)) {
      throw receiptError('ERR_RECEIPT_TRANSITION', `回执状态不可从 ${current} 变为 ${status}`);
    }
  }

  const next = { ...receipt };
  for (const [key, value] of Object.entries(extras || {})) {
    if (PROTECTED_KEYS.has(key)) continue;
    next[key] = value;
  }
  next.status = status;

  if (status === 'completed') {
    next.sentinel = RECEIPT_V1_SENTINEL;
    next.failure_stage = extras.failure_stage ?? null;
    next.error = extras.error ?? null;
  } else if (status === 'failed' || status === 'blocked') {
    next.sentinel = null;
    next.failure_stage = extras.failure_stage ?? receipt.failure_stage ?? null;
    next.error = extras.error ?? receipt.error ?? null;
  } else {
    next.sentinel = null;
  }

  if (TERMINAL_STATUSES.has(status)) {
    next.finished_at = extras.finished_at ?? receipt.finished_at ?? new Date().toISOString();
  } else {
    next.finished_at = null;
  }
  return next;
}

function assertRelativePath(value, label) {
  if (typeof value !== 'string' || !RELATIVE_PATH_RE.test(value)) {
    throw receiptError('ERR_RECEIPT_ARTIFACT_PATH', `${label} 必须是相对路径，禁止绝对路径、反斜杠、空段与 .. 段，当前 ${JSON.stringify(value ?? null)}`);
  }
}

function assertReceiptShape(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw receiptError('ERR_RECEIPT_SHAPE', '回执必须是 JSON 对象');
  }
  if (receipt.schema_version !== RECEIPT_V1_SCHEMA_VERSION) {
    throw receiptError('ERR_RECEIPT_SHAPE', `schema_version 必须是 ${RECEIPT_V1_SCHEMA_VERSION}`);
  }
  if (!RECEIPT_ID_RE.test(String(receipt.receipt_id || ''))) {
    throw receiptError('ERR_RECEIPT_SHAPE', 'receipt_id 必须是 24 位小写十六进制');
  }
  if (!SHA256_RE.test(String(receipt.work_order_digest || ''))) {
    throw receiptError('ERR_RECEIPT_SHAPE', 'work_order_digest 必须是 64 位小写十六进制');
  }
  if (!String(receipt.work_order_id || '').trim()) {
    throw receiptError('ERR_RECEIPT_SHAPE', 'work_order_id 不能为空');
  }
  if (!String(receipt.project_id || '').trim()) {
    throw receiptError('ERR_RECEIPT_SHAPE', 'project_id 不能为空');
  }
  if (!RECEIPT_STATUSES.includes(receipt.status)) {
    throw receiptError('ERR_RECEIPT_STATUS', `回执状态非法: ${JSON.stringify(receipt.status)}`);
  }
  if (!Array.isArray(receipt.stages)) {
    throw receiptError('ERR_RECEIPT_SHAPE', 'stages 必须是数组');
  }
  if (!Array.isArray(receipt.artifacts)) {
    throw receiptError('ERR_RECEIPT_SHAPE', 'artifacts 必须是数组');
  }
  for (const [index, artifact] of receipt.artifacts.entries()) {
    assertRelativePath(artifact?.path, `artifacts[${index}].path`);
  }
  if (receipt.delivery && receipt.delivery.receipt_path !== undefined) {
    assertRelativePath(receipt.delivery.receipt_path, 'delivery.receipt_path');
  }
  if (!receipt.producer
    || typeof receipt.producer.name !== 'string'
    || typeof receipt.producer.version !== 'string') {
    throw receiptError('ERR_RECEIPT_SHAPE', 'producer.name 与 producer.version 必须存在');
  }
  if (receipt.status === 'completed') {
    if (receipt.sentinel !== RECEIPT_V1_SENTINEL) {
      throw receiptError('ERR_RECEIPT_SHAPE', `completed 回执哨兵必须是 ${RECEIPT_V1_SENTINEL}`);
    }
    if (!receipt.delivery || typeof receipt.delivery !== 'object' || Array.isArray(receipt.delivery)) {
      throw receiptError('ERR_RECEIPT_SHAPE', 'completed 回执必须包含 delivery 对象');
    }
    for (const key of ['tar_sha256', 'verified_count', 'coverage_ok', 'verifier_version']) {
      if (!Object.hasOwn(receipt.delivery, key)) {
        throw receiptError('ERR_RECEIPT_SHAPE', `completed 回执 delivery.${key} 必须存在`);
      }
    }
  }
}

export function writeReceiptV1Atomic(receipt, filePath) {
  assertReceiptShape(receipt);
  atomicWriteFileSync(filePath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return filePath;
}

function artifactPathByRole(receipt, role) {
  const found = (Array.isArray(receipt.artifacts) ? receipt.artifacts : [])
    .find((item) => item && item.role === role);
  return found ? found.path : null;
}

export function buildOldReceiptProjection(receiptV1) {
  if (!receiptV1 || typeof receiptV1 !== 'object' || Array.isArray(receiptV1)) {
    throw receiptError('ERR_RECEIPT_SHAPE', '回执必须是 JSON 对象');
  }
  const status = String(receiptV1.status || 'failed');
  const sourceSchemaVersion = String(receiptV1.source_schema_version || 'work_order/v1');

  if (status === 'completed') {
    return {
      schema_version: sourceSchemaVersion,
      ok: true,
      status: 'completed',
      work_order_id: receiptV1.work_order_id,
      project_id: receiptV1.project_id,
      line_id: receiptV1.line_id,
      seed: receiptV1.seed,
      compute_adapter: receiptV1.compute_adapter,
      dag: Array.isArray(receiptV1.dag) ? receiptV1.dag : [],
      upload_receipts: Array.isArray(receiptV1.upload_receipts) ? receiptV1.upload_receipts : [],
      task_receipts: Array.isArray(receiptV1.task_receipts) ? receiptV1.task_receipts : [],
      acceptance: receiptV1.acceptance || {},
      stages: Array.isArray(receiptV1.stages) ? receiptV1.stages : [],
      summary: receiptV1.summary || null,
      sentinel: 'WORK_ORDER_ORCHESTRATOR_OK',
      artifacts: {
        project_summary: artifactPathByRole(receiptV1, 'project_summary'),
        work_order_receipt: artifactPathByRole(receiptV1, 'work_order_receipt'),
      },
    };
  }

  return {
    ok: false,
    status,
    code: receiptV1.error?.code || null,
    error: receiptV1.error?.message || null,
    at: receiptV1.finished_at || receiptV1.started_at || null,
    stages: Array.isArray(receiptV1.stages) ? receiptV1.stages : [],
  };
}
