/**
 * Pi 单步调度器（D4.9 生产接线核心，Gemini Argon 判决）。
 *
 * 职责：
 *   1. 单步互斥锁 step_lock：验证与生产共用同一把锁，容器内只允许一个活跃进程组。
 *   2. 退出码收敛：Exit 5 环境限流退避；137 OOM 消耗适配预算；缺 WROTE 按静默失败。
 *   3. meta 溯源字段：adaptation_epoch、step_attempts、env_throttle_retries。
 *
 * 执行器由外部注入（prepareTaskFn / runTaskFn），本模块不直接起进程，
 * 保持与 run.js 的 11 层判定链同一入口。
 */
import fs from 'node:fs';
import path from 'node:path';

import { atomicWriteFileSync } from '../atomic_write.js';

export const PI_DISPATCH_ERROR_CODES = Object.freeze({
  STEP_LOCKED: 'ERR_STEP_LOCKED',
  LEASE_REQUIRED: 'ERR_AUTHORITY_REQUIRED',
  BUDGET_EXHAUSTED: 'ERR_ADAPTATION_BUDGET_EXHAUSTED',
  RUNNER_MISSING: 'ERR_STEP_RUNNER_MISSING',
});

const STEP_LOCK_TTL_MS = 15 * 60 * 1000;
const ENV_THROTTLE_DELAYS_MS = Object.freeze([30_000, 60_000, 120_000]);

function metaFile(baseDir, projectId, workOrderId) {
  return path.join(baseDir, 'workspace', 'projects', String(projectId), 'work_orders', `${workOrderId}.meta.json`);
}

export function readWorkOrderMeta(baseDir, projectId, workOrderId) {
  const file = metaFile(baseDir, projectId, workOrderId);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeWorkOrderMeta(baseDir, projectId, workOrderId, meta) {
  const file = metaFile(baseDir, projectId, workOrderId);
  atomicWriteFileSync(file, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  return meta;
}

/** 解析工单上下文：workOrderId 缺省时取该项目最新 running 单。 */
export function resolveWorkOrderContext(baseDir, projectId, workOrderId = null) {
  const dir = path.join(baseDir, 'workspace', 'projects', String(projectId), 'work_orders');
  let id = workOrderId ? String(workOrderId) : null;
  if (!id) {
    let entries = [];
    try { entries = fs.readdirSync(dir).filter((name) => name.endsWith('.meta.json')); } catch { entries = []; }
    const candidates = entries.map((name) => {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        return { id: name.replace(/\.meta\.json$/, ''), status: meta.status, updated_at: meta.updated_at || '' };
      } catch { return null; }
    }).filter(Boolean);
    const running = candidates.filter((item) => item.status === 'running')
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    id = (running[0] || candidates.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0])?.id || null;
  }
  if (!id) {
    const err = new Error(`找不到项目 ${projectId} 的工单上下文`);
    err.code = 'ERR_WORK_ORDER_NOT_FOUND';
    throw err;
  }
  const meta = readWorkOrderMeta(baseDir, projectId, id);
  return { workOrderId: id, meta, lineId: meta.line_id };
}

/** 原子获取单步锁；锁未过期且被他人持有则拒绝。 */
export function acquireStepLock(meta, { modId, leaseId, kind, now = Date.now() }) {
  const lock = meta.step_lock;
  if (lock && lock.locked === true) {
    const age = now - Number(lock.acquired_at_ms || 0);
    if (age < STEP_LOCK_TTL_MS) {
      const err = new Error(`${PI_DISPATCH_ERROR_CODES.STEP_LOCKED}: ${lock.kind || 'step'} 正在执行（${lock.mod_id}）`);
      err.code = PI_DISPATCH_ERROR_CODES.STEP_LOCKED;
      throw err;
    }
  }
  return {
    ...meta,
    step_lock: {
      locked: true,
      mod_id: String(modId),
      holder_lease_id: String(leaseId),
      kind: String(kind || 'step'),
      acquired_at_ms: now,
    },
    adaptation_epoch: Number(meta.adaptation_epoch || 0),
    step_attempts: { ...(meta.step_attempts || {}) },
    env_throttle_retries: Number(meta.env_throttle_retries || 0),
  };
}

export function releaseStepLock(meta) {
  return { ...meta, step_lock: { locked: false, mod_id: null, holder_lease_id: null, kind: null, acquired_at_ms: null } };
}

/**
 * 退出码收敛矩阵（Gemini 第四轮裁定）。
 * wroteCount/wroteBytes 来自 run.js 的 WROTE 解析结果。
 */
