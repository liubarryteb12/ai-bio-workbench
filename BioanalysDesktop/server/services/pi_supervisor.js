/**
 * BioanalysDesktop/server/services/pi_supervisor.js
 * Pi CLI 驻留托管与双人工审核检查点编排（模块一）。
 *
 * 与既有 pi_runner.js 的分工：
 *   pi_runner.js     无状态 RPC 单轮调用 + 四阶段挂起恢复
 *   本模块           以 work_order_id 为主键的监督会话：会话状态、检查点判定、
 *                    Pi 结论落库、SQLite 持久化（重启可续）
 *
 * 两个检查点（任一未批准都不得前进）：
 *   CHECKPOINT_1_PROJECT_PLAN   立项与 DAG 编译之后、下发算力节点之前
 *   CHECKPOINT_2_TARGET_LOCK    核心靶点收敛与质控完成之后、报告渲染与签名之前
 *
 * 状态持久化在 data/.ops_state/pi_sessions.sqlite，与 pi_jobs.sqlite 分开：
 * 那张表是无状态 RPC 的作业簿，这张表是"监督关系"的簿。混表会让两套生命周期互相污染。
 *
 * JSON-RPC 2.0 帧：请求 {jsonrpc:'2.0', id, method, params}，响应同构。
 * 本模块自带一个极小的 stdio 帧编解码器，只 Serving 本地回环通信，不做网络监听。
 */
import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';
import { DATA_ROOT } from '../paths.js';
import { ALLOWED_TOOL_NAMES, TOOL_DEFINITIONS } from './pi_tools_bridge.js';
import { defaultAutonomyPolicy, evaluateCheckpoint } from '../../../shared/autonomy_policy_v1.mjs';

export const PI_SESSION_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  AWAITING_PLAN_APPROVAL: 'AWAITING_PLAN_APPROVAL',
  PLAN_APPROVED: 'PLAN_APPROVED',
  RUNNING_DAG: 'RUNNING_DAG',
  AWAITING_TARGET_APPROVAL: 'AWAITING_TARGET_APPROVAL',
  TARGET_APPROVED: 'TARGET_APPROVED',
  REPORT_SIGNED: 'REPORT_SIGNED',
  FAILED: 'FAILED',
});

export const PI_CHECKPOINTS = Object.freeze({
  PLAN: 'CHECKPOINT_1_PROJECT_PLAN',
  TARGET: 'CHECKPOINT_2_TARGET_LOCK',
});

/** 交付等级（终审红线 2）：常规标准签名与探索性降级签名必须可区分。 */
export const DELIVERY_GRADES = Object.freeze({
  STANDARD: 'STANDARD_VERIFIED',
  DEGRADED: 'EXPLORATORY_DEGRADED',
});

const DB_CACHE = new Map();

export function defaultPiSessionDbPath(dataRoot = DATA_ROOT) {
  return path.join(path.resolve(dataRoot), '.ops_state', 'pi_sessions.sqlite');
}

