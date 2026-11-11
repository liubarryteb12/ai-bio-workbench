/**
 * T1 work_order/v2 契约测试
 *
 * 守三件事：
 *   1. v2 单文件工单能被归一化为编排器内部 camelCase 形态，且 requirement 四段、
 *      figure_templates[].adapt_vars 与 controls 不丢。
 *   2. 非法版本、绝对路径、反斜杠、.. 段、错误哈希、SSH 未显式放行均 fail closed。
 *   3. inputs 非空时归一化通过，文件存在性、大小与哈希由编排器读取层校验。
 *   4. v1 工单与既有编译链路保持原行为。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  WORK_ORDER_V2_SCHEMA_VERSION,
  normalizeWorkOrderV2,
} from '../../shared/work_order_v2.mjs';
import {
  REPO_ROOT,
  WORK_ORDER_SCHEMA_VERSION,
  compileWorkOrderPlan,
  loadWorkOrder,
  runWorkOrder,
} from '../../tools/dev/work_order_orchestrator.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const V2_EXAMPLE_FILE = path.join(REPO, 'tools', 'examples', 'work_order_v2.example.json');
const V1_EXAMPLE_FILE = path.join(REPO, 'tools', 'examples', 'work_order.example.json');
const EXAMPLE = JSON.parse(fs.readFileSync(V2_EXAMPLE_FILE, 'utf8'));
const GOOD_SHA = 'a'.repeat(64);

function clone(value) {
  return structuredClone(value);
}

function base() {
  return clone(EXAMPLE);
}

function hasCode(result, code) {
  return result.ok === false
    && result.codes.includes(code)
    && result.errors.some((item) => item.includes(code));
}

function inputItem(extra = {}) {
  return {
    role: 'train_matrix',
    path: 'PKG_20261110_120000_example/raw_data/train_matrix.tsv',
    filename: 'train_matrix.tsv',
    size: 1024,
    sha256: GOOD_SHA,
    format: 'tsv',
    ...extra,
  };
}

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
  registry.series.set('line1_bulk', {
    series: { id: 'line1_bulk', seed: 20261013 },
    stages,
    orderedMods,
    seed: 20261013,
  });
  return registry;
}

test('v2 样例：归一化为内部 camelCase 形态，adapt_vars 与 controls 一并保留', () => {
  const payload = base();
  payload.execution.figure_selections = [{ template_id: 'fig_probe' }];
  payload.requirement.figure_templates = [{
    template_id: 'fig_probe',
    adapt_vars: { palette: 'okabe_ito', width: 12 },
    note: 'keep-me',
  }];

  const result = normalizeWorkOrderV2(payload);
  assert.equal(result.ok, true, result.errors.join('；'));
  const order = result.workOrder;

  assert.equal(order.schema_version, WORK_ORDER_SCHEMA_VERSION, '内部形态复用 v1 编译契约');
  assert.equal(order.sourceSchemaVersion, WORK_ORDER_V2_SCHEMA_VERSION);
  assert.equal(order.workOrderId, 'WO-EXAMPLE-V2-001');
  assert.equal(order.projectId, 'PRJ_EXAMPLE_V2_BULK');
  assert.equal(order.lineId, 'line1_bulk');
  assert.deepEqual(order.modIds, ['l1_ingest_prep', 'l1_qc_matrix']);
  assert.equal(order.seed, 20261013);
  assert.equal(order.computeAdapter, 'adb');
  assert.equal(order.allowSsh, false);
  assert.deepEqual(order.uploads, []);
  assert.equal(order.basicInfo.name, '示例 v2 批量转录组项目');
  assert.equal(order.controls.requireAdminReview, true);
  assert.equal(order.controls.resume, false);
  assert.equal(order.controls.resumeSince, null);
  assert.equal(order.controls.forceReportBuild, false);
  assert.equal(order.sourcePackage.packageDir, 'PKG_20261110_120000_example');
  assert.equal(order.delivery.profile, 'client_standard');

  assert.equal(order.figureSelections.length, 1);
  assert.equal(order.figureSelections[0].template_id, 'fig_probe');
  assert.deepEqual(order.figureSelections[0].adapt_vars, { palette: 'okabe_ito', width: 12 });
  assert.equal(order.figureSelections[0].note, 'keep-me');
});

test('controls 缺省时 require_admin_review 默认 true，resume 缺省关闭', () => {
  const payload = base();
  delete payload.controls;
  const result = normalizeWorkOrderV2(payload);
  assert.equal(result.ok, true, result.errors.join('；'));
  assert.equal(result.workOrder.controls.requireAdminReview, true);
  assert.equal(result.workOrder.resume, false);
  assert.equal(result.workOrder.resumeSince, null);
  assert.equal(result.workOrder.forceReportBuild, false);
});

test('非法版本拒', () => {
  const payload = base();
  payload.schema_version = 'work_order/v1';
  const result = normalizeWorkOrderV2(payload);
  assert.equal(hasCode(result, 'ERR_WORK_ORDER_V2_VERSION'), true, result.errors.join('；'));
});

test('绝对路径拒：POSIX 与盘符路径都拦', () => {
  for (const badPath of ['/mnt/ssd/raw_data/train.tsv', 'C:/raw_data/train.tsv']) {
    const payload = base();
    payload.inputs = [inputItem({ path: badPath })];
    const result = normalizeWorkOrderV2(payload);
    assert.equal(hasCode(result, 'ERR_UNSAFE_PATH'), true, `${badPath}: ${result.errors.join('；')}`);
  }
});

test('反斜杠路径拒', () => {
  const payload = base();
  payload.inputs = [inputItem({ path: String.raw`PKG_20261110_120000_example/raw_data\train.tsv` })];
  const result = normalizeWorkOrderV2(payload);
  assert.equal(hasCode(result, 'ERR_UNSAFE_PATH'), true, result.errors.join('；'));
});

test('.. 段路径拒', () => {
  const payload = base();
  payload.inputs = [inputItem({ path: 'PKG_20261110_120000_example/../escape.tsv' })];
  const result = normalizeWorkOrderV2(payload);
  assert.equal(hasCode(result, 'ERR_UNSAFE_PATH'), true, result.errors.join('；'));
});

test('source_package 绝对路径拒', () => {
  const payload = base();
  payload.source_package.package_dir = '/var/lib/packages/PKG_1';
  const result = normalizeWorkOrderV2(payload);
  assert.equal(hasCode(result, 'ERR_UNSAFE_PATH'), true, result.errors.join('；'));
});

test('缺少 source_package 拒', () => {
  const payload = base();
  delete payload.source_package;
  const result = normalizeWorkOrderV2(payload);
  assert.equal(hasCode(result, 'ERR_SOURCE_PACKAGE'), true, result.errors.join('；'));
});

test('图件项只认 template_id，别名不算数', () => {
  const payload = base();
  payload.execution.figure_selections = [{ templateId: 'fig_probe' }];
  const result = normalizeWorkOrderV2(payload);
  assert.equal(hasCode(result, 'ERR_FIGURE_SELECTION'), true, result.errors.join('；'));
});

test('哈希格式错拒：缺字段、短串、大写都不收', () => {
  const missing = base();
  missing.inputs = [inputItem({ sha256: undefined })];
  assert.equal(hasCode(normalizeWorkOrderV2(missing), 'ERR_SHA256'), true);

  const short = base();
  short.inputs = [inputItem({ sha256: 'abc123' })];
  assert.equal(hasCode(normalizeWorkOrderV2(short), 'ERR_SHA256'), true);

  const upper = base();
  upper.inputs = [inputItem({ sha256: 'A'.repeat(64) })];
  assert.equal(hasCode(normalizeWorkOrderV2(upper), 'ERR_SHA256'), true);
});

test('compute_adapter=ssh 已随 SSH 通道封存', () => {
  const retired = base();
  retired.execution.compute_adapter = 'ssh';
  assert.equal(hasCode(normalizeWorkOrderV2(retired), 'ERR_COMPUTE_ADAPTER'), true);
});

test('inputs 非空时归一化通过，交由文件读取层校验', () => {
  const payload = base();
  payload.inputs = [inputItem()];
  const result = normalizeWorkOrderV2(payload);
  assert.equal(result.ok, true, result.errors.join('；'));
  assert.equal(result.workOrder.inputs.length, 1);
  assert.deepEqual(result.workOrder.uploads, []);
  assert.deepEqual(
    {
      role: result.workOrder.inputs[0].role,
      path: result.workOrder.inputs[0].path,
      filename: result.workOrder.inputs[0].filename,
      size: result.workOrder.inputs[0].size,
      sha256: result.workOrder.inputs[0].sha256,
      format: result.workOrder.inputs[0].format,
    },
    {
      role: 'train_matrix',
      path: 'PKG_20261110_120000_example/raw_data/train_matrix.tsv',
      filename: 'train_matrix.tsv',
      size: 1024,
      sha256: GOOD_SHA,
      format: 'tsv',
    },
  );
});

test('adapt_vars 透传：requirement.figure_templates 合并进 figureSelections', () => {
  const payload = base();
  payload.execution.figure_selections = [];
  payload.requirement.figure_templates = [{
    template_id: 'fig_probe',
    adapt_vars: { legend_position: 'right', dpi: 300 },
  }];
  const result = normalizeWorkOrderV2(payload);
  assert.equal(result.ok, true, result.errors.join('；'));
  assert.equal(result.workOrder.figureSelections.length, 1);
  assert.deepEqual(result.workOrder.figureSelections[0].adapt_vars, {
    legend_position: 'right',
    dpi: 300,
  });
});

test('v2 空图件 + modIds 直接走 compileWorkOrderPlan 成功', () => {
  const payload = base();
  payload.execution.figure_selections = [];
  payload.requirement.figure_templates = [];
  payload.execution.mod_ids = ['l1_qc_matrix'];

  const result = normalizeWorkOrderV2(payload);
  assert.equal(result.ok, true, result.errors.join('；'));
  const plan = compileWorkOrderPlan(result.workOrder, { facts: syntheticFacts() });
  assert.deepEqual(plan.dag.map((node) => node.modId), ['l1_ingest_prep', 'l1_qc_matrix']);
  assert.equal(plan.seed, 20261013);
  assert.equal(plan.computeAdapter, 'adb');
});

test('v1 样例回归：loadWorkOrder 原样返回，编译链路仍绿', () => {
  const loaded = loadWorkOrder(V1_EXAMPLE_FILE);
  assert.equal(loaded.schema_version, WORK_ORDER_SCHEMA_VERSION);
  assert.deepEqual(loaded.modIds, ['l1_ingest_prep', 'l1_qc_matrix']);
  const plan = compileWorkOrderPlan(loaded, { facts: syntheticFacts() });
  assert.deepEqual(plan.dag.map((node) => node.modId), ['l1_ingest_prep', 'l1_qc_matrix']);
});

test('v2 非法工单在 runWorkOrder 入口返回失败回执，且不触发任何接口', async () => {
  const payload = base();
  payload.inputs = [inputItem({ path: '/abs/train.tsv' })];
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `work-order-v2-${process.pid}-`));
  try {
    let called = 0;
    const result = await runWorkOrder(payload, {
      repoRoot,
      request: async () => {
        called += 1;
        throw new Error('normalization should fail before any API call');
      },
    });
    assert.equal(called, 0);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'ERR_UNSAFE_PATH');
    assert.equal(result.receipt.status, 'failed');
    assert.equal(result.receipt.code, 'ERR_UNSAFE_PATH');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('loadWorkOrder 对非法 v2 文件抛出带错误码的 WorkOrderError', () => {
  const payload = base();
  payload.inputs = [inputItem({ path: '/abs/train.tsv' })];
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `work-order-v2-load-bad-${process.pid}-`));
  try {
    const file = path.join(repoRoot, 'work_order.json');
    fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
    assert.throws(
      () => loadWorkOrder(file),
      (cause) => cause.code === 'ERR_UNSAFE_PATH' && /T2|相对路径/.test(cause.message),
    );
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
