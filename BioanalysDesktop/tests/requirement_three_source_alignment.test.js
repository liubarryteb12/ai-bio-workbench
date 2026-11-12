/**
 * T0 需求单三真源对齐契约测试
 *
 * 守的是同一份 requirement 段在三个入口得到同一结论：
 *   1. shared/requirement_schema.json 声明面
 *   2. shared/requirement_schema.mjs 运行时校验
 *   3. schemas/schema_gateway.py 的 RequirementSchema
 *
 * 另外守住建项 name 的读取顺序，basicInfo.name 是项目人读名称的唯一入口，
 * 中文项目名不得被工单别名或 projectId 覆盖。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateRequirement } from '../../shared/requirement_schema.mjs';
import { validateWithSchemaGateway } from '../server/schema_gateway_client.js';
import {
  WORK_ORDER_SCHEMA_VERSION,
  runWorkOrder,
} from '../../tools/dev/work_order_orchestrator.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const REQUIREMENT_SCHEMA = JSON.parse(
  fs.readFileSync(path.join(REPO, 'shared', 'requirement_schema.json'), 'utf8'),
);
const EXAMPLE_ORDER = JSON.parse(
  fs.readFileSync(path.join(REPO, 'tools', 'examples', 'work_order.example.json'), 'utf8'),
);

/** schema 子集判定器，只覆盖 requirement_schema.json 实际用到的关键字 */
function checkAgainstSchema(value, node, at = '$') {
  const errors = [];
  if (!node || typeof node !== 'object') return errors;
  if (node.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return [`${at} 应为对象`];
    for (const key of node.required || []) {
      if (!(key in value)) errors.push(`${at} 缺少必填字段 ${key}`);
    }
    for (const [key, sub] of Object.entries(node.properties || {})) {
      if (key in value) errors.push(...checkAgainstSchema(value[key], sub, `${at}.${key}`));
    }
  } else if (node.type === 'array') {
    if (!Array.isArray(value)) return [`${at} 应为数组`];
    if (node.minItems !== undefined && value.length < node.minItems) errors.push(`${at} 少于 ${node.minItems} 项`);
    if (node.maxItems !== undefined && value.length > node.maxItems) errors.push(`${at} 多于 ${node.maxItems} 项`);
    if (node.items) {
      value.forEach((item, index) => errors.push(...checkAgainstSchema(item, node.items, `${at}[${index}]`)));
    }
  } else if (node.type === 'string') {
    if (typeof value !== 'string') return [`${at} 应为字符串`];
    if (node.minLength !== undefined && value.length < node.minLength) errors.push(`${at} 长度小于 ${node.minLength}`);
    if (node.maxLength !== undefined && value.length > node.maxLength) errors.push(`${at} 长度超过 ${node.maxLength}`);
    if (node.enum && !node.enum.includes(value)) errors.push(`${at} 不在枚举内: ${JSON.stringify(value)}`);
  } else if (node.type === 'integer' || node.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return [`${at} 应为数字`];
    if (node.type === 'integer' && !Number.isInteger(value)) errors.push(`${at} 应为整数`);
    if (node.minimum !== undefined && value < node.minimum) errors.push(`${at} 小于最小值 ${node.minimum}`);
    if (node.exclusiveMinimum !== undefined && value <= node.exclusiveMinimum) {
      errors.push(`${at} 必须大于 ${node.exclusiveMinimum}`);
    }
    if (node.exclusiveMaximum !== undefined && value >= node.exclusiveMaximum) {
      errors.push(`${at} 必须小于 ${node.exclusiveMaximum}`);
    }
  } else if (node.type === 'boolean') {
    if (typeof value !== 'boolean') errors.push(`${at} 应为布尔`);
  }
  return errors;
}

function requirementFromExample() {
  const { basicInfo, dataSource, groupingDesign, analysisCutoffs } = EXAMPLE_ORDER;
  return { basicInfo, dataSource, groupingDesign, analysisCutoffs };
}

function clone(value) {
  return structuredClone(value);
}

function pydantic(payload) {
  return validateWithSchemaGateway('requirement', payload, { repoRoot: REPO });
}

function assertAllThreeReject(payload, label, pydanticPath) {
  const schemaErrors = checkAgainstSchema(payload, REQUIREMENT_SCHEMA);
  assert.notDeepEqual(schemaErrors, [], `JSON Schema 应拒绝缺少 ${label}`);

  const runtime = validateRequirement(payload);
  assert.equal(runtime.ok, false, `共享校验器应拒绝缺少 ${label}`);
  assert.ok(
    runtime.errors.some((item) => item.includes(label)),
    `共享校验器报错应点名 ${label}: ${runtime.errors.join('；')}`,
  );

  const gateway = pydantic(payload);
  assert.equal(gateway.allowed, false, `Pydantic 网关应拒绝缺少 ${label}`);
  assert.equal(gateway.status, 'DENY');
  assert.equal(gateway.exitCode, 2);
  assert.ok(
    gateway.errors.some((item) => item.path === pydanticPath),
    `Pydantic 报错路径应含 ${pydanticPath}: ${JSON.stringify(gateway.errors)}`,
  );
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

function nameProbeOrder(extra = {}) {
  return {
    schema_version: WORK_ORDER_SCHEMA_VERSION,
    workOrderId: 'WO-NAME-PROBE',
    projectId: 'PRJ_NAME_PROBE',
    lineId: 'line1_bulk',
    modIds: ['l1_qc_matrix'],
    figureSelections: [],
    uploads: [],
    ...extra,
  };
}

function makeNameProbe() {
  const calls = [];
  const request = async (method, requestPath, body) => {
    if (requestPath === '/api/projects/create') {
      calls.push(body);
      return { status: 200, ok: true, body: { ok: true } };
    }
    return { status: 500, ok: false, body: { error: 'stop after create' } };
  };
  return { request, calls, facts: syntheticFacts() };
}

test('合法样例：v1 工单的 requirement 段通过三个校验器', () => {
  const payload = requirementFromExample();

  assert.deepEqual(checkAgainstSchema(payload, REQUIREMENT_SCHEMA), [], 'JSON Schema 应放行');

  const runtime = validateRequirement(payload);
  assert.equal(runtime.ok, true, runtime.errors.join('；'));
  assert.deepEqual(runtime.errors, []);

  const gateway = pydantic(payload);
  assert.equal(gateway.allowed, true, JSON.stringify(gateway.errors));
  assert.equal(gateway.status, 'ALLOW');
  assert.equal(gateway.exitCode, 0);
});

test('负路径：dataSource.source 缺失时三个校验器都拒', () => {
  const payload = clone(requirementFromExample());
  delete payload.dataSource.source;
  assertAllThreeReject(payload, 'source', 'dataSource.source');
});

test('负路径：domain 非法值时三个校验器都拒（枚举跨源一致）', () => {
  // 2026-11-12 真机工单实测：英文 domain 过了门户与工单校验，到服务端建项才 HTTP 400。
  // 三源必须对同一个值给同一个结论，客户与 AI 才不会再在建项阶段撞墙。
  const payload = clone(requirementFromExample());
  payload.basicInfo.domain = 'cardiovascular';

  assert.notDeepEqual(checkAgainstSchema(payload, REQUIREMENT_SCHEMA), [], 'JSON Schema 应拒绝非法 domain');
  const runtime = validateRequirement(payload);
  assert.equal(runtime.ok, false, '共享校验器应拒绝非法 domain');
  assert.ok(runtime.errors.some((item) => item.includes('domain')), runtime.errors.join('；'));
  const gateway = pydantic(payload);
  assert.equal(gateway.allowed, false, 'Pydantic 网关应拒绝非法 domain');
  assert.ok(gateway.errors.some((item) => item.path === 'basicInfo.domain'),
    `网关报错路径应为 basicInfo.domain: ${JSON.stringify(gateway.errors)}`);
});

test('负路径：groupingDesign.mode 缺失时三个校验器都拒', () => {
  const payload = clone(requirementFromExample());
  delete payload.groupingDesign.mode;
  assertAllThreeReject(payload, 'mode', 'groupingDesign.mode');
});

test('负路径：group.sampleIds 缺失时三个校验器都拒', () => {
  const payload = clone(requirementFromExample());
  delete payload.groupingDesign.groups[0].sampleIds;
  assertAllThreeReject(payload, 'sampleIds', 'groupingDesign.groups.0.sampleIds');
});

test('负路径：contrast.name 缺失时三个校验器都拒', () => {
  const payload = clone(requirementFromExample());
  delete payload.groupingDesign.contrasts[0].name;
  assertAllThreeReject(payload, '对比名称', 'groupingDesign.contrasts.0.name');
});

test('建项 name 优先读 basicInfo.name，再回落 order.name 与 projectId', async () => {
  const cases = [
    {
      order: nameProbeOrder({ basicInfo: { name: '中文项目名' }, name: '工单别名' }),
      expected: '中文项目名',
    },
    {
      order: nameProbeOrder({ name: '工单别名' }),
      expected: '工单别名',
    },
    {
      order: nameProbeOrder(),
      expected: 'PRJ_NAME_PROBE',
    },
  ];

  for (const item of cases) {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `work-order-name-${process.pid}-`));
    try {
      const probe = makeNameProbe();
      await runWorkOrder(item.order, {
        request: probe.request,
        repoRoot,
        pollIntervalMs: 0,
        pollMaxAttempts: 1,
        facts: probe.facts,
      });
      assert.equal(probe.calls.length, 1, '建项接口应被调用一次');
      assert.equal(probe.calls[0].name, item.expected);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  }
});
