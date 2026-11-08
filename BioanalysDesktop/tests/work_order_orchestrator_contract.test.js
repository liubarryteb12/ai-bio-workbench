import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  REPO_ROOT,
  WORK_ORDER_SCHEMA_VERSION,
  compileWorkOrderPlan,
  runWorkOrder,
} from '../../ops/work_order_orchestrator.mjs';

function syntheticFacts() {
  const stages = [
    {
      id: 'ingest', order: 1, required: true,
      mods: [{
        id: 'l1_ingest_prep', script: 'prep_matrix', language: 'R',
        requires: ['series_matrix', 'gpl'],
        produces: ['expr_genes.tsv', 'group_map.tsv'],
      }],
    },
    {
      id: 'qc', order: 2, required: false,
      mods: [{
        id: 'l1_qc_matrix', script: 'qc_matrix', language: 'R',
        requires: ['expr_genes.tsv'],
        produces: ['qc_report.tsv'],
      }],
    },
  ];
  const registry = {
    series: new Map(),
    mods: new Map(),
    readyFigures: new Map([
      ['fig_probe', {
        id: 'fig_probe', status: 'ready', canonical_output: 'probe.png',
        producing_mod_id: 'l1_qc_matrix', required_mod_ids: ['l1_qc_matrix'],
      }],
    ]),
    allowedIds: new Set(['fig_probe']),
  };
  const orderedMods = [];
  for (const stage of stages) {
    for (const mod of stage.mods) {
      const entry = {
        id: mod.id,
        mod,
        seriesId: 'line1_bulk',
        stageId: stage.id,
        order: stage.order,
        required: stage.required,
        optional: false,
      };
      registry.mods.set(mod.id, entry);
      orderedMods.push(entry);
    }
  }
  registry.series.set('line1_bulk', { series: { id: 'line1_bulk', seed: 20261013 }, stages, orderedMods, seed: 20261013 });
  return registry;
}

function baseOrder(extra = {}) {
  return {
    schema_version: WORK_ORDER_SCHEMA_VERSION,
    workOrderId: 'WO-CONTRACT-001',
    projectId: 'PRJ_WO_CONTRACT',
    lineId: 'line1_bulk',
    modIds: ['l1_qc_matrix'],
    figureSelections: [{ template_id: 'fig_probe' }],
    uploads: [{ filename: 'matrix.tsv', content_base64: Buffer.from('gene\tvalue\nA\t1\n').toString('base64') }],
    ...extra,
  };
}

function ledgerEntry(stepName, outputs, seed = 20261013, extra = {}) {
  return {
    project_id: 'PRJ_WO_CONTRACT',
    line_id: 'line1_bulk',
    step_name: stepName,
    status: 'completed',
    exit_code: 0,
    environment: { random_seed: seed },
    ledger_receipt: 'confirmed',
    io_files: { input: [], output: outputs.map((name) => `/mnt/ssd/bio_data/projects/PRJ_WO_CONTRACT/line1_bulk/results/${name}`) },
    end_time: '2026-11-08T00:00:00.000Z',
    ...extra,
  };
}

