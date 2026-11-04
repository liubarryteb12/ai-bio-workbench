import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareAndAuditTask } from '../server/run.js';

const BASE = {
  projectId: 'default',
  lineId: 'line1_bulk',
  step: 'deg',
  inputs: ['/mnt/ssd/bio_data/projects/default/line1_bulk/processed/a.tsv'],
  outputs: ['/mnt/ssd/bio_data/projects/default/line1_bulk/results/b.tsv'],
  seed: 42,
  adapted: false,
};

// 断言目标：提交层的 400 判定与引擎真正执行的脚本必须是同一份。
// 历史缺陷：提交层审的脚本不带 throttled/detached/wrapperTaskId，引擎层审的带，
// 两条线实测已分叉（.tmp/probe_audit_divergence.mjs）。这里用结构断言钉死合并结果。
test('唯一审计入口产出的脚本带包装器标识与降权形态', () => {
  const prepared = prepareAndAuditTask(BASE, { wrapperTaskId: 'task_fixed_id' });
  assert.equal(typeof prepared.script, 'string');
  assert.ok(prepared.script.includes('task_fixed_id'), '最终脚本必须带提交层生成的 wrapperTaskId');
  assert.match(prepared.script, /BIO_EXEC_CMD/, '最终脚本必须是经包装器的降权形态');
  assert.equal(prepared.audit.allowed, true, '合规路径必须放行');
});

test('缺 wrapperTaskId 直接拒绝，不允许两端各自生成导致再次分叉', () => {
  assert.throws(() => prepareAndAuditTask(BASE, {}), /wrapperTaskId/);
  assert.throws(() => prepareAndAuditTask(BASE), /wrapperTaskId/);
});

test('返回对象被冻结，调用方改不动审计结论', () => {
  const prepared = prepareAndAuditTask(BASE, { wrapperTaskId: 'task_fixed_id' });
  assert.equal(Object.isFrozen(prepared), true);
  assert.equal(Object.isFrozen(prepared.audit), true);
  assert.throws(() => { prepared.audit = { allowed: false }; }, TypeError);
});

test('同一 wrapperTaskId 两次编译产出逐字节相同的脚本（可复现）', () => {
  const a = prepareAndAuditTask(BASE, { wrapperTaskId: 'task_fixed_id' });
  const b = prepareAndAuditTask(BASE, { wrapperTaskId: 'task_fixed_id' });
  assert.equal(a.script, b.script);
});