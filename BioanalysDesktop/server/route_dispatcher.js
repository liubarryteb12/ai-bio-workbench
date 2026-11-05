/**
 * route_dispatcher.js —— 声明式路由描述符分发器（第 43 轮 Q2，抄 Fastify Route Descriptor）。
 *
 * 为什么需要：projects.routes.js 里 12 个端点各自 if/else，每个分支都自己调
 * collectJsonBody、自己校验参数、自己 try/catch。新增端点时很容易漏掉某一层
 * （比如忘了 bodyLimit），而漏掉的那层不会有任何测试报警。
 *
 * 设计（不引入 Fastify 依赖，纯 JS ~100 行）：
 *   路由描述符 { method, path, auth, bodyLimit, querySchema, handler }
 *   分发器按固定顺序执行前置管道：
 *     querySchema 参数校验(400) -> 请求体采集(413/400) -> handler(ctx)
 *   handler 只拿 { query, body, url, req, res }，不碰前置逻辑。
 *
 *   鉴权由 server/index.js 在 createServer 入口统一做（HTTP Basic，/api/health 除外），
 *   覆盖所有路由模块，不在本分发器内重复实现。早期版本这里写过一层
 *   `ctx.authRequired && ctx.isAuthorized`，但生产调用点从不注入这两个字段，
 *   那段是永不执行的死代码，且会让读者误以为鉴权有两道，已移除（一个含义一个真源）。
 *
 * 关键不变量（由测试静态审视 + 变异反证保护）：
 *   1. 凡 POST/PUT/PATCH 描述符必须显式声明 bodyLimit（防绕过 T3-7 的 1MB 上限）；
 *   2. querySchema 里的 projectId 类字段统一走 sanitize，失败即 400 而不是流入 service；
 *   3. 同一 (method, path) 不得重复声明（初始化时当场抛错）。
 */

import { collectJsonBody } from './http_body.js';
import { sanitizeProjectId } from './domain.js';

/** 写方法：必须声明 bodyLimit。 */
export const WRITE_METHODS = Object.freeze(['POST', 'PUT', 'PATCH']);

/**
 * 校验路由表的结构完整性。发现冲突或缺失立刻抛错（fail fast，不等运行时）。
 * 导出成独立函数是为了让测试能直接喂一份坏表验证它真的会抛。
 */
export function validateRouteTable(routes) {
  if (!Array.isArray(routes)) throw new TypeError('路由表必须是数组');
  const seen = new Set();
  for (const r of routes) {
    if (!r || typeof r !== 'object') throw new TypeError('路由描述符必须是对象');
    if (!r.method) throw new Error('路由描述符缺 method');
    if (typeof r.path !== 'string' || !r.path.startsWith('/api/')) {
      throw new Error('路由 path 必须以 /api/ 开头: ' + String(r.path));
    }
    if (typeof r.handler !== 'function') throw new Error(r.path + ' 缺 handler 函数');
    const key = r.method.toUpperCase() + ' ' + r.path;
    if (seen.has(key)) throw new Error('路由重复声明: ' + key);
    seen.add(key);
    if (WRITE_METHODS.includes(r.method.toUpperCase()) && !r.bodyLimit) {
      throw new Error(key + ' 是写方法，必须显式声明 bodyLimit');
    }
  }
  return true;
}

/**
 * 按 querySchema 校验参数。schema 形如 { project: 'projectId', projectId: 'projectId' }，
 * 值是校验器名；目前只需要 projectId 一种（sanitizeProjectId）。
 *
 * @returns {{ok: true, values: object} | {ok: false, field: string}}
 */
export function validateQuery(searchParams, querySchema) {
  if (!querySchema) return { ok: true, values: {} };
  const values = {};
  for (const [field, validator] of Object.entries(querySchema)) {
    const raw = searchParams.get(field);
    if (validator === 'projectId') {
      const safe = sanitizeProjectId(raw || '');
      if (!safe) return { ok: false, field };
      values[field] = safe;
      continue;
    }
    values[field] = raw;
  }
  return { ok: true, values };
}

/**
 * 分发一次请求。命中返回 true，未命中返回 false（调用方据此继续试下一组路由）。
 *
 * @param {object} ctx { req, res, url, json, runJsonRoute? }
 * @param {Array} routes 路由描述符数组
 */
export async function dispatchRoutes(ctx, routes) {
  const { req, res, url, json, runJsonRoute } = ctx;
  const method = String(req.method || 'GET').toUpperCase();

  const route = routes.find((r) => r.method.toUpperCase() === method && r.path === url.pathname);
  if (!route) return false;

  // ── 第 1 层：querySchema 参数校验（400 而不是流入 service）──
  const q = validateQuery(url.searchParams, route.querySchema);
  if (!q.ok) {
    json(res, 400, { error: `${q.field} 参数非法` });
    return true;
  }

  // ── 第 2 层：写方法的请求体采集（超限 413，非法 JSON 400）──
  let body = null;
  if (WRITE_METHODS.includes(method) && route.bodyLimit) {
    body = await collectJsonBody(req, res, json, { maxBytes: route.bodyLimit });
    if (body === null) return true;  // collectJsonBody 已回出 413/400
  }

  const handlerCtx = { query: q.values, body, url, req, res, json, runJsonRoute };
  try {
    await route.handler(handlerCtx);
  } catch (cause) {
    // handler 抛错统一收敛成 500，避免请求悬挂与未处理 rejection（与 T3-7 同口径）
    if (!res.headersSent) {
      json(res, 500, { error: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  return true;
}