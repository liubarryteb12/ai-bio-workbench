/**
 * work_order.service.js：作业簿记与执行入口。
 *
 * 本模块只做作业落盘、状态机与编排器调用，不碰 req/res。
 * 磁盘边界由调用方传入 baseDir，测试可指向临时目录。
 * 执行语义仍归 tools/dev/work_order_orchestrator.mjs，本层不改 DAG 与回执判据。
 */
import fs from 'node:fs';
import path from 'node:path';

import { atomicWriteFileSync } from '../atomic_write.js';
import {
  normalizeWorkOrderInput,
  runWorkOrder as defaultRunWorkOrder,
} from '../../../tools/dev/work_order_orchestrator.mjs';
import { normalizeWorkOrderV2 } from '../../../shared/work_order_v2.mjs';
import { PORTAL_INBOX } from '../portal_inbox.js';
import { buildWorkOrderDraftFromPackage } from './package_to_work_order.js';
import { writeReceiptV1Atomic } from '../receipt_v1.js';

export const WORK_ORDER_STATUSES = Object.freeze([
  'queued', 'running', 'completed', 'failed', 'blocked',
]);

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'blocked']);
const WORK_ORDER_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const inflight = new Set();

/**
 * 进程内单并发泵。队列真源始终是磁盘 meta：
 *   approved === true 且 status === 'queued' 的作业按 approved_at 升序排队（先批准先执行），
 *   approved_at 缺失时按 created_at 升序兜底。
 * 这里只保存当前泵的句柄与运行标志，不做第二份队列副本。
 */
const queueRunner = {
  running: false,
  baseDir: null,
  options: {},
  currentId: null,
  wake: null,
  loop: null,
};

