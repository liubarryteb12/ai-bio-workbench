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

import {
  createWorkOrder,
  enqueueWorkOrder,
  executeWorkOrderById,
  getReceipt,
  getWorkOrderMeta,
  recoverInterruptedRunning,
} from '../server/services/work_order.service.js';
import {
  computeWorkOrderDigest, createReceiptV1, updateReceiptStatus, writeReceiptV1Atomic,
} from '../server/receipt_v1.js';

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
        domain: 'cardiovascular',
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