export function openPiSessionDb(dbPath = defaultPiSessionDbPath()) {
  const resolved = path.resolve(String(dbPath));
  if (DB_CACHE.has(resolved)) return DB_CACHE.get(resolved);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS pi_sessions (
      session_id TEXT PRIMARY KEY,
      work_order_id TEXT,
      project_id TEXT NOT NULL,
      line_id TEXT NOT NULL,
      status TEXT NOT NULL,
      current_checkpoint TEXT,
      pi_model TEXT,
      tool_call_count INTEGER NOT NULL DEFAULT 0,
      state_version INTEGER NOT NULL DEFAULT 1,
      context_json TEXT NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pi_sessions_work_order ON pi_sessions(work_order_id);

    CREATE TABLE IF NOT EXISTS pi_checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      checkpoint TEXT NOT NULL,
      decision TEXT NOT NULL,
      decided_by TEXT,
      reason TEXT,
      payload_json TEXT NOT NULL,
      duration_ms INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pi_checkpoints_session ON pi_checkpoints(session_id, id);

    CREATE TABLE IF NOT EXISTS pi_tool_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      ok INTEGER NOT NULL,
      error_code TEXT,
      duration_ms INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pi_tool_calls_session ON pi_tool_calls(session_id, id);
  `);
  // 兼容旧库：state_version 是 D4.9 检查点 CAS 的版本列，缺失时补列。
  const columns = db.prepare('PRAGMA table_info(pi_sessions)').all().map((row) => row.name);
  if (!columns.includes('state_version')) {
    db.exec('ALTER TABLE pi_sessions ADD COLUMN state_version INTEGER NOT NULL DEFAULT 1');
  }
  DB_CACHE.set(resolved, db);
  return db;
}

export function closePiSessionDb(dbPath = defaultPiSessionDbPath()) {
  const resolved = path.resolve(String(dbPath));
  const db = DB_CACHE.get(resolved);
  if (db) { db.close(); DB_CACHE.delete(resolved); }
}

function hydrateSession(row) {
  if (!row) return null;
  let context = {};
  try { context = JSON.parse(row.context_json || '{}'); } catch { context = {}; }
  return {
    session_id: row.session_id,
    work_order_id: row.work_order_id || null,
    project_id: row.project_id,
    line_id: row.line_id,
    status: row.status,
    current_checkpoint: row.current_checkpoint || null,
    pi_model: row.pi_model || null,
    tool_call_count: row.tool_call_count,
    state_version: Number(row.state_version || 1),
    context,
    last_error: row.last_error || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createSession({
  sessionId,
  workOrderId = null,
  projectId,
  lineId,
  piModel = 'pi-cli',
  context = {},
  dbPath,
}) {
  const db = openPiSessionDb(dbPath);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO pi_sessions (
      session_id, work_order_id, project_id, line_id, status,
      current_checkpoint, pi_model, tool_call_count, context_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `).run(
    sessionId, workOrderId, projectId, lineId,
    PI_SESSION_STATUS.DRAFT, PI_CHECKPOINTS.PLAN, piModel,
    JSON.stringify(context || {}), now, now,
  );
  return getSession(sessionId, dbPath);
}

export function getSession(sessionId, dbPath) {
  const db = openPiSessionDb(dbPath);
  return hydrateSession(db.prepare('SELECT * FROM pi_sessions WHERE session_id = ?').get(sessionId));
}

export function getSessionByWorkOrder(workOrderId, dbPath) {
  const db = openPiSessionDb(dbPath);
  const row = db.prepare('SELECT * FROM pi_sessions WHERE work_order_id = ? ORDER BY updated_at DESC LIMIT 1').get(workOrderId);
  return hydrateSession(row);
}

export function listSessions(dbPath, limit = 100) {
  const db = openPiSessionDb(dbPath);
  return db.prepare('SELECT * FROM pi_sessions ORDER BY updated_at DESC LIMIT ?').all(limit).map(hydrateSession);
}

export function updateSession(sessionId, patch = {}, dbPath) {
  const db = openPiSessionDb(dbPath);
  const current = getSession(sessionId, dbPath);
  if (!current) throw new Error(`Pi 会话不存在: ${sessionId}`);
  const expectedVersion = patch.expectedVersion;
  if (expectedVersion !== undefined) {
    if (!Number.isInteger(expectedVersion) || expectedVersion !== current.state_version) {
      const err = new Error(
        `ERR_SESSION_STALE_VERSION: 会话版本已变化（期望 ${expectedVersion}，当前 ${current.state_version}）`,
      );
      err.code = 'ERR_SESSION_STALE_VERSION';
      throw err;
    }
  }
  const nextContext = patch.context !== undefined
    ? { ...current.context, ...patch.context }
    : current.context;
  const run = db.prepare(`
    UPDATE pi_sessions
    SET status = ?, current_checkpoint = ?, tool_call_count = ?,
        context_json = ?, last_error = ?, updated_at = ?, state_version = state_version + 1
    WHERE session_id = ?${expectedVersion !== undefined ? ' AND state_version = ?' : ''}
  `);
  const params = [
    patch.status ?? current.status,
    patch.currentCheckpoint !== undefined ? patch.currentCheckpoint : current.current_checkpoint,
    patch.toolCallCount ?? current.tool_call_count,
    JSON.stringify(nextContext),
    patch.lastError !== undefined ? patch.lastError : current.last_error,
    new Date().toISOString(),
    sessionId,
  ];
  if (expectedVersion !== undefined) params.push(expectedVersion);
  const res = run.run(...params);
  if (expectedVersion !== undefined && res.changes !== 1) {
    const err = new Error('ERR_SESSION_STALE_VERSION: 并发状态跃迁失败，版本号不匹配');
    err.code = 'ERR_SESSION_STALE_VERSION';
    throw err;
  }
  return getSession(sessionId, dbPath);
}

