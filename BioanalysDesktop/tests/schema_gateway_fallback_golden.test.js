/**
 * JS 回退校验网关的行为黄金样例。
 *
 * 真源是 schemas/schema_gateway.py。这里固定四个已注册 Schema 的
 * 放行/拒绝边界，防止桌面离线回退把非法载荷放过去。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWithFallback } from '../server/schema_gateway_fallback.mjs';

function assertAllow(schemaName, payload) {
  const result = validateWithFallback(schemaName, payload);
  assert.equal(result.status, 'ALLOW', JSON.stringify(result.errors));
  assert.equal(result.allowed, true);
  assert.equal(result.exitCode, 0);
}

function assertDeny(schemaName, payload, pathPrefix = '') {
  const result = validateWithFallback(schemaName, payload);
  assert.equal(result.status, 'DENY', JSON.stringify(result.errors));
  assert.equal(result.allowed, false);
  assert.equal(result.exitCode, 2);
  if (pathPrefix) {
    assert.ok(
      result.errors.some((item) => item.path === pathPrefix || item.path.startsWith(`${pathPrefix}.`)),
      `期望错误路径以 ${pathPrefix} 开头，实际 ${JSON.stringify(result.errors)}`,
    );
  }
}

test('project：合法载荷放行，非法 pipeline 与路径穿越拒绝', () => {
  assertAllow('project', {
    project_id: 'PRJ_DESKTOP_001',
    project_name: '桌面验收项目',
    pipeline: 'line1_bulk',
    species: 'Homo sapiens',
  });
  assertDeny('project', { project_id: '../escape', pipeline: 'line1_bulk' }, 'project_id');
  assertDeny('project', { project_id: 'PRJ', pipeline: 'line9_unknown' }, 'pipeline');
  assertDeny('project', { project_id: '' }, 'project_id');
});

const VALID_REQUIREMENT = {
  basicInfo: { name: '缺血性脑卒中', domain: '心脑血管' },
  dataSource: {
    source: 'GEO',
    dataType: 'bulk_rnaseq',
    datasets: [{ gse: 'GSE16561', gpl: 'GPL6883', role: 'train' }],
  },
  groupingDesign: {
    mode: 'case_control',
    groups: [
      { groupName: 'control', role: 'reference', sampleIds: ['GSM1', 'GSM2'] },
      { groupName: 'case', role: 'disease_stage', sampleIds: ['GSM3', 'GSM4'] },
    ],
    contrasts: [{ name: 'case_vs_control', case: 'case', ctrl: 'control', isPrimary: true }],
  },
  analysisCutoffs: { log2fc: 1.0, p: 0.05 },
};

test('requirement：合法载荷放行，枚举与分组边界拒绝', () => {
  assertAllow('requirement', VALID_REQUIREMENT);

  const badDomain = structuredClone(VALID_REQUIREMENT);
  badDomain.basicInfo.domain = '肿瘤';
  assertDeny('requirement', badDomain, 'basicInfo.domain');

  const oneGroup = structuredClone(VALID_REQUIREMENT);
  oneGroup.groupingDesign.groups = [oneGroup.groupingDesign.groups[0]];
  assertDeny('requirement', oneGroup, 'groupingDesign.groups');

  const badRole = structuredClone(VALID_REQUIREMENT);
  badRole.groupingDesign.groups[0].role = 'control';
  assertDeny('requirement', badRole, 'groupingDesign.groups.0.role');

  const noPrimary = structuredClone(VALID_REQUIREMENT);
  delete noPrimary.groupingDesign.contrasts[0].isPrimary;
  assertDeny('requirement', noPrimary, 'groupingDesign.contrasts.0.isPrimary');
});

test('run_task：分析线白名单、必填字段与列表类型拒绝', () => {
  assertAllow('run_task', {
    lineId: 'line2_scrna',
    step: 'scenic_tf',
    projectId: 'PRJ_DESKTOP_001',
    inputs: ['processed/sample.h5ad'],
    outputs: [],
    seed: 42,
  });
  assertDeny('run_task', { lineId: 'line4_unknown', step: 'x', projectId: 'P' }, 'lineId');
  assertDeny('run_task', { lineId: 'line1_bulk', projectId: 'P' }, 'step');
  assertDeny('run_task', { lineId: 'line1_bulk', step: 'x', projectId: 'P', inputs: 'a.h5ad' }, 'inputs');
  assertDeny('run_task', { lineId: 'line1_bulk', step: 'x', projectId: 'P', seed: 1.5 }, 'seed');
});

test('figure_template：ready 三件套与 draft 防伪证互斥锁', () => {
  assertAllow('figure_template', {
    id: 'fig_l1_boxplot',
    status: 'ready',
    producing_mod_id: 'l1_boxplot',
    required_mod_ids: ['l1_boxplot'],
    data_contract: { input_artifact: 'results/expr.tsv', format: 'tsv' },
    preview_sha256: 'a'.repeat(64),
  });
  assertAllow('figure_template', {
    id: 'fig_draft_001',
    status: 'draft',
  });
  assertDeny('figure_template', {
    id: 'fig_l1_boxplot',
    status: 'ready',
    producing_mod_id: 'l1_boxplot',
    data_contract: { input_artifact: 'results/expr.tsv' },
  });
  assertDeny('figure_template', {
    id: 'fig_draft_001',
    status: 'draft',
    preview_sha256: 'a'.repeat(64),
  });
});

test('未注册的 Schema 保持 Fail-Closed', () => {
  const result = validateWithFallback('unknown_schema', {});
  assert.equal(result.status, 'ERROR');
  assert.equal(result.allowed, false);
  assert.equal(result.exitCode, 1);
});
