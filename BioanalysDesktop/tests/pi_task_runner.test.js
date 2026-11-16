/**
 * D4.9 任务执行器契约测试。
 *
 * 判据：
 *   1. WROTE 回执解析（带引号/不带引号），空文件为 0。
 *   2. 验证任务走 3.5GB 档位、adapted + directOutputs。
 *   3. 生产任务走 6.5GB 档位。
 *   4. 审计拒绝 fail-closed。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PI_TASK_MEMORY_GB,
  PI_VALIDATION_MEMORY_GB,
  summarizeWroteReceipts,
  createPiTaskRunner,
} from '../server/services/pi_task_runner.js';
import { buildTaskScript } from '../server/task.js';

function makeRunner({ auditAllowed = true, exitCode = 0, stdout = 'WROTE \'/tmp/a.tsv\' 12\n' } = {}) {
  const calls = { prepare: [], run: [], push: [] };
  const runner = createPiTaskRunner({
    prepareTaskFn: (task, ids) => {
      calls.prepare.push({ task, ids });
      return { script: 'prepared-script', audit: { allowed: auditAllowed, reason: auditAllowed ? '' : 'denied' } };
    },
    runTaskFn: (task, handlers) => {
      calls.run.push(task);
      setTimeout(() => {
        handlers.onStdout?.(stdout);
        handlers.onExit?.(exitCode, {});
      }, 1);
      return { id: 'task-1', kill: () => {} };
    },
    pushScriptFn: async (input) => {
      calls.push.push(input);
      return { remotePath: `/mnt/ssd/bio_data/projects/${input.projectId}/${input.lineId}/scripts/${input.entryPoint}` };
    },
    now: () => 1000,
  });
  return { runner, calls };
}

test('WROTE 回执解析：带引号与不带引号都认，累加字节', () => {
  const text = "WROTE '/tmp/a.tsv' 12\nnoise\nWROTE /tmp/b.tsv 30\nWROTE bad\n";
  assert.deepEqual(summarizeWroteReceipts(text), { count: 2, bytes: 42 });
  assert.deepEqual(summarizeWroteReceipts(''), { count: 0, bytes: 0 });
});

test('验证任务：3.5GB 档位，adapted + directOutputs，解析 WROTE', async () => {
  const { runner, calls } = makeRunner();
  const result = await runner.runValidationTask({
    projectId: 'PRJ_T', lineId: 'line1_bulk', modId: 'l1_qc_matrix',
    entryPoint: 'adapt_1.R', localScriptPath: '/tmp/adapt_1.R',
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.wroteCount, 1);
  assert.equal(result.wroteBytes, 12);
  assert.equal(result.memoryGb, PI_VALIDATION_MEMORY_GB);
  assert.equal(calls.push.length, 1);
  const spec = calls.prepare[0].task;
  assert.equal(spec.adapted, true);
  assert.equal(spec.directOutputs, true);
  assert.equal(spec.language, 'r');
  assert.ok(spec.scriptPath.startsWith('/mnt/ssd/bio_data/projects/PRJ_T/line1_bulk/scripts/'));
  assert.ok(calls.run[0].preparedScript.startsWith('BIO_TASK_MEM_LIMIT_GB=3.5 BIO_VALIDATION_MODE=1 '));
});

test('生产任务：6.5GB 档位', async () => {
  const { runner, calls } = makeRunner();
  const result = await runner.runDispatchTask({
    projectId: 'PRJ_T', lineId: 'line2_scrna', modId: 'l2_qc_cells',
    entryPoint: 'adapt_2.py', localScriptPath: '/tmp/adapt_2.py',
  });
  assert.equal(result.memoryGb, PI_TASK_MEMORY_GB);
  assert.equal(calls.prepare[0].task.language, 'python');
  assert.ok(calls.run[0].preparedScript.startsWith('BIO_TASK_MEM_LIMIT_GB=6.5 '));
});

test('审计拒绝：fail-closed，不执行任务', async () => {
  const { runner, calls } = makeRunner({ auditAllowed: false });
  await assert.rejects(
    () => runner.runValidationTask({
      projectId: 'PRJ_T', lineId: 'line1_bulk', modId: 'l1_qc_matrix',
      entryPoint: 'adapt_3.R', localScriptPath: '/tmp/adapt_3.R',
    }),
    (err) => err.code === 'ERR_TASK_AUDIT_DENIED',
  );
  assert.equal(calls.run.length, 0);
});

test('适配 directOutputs 允许空 outputs，用于验证/自愈探针', () => {
  const script = buildTaskScript({
    projectId: 'PRJ_T',
    lineId: 'line1_bulk',
    step: 'adapt_s2_qc',
    adapted: true,
    directOutputs: true,
    allowEmptyOutputs: true,
    scriptPath: '/mnt/ssd/bio_data/projects/PRJ_T/line1_bulk/scripts/adapt_s2_qc.py',
    language: 'python',
  });
  assert.match(script, /adapt_s2_qc\.py/);
});
