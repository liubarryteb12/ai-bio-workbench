#!/usr/bin/env node
/**
 * 结构化工单单入口编排器。
 *
 * 一份工单依次完成建项、上传、计划编译、逐任务下发、完成回执核对、报告构建、
 * 交付验收与项目汇总。任何上游失败立即短路，下游保持 blocked，不写成部分成功。
 *
 * 计算通道由产品服务端决定，默认 ADB。编排器不启动任何远端进程，不导入 SSH 接缝，
 * 只通过注入的 request 调用本地 HTTP 接口，便于离线 mock 与真实服务端共用同一套判据。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { normalizeWorkOrderV2, WORK_ORDER_V2_SCHEMA_VERSION } from '../../shared/work_order_v2.mjs';
import {
  buildOldReceiptProjection,
  computeWorkOrderDigest,
  createReceiptV1,
  updateReceiptStatus,
  writeReceiptV1Atomic,
} from '../../BioanalysDesktop/server/receipt_v1.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');
const WORKFLOWS_FILE = path.join(REPO_ROOT, 'tools', 'bio', 'workflows.json');
const FIGURE_TEMPLATES_FILE = path.join(REPO_ROOT, 'tools', 'bio', 'figure_templates.json');
const ALLOWLIST_FILE = path.join(REPO_ROOT, 'tools', 'dev', 'figure_ready_allowlist.json');
export const WORK_ORDER_SCHEMA_VERSION = 'work_order/v1';
const RECEIPT_V1_FILENAME = 'receipt.v1.json';
const LEGACY_RECEIPT_FILENAME = 'work_order.receipt.json';
const BLOCKED_TERMINAL_CODES = new Set([
  'ERR_API_UNREACHABLE',
  'ERR_INPUT_FILE',
  'ERR_ADMIN_REVIEW_REQUIRED',
]);

const LINES = Object.freeze(['line1_bulk', 'line2_scrna', 'line3_spatial']);
const PROJECT_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const SAFE_NAME_RE = /^[A-Za-z0-9._-]+$/;
const RETIRED_FIGURE_IDS = Object.freeze([
  'fig_l3_multipanel',
  'fig_l3_combinationpanel',
  'fig_l3_sankeybubbleplot',
]);

export class WorkOrderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WorkOrderError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new WorkOrderError(code, message, details);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requirePlainObject(value, label) {
  if (!isPlainObject(value)) fail('ERR_WORK_ORDER_SHAPE', `${label} 必须是 JSON 对象`);
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) fail('ERR_WORK_ORDER_SHAPE', `${label} 必须是数组`);
  return value;
}

function requireSafeName(value, label) {
  const text = String(value || '').trim();
  if (!SAFE_NAME_RE.test(text) || text.startsWith('.')) {
    fail('ERR_UNSAFE_NAME', `${label} 非法: ${JSON.stringify(value)}`);
  }
  return text;
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

/**
 * 按 chunkSize 从文件流产出分片，内存峰值约一个分片。
 * createReadStream 的 highWaterMark 固定 1 MiB，避免服务端给出超大 chunkSize 时
 * 单次 read 直接吃掉同等内存。
 */
async function* fileChunks(filePath, chunkSize) {
  let pending = [];
  let pendingBytes = 0;
  for await (const piece of fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })) {
    let offset = 0;
    while (offset < piece.length) {
      const take = Math.min(chunkSize - pendingBytes, piece.length - offset);
      pending.push(piece.subarray(offset, offset + take));
      pendingBytes += take;
      offset += take;
      if (pendingBytes === chunkSize) {
        yield Buffer.concat(pending, pendingBytes);
        pending = [];
        pendingBytes = 0;
      }
    }
  }
  if (pendingBytes > 0) yield Buffer.concat(pending, pendingBytes);
}

/**
 * v2 文件引用预检：路径必须落在 inputsRoot 内、真实存在、是文件，
 * 声明大小与声明 SHA-256 都必须和磁盘一致。任一不符 fail closed。
 */
async function prepareInputFiles(inputs, inputsRoot) {
  const root = path.resolve(inputsRoot);
  let realRoot;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    fail('ERR_INPUT_FILE', `inputsRoot 不可读: ${inputsRoot}`, { stage: 'uploads' });
  }
  const prepared = [];
  for (const [index, input] of inputs.entries()) {
    const at = `inputs[${index}]`;
    const absolutePath = path.resolve(root, input.path);
    const relative = path.relative(root, absolutePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      fail('ERR_INPUT_FILE', `${at}.path 解析后越出 inputsRoot: ${input.path}`, { stage: 'uploads' });
    }
    let stat;
    try {
      stat = fs.statSync(absolutePath);
    } catch {
      fail('ERR_INPUT_FILE', `${at}.path 不存在: ${input.path}`, { stage: 'uploads' });
    }
    if (!stat.isFile()) fail('ERR_INPUT_FILE', `${at}.path 不是文件: ${input.path}`, { stage: 'uploads' });
    let realFile;
    try {
      realFile = fs.realpathSync(absolutePath);
    } catch {
      fail('ERR_INPUT_FILE', `${at}.path 无法解析真实路径: ${input.path}`, { stage: 'uploads' });
    }
    const realRelative = path.relative(realRoot, realFile);
    if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      fail('ERR_INPUT_FILE', `${at}.path 通过链接逃出 inputsRoot: ${input.path}`, { stage: 'uploads' });
    }
    if (stat.size !== input.size) {
      fail('ERR_INPUT_FILE', `${at}.size 声明 ${input.size}，实际 ${stat.size}: ${input.path}`, { stage: 'uploads' });
    }
    const actualSha256 = await sha256File(absolutePath);
    if (actualSha256 !== input.sha256) {
      fail('ERR_INPUT_HASH', `${at}.sha256 声明 ${input.sha256}，实际 ${actualSha256}: ${input.path}`, { stage: 'uploads' });
    }
    prepared.push({ ...input, absolutePath, bytes: stat.size, actualSha256 });
  }
  return prepared;
}

function nowIso() {
  return new Date().toISOString();
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (cause) {
    fail('ERR_FACT_SOURCE', `${label} 不可读: ${cause.message}`);
  }
  return null;
}

/**
 * v2 输入归一化层。
 *
 * v1 工单原样返回，编译与执行逻辑不变。v2 工单先经 shared/work_order_v2.mjs
 * 校验并转成内部 camelCase 形态，schema_version 回落为 v1 以复用同一编译契约。
 * 归一化失败抛 WorkOrderError，由 runWorkOrder 的失败路径转成失败回执。
 */
export function normalizeWorkOrderInput(order) {
  if (!isPlainObject(order) || String(order.schema_version || '') !== WORK_ORDER_V2_SCHEMA_VERSION) {
    return order;
  }
  const normalized = normalizeWorkOrderV2(order);
  if (!normalized.ok) {
    const firstCode = normalized.codes[0] || 'ERR_WORK_ORDER_V2';
    fail(firstCode, normalized.errors.join('；'), { errors: normalized.errors, codes: normalized.codes });
  }
  return normalized.workOrder;
}

