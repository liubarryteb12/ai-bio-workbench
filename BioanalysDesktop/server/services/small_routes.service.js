// 小端点 service（Q2 收口）：黑名单校验、组合预检、需求收件箱。
//
// 这些端点原先嵌在 projects.routes.js 的 if 分支里，每个都自带 JSON 解析与错误分支。
// 抽出来后统一成「入参 -> {status, payload}」，路由层只写出响应。

import { checkTumorBlacklist, BLACKLIST_HINT } from '../tumor_blacklist.js';
import { describeSeries, resolvePlan } from '../workflow_graph.js';

/** 非肿瘤正则黑名单校验（前端实时调用，输入时红字拦截）。 */
export function checkBlacklist({ body }) {
  let payload;
  try {
    payload = JSON.parse(body || '{}');
  } catch {
    return { status: 400, payload: { error: '请求体不是合法 JSON' } };
  }
  const result = checkTumorBlacklist(payload.text || '');
  return { status: 200, payload: { hit: result.hit, matches: result.matches, hint: BLACKLIST_HINT } };
}

/** 组合合法性预检：客户端勾完步骤后先问一次，别等远端跑爆才发现。 */
export function resolveWorkflow({ body }) {
  let parsed = {};
  try {
    parsed = body.trim() ? JSON.parse(body) : {};
  } catch (cause) {
    return {
      status: 400,
      payload: { error: `请求体不是合法 JSON: ${cause instanceof Error ? cause.message : String(cause)}` },
    };
  }
  const seriesId = String(parsed.seriesId || parsed.series || '').trim();
  const modIds = Array.isArray(parsed.modIds) ? parsed.modIds.map((x) => String(x)) : [];
  const koGene = String(parsed.koGene || '').trim();
  if (!seriesId) return { status: 400, payload: { error: '缺少 seriesId' } };
  if (modIds.length === 0) return { status: 400, payload: { error: 'modIds 不能为空' } };
  const plan = resolvePlan(seriesId, modIds, { koGene });
  // 非法组合回 422：调用方传错了，不是服务端故障
  return { status: plan.ok ? 200 : 422, payload: plan };
}

// 单系列详情必须放在 resolve 之后调用（否则前缀匹配会把 /api/workflows/resolve
// 吞成 seriesId=resolve）。路由表里两条描述符的顺序即为此而设。
export function workflowDetail({ seriesId }) {
  // 只认注册表里真实存在的系列 id。不加这道闸，任何 /api/workflows/<任意串>
  // 都会走到这里，把拼错的路由名报成「未知分析系列」，排查时极易误判。
  const detail = describeSeries(seriesId);
  if (!detail) return { status: 404, payload: { error: `未知分析系列: ${seriesId}` } };
  return { status: 200, payload: detail };
}

/** 客户需求收件箱列表。 */
export function listInbox({ listInboxManifests }) {
  return { status: 200, payload: listInboxManifests() };
}