/**
 * T3 统一回执 receipt/v1 契约测试
 *
 * 守六件事：
 *   1. 骨架字段、稳定 receipt_id 与工单摘要确定。
 *   2. 五态状态机，终态不可逆，非法转移抛错。
 *   3. 原子写后读回一致，失败不留半截文件，产物路径拒绝绝对路径。
 *   4. 旧 work_order.receipt.json 由权威回执投影，成功哨兵与失败形态保持兼容。
 *   5. runWorkOrder 成功时权威回执与旧投影同时落盘，正文不含设施路径。
 *   6. runWorkOrder 失败与校验失败时权威回执落盘，旧文件不写。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

import {
  RECEIPT_V1_SCHEMA_VERSION,
  RECEIPT_V1_SENTINEL,
  buildOldReceiptProjection,
  computeWorkOrderDigest,
  createReceiptV1,
  updateReceiptStatus,
  writeReceiptV1Atomic,
} from '../server/receipt_v1.js';
import {
  WORK_ORDER_SCHEMA_VERSION,
  compileWorkOrderPlan,
  runWorkOrder,
} from '../../tools/dev/work_order_orchestrator.mjs';

const DIGEST = 'a'.repeat(64);
const STARTED_AT = '2026-11-10T00:00:00.000Z';
const FINISHED_AT = '2026-11-10T00:10:00.000Z';

function baseReceipt(extra = {}) {
  return createReceiptV1({
    workOrderDigest: DIGEST,
    workOrderId: 'WO-RECEIPT-001',
    projectId: 'PRJ_RECEIPT_001',
    lineId: 'line1_bulk',
    startedAt: STARTED_AT,
    sourceSchemaVersion: WORK_ORDER_SCHEMA_VERSION,
    ...extra,
  });
}

function completedReceipt() {
  const running = updateReceiptStatus(baseReceipt(), 'running');
  return updateReceiptStatus(running, 'completed', {
    finished_at: FINISHED_AT,
    stages: [{ name: 'validate', status: 'passed', at: STARTED_AT }],
    upload_receipts: [{ filename: 'matrix.tsv', bytes: 12, sha256: 'b'.repeat(64), sizeMatch: true }],
    task_receipts: [{ step: 'qc_matrix', status: 'passed' }],
    acceptance: { sentinel: 'DELIVERY_ACCEPTANCE_OK 四道关全绿', verified_count: 3 },
    delivery: {
      receipt_path: 'workspace/projects/PRJ_RECEIPT_001/deliverables/acceptance/PRJ_RECEIPT_001.receipt.json',
      tar_sha256: 'c'.repeat(64),
      verified_count: 3,
      coverage_ok: true,
      verifier_version: 'v1',
    },
    summary: { work_order_id: 'WO-RECEIPT-001', status: 'completed' },
  });
}

test('createReceiptV1：骨架字段齐全，receipt_id 与摘要稳定', () => {
  const receipt = baseReceipt();
  const expectedId = createHash('sha256')
    .update(`${DIGEST}${STARTED_AT}`)
    .digest('hex')
    .slice(0, 24);

  assert.equal(receipt.schema_version, RECEIPT_V1_SCHEMA_VERSION);
  assert.equal(receipt.receipt_id, expectedId);
  assert.equal(receipt.work_order_digest, DIGEST);
  assert.equal(receipt.work_order_id, 'WO-RECEIPT-001');
  assert.equal(receipt.project_id, 'PRJ_RECEIPT_001');
  assert.equal(receipt.line_id, 'line1_bulk');
  assert.equal(receipt.status, 'queued');
  assert.equal(receipt.started_at, STARTED_AT);
  assert.equal(receipt.finished_at, null);
  assert.equal(receipt.failure_stage, null);
  assert.deepEqual(receipt.stages, []);
  assert.deepEqual(receipt.artifacts, []);
  assert.equal(receipt.sentinel, null);
  assert.equal(typeof receipt.producer.name, 'string');
  assert.equal(typeof receipt.producer.version, 'string');
});

test('updateReceiptStatus：五态转移矩阵，终态不可逆', () => {
  const queued = baseReceipt();
  const running = updateReceiptStatus(queued, 'running');
  assert.equal(running.status, 'running');
  assert.equal(running.finished_at, null);

  const completed = updateReceiptStatus(running, 'completed', {
    finished_at: FINISHED_AT,
    stages: [{ name: 'acceptance', status: 'passed' }],
  });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.finished_at, FINISHED_AT);
  assert.equal(completed.sentinel, RECEIPT_V1_SENTINEL);
  assert.equal(completed.failure_stage, null);
  assert.equal(completed.stages.length, 1);

  const failed = updateReceiptStatus(running, 'failed', {
    finished_at: FINISHED_AT,
    failure_stage: 'task_dispatch',
    error: { code: 'ERR_TASK_RECEIPT', message: '完成回执不完整' },
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failure_stage, 'task_dispatch');
  assert.equal(failed.error.code, 'ERR_TASK_RECEIPT');
  assert.equal(failed.sentinel, null);

  const blocked = updateReceiptStatus(queued, 'blocked', {
    failure_stage: 'uploads',
    error: { code: 'ERR_INPUT_FILE', message: '输入文件缺失' },
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.failure_stage, 'uploads');

  assert.throws(
    () => updateReceiptStatus(completed, 'running'),
    (cause) => cause.code === 'ERR_RECEIPT_TERMINAL',
  );
  assert.throws(
    () => updateReceiptStatus(failed, 'completed'),
    (cause) => cause.code === 'ERR_RECEIPT_TERMINAL',
  );
  assert.throws(
    () => updateReceiptStatus(blocked, 'running'),
    (cause) => cause.code === 'ERR_RECEIPT_TERMINAL',
  );
  assert.throws(
    () => updateReceiptStatus(queued, 'completed'),
    (cause) => cause.code === 'ERR_RECEIPT_TRANSITION',
  );
  assert.throws(
    () => updateReceiptStatus(queued, 'unknown'),
    (cause) => cause.code === 'ERR_RECEIPT_STATUS',
  );
  assert.doesNotThrow(() => updateReceiptStatus(completed, 'completed'));
});

test('computeWorkOrderDigest：键序无关，数组序有关，值变即变', () => {
  const left = { b: 2, a: { d: 4, c: 3 }, list: [1, 2] };
  const right = { a: { c: 3, d: 4 }, list: [1, 2], b: 2 };
  const reorderedArray = { a: { c: 3, d: 4 }, list: [2, 1], b: 2 };
  const changedValue = { a: { c: 3, d: 4 }, list: [1, 2], b: 3 };

  assert.equal(computeWorkOrderDigest(left), computeWorkOrderDigest(left));
  assert.equal(computeWorkOrderDigest(left), computeWorkOrderDigest(right));
  assert.notEqual(computeWorkOrderDigest(left), computeWorkOrderDigest(reorderedArray));
  assert.notEqual(computeWorkOrderDigest(left), computeWorkOrderDigest(changedValue));
  assert.match(computeWorkOrderDigest(left), /^[0-9a-f]{64}$/);
});

test('writeReceiptV1Atomic：原子写后读回一致，拒绝绝对产物路径', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `receipt-v1-${process.pid}-`));
  try {
    const receipt = completedReceipt();
    receipt.artifacts = [{
      path: 'workspace/projects/PRJ_RECEIPT_001/report/Project_Summary.md',
      role: 'project_summary',
      bytes: 12,
      sha256: 'd'.repeat(64),
      stage: 'report_build',
    }];
    const file = path.join(root, 'nested', 'receipt.v1.json');
    writeReceiptV1Atomic(receipt, file);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), receipt);
    const leftovers = fs.readdirSync(path.dirname(file)).filter((name) => name.startsWith('.tmp.'));
    assert.deepEqual(leftovers, []);

    const badPaths = ['C:\\secret\\receipt.json', '/mnt/ssd/receipt.json', '../receipt.json'];
    for (const [index, badPath] of badPaths.entries()) {
      const bad = completedReceipt();
      bad.artifacts = [{ path: badPath, role: 'bad', bytes: 1, sha256: null, stage: 'report_build' }];
      const target = path.join(root, `bad-${index}.json`);
      assert.throws(
        () => writeReceiptV1Atomic(bad, target),
        (cause) => cause.code === 'ERR_RECEIPT_ARTIFACT_PATH',
      );
      assert.equal(fs.existsSync(target), false);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('buildOldReceiptProjection：成功带哨兵，失败只留最小形态', () => {
  const completed = completedReceipt();
  completed.artifacts = [
    { path: 'workspace/projects/PRJ_RECEIPT_001/report/Project_Summary.md', role: 'project_summary', bytes: 12, sha256: 'd'.repeat(64), stage: 'report_build' },
    { path: 'workspace/projects/PRJ_RECEIPT_001/report/work_order.receipt.json', role: 'work_order_receipt', bytes: 34, sha256: 'e'.repeat(64), stage: 'report_build' },
  ];
  const old = buildOldReceiptProjection(completed);
  assert.equal(old.schema_version, WORK_ORDER_SCHEMA_VERSION);
  assert.equal(old.ok, true);
  assert.equal(old.status, 'completed');
  assert.equal(old.sentinel, 'WORK_ORDER_ORCHESTRATOR_OK');
  assert.equal(old.work_order_id, 'WO-RECEIPT-001');
  assert.equal(old.artifacts.project_summary, 'workspace/projects/PRJ_RECEIPT_001/report/Project_Summary.md');
  assert.equal(old.artifacts.work_order_receipt, 'workspace/projects/PRJ_RECEIPT_001/report/work_order.receipt.json');

  const failed = updateReceiptStatus(baseReceipt(), 'failed', {
    finished_at: FINISHED_AT,
    failure_stage: 'validate',
    error: { code: 'ERR_VALIDATE', message: '工单非法' },
    stages: [{ name: 'validate', status: 'failed' }],
  });
  const oldFailed = buildOldReceiptProjection(failed);
  assert.deepEqual(Object.keys(oldFailed).sort(), ['at', 'code', 'error', 'ok', 'stages', 'status']);
  assert.equal(oldFailed.ok, false);
  assert.equal(oldFailed.status, 'failed');
  assert.equal(oldFailed.code, 'ERR_VALIDATE');
  assert.equal(Object.hasOwn(oldFailed, 'sentinel'), false);
});

function syntheticFacts() {
  const stages = [
    {
      id: 'ingest', order: 1, required: true,
      mods: [{
        id: 'l1_ingest_prep', script: 'prep_matrix', language: 'R',
        requires: ['series_matrix'], produces: ['expr_genes.tsv'],
      }],
    },
    {
      id: 'qc', order: 2, required: false,
      mods: [{
        id: 'l1_qc_matrix', script: 'qc_matrix', language: 'R',
        requires: ['expr_genes.tsv'], produces: ['qc_report.tsv'],
      }],
    },
  ];
  const registry = { series: new Map(), mods: new Map(), readyFigures: new Map(), allowedIds: new Set() };
  const orderedMods = [];
  for (const stage of stages) {
    for (const mod of stage.mods) {
      const entry = {
        id: mod.id, mod, seriesId: 'line1_bulk', stageId: stage.id,
        order: stage.order, required: stage.required, optional: false,
      };
      registry.mods.set(mod.id, entry);
      orderedMods.push(entry);
    }
  }
  registry.series.set('line1_bulk', {
    series: { id: 'line1_bulk', seed: 20261013 }, stages, orderedMods, seed: 20261013,
  });
  return registry;
}

function baseOrder(extra = {}) {
  return {
    schema_version: WORK_ORDER_SCHEMA_VERSION,
    workOrderId: 'WO-RECEIPT-001',
    projectId: 'PRJ_RECEIPT_001',
    lineId: 'line1_bulk',
    modIds: ['l1_qc_matrix'],
    figureSelections: [],
    uploads: [{ filename: 'matrix.tsv', content_base64: Buffer.from('gene\tvalue\nA\t1\n').toString('base64') }],
    ...extra,
  };
}

function ledgerEntry(stepName, outputs, seed = 20261013) {
  return {
    project_id: 'PRJ_RECEIPT_001',
    line_id: 'line1_bulk',
    step_name: stepName,
    status: 'completed',
    exit_code: 0,
    environment: { random_seed: seed },
    ledger_receipt: 'confirmed',
    io_files: {
      input: ['/mnt/ssd/bio_data/projects/PRJ_RECEIPT_001/line1_bulk/raw/expr_genes.tsv'],
      output: outputs.map((name) => `/mnt/ssd/bio_data/projects/PRJ_RECEIPT_001/line1_bulk/results/${name}`),
    },
    end_time: '2026-11-10T00:05:00.000Z',
  };
}

function makeRequest(order, options = {}) {
  const facts = syntheticFacts();
  const plan = compileWorkOrderPlan(order, { facts });
  const state = { calls: [], ledger: [], failTask: options.failTask || null };
  const ok = (payload) => ({ status: 200, ok: true, body: payload });
  const request = async (method, requestPath, body) => {
    state.calls.push({ method, path: requestPath, body });
    if (requestPath === '/api/projects/create') return ok({ ok: true, projectId: plan.projectId });
    if (requestPath === '/api/upload/init') return ok({ uploadId: `up-${state.calls.length}`, chunkSize: 1048576 });
    if (requestPath.startsWith('/api/upload/chunk')) return ok({ ok: true, index: body?.index ?? 0 });
    if (requestPath === '/api/upload/complete') return ok({ ok: true, sizeMatch: true });
    if (requestPath === '/api/projects/execution-plan') {
      return ok({
        ok: true,
        lineId: plan.lineId,
        tasks: plan.dag.map((node) => ({
          order: node.order,
          step: node.stepId,
          mod_id: node.modId,
          inputs: node.inputs,
          outputs: node.outputs,
        })),
      });
    }
    if (requestPath === '/api/tasks/submit') {
      if (state.failTask === body.step) {
        return { status: 500, ok: false, body: { error: 'injected failure' } };
      }
      state.ledger.push(ledgerEntry(body.step, body.outputs, body.seed));
      return ok({ taskId: `task-${body.step}`, projectId: body.projectId, lineId: body.lineId, step: body.step });
    }
    if (requestPath === '/api/tasks') return ok({ tasks: [] });
    if (requestPath.startsWith('/api/ledger/check')) {
      return ok({
        blocked: false,
        entries: state.ledger.map((data) => ({ file: `${data.step_name}.json`, data })),
        receipts: state.ledger.map((data) => ({ file: `${data.step_name}.json`, ...data })),
      });
    }
    if (requestPath === '/api/report/build') {
      return ok({
        ok: true,
        files: [
          { name: 'Analysis_Report.md' },
          { name: 'Analysis_Report.html' },
          { name: 'PRJ_RECEIPT_001_Client_Delivery.tar.gz' },
        ],
        acceptance: {
          sentinel: 'DELIVERY_ACCEPTANCE_OK 四道关全绿',
          receipt: 'PRJ_RECEIPT_001.receipt.json',
          verified_count: 4,
          verifier_version: 'v1',
        },
      });
    }
    if (requestPath.startsWith('/api/report/files')) {
      return ok({
        ok: true,
        delivery_verified: true,
        files: [
          { name: 'Analysis_Report.md' },
          { name: 'Analysis_Report.html' },
          { name: 'PRJ_RECEIPT_001_Client_Delivery.tar.gz' },
        ],
      });
    }
    return { status: 404, ok: false, body: { error: `unexpected ${requestPath}` } };
  };
  return { request, state, facts };
}

function reportDir(repoRoot, projectId) {
  return path.join(repoRoot, 'workspace', 'projects', projectId, 'report');
}

test('runWorkOrder 成功：权威回执与旧投影同时落盘，正文不含设施路径', async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `receipt-v1-run-${process.pid}-`));
  try {
    const order = baseOrder();
    const { request, facts } = makeRequest(order);
    const result = await runWorkOrder(order, {
      request,
      repoRoot,
      facts,
      pollIntervalMs: 0,
      pollMaxAttempts: 2,
    });
    assert.equal(result.ok, true, result.error || JSON.stringify(result.receipt));

    const dir = reportDir(repoRoot, 'PRJ_RECEIPT_001');
    const authorityFile = path.join(dir, 'receipt.v1.json');
    const legacyFile = path.join(dir, 'work_order.receipt.json');
    assert.ok(fs.existsSync(authorityFile), '权威回执必须落盘');
    assert.ok(fs.existsSync(legacyFile), '旧投影必须落盘');

    const authority = JSON.parse(fs.readFileSync(authorityFile, 'utf8'));
    assert.equal(authority.schema_version, RECEIPT_V1_SCHEMA_VERSION);
    assert.equal(authority.status, 'completed');
    assert.equal(authority.sentinel, RECEIPT_V1_SENTINEL);
    assert.equal(authority.work_order_digest, computeWorkOrderDigest(order));
    assert.match(authority.receipt_id, /^[0-9a-f]{24}$/);
    assert.equal(authority.failure_stage, null);
    assert.ok(authority.delivery);
    assert.ok(Object.hasOwn(authority.delivery, 'tar_sha256'));
    assert.ok(Object.hasOwn(authority.delivery, 'verified_count'));
    assert.ok(Object.hasOwn(authority.delivery, 'coverage_ok'));
    assert.ok(Object.hasOwn(authority.delivery, 'verifier_version'));
    assert.equal(authority.delivery.verified_count, 4);
    assert.equal(authority.delivery.coverage_ok, true);

    const paths = authority.artifacts.map((item) => item.path);
    assert.ok(paths.some((item) => item.endsWith('/report/Project_Summary.md')));
    assert.ok(paths.some((item) => item.endsWith('/report/work_order.receipt.json')));
    for (const item of authority.artifacts) {
      assert.equal(path.isAbsolute(item.path), false, item.path);
      assert.equal(item.path.includes('\\'), false, item.path);
      assert.equal(item.path.split('/').includes('..'), false, item.path);
    }

    const text = JSON.stringify(authority);
    assert.equal(text.includes(repoRoot), false, '权威回执不得含绝对仓库路径');
    assert.equal(/\/mnt\/ssd/.test(text), false, '权威回执不得含远端绝对路径');
    assert.equal(/[A-Za-z]:\\\\/.test(text), false, '权威回执不得含盘符路径');

    const legacy = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
    assert.equal(legacy.schema_version, WORK_ORDER_SCHEMA_VERSION);
    assert.equal(legacy.sentinel, 'WORK_ORDER_ORCHESTRATOR_OK');
    assert.equal(legacy.ok, true);
    assert.equal(result.receipt.sentinel, 'WORK_ORDER_ORCHESTRATOR_OK');
    assert.equal(result.receiptV1.status, 'completed');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('runWorkOrder 失败：权威回执 failed 落盘，旧文件不写', async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `receipt-v1-fail-${process.pid}-`));
  try {
    const order = baseOrder();
    const { request, facts } = makeRequest(order, { failTask: 'qc_matrix' });
    const result = await runWorkOrder(order, {
      request,
      repoRoot,
      facts,
      pollIntervalMs: 0,
      pollMaxAttempts: 2,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'ERR_API_FAILED');

    const dir = reportDir(repoRoot, 'PRJ_RECEIPT_001');
    const authorityFile = path.join(dir, 'receipt.v1.json');
    const legacyFile = path.join(dir, 'work_order.receipt.json');
    assert.ok(fs.existsSync(authorityFile), '失败作业必须落权威回执');
    assert.equal(fs.existsSync(legacyFile), false, '失败作业不写旧投影');

    const authority = JSON.parse(fs.readFileSync(authorityFile, 'utf8'));
    assert.equal(authority.status, 'failed');
    assert.equal(authority.failure_stage, 'task_dispatch');
    assert.equal(authority.error.code, 'ERR_API_FAILED');
    assert.equal(authority.sentinel, null);
    assert.ok(authority.stages.some((stage) => stage.name === 'report_build' && stage.status === 'blocked'));
    assert.equal(result.receipt.status, 'failed');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('runWorkOrder 阻塞：服务不可达写 blocked 权威回执，旧文件不写', async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `receipt-v1-blocked-${process.pid}-`));
  try {
    const order = baseOrder();
    const { facts } = makeRequest(order);
    const result = await runWorkOrder(order, {
      request: async () => {
        const cause = new Error('connect ECONNREFUSED 127.0.0.1:18787');
        cause.code = 'ECONNREFUSED';
        throw cause;
      },
      repoRoot,
      facts,
      pollIntervalMs: 0,
      pollMaxAttempts: 1,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'ERR_API_UNREACHABLE');
    assert.equal(result.status, 'blocked');

    const dir = reportDir(repoRoot, 'PRJ_RECEIPT_001');
    const authorityFile = path.join(dir, 'receipt.v1.json');
    const legacyFile = path.join(dir, 'work_order.receipt.json');
    assert.ok(fs.existsSync(authorityFile), '阻塞作业必须落权威回执');
    assert.equal(fs.existsSync(legacyFile), false, '阻塞作业不写旧投影');

    const authority = JSON.parse(fs.readFileSync(authorityFile, 'utf8'));
    assert.equal(authority.status, 'blocked');
    assert.equal(authority.failure_stage, 'create_project');
    assert.equal(authority.error.code, 'ERR_API_UNREACHABLE');
    assert.equal(authority.sentinel, null);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('runWorkOrder 校验失败：projectId 合法时也落 failed 权威回执', async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `receipt-v1-validate-${process.pid}-`));
  try {
    const order = baseOrder({ modIds: ['mod_not_in_registry'] });
    const result = await runWorkOrder(order, {
      repoRoot,
      facts: syntheticFacts(),
      request: async () => {
        throw new Error('校验失败不得触达接口');
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'ERR_CROSS_LINE_MOD');

    const authorityFile = path.join(reportDir(repoRoot, 'PRJ_RECEIPT_001'), 'receipt.v1.json');
    assert.ok(fs.existsSync(authorityFile), '校验失败也必须落权威回执');
    const authority = JSON.parse(fs.readFileSync(authorityFile, 'utf8'));
    assert.equal(authority.status, 'failed');
    assert.equal(authority.failure_stage, 'validate');
    assert.equal(authority.error.code, 'ERR_CROSS_LINE_MOD');
    assert.equal(authority.project_id, 'PRJ_RECEIPT_001');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('runWorkOrder 成功但权威回执写盘失败：fail closed，不留旧成功投影', async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `receipt-v1-writefail-${process.pid}-`));
  try {
    const order = baseOrder();
    const { request, facts } = makeRequest(order);
    const repoDir = path.join(repoRoot, 'workspace', 'projects', 'PRJ_RECEIPT_001');
    // 目录占位让权威回执 rename 目标不可写，模拟写盘失败。
    fs.mkdirSync(path.join(repoDir, 'report', 'receipt.v1.json'), { recursive: true });
    const result = await runWorkOrder(order, {
      request,
      repoRoot,
      facts,
      pollIntervalMs: 0,
      pollMaxAttempts: 2,
      sleep: async () => {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'ERR_RECEIPT_WRITE');
    assert.equal(
      fs.existsSync(path.join(repoDir, 'report', 'work_order.receipt.json')),
      false,
      '权威回执失败时不得留下旧成功投影',
    );
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
