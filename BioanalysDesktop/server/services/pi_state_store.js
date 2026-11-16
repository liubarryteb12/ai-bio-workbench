/**
 * BioanalysDesktop/server/services/pi_state_store.js
 * Pi Agent 无状态挂起与恢复持久化存储（SQLite .ops_state/pi_jobs.sqlite）。
 *
 * 设计约束：
 *   - Pi Agent 以 `--mode rpc --no-session` 无状态运行，挂起期间不保留常驻进程。
 *   - 所有阶段上下文、人工刹车片状态与审批记录均落在 SQLite，宿主按需重建上下文唤醒。
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DATA_ROOT } from '../paths.js';

export const PI_JOB_STATUS = Object.freeze({
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  SUSPENDED_EXTERNAL: 'SUSPENDED_WAITING_EXTERNAL_APPROVAL',
  SUSPENDED_ACCEPTANCE: 'SUSPENDED_WAITING_FINAL_ACCEPTANCE',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
});

export const PI_STAGES = Object.freeze({
  STAGE_1_INTAKE: 'STAGE_1_INTAKE',
  STAGE_2_EXTERNAL_FETCH: 'STAGE_2_EXTERNAL_FETCH',
  STAGE_3_COMPUTE_PULL: 'STAGE_3_COMPUTE_PULL',
  STAGE_4_REPORT_DELIVERY: 'STAGE_4_REPORT_DELIVERY',
});

const DB_CACHE = new Map();

export function defaultPiStateFile(dataRoot = DATA_ROOT) {
  return path.join(path.resolve(dataRoot), '.ops_state', 'pi_jobs.sqlite');
}

export function openPiStateDb(dbPath = defaultPiStateFile()) {
  const resolved = path.resolve(String(dbPath));
  if (DB_CACHE.has(resolved)) {
    return DB_CACHE.get(resolved);
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS pi_jobs (
      job_id TEXT PRIMARY KEY,
      intake_id TEXT,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      requires_external_download INTEGER NOT NULL DEFAULT 0,
      context_json TEXT NOT NULL,
      checkpoint_reason TEXT,
      approved_by TEXT,
      approved_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pi_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pi_events_job_id ON pi_events(job_id, id);
  `);

  DB_CACHE.set(resolved, db);
  return db;
}

export function closePiStateDb(dbPath = defaultPiStateFile()) {
  const resolved = path.resolve(String(dbPath));
  const db = DB_CACHE.get(resolved);
  if (db) {
    db.close();
    DB_CACHE.delete(resolved);
  }
}

function hydrateJob(row) {
  if (!row) return null;
  let context = {};
  try {
    context = JSON.parse(row.context_json || '{}');
  } catch {
    context = {};
  }
  return {
    job_id: row.job_id,
    intake_id: row.intake_id,
    stage: row.stage,
    status: row.status,
    requires_external_download: Boolean(row.requires_external_download),
    context,
    checkpoint_reason: row.checkpoint_reason || null,
    approved_by: row.approved_by || null,
    approved_at: row.approved_at || null,
    last_error: row.last_error || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createPiJob({
  jobId,
  intakeId = null,
  stage = PI_STAGES.STAGE_1_INTAKE,
  status = PI_JOB_STATUS.QUEUED,
  requiresExternalDownload = false,
  context = {},
  checkpointReason = null,
  dbPath,
}) {
  const db = openPiStateDb(dbPath);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO pi_jobs (
      job_id, intake_id, stage, status, requires_external_download,
      context_json, checkpoint_reason, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    jobId,
    intakeId,
    stage,
    status,
    requiresExternalDownload ? 1 : 0,
    JSON.stringify(context || {}),
    checkpointReason,
    now,
    now,
  );
  return getPiJob(jobId, dbPath);
}

export function getPiJob(jobId, dbPath) {
  const db = openPiStateDb(dbPath);
  const row = db.prepare('SELECT * FROM pi_jobs WHERE job_id = ?').get(jobId);
  return hydrateJob(row);
}

export function listPiJobs(dbPath, limit = 100) {
  const db = openPiStateDb(dbPath);
  const rows = db.prepare('SELECT * FROM pi_jobs ORDER BY updated_at DESC LIMIT ?').all(limit);
  return rows.map(hydrateJob);
}

export function updatePiJob(jobId, patch = {}, dbPath) {
  const db = openPiStateDb(dbPath);
  const current = getPiJob(jobId, dbPath);
  if (!current) {
    throw new Error(`Pi job not found: ${jobId}`);
  }
  const nextContext = patch.context !== undefined
    ? { ...current.context, ...patch.context }
    : current.context;
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE pi_jobs
    SET stage = ?,
        status = ?,
        context_json = ?,
        checkpoint_reason = ?,
        approved_by = ?,
        approved_at = ?,
        last_error = ?,
        updated_at = ?
    WHERE job_id = ?
  `).run(
    patch.stage ?? current.stage,
    patch.status ?? current.status,
    JSON.stringify(nextContext),
    patch.checkpointReason !== undefined ? patch.checkpointReason : current.checkpoint_reason,
    patch.approvedBy !== undefined ? patch.approvedBy : current.approved_by,
    patch.approvedAt !== undefined ? patch.approvedAt : current.approved_at,
    patch.lastError !== undefined ? patch.lastError : current.last_error,
    now,
    jobId,
  );
  return getPiJob(jobId, dbPath);
}

export function appendPiEvent({ jobId, stage, eventType, payload = {} }, dbPath) {
  const db = openPiStateDb(dbPath);
  const now = new Date().toISOString();
  const res = db.prepare(`
    INSERT INTO pi_events (job_id, stage, event_type, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(jobId, stage, eventType, JSON.stringify(payload), now);
  return {
    id: Number(res.lastInsertRowid),
    job_id: jobId,
    stage,
    event_type: eventType,
    payload,
    created_at: now,
  };
}

export function listPiEvents(jobId, dbPath, afterId = 0, limit = 200) {
  const db = openPiStateDb(dbPath);
  const rows = db.prepare(`
    SELECT * FROM pi_events
    WHERE job_id = ? AND id > ?
    ORDER BY id ASC
    LIMIT ?
  `).all(jobId, afterId, limit);
  return rows.map((r) => {
    let payload = {};
    try { payload = JSON.parse(r.payload_json || '{}'); } catch { payload = {}; }
    return {
      id: r.id,
      job_id: r.job_id,
      stage: r.stage,
      event_type: r.event_type,
      payload,
      created_at: r.created_at,
    };
  });
}
