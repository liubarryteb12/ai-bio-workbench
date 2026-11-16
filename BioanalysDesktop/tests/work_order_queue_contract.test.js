/**
 * 队列受控化契约：重启恢复、单消费者、幂等入队、终态重跑与回执不重复。
 *
 * 判据来自 docs/GOAL_2026-11-11.md 的 T3。
 * 这些用例都是反向可验的：去掉 inflight 或状态判定，单消费者那条会立刻变红。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  createWorkOrder,
  enqueueWorkOrder,
  executeWorkOrderById,
  getReceipt,
  getWorkOrderMeta,
  recoverInterruptedRunning,
  startQueue,
  stopQueue,
} from '../server/services/work_order.service.js';
import {
  computeWorkOrderDigest, createReceiptV1, updateReceiptStatus, writeReceiptV1Atomic,
} from '../server/receipt_v1.js';
import { runWorkOrder } from '../../tools/dev/work_order_orchestrator.mjs';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'work-order-queue-'));
}

function draft(overrides = {}) {
  return {
    schema_version: 'work_order/v2',
    work_order_id: 'WO-Q-001',
    project_id: 'PRJ_Q_ALPHA',
    source_package: {
      package_dir: 'PKG_20261112_010000_q',
      requirement_path: 'PKG_20261112_010000_q/requirement.json',
      manifest_path: 'PKG_20261112_010000_q/package_manifest.json',
    },
    requirement: {
      basicInfo: {
        name: 'Q 契约项目',
        species: 'Homo sapiens',
        domain: '心脑血管',
        dataType: 'microarray',
      },
      dataSource: {
        source: 'GEO',
        dataType: 'microarray',
        sampleCount: 10,
        tissue: 'blood',
        datasets: [{
          gse: 'GSE000000',
          gpl: 'GPL0000',
          role: 'train',
          sampleCount: 10,
          tissue: 'blood',
        }],
      },
      groupingDesign: {
        mode: 'two_group',
        groups: [
          { groupName: 'Control', role: 'reference', sampleIds: ['GSM000001'] },
          { groupName: 'Disease', role: 'disease_stage', sampleIds: ['GSM000002'] },
        ],
        contrasts: [
          { name: 'Disease_vs_Control', case: 'Disease', ctrl: 'Control', isPrimary: true },
        ],
      },
      analysisCutoffs: {
        profile: 'standard',
        use_adj_p: true,
        log2fc_threshold: 1,
        adj_p_threshold: 0.05,
      },
      figure_templates: [],
    },
    inputs: [],
    execution: {
      line_id: 'line1_bulk',
      mod_ids: ['l1_ingest_prep'],
      figure_selections: [],
      seed: 20261112,
      compute_adapter: 'adb',
      allow_ssh: false,
      species_scope: ['Homo sapiens'],
    },
    delivery: {
      profile: 'client_standard',
      report_md: 'Analysis_Report.md',
      report_html: 'Analysis_Report.html',
      delivery_tar_pattern: 'Client_Delivery.tar.gz',
    },
    controls: { require_admin_review: false },
    ...overrides,
  };
}

function metaPath(root, projectId, workOrderId) {
  return path.join(root, 'workspace', 'projects', projectId, 'work_orders', `${workOrderId}.meta.json`);
}

function readMeta(root, projectId, workOrderId) {
  return JSON.parse(fs.readFileSync(metaPath(root, projectId, workOrderId), 'utf8'));
}

function writeMetaRaw(root, projectId, workOrderId, meta) {
  fs.writeFileSync(metaPath(root, projectId, workOrderId), JSON.stringify(meta, null, 2), 'utf8');
}

test('入队：记录 approved_by 与 lease_id，重复入队幂等', () => {
  const root = tempRoot();
  createWorkOrder(draft(), root);
  const actor = { kind: 'ai_assist', id: 'ai-orchestrator', role: 'admin' };

  const first = enqueueWorkOrder('WO-Q-001', root, { approved: true, actor, leaseId: 'AUTH-20261112-0001' });
  assert.equal(first.meta.approved, true);
  assert.deepEqual(first.meta.approved_by, actor);
  assert.equal(first.meta.lease_id, 'AUTH-20261112-0001');
  const approvedAt = first.meta.approved_at;

  const second = enqueueWorkOrder('WO-Q-001', root, { approved: true, actor, leaseId: 'AUTH-20261112-0001' });
  assert.equal(second.meta.approved_at, approvedAt, '重复入队不得改写 approved_at');
  assert.equal(second.status, 'queued');
});

test('终态重跑：completed / failed 一律 409，不产生第二次回执', () => {
  const root = tempRoot();
  createWorkOrder(draft(), root);
  const meta = readMeta(root, 'PRJ_Q_ALPHA', 'WO-Q-001');
  writeMetaRaw(root, 'PRJ_Q_ALPHA', 'WO-Q-001', { ...meta, status: 'completed' });

  assert.throws(
    () => enqueueWorkOrder('WO-Q-001', root, { approved: true }),
    (cause) => cause.code === 'ERR_WORK_ORDER_STATE' && cause.status === 409,
  );
  assert.equal(readMeta(root, 'PRJ_Q_ALPHA', 'WO-Q-001').status, 'completed');
});

test('重启恢复：running 标 failed 并写明 server_restart，queued 原样保留', () => {
  const root = tempRoot();
  createWorkOrder(draft(), root);
  createWorkOrder(draft({ work_order_id: 'WO-Q-002' }), root);

  const running = readMeta(root, 'PRJ_Q_ALPHA', 'WO-Q-001');
  writeMetaRaw(root, 'PRJ_Q_ALPHA', 'WO-Q-001', { ...running, status: 'running', started_at: new Date().toISOString() });

  const recovered = recoverInterruptedRunning(root);
  assert.deepEqual(recovered, ['WO-Q-001']);
  const after = readMeta(root, 'PRJ_Q_ALPHA', 'WO-Q-001');
  assert.equal(after.status, 'failed');
  assert.equal(after.recovery_reason, 'server_restart');
  assert.equal(after.error.code, 'ERR_WORK_ORDER_RECOVERY');
  assert.equal(readMeta(root, 'PRJ_Q_ALPHA', 'WO-Q-002').status, 'queued', 'queued 不得被恢复逻辑吞掉');
});

test('单消费者：同一作业并发执行只有一个进入 running，另一个 409', async () => {
  const root = tempRoot();
  createWorkOrder(draft(), root);

  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let runs = 0;
  const runWorkOrderFn = async () => {
    runs += 1;
    // 用超时兜底：万一防线被拆掉，第二个调用会走到这里并很快返回，
    // 断言立刻变红，而不是把用例挂在未释放的 gate 上。
    await Promise.race([gate, new Promise((resolve) => setTimeout(resolve, 50))]);
    return { ok: true };
  };

  const first = executeWorkOrderById('WO-Q-001', root, { runWorkOrderFn });
  // 第一个调用已在 inflight 里并写入 running，第二个必须被拒。
  const second = await executeWorkOrderById('WO-Q-001', root, { runWorkOrderFn }).catch((cause) => cause);
  assert.equal(second.code, 'ERR_WORK_ORDER_STATE');
  assert.equal(second.status, 409);

  release();
  const done = await first;
  assert.equal(done.meta.status, 'completed');
  assert.equal(runs, 1, '执行体只能被调用一次，否则就是双跑');
});

test('执行失败：meta 收敛 failed，租约与 actor 留痕不丢', async () => {
  const root = tempRoot();
  createWorkOrder(draft(), root);
  const actor = { kind: 'ai_assist', id: 'ai-orchestrator', role: 'admin' };
  enqueueWorkOrder('WO-Q-001', root, { approved: true, actor, leaseId: 'AUTH-20261112-0002' });

  const failed = await executeWorkOrderById('WO-Q-001', root, {
    runWorkOrderFn: async () => {
      const cause = new Error('设备离线');
      cause.code = 'ERR_DEVICE_OFFLINE';
      throw cause;
    },
  }).catch((cause) => cause);
  assert.equal(failed.code, 'ERR_DEVICE_OFFLINE');

  const meta = getWorkOrderMeta('WO-Q-001', root);
  assert.equal(meta.status, 'failed');
  assert.equal(meta.lease_id, 'AUTH-20261112-0002');
  assert.deepEqual(meta.approved_by, actor);
  assert.equal(meta.error.code, 'ERR_DEVICE_OFFLINE');
});

test('同项目多工单：权威回执按工单号各存一份，不互相覆盖', async () => {
  const root = tempRoot();
  const ids = ['WO-Q-MULTI-001', 'WO-Q-MULTI-002'];
  for (const id of ids) createWorkOrder(draft({ work_order_id: id }), root);

  const runWorkOrderFn = async (input) => {
    const projectId = input.projectId || input.project_id;
    const workOrderId = input.workOrderId || input.work_order_id;
    // 模拟编排器：先写项目级回执（会被后一单覆盖），再交给 service 落单工单副本。
    let receipt = createReceiptV1({
      workOrderDigest: computeWorkOrderDigest(draft({ work_order_id: workOrderId })),
      workOrderId,
      projectId,
      lineId: 'line1_bulk',
      startedAt: new Date().toISOString(),
    });
    receipt = updateReceiptStatus(receipt, 'running');
    receipt = updateReceiptStatus(receipt, 'completed', {
      delivery: {
        tar_sha256: 'a'.repeat(64),
        verified_count: 1,
        coverage_ok: true,
        verifier_version: 'test-1.0.0',
      },
    });
    writeReceiptV1Atomic(receipt, path.join(root, 'workspace', 'projects', projectId, 'report', 'receipt.v1.json'));
    return { ok: true, receiptV1: receipt };
  };

  for (const id of ids) {
    await executeWorkOrderById(id, root, { runWorkOrderFn });
  }

  const paths = new Set();
  for (const id of ids) {
    const meta = getWorkOrderMeta(id, root);
    assert.equal(meta.status, 'completed');
    paths.add(meta.receipt_path);
    const receipt = getReceipt(id, root);
    assert.equal(receipt.work_order_id, id, `${id} 必须读回自己的回执`);
  }
  assert.equal(paths.size, 2, '两张工单的回执路径必须不同，不能共用项目级文件');
});

test('T1.7 接线：执行体把主体留痕转发给编排器，回执能区分人类与 AI', async () => {
  const aiActor = { kind: 'ai_assist', id: 'ai-orchestrator', role: 'admin' };
  const humanActor = { kind: 'human', id: 'operator-a', role: 'admin' };

  const captureRunner = (captured) => async (_input, runnerOpts) => {
    captured.value = runnerOpts.actors || null;
    return { ok: true };
  };

  const aiRoot = tempRoot();
  createWorkOrder(draft(), aiRoot);
  enqueueWorkOrder('WO-Q-001', aiRoot, { approved: true, actor: aiActor, leaseId: 'AUTH-20261112-0003' });
  const aiCaptured = { value: null };
  await executeWorkOrderById('WO-Q-001', aiRoot, { runWorkOrderFn: captureRunner(aiCaptured) });
  assert.ok(aiCaptured.value, 'runnerOptions 必须携带 actors 留痕');
  assert.equal(aiCaptured.value.actors.approved_by.kind, 'ai_assist');
  assert.equal(aiCaptured.value.actor_trace[0].action, 'work_order.approved');
  assert.equal(aiCaptured.value.actor_trace[0].lease_id, 'AUTH-20261112-0003');
  assert.equal(aiCaptured.value.actor_trace[1].action, 'work_order.run');

  const humanRoot = tempRoot();
  createWorkOrder(draft(), humanRoot);
  enqueueWorkOrder('WO-Q-001', humanRoot, { approved: true, actor: humanActor, leaseId: 'AUTH-20261112-0004' });
  const humanCaptured = { value: null };
  await executeWorkOrderById('WO-Q-001', humanRoot, { runWorkOrderFn: captureRunner(humanCaptured) });
  assert.equal(humanCaptured.value.actors.approved_by.kind, 'human');
  assert.equal(humanCaptured.value.actor_trace[0].actor.kind, 'human');
});

test('T1.7 编排器：options.actors 进入权威回执，缺省回执不带 actors 字段', async () => {
  const aiActor = { kind: 'ai_assist', id: 'ai-orchestrator', role: 'admin' };
  const withActors = await runWorkOrder({ schema_version: 'bogus/v9' }, {
    actors: {
      actors: { approved_by: aiActor },
      actor_trace: [{
        action: 'work_order.approved',
        actor: aiActor,
        at: '2026-11-15T00:00:00.000Z',
        lease_id: 'AUTH-20261112-0005',
        request_id: null,
      }],
    },
  });
  assert.equal(withActors.receiptV1.actors.approved_by.kind, 'ai_assist');
  assert.equal(withActors.receiptV1.actor_trace[0].lease_id, 'AUTH-20261112-0005');

  const legacy = await runWorkOrder({ schema_version: 'bogus/v9' });
  assert.equal(legacy.receiptV1.actors, undefined);
  assert.equal(legacy.receiptV1.actor_trace, undefined);
});

async function waitForMetaStatus(root, workOrderId, predicate, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const meta = readMeta(root, 'PRJ_Q_ALPHA', workOrderId);
      if (predicate(meta)) return meta;
    } catch {
      // meta 尚未落盘或读取竞态，继续轮询。
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`等待工单 ${workOrderId} 状态超时（${timeoutMs}ms）`);
}

function exitOf(child) {
  return new Promise((resolve) => {
    child.once('exit', resolve);
    child.once('error', resolve);
  });
}

function completedReceiptRunner() {
  return async (input) => {
    let receipt = createReceiptV1({
      workOrderDigest: computeWorkOrderDigest(input ?? {}),
      workOrderId: String(input?.work_order_id || input?.workOrderId || 'WO-UNKNOWN'),
      projectId: String(input?.project_id || input?.projectId || ''),
      lineId: String(input?.execution?.line_id || input?.lineId || ''),
      startedAt: new Date().toISOString(),
      sourceSchemaVersion: 'work_order/v2',
      seed: 20261112,
      computeAdapter: 'adb',
    });
    receipt = updateReceiptStatus(receipt, 'running');
    receipt = updateReceiptStatus(receipt, 'completed', {
      delivery: {
        tar_sha256: 'b'.repeat(64),
        verified_count: 1,
        coverage_ok: true,
        verifier_version: 't3.6-contract',
      },
    });
    return { ok: true, receiptV1: receipt };
  };
}

test('T3.6 验收：kill 执行进程、重启恢复后队列与 receipt.v1 一致，无重复无丢失', async () => {
  const root = tempRoot();
  const ids = ['WO-Q-001', 'WO-Q-002', 'WO-Q-003'];
  for (const id of ids) createWorkOrder(draft({ work_order_id: id }), root);
  const actor = { kind: 'ai_assist', id: 'ai-orchestrator', role: 'admin' };
  for (const id of ids) {
    enqueueWorkOrder(id, root, { approved: true, actor, leaseId: 'AUTH-20261112-0006' });
  }

  // 阶段一：真实子进程执行 WO-Q-001，runner 挂起，确认 running 后 kill，模拟进程中途被杀。
  const helperPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'helpers', 'queue_kill_child.mjs');
  const child = spawn(process.execPath, [helperPath, root, 'WO-Q-001'], { stdio: 'ignore' });
  try {
    await waitForMetaStatus(root, 'WO-Q-001', (meta) => meta.status === 'running');
  } finally {
    child.kill();
    await exitOf(child);
  }

  // kill 后未恢复前：running 挂着，queued 两单必须原样保留（不丢）。
  assert.equal(readMeta(root, 'PRJ_Q_ALPHA', 'WO-Q-002').status, 'queued');
  assert.equal(readMeta(root, 'PRJ_Q_ALPHA', 'WO-Q-003').status, 'queued');

  // 阶段二：重启恢复（running 标 failed）+ 单消费者泵排空剩余队列。
  const recovered = recoverInterruptedRunning(root);
  assert.deepEqual(recovered, ['WO-Q-001']);
  startQueue(root, { runWorkOrderFn: completedReceiptRunner() });
  try {
    await waitForMetaStatus(root, 'WO-Q-002', (meta) => meta.status !== 'queued');
    await waitForMetaStatus(root, 'WO-Q-003', (meta) => meta.status !== 'queued');
  } finally {
    await stopQueue();
  }

  // 恢复语义：被杀单收敛 failed 并写明原因。
  const afterKill = readMeta(root, 'PRJ_Q_ALPHA', 'WO-Q-001');
  assert.equal(afterKill.status, 'failed');
  assert.equal(afterKill.recovery_reason, 'server_restart');

  // 终态重跑被拒：失败单不允许产生第二份回执。
  const rerun = await executeWorkOrderById('WO-Q-001', root, { runWorkOrderFn: completedReceiptRunner() }).catch((cause) => cause);
  assert.equal(rerun.code, 'ERR_WORK_ORDER_STATE');
  assert.equal(rerun.status, 409);

  // 无丢失：三单都在且终态齐全。
  assert.equal(readMeta(root, 'PRJ_Q_ALPHA', 'WO-Q-002').status, 'completed');
  assert.equal(readMeta(root, 'PRJ_Q_ALPHA', 'WO-Q-003').status, 'completed');

  // 回执一致：每张完成单恰好一份专属回执，回执 id 与 meta 记录吻合；失败单没有回执。
  const workOrdersDir = path.join(root, 'workspace', 'projects', 'PRJ_Q_ALPHA', 'work_orders');
  const receiptFiles = fs.readdirSync(workOrdersDir).filter((name) => name.endsWith('.receipt.v1.json')).sort();
  assert.deepEqual(receiptFiles, ['WO-Q-002.receipt.v1.json', 'WO-Q-003.receipt.v1.json']);
  for (const id of ['WO-Q-002', 'WO-Q-003']) {
    const receipt = getReceipt(id, root);
    assert.equal(receipt.status, 'completed');
    assert.equal(receipt.work_order_id, id);
    assert.equal(readMeta(root, 'PRJ_Q_ALPHA', id).receipt_id, receipt.receipt_id);
  }
});
