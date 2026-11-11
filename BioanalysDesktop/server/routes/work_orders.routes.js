/**
 * 作业中心路由：创建、列表、详情、执行、回执与原始工单。
 *
 * 静态端点走 route_dispatcher 描述符，动态段由本模块按前缀解析。
 * 分发器只做精确路径匹配，这一点与 figures.routes.js 的前缀分支同构。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { dispatchRoutes } from '../route_dispatcher.js';
import { collectJsonBody, JSON_BODY_LIMIT } from '../http_body.js';
import { sanitizeProjectId } from '../domain.js';
import { WORK_ORDER_LINES } from '../../../shared/work_order_v2.mjs';
import * as workOrderService from '../services/work_order.service.js';

const PREFIX = '/api/work-orders/';
const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function redact(value, baseDir) {
  let text = String(value ?? '');
  if (baseDir) text = text.split(path.resolve(baseDir)).join('<workspace>');
  text = text.replace(/[A-Za-z]:[\\/][^\s"'`]+/g, '<path>');
  text = text.replace(/\/(?:mnt|home|root|tmp|var|usr|opt)\/[^\s"'`]+/g, '<path>');
  return text;
}

function respondError(cause, res, json, baseDir) {
  const status = Number(cause?.status) || 500;
  const code = cause?.code || 'ERR_WORK_ORDER_API';
  const message = status >= 500 && !cause?.status
    ? '作业接口处理失败'
    : redact(cause instanceof Error ? cause.message : String(cause), baseDir);
  json(res, status, { ok: false, code, error: message });
}

function parseJsonBody(raw) {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw || '{}'));
  } catch {
    throw new workOrderService.WorkOrderServiceError('ERR_WORK_ORDER_JSON', '请求体不是合法 JSON', 400);
  }
}

function receiptSummary(receipt) {
  if (!receipt || typeof receipt !== 'object') return null;
  return {
    schema_version: receipt.schema_version,
    receipt_id: receipt.receipt_id,
    status: receipt.status,
    started_at: receipt.started_at,
    finished_at: receipt.finished_at,
    failure_stage: receipt.failure_stage,
    error: receipt.error || null,
    stage_count: Array.isArray(receipt.stages) ? receipt.stages.length : 0,
    artifact_count: Array.isArray(receipt.artifacts) ? receipt.artifacts.length : 0,
    sentinel: receipt.sentinel || null,
  };
}

function readReceiptSummary(id, baseDir) {
  try {
    return receiptSummary(workOrderService.getReceipt(id, baseDir));
  } catch (cause) {
    if (cause.code === 'ERR_RECEIPT_NOT_FOUND') return null;
    throw cause;
  }
}

function buildRoutes(baseDir, inboxRoot) {
  return [
    {
      method: 'GET',
      path: '/api/work-orders',
      // project 是可选过滤。分发器的 querySchema 只支持必填 projectId，
      // 因此这里在 handler 内做可选消毒，非法值仍回 400 且不进 service。
      handler: async ({ url, json: reply, res }) => {
        const raw = url.searchParams.get('project');
        let projectId = null;
        if (raw !== null && String(raw).trim() !== '') {
          projectId = sanitizeProjectId(raw);
          if (!projectId) {
            reply(res, 400, { ok: false, code: 'ERR_PROJECT_ID', error: 'project 参数非法' });
            return;
          }
        }
        reply(res, 200, { ok: true, work_orders: workOrderService.listWorkOrders(baseDir, projectId) });
      },
    },
    {
      method: 'GET',
      path: '/api/work-orders/queue',
      handler: async ({ url, json: reply, res }) => {
        const raw = url.searchParams.get('project');
        let projectId = null;
        if (raw !== null && String(raw).trim() !== '') {
          projectId = sanitizeProjectId(raw);
          if (!projectId) {
            reply(res, 400, { ok: false, code: 'ERR_PROJECT_ID', error: 'project 参数非法' });
            return;
          }
        }
        reply(res, 200, { ok: true, queue: workOrderService.listQueue(baseDir, projectId) });
      },
    },
    {
      method: 'POST',
      path: '/api/work-orders',
      bodyLimit: JSON_BODY_LIMIT,
      handler: async ({ body, json: reply, res }) => {
        try {
          const draft = parseJsonBody(body);
          const result = workOrderService.createWorkOrder(draft, baseDir);
          reply(res, 201, { ok: true, work_order: result.meta });
        } catch (cause) {
          respondError(cause, res, reply, baseDir);
        }
      },
    },
    {
      method: 'POST',
      path: '/api/work-orders/from-package',
      bodyLimit: JSON_BODY_LIMIT,
      handler: async ({ body, json: reply, res }) => {
        try {
          const payload = parseJsonBody(body);
          const packageDir = typeof payload.package_dir === 'string' ? payload.package_dir.trim() : '';
          if (!packageDir) {
            throw new workOrderService.WorkOrderServiceError(
              'ERR_PACKAGE_DIR',
              'package_dir 必须是非空的 PKG_ 包目录名',
              400,
            );
          }
          if (payload.line_id !== undefined) {
            const lineId = String(payload.line_id || '').trim();
            if (!WORK_ORDER_LINES.includes(lineId)) {
              throw new workOrderService.WorkOrderServiceError(
                'ERR_UNKNOWN_LINE',
                `line_id 必须是 ${WORK_ORDER_LINES.join('、')} 之一`,
                400,
              );
            }
          }
          if (!Array.isArray(payload.mod_ids) || payload.mod_ids.length === 0) {
            throw new workOrderService.WorkOrderServiceError(
              'ERR_PACKAGE_OPTIONS',
              'mod_ids 必须由调用方显式给出，且至少包含一个 Mod',
              400,
            );
          }
          if (payload.mod_ids.some((item) => typeof item !== 'string' || !item.trim())) {
            throw new workOrderService.WorkOrderServiceError(
              'ERR_PACKAGE_OPTIONS',
              'mod_ids 的每一项都必须是非空字符串',
              400,
            );
          }
          if (payload.seed !== undefined && payload.seed !== null
            && (!Number.isInteger(payload.seed) || payload.seed <= 0)) {
            throw new workOrderService.WorkOrderServiceError(
              'ERR_PACKAGE_OPTIONS',
              'seed 必须是正整数',
              400,
            );
          }
          if (payload.require_admin_review !== undefined
            && typeof payload.require_admin_review !== 'boolean') {
            throw new workOrderService.WorkOrderServiceError(
              'ERR_PACKAGE_OPTIONS',
              'require_admin_review 必须是布尔',
              400,
            );
          }
          if (payload.figure_selections !== undefined && !Array.isArray(payload.figure_selections)) {
            throw new workOrderService.WorkOrderServiceError(
              'ERR_PACKAGE_OPTIONS',
              'figure_selections 必须是数组',
              400,
            );
          }

          const result = workOrderService.createWorkOrderFromPackage(packageDir, baseDir, {
            inboxRoot,
            lineId: payload.line_id,
            modIds: payload.mod_ids,
            seed: payload.seed,
            figureSelections: payload.figure_selections,
            requireAdminReview: payload.require_admin_review,
            projectId: payload.project_id,
            workOrderId: payload.work_order_id,
          });
          reply(res, 201, {
            ok: true,
            draft: result.draft,
            package: result.package,
            work_order: result.meta,
          });
        } catch (cause) {
          respondError(cause, res, reply, baseDir);
        }
      },
    },
  ];
}

export const WORK_ORDER_ROUTES = buildRoutes(DEFAULT_REPO_ROOT);

async function handleDynamic(req, res, url, json, baseDir, deps) {
  if (!url.pathname.startsWith(PREFIX)) return false;
  const rest = url.pathname.slice(PREFIX.length);
  // decodeURIComponent 在 try 外会以 URIError 顶穿顶层 handler（畸形 % 序列），
  // 现在就地拦成 400。
  let parts;
  try {
    parts = rest.split('/').filter(Boolean).map((item) => decodeURIComponent(item));
  } catch {
    json(res, 400, { ok: false, code: 'ERR_BAD_PATH', error: '路径包含非法百分号编码' });
    return true;
  }
  if (parts.length === 0) return false;
  if (parts[0] === 'from-package') {
    json(res, 405, {
      ok: false,
      code: 'ERR_METHOD_NOT_ALLOWED',
      error: 'from-package 只接受 POST',
    });
    return true;
  }
  const id = parts[0];
  const method = String(req.method || 'GET').toUpperCase();

  try {
    if (parts.length === 1 && method === 'GET') {
      const meta = workOrderService.getWorkOrderMeta(id, baseDir);
      const queuePosition = workOrderService.getQueuePosition(id, baseDir);
      json(res, 200, {
        ok: true,
        work_order: meta,
        queue_position: queuePosition,
        receipt: readReceiptSummary(id, baseDir),
      });
      return true;
    }
    if (parts.length === 2 && parts[1] === 'work-order' && method === 'GET') {
      json(res, 200, { ok: true, work_order: workOrderService.getWorkOrder(id, baseDir) });
      return true;
    }
    if (parts.length === 2 && parts[1] === 'receipt' && method === 'GET') {
      json(res, 200, { ok: true, receipt: workOrderService.getReceipt(id, baseDir) });
      return true;
    }
    if (parts.length === 2 && parts[1] === 'run' && method === 'POST') {
      const rawBody = await readBody(req, res, json);
      if (rawBody === null) return true;
      const payload = parseJsonBody(rawBody);
      const result = workOrderService.enqueueWorkOrder(id, baseDir, {
        approved: payload.confirm === true || payload.approved === true,
      });
      json(res, 202, {
        ok: true,
        status: result.status,
        position: result.position,
        work_order: result.meta,
      });
      return true;
    }
  } catch (cause) {
    respondError(cause, res, json, baseDir);
    return true;
  }
  return false;
}

async function readBody(req, res, json) {
  return collectJsonBody(req, res, json, { maxBytes: JSON_BODY_LIMIT });
}

export async function handleWorkOrdersRoutes(req, res, url, deps) {
  const { json } = deps;
  const baseDir = deps.REPO_ROOT || DEFAULT_REPO_ROOT;
  if (await dispatchRoutes(
    { req, res, url, json, runJsonRoute: (fn) => fn() },
    buildRoutes(baseDir, deps.PORTAL_INBOX),
  )) {
    return true;
  }
  return handleDynamic(req, res, url, json, baseDir, deps);
}