function makeRequest(order) {
  const facts = syntheticFacts();
  const plan = compileWorkOrderPlan(order, { facts });
  const state = {
    calls: [],
    running: new Set(),
    ledger: [],
    failTask: null,
    reportFiles: false,
    deliveryVerified: true,
  };
  const request = async (method, requestPath, body) => {
    state.calls.push({ method, path: requestPath, body });
    const ok = (payload) => ({ status: 200, ok: true, body: payload });
    if (requestPath === '/api/projects/create') return ok({ ok: true, projectId: plan.projectId });
    if (requestPath === '/api/upload/init') return ok({ uploadId: `up-${state.calls.length}`, chunkSize: 1048576 });
    if (requestPath.startsWith('/api/upload/chunk')) {
      assert.ok(Buffer.isBuffer(body) || typeof body?.content_base64 === 'string', '分片必须是二进制或已编码字节');
      return ok({ ok: true, index: body?.index ?? 0 });
    }
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
      const taskId = `task-${body.step}`;
      state.running.add(taskId);
      state.ledger.push(ledgerEntry(body.step, body.outputs, body.seed));
      state.running.delete(taskId);
      return ok({ taskId, projectId: body.projectId, lineId: body.lineId, step: body.step });
    }
    if (requestPath === '/api/tasks') {
      return ok({ tasks: [...state.running].map((taskId) => ({ taskId })) });
    }
    if (requestPath === '/api/ledger/check') {
      return ok({
        blocked: false,
        entries: state.ledger.map((data) => ({ file: `${data.step_name}.json`, data })),
        receipts: state.ledger.map((data) => ({ file: `${data.step_name}.json`, ...data })),
      });
    }
    if (requestPath === '/api/report/build') {
      state.reportFiles = true;
      return ok({
        ok: true,
        files: [
          { name: 'Analysis_Report.md' },
          { name: 'Analysis_Report.html' },
          { name: 'PRJ_WO_CONTRACT_Client_Delivery.tar.gz' },
        ],
        acceptance: { sentinel: 'DELIVERY_ACCEPTANCE_OK 四道关全绿', receipt: 'PRJ_WO_CONTRACT.receipt.json', verified_count: 8 },
      });
    }
    if (requestPath.startsWith('/api/report/files')) {
      return ok({
        ok: true,
        delivery_verified: state.deliveryVerified,
        files: state.reportFiles
          ? [
            { name: 'Analysis_Report.md' },
            { name: 'Analysis_Report.html' },
            { name: 'PRJ_WO_CONTRACT_Client_Delivery.tar.gz' },
          ]
          : [],
      });
    }
    return { status: 404, ok: false, body: { error: `unexpected ${requestPath}` } };
  };
  return { request, state, plan, facts };
}

function runOptions(base, extra = {}) {
  return { ...base, facts: base.facts || syntheticFacts(), ...extra };
}

test('工单编译：补齐上游闭包、默认 ADB、拒绝组图与非 Ready 图', () => {
  const facts = syntheticFacts();
  const plan = compileWorkOrderPlan(baseOrder(), { facts });
  assert.equal(plan.dag.length, 2);
  assert.deepEqual(plan.dag.map((node) => node.modId), ['l1_ingest_prep', 'l1_qc_matrix']);
  assert.equal(plan.computeAdapter, 'adb');
  assert.equal(plan.seed, 20261013);
  assert.throws(
    () => compileWorkOrderPlan(baseOrder({ figureSelections: [{ template_id: 'fig_l3_multipanel' }] }), { facts }),
    (cause) => cause.code === 'ERR_RETIRED_FIGURE',
  );
  assert.throws(
    () => compileWorkOrderPlan(baseOrder({ figureSelections: [{ template_id: 'fig_missing' }] }), { facts }),
    (cause) => cause.code === 'ERR_FIGURE_NOT_READY',
  );
});

test('SSH 只在显式特殊开关下允许，非法通道 fail closed', () => {
  const facts = syntheticFacts();
  assert.throws(
    () => compileWorkOrderPlan(baseOrder({ computeAdapter: 'ssh' }), { facts }),
    (cause) => cause.code === 'ERR_SSH_DISABLED',
  );
  assert.equal(compileWorkOrderPlan(baseOrder({ computeAdapter: 'ssh', allowSsh: true }), { facts }).computeAdapter, 'ssh');
  assert.throws(
    () => compileWorkOrderPlan(baseOrder({ computeAdapter: 'telnet' }), { facts }),
    (cause) => cause.code === 'ERR_COMPUTE_ADAPTER',
  );
});

test('真实真源：54 模块、39 Ready 单图、白名单与注册表一致', () => {
  const plan = compileWorkOrderPlan({
    ...baseOrder(),
    projectId: 'PRJ_REAL_FACTS',
    modIds: ['l1_qc_matrix'],
    figureSelections: [],
    uploads: [],
  });
  assert.equal(plan.facts.workflowMods, 54);
  assert.equal(plan.facts.readyBaseline, 39);
  assert.equal(plan.computeAdapter, 'adb');
});

test('正常闭环：建项、上传、DAG 派发、回执、报告、验收、汇总回执', async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `work-order-${process.pid}-`));
  try {
    const { request, state, facts } = makeRequest(baseOrder());
    const result = await runWorkOrder(baseOrder(), {
      request,
      repoRoot,
      pollIntervalMs: 0,
      pollMaxAttempts: 2,
      facts,
    });
    assert.equal(result.ok, true, result.error || JSON.stringify(result.receipt));
    assert.equal(result.receipt.sentinel, 'WORK_ORDER_ORCHESTRATOR_OK');
    assert.equal(result.summary.delivery_verified, true);
    assert.equal(result.receipt.task_receipts.length, 2);
    assert.equal(state.calls.some((call) => call.path === '/api/projects/create'), true);
    assert.equal(state.calls.some((call) => call.path === '/api/upload/complete'), true);
    assert.equal(state.calls.some((call) => call.path === '/api/report/build'), true);
    for (const stage of result.stages) assert.equal(stage.status, 'passed');
    assert.ok(fs.existsSync(path.join(repoRoot, result.artifacts.project_summary)));
    assert.ok(fs.existsSync(path.join(repoRoot, result.artifacts.work_order_receipt)));
    const summary = fs.readFileSync(path.join(repoRoot, result.artifacts.project_summary), 'utf8');
    assert.match(summary, /WORK_ORDER_SUMMARY_OK/);
    assert.doesNotMatch(summary, /K40|Termux|adb|ssh|\/mnt\/|ops\/|真机|服务器/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('上游 HTTP 失败：下游全部 blocked，不调用报告构建', async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `work-order-red-${process.pid}-`));
  try {
    const order = baseOrder();
    const { request, state, facts } = makeRequest(order);
    state.failTask = 'qc_matrix';
    const result = await runWorkOrder(order, {
      request,
      repoRoot,
      pollIntervalMs: 0,
      pollMaxAttempts: 2,
      facts,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'ERR_API_FAILED');
    assert.equal(state.calls.some((call) => call.path === '/api/report/build'), false);
    const stageMap = new Map(result.stages.map((stage) => [stage.name, stage.status]));
    assert.equal(stageMap.get('task_dispatch'), 'failed');
    assert.equal(stageMap.get('report_build'), 'blocked');
    assert.equal(stageMap.get('acceptance'), 'blocked');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('完成回执不完整：fail closed，且不写验收通过', async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `work-order-receipt-${process.pid}-`));
  try {
    const order = baseOrder();
    const { request, state, facts } = makeRequest(order);
    const original = request;
    const brokenRequest = async (method, requestPath, body) => {
      const response = await original(method, requestPath, body);
      if (requestPath === '/api/ledger/check' && state.ledger.length === 1) {
        response.body.entries[0].data.exit_code = 1;
        response.body.entries[0].data.status = 'failed';
        response.body.receipts[0].exit_code = 1;
        response.body.receipts[0].status = 'failed';
      }
      return response;
    };
    const result = await runWorkOrder(order, {
      request: brokenRequest,
      repoRoot,
      pollIntervalMs: 0,
      pollMaxAttempts: 3,
      facts,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'ERR_TASK_RECEIPT');
    assert.equal(state.calls.some((call) => call.path === '/api/report/build'), false);
    assert.equal(result.receipt.status, 'failed');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('验收回执无效：报告已生成也不判工单成功', async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `work-order-accept-${process.pid}-`));
  try {
    const order = baseOrder();
    const { request, state, facts } = makeRequest(order);
    state.deliveryVerified = false;
    const result = await runWorkOrder(order, {
      request,
      repoRoot,
      pollIntervalMs: 0,
      pollMaxAttempts: 2,
      facts,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'ERR_DELIVERY_UNVERIFIED');
    assert.equal(result.receipt.status, 'failed');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('静态契约：编排器单入口不直接调用 SSH 或远端进程', () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'ops', 'work_order_orchestrator.mjs'), 'utf8');
  assert.equal(/from ['"].*remote_exec\.js['"]/.test(source), false);
  assert.equal(/runSshRaw|runSshAsync|sshArgv|scpArgv/.test(source), false);
  assert.match(source, /computeAdapter \|\| 'adb'/);
  assert.match(source, /allowSsh !== true/);
  assert.match(source, /Project_Summary\.md/);
  assert.match(source, /work_order\.receipt\.json/);
});