function indexRegistry() {
  const workflows = readJson(WORKFLOWS_FILE, 'tools/bio/workflows.json');
  const templates = readJson(FIGURE_TEMPLATES_FILE, 'tools/bio/figure_templates.json');
  const allowlist = readJson(ALLOWLIST_FILE, 'tools/dev/figure_ready_allowlist.json');
  const series = new Map();
  const mods = new Map();
  for (const item of workflows.series || []) {
    const stages = [...(item.stages || [])].sort((left, right) => Number(left.order) - Number(right.order));
    const orderedMods = [];
    for (const stage of stages) {
      for (const mod of stage.mods || []) {
        const entry = {
          id: mod.id,
          mod,
          seriesId: item.id,
          stageId: stage.id,
          order: Number(stage.order),
          required: stage.required === true,
          optional: mod.optional === true,
        };
        mods.set(mod.id, entry);
        orderedMods.push(entry);
      }
    }
    series.set(item.id, { series: item, stages, orderedMods, seed: item.seed });
  }
  const registry = Array.isArray(templates)
    ? templates
    : (Array.isArray(templates.templates) ? templates.templates : []);
  const readyFigures = new Map();
  for (const template of registry) {
    if (template.status === 'ready' && template.deprecated !== true) {
      readyFigures.set(template.id, template);
    }
  }
  const allowedIds = new Set(Array.isArray(allowlist.ids) ? allowlist.ids : []);
  if (Number(allowlist.ready_baseline) !== readyFigures.size || allowedIds.size !== readyFigures.size) {
    fail('ERR_READY_BASELINE', `Ready 单图基线不一致: allowlist=${allowlist.ready_baseline}, registry=${readyFigures.size}`);
  }
  for (const id of allowedIds) {
    if (!readyFigures.has(id)) fail('ERR_READY_BASELINE', `Ready 白名单含未就绪模板: ${id}`);
  }
  return { workflows, series, mods, readyFigures, allowedIds };
}

function resolveLine(order, facts) {
  const lineId = String(order.lineId || order.seriesId || order.basicInfo?.lineId || '').trim();
  if (!LINES.includes(lineId)) fail('ERR_UNKNOWN_LINE', `lineId 非法: ${lineId || '(空)'}`);
  if (!facts.series.has(lineId)) fail('ERR_UNKNOWN_LINE', `注册表缺少分析线: ${lineId}`);
  return lineId;
}

function resolveProjectId(order) {
  const projectId = String(order.projectId || order.project_id || order.basicInfo?.projectId || '').trim();
  if (!PROJECT_ID_RE.test(projectId) || projectId.startsWith('.')) {
    fail('ERR_UNSAFE_NAME', `projectId 非法: ${JSON.stringify(projectId)}`);
  }
  return projectId;
}

function validateFigureSelections(order, facts) {
  const selections = requireArray(order.figureSelections ?? order.figure_templates ?? [], 'figureSelections');
  const seen = new Set();
  for (const [index, raw] of selections.entries()) {
    const selection = requirePlainObject(raw, `figureSelections[${index}]`);
    const id = String(selection.template_id || selection.templateId || selection.id || '').trim();
    if (!id) fail('ERR_FIGURE_SELECTION', `figureSelections[${index}] 缺少 template_id`);
    if (seen.has(id)) fail('ERR_FIGURE_SELECTION', `图件重复选择: ${id}`);
    seen.add(id);
    if (RETIRED_FIGURE_IDS.includes(id)) fail('ERR_RETIRED_FIGURE', `组图已退役，禁止选择: ${id}`);
    const template = facts.readyFigures.get(id);
    if (!template || !facts.allowedIds.has(id)) {
      fail('ERR_FIGURE_NOT_READY', `图件不是 Ready 单图: ${id}`);
    }
    if (template.composite === true || String(template.kind || '').toLowerCase().includes('composite')) {
      fail('ERR_RETIRED_FIGURE', `组图禁止调度: ${id}`);
    }
    if (!SAFE_NAME_RE.test(String(template.canonical_output || '').replace(/\.png$/i, ''))) {
      fail('ERR_UNSAFE_NAME', `图件产物名非法: ${id}`);
    }
  }
  return selections;
}

function requiredModClosure(selectedMods, facts) {
  const closure = new Set();
  const stack = [...selectedMods];
  while (stack.length) {
    const id = stack.pop();
    if (closure.has(id)) continue;
    const entry = facts.mods.get(id);
    if (!entry) fail('ERR_UNKNOWN_MOD', `未知 Mod: ${id}`);
    closure.add(id);
    const prior = facts.series.get(entry.seriesId).orderedMods
      .filter((candidate) => candidate.order < entry.order && candidate.required && !candidate.optional)
      .map((candidate) => candidate.id);
    for (const upstream of prior) if (!closure.has(upstream)) stack.push(upstream);
  }
  return closure;
}

