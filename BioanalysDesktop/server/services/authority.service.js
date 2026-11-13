/**
 * 单权威租约服务。
 *
 * 租约落在 .ops_state/orchestration_authority.sqlite 的单表里，
 * 判定与写入在同一个 BEGIN IMMEDIATE 事务内完成，避免两个写者同时抢到租约。
 *
 * 对外形态见 docs/AI_ORCHESTRATION_SPEC.md 第三节。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { normalizeActor } from '../auth_principal.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const DEFAULT_TTL_SECONDS = 120;
const DB_CACHE = new Map();

export function defaultAuthorityFile(repoRoot = REPO_ROOT) {
  return path.join(path.resolve(repoRoot), '.ops_state', 'orchestration_authority.sqlite');
}

function resolveFile(options = {}) {
  return path.resolve(String(options.file || defaultAuthorityFile()));
}

function nowDate(value) {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value ?? Date.now());
}

function iso(date) {
  return date.toISOString();
}

function ttlSeconds(options = {}) {
  const raw = Number(options.ttlSeconds ?? process.env.BIO_AUTHORITY_TTL_SECONDS ?? DEFAULT_TTL_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_SECONDS;
}

function authorityError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS authority_lease (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      lease_id TEXT NOT NULL,
      holder_kind TEXT NOT NULL,
      holder_id TEXT NOT NULL,
      holder_role TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'exclusive',
      takeover_from TEXT,
      takeover_at TEXT,
      reason TEXT
    );
    CREATE TABLE IF NOT EXISTS authority_sequence (
      day TEXT PRIMARY KEY,
      next_seq INTEGER NOT NULL
    );
  `);
}

function openDb(file) {
  const key = path.resolve(file);
  if (DB_CACHE.has(key)) return DB_CACHE.get(key);
  fs.mkdirSync(path.dirname(key), { recursive: true });
  const db = new Database(key);
  db.pragma('journal_mode = WAL');
  ensureSchema(db);
  DB_CACHE.set(key, db);
  return db;
}

export function closeAuthorityDatabase(file) {
  const key = path.resolve(String(file || defaultAuthorityFile()));
  const db = DB_CACHE.get(key);
  if (!db) return;
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // 检查点失败不阻塞关闭，临时库会随目录一起删除。
  }
  try {
    db.close();
  } catch {
    // 已关闭时重复调用无副作用。
  }
  DB_CACHE.delete(key);
}

function readRow(db) {
  return db.prepare('SELECT * FROM authority_lease WHERE id = 1').get() || null;
}

function isExpired(row, now) {
  return !row || Date.parse(row.expires_at) <= now.getTime();
}

function toAuthority(row) {
  const authority = {
    lease_id: row.lease_id,
    holder: {
      kind: row.holder_kind,
      id: row.holder_id,
      role: row.holder_role,
    },
    acquired_at: row.acquired_at,
    heartbeat_at: row.heartbeat_at,
    expires_at: row.expires_at,
    mode: row.mode || 'exclusive',
  };
  if (row.takeover_from) {
    authority.takeover_from = row.takeover_from;
    authority.takeover_at = row.takeover_at;
  }
  if (row.reason) authority.reason = row.reason;
  return authority;
}

function nextLeaseId(db, now) {
  const day = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  const row = db.prepare('SELECT next_seq FROM authority_sequence WHERE day = ?').get(day);
  const seq = row ? row.next_seq : 1;
  db.prepare(`
    INSERT INTO authority_sequence (day, next_seq) VALUES (?, ?)
    ON CONFLICT(day) DO UPDATE SET next_seq = excluded.next_seq
  `).run(day, seq + 1);
  return `AUTH-${day}-${String(seq).padStart(4, '0')}`;
}

function writeRow(db, row) {
  db.prepare(`
    INSERT INTO authority_lease (
      id, lease_id, holder_kind, holder_id, holder_role,
      acquired_at, heartbeat_at, expires_at, mode,
      takeover_from, takeover_at, reason
    ) VALUES (
      1, @lease_id, @holder_kind, @holder_id, @holder_role,
      @acquired_at, @heartbeat_at, @expires_at, @mode,
      @takeover_from, @takeover_at, @reason
    )
    ON CONFLICT(id) DO UPDATE SET
      lease_id = excluded.lease_id,
      holder_kind = excluded.holder_kind,
      holder_id = excluded.holder_id,
      holder_role = excluded.holder_role,
      acquired_at = excluded.acquired_at,
      heartbeat_at = excluded.heartbeat_at,
      expires_at = excluded.expires_at,
      mode = excluded.mode,
      takeover_from = excluded.takeover_from,
      takeover_at = excluded.takeover_at,
      reason = excluded.reason
  `).run({
    lease_id: row.lease_id,
    holder_kind: row.holder_kind,
    holder_id: row.holder_id,
    holder_role: row.holder_role,
    acquired_at: row.acquired_at,
    heartbeat_at: row.heartbeat_at,
    expires_at: row.expires_at,
    mode: row.mode || 'exclusive',
    takeover_from: row.takeover_from ?? null,
    takeover_at: row.takeover_at ?? null,
    reason: row.reason ?? null,
  });
}

function requireActor(actor) {
  const normalized = normalizeActor(actor);
  if (!normalized) {
    throw authorityError('ERR_AUTHORITY_ACTOR', '缺少合法主体', 401);
  }
  return normalized;
}

export function readAuthority(options = {}) {
  const db = openDb(resolveFile(options));
  const row = readRow(db);
  if (isExpired(row, nowDate(options.now))) return null;
  return toAuthority(row);
}

export function acquireAuthority(actor, options = {}) {
  const normalized = requireActor(actor);
  const db = openDb(resolveFile(options));
  const now = nowDate(options.now);
  const ttl = ttlSeconds(options);

  const run = db.transaction(() => {
    const current = readRow(db);
    if (current && !isExpired(current, now)) {
      const sameHolder = current.holder_kind === normalized.kind && current.holder_id === normalized.id;
      if (!sameHolder) {
        throw authorityError('ERR_AUTHORITY_HELD', '租约已被其他主体持有');
      }
      const leaseId = nextLeaseId(db, now);
      const row = {
        ...current,
        lease_id: leaseId,
        heartbeat_at: iso(now),
        expires_at: iso(new Date(now.getTime() + ttl * 1000)),
        mode: 'exclusive',
        takeover_from: null,
        takeover_at: null,
        reason: null,
      };
      writeRow(db, row);
      return { lease_id: leaseId, created: false, authority: toAuthority(row) };
    }

    const leaseId = nextLeaseId(db, now);
    const row = {
      lease_id: leaseId,
      holder_kind: normalized.kind,
      holder_id: normalized.id,
      holder_role: normalized.role,
      acquired_at: iso(now),
      heartbeat_at: iso(now),
      expires_at: iso(new Date(now.getTime() + ttl * 1000)),
      mode: 'exclusive',
      takeover_from: null,
      takeover_at: null,
      reason: null,
    };
    writeRow(db, row);
    return { lease_id: leaseId, created: true, authority: toAuthority(row) };
  });

  return run.immediate();
}

export function heartbeatAuthority(actor, leaseId, options = {}) {
  const normalized = requireActor(actor);
  const db = openDb(resolveFile(options));
  const now = nowDate(options.now);
  const ttl = ttlSeconds(options);

  const run = db.transaction(() => {
    const current = readRow(db);
    if (!current) throw authorityError('ERR_AUTHORITY_REQUIRED', '租约不存在');
    if (isExpired(current, now)) throw authorityError('ERR_AUTHORITY_EXPIRED', '租约已过期');
    const sameHolder = current.holder_kind === normalized.kind && current.holder_id === normalized.id;
    if (!sameHolder || String(leaseId || '') !== current.lease_id) {
      throw authorityError('ERR_AUTHORITY_REQUIRED', '只有当前持有者可以续租');
    }
    const row = {
      ...current,
      heartbeat_at: iso(now),
      expires_at: iso(new Date(now.getTime() + ttl * 1000)),
    };
    writeRow(db, row);
    return { authority: toAuthority(row) };
  });

  return run.immediate();
}

export function releaseAuthority(actor, leaseId, options = {}) {
  const normalized = requireActor(actor);
  const db = openDb(resolveFile(options));
  const now = nowDate(options.now);

  const run = db.transaction(() => {
    const current = readRow(db);
    if (!current) throw authorityError('ERR_AUTHORITY_REQUIRED', '租约不存在');
    if (isExpired(current, now)) throw authorityError('ERR_AUTHORITY_EXPIRED', '租约已过期');
    const sameHolder = current.holder_kind === normalized.kind && current.holder_id === normalized.id;
    if (!sameHolder || String(leaseId || '') !== current.lease_id) {
      throw authorityError('ERR_AUTHORITY_REQUIRED', '只有当前持有者可以释放租约');
    }
    db.prepare('DELETE FROM authority_lease WHERE id = 1').run();
    return { ok: true };
  });

  return run.immediate();
}

export function takeoverAuthority(actor, options = {}) {
  const normalized = requireActor(actor);
  if (normalized.kind !== 'human') {
    throw authorityError('ERR_AUTHORITY_TAKEOVER_DENIED', '只有人工管理员可以强制接管', 403);
  }
  const db = openDb(resolveFile(options));
  const now = nowDate(options.now);
  const ttl = ttlSeconds(options);

  const run = db.transaction(() => {
    const current = readRow(db);
    const takeoverFrom = current ? `${current.holder_kind}:${current.holder_id}` : null;
    const leaseId = nextLeaseId(db, now);
    const row = {
      lease_id: leaseId,
      holder_kind: normalized.kind,
      holder_id: normalized.id,
      holder_role: normalized.role,
      acquired_at: iso(now),
      heartbeat_at: iso(now),
      expires_at: iso(new Date(now.getTime() + ttl * 1000)),
      mode: 'exclusive',
      takeover_from: takeoverFrom,
      takeover_at: iso(now),
      reason: options.reason ? String(options.reason) : null,
    };
    writeRow(db, row);
    return { lease_id: leaseId, takeover_from: takeoverFrom, authority: toAuthority(row) };
  });

  return run.immediate();
}

export function assertAuthority(leaseId, options = {}) {
  const db = openDb(resolveFile(options));
  const now = nowDate(options.now);
  const current = readRow(db);
  if (!current) {
    throw authorityError('ERR_AUTHORITY_REQUIRED', '缺少有效租约');
  }
  if (isExpired(current, now)) {
    throw authorityError('ERR_AUTHORITY_EXPIRED', '租约已过期，请重新获取');
  }
  if (!String(leaseId || '') || String(leaseId) !== current.lease_id) {
    throw authorityError('ERR_AUTHORITY_REQUIRED', '缺少有效租约');
  }
  return toAuthority(current);
}
