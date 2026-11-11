/**
 * 全局单权威租约（SQLite 单表）。
 *
 * 为什么用 SQLite 而不是原子写 JSON：判定与写入必须在同一个原子事务里完成。
 * 手写 JSON 锁在「读到过期、写回新租约」之间有窗口，第二个写者能插进来，
 * 这正是要防的双写。BEGIN IMMEDIATE 让两个并发 acquire 只有一个拿到写锁。
 *
 * 租约以工作台为作用域，全局唯一，路径固定为 .ops_state/orchestration_authority.sqlite。
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export const AUTHORITY_SCOPE = 'workbench';
export const DEFAULT_TTL_SECONDS = 120;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS authority_lease (
  scope TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL,
  holder_kind TEXT NOT NULL,
  holder_id TEXT NOT NULL,
  holder_role TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  mode TEXT NOT NULL,
  takeover_from TEXT,
  takeover_at TEXT,
  reason TEXT
);
CREATE TABLE IF NOT EXISTS authority_seq (
  scope TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
`;

export class AuthorityError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = 'AuthorityError';
    this.code = code;
    this.status = status;
  }
}

const openDatabases = new Map();

/** 租约库默认落点。本地盘单文件，禁止放网络映射盘（SQLite 锁语义依赖本地文件系统）。 */
export function defaultAuthorityFile(repoRoot) {
  return path.join(repoRoot, '.ops_state', 'orchestration_authority.sqlite');
}

function ttlFromEnv(env = process.env) {
  const raw = Number(env.BIO_AUTHORITY_TTL_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_SECONDS;
}

function openDatabase(file) {
  const resolved = path.resolve(file);
  const cached = openDatabases.get(resolved);
  if (cached) return cached;
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  openDatabases.set(resolved, db);
  return db;
}

export function closeAuthorityDatabase(file) {
  const resolved = path.resolve(file);
  const db = openDatabases.get(resolved);
  if (!db) return;
  db.close();
  openDatabases.delete(resolved);
}

function iso(date) {
  return date.toISOString();
}

function isoPlusSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000).toISOString();
}

function holderOf(actor) {
  if (!actor || !actor.kind) {
    throw new AuthorityError('ERR_AUTHORITY_REQUIRED', '租约操作需要可识别的认证主体', 401);
  }
  return { kind: String(actor.kind), id: String(actor.id || actor.kind), role: String(actor.role || 'admin') };
}

function nextLeaseId(db, now) {
  const stamp = iso(now).slice(0, 10).replace(/-/g, '');
  const row = db.prepare('SELECT value FROM authority_seq WHERE scope = ?').get(AUTHORITY_SCOPE);
  const next = (row ? row.value : 0) + 1;
  db.prepare('INSERT INTO authority_seq (scope, value) VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET value = excluded.value')
    .run(AUTHORITY_SCOPE, next);
  return `AUTH-${stamp}-${String(next).padStart(4, '0')}`;
}

function rowToAuthority(row) {
  if (!row) return null;
  return {
    lease_id: row.lease_id,
    holder: { kind: row.holder_kind, id: row.holder_id, role: row.holder_role },
    acquired_at: row.acquired_at,
    heartbeat_at: row.heartbeat_at,
    expires_at: row.expires_at,
    mode: row.mode,
    ...(row.takeover_from ? { takeover_from: row.takeover_from } : {}),
    ...(row.takeover_at ? { takeover_at: row.takeover_at } : {}),
    ...(row.reason ? { reason: row.reason } : {}),
  };
}

function isExpired(row, now) {
  return !row || Date.parse(row.expires_at) <= now.getTime();
}

function readRow(db) {
  return db.prepare('SELECT * FROM authority_lease WHERE scope = ?').get(AUTHORITY_SCOPE) || null;
}

function runWrite(db, fn) {
  const transaction = db.transaction(fn);
  return transaction.immediate();
}

function resolveFile(options) {
  const file = options.file || options.repoRoot && defaultAuthorityFile(options.repoRoot);
  if (!file) throw new AuthorityError('ERR_AUTHORITY_PATH', '租约库路径未指定', 500);
  return file;
}

/** 读取当前租约，不判定归属。 */
export function readAuthority(options = {}) {
  const db = openDatabase(resolveFile(options));
  return rowToAuthority(readRow(db));
}

/**
 * 获取租约。空闲或已过期可获取；被其他主体持有时 409。
 * 同一主体重复获取视为续期，keeps acquired_at。
 */
export function acquireAuthority(actor, options = {}) {
  const holder = holderOf(actor);
  const db = openDatabase(resolveFile(options));
  const now = options.now instanceof Date ? options.now : new Date();
  const ttl = Number(options.ttlSeconds) > 0 ? Number(options.ttlSeconds) : ttlFromEnv();

  return runWrite(db, () => {
    const current = readRow(db);
    const expired = isExpired(current, now);
    if (current && !expired && current.holder_kind !== holder.kind) {
      throw new AuthorityError(
        'ERR_AUTHORITY_HELD',
        `租约被 ${current.holder_kind}:${current.holder_id} 持有，到期时间 ${current.expires_at}`,
        409,
      );
    }
    if (current && !expired && current.holder_id !== holder.id) {
      throw new AuthorityError(
        'ERR_AUTHORITY_HELD',
        `租约被 ${current.holder_kind}:${current.holder_id} 持有，到期时间 ${current.expires_at}`,
        409,
      );
    }
    const leaseId = nextLeaseId(db, now);
    const acquiredAt = current && !expired ? current.acquired_at : iso(now);
    db.prepare(`
      INSERT INTO authority_lease
        (scope, lease_id, holder_kind, holder_id, holder_role, acquired_at, heartbeat_at, expires_at, mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'exclusive')
      ON CONFLICT(scope) DO UPDATE SET
        lease_id = excluded.lease_id,
        holder_kind = excluded.holder_kind,
        holder_id = excluded.holder_id,
        holder_role = excluded.holder_role,
        acquired_at = excluded.acquired_at,
        heartbeat_at = excluded.heartbeat_at,
        expires_at = excluded.expires_at,
        takeover_from = NULL,
        takeover_at = NULL,
        reason = NULL
    `).run(AUTHORITY_SCOPE, leaseId, holder.kind, holder.id, holder.role, acquiredAt, iso(now), isoPlusSeconds(now, ttl));
    return { authority: rowToAuthority(readRow(db)), lease_id: leaseId, created: !current || expired };
  });
}