export function compileWorkOrderPlan(order, options = {}) {
  const facts = options.facts || indexRegistry();
  const body = requirePlainObject(order, 'work order');
  if (String(body.schema_version || WORK_ORDER_SCHEMA_VERSION) !== WORK_ORDER_SCHEMA_VERSION) {
    fail('ERR_WORK_ORDER_SHAPE', `schema_version 必须是 ${WORK_ORDER_SCHEMA_VERSION}`);
  }
  const projectId = resolveProjectId(body);
  const lineId = resolveLine(body, facts);
  const selectedMods = requireArray(body.modIds ?? body.selectedMods ?? [], 'modIds')
    .map((id, index) => requireSafeName(id, `modIds[${index}]`));
  for (const id of selectedMods) {
    const entry = facts.mods.get(id);
    if (!entry || entry.seriesId !== lineId) {
      fail('ERR_CROSS_LINE_MOD', `Mod 不属于 ${lineId}: ${id}`);
    }
  }
  const selections = validateFigureSelections(body, facts);
  for (const selection of selections) {
    const templateId = String(selection.template_id || selection.templateId || selection.id);
    const template = facts.readyFigures.get(templateId);
    const required = Array.isArray(template.required_mod_ids) && template.required_mod_ids.length
      ? template.required_mod_ids
      : [template.producing_mod_id].filter(Boolean);
    for (const modId of required) {
      const entry = facts.mods.get(modId);
      if (!entry || entry.seriesId !== lineId) {
        fail('ERR_CROSS_LINE_MOD', `图件 ${templateId} 的前置 Mod 不属于 ${lineId}: ${modId}`);
      }
      if (!selectedMods.includes(modId)) selectedMods.push(modId);
    }
  }
  const closure = requiredModClosure(selectedMods, facts);
  const series = facts.series.get(lineId);
  const seed = Number.isInteger(Number(body.seed)) ? Number(body.seed) : Number(series.seed);
  if (!Number.isInteger(seed)) fail('ERR_SEED', `分析线 ${lineId} 缺少可复现 seed`);
  const dag = series.orderedMods
    .filter((entry) => closure.has(entry.id))
    .map((entry, index) => ({
      order: index + 1,
      modId: entry.id,
      script: entry.mod.script,
      stepId: entry.mod.script,
      stageId: entry.stageId,
      requires: [...(entry.mod.requires || [])],
      produces: [...(entry.mod.produces || [])],
      inputs: [...(entry.mod.requires || [])],
      outputs: [...(entry.mod.produces || [])],
      language: entry.mod.language || null,
      optional: entry.optional,
    }));
  const speciesScope = Array.isArray(body.speciesScope)
    ? body.speciesScope.map((item) => String(item).trim()).filter(Boolean)
    : [];
  if (speciesScope.length) {
    const scopeText = speciesScope.join(' ').toLowerCase();
    const allowHuman = /homo sapiens|human/.test(scopeText);
    const allowMouse = /mus musculus|mouse/.test(scopeText);
    for (const node of dag) {
      node.outputs = node.outputs.filter((name) => {
        if (/_human\./i.test(name) && !allowHuman) return false;
        if (/_mouse\./i.test(name) && !allowMouse) return false;
        return true;
      });
    }
  }
  if (!dag.length) fail('ERR_EMPTY_DAG', '编译后的 DAG 为空');
  const uploads = requireArray(body.uploads ?? [], 'uploads').map((item, index) => {
    const upload = requirePlainObject(item, `uploads[${index}]`);
    const filename = requireSafeName(upload.filename ?? upload.name, `uploads[${index}].filename`);
    const chunkSize = Number(upload.chunkSize ?? 1048576);
    if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
      fail('ERR_UPLOAD_SHAPE', `uploads[${index}].chunkSize 非法`);
    }
    const bytes = Buffer.isBuffer(upload.data)
      ? upload.data
      : Buffer.from(String(upload.content_base64 ?? ''), 'base64');
    if (!bytes.length) fail('ERR_UPLOAD_SHAPE', `uploads[${index}] 数据为空`);
    return {
      filename,
      lineId: String(upload.lineId || lineId),
      chunkSize,
      bytes,
      sha256: sha256Hex(bytes),
    };
  });
  for (const upload of uploads) {
    if (upload.lineId !== lineId) fail('ERR_CROSS_LINE_UPLOAD', `上传文件跨线: ${upload.filename}`);
  }
  if (body.computeAdapter === 'ssh' || body.allowSsh === true) {
    fail('ERR_SSH_DISABLED', 'SSH 通道已封存，见 _archive/ssh_retired_20261111/RESTORE.md');
  }
  if (body.computeAdapter && !['adb', 'mock'].includes(String(body.computeAdapter))) {
    fail('ERR_COMPUTE_ADAPTER', `computeAdapter 非法: ${body.computeAdapter}`);
  }
  return {
    schema_version: WORK_ORDER_SCHEMA_VERSION,
    projectId,
    lineId,
    seed,
    selectedMods,
    closure: [...closure],
    figureSelections: selections,
    uploads,
    computeAdapter: String(body.computeAdapter || 'adb'),
    speciesScope,
    dag,
    facts: { readyBaseline: facts.readyFigures.size, workflowMods: facts.mods.size },
  };
}

function makeReceiptIndex(receipts) {
  const byStep = new Map();
  for (const raw of Array.isArray(receipts) ? receipts : []) {
    if (!isPlainObject(raw)) continue;
    const step = String(raw.step_name || raw.step || raw.stepId || raw.mod_id || '').trim();
    if (!step) continue;
    const previous = byStep.get(step);
    const time = String(raw.end_time || raw.ended_at || raw.start_time || raw.started_at || '');
    if (!previous || time >= String(previous.end_time || previous.ended_at || '')) byStep.set(step, raw);
  }
  return byStep;
}

function receiptStartedAfter(receipt, sinceMs) {
  const raw = String(receipt?.start_time || receipt?.started_at || '').trim();
  if (!raw) return true;
  const started = Date.parse(raw);
  if (!Number.isFinite(started)) return true;
  // 允许 5 秒时钟抖动；更早的回执属于上一轮，不能被当成本轮完成证据。
  return started >= sinceMs - 5000;
}

function pickReceipts(payload) {
  const ordered = [];
  if (Array.isArray(payload?.receipts)) ordered.push(payload.receipts);
  if (Array.isArray(payload?.entries)) ordered.push(payload.entries);
  if (Array.isArray(payload)) ordered.push(payload);
  return ordered.length ? ordered[0] : [];
}

function validateTaskReceipt(task, receipt, plan) {
  const problems = [];
  if (!isPlainObject(receipt)) return ['缺少完成回执'];
  const projectId = String(receipt.project_id || receipt.projectId || '').trim();
  const lineId = String(receipt.line_id || receipt.lineId || '').trim();
  const stepName = String(receipt.step_name || receipt.step || receipt.stepId || '').trim();
  const status = String(receipt.status || '').trim();
  const exitCode = Number(receipt.exit_code ?? receipt.code ?? NaN);
  if (projectId !== plan.projectId) problems.push(`project_id 不匹配: ${projectId || '(空)'}`);
  if (lineId !== plan.lineId) problems.push(`line_id 不匹配: ${lineId || '(空)'}`);
  if (stepName !== task.script && stepName !== task.modId) {
    problems.push(`step_name 不匹配: ${stepName || '(空)'}`);
  }
  if (status !== 'completed') problems.push(`status=${status || '(空)'}`);
  if (exitCode !== 0) problems.push(`exit_code=${String(receipt.exit_code ?? receipt.code ?? '(空)')}`);
  if (receipt.ledger_receipt === 'missing') problems.push('台账回执缺失');
  const seed = Number(receipt.environment?.random_seed ?? receipt.seed ?? NaN);
  if (seed !== plan.seed) problems.push(`seed=${Number.isNaN(seed) ? '(空)' : seed}`);
  const io = receipt.io_files || {};
  const recordedOutputs = [...(Array.isArray(io.output) ? io.output : [])]
    .map((item) => String(item).split('/').pop());
  for (const output of task.outputs) {
    if (!recordedOutputs.includes(output)) problems.push(`回执缺产物: ${output}`);
  }
  return problems;
}

function normalizeTaskFromPlan(task) {
  if (!isPlainObject(task)) return null;
  const step = String(task.step || task.stepId || task.script || '').trim();
  const modId = String(task.mod_id || task.modId || '').trim();
  const inputs = Array.isArray(task.inputs) ? task.inputs.map(String) : [];
  const outputs = Array.isArray(task.outputs) ? task.outputs.map(String) : [];
  return {
    order: Number(task.order || 0),
    step,
    modId,
    inputs,
    outputs,
    adapted: task.adapted === true,
    scriptPath: String(task.scriptPath || task.script_path || ''),
    language: String(task.language || ''),
    canonicalOutput: String(task.canonicalOutput || task.canonical_output || ''),
    canonicalOutputs: Array.isArray(task.canonicalOutputs)
      ? task.canonicalOutputs.map(String)
      : (Array.isArray(task.canonical_outputs) ? task.canonical_outputs.map(String) : []),
    directOutputs: task.directOutputs === true,
    dependsOnStep: String(task.depends_on_step || task.dependsOnStep || ''),
  };
}

