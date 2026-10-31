/**
 * HTTP 响应出口：JSON 正文与上传链路错误响应的唯一形状定义。
 *
 * 独立成模块的理由：static_assets.js 等前置模块也要回 JSON，
 * 而 json 的定义原先在 index.js，从 index.js 引会成环，只能靠 factory 注入。
 * 搬到这里之后前置模块直接 import，注入层就没有存在理由了。
 * 路由层继续走 routeCtx 注入，口径不变。
 */
export function json(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}
/**
 * 上传链路错误响应单一出口（task-8 / B）。
 * 以前 init / chunk 回 {error}，status 回 {ok:false, error}，两种形状并存，
 * 前端只能猜；现在四个端点（init / chunk / status / complete）的 4xx/5xx 一律走这里，
 * 统一回 {ok:false, error}。ok:false 是新增字段，前端（App.tsx 只读 error）不受影响；
 * HTTP 状态码语义不变，调用方传什么状态码就回什么。
 * 成功响应不走本函数。
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} message 非空字符串
 */
export function uploadError(res, status, message) {
  return json(res, status, { ok: false, error: String(message ?? '') });
}
