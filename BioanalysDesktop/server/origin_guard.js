/**
 * D0 loopback 跨源守卫（Gemini 第三轮裁定）。
 *
 * 只拦浏览器跨源请求：Sec-Fetch-Site 为 cross-site / same-site 一律拒绝。
 * 同源 UI（same-origin）与非浏览器客户端（无 Sec-Fetch-Site，如 curl/Node）放行，
 * 避免把 CLI 与测试客户端误伤。
 */
export function isLoopbackOriginAllowed(headers = {}) {
  const site = String(headers['sec-fetch-site'] || '').toLowerCase();
  if (!site) return true;
  return site === 'same-origin' || site === 'none';
}