/** 续租：只接受当前持有者且未过期。 */
export function heartbeatAuthority(actor, leaseId, options = {}) {
  const holder = holderOf(actor);
  const db = openDatabase(resolveFile(options));
  const now = options.now instanceof Date ? options.now : new Date();
  const ttl = Number(options.ttlSeconds) > 0 ? Number(options.ttlSeconds) : ttlFromEnv();

  return runWrite(db, () => {
    const current = readRow(db);
    if (!current || current.lease_id !== String(leaseId || '')) {
      throw new AuthorityError('ERR_AUTHORITY_REQUIRED', '续租需要当前租约的 lease_id', 409);
    }
    if (current.holder_kind !== holder.kind || current.holder_id !== holder.id) {
      throw new AuthorityError('ERR_AUTHORITY_REQUIRED', '只有当前持有者可以续租', 409);
    }
    if (isExpired(current, now)) {
      throw new AuthorityError('ERR_AUTHORITY_REQUIRED', '租约已过期，需要重新获取', 409);
    }
    db.prepare('UPDATE authority_lease SET heartbeat_at = ?, expires_at = ? WHERE scope = ?')
      .run(iso(now), isoPlusSeconds(now, ttl), AUTHORITY_SCOPE);
    return { authority: rowToAuthority(readRow(db)) };
  });
}

/** 释放：只接受当前持有者。释放后该 scope 无租约。 */
export function releaseAuthority(actor, leaseId, options = {}) {
  const holder = holderOf(actor);
  const db = openDatabase(resolveFile(options));

  return runWrite(db, () => {
    const current = readRow(db);
    if (!current || current.lease_id !== String(leaseId || '')) {
      throw new AuthorityError('ERR_AUTHORITY_REQUIRED', '释放需要当前租约的 lease_id', 409);
    }
    if (current.holder_kind !== holder.kind || current.holder_id !== holder.id) {
      throw new AuthorityError('ERR_AUTHORITY_REQUIRED', '只有当前持有者可以释放', 409);
    }
    db.prepare('DELETE FROM authority_lease WHERE scope = ?').run(AUTHORITY_SCOPE);
    return { released: true };
  });
}

/**
 * 人工强制接管：始终允许 human，记录 takeover_from 与原因。
 * AI 主体调用返回 403，不做静默降级。
 */
export function takeoverAuthority(actor, options = {}) {
  const holder = holderOf(actor);
  if (holder.kind !== 'human') {
    throw new AuthorityError('ERR_AUTHORITY_TAKEOVER_DENIED', '只有人工管理员可以强制接管租约', 403);
  }
  const db = openDatabase(resolveFile(options));
  const now = options.now instanceof Date ? options.now : new Date();
  const ttl = Number(options.ttlSeconds) > 0 ? Number(options.ttlSeconds) : ttlFromEnv();

  return runWrite(db, () => {
    const current = readRow(db);
    const previous = current ? `${current.holder_kind}:${current.holder_id}` : null;
    const leaseId = nextLeaseId(db, now);
    db.prepare(`
      INSERT INTO authority_lease
        (scope, lease_id, holder_kind, holder_id, holder_role, acquired_at, heartbeat_at, expires_at, mode, takeover_from, takeover_at, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'exclusive', ?, ?, ?)
      ON CONFLICT(scope) DO UPDATE SET
        lease_id = excluded.lease_id,
        holder_kind = excluded.holder_kind,
        holder_id = excluded.holder_id,
        holder_role = excluded.holder_role,
        acquired_at = excluded.acquired_at,
        heartbeat_at = excluded.heartbeat_at,
        expires_at = excluded.expires_at,
        takeover_from = excluded.takeover_from,
        takeover_at = excluded.takeover_at,
        reason = excluded.reason
    `).run(
      AUTHORITY_SCOPE, leaseId, holder.kind, holder.id, holder.role, iso(now), iso(now),
      isoPlusSeconds(now, ttl), previous, iso(now), String(options.reason || ''),
    );
    return { authority: rowToAuthority(readRow(db)), lease_id: leaseId, takeover_from: previous };
  });
}

/**
 * 状态变更端点的准入判定。
 * 缺 header 或与当前租约不一致返回 409 ERR_AUTHORITY_REQUIRED，过期返回 409 ERR_AUTHORITY_EXPIRED。
 */
export function assertAuthority(leaseId, options = {}) {
  const db = openDatabase(resolveFile(options));
  const now = options.now instanceof Date ? options.now : new Date();
  const current = readRow(db);
  if (!current) {
    throw new AuthorityError('ERR_AUTHORITY_REQUIRED', '当前没有有效租约，请先获取', 409);
  }
  if (isExpired(current, now)) {
    throw new AuthorityError('ERR_AUTHORITY_EXPIRED', '租约已过期，请重新获取后再变更状态', 409);
  }
  if (String(leaseId || '') !== current.lease_id) {
    throw new AuthorityError('ERR_AUTHORITY_REQUIRED', 'X-Bio-Lease-Id 与当前租约不一致', 409);
  }
  return rowToAuthority(current);
}