function normalizeExecutionPlan(payload, compiled) {
  const tasks = requireArray(payload?.tasks, 'execution-plan.tasks')
    .map(normalizeTaskFromPlan)
    .filter(Boolean);
  if (tasks.length !== compiled.dag.length) {
    fail('ERR_DAG_PARITY', `执行计划任务数 ${tasks.length} 与编译 DAG ${compiled.dag.length} 不一致`);
  }
  for (const [index, task] of tasks.entries()) {
    const expected = compiled.dag[index];
    if (task.step !== expected.script && task.step !== expected.modId) {
      fail('ERR_DAG_PARITY', `执行计划第 ${index + 1} 项与 DAG 不一致: ${task.step}`);
    }
  }
  return tasks;
}

function normalizeReceipts(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.entries)) {
    return payload.entries.map((entry) => entry?.data || entry);
  }
  if (Array.isArray(payload?.receipts)) return payload.receipts;
  return [];
}

function createDefaultRequest({ baseUrl = 'http://127.0.0.1:18787', headers = {}, timeoutMs } = {}) {
  if (typeof fetch !== 'function') fail('ERR_HTTP_CLIENT', '当前运行环境缺少 fetch');
  return async (method, requestPath, body) => {
    const isChunk = /\/api\/upload\/chunk\b/.test(requestPath);
    const isBinaryChunk = isChunk && (
      Buffer.isBuffer(body)
      || (isPlainObject(body) && Buffer.isBuffer(body.data))
      || (isPlainObject(body) && typeof body.content_base64 === 'string')
    );
    const requestBody = isBinaryChunk
      ? (Buffer.isBuffer(body) ? body : (Buffer.isBuffer(body.data)
        ? body.data
        : Buffer.from(body.content_base64, 'base64')))
      : body;
    // 分级超时（2026-11-11 P1）：统一 30s 会把合法长调用（上传 complete /
    // 任务 submit / 报告 build，服务端侧 scp 900s、桥接 300s）在编排器侧掐死，
    // 报 ERR_API_UNREACHABLE 而服务端还在干活。按调用形态分级给超时。
    const isLongCall = /\/api\/upload\/(init|complete)\b/.test(requestPath)
      || /\/api\/tasks\/submit\b/.test(requestPath)
      || /\/api\/report\/build\b/.test(requestPath)
      || /\/api\/projects\/(create|execution-plan)\b/.test(requestPath);
    const effectiveTimeoutMs = Number(timeoutMs ?? (isLongCall ? 960000 : 30000));
    const response = await fetch(`${String(baseUrl).replace(/\/+$/, '')}${requestPath}`, {
      method,
      headers: {
        ...(body === undefined
          ? {}
          : { 'Content-Type': isBinaryChunk ? 'application/octet-stream' : 'application/json' }),
        ...headers,
      },
      body: body === undefined
        ? undefined
        : (isBinaryChunk ? requestBody : JSON.stringify(requestBody)),
      signal: AbortSignal.timeout(effectiveTimeoutMs),
    });
    const text = await response.text();
    let payload = text;
    try { payload = text ? JSON.parse(text) : {}; } catch { /* 保留原文作为错误详情 */ }
    return { status: response.status, ok: response.ok, body: payload };
  };
}

async function callApi(request, method, requestPath, body, stage) {
  let response;
  try {
    response = await request(method, requestPath, body);
  } catch (cause) {
    fail('ERR_API_UNREACHABLE', `${stage} 调用异常: ${cause.message}`, { stage, path: requestPath });
  }
  if (!isPlainObject(response)) fail('ERR_API_SHAPE', `${stage} 响应形态非法`, { stage, path: requestPath });
  const ok = response.ok === undefined ? (Number(response.status) >= 200 && Number(response.status) < 300) : Boolean(response.ok);
  if (!ok) {
    fail('ERR_API_FAILED', `${stage} HTTP ${response.status}: ${JSON.stringify(response.body).slice(0, 500)}`, {
      stage,
      path: requestPath,
      status: response.status,
      body: response.body,
    });
  }
  return response.body;
}

function baseStageResult(name, status, extra = {}) {
  return { name, status, at: nowIso(), ...extra };
}

function blockedStages() {
  return [
    baseStageResult('create_project', 'blocked'),
    baseStageResult('uploads', 'blocked'),
    baseStageResult('execution_plan', 'blocked'),
    baseStageResult('task_dispatch', 'blocked'),
    baseStageResult('report_build', 'blocked'),
    baseStageResult('acceptance', 'blocked'),
  ];
}

function receiptReportDir(repoRoot, projectId) {
  return path.join(repoRoot, 'workspace/projects', projectId, 'report');
}