export class WorkOrderServiceError extends Error {
  constructor(code, message, status = 500, details = {}) {
    super(message);
    this.name = 'WorkOrderServiceError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function fail(code, message, status = 500, details = {}) {
  throw new WorkOrderServiceError(code, message, status, details);
}

function safeWorkOrderId(value) {
  const text = String(value ?? '').trim();
  if (!WORK_ORDER_ID_RE.test(text) || text.startsWith('.') || text === '.' || text === '..') {
    fail('ERR_WORK_ORDER_ID', '作业号非法：只允许字母、数字、点、下划线、连字符，1 到 64 位', 400);
  }
  return text;
}

function projectsRoot(baseDir) {
  return path.resolve(baseDir, 'workspace', 'projects');
}

function workOrderDir(baseDir, projectId) {
  return path.join(projectsRoot(baseDir), projectId, 'work_orders');
}

function receiptFile(baseDir, projectId) {
  return path.join(projectsRoot(baseDir), projectId, 'report', 'receipt.v1.json');
}

/**
 * 单工单专属回执副本。
 *
 * 项目级 report/receipt.v1.json 是「最近一次」的位置，同项目多张工单会互相覆盖
 * （2026-11-12 模拟实测：4 单同项目跑完，只有最后一单能读回自己的回执）。
 * 权威回执按工单号各存一份，项目级文件保留作最新投影。
 */
function workOrderReceiptFile(baseDir, projectId, workOrderId) {
  return path.join(workOrderDir(baseDir, projectId), `${workOrderId}.receipt.v1.json`);
}

function safeReceiptFile(baseDir, relativePath) {
  const text = String(relativePath || '');
  const segments = text.split('/');
  const unsafe = !text
    || text.startsWith('/')
    || /^[A-Za-z]:/.test(text)
    || text.includes('\\')
    || segments.some((segment) => !segment || segment === '..');
  if (unsafe) {
    fail('ERR_RECEIPT_PATH', '回执路径必须是仓库内相对路径', 500);
  }
  const root = path.resolve(baseDir);
  const file = path.resolve(root, ...segments);
  if (!file.startsWith(root + path.sep)) {
    fail('ERR_RECEIPT_PATH', '回执路径越界', 500);
  }
  return file;
}

function relativePosix(baseDir, filePath) {
  return path.relative(baseDir, filePath).split(path.sep).join('/');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonAtomic(file, value) {
  atomicWriteFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function redact(value, baseDir) {
  let text = String(value ?? '');
  if (baseDir) text = text.split(path.resolve(baseDir)).join('<workspace>');
  text = text.replace(/[A-Za-z]:[\\/][^\s"'`]+/g, '<path>');
  text = text.replace(/\/(?:mnt|home|root|tmp|var|usr|opt)\/[^\s"'`]+/g, '<path>');
  return text;
}

function metaFromOrder(baseDir, order, normalized, status = 'queued', actor = null) {
  const now = new Date().toISOString();
  const projectId = normalized.projectId;
  const meta = {
    status,
    work_order_id: normalized.workOrderId,
    project_id: projectId,
    line_id: normalized.lineId,
    created_at: now,
    updated_at: now,
    approved: false,
    approved_at: null,
    receipt_path: relativePosix(baseDir, receiptFile(baseDir, projectId)),
  };
  // 主体字段只由服务端认证结果写入，请求体里的 actor 不参与。
  if (actor && actor.kind) {
    meta.created_by = { kind: actor.kind, id: String(actor.id || actor.kind), role: String(actor.role || 'admin') };
    meta.last_updated_by = { ...meta.created_by };
  }
  return meta;
}

function readAllMeta(baseDir, projectId = null) {
  const root = projectsRoot(baseDir);
  if (!fs.existsSync(root)) return [];
  const filter = projectId ? String(projectId) : '';
  const rows = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (filter && entry.name !== filter) continue;
    const dir = path.join(root, entry.name, 'work_orders');
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.meta.json')) continue;
      const metaFile = path.join(dir, file);
      let meta;
      try {
        meta = readJson(metaFile);
      } catch {
        continue;
      }
      if (String(meta.project_id) !== entry.name) continue;
      if (!WORK_ORDER_STATUSES.includes(String(meta.status))) continue;
      if (!meta.work_order_id || !meta.line_id || !meta.created_at) continue;
      rows.push({ meta, metaFile });
    }
  }
  rows.sort((left, right) => {
    // 排序键：approved_at 优先（先批准先执行），创建序兜底。
    // 为什么：管理员乱序批准时，position 显示「先批准先执行」，但泵实际按 created_at
    // 出队，人看到的顺序与实际执行顺序不一致（2026-11-12 模拟实测）。
    // approved_at 缺失（未批准的 queued）按创建序兜底，保持旧行为。
    const approvedLeft = String(left.meta.approved_at || '').trim();
    const approvedRight = String(right.meta.approved_at || '').trim();
    if (approvedLeft && approvedRight && approvedLeft !== approvedRight) {
      return approvedLeft.localeCompare(approvedRight);
    }
    if (approvedLeft && !approvedRight) return -1;
    if (!approvedLeft && approvedRight) return 1;
    const byTime = String(left.meta.created_at).localeCompare(String(right.meta.created_at));
    if (byTime !== 0) return byTime;
    return String(left.meta.work_order_id).localeCompare(String(right.meta.work_order_id));
  });
  return rows;
}

function publicRow(meta) {
  return {
    work_order_id: String(meta.work_order_id),
    project_id: String(meta.project_id),
    line_id: String(meta.line_id),
    status: String(meta.status),
    created_at: String(meta.created_at),
  };
}

function isApprovedQueued(meta) {
  return meta.approved === true && String(meta.status) === 'queued';
}

function locateMeta(baseDir, workOrderId) {
  const id = safeWorkOrderId(workOrderId);
  const root = projectsRoot(baseDir);
  if (!fs.existsSync(root)) {
    fail('ERR_WORK_ORDER_NOT_FOUND', `作业不存在: ${id}`, 404);
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const projectId = entry.name;
    const metaFile = path.join(workOrderDir(baseDir, projectId), `${id}.meta.json`);
    if (!fs.existsSync(metaFile)) continue;
    let meta;
    try {
      meta = readJson(metaFile);
    } catch {
      continue;
    }
    if (String(meta.work_order_id) !== id || String(meta.project_id) !== projectId) continue;
    return { meta, metaFile, orderFile: path.join(workOrderDir(baseDir, projectId), `${id}.json`) };
  }
  fail('ERR_WORK_ORDER_NOT_FOUND', `作业不存在: ${id}`, 404);
}

function validateDraft(draft) {
  const checked = normalizeWorkOrderV2(draft);
  if (!checked.ok) {
    fail(
      'ERR_WORK_ORDER_INVALID',
      `工单校验失败：${checked.errors.join('；')}`,
      400,
      { errors: checked.errors, codes: checked.codes },
    );
  }
  return checked.workOrder;
}

function existingWorkOrder(baseDir, workOrderId) {
  try {
    return locateMeta(baseDir, workOrderId);
  } catch (cause) {
    if (cause.code === 'ERR_WORK_ORDER_NOT_FOUND') return null;
    throw cause;
  }
}

export function createWorkOrder(draft, baseDir, options = {}) {
  const normalized = validateDraft(draft);
  if (existingWorkOrder(baseDir, normalized.workOrderId)) {
    fail('ERR_WORK_ORDER_EXISTS', `作业号已存在: ${normalized.workOrderId}`, 409);
  }
  const dir = workOrderDir(baseDir, normalized.projectId);
  const orderFile = path.join(dir, `${normalized.workOrderId}.json`);
  const metaFile = path.join(dir, `${normalized.workOrderId}.meta.json`);
  const meta = metaFromOrder(baseDir, draft, normalized, 'queued', options.actor);

  fs.mkdirSync(dir, { recursive: true });
  writeJsonAtomic(orderFile, draft);
  writeJsonAtomic(metaFile, meta);
  return { meta, workOrder: draft };
}

/**
 * 从门户 PKG_ 提交包生成 work_order/v2 草稿并落成 queued 作业。
 *
 * packageDirRelPath 只允许单个包目录名，解析后必须仍在收件箱内。
 * 归档路径真源、需求校验、哈希对账与 Ready 图件判定都在 package_to_work_order.js，
 * 本函数只负责收件箱边界、错误码收敛与作业落盘。
 */
export function createWorkOrderFromPackage(packageDirRelPath, baseDir, options = {}) {
  if (!baseDir) {
    fail('ERR_WORK_ORDER_BASE_DIR', '创建作业需要仓库根目录', 500);
  }
  const text = String(packageDirRelPath ?? '').trim();
  const unsafe = !text
    || text.length > 120
    || text.startsWith('.')
    || text.includes('..')
    || text.includes('/')
    || text.includes('\\')
    || /^[A-Za-z]:/.test(text)
    || !text.startsWith('PKG_');
  if (unsafe) {
    fail('ERR_PACKAGE_DIR', 'package_dir 必须是收件箱下的单个 PKG_ 包目录名', 400);
  }

  const inboxRoot = path.resolve(options.inboxRoot || PORTAL_INBOX);
  const packageDir = path.resolve(inboxRoot, text);
  let realInbox;
  let realPackage;
  try {
    realInbox = fs.realpathSync(inboxRoot);
    realPackage = fs.realpathSync(packageDir);
  } catch {
    fail('ERR_PACKAGE_DIR', `提交包不存在或不可读: ${text}`, 400);
  }
  if (!realPackage.startsWith(realInbox + path.sep)) {
    fail('ERR_PACKAGE_DIR', 'package_dir 解析后越出收件箱', 400);
  }

  const built = buildWorkOrderDraftFromPackage(realPackage, {
    repoRoot: baseDir,
    inboxRoot: realInbox,
    assetsRoot: options.assetsRoot,
    lineId: options.lineId,
    modIds: options.modIds,
    seed: options.seed,
    figureSelections: options.figureSelections,
    requireAdminReview: options.requireAdminReview,
    projectId: options.projectId,
    workOrderId: options.workOrderId,
  });
  if (!built.ok) {
    const code = built.codes[0] || 'ERR_PACKAGE';
    fail(code, built.errors.join('；'), 400, { errors: built.errors, codes: built.codes });
  }

  const created = createWorkOrder(built.draft, baseDir, { actor: options.actor });
  return { draft: built.draft, package: built.package, ...created };
}

export function getWorkOrder(workOrderId, baseDir) {
  const { meta, orderFile } = locateMeta(baseDir, workOrderId);
  if (!fs.existsSync(orderFile)) {
    fail('ERR_WORK_ORDER_NOT_FOUND', `作业文件缺失: ${meta.work_order_id}`, 404);
  }
  return readJson(orderFile);
}

export function getWorkOrderMeta(workOrderId, baseDir) {
  return locateMeta(baseDir, workOrderId).meta;
}

export function getReceipt(workOrderId, baseDir) {
  const { meta } = locateMeta(baseDir, workOrderId);
  const file = safeReceiptFile(baseDir, meta.receipt_path);
  if (!fs.existsSync(file)) {
    fail('ERR_RECEIPT_NOT_FOUND', `回执尚未生成: ${meta.work_order_id}`, 404);
  }
  const receipt = readJson(file);
  // 工单号不匹配即拒绝（2026-11-11 P1）：回执文件是项目级路径，同一项目先后
  // 两次工单共用同一份文件。不核对会把上一单的回执冒充成本单结果返回。
  if (String(receipt?.work_order_id || '') !== String(meta.work_order_id)) {
    fail('ERR_RECEIPT_NOT_FOUND', `回执工单号不匹配: ${meta.work_order_id}`, 404);
  }
  return receipt;
}

export function listWorkOrders(baseDir, projectId = null) {
  return readAllMeta(baseDir, projectId)
    .map(({ meta }) => publicRow(meta));
}

/**
 * 待执行队列完全由磁盘 meta 派生：
 *   approved === true 且 status === 'queued'，按 approved_at 升序（先批准先执行），
 *   approved_at 缺失（未批准的 queued）按 created_at 升序兜底。
 * position 从 1 开始，供前端展示与确认接口复用。
 */
export function listQueue(baseDir, projectId = null) {
  return readAllMeta(baseDir, projectId)
    .filter(({ meta }) => isApprovedQueued(meta))
    .map(({ meta }, index) => ({ ...publicRow(meta), position: index + 1 }));
}

export function getQueuePosition(workOrderId, baseDir) {
  const id = safeWorkOrderId(workOrderId);
  const queue = listQueue(baseDir);
  const index = queue.findIndex((row) => row.work_order_id === id);
  return index >= 0 ? index + 1 : 0;
}

function orderFileForMeta(metaFile) {
  return metaFile.replace(/\.meta\.json$/, '.json');
}

function orderRequiresReview(orderFile) {
  try {
    const raw = readJson(orderFile);
    return raw?.controls?.require_admin_review !== false;
  } catch {
    return true;
  }
}

/**
 * 管理员确认即入队：落 approved 与 approved_at，并唤醒泵。
 * 幂等规则：
 *   queued 返回当前 position，approved_at 保持不变；
 *   running 返回 running 与 position 0；
 *   终态返回 409。
 */
export function enqueueWorkOrder(workOrderId, baseDir, options = {}) {
  const { meta, orderFile } = locateMeta(baseDir, workOrderId);
  const status = String(meta.status);
  if (TERMINAL_STATUSES.has(status)) {
    fail('ERR_WORK_ORDER_STATE', `作业已处于终态，不能再入队: ${status}`, 409);
  }
  if (status === 'running') {
    return { status: 'running', position: 0, meta };
  }
  if (status !== 'queued') {
    fail('ERR_WORK_ORDER_STATE', `作业当前状态不可入队: ${status}`, 409);
  }
  if (options.approved !== true && orderRequiresReview(orderFile)) {
    fail('ERR_ADMIN_REVIEW_REQUIRED', '该工单要求管理员先确认预览，再加入队列', 409);
  }

  const alreadyStamped = meta.approved === true && Boolean(meta.approved_at);
  const actor = options.actor && options.actor.kind
    ? { kind: String(options.actor.kind), id: String(options.actor.id || options.actor.kind), role: String(options.actor.role || 'admin') }
    : null;
  const next = alreadyStamped
    ? meta
    : {
      ...meta,
      approved: true,
      approved_at: meta.approved_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...(actor ? { approved_by: actor, last_updated_by: { ...actor } } : {}),
      ...(options.leaseId ? { lease_id: String(options.leaseId) } : {}),
    };
  if (!alreadyStamped) writeMeta(baseDir, next);
  wakeQueue();
  return {
    status: 'queued',
    position: getQueuePosition(next.work_order_id, baseDir),
    meta: next,
  };
}

/**
 * 崩溃恢复：重启后仍在 running 的作业没有活跃执行体，统一标 failed 并写明原因。
 * 导出供契约测试直接验，不依赖真实泵。
 */
export function recoverInterruptedRunning(baseDir) {
  const recovered = [];
  for (const { meta, metaFile } of readAllMeta(baseDir)) {
    if (String(meta.status) !== 'running') continue;
    if (inflight.has(orderFileForMeta(metaFile))) continue;
    const next = {
      ...meta,
      status: 'failed',
      updated_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      recovery_reason: 'server_restart',
      error: {
        code: 'ERR_WORK_ORDER_RECOVERY',
        message: '服务重启后作业中断，已标记失败',
      },
    };
    writeMeta(baseDir, next);
    recovered.push(next.work_order_id);
  }
  return recovered;
}

function wakeQueue() {
  if (typeof queueRunner.wake === 'function') {
    const wake = queueRunner.wake;
    queueRunner.wake = null;
    wake();
  }
}

function sleepQueue(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      queueRunner.wake = null;
      resolve();
    }, ms);
    queueRunner.wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

async function nextQueuedOrder(baseDir) {
  const candidate = readAllMeta(baseDir)
    .find(({ meta, metaFile }) => isApprovedQueued(meta) && !inflight.has(orderFileForMeta(metaFile)));
  return candidate ? candidate.meta : null;
}

async function pumpQueue() {
  const { baseDir, options } = queueRunner;
  const idlePollMs = Number.isFinite(options.idlePollMs) && options.idlePollMs > 0
    ? options.idlePollMs
    : 1000;
  while (queueRunner.running && queueRunner.baseDir === baseDir) {
    let meta = null;
    try {
      meta = await nextQueuedOrder(baseDir);
    } catch (cause) {
      if (typeof options.onError === 'function') options.onError(cause);
    }
    if (!meta) {
      await sleepQueue(idlePollMs);
      continue;
    }
    queueRunner.currentId = meta.work_order_id;
    try {
      await executeWorkOrderById(meta.work_order_id, baseDir, options);
    } catch {
      // 执行体已把失败写回 meta，泵只负责继续取下一个。
    } finally {
      queueRunner.currentId = null;
    }
  }
}

/**
 * 启动单并发 FIFO 泵。
 *
 * 同步完成崩溃恢复，随后返回；后台循环立即开始排空队列。
 * 同一进程内重复调用返回 already_running，保证只有一个消费循环。
 */
export function startQueue(baseDir, options = {}) {
  if (queueRunner.running) {
    return { recovered: [], started: false, already_running: true };
  }
  const recovered = recoverInterruptedRunning(baseDir);
  queueRunner.running = true;
  queueRunner.baseDir = baseDir;
  queueRunner.options = options;
  queueRunner.currentId = null;
  queueRunner.loop = pumpQueue().catch((cause) => {
    queueRunner.running = false;
    if (typeof options.onError === 'function') options.onError(cause);
  });
  return { recovered, started: true };
}

export async function stopQueue() {
  if (!queueRunner.running) return { stopped: false };
  queueRunner.running = false;
  wakeQueue();
  const loop = queueRunner.loop;
  queueRunner.loop = null;
  if (loop) {
    await Promise.race([
      loop.catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  }
  queueRunner.baseDir = null;
  queueRunner.options = {};
  queueRunner.currentId = null;
  return { stopped: true };
}

function writeMeta(baseDir, meta) {
  const file = path.join(workOrderDir(baseDir, meta.project_id), `${meta.work_order_id}.meta.json`);
  writeJsonAtomic(file, meta);
  return meta;
}

function finalStatus(result, receipt) {
  if (receipt && WORK_ORDER_STATUSES.includes(String(receipt.status))) return String(receipt.status);
  if (result?.ok === true) return 'completed';
  if (result?.status && WORK_ORDER_STATUSES.includes(String(result.status))) return String(result.status);
  return 'failed';
}

function runnerOptions(baseDir, options) {
  const forwarded = {
    repoRoot: baseDir,
    request: options.request,
    baseUrl: options.baseUrl,
    headers: options.headers,
    pollIntervalMs: options.pollIntervalMs,
    pollMaxAttempts: options.pollMaxAttempts,
    sleep: options.sleep,
    facts: options.facts,
    inputsRoot: options.inputsRoot,
  };
  for (const key of Object.keys(forwarded)) {
    if (forwarded[key] === undefined) delete forwarded[key];
  }
  return forwarded;
}

/**
 * 执行体：只接受 queued 作业，负责置 running、调用编排器、按回执收敛终态。
 *
 * 审核判据不在这里，调用方负责。泵与同步入口共用这一份执行语义。
 */
export async function executeWorkOrderById(workOrderId, baseDir, options = {}) {
  const id = safeWorkOrderId(workOrderId);
  const { meta, orderFile } = locateMeta(baseDir, id);
  if (TERMINAL_STATUSES.has(String(meta.status))) {
    fail('ERR_WORK_ORDER_STATE', `作业已处于终态，不能重复执行: ${meta.status}`, 409);
  }
  if (String(meta.status) !== 'queued') {
    fail('ERR_WORK_ORDER_STATE', `作业当前状态不可执行: ${meta.status}`, 409);
  }
  if (inflight.has(orderFile)) {
    fail('ERR_WORK_ORDER_STATE', '作业正在执行，拒绝重复触发', 409);
  }

  let raw;
  try {
    raw = readJson(orderFile);
  } catch (cause) {
    const failed = {
      ...meta,
      status: 'failed',
      updated_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      error: {
        code: 'ERR_WORK_ORDER_READ',
        message: redact(cause instanceof Error ? cause.message : String(cause), baseDir),
      },
    };
    writeMeta(baseDir, failed);
    throw cause;
  }
  inflight.add(orderFile);
  let running = {
    ...meta,
    status: 'running',
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  writeMeta(baseDir, running);

  let result = null;
  try {
    let input = raw;
    try {
      input = normalizeWorkOrderInput(raw);
    } catch {
      // 归一化失败时仍把原始工单交给编排器，由它写失败回执。
      input = raw;
    }
    const runner = options.runWorkOrderFn || defaultRunWorkOrder;
    result = await runner(input, runnerOptions(baseDir, options));

    let receipt = result?.receiptV1 || null;
    const receiptPath = receiptFile(baseDir, running.project_id);
    if (fs.existsSync(receiptPath)) {
      try {
        const diskReceipt = readJson(receiptPath);
        // 只采信属于本工单的磁盘回执：上一单的 completed 不得把本单
        // （即使执行失败）收敛成 completed。
        if (String(diskReceipt?.work_order_id || '') === String(meta.work_order_id)) {
          receipt = diskReceipt;
        }
      } catch {
        // 回执损坏不覆盖编排器返回值，元数据仍按执行结果收敛。
      }
    }
    const status = finalStatus(result, receipt);
    // 权威回执按工单号各存一份：同项目多单不会互相覆盖。
    // 项目级文件由编排器写，保留为「最近一次」投影；这里落的是本单专属副本。
    let receiptRelPath = relativePosix(baseDir, receiptPath);
    if (receipt && typeof receipt === 'object') {
      try {
        const perOrderPath = workOrderReceiptFile(baseDir, running.project_id, meta.work_order_id);
        writeReceiptV1Atomic(receipt, perOrderPath);
        receiptRelPath = relativePosix(baseDir, perOrderPath);
      } catch {
        // 回执形状不合法时退回项目级路径，meta 仍按执行结果收敛，不阻断状态机。
      }
    }
    running = {
      ...running,
      status,
      updated_at: new Date().toISOString(),
      finished_at: receipt?.finished_at || new Date().toISOString(),
      receipt_path: receiptRelPath,
      ...(receipt?.receipt_id ? { receipt_id: receipt.receipt_id } : {}),
      ...(receipt?.error
        ? { error: { code: receipt.error.code || null, message: redact(receipt.error.message, baseDir) } }
        : {}),
    };
    writeMeta(baseDir, running);
    return { meta: running, result, receipt };
  } catch (cause) {
    running = {
      ...running,
      status: 'failed',
      updated_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      error: {
        code: cause?.code || 'ERR_WORK_ORDER_RUN',
        message: redact(cause instanceof Error ? cause.message : String(cause), baseDir),
      },
    };
    writeMeta(baseDir, running);
    throw cause;
  } finally {
    inflight.delete(orderFile);
  }
}

/**
 * 同步执行入口，保留给既有调用方与契约测试。
 * 管理员审核判据在这一层，执行语义委托 executeWorkOrderById。
 */
export async function runWorkOrderById(workOrderId, baseDir, options = {}) {
  const id = safeWorkOrderId(workOrderId);
  const { meta, orderFile } = locateMeta(baseDir, id);
  if (TERMINAL_STATUSES.has(String(meta.status))) {
    fail('ERR_WORK_ORDER_STATE', `作业已处于终态，不能重复执行: ${meta.status}`, 409);
  }
  if (String(meta.status) !== 'queued') {
    fail('ERR_WORK_ORDER_STATE', `作业当前状态不可执行: ${meta.status}`, 409);
  }
  const raw = readJson(orderFile);
  const requiresReview = raw?.controls?.require_admin_review !== false;
  if (requiresReview && options.approved !== true) {
    fail('ERR_ADMIN_REVIEW_REQUIRED', '该工单要求管理员先确认预览，再触发执行', 409);
  }
  return executeWorkOrderById(id, baseDir, options);
}

export function markStaleRunning(workOrderId, reason, baseDir) {
  const { meta } = locateMeta(baseDir, workOrderId);
  if (String(meta.status) !== 'running') return meta;
  const next = {
    ...meta,
    status: 'failed',
    updated_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    stale_reason: redact(reason || '服务重启后作业中断', baseDir),
  };
  writeMeta(baseDir, next);
  return next;
}
