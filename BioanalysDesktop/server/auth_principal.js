/**
 * 认证主体映射：把一次请求收敛成 {kind, id, role}。
 *
 * 身份真源是服务端认证结果。请求体里的 actor 字段只作人读展示，
 * 服务端一律以这里的结果覆盖，客户端无法靠改 JSON 冒充人工或 AI。
 */
import { timingSafeEqual } from 'node:crypto';

export const ACTOR_KINDS = Object.freeze(['human', 'ai_assist', 'local_dev']);

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function makeActor(kind, id, role = 'admin') {
  if (!ACTOR_KINDS.includes(kind)) {
    throw new Error(`未知主体类型: ${kind}`);
  }
  return { kind, id: String(id || kind), role: String(role) };
}

/** 从 Basic 头取用户名口令，解析失败返回 null。 */
export function parseBasicHeader(header) {
  const text = String(header || '');
  if (!text.startsWith('Basic ')) return null;
  let decoded;
  try {
    decoded = Buffer.from(text.slice(6), 'base64').toString('utf8');
  } catch {
    return null;
  }
  const split = decoded.indexOf(':');
  if (split < 0) return null;
  return { user: decoded.slice(0, split), pass: decoded.slice(split + 1) };
}

/**
 * 解析请求主体。
 * 返回 { actor } 或 { actor: null, reason }，不抛错，由调用方决定 401 还是放行。
 */
export function resolvePrincipal(req, config = {}) {
  const humanUser = String(config.humanUser || '');
  const humanPass = String(config.humanPass || '');
  const aiUser = String(config.aiUser || '');
  const aiPass = String(config.aiPass || '');
  const devNoAuth = config.devNoAuth === true;

  const parsed = parseBasicHeader(req && req.headers ? req.headers.authorization : '');
  if (parsed) {
    // 两类凭证各自独立比对，任一命中即确定主体；同时命中时以 AI 优先，
    // 避免同一个账号被配置成两种身份后产生歧义。
    if (aiUser && aiPass && safeEqual(parsed.user, aiUser) && safeEqual(parsed.pass, aiPass)) {
      return { actor: makeActor('ai_assist', parsed.user) };
    }
    if (humanUser && humanPass && safeEqual(parsed.user, humanUser) && safeEqual(parsed.pass, humanPass)) {
      return { actor: makeActor('human', parsed.user) };
    }
    return { actor: null, reason: 'ERR_BAD_CREDENTIALS' };
  }

  if (devNoAuth) {
    return { actor: makeActor('local_dev', 'local-dev') };
  }
  return { actor: null, reason: 'ERR_AUTH_REQUIRED' };
}

/** 把 service 层收到的 actor 收敛成可写入 meta 的最小结构。 */
export function normalizeActor(actor) {
  if (!actor || !ACTOR_KINDS.includes(actor.kind)) return null;
  return { kind: actor.kind, id: String(actor.id || actor.kind), role: String(actor.role || 'admin') };
}