function relativePosix(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function canPersistReceipt(projectId) {
  return PROJECT_ID_RE.test(String(projectId || '')) && !String(projectId || '').startsWith('.');
}

function redactReceiptText(value, repoRoot) {
  let text = String(value ?? '');
  if (!text) return text;
  if (repoRoot) text = text.split(repoRoot).join('<workspace>');
  text = text.replace(/[A-Za-z]:[\\/][^\s"'`]+/g, '<path>');
  text = text.replace(/\/(?:mnt|home|root|tmp|var|usr|opt)\/[^\s"'`]+/g, '<path>');
  return text;
}

function basenameOnly(value) {
  const text = String(value ?? '').trim();
  if (!text) return text;
  const parts = text.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length ? parts.at(-1) : text;
}

function sanitizeTaskReceipt(receipt) {
  if (!isPlainObject(receipt)) return receipt;
  const clone = { ...receipt };
  if (isPlainObject(receipt.io_files)) {
    clone.io_files = {
      ...receipt.io_files,
      ...(Array.isArray(receipt.io_files.input) ? { input: receipt.io_files.input.map(basenameOnly) } : {}),
      ...(Array.isArray(receipt.io_files.output) ? { output: receipt.io_files.output.map(basenameOnly) } : {}),
    };
  }
  if (typeof receipt.error_log === 'string' && receipt.error_log.trim()) {
    clone.error_log = basenameOnly(receipt.error_log);
  }
  return clone;
}

function sanitizeStages(stages, repoRoot) {
  return (Array.isArray(stages) ? stages : []).map((stage) => {
    if (!isPlainObject(stage)) return stage;
    const clone = { ...stage };
    if (typeof stage.error === 'string') clone.error = redactReceiptText(stage.error, repoRoot);
    if (stage.name === 'task_dispatch' && Array.isArray(stage.tasks)) {
      clone.tasks = stage.tasks.map((task) => (
        isPlainObject(task) ? { ...task, receipt: sanitizeTaskReceipt(task.receipt) } : task
      ));
    }
    return clone;
  });
}

function sanitizeTaskReceipts(tasks) {
  return (Array.isArray(tasks) ? tasks : []).map((item) => ({
    order: item.order,
    mod_id: item.modId,
    step: item.step,
    task_id: item.taskId,
    status: item.status,
    receipt: sanitizeTaskReceipt(item.receipt),
  }));
}

function terminalStatusFor(error) {
  if (error?.details?.blocked === true) return 'blocked';
  return BLOCKED_TERMINAL_CODES.has(String(error?.code || '')) ? 'blocked' : 'failed';
}

async function buildDeliverySegment(repoRoot, projectId, report, tarName) {
  const acceptance = isPlainObject(report?.acceptance) ? report.acceptance : {};
  const receiptName = String(acceptance.receipt || `${projectId}.receipt.json`);
  const acceptanceFile = path.join(
    repoRoot,
    'workspace/projects',
    projectId,
    'deliverables',
    'acceptance',
    receiptName,
  );
  let tarSha256 = null;
  let verifiedCount = Number.isInteger(acceptance.verified_count) ? acceptance.verified_count : null;
  let coverageOk = acceptance.sentinel === 'DELIVERY_ACCEPTANCE_OK 四道关全绿';
  let verifierVersion = acceptance.verifier_version || null;

  if (fs.existsSync(acceptanceFile)) {
    try {
      const stored = JSON.parse(fs.readFileSync(acceptanceFile, 'utf8'));
      if (typeof stored.tar_sha256 === 'string') tarSha256 = stored.tar_sha256;
      if (Number.isInteger(stored.verified_count)) verifiedCount = stored.verified_count;
      if (typeof stored.coverage_ok === 'boolean') coverageOk = stored.coverage_ok;
      if (stored.verifier_version) verifierVersion = String(stored.verifier_version);
    } catch {
      // 回执不可读时保留报告构建返回值，放行判据仍由现有下载门禁决定。
    }
  }

  if (!tarSha256 && tarName) {
    const tarFile = path.join(repoRoot, 'workspace/projects', projectId, 'deliverables', tarName);
    if (fs.existsSync(tarFile)) tarSha256 = await sha256File(tarFile);
  }

  return {
    receipt_path: relativePosix(repoRoot, acceptanceFile),
    tar_sha256: tarSha256,
    verified_count: verifiedCount,
    coverage_ok: coverageOk === true,
    verifier_version: verifierVersion,
  };
}

async function artifactEntry(repoRoot, filePath, role, stage) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  return {
    path: relativePosix(repoRoot, filePath),
    role,
    bytes: stat.size,
    sha256: await sha256File(filePath),
    stage,
  };
}

function writeProjectSummary(repoRoot, projectId, summary) {
  const reportDir = receiptReportDir(repoRoot, projectId);
  fs.mkdirSync(reportDir, { recursive: true });
  const summaryFile = path.join(reportDir, 'Project_Summary.md');
  const summaryText = [
    `# 项目汇总：${projectId}`,
    '',
    `- 工单编号：${summary.work_order_id}`,
    `- 状态：${summary.status}`,
    `- 分析线：${summary.lineId}`,
    `- 分析步骤：${summary.task_count}`,
    `- 完成步骤：${summary.completed_task_count}`,
    `- Ready 单图：${summary.figure_count}`,
    `- 随机种子：${summary.seed}`,
    `- 交付验收：${summary.delivery_verified ? '通过' : '未通过'}`,
    `- 解读报告：${summary.analysis_report_md || '未生成'}`,
    `- 交互报告：${summary.analysis_report_html || '未生成'}`,
    `- 交付包：${summary.delivery_tar || '未生成'}`,
    '',
    '本汇总只记录业务产物与回执状态，不含运行环境与设施路径。',
    '',
    'WORK_ORDER_SUMMARY_OK',
  ].join('\n');
  fs.writeFileSync(summaryFile, summaryText, 'utf8');
  return summaryFile;
}

function writeLegacyReceipt(repoRoot, projectId, receipt) {
  const reportDir = receiptReportDir(repoRoot, projectId);
  fs.mkdirSync(reportDir, { recursive: true });
  const receiptFile = path.join(reportDir, LEGACY_RECEIPT_FILENAME);
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2), 'utf8');
  return receiptFile;
}

function persistAuthorityReceipt(repoRoot, receiptV1) {
  if (!canPersistReceipt(receiptV1.project_id)) return null;
  const reportDir = receiptReportDir(repoRoot, receiptV1.project_id);
  const receiptFile = path.join(reportDir, RECEIPT_V1_FILENAME);
  writeReceiptV1Atomic(receiptV1, receiptFile);
  return receiptFile;
}

export async function runWorkOrder(order, options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const request = options.request || createDefaultRequest(options);
  const poll = {
    intervalMs: Number(options.pollIntervalMs ?? 1000),
    maxAttempts: Number(options.pollMaxAttempts ?? 30),
    sleep: options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
  const stages = [];
  const tasks = [];
  const uploadReceipts = [];
  const startedAt = nowIso();
  const workOrderDigest = computeWorkOrderDigest(order ?? {});
  const initialProjectId = String(order?.projectId || order?.project_id || '');
  const initialWorkOrderId = String(
    order?.workOrderId || order?.work_order_id || (initialProjectId ? `WO-${initialProjectId}` : 'WO-UNKNOWN'),
  );
  let receiptV1 = createReceiptV1({
    workOrderDigest,
    workOrderId: initialWorkOrderId,
    projectId: initialProjectId,
    lineId: String(order?.lineId || order?.execution?.line_id || ''),
    startedAt,
    sourceSchemaVersion: String(order?.schema_version || WORK_ORDER_SCHEMA_VERSION),
    seed: Number.isInteger(Number(order?.seed ?? order?.execution?.seed))
      ? Number(order?.seed ?? order?.execution?.seed)
      : null,
    computeAdapter: String(order?.computeAdapter || order?.execution?.compute_adapter || 'adb'),
  });
  let compiled;
  try {
    order = normalizeWorkOrderInput(order);
    compiled = compileWorkOrderPlan(order, options);
    receiptV1 = updateReceiptStatus(receiptV1, 'running', {
      work_order_id: String(order.workOrderId || order.ticketId || `WO-${compiled.projectId}`),
      project_id: compiled.projectId,
      line_id: compiled.lineId,
      source_schema_version: order.sourceSchemaVersion || WORK_ORDER_SCHEMA_VERSION,
      seed: compiled.seed,
      compute_adapter: compiled.computeAdapter,
      dag: compiled.dag.map((node) => ({ order: node.order, mod_id: node.modId, step: node.script })),
    });
    stages.push(baseStageResult('validate', 'passed', {
      projectId: compiled.projectId,
      lineId: compiled.lineId,
      computeAdapter: compiled.computeAdapter,
      dagSize: compiled.dag.length,
      readyBaseline: compiled.facts.readyBaseline,
    }));
  } catch (cause) {
    const error = cause instanceof WorkOrderError
      ? cause
      : new WorkOrderError('ERR_VALIDATE', cause.message);
    const terminalStatus = terminalStatusFor(error);
    const failureStages = sanitizeStages([
      baseStageResult('validate', 'failed', {
        code: error.code,
        error: redactReceiptText(error.message, repoRoot),
      }),
      ...blockedStages(),
    ], repoRoot);
    receiptV1 = updateReceiptStatus(receiptV1, terminalStatus, {
      finished_at: nowIso(),
      failure_stage: 'validate',
      error: { code: error.code, message: redactReceiptText(error.message, repoRoot) },
      stages: failureStages,
    });
    try {
      persistAuthorityReceipt(repoRoot, receiptV1);
    } catch {
      // 权威回执写失败不掩盖原始校验错误，失败码仍按工单校验结果返回。
    }
    const receipt = buildOldReceiptProjection(receiptV1);
    return {
      ok: false,
      status: terminalStatus,
      code: error.code,
      error: error.message,
      receipt,
      receiptV1,
      stages: failureStages,
    };
  }

  const projectId = compiled.projectId;
  const lineId = compiled.lineId;
  const resume = order.resume === true;
  const resumeSinceRaw = String(order.resumeSince || '').trim();
  const resumeSince = resumeSinceRaw ? Date.parse(resumeSinceRaw) : 0;
  const resumeSinceMs = Number.isFinite(resumeSince) ? resumeSince : 0;
  const koGene = String(order.biologicalPriors?.targetKoGene || order.koGene || '').trim();
  const createBody = {
    ...(isPlainObject(order.createPayload) ? order.createPayload : {}),
    ...(isPlainObject(order.basicInfo) ? { basicInfo: order.basicInfo } : {}),
    ...(isPlainObject(order.dataSource) ? { dataSource: order.dataSource } : {}),
    ...(isPlainObject(order.groupingDesign) ? { groupingDesign: order.groupingDesign } : {}),
    ...(isPlainObject(order.analysisCutoffs) ? { analysisCutoffs: order.analysisCutoffs } : {}),
    ...(isPlainObject(order.aclAndOutput) ? { aclAndOutput: order.aclAndOutput } : {}),
    ...(isPlainObject(order.biologicalPriors) ? { biologicalPriors: order.biologicalPriors } : {}),
    projectId,
    lineId,
    seriesId: lineId,
    name: String(order.basicInfo?.name || order.name || order.projectName || projectId),
    description: String(order.description || ''),
    modIds: compiled.selectedMods,
    figure_templates: compiled.figureSelections,
    seed: compiled.seed,
  };
  const workOrderId = String(order.workOrderId || order.ticketId || `WO-${projectId}`);
  const v2Inputs = order.sourceSchemaVersion === WORK_ORDER_V2_SCHEMA_VERSION && Array.isArray(order.inputs)
    ? order.inputs
    : [];

  try {
    const preparedInputs = v2Inputs.length > 0
      ? await prepareInputFiles(v2Inputs, options.inputsRoot || repoRoot)
      : [];
    let created = null;
    try {
      created = await callApi(request, 'POST', '/api/projects/create', createBody, 'create_project');
      if (created?.ok === false) fail('ERR_CREATE_PROJECT', created.error || '建项返回 ok=false');
      stages.push(baseStageResult('create_project', 'passed', { projectId, lineId }));
    } catch (cause) {
      if (resume && cause instanceof WorkOrderError && cause.code === 'ERR_API_FAILED'
        && cause.details?.status === 409) {
        stages.push(baseStageResult('create_project', 'passed', { projectId, lineId, resumed: true }));
      } else {
        throw cause;
      }
    }

    if (preparedInputs.length > 0) {
      for (const [index, input] of preparedInputs.entries()) {
        const init = await callApi(request, 'POST', '/api/upload/init', {
          projectId,
          lineId,
          filename: input.filename,
          size: input.bytes,
          fileSize: input.bytes,
          lastModified: `${compiled.seed}-${index}`,
        }, 'upload_init');
        const uploadId = String(init?.uploadId || '');
        if (!uploadId) fail('ERR_UPLOAD_INIT', '上传初始化未返回 uploadId');
        const chunkSize = Number(init?.chunkSize || 1048576);
        if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
          fail('ERR_UPLOAD_INIT', `上传初始化返回的 chunkSize 非法: ${init?.chunkSize}`);
        }
        let chunkIndex = 0;
        let uploadedBytes = 0;
        for await (const chunk of fileChunks(input.absolutePath, chunkSize)) {
          await callApi(
            request,
            'POST',
            `/api/upload/chunk?uploadId=${encodeURIComponent(uploadId)}&index=${chunkIndex}`,
            { uploadId, index: chunkIndex, data: chunk },
            'upload_chunk',
          );
          uploadedBytes += chunk.length;
          chunkIndex += 1;
        }
        if (uploadedBytes !== input.bytes) {
          fail('ERR_INPUT_FILE', `上传字节数与声明不一致: ${input.path}，声明 ${input.bytes}，实际 ${uploadedBytes}`);
        }
        const complete = await callApi(request, 'POST', '/api/upload/complete', {
          projectId,
          lineId,
          uploadId,
          filename: input.filename,
        }, 'upload_complete');
        if (complete?.ok !== true || complete?.sizeMatch !== true) {
          fail('ERR_UPLOAD_RECEIPT', `上传回执不完整: ${input.filename}`);
        }
        const remoteSha256 = typeof complete?.sha256 === 'string' ? complete.sha256 : null;
        if (remoteSha256 && remoteSha256 !== input.sha256) {
          fail('ERR_UPLOAD_HASH_MISMATCH', `上传回执哈希与工单声明不一致: ${input.filename}`);
        }
        uploadReceipts.push({
          filename: input.filename,
          role: input.role,
          path: input.path,
          uploadId,
          bytes: input.bytes,
          sha256: input.sha256,
          remote_sha256: remoteSha256,
          sizeMatch: complete.sizeMatch,
        });
      }
    }
    for (const [index, upload] of compiled.uploads.entries()) {
      const init = await callApi(request, 'POST', '/api/upload/init', {
        projectId,
        lineId: upload.lineId,
        filename: upload.filename,
        size: upload.bytes.length,
        fileSize: upload.bytes.length,
        lastModified: `${compiled.seed}-${index}`,
      }, 'upload_init');
      const uploadId = String(init?.uploadId || '');
      if (!uploadId) fail('ERR_UPLOAD_INIT', '上传初始化未返回 uploadId');
      const chunkSize = Number(init?.chunkSize || upload.chunkSize);
      let chunkIndex = 0;
      for (let offset = 0; offset < upload.bytes.length; offset += chunkSize, chunkIndex += 1) {
        const chunkBody = {
          uploadId,
          index: chunkIndex,
          content_base64: upload.bytes.subarray(offset, offset + chunkSize).toString('base64'),
        };
        await callApi(request, 'POST', `/api/upload/chunk?uploadId=${encodeURIComponent(uploadId)}&index=${chunkIndex}`, chunkBody, 'upload_chunk');
      }
      const complete = await callApi(request, 'POST', '/api/upload/complete', {
        projectId,
        lineId: upload.lineId,
        uploadId,
        filename: upload.filename,
      }, 'upload_complete');
      if (complete?.ok !== true || complete?.sizeMatch !== true) {
        fail('ERR_UPLOAD_RECEIPT', `上传回执不完整: ${upload.filename}`);
      }
      uploadReceipts.push({
        filename: upload.filename,
        uploadId,
        bytes: upload.bytes.length,
        sha256: upload.sha256,
        sizeMatch: complete.sizeMatch,
      });
    }
    stages.push(baseStageResult('uploads', 'passed', { count: uploadReceipts.length, receipts: uploadReceipts }));

    const planPayload = await callApi(request, 'POST', '/api/projects/execution-plan', {
      projectId,
      ...(compiled.speciesScope.length ? { speciesScope: compiled.speciesScope } : {}),
      pipelineDag: compiled.dag.map((node) => ({
        order: node.order,
        stepId: node.stepId,
        mod_id: node.modId,
        inputs: node.inputs,
        outputs: node.outputs,
      })),
    }, 'execution_plan');
    if (planPayload?.ok !== true) fail('ERR_EXECUTION_PLAN', planPayload?.errors?.join('; ') || '执行计划返回 ok=false');
    const planTasks = normalizeExecutionPlan(planPayload, compiled);
    stages.push(baseStageResult('execution_plan', 'passed', { task_count: planTasks.length }));

    for (const [index, task] of planTasks.entries()) {
      const expected = compiled.dag[index];
      const body = {
        projectId,
        lineId,
        step: task.step,
        inputs: task.inputs,
        outputs: task.outputs,
        seed: compiled.seed,
      };
      if (task.adapted) {
        body.adapted = true;
        body.scriptPath = task.scriptPath;
        body.language = task.language;
        body.canonicalOutput = task.canonicalOutput;
        if (task.canonicalOutputs.length) body.canonicalOutputs = task.canonicalOutputs;
        if (task.directOutputs) body.directOutputs = true;
        body.dependsOnStep = task.dependsOnStep;
      }
      if (koGene && /knockout|ko_/i.test(task.step)) body.targetKoGene = koGene;
      if (resume) {
        try {
          const priorLedger = await callApi(
            request,
            'GET',
            `/api/ledger/check?project=${encodeURIComponent(projectId)}`,
            undefined,
            'task_ledger',
          );
          const priorByStep = makeReceiptIndex(
            pickReceipts(priorLedger).filter((item) => receiptStartedAfter(item, resumeSinceMs)),
          );
          const prior = priorByStep.get(task.step) || priorByStep.get(expected.modId);
          if (prior) {
            const problems = validateTaskReceipt(expected, prior, compiled);
            if (problems.length === 0) {
              tasks.push({
                order: expected.order,
                modId: expected.modId,
                step: task.step,
                taskId: String(prior.task_id || ''),
                status: 'passed',
                receipt: prior,
                receipt_problems: [],
                resumed: true,
              });
              continue;
            }
          }
        } catch {
          // 台账暂时不可读时继续走正常提交，不让续跑判断本身成为单点。
        }
      }
      const submittedAt = Date.now();
      const submitted = await callApi(request, 'POST', '/api/tasks/submit', body, 'task_submit');
      const taskId = String(submitted?.taskId || '');
      if (!taskId) fail('ERR_TASK_SUBMIT', `${task.step} 未返回 taskId`);
      let receipt = null;
      let receiptProblems = [`${task.step}: 未取得完成回执`];
      for (let attempt = 0; attempt < poll.maxAttempts; attempt += 1) {
        const taskList = await callApi(request, 'GET', '/api/tasks', undefined, 'task_status');
        const running = (Array.isArray(taskList?.tasks) ? taskList.tasks : []).some((item) => String(item?.taskId) === taskId);
        const ledger = await callApi(
          request,
          'GET',
          `/api/ledger/check?project=${encodeURIComponent(projectId)}`,
          undefined,
          'task_ledger',
        );
        if (ledger?.blocked === true) {
          fail('ERR_LEDGER_BLOCKED', ledger.reason || '台账巡检被阻塞');
        }
        const byStep = makeReceiptIndex(
          pickReceipts(ledger).filter((item) => receiptStartedAfter(item, submittedAt)),
        );
        const candidate = byStep.get(task.step) || byStep.get(expected.modId);
        if (candidate) {
          const problems = validateTaskReceipt(expected, candidate, compiled);
          if (problems.length === 0) {
            receipt = candidate;
            receiptProblems = [];
          } else {
            receiptProblems = problems;
          }
          if (String(candidate.status) === 'failed') break;
          if (receipt) break;
        }
        if (!running && candidate && !receipt) break;
        if (poll.intervalMs > 0) await poll.sleep(poll.intervalMs);
      }
      const passed = Boolean(receipt) && receiptProblems.length === 0;
      tasks.push({
        order: expected.order,
        modId: expected.modId,
        step: task.step,
        taskId,
        status: passed ? 'passed' : 'failed',
        receipt,
        receipt_problems: receiptProblems,
      });
      if (!passed) {
        fail('ERR_TASK_RECEIPT', `${task.step} 未完成回执校验: ${receiptProblems.join('; ')}`, { task: task.step });
      }
    }
    stages.push(baseStageResult('task_dispatch', 'passed', { task_count: tasks.length, tasks }));

    const report = await callApi(
      request,
      'POST',
      '/api/report/build',
      { projectId, force: order.forceReportBuild === true },
      'report_build',
    );
    if (report?.ok !== true || report?.acceptance?.sentinel !== 'DELIVERY_ACCEPTANCE_OK 四道关全绿') {
      fail('ERR_REPORT_ACCEPTANCE', report?.error || '报告构建未返回有效验收哨兵');
    }
    stages.push(baseStageResult('report_build', 'passed', {
      files: report.files || [],
      acceptance: report.acceptance || {},
    }));

    const files = await callApi(request, 'GET', `/api/report/files?projectId=${encodeURIComponent(projectId)}`, undefined, 'delivery_verification');
    if (files?.delivery_verified !== true) {
      fail('ERR_DELIVERY_UNVERIFIED', files?.verify_reason || '交付验收回执无效');
    }
    const names = (Array.isArray(files.files) ? files.files : []).map((item) => String(item?.name || ''));
    const hasMd = names.includes('Analysis_Report.md');
    const hasHtml = names.includes('Analysis_Report.html');
    const tar = names.find((name) => /_Client_Delivery\.tar\.gz$/.test(name)) || null;
    if (!hasMd || !hasHtml || !tar) {
      fail('ERR_REPORT_FILES', `解读报告或交付包缺失: ${names.join(', ') || '(空)'}`);
    }
    stages.push(baseStageResult('acceptance', 'passed', {
      delivery_verified: true,
      receipt: report.acceptance?.receipt || null,
      verified_count: report.acceptance?.verified_count ?? null,
      analysis_report_md: 'Analysis_Report.md',
      analysis_report_html: 'Analysis_Report.html',
      delivery_tar: tar,
    }));

    const summary = {
      work_order_id: workOrderId,
      status: 'completed',
      projectId,
      lineId,
      seed: compiled.seed,
      computeAdapter: compiled.computeAdapter,
      task_count: tasks.length,
      completed_task_count: tasks.filter((item) => item.status === 'passed').length,
      figure_count: compiled.figureSelections.length,
      delivery_verified: true,
      analysis_report_md: 'Analysis_Report.md',
      analysis_report_html: 'Analysis_Report.html',
      delivery_tar: tar,
      at: nowIso(),
    };
    const delivery = await buildDeliverySegment(repoRoot, projectId, report, tar);
    const completed = updateReceiptStatus(receiptV1, 'completed', {
      finished_at: nowIso(),
      stages: sanitizeStages(stages, repoRoot),
      upload_receipts: uploadReceipts,
      task_receipts: sanitizeTaskReceipts(tasks),
      acceptance: report.acceptance || {},
      delivery,
      summary,
    });

    const summaryFile = writeProjectSummary(repoRoot, projectId, summary);
    const reportDir = receiptReportDir(repoRoot, projectId);
    const legacyFile = path.join(reportDir, LEGACY_RECEIPT_FILENAME);
    const summaryArtifact = await artifactEntry(repoRoot, summaryFile, 'project_summary', 'report_build');
    const reportArtifacts = (await Promise.all([
      artifactEntry(repoRoot, path.join(repoRoot, 'workspace/projects', projectId, 'deliverables', 'Analysis_Report.md'), 'analysis_report_md', 'acceptance'),
      artifactEntry(repoRoot, path.join(repoRoot, 'workspace/projects', projectId, 'deliverables', 'Analysis_Report.html'), 'analysis_report_html', 'acceptance'),
      artifactEntry(repoRoot, path.join(repoRoot, 'workspace/projects', projectId, 'deliverables', tar), 'delivery_tar', 'acceptance'),
    ])).filter(Boolean);
    const legacyRel = relativePosix(repoRoot, legacyFile);
    const artifacts = {
      project_summary: summaryArtifact?.path || relativePosix(repoRoot, summaryFile),
      work_order_receipt: legacyRel,
    };
    summary.artifacts = artifacts;
    completed.summary = summary;
    completed.artifacts = [
      ...(summaryArtifact ? [summaryArtifact] : []),
      ...reportArtifacts,
      { path: legacyRel, role: 'work_order_receipt', bytes: null, sha256: null, stage: 'report_build' },
    ];

    const legacyReceipt = buildOldReceiptProjection(completed);
    writeLegacyReceipt(repoRoot, projectId, legacyReceipt);
    const legacyArtifact = await artifactEntry(repoRoot, legacyFile, 'work_order_receipt', 'report_build');
    completed.artifacts = completed.artifacts
      .map((item) => (item.role === 'work_order_receipt' ? legacyArtifact : item))
      .filter(Boolean);

    try {
      persistAuthorityReceipt(repoRoot, completed);
    } catch (cause) {
      try {
        fs.rmSync(legacyFile, { force: true });
      } catch {
        // 清理失败不改变 fail closed 结论，调用方仍拿到写盘错误。
      }
      throw new WorkOrderError('ERR_RECEIPT_WRITE', `权威回执写盘失败: ${cause.message}`, { stage: 'acceptance' });
    }

    return {
      ok: true,
      status: 'completed',
      projectId,
      lineId,
      summary,
      receipt: legacyReceipt,
      receiptV1: completed,
      stages,
      artifacts,
    };
  } catch (cause) {
    const error = cause instanceof WorkOrderError
      ? cause
      : new WorkOrderError('ERR_ORCHESTRATION', cause.message);
    const failedStage = error.details?.stage || stages.at(-1)?.name || 'validate';
    const stageAliases = Object.freeze({
      task_submit: 'task_dispatch',
      task_status: 'task_dispatch',
      task_ledger: 'task_dispatch',
      report_files: 'acceptance',
      delivery_verification: 'acceptance',
      upload_init: 'uploads',
      upload_chunk: 'uploads',
      upload_complete: 'uploads',
    });
    const normalizedStage = stageAliases[failedStage] || failedStage;
    const alreadyPassed = new Set(stages.filter((stage) => stage.status === 'passed').map((stage) => stage.name));
    const remaining = [
      'create_project', 'uploads', 'execution_plan', 'task_dispatch', 'report_build', 'acceptance',
    ].filter((name) => !alreadyPassed.has(name));
    for (const name of remaining) {
      stages.push(baseStageResult(name, name === normalizedStage ? 'failed' : 'blocked'));
    }
    const terminalStatus = terminalStatusFor(error);
    const failureStages = sanitizeStages(stages, repoRoot);
    try {
      receiptV1 = updateReceiptStatus(receiptV1, terminalStatus, {
        finished_at: nowIso(),
        failure_stage: normalizedStage,
        error: { code: error.code, message: redactReceiptText(error.message, repoRoot) },
        stages: failureStages,
        task_receipts: sanitizeTaskReceipts(tasks),
        upload_receipts: uploadReceipts,
      });
    } catch (transitionCause) {
      if (transitionCause?.code !== 'ERR_RECEIPT_TERMINAL') throw transitionCause;
    }
    try {
      persistAuthorityReceipt(repoRoot, receiptV1);
    } catch {
      // 权威回执写失败不掩盖原始执行错误，调用方仍拿到失败码与阶段证据。
    }
    const receipt = buildOldReceiptProjection(receiptV1);
    return {
      ok: false,
      status: terminalStatus,
      code: error.code,
      error: error.message,
      projectId,
      lineId,
      receipt,
      receiptV1,
      stages: failureStages,
    };
  }
}

export function loadWorkOrder(file) {
  return normalizeWorkOrderInput(JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')));
}

export function main(argv = process.argv.slice(2)) {
  const file = argv.find((item) => !item.startsWith('--'));
  if (!file) {
    console.error('用法: node tools/dev/work_order_orchestrator.mjs <work_order.json> [--base-url <url>]');
    return 2;
  }
  const baseIndex = argv.indexOf('--base-url');
  const baseUrl = baseIndex >= 0 ? argv[baseIndex + 1] : process.env.BIO_WORKBENCH_BASE || 'http://127.0.0.1:18787';
  const authUser = process.env.BIO_WORKBENCH_USER || '';
  const authPass = process.env.BIO_WORKBENCH_PASS || '';
  const headers = authUser && authPass
    ? { Authorization: `Basic ${Buffer.from(`${authUser}:${authPass}`).toString('base64')}` }
    : {};
  let order;
  try {
    order = loadWorkOrder(file);
  } catch (cause) {
    console.error(`${cause.code || 'ERR_WORK_ORDER_LOAD'}: ${cause.message}`);
    return Promise.resolve(1);
  }
  return runWorkOrder(order, { baseUrl, headers }).then((result) => {
    console.log(JSON.stringify(result.receipt, null, 2));
    if (!result.ok) {
      console.error(`${result.code}: ${result.error}`);
      return 1;
    }
    console.log('WORK_ORDER_ORCHESTRATOR_OK');
    return 0;
  }).catch((cause) => {
    console.error(`${cause.code || 'ERR_ORCHESTRATION'}: ${cause.message}`);
    return 1;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; });
}
