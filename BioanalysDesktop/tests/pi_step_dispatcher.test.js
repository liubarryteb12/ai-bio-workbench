/**
 * D4.9 单步调度器契约测试（Gemini Argon 第四轮判决）。
 *
 * 判据：
 *   1. step_lock 互斥：验证与生产共用一把锁。
 *   2. 退出码矩阵：Exit 5 退避、137 OOM、静默 WROTE 缺失、普通失败。
 *   3. adaptation_epoch 与 step_attempts 递增，预算耗尽转 blocked。
 *   4. Exit 5 冷却期间心跳照常。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  classifyStepOutcome,
  createPiStepDispatcher,
  readWorkOrderMeta,
  acquireStepLock,
} from '../server/services/pi_step_dispatcher.js';

function setupMeta(t, overrides = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dispatch-'));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const dir = path.join(baseDir, 'workspace', 'projects', 'PRJ_D', 'work_orders');
  fs.mkdirSync(dir, { recursive: true });
  const meta = {
    status: 'running', work_order_id: 'WO_D', project_id: 'PRJ_D', line_id: 'line1_bulk',
    adaptation_epoch: 0, step_attempts: {}, env_throttle_retries: 0,
    ...overrides,
  };
  fs.writeFileSync(path.join(dir, 'WO_D.meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  return { baseDir, meta };
}

const okLease = () => ({ ok: true });

test('退出码矩阵：5/137/0/其他/静默空文件', () => {
  assert.equal(classifyStepOutcome({ exitCode: 5 }).kind, 'ENV_THROTTLED');
  assert.equal(classifyStepOutcome({ exitCode: 137 }).kind, 'STEP_OOM');
  assert.equal(classifyStepOutcome({ exitCode: 1 }).kind, 'FATAL_EXEC_ERROR');
  assert.equal(classifyStepOutcome({ exitCode: 0, wroteCount: 0 }).kind, 'SILENT_EMPTY_OUTPUT');
  assert.equal(classifyStepOutcome({ exitCode: 0, wroteCount: 1, wroteBytes: 0 }).kind, 'SILENT_EMPTY_OUTPUT');
  assert.equal(classifyStepOutcome({ exitCode: 0, wroteCount: 1, wroteBytes: 12 }).kind, 'STEP_OK');
});

test('step_lock 互斥：验证持锁时生产单步被拒', async (t) => {
  const { baseDir } = setupMeta(t);
  let releaseValidation;
  const validationGate = new Promise((resolve) => { releaseValidation = resolve; });
  const dispatcher = createPiStepDispatcher({
    baseDir,
    assertLease: okLease,
    runTaskFn: async ({ mode }) => {
      if (mode === 'validation') await validationGate;
      return { exitCode: 0, wroteCount: 1, wroteBytes: 10, durationSec: 1, peakMemoryGb: 0.5 };
    },
  });
  const validation = dispatcher.runValidation({
    workOrderId: 'WO_D', projectId: 'PRJ_D', modId: 'l1_qc_matrix',
    entryPoint: 'adapt_1.R', scriptPath: '/tmp/a.R', leaseId: 'L1',
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  await assert.rejects(
    () => dispatcher.dispatchStep({
      workOrderId: 'WO_D', projectId: 'PRJ_D', modId: 'l1_qc_matrix',
      entryPoint: 'adapt_2.R', leaseId: 'L2',
    }),
    (err) => err.code === 'ERR_STEP_LOCKED',
  );
  releaseValidation();
  const result = await validation;
  assert.equal(result.verdict, 'VERIFIED_OK');
  assert.equal(readWorkOrderMeta(baseDir, 'PRJ_D', 'WO_D').step_lock.locked, false);
});

test('dispatch 成功：epoch 与 attempt 递增，锁释放，不写终态', async (t) => {
  const { baseDir } = setupMeta(t);
  const dispatcher = createPiStepDispatcher({
    baseDir,
    assertLease: okLease,
    runTaskFn: async () => ({ exitCode: 0, wroteCount: 2, wroteBytes: 100, durationSec: 3, peakMemoryGb: 1.2 }),
  });
  const result = await dispatcher.dispatchStep({
    workOrderId: 'WO_D', projectId: 'PRJ_D', modId: 'l1_de_limma',
    entryPoint: 'adapt_3.R', leaseId: 'L1',
  });
  assert.equal(result.kind, 'STEP_OK');
  assert.equal(result.adaptation_epoch, 1);
  assert.equal(result.attempt, 1);
  const meta = readWorkOrderMeta(baseDir, 'PRJ_D', 'WO_D');
  assert.equal(meta.adaptation_epoch, 1);
  assert.equal(meta.step_attempts['l1_de_limma'], 1);
  assert.equal(meta.step_lock.locked, false);
  assert.equal(meta.status, 'running');
});

test('OOM：epoch 未满 2 保持可重试，满 2 转 blocked OOM_EXHAUSTED', async (t) => {
  const { baseDir } = setupMeta(t);
  const dispatcher = createPiStepDispatcher({
    baseDir,
    assertLease: okLease,
    runTaskFn: async () => ({ exitCode: 137, wroteCount: 0, wroteBytes: 0, durationSec: 5, peakMemoryGb: 6.9 }),
  });
  const first = await dispatcher.dispatchStep({
    workOrderId: 'WO_D', projectId: 'PRJ_D', modId: 'l1_de_limma', entryPoint: 'adapt_4.R', leaseId: 'L1',
  });
  assert.equal(first.status, 'retryable');
  assert.equal(first.kind, 'STEP_OOM');

  const second = await dispatcher.dispatchStep({
    workOrderId: 'WO_D', projectId: 'PRJ_D', modId: 'l1_de_limma', entryPoint: 'adapt_4.R', leaseId: 'L1',
  });
  assert.equal(second.status, 'blocked');
  assert.equal(second.code, 'OOM_EXHAUSTED');
  assert.equal(readWorkOrderMeta(baseDir, 'PRJ_D', 'WO_D').status, 'blocked');
});

test('Exit 5：退避重试 3 次后 blocked，期间心跳持续', async (t) => {
  const { baseDir } = setupMeta(t);
  const sleeps = [];
  let heartbeats = 0;
  let runs = 0;
  const dispatcher = createPiStepDispatcher({
    baseDir,
    assertLease: okLease,
    runTaskFn: async () => { runs += 1; return { exitCode: 5, wroteCount: 0, wroteBytes: 0 }; },
    sleep: async (ms) => { sleeps.push(ms); },
    heartbeatFn: () => { heartbeats += 1; },
    maxEpoch: 2,
  });
  const result = await dispatcher.dispatchStep({
    workOrderId: 'WO_D', projectId: 'PRJ_D', modId: 'l1_qc_matrix', entryPoint: 'adapt_5.R', leaseId: 'L1',
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'DEVICE_OVERHEAT_OR_BUSY');
  assert.deepEqual(sleeps, [30_000, 60_000, 120_000]);
  assert.equal(runs, 4);
  assert.ok(heartbeats >= 6, '冷却期间心跳必须持续');
});

test('静默空文件：epoch 满 2 转 blocked CONTRACT_WROTE_MISSING', async (t) => {
  const { baseDir } = setupMeta(t, { adaptation_epoch: 1 });
  const dispatcher = createPiStepDispatcher({
    baseDir,
    assertLease: okLease,
    runTaskFn: async () => ({ exitCode: 0, wroteCount: 0, wroteBytes: 0 }),
  });
  const result = await dispatcher.dispatchStep({
    workOrderId: 'WO_D', projectId: 'PRJ_D', modId: 'l1_qc_matrix', entryPoint: 'adapt_6.R', leaseId: 'L1',
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'CONTRACT_WROTE_MISSING');
});

test('acquireStepLock：未过期锁拒绝，过期锁可接管', () => {
  const meta = {
    step_lock: { locked: true, mod_id: 'm', holder_lease_id: 'L1', kind: 'step', acquired_at_ms: 1000 },
  };
  assert.throws(
    () => acquireStepLock(meta, { modId: 'm2', leaseId: 'L2', kind: 'step', now: 2000 }),
    (err) => err.code === 'ERR_STEP_LOCKED',
  );
  const reclaimed = acquireStepLock(meta, { modId: 'm2', leaseId: 'L2', kind: 'step', now: 1000 + 16 * 60 * 1000 });
  assert.equal(reclaimed.step_lock.holder_lease_id, 'L2');
});