export function classifyStepOutcome({ exitCode, wroteCount = 0, wroteBytes = 0 } = {}) {
  if (exitCode === 5) {
    return { kind: 'ENV_THROTTLED', consumeBudget: false, terminalStatus: null, code: 'DEVICE_OVERHEAT_OR_BUSY' };
  }
  if (exitCode === 137) {
    return { kind: 'STEP_OOM', consumeBudget: true, terminalStatus: null, code: 'OOM_6.5G_LIMIT' };
  }
  if (exitCode !== 0) {
    return { kind: 'FATAL_EXEC_ERROR', consumeBudget: false, terminalStatus: 'failed', code: 'FATAL_EXEC_ERROR' };
  }
  if (!wroteCount || wroteBytes <= 0) {
    return { kind: 'SILENT_EMPTY_OUTPUT', consumeBudget: true, terminalStatus: null, code: 'CONTRACT_WROTE_MISSING' };
  }
  return { kind: 'STEP_OK', consumeBudget: false, terminalStatus: 'completed', code: 'STEP_OK' };
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 创建调度器。runTaskFn 必须返回 { exitCode, wroteCount, wroteBytes, durationSec, peakMemoryGb }。
 */
export function createPiStepDispatcher({
  baseDir,
  assertLease,
  runTaskFn,
  heartbeatFn = () => {},
  ledgerAppend = () => {},
  sleep = defaultSleep,
  now = () => Date.now(),
  maxEpoch = 2,
} = {}) {
  if (!baseDir || !assertLease || !runTaskFn) {
    throw new Error('调度器缺少必填依赖：baseDir / assertLease / runTaskFn');
  }

  function assertLeaseOrThrow(leaseId) {
    const verdict = assertLease(leaseId);
    if (!verdict || verdict.ok !== true) {
      const err = new Error(`${PI_DISPATCH_ERROR_CODES.LEASE_REQUIRED}: ${verdict?.code || 'ERR_AUTHORITY_REQUIRED'}`);
      err.code = PI_DISPATCH_ERROR_CODES.LEASE_REQUIRED;
      throw err;
    }
  }

  async function withStepLock({ projectId, workOrderId, modId, leaseId, kind }, fn) {
    const meta = readWorkOrderMeta(baseDir, projectId, workOrderId);
    const locked = acquireStepLock(meta, { modId, leaseId, kind, now: now() });
    writeWorkOrderMeta(baseDir, projectId, workOrderId, locked);
    try {
      return await fn(locked);
    } finally {
      const current = readWorkOrderMeta(baseDir, projectId, workOrderId);
      writeWorkOrderMeta(baseDir, projectId, workOrderId, releaseStepLock(current));
    }
  }

  async function runValidation({ workOrderId = null, projectId, modId, entryPoint, scriptPath, memoryGb = 3.5, timeoutSec = 180, leaseId }) {
    assertLeaseOrThrow(leaseId);
    const context = resolveWorkOrderContext(baseDir, projectId, workOrderId);
    const seed = Number(context.meta?.seed || 20261013);
    return withStepLock({ projectId, workOrderId: context.workOrderId, modId, leaseId, kind: 'validation' }, async () => {
      const result = await runTaskFn({
        mode: 'validation',
        workOrderId: context.workOrderId,
        projectId,
        lineId: context.lineId,
        modId,
        entryPoint,
        scriptPath,
        memoryGb,
        timeoutSec,
        leaseId,
        seed,
      });
      const outcome = classifyStepOutcome(result);
      ledgerAppend({
        kind: 'pi_validation_run',
        action: 'run_validation',
        detail: { work_order_id: context.workOrderId, project_id: projectId, mod_id: modId, entry_point: entryPoint, ...outcome, ...result },
      });
      return { ...result, verdict: outcome.kind === 'STEP_OK' ? 'VERIFIED_OK' : 'VERIFIED_FAILED', kind: outcome.kind };
    });
  }

  async function dispatchStep({ workOrderId = null, projectId, modId, entryPoint, leaseId, scriptSha256, validationRunId = null }) {
    assertLeaseOrThrow(leaseId);
    const context = resolveWorkOrderContext(baseDir, projectId, workOrderId);
    const seed = Number(context.meta?.seed || 20261013);
    return withStepLock({ projectId, workOrderId: context.workOrderId, modId, leaseId, kind: 'step' }, async (meta) => {
      let attemptMeta = {
        ...meta,
        adaptation_epoch: Number(meta.adaptation_epoch || 0) + 1,
        delivery_grade: 'EXPLORATORY_DEGRADED',
        step_attempts: {
          ...(meta.step_attempts || {}),
          [modId]: Number(meta.step_attempts?.[modId] || 0) + 1,
        },
      };
      writeWorkOrderMeta(baseDir, projectId, context.workOrderId, attemptMeta);

      let lastResult = null;
      for (let throttle = 0; throttle <= ENV_THROTTLE_DELAYS_MS.length; throttle += 1) {
        lastResult = await runTaskFn({
          mode: 'dispatch',
          workOrderId: context.workOrderId,
          projectId,
          lineId: context.lineId,
          modId,
          entryPoint,
          leaseId,
          seed,
          scriptSha256,
          validationRunId,
          adaptationEpoch: attemptMeta.adaptation_epoch,
          attempt: attemptMeta.step_attempts[modId],
        });
        const outcome = classifyStepOutcome(lastResult);
        if (outcome.kind !== 'ENV_THROTTLED') {
          const terminal = decideTerminal(outcome, attemptMeta.adaptation_epoch, maxEpoch, lastResult);
          const nextMeta = {
            ...attemptMeta,
            ...(terminal.status ? { status: terminal.status, updated_at: new Date(now()).toISOString() } : {}),
            ...(terminal.error ? { error: terminal.error } : {}),
            ...(terminal.status ? { finished_at: new Date(now()).toISOString() } : {}),
          };
          writeWorkOrderMeta(baseDir, projectId, context.workOrderId, nextMeta);
          ledgerAppend({
            kind: 'pi_step_dispatch',
            action: 'dispatch_step',
            detail: {
              work_order_id: context.workOrderId, project_id: projectId, mod_id: modId,
              entry_point: entryPoint, lease_id: leaseId, script_sha256: scriptSha256,
              validation_run_id: validationRunId, ...outcome, ...terminal, ...lastResult,
            },
          });
          return {
            ...lastResult,
            kind: outcome.kind,
            code: terminal.code || outcome.code,
            status: terminal.status || (outcome.kind === 'STEP_OK' ? 'completed' : 'retryable'),
            adaptation_epoch: attemptMeta.adaptation_epoch,
            attempt: attemptMeta.step_attempts[modId],
          };
        }
        if (throttle >= ENV_THROTTLE_DELAYS_MS.length) break;
        attemptMeta = {
          ...attemptMeta,
          env_throttle_retries: Number(attemptMeta.env_throttle_retries || 0) + 1,
        };
        writeWorkOrderMeta(baseDir, projectId, context.workOrderId, attemptMeta);
        heartbeatFn();
        await sleep(ENV_THROTTLE_DELAYS_MS[throttle]);
        heartbeatFn();
      }

      const blockedMeta = {
        ...attemptMeta,
        status: 'blocked',
        updated_at: new Date(now()).toISOString(),
        finished_at: new Date(now()).toISOString(),
        error: { code: 'DEVICE_OVERHEAT_OR_BUSY', message: '环境限流重试耗尽，转人工' },
      };
      writeWorkOrderMeta(baseDir, projectId, context.workOrderId, blockedMeta);
      ledgerAppend({
        kind: 'pi_step_dispatch',
        action: 'dispatch_step',
        detail: { work_order_id: context.workOrderId, project_id: projectId, mod_id: modId, entry_point: entryPoint, status: 'blocked', code: 'DEVICE_OVERHEAT_OR_BUSY' },
      });
      return {
        ...lastResult,
        kind: 'ENV_THROTTLED',
        code: 'DEVICE_OVERHEAT_OR_BUSY',
        status: 'blocked',
        adaptation_epoch: attemptMeta.adaptation_epoch,
        attempt: attemptMeta.step_attempts[modId],
      };
    });
  }

  return { runValidation, dispatchStep };
}

function decideTerminal(outcome, epoch, maxEpoch, result) {
  if (outcome.kind === 'STEP_OK') return { status: null, code: outcome.code };
  if (outcome.kind === 'FATAL_EXEC_ERROR') {
    return {
      status: 'failed',
      code: outcome.code,
      error: { code: outcome.code, message: `执行失败（exit ${result?.exitCode}）` },
    };
  }
  if (outcome.kind === 'ENV_THROTTLED') {
    return { status: 'blocked', code: outcome.code, error: { code: outcome.code, message: '环境限流重试耗尽' } };
  }
  if (epoch >= maxEpoch) {
    return {
      status: 'blocked',
      code: outcome.kind === 'STEP_OOM' ? 'OOM_EXHAUSTED' : 'CONTRACT_WROTE_MISSING',
      error: { code: outcome.code, message: '适配预算耗尽，转人工' },
    };
  }
  return { status: null, code: outcome.code };
}
