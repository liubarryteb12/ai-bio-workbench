/**
 * 回归守卫：建项 manifest 的两种步骤形态（旧 pipelineDag / 新 seriesId+modIds）。
 *
 * 背景（2026-10-23 mod 化改造 M3）：客户端 mod 化后只传 seriesId + modIds + koGene，
 * 不再传 pipelineDag。服务台内部一律消费 pipeline_dag，所以要有个合成层。
 *
 * 实测踩过的三处契约缺口（都已修，本测试钉住）：
 *   1. index.js 建项路由没透传 seriesId / modIds / koGene → 步骤选择到服务台就丢；
 *   2. strict 校验要求 lineId，而新客户端只有 seriesId → 建项直接被拒；
 *   3. R12 敲除校验按 stepId 含 'knockout' 匹配，新 mod id 是 l2_ko_virtual，
 *      不含该字样 → 漏检，要跑到 virtual_knockout 步才失败。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(import.meta.url);
const TESTS_DIR = path.dirname(HERE);
const SERVER = path.resolve(TESTS_DIR, '..', 'server', 'index.js');
const PROJECT = path.resolve(TESTS_DIR, '..', 'server', 'project.js');

const L2_MIN = [
  'l2_ingest_counts', 'l2_qc_cells', 'l2_qc_normalize',
  'l2_integrate_harmony', 'l2_integrate_cluster', 'l2_integrate_annotate',
  'l2_profile_composition', 'l2_profile_deg',
];

test('buildPipelineDag：新形态按阶段排序并翻成母版名，保留 mod_id 双列', async () => {
  const { buildPipelineDag } = await import('../server/project.js');
  // 故意打乱顺序，还先给敲除（阶段 order 最大），验证排序生效
  const dag = buildPipelineDag({
    seriesId: 'line2_scrna',
    modIds: ['l2_ko_virtual', 'l2_profile_deg', 'l2_ingest_counts'],
  });
  assert.equal(dag.length, 3);
  assert.deepEqual(dag.map((d) => d.stepId),
    ['ingest_counts', 'deg_groups', 'virtual_knockout'], '必须按阶段 order 排序');
  assert.deepEqual(dag.map((d) => d.mod_id),
    ['l2_ingest_counts', 'l2_profile_deg', 'l2_ko_virtual'], 'mod_id 双列必须保留');
  assert.deepEqual(dag.map((d) => d.order), [1, 2, 3], 'order 必须连续');
});

test('buildPipelineDag：旧形态原样返回，空形态返回 null', async () => {
  const { buildPipelineDag } = await import('../server/project.js');
  const legacy = [{ order: 1, stepId: 'scenic_tf' }];
  assert.deepEqual(buildPipelineDag({ pipelineDag: legacy }), legacy);
  assert.equal(buildPipelineDag({}), null);
});

test('buildPipelineDag：未知 seriesId 必须抛错（不许静默产出空 dag）', async () => {
  const { buildPipelineDag } = await import('../server/project.js');
  assert.throws(() => buildPipelineDag({ seriesId: 'no_such_line', modIds: ['x'] }), /seriesId 未知/);
});

test('静态守卫：建项路由必须透传 seriesId / modIds / koGene', async () => {
  const src = await readFile(SERVER, 'utf8');
  for (const field of ['seriesId: requested.seriesId', 'modIds: requested.modIds', 'koGene: requested.koGene']) {
    assert.ok(src.includes(field), `建项路由缺少透传: ${field}`);
  }
  // seriesId 必须能当 lineId 用，否则 strict 校验直接拒掉新客户端
  assert.match(src, /lineId: requested\.lineId \|\| requested\.seriesId/,
    'lineId 必须回落到 seriesId');
});

test('静态守卫：敲除校验必须认新 mod id 命名', async () => {
  const src = await readFile(PROJECT, 'utf8');
  // 母版名含 knockout，mod id 是 l2_ko_virtual / l3_ko_spatial，两套都要认
  assert.match(src, /id\.includes\('knockout'\)/, '必须保留母版名 knockout 匹配');
  assert.match(src, /_ko_/, '必须新增 mod id 的 _ko_ 匹配');
  // 必须用合成后的 dag 做校验，不能裸读 params.pipelineDag
  assert.match(src, /const dag = buildPipelineDag\(params\) \|\| \[\]/,
    'R12 校验必须基于 buildPipelineDag，否则新形态整条敲除校验被跳过');
});

test('静态守卫：koGene 必须并入 biologicalPriors', async () => {
  const src = await readFile(PROJECT, 'utf8');
  assert.match(src, /target_ko_gene: String\(params\.koGene \|\| ''\)\.trim\(\)/,
    'params.koGene 必须并进 biological_priors.target_ko_gene');
});

test('端到端：新形态 manifest 走 LINE_INFER_PROBE 能推断出分析线', async () => {
  // 与 pipeline_line_infer.test.js 同一探针；这里专门验"合成后的 dag"可被推断
  const { spawnSync } = await import('node:child_process');
  const { buildPipelineDag } = await import('../server/project.js');
  const dag = buildPipelineDag({ seriesId: 'line2_scrna', modIds: L2_MIN });
  const r = spawnSync(process.execPath, [SERVER], {
    env: { ...process.env, LINE_INFER_PROBE: JSON.stringify(dag) },
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(r.status, 0, `探针退出非 0: ${r.stderr?.slice(0, 300)}`);
  assert.equal(r.stdout.trim(), 'line2_scrna');
});
