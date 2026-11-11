/**
 * T2 文件引用与流式上传契约测试
 *
 * 守四件事：
 *   1. v2 inputs[] 指向真实文件时，编排器按分片流式上传，不把整包 base64 塞进内存。
 *   2. 上传回执的 sha256 与工单声明一致，sizeMatch 为 true。
 *   3. 缺文件、声明大小不符、声明哈希不符、分片回收哈希不符、路径逃逸均 fail closed。
 *   4. v1 uploads base64 老路径保持原行为。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { normalizeWorkOrderV2 } from '../../shared/work_order_v2.mjs';
import {
  WORK_ORDER_SCHEMA_VERSION,
  compileWorkOrderPlan,
  runWorkOrder,
} from '../../tools/dev/work_order_orchestrator.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const V2_EXAMPLE_FILE = path.join(REPO, 'tools', 'examples', 'work_order_v2.example.json');
const EXAMPLE = JSON.parse(fs.readFileSync(V2_EXAMPLE_FILE, 'utf8'));
const CHUNK_SIZE = 512 * 1024;
const FILE_BYTES = 2 * 1024 * 1024;

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

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

function ledgerEntry(stepName, outputs, seed = 20261013) {
  return {
    project_id: 'PRJ_EXAMPLE_V2_BULK',
    line_id: 'line1_bulk',
    step_name: stepName,
    status: 'completed',
    exit_code: 0,
    environment: { random_seed: seed },
    ledger_receipt: 'confirmed',
    io_files: { input: [], output: outputs.map((name) => `/mnt/ssd/bio_data/projects/PRJ_EXAMPLE_V2_BULK/line1_bulk/results/${name}`) },
    end_time: '2026-11-09T00:00:00.000Z',
  };
}

function makeRequest(order) {
  const facts = syntheticFacts();
  const plan = compileWorkOrderPlan(order, { facts });
  const state = {
    calls: [],
    uploads: new Map(),
    ledger: [],
    maxChunkBytes: 0,
    chunkBodies: [],
  };
  const ok = (payload) => ({ status: 200, ok: true, body: payload });
  const request = async (method, requestPath, body) => {
    state.calls.push({ method, path: requestPath, body });
    if (requestPath === '/api/projects/create') return ok({ ok: true, projectId: plan.projectId });
    if (requestPath === '/api/upload/init') {
      const uploadId = `up-${state.uploads.size + 1}`;
      state.uploads.set(uploadId, { chunks: [], bytes: 0 });
      return ok({ uploadId, chunkSize: CHUNK_SIZE });
    }
    if (requestPath.startsWith('/api/upload/chunk')) {
      const uploadId = new URL(`http://x${requestPath}`).searchParams.get('uploadId');
      const entry = state.uploads.get(uploadId);
      assert.ok(entry, `未知 uploadId: ${uploadId}`);
      const chunk = Buffer.isBuffer(body?.data)
        ? body.data
        : Buffer.from(String(body?.content_base64 ?? ''), 'base64');
      state.chunkBodies.push(body);
      state.maxChunkBytes = Math.max(state.maxChunkBytes, chunk.length);
      entry.chunks.push(chunk);
      entry.bytes += chunk.length;
      return ok({ ok: true, index: Number(body?.index ?? 0) });
    }
    if (requestPath === '/api/upload/complete') {
      const entry = state.uploads.get(body.uploadId);
      assert.ok(entry, `complete 未找到上传会话: ${body.uploadId}`);
      const merged = Buffer.concat(entry.chunks, entry.bytes);
      return ok({
        ok: true,
        sizeMatch: true,
        localSize: merged.length,
        sha256: sha256(merged),
      });
    }
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
      const taskId = `task-${body.step}`;
      state.ledger.push(ledgerEntry(body.step, body.outputs, body.seed));
      return ok({ taskId, projectId: body.projectId, lineId: body.lineId, step: body.step });
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
          { name: 'PRJ_EXAMPLE_V2_BULK_Client_Delivery.tar.gz' },
        ],
        acceptance: {
          sentinel: 'DELIVERY_ACCEPTANCE_OK 四道关全绿',
          receipt: 'PRJ_EXAMPLE_V2_BULK.receipt.json',
          verified_count: 6,
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
          { name: 'PRJ_EXAMPLE_V2_BULK_Client_Delivery.tar.gz' },
        ],
      });
    }
    return { status: 404, ok: false, body: { error: `unexpected ${requestPath}` } };
  };
  return { request, state, plan, facts };
}

function makeInputsRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `wo-v2-inputs-${process.pid}-`));
  const dataDir = path.join(root, 'raw_data');
  fs.mkdirSync(dataDir, { recursive: true });
  const bytes = Buffer.alloc(FILE_BYTES);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 251;
  const file = path.join(dataDir, 'train_matrix.tsv');
  fs.writeFileSync(file, bytes);
  return { root, dataDir, file, bytes };
}

function v2Order(entry) {
  const payload = structuredClone(EXAMPLE);
  payload.inputs = [entry];
  return payload;
}

function inputEntry(fixture, extra = {}) {
  return {
    role: 'train_matrix',
    path: 'raw_data/train_matrix.tsv',
    filename: 'train_matrix.tsv',
    size: fixture.bytes.length,
    sha256: sha256(fixture.bytes),
    format: 'tsv',
    ...extra,
  };
}

async function runFixture(payload, fixture, extraOptions = {}) {
  const normalized = normalizeWorkOrderV2(payload);
  assert.equal(normalized.ok, true, normalized.errors.join('；'));
  const { request, state, facts } = makeRequest(normalized.workOrder);
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `wo-v2-repo-${process.pid}-`));
  try {
    const result = await runWorkOrder(payload, {
      repoRoot,
      inputsRoot: fixture.root,
      facts,
      request,
      pollIntervalMs: 0,
      ...extraOptions,
    });
    return { result, state };
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test('v2 inputs 走流式分片上传，回执 sizeMatch 与 sha256 一致', async () => {
  const fixture = makeInputsRoot();
  try {
    const { result, state } = await runFixture(v2Order(inputEntry(fixture)), fixture);
    assert.equal(result.ok, true, result.error || '');
    assert.equal(result.receipt.ok, true);

    const receipt = result.receipt.upload_receipts[0];
    assert.equal(receipt.filename, 'train_matrix.tsv');
    assert.equal(receipt.bytes, fixture.bytes.length);
    assert.equal(receipt.sha256, sha256(fixture.bytes));
    assert.equal(receipt.sizeMatch, true);

    const initCalls = state.calls.filter((item) => item.path === '/api/upload/init');
    assert.equal(initCalls.length, 1);
    assert.equal(initCalls[0].body.size, fixture.bytes.length);

    const chunkCalls = state.calls.filter((item) => item.path.startsWith('/api/upload/chunk'));
    assert.equal(chunkCalls.length, Math.ceil(FILE_BYTES / CHUNK_SIZE));
    assert.ok(state.maxChunkBytes <= CHUNK_SIZE, `单分片 ${state.maxChunkBytes} 超过 ${CHUNK_SIZE}`);
    for (const body of state.chunkBodies) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(body || {}, 'content_base64'),
        false,
        'v2 分片不应整包 base64，应按 Buffer 流式投递',
      );
    }
    const completed = state.calls.find((item) => item.path === '/api/upload/complete');
    assert.equal(completed.body.filename, 'train_matrix.tsv');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('声明 sha256 与文件实际哈希不符时拒收，且不发起上传', async () => {
  const fixture = makeInputsRoot();
  try {
    const payload = v2Order(inputEntry(fixture, { sha256: 'b'.repeat(64) }));
    const { result, state } = await runFixture(payload, fixture);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'ERR_INPUT_HASH');
    assert.equal(state.calls.some((call) => call.path === '/api/upload/init'), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('声明 size 与文件实际大小不符时拒收', async () => {
  const fixture = makeInputsRoot();
  try {
    const payload = v2Order(inputEntry(fixture, { size: FILE_BYTES + 1 }));
    const { result, state } = await runFixture(payload, fixture);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'ERR_INPUT_FILE');
    assert.equal(state.calls.some((call) => call.path === '/api/upload/init'), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('文件缺失与目录占位都按 ERR_INPUT_FILE 拒收', async () => {
  const fixture = makeInputsRoot();
  try {
    const missing = v2Order(inputEntry(fixture, { path: 'raw_data/missing.tsv', filename: 'missing.tsv' }));
    const first = await runFixture(missing, fixture);
    assert.equal(first.result.ok, false);
    assert.equal(first.result.code, 'ERR_INPUT_FILE');

    const directory = v2Order(inputEntry(fixture, { path: 'raw_data', filename: 'raw_data' }));
    const second = await runFixture(directory, fixture);
    assert.equal(second.result.ok, false);
    assert.equal(second.result.code, 'ERR_INPUT_FILE');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('.. 段与越界路径在入口层拒收，不触达任何接口', async () => {
  const fixture = makeInputsRoot();
  try {
    const payload = v2Order(inputEntry(fixture, { path: '../escape.tsv' }));
    let called = 0;
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `wo-v2-repo-${process.pid}-`));
    try {
      const result = await runWorkOrder(payload, {
        repoRoot,
        inputsRoot: fixture.root,
        request: async () => {
          called += 1;
          throw new Error('越界路径必须在入口层被拒，不应触达接口');
        },
      });
      assert.equal(result.ok, false);
      assert.ok(
        ['ERR_INPUT_FILE', 'ERR_UNSAFE_PATH'].includes(result.code),
        `越界路径必须 fail closed，实际 ${result.code}`,
      );
      assert.equal(called, 0);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('解析后逃出 inputsRoot 的路径按 ERR_INPUT_FILE 拒收', async () => {
  const fixture = makeInputsRoot();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), `wo-v2-outside-${process.pid}-`));
  try {
    const outsideFile = path.join(outside, 'secret.tsv');
    fs.writeFileSync(outsideFile, fixture.bytes);
    const link = path.join(fixture.dataDir, 'link');
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    const payload = v2Order(inputEntry(fixture, { path: 'raw_data/link/secret.tsv', filename: 'secret.tsv' }));
    const { result, state } = await runFixture(payload, fixture);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'ERR_INPUT_FILE');
    assert.equal(state.calls.some((call) => call.path === '/api/upload/init'), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('complete 回执 sha256 与工单声明不符时按 ERR_UPLOAD_HASH_MISMATCH 拒收', async () => {
  const fixture = makeInputsRoot();
  try {
    const normalized = normalizeWorkOrderV2(v2Order(inputEntry(fixture)));
    assert.equal(normalized.ok, true, normalized.errors.join('；'));
    const { request, facts } = makeRequest(normalized.workOrder);
    const tampered = async (method, requestPath, body) => {
      const response = await request(method, requestPath, body);
      if (requestPath === '/api/upload/complete') {
        return { ...response, body: { ...response.body, sha256: 'c'.repeat(64) } };
      }
      return response;
    };
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `wo-v2-repo-${process.pid}-`));
    try {
      const result = await runWorkOrder(v2Order(inputEntry(fixture)), {
        repoRoot,
        inputsRoot: fixture.root,
        facts,
        request: tampered,
        pollIntervalMs: 0,
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'ERR_UPLOAD_HASH_MISMATCH');
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('v1 uploads base64 老路径保持原行为', async () => {
  const bytes = Buffer.from('gene\tvalue\nA\t1\n');
  const order = {
    schema_version: WORK_ORDER_SCHEMA_VERSION,
    workOrderId: 'WO-V1-INPUTS',
    projectId: 'PRJ_EXAMPLE_V2_BULK',
    lineId: 'line1_bulk',
    modIds: ['l1_qc_matrix'],
    figureSelections: [],
    uploads: [{ filename: 'matrix.tsv', content_base64: bytes.toString('base64') }],
  };
  const { request, state, facts } = makeRequest(order);
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `wo-v1-repo-${process.pid}-`));
  try {
    const result = await runWorkOrder(order, {
      repoRoot,
      facts,
      request,
      pollIntervalMs: 0,
    });
    assert.equal(result.ok, true, result.error || '');
    assert.equal(result.receipt.upload_receipts[0].bytes, bytes.length);
    assert.equal(result.receipt.upload_receipts[0].sha256, sha256(bytes));
    const chunk = state.chunkBodies[0];
    assert.equal(typeof chunk?.content_base64, 'string');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