export function recordCheckpoint({
  sessionId, checkpoint, decision, decidedBy = null, reason = null, payload = {}, durationMs = null,
}, dbPath) {
  const db = openPiSessionDb(dbPath);
  const now = new Date().toISOString();
  const res = db.prepare(`
    INSERT INTO pi_checkpoints (session_id, checkpoint, decision, decided_by, reason, payload_json, duration_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, checkpoint, decision, decidedBy, reason, JSON.stringify(payload || {}), durationMs, now);
  return {
    id: Number(res.lastInsertRowid),
    session_id: sessionId,
    checkpoint,
    decision,
    decided_by: decidedBy,
    reason,
    payload,
    duration_ms: durationMs,
    created_at: now,
  };
}

export function listCheckpoints(sessionId, dbPath) {
  const db = openPiSessionDb(dbPath);
  return db.prepare('SELECT * FROM pi_checkpoints WHERE session_id = ? ORDER BY id ASC').all(sessionId)
    .map((row) => {
      let payload = {};
      try { payload = JSON.parse(row.payload_json || '{}'); } catch { payload = {}; }
      return { ...row, payload };
    });
}

export function recordToolCall({ sessionId, toolName, ok, errorCode = null, durationMs = null }, dbPath) {
  const db = openPiSessionDb(dbPath);
  const res = db.prepare(`
    INSERT INTO pi_tool_calls (session_id, tool_name, ok, error_code, duration_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sessionId, toolName, ok ? 1 : 0, errorCode, durationMs, new Date().toISOString());
  return Number(res.lastInsertRowid);
}

export function listToolCalls(sessionId, dbPath) {
  const db = openPiSessionDb(dbPath);
  return db.prepare('SELECT * FROM pi_tool_calls WHERE session_id = ? ORDER BY id ASC').all(sessionId);
}

/** 硬闸门：除六大白名单外的任何工具名都不许出现在会话工具调用里。 */
export function assertToolAllowed(toolName) {
  if (!ALLOWED_TOOL_NAMES.includes(toolName)) {
    const err = new Error(`PI_TOOL_NOT_ALLOWED: '${toolName}' 不在六大受控工具白名单内`);
    err.code = 'PI_TOOL_NOT_ALLOWED';
    throw err;
  }
  return TOOL_DEFINITIONS[toolName];
}

/**
 * JSON-RPC 2.0 帧编解码。只处理单条消息，不做批量与通知重放：
 * Pi CLI 是本机子进程，协议面越小越难被滥用。
 */
export function encodeRpcFrame({ id, method, params = {} }) {
  return `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
}

export function decodeRpcFrame(line) {
  let obj;
  try {
    obj = JSON.parse(String(line || '').trim());
  } catch {
    return { ok: false, error: { code: -32700, message: 'Parse error' } };
  }
  if (!obj || obj.jsonrpc !== '2.0') {
    return { ok: false, error: { code: -32600, message: 'Invalid Request: jsonrpc 必须为 2.0' } };
  }
  if (obj.method !== undefined) {
    return { ok: true, request: { id: obj.id, method: obj.method, params: obj.params || {} } };
  }
  if (obj.result !== undefined || obj.error !== undefined) {
    return { ok: true, response: { id: obj.id, result: obj.result, error: obj.error } };
  }
  return { ok: false, error: { code: -32600, message: 'Invalid Request: 既非 request 也非 response' } };
}

/**
 * 监督器：把"Pi 给结论、人给批准"变成可持久化的两步状态机。
 *
 * 依赖注入：
 *   dbPath      会话库路径（测试指向临时目录）
 *   toolsBridge 六大工具桥（可选，未注入时只做状态机）
 *   ledgerAppend 审计台账写入
 */
export class PiSupervisor {
  constructor({
    dbPath, toolsBridge = null, ledgerAppend = () => {}, piBin = null,
    autonomyPolicy = null, now = () => Date.now(), onPlanApproved = null,
  } = {}) {
    this.dbPath = dbPath;
    this.toolsBridge = toolsBridge;
    this.ledgerAppend = ledgerAppend;
    this.piBin = piBin || process.env.BIO_PI_CLI_BIN || null;
    this.autonomyPolicy = autonomyPolicy;
    this.now = now;
    this.onPlanApproved = typeof onPlanApproved === 'function' ? onPlanApproved : null;
  }

  start({ workOrderId = null, projectId, lineId, piModel, context = {}, sessionId } = {}) {
    const id = sessionId || `ps_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const session = createSession({
      sessionId: id, workOrderId, projectId, lineId, piModel, context, dbPath: this.dbPath,
    });
    this.ledgerAppend({
      kind: 'pi_session',
      action: 'start',
      detail: { session_id: id, work_order_id: workOrderId, project_id: projectId, line_id: lineId },
    });
    return session;
  }

  getSession(sessionId) {
    return getSession(sessionId, this.dbPath);
  }

  /**
   * 检查点一：提交 Pi 的立项方案与 DAG 预审意见，进入待人批准态。
   * 判据：没有 plan_text 或 dag 摘要为空即拒绝，不许"空方案等批准"。
   */
  submitPlan(sessionId, { planText, dag = [], parameterNotes = [], recommendedMods = [] } = {}) {
    const session = getSession(sessionId, this.dbPath);
    if (!session) throw new Error(`Pi 会话不存在: ${sessionId}`);
    if (!planText || String(planText).trim() === '') {
      throw new Error('PI_PLAN_EMPTY: 检查点一必须提交非空方案文本');
    }
    if (!Array.isArray(dag) || dag.length === 0) {
      throw new Error('PI_PLAN_DAG_EMPTY: 检查点一必须提交非空 DAG 拓扑摘要');
    }
    const updated = updateSession(sessionId, {
      status: PI_SESSION_STATUS.AWAITING_PLAN_APPROVAL,
      currentCheckpoint: PI_CHECKPOINTS.PLAN,
      context: {
        plan_text: String(planText).slice(0, 4000),
        plan_dag: dag.slice(0, 30),
        parameter_notes: parameterNotes.slice(0, 20),
        recommended_mods: recommendedMods.slice(0, 60),
        grace_deadline_ms: Date.now() + Number(
          (this.autonomyPolicy || defaultAutonomyPolicy())?.checkpoint?.checkpoint_1_grace_sec ?? 180,
        ) * 1000,
      },
    }, this.dbPath);
    recordCheckpoint({
      sessionId,
      checkpoint: PI_CHECKPOINTS.PLAN,
      decision: 'SUBMITTED',
      payload: { dag_size: dag.length, plan_chars: String(planText).length },
    }, this.dbPath);
    return updated;
  }

  /** 检查点一批准：只有 AWAITING_PLAN_APPROVAL 可以前进，其余一律 409 语义。 */
  approvePlan(sessionId, { actor, reason = null, expectedVersion = undefined } = {}) {
    const session = getSession(sessionId, this.dbPath);
    if (!session) throw new Error(`Pi 会话不存在: ${sessionId}`);
    if (session.status !== PI_SESSION_STATUS.AWAITING_PLAN_APPROVAL) {
      const err = new Error(`INVALID_STATE_TRANSITION: 当前 ${session.status}，检查点一批准要求 ${PI_SESSION_STATUS.AWAITING_PLAN_APPROVAL}`);
      err.code = 'INVALID_STATE_TRANSITION';
      throw err;
    }
    if (!actor || String(actor).trim() === '') {
      const err = new Error('CHECKPOINT_ACTOR_REQUIRED: 人工批准必须留下 actor');
      err.code = 'CHECKPOINT_ACTOR_REQUIRED';
      throw err;
    }
    const durationMs = Date.now() - Date.parse(session.updated_at);
    const updated = updateSession(sessionId, {
      status: PI_SESSION_STATUS.PLAN_APPROVED,
      currentCheckpoint: null,
      context: { plan_approved_by: actor, plan_approved_at: new Date().toISOString() },
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    }, this.dbPath);
    recordCheckpoint({
      sessionId, checkpoint: PI_CHECKPOINTS.PLAN, decision: 'APPROVED',
      decidedBy: actor, reason, payload: {}, durationMs,
    }, this.dbPath);
    this.ledgerAppend({
      kind: 'pi_checkpoint', action: 'approve_plan',
      detail: { session_id: sessionId, actor, work_order_id: session.work_order_id },
    });
    if (this.onPlanApproved) {
      try {
        const maybePromise = this.onPlanApproved(updated);
        if (maybePromise && typeof maybePromise.catch === 'function') {
          maybePromise.catch((error) => {
            this.ledgerAppend({
              kind: 'pi_checkpoint', action: 'approve_plan_hook_failed',
              detail: { session_id: sessionId, error: String(error.message || error) },
            });
          });
        }
      } catch (error) {
        this.ledgerAppend({
          kind: 'pi_checkpoint', action: 'approve_plan_hook_failed',
          detail: { session_id: sessionId, error: String(error.message || error) },
        });
      }
    }
    return updated;
  }

  /**
   * 检查点策略判定（终审 C 方案）：
   *   检查点一按 180s 宽限自动放行（吊销条件命中即转人工）；
   *   检查点二永远人工，唯一豁免是 golden_regression 且全绿。
   */
  evaluateCheckpoint(sessionId, { checkpoint = 1, facts = {} } = {}) {
    const session = getSession(sessionId, this.dbPath);
    if (!session) throw new Error(`Pi 会话不存在: ${sessionId}`);
    const policy = this.autonomyPolicy || defaultAutonomyPolicy();
    return {
      session_id: sessionId,
      session_status: session.status,
      ...evaluateCheckpoint(policy, { checkpoint, facts }),
    };
  }

  /**
   * 扫描到期的检查点一：宽限期已过的 AWAITING_PLAN_APPROVAL 自动批准。
   * 返回被自动批准的 session_id 列表；吊销命中或检查点二一律不在此列。
   */
  autoPassDuePlans({ now = this.now(), factsProvider = () => ({}) } = {}) {
    const approved = [];
    const sessions = listSessions(this.dbPath, 500)
      .filter((session) => session.status === PI_SESSION_STATUS.AWAITING_PLAN_APPROVAL);
    for (const session of sessions) {
      const decision = this.evaluateCheckpoint(session.session_id, {
        checkpoint: 1,
        facts: factsProvider(session),
      });
      if (!['grace_auto_pass', 'zero_wait_pass', 'golden_regression_pass'].includes(decision.mode)) continue;
      // grace_deadline_ms 是面板与服务端共用的单一真源；老会话缺该字段时回落到 updated_at。
      const explicitDeadline = Number(session.context?.grace_deadline_ms);
      const updatedAt = Date.parse(session.updated_at) || 0;
      const dueAt = Number.isFinite(explicitDeadline) && explicitDeadline > 0
        ? explicitDeadline
        : updatedAt + Number(decision.waitSec || 0) * 1000;
      if (now < dueAt) continue;
      try {
        this.approvePlan(session.session_id, {
          actor: 'autonomy_policy',
          reason: `AUTO_PASS:${decision.mode}`,
          expectedVersion: session.state_version,
        });
        approved.push(session.session_id);
      } catch {
        // 并发下人工已先批准或版本已变：本会话跳过，不影响其余会话的扫描。
      }
    }
    return approved;
  }

  rejectPlan(sessionId, { actor, reason } = {}) {
    if (!reason) {
      const err = new Error('CHECKPOINT_REASON_REQUIRED: 驳回必须写明理由');
      err.code = 'CHECKPOINT_REASON_REQUIRED';
      throw err;
    }
    const updated = updateSession(sessionId, {
      status: PI_SESSION_STATUS.DRAFT,
      currentCheckpoint: PI_CHECKPOINTS.PLAN,
      context: { plan_rejected_by: actor || 'unknown', plan_reject_reason: reason },
    }, this.dbPath);
    recordCheckpoint({
      sessionId, checkpoint: PI_CHECKPOINTS.PLAN, decision: 'REJECTED',
      decidedBy: actor || null, reason, payload: {},
    }, this.dbPath);
    return updated;
  }

  /**
   * 统一拦截接口（终审 C 方案）：人工点拦截即停机交权。
   * - AWAITING_PLAN_APPROVAL：CAS 回 DRAFT，等待修改。
   * - PLAN_APPROVED / RUNNING_DAG：定时器已胜出，转 FAILED 并标记 POST_DISPATCH_PREEMPTED。
   */
  interceptPlan(sessionId, { actor, reason = null, expectedVersion = undefined } = {}) {
    const session = getSession(sessionId, this.dbPath);
    if (!session) throw new Error(`Pi 会话不存在: ${sessionId}`);
    const prior = session.status;
    if (![PI_SESSION_STATUS.AWAITING_PLAN_APPROVAL, PI_SESSION_STATUS.PLAN_APPROVED, PI_SESSION_STATUS.RUNNING_DAG].includes(prior)) {
      const err = new Error(`INVALID_STATE_TRANSITION: 当前 ${prior} 不可拦截`);
      err.code = 'INVALID_STATE_TRANSITION';
      throw err;
    }
    if (prior === PI_SESSION_STATUS.AWAITING_PLAN_APPROVAL) {
      const updated = updateSession(sessionId, {
        status: PI_SESSION_STATUS.DRAFT,
        currentCheckpoint: PI_CHECKPOINTS.PLAN,
        context: {
          intercepted_by: actor || 'unknown',
          intercepted_at: new Date().toISOString(),
          intercept_reason: reason,
        },
        ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      }, this.dbPath);
      recordCheckpoint({
        sessionId, checkpoint: PI_CHECKPOINTS.PLAN, decision: 'REJECTED',
        decidedBy: actor || null, reason: reason || 'INTERCEPTED',
      }, this.dbPath);
      return { session: updated, mode: 'PRE_DISPATCH_INTERCEPTED' };
    }
    const updated = updateSession(sessionId, {
      status: PI_SESSION_STATUS.FAILED,
      currentCheckpoint: null,
      lastError: 'INTERCEPTED_AFTER_DISPATCH',
      context: {
        intercepted_by: actor || 'unknown',
        intercepted_at: new Date().toISOString(),
        intercept_reason: reason,
      },
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    }, this.dbPath);
    return { session: updated, mode: 'POST_DISPATCH_PREEMPTED' };
  }

  markDagRunning(sessionId) {
    const session = getSession(sessionId, this.dbPath);
    if (!session) throw new Error(`Pi 会话不存在: ${sessionId}`);
    if (session.status !== PI_SESSION_STATUS.PLAN_APPROVED) {
      const err = new Error(`INVALID_STATE_TRANSITION: 下发 DAG 前必须已完成检查点一批准（当前 ${session.status}）`);
      err.code = 'INVALID_STATE_TRANSITION';
      throw err;
    }
    return updateSession(sessionId, {
      status: PI_SESSION_STATUS.RUNNING_DAG, currentCheckpoint: null,
    }, this.dbPath);
  }

  /**
   * 检查点二：核心靶点收敛后提交 1–3 个待锁定靶点与质控批注。
   * 判据：靶点数必须在 1..3，且每个靶点带证据字段（基因、证据来源、效应量）。
   */
  submitTargetLock(sessionId, { targets = [], qcSummary = {} } = {}) {
    const session = getSession(sessionId, this.dbPath);
    if (!session) throw new Error(`Pi 会话不存在: ${sessionId}`);
    if (session.status !== PI_SESSION_STATUS.RUNNING_DAG) {
      const err = new Error(`INVALID_STATE_TRANSITION: 提交靶点锁定要求 ${PI_SESSION_STATUS.RUNNING_DAG}（当前 ${session.status}）`);
      err.code = 'INVALID_STATE_TRANSITION';
      throw err;
    }
    if (!Array.isArray(targets) || targets.length < 1 || targets.length > 3) {
      const err = new Error(`TARGET_LOCK_COUNT_INVALID: 靶点数必须为 1 到 3，实际 ${Array.isArray(targets) ? targets.length : 'N/A'}`);
      err.code = 'TARGET_LOCK_COUNT_INVALID';
      throw err;
    }
    for (const target of targets) {
      if (!target?.gene || !target?.evidence_mod || target?.effect_size === undefined) {
        const err = new Error('TARGET_LOCK_EVIDENCE_MISSING: 每个靶点必须给出 gene / evidence_mod / effect_size');
        err.code = 'TARGET_LOCK_EVIDENCE_MISSING';
        throw err;
      }
    }
    const updated = updateSession(sessionId, {
      status: PI_SESSION_STATUS.AWAITING_TARGET_APPROVAL,
      currentCheckpoint: PI_CHECKPOINTS.TARGET,
      context: { target_lock: targets.slice(0, 3), qc_summary: qcSummary },
    }, this.dbPath);
    recordCheckpoint({
      sessionId, checkpoint: PI_CHECKPOINTS.TARGET, decision: 'SUBMITTED',
      payload: { target_count: targets.length, genes: targets.map((t) => t.gene) },
    }, this.dbPath);
    return updated;
  }

  approveTargetLock(sessionId, { actor, reason = null } = {}) {
    const session = getSession(sessionId, this.dbPath);
    if (!session) throw new Error(`Pi 会话不存在: ${sessionId}`);
    if (session.status !== PI_SESSION_STATUS.AWAITING_TARGET_APPROVAL) {
      const err = new Error(`INVALID_STATE_TRANSITION: 当前 ${session.status}，检查点二批准要求 ${PI_SESSION_STATUS.AWAITING_TARGET_APPROVAL}`);
      err.code = 'INVALID_STATE_TRANSITION';
      throw err;
    }
    if (!actor || String(actor).trim() === '') {
      const err = new Error('CHECKPOINT_ACTOR_REQUIRED: 人工批准必须留下 actor');
      err.code = 'CHECKPOINT_ACTOR_REQUIRED';
      throw err;
    }
    const updated = updateSession(sessionId, {
      status: PI_SESSION_STATUS.TARGET_APPROVED,
      currentCheckpoint: null,
      context: { target_approved_by: actor, target_approved_at: new Date().toISOString() },
    }, this.dbPath);
    recordCheckpoint({
      sessionId, checkpoint: PI_CHECKPOINTS.TARGET, decision: 'APPROVED',
      decidedBy: actor, reason, payload: {},
    }, this.dbPath);
    this.ledgerAppend({
      kind: 'pi_checkpoint', action: 'approve_target',
      detail: { session_id: sessionId, actor, work_order_id: session.work_order_id },
    });
    return updated;
  }

  markReportSigned(sessionId, {
    receiptId = null, deliveryGrade = DELIVERY_GRADES.STANDARD, override = false, actor = null, comment = '',
  } = {}) {
    const session = getSession(sessionId, this.dbPath);
    if (!session) throw new Error(`Pi 会话不存在: ${sessionId}`);
    if (session.status !== PI_SESSION_STATUS.TARGET_APPROVED) {
      const err = new Error(`INVALID_STATE_TRANSITION: 签发报告前必须已完成检查点二批准（当前 ${session.status}）`);
      err.code = 'INVALID_STATE_TRANSITION';
      throw err;
    }
    if (!Object.values(DELIVERY_GRADES).includes(deliveryGrade)) {
      const err = new Error(`INVALID_DELIVERY_GRADE: ${JSON.stringify(deliveryGrade)}`);
      err.code = 'INVALID_DELIVERY_GRADE';
      throw err;
    }
    // 终审红线 2：统计降级报告禁止走常规签名通道，必须人工特批。
    if (deliveryGrade === DELIVERY_GRADES.DEGRADED && override !== true) {
      const err = new Error(
        'ERR_DEGRADED_STATS_REQUIRE_OVERRIDE: 统计降级报告只能走「探索版特批签发」，'
        + '不得进入常规 Ed25519 标准签名通道',
      );
      err.code = 'ERR_DEGRADED_STATS_REQUIRE_OVERRIDE';
      throw err;
    }
    if (deliveryGrade === DELIVERY_GRADES.DEGRADED && (!actor || String(actor).trim() === '')) {
      const err = new Error('CHECKPOINT_ACTOR_REQUIRED: 探索版特批必须留下 actor');
      err.code = 'CHECKPOINT_ACTOR_REQUIRED';
      throw err;
    }
    if (deliveryGrade === DELIVERY_GRADES.DEGRADED && String(comment || '').trim().length < 10) {
      const err = new Error('CHECKPOINT_REASON_REQUIRED: 探索版特批必须写不少于 10 字批注');
      err.code = 'CHECKPOINT_REASON_REQUIRED';
      throw err;
    }
    return updateSession(sessionId, {
      status: PI_SESSION_STATUS.REPORT_SIGNED,
      context: {
        report_signed_at: new Date().toISOString(),
        receipt_id: receiptId,
        delivery_grade: deliveryGrade,
        ...(deliveryGrade === DELIVERY_GRADES.DEGRADED
          ? { degraded_override_by: actor, degraded_override_comment: String(comment).slice(0, 1000), exploratory_disclaimer_required: true }
          : {}),
      },
    }, this.dbPath);
  }

  /** 受控工具调用：所有调用都必须经过闸门，越权记台账后抛出。 */
  async invokeTool(sessionId, toolName, params = {}) {
    const started = Date.now();
    assertToolAllowed(toolName);
    if (!this.toolsBridge) {
      throw new Error('PI_BRIDGE_MISSING: 监督器未接入工具桥（fail-closed）');
    }
    const session = getSession(sessionId, this.dbPath);
    if (!session) throw new Error(`Pi 会话不存在: ${sessionId}`);
    try {
      const result = await this.toolsBridge.invoke(toolName, params);
      recordToolCall({ sessionId, toolName, ok: true, durationMs: Date.now() - started }, this.dbPath);
      updateSession(sessionId, { toolCallCount: session.tool_call_count + 1 }, this.dbPath);
      return result;
    } catch (error) {
      recordToolCall({
        sessionId, toolName, ok: false, errorCode: error.code || 'UNKNOWN',
        durationMs: Date.now() - started,
      }, this.dbPath);
      throw error;
    }
  }

  /** 重启后可恢复的会话清单：只回"卡在哪一步"，不回全量上下文。 */
  resumableSessions() {
    return listSessions(this.dbPath, 200)
      .filter((s) => s.status !== PI_SESSION_STATUS.REPORT_SIGNED && s.status !== PI_SESSION_STATUS.FAILED)
      .map((s) => ({
        session_id: s.session_id,
        work_order_id: s.work_order_id,
        project_id: s.project_id,
        line_id: s.line_id,
        status: s.status,
        state_version: s.state_version,
        context: s.context,
        current_checkpoint: s.current_checkpoint,
        tool_call_count: s.tool_call_count,
        updated_at: s.updated_at,
      }));
  }
}

/** 供 tools_manifest.json 校验使用：运行时白名单真源。 */
export function allowedToolNames() {
  return [...ALLOWED_TOOL_NAMES];
}
