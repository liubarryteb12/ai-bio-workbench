/**
 * 回归守卫：从 pipelineDag 推断分析线的双形态兼容（mod id / 母版名）。
 *
 * 背景（2026-10-23 mod 化改造 M3）：客户端 mod 化后传的是 mod id（l2_tf_scenic），
 * 而历史提交与 runner 直跑传的是母版名（scenic_tf）。lineFromPipeline 按母版名
 * 比对（LINE_STEPS 派生自注册表的 script 字段），不先翻一层 mod id，
 * 全部步骤都会失配、分析线推断为空，建项直接失败。
 *
 * 为什么用 spawn 子进程而不是 import：index.js 顶层无条件 server.listen，
 * import 会占端口。这里起一个临时端口实例，用 /api/workflows/resolve 的
 * 姊妹路径间接验证——不，直接验证导出的纯函数更准，故用子进程 + 探针导出。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../server/index.js', import.meta.url));

/**
 * 经 LINE_INFER_PROBE 探针直接调 lineFromPipeline。
 *
 * 为什么不走 HTTP：lineId 失配只在"有 dataFiles 时才报错"，manifest 不带 dataFiles
 * 时那条错误路径根本不执行，HTTP 断言会假绿（2026-10-23 实测踩坑：去掉映射后
 * 3 条 HTTP 用例仍全绿）。探针直接验证纯函数，失配即红。
 */
function infer(dag) {
  const r = spawnSync(process.execPath, [SERVER], {
    env: { ...process.env, LINE_INFER_PROBE: JSON.stringify(dag) },
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(r.status, 0, `探针退出非 0: ${r.stderr?.slice(0, 300)}`);
  return r.stdout.trim();
}

test('mod id 形态推断出 line2_scrna', () => {
  assert.equal(infer([
    { order: 1, stepId: 'l2_ingest_counts' },
    { order: 2, stepId: 'l2_tf_scenic' },
    { order: 3, stepId: 'l2_ko_virtual' },
  ]), 'line2_scrna');
});

test('母版名形态仍能推断（历史提交不回归）', () => {
  assert.equal(infer([
    { order: 1, stepId: 'ingest_counts' },
    { order: 2, stepId: 'scenic_tf' },
    { order: 3, stepId: 'virtual_knockout' },
  ]), 'line2_scrna');
});

test('line1 / line3 的 mod id 形态各自推断正确', () => {
  assert.equal(infer([
    { order: 1, stepId: 'l1_ingest_prep' },
    { order: 2, stepId: 'l1_de_limma' },
  ]), 'line1_bulk');
  assert.equal(infer([
    { order: 1, stepId: 'l3_ingest_spatial' },
    { order: 2, stepId: 'l3_ko_spatial' },
  ]), 'line3_spatial');
});

test('混合形态也能推断（新旧 id 混用）', () => {
  assert.equal(infer([
    { order: 1, stepId: 'l2_ingest_counts' },
    { order: 2, stepId: 'scenic_tf' },
  ]), 'line2_scrna');
});

test('空 dag 与未知 stepId 都不崩', () => {
  assert.equal(infer([]), '');
  assert.equal(infer([{ order: 1, stepId: 'totally_unknown_step' }]), '');
});

test('静态守卫：lineFromPipeline 必须先经 mod id 映射再比对', async () => {
  const src = await readFile(SERVER, 'utf8');
  assert.match(src, /modToScriptMap\(\)/, 'lineFromPipeline 必须调用 modToScriptMap 做双形态兼容');
  assert.match(src, /modToScript\.get\(s\)\s*\|\|\s*s/, '未命中映射时必须回落到原值（母版名形态）');
});
