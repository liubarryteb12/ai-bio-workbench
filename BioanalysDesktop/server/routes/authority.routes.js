/**
 * 租约路由：读取、获取、续租、释放、人工接管。
 *
 * 主体来自认证结果（deps.actor），不从请求体读取，避免冒充。
 * 状态码与错误码见 docs/AI_ORCHESTRATION_SPEC.md 第四节。
 */
import { collectJsonBody, JSON_BODY_LIMIT } from '../http_body.js';
import {
  acquireAuthority,
  heartbeatAuthority,
  readAuthority,
  releaseAuthority,
  takeoverAuthority,
} from '../services/authority.service.js';

const PREFIX = '/api/orchestration/authority';

function leaseIdFrom(req, payload) {
  const header = req.headers['x-bio-lease-id'];
  if (header) return String(header);
  return String(payload?.lease_id || '');
}

function respondError(cause, res, json) {
  const status = Number(cause?.status) || 500;
  const code = cause?.code || 'ERR_AUTHORITY';
  const message = status >= 500 && !cause?.status ? '租约接口处理失败' : String(cause?.message || cause);
  json(res, status, { ok: false, code, error: message });
}

export async function handleAuthorityRoutes(req, res, url, deps) {
  if (!url.pathname.startsWith(PREFIX)) return false;
  const rest = url.pathname.slice(PREFIX.length).replace(/\/+$/, '');
  const method = String(req.method || 'GET').toUpperCase();
  const { json, actor, authorityFile } = deps;
  const options = { file: authorityFile };

  try {
    if ((rest === '' || rest === '/') && method === 'GET') {
      json(res, 200, { ok: true, authority: readAuthority(options) });
      return true;
    }

    if (!actor) {
      json(res, 401, { ok: false, code: 'ERR_AUTH_REQUIRED', error: '租约操作需要认证主体' });
      return true;
    }

    if (rest === '/acquire' && method === 'POST') {
      const result = acquireAuthority(actor, options);
      json(res, 201, { ok: true, authority: result.authority, lease_id: result.lease_id, created: result.created });
      return true;
    }

    if (rest === '/heartbeat' && method === 'POST') {
      const payload = await readJson(req, res, json);
      if (payload === null) return true;
      const result = heartbeatAuthority(actor, leaseIdFrom(req, payload), options);
      json(res, 200, { ok: true, authority: result.authority });
      return true;
    }

    if (rest === '/release' && method === 'POST') {
      const payload = await readJson(req, res, json);
      if (payload === null) return true;
      releaseAuthority(actor, leaseIdFrom(req, payload), options);
      res.writeHead(204);
      res.end();
      return true;
    }

    if (rest === '/takeover' && method === 'POST') {
      const payload = await readJson(req, res, json);
      if (payload === null) return true;
      const result = takeoverAuthority(actor, { ...options, reason: payload.reason });
      json(res, 200, {
        ok: true,
        authority: result.authority,
        lease_id: result.lease_id,
        takeover_from: result.takeover_from,
      });
      return true;
    }
  } catch (cause) {
    respondError(cause, res, json);
    return true;
  }

  json(res, 405, { ok: false, code: 'ERR_METHOD_NOT_ALLOWED', error: `不支持的方法: ${method} ${url.pathname}` });
  return true;
}

async function readJson(req, res, json) {
  const raw = await collectJsonBody(req, res, json, { maxBytes: JSON_BODY_LIMIT });
  if (raw === null || raw === undefined) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw || '{}'));
  } catch {
    json(res, 400, { ok: false, code: 'ERR_BAD_JSON', error: '请求体不是合法 JSON' });
    return null;
  }
}
