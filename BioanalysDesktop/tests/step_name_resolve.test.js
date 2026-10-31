/**
 * 回归守卫：任务下发层的 mod id -> 母版名归一化（M3 最后一环）。
 *
 * 背景（2026-10-23）：mod 化后客户端与 pipeline_dag 用 mod id（l2_tf_scenic），
 * 而远端 bin/<line>/ 与本地 src/<line>/scripts/ 部署的都是母版名（scenic_tf）。
 * 下发时不翻一层，任务会在 bin/ 下找不到文件。
 *
 * 台账双列：step_name 一律记母版名（61 条历史台账都是母版名，混用会让巡检与审计失配），
 * mod_id 额外保留客户视角追溯。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStepName, buildTaskScript, buildLedgerEntry } from '../server/task.js';
import { modToScriptMap, scriptToModMap } from '../server/workflow_graph.js';

/** mod id 前缀数字 -> 线 id。 */
function lineOf(modId) {
  const n = modId.match(/^l(\d)_/)[1];
  return `line${n}_${n === '1' ? 'bulk' : (n === '2' ? 'scrna' : 'spatial')}`;
}

test('resolveStepName：mod id 翻母版名，母版名原样', () => {
  assert.equal(resolveStepName('l2_tf_scenic'), 'scenic_tf');
  assert.equal(resolveStepName('l1_ingest_prep'), 'prep_matrix');
  assert.equal(resolveStepName('l3_ko_spatial'), 'spatial_knockout');
  // 母版名必须原样返回：历史调用方与 runner 直跑都传母版名
  assert.equal(resolveStepName('scenic_tf'), 'scenic_tf');
  assert.equal(resolveStepName('prep_matrix'), 'prep_matrix');
  // 空值与未知值不抛、原样返回（由下游 bin/ 不存在去报错，这里不做猜测）
  assert.equal(resolveStepName(''), '');
  assert.equal(resolveStepName('l2_no_such_mod'), 'l2_no_such_mod');
});

test('双向映射逐条对账，且键必须带 lineId', () => {
  const fwd = modToScriptMap();
  assert.equal(fwd.get('l2_tf_scenic'), 'scenic_tf', 'modToScriptMap 是 mod id -> 母版名');
  for (const [modId, script] of fwd) {
    const lineId = lineOf(modId);
    assert.equal(scriptToModMap(lineId).get(`${lineId}:${script}`), modId,
      `${modId} <-> ${lineId}/${script} 反向映射不一致`);
  }
});

test('跨线同名母版不得串线（enrichment_figures 在三线都存在）', () => {
  // 这个母版名在 line1/line2/line3 都有，键不带线别会让后加载的线覆盖前一条，
  // line1 的 l1_enrich_figures 永远反查不到（2026-10-23 实测缺陷）。
  const ids = ['line1_bulk', 'line2_scrna', 'line3_spatial'].map(
    (l) => scriptToModMap(l).get(`${l}:enrichment_figures`),
  );
  assert.deepEqual(ids, ['l1_enrich_figures', 'l2_branches_enrich_fig', 'l3_branches_enrich_fig']);
  assert.equal(new Set(ids).size, 3, '三条线的 mod id 必须互不相同');
});

test('buildTaskScript：mod id 下发时命令里必须是母版名', () => {
  const script = buildTaskScript({
    projectId: 'default', lineId: 'line2_scrna', step: 'l2_tf_scenic',
    inputs: ['/mnt/ssd/x.h5ad'], outputs: [], seed: 20261013, throttled: true,
  });
  // 命令串、wrapper 的 step 参数、bin 路径三处都必须是母版名
  assert.match(script, /BIO_EXEC_CMD=.*scenic_tf/, 'BIO_EXEC_CMD 必须是母版名');
  assert.ok(script.includes("line2_scrna 'scenic_tf' self"), 'wrapper 的 step 参数必须是母版名');
  assert.ok(script.includes('/mnt/ssd/bio_data/bin/line2_scrna/scenic_tf'), 'bin 路径必须是母版名');
  // 整个命令里不许残留 mod id，否则远端必然 command not found
  assert.ok(!/l2_tf_scenic/.test(script), '下发命令中不得残留 mod id');
});

test('buildTaskScript：母版名下发的命令与历史一致', () => {
  const script = buildTaskScript({
    projectId: 'default', lineId: 'line2_scrna', step: 'scenic_tf',
    inputs: [], outputs: [], seed: 20261013, throttled: false,
  });
  assert.match(script, /scenic_tf/);
  assert.ok(!/l2_tf_scenic/.test(script), '母版名路径不该引入 mod id');
});

test('buildLedgerEntry：step_name 记母版名，mod_id 双列保留', () => {
  const fromMod = buildLedgerEntry({
    projectId: 'default', lineId: 'line2_scrna', step: 'l2_tf_scenic',
    status: 'completed', exitCode: 0,
  });
  assert.equal(fromMod.step_name, 'scenic_tf', 'step_name 必须与历史台账同口径（母版名）');
  assert.equal(fromMod.mod_id, 'l2_tf_scenic', 'mod_id 必须保留客户视角');

  const fromScript = buildLedgerEntry({
    projectId: 'default', lineId: 'line2_scrna', step: 'scenic_tf',
    status: 'completed', exitCode: 0,
  });
  assert.equal(fromScript.step_name, 'scenic_tf');
  assert.equal(fromScript.mod_id, 'l2_tf_scenic', '母版名调用也应能反查出 mod id');
});

test('buildLedgerEntry：跨线同母版名的 mod_id 必须按 lineId 取，不串线', () => {
  const l1 = buildLedgerEntry({
    projectId: 'default', lineId: 'line1_bulk', step: 'enrichment_figures',
    status: 'completed', exitCode: 0,
  });
  const l2 = buildLedgerEntry({
    projectId: 'default', lineId: 'line2_scrna', step: 'enrichment_figures',
    status: 'completed', exitCode: 0,
  });
  assert.equal(l1.mod_id, 'l1_enrich_figures', 'line1 的反查不能串到别的线');
  assert.equal(l2.mod_id, 'l2_branches_enrich_fig');
});

test('buildLedgerEntry：失败仍必须带 error_log（既有铁律不回归）', () => {
  assert.throws(() => buildLedgerEntry({
    projectId: 'default', lineId: 'line2_scrna', step: 'l2_tf_scenic',
    status: 'failed',
  }), /errorLog/);
});
