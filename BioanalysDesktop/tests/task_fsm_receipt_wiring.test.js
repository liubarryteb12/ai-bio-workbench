/**
 * Q3 收口：exit 0 但台账无 WROTE 回执，不得被报成 completed。
 *
 * 历史状态：persistEntry 是 fire-and-forget，失败只打一行日志，
 * onExit 早已带着 status=completed 返回，台账静默丢失无人知晓。
 * 现在把回执失败交给 FSM 判成 RECEIPT_MISSING，并同步在 entry 上打标记、
 * 发 onReceiptMissing 可机读事件。onExit 仍保持同步（既有契约不动）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';

import { runTask, buildLedgerWriteCommand } from '../server/run.js';

function makeChild(emitWrote) {
  const child = new EventEmitter();
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  const chunks = [];
  child.stdin = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
  });
  child.kill = () => {};
  child.stdin.on('finish', () => {
    setImmediate(() => {
      // 关键变异：无 WROTE 回执，模拟远端命令被截断 / 落盘没执行
      if (emitWrote) {
        const encoded = Buffer.concat(chunks).toString('utf8');
        const payload = Buffer.from(encoded, 'base64').toString('utf8');
        // 回执路径必须与真实落盘命令一致：persistReceiptMarker 做的是前缀逐字比对，
        // 写死路径会被判成「无 WROTE 标记」，那是夹具错而不是实现错。
        const { remotePath } = buildLedgerWriteCommand(JSON.parse(payload));
        child.stdout.push(`WROTE '${remotePath}' ${Buffer.byteLength(payload, 'utf8')}\n`);
      }
      child.stdout.push(null);
      child.stderr.push(null);
      child.emit('exit', 0, null);
    });
  });
  return child;
}

function runWithReceipt(emitWrote, t) {
  const taskChild = new EventEmitter();
  taskChild.stdout = new Readable({ read() {} });
  taskChild.stderr = new Readable({ read() {} });
  taskChild.kill = () => {};
  setImmediate(() => taskChild.emit('exit', 0, null));

  t.mock.method(childProcess, 'spawn', (_program, args) => {
    const joined = (args || []).join(' ');
    if (joined.includes('mkdir -p')) return makeChild(emitWrote);
    return taskChild;
  });
  t.mock.method(childProcess, 'spawnSync', () => ({
    status: 0, stdout: 'RUNNING\n', stderr: '',
  }));

  const events = [];
  runTask(
    {
      projectId: 'default',
      lineId: 'line1_bulk',
      step: 'qc_matrix',
      inputs: [],
      outputs: [],
      seed: 7,
    },
    {
      onStderr: (text) => events.push(['stderr', text]),
      onExit: (code, entry) => events.push(['exit', code, entry]),
      onReceiptMissing: (e) => events.push(['missing', e]),
    }
  );
  return events;
}

test('exit 0 但无 WROTE 回执：FSM 判 RECEIPT_MISSING 并修正 entry', async (t) => {
  const events = runWithReceipt(false, t);
  // 等 fire-and-forget 的 persistEntry 走完
  await new Promise((resolve) => setTimeout(resolve, 60));

  const exit = events.find((e) => e[0] === 'exit');
  assert.ok(exit, 'onExit 应同步触发');
  assert.equal(exit[1], 0);
  const entry = exit[2];
  // entry 是同一个引用，rejection 里的修正必须能被上层读到
  assert.equal(entry.ledger_receipt, 'missing');
  assert.equal(entry.status, 'failed', '无回执不得报 completed');
  assert.equal(entry.checkpoint_status, 'failed');
  assert.equal(entry.receipt_failure_reason, 'RECEIPT_MISSING');

  const missing = events.find((e) => e[0] === 'missing');
  assert.ok(missing, '应发出 onReceiptMissing 事件');
  assert.equal(missing[1].reason, 'RECEIPT_MISSING');
  assert.equal(missing[1].state, 'failed');
  assert.equal(missing[1].retryable, false);
});

test('有 WROTE 回执：entry 标 confirmed，不发 receipt-missing 事件', async (t) => {
  const events = runWithReceipt(true, t);
  await new Promise((resolve) => setTimeout(resolve, 60));

  const exit = events.find((e) => e[0] === 'exit');
  assert.ok(exit);
  assert.equal(exit[2].ledger_receipt, 'confirmed');
  assert.equal(exit[2].status, 'completed');
  assert.equal(events.some((e) => e[0] === 'missing'), false,
    '有回执不应误报缺失');
});