import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { REPO_ROOT, buildMatrix } from '../../ops/module_ablation_matrix.mjs';

const read = (relativePath) => fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');

test('真源矩阵覆盖 54 个模块与三条分析线', () => {
  const matrix = buildMatrix();
  assert.equal(matrix.counts.modules, 54);
  assert.equal(matrix.counts.lines, 3);
  assert.equal(matrix.rows.length, 54);
  assert.equal(new Set(matrix.rows.map((row) => row.line)).size, 3);
});

test('每个模块都有母版、requires、produces、seed 与退出码契约', () => {
  const matrix = buildMatrix();
  for (const row of matrix.rows) {
    assert.deepEqual(row.issues, [], `${row.id}: ${row.issues.join('; ')}`);
    assert.ok(row.independence.minimal_inputs.length > 0);
    assert.ok(row.independence.outputs.length > 0);
    assert.equal(typeof row.independence.seed, 'number');
    assert.match(row.independence.exit_codes, /137|143/);
  }
});

test('相邻模块兼容性按 requires/produces 闭合，无悬空或跨线边', () => {
  const matrix = buildMatrix();
  assert.ok(matrix.counts.edges > 54);
  const bad = matrix.edges.filter((edge) => edge.status !== 'compatible' && edge.status !== 'raw');
  assert.deepEqual(bad, []);
  for (const edge of matrix.edges.filter((item) => item.format === 'h5ad')) {
    assert.ok(edge.checks.some((check) => check.startsWith('h5ad:obs:')));
    assert.ok(edge.checks.includes('cross_language_bridge:guard_wired'));
  }
});

test('remove-one-module 与八类故障逐模块 fail closed', () => {
  const matrix = buildMatrix();
  assert.equal(matrix.counts.scenarios, 54 * 9);
  assert.ok(matrix.scenarios.every((item) => item.fail_closed));
  for (const defect of [
    'remove_registration', 'remove_master', 'remove_requires', 'remove_produces',
    'empty_result', 'missing_upstream', 'wrong_upstream', 'stale_upstream',
    'cross_line_reference',
  ]) {
    assert.equal(matrix.scenarios.filter((item) => item.defect === defect).length, 54, defect);
  }
});

test('图件消费只允许 Ready 单图，退役组合图不得带证据', () => {
  const matrix = buildMatrix();
  assert.equal(matrix.counts.ready_figures, 39);
  assert.deepEqual(matrix.figures.issues, []);
  const templates = JSON.parse(read('src/figure_templates.json')).templates;
  for (const id of ['fig_l3_multipanel', 'fig_l3_combinationpanel', 'fig_l3_sankeybubbleplot']) {
    const template = templates.find((item) => item.id === id);
    assert.notEqual(template.status, 'ready');
    assert.equal(template.preview_sha256, null);
    assert.equal(template.render_evidence, null);
  }
});

test('跨线桥只放行 public_references 冻结签名表', () => {
  const workflows = JSON.parse(read('src/workflows.json'));
  const bridges = workflows.constraints.allowed_cross_series_bridges || [];
  assert.equal(bridges.length, 1);
  assert.match(bridges[0].path, /^public_references\/celltype_signatures\//);
  assert.equal(read('ops/isolated_bridge_gate.mjs').includes('public_references/celltype_signatures'), true);
});

test('报告与门禁包装器存在且以成功哨兵结束', () => {
  const report = read('docs/MODULE_ABLATION_MATRIX.md');
  assert.match(report, /MODULE_ABLATION_MATRIX_OK/);
  assert.match(report, /## 逐模块表/);
  assert.match(report, /## 缺口清单/);
  const gate = read('ops/module_ablation_matrix_gate.mjs');
  assert.match(gate, /MODULE_ABLATION_MATRIX_GATE_OK/);
});

test('静态守卫与现有门禁真源相接，不另造第二份规则', () => {
  const matrix = buildMatrix();
  assert.equal(matrix.counts.guards, 4);
  assert.ok(matrix.guards.every((guard) => guard.exists && guard.guard_pattern));
  const source = read('ops/module_ablation_matrix.mjs');
  assert.match(source, /workflows\.json/);
  assert.match(source, /figure_templates\.json/);
  assert.match(source, /isolated_bridge_gate/);
  assert.match(source, /mutation_gate/);
});

test('空结果与旧版本上游不得判成成功', () => {
  const matrix = buildMatrix();
  for (const defect of ['empty_result', 'stale_upstream']) {
    const scenario = matrix.scenarios.find((item) => item.defect === defect);
    assert.match(scenario.guard, /task_fsm|ledger_receipt/);
    assert.equal(scenario.fail_closed, true);
  }
});

test('单模块独立运行报告最小输入、产物与上游闭包', () => {
  const matrix = buildMatrix();
  for (const row of matrix.rows) {
    assert.ok(Array.isArray(row.independence.minimal_inputs));
    assert.ok(Array.isArray(row.independence.outputs));
    assert.ok(Array.isArray(row.independence.upstream_closure));
    assert.equal(typeof row.independence.isolated_run, 'boolean');
  }
  const first = matrix.rows.find((row) => row.line === 'line1_bulk');
  assert.equal(first.independence.isolated_run, true);
});

test('tSV 与 h5ad 兼容性检查覆盖声明的必需列和键', () => {
  const matrix = buildMatrix();
  const tsv = matrix.edges.filter((edge) => edge.format === 'tsv');
  const h5ad = matrix.edges.filter((edge) => edge.format === 'h5ad');
  assert.ok(tsv.length > 0);
  assert.ok(h5ad.length > 0);
  assert.ok(tsv.every((edge) => edge.checks.some((check) => check.includes('gene_symbol'))));
  assert.ok(h5ad.every((edge) => edge.checks.some((check) => check.includes('h5ad:obsm:'))));
});

test('总门禁清单纳入模块消融门禁', () => {
  const gates = read('ops/run_all_gates.mjs');
  assert.match(gates, /module_ablation_matrix/);
  const test = read('BioanalysDesktop/tests/run_all_gates.test.js');
  assert.match(test, /'module_ablation_matrix'/);
});
