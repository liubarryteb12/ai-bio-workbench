/**
 * 失败取证契约（2026-11-12）：门禁中止的真因必须进台账，不能再吞成"stderr 为空"。
 *
 * 真机实测（PRJ_REAL_SOLO_20261112_R2）：设备剩余 18% 触发存储水位门禁 exit 1，
 * 包装器在把任务输出重定向进 LOG_FILE **之前**就中止，因此真因只在 stdout，
 * 引擎只看 stderr，回执与台账里得到的是「stderr 为空，退出码非零」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

import { composeFailureEvidence, runTask } from '../server/run.js';

const GATE_TEXT = '[ERROR] 原生存储剩余空间低于安全阈值：剩余 18%, 要求 >= 20%.\n[ABORT] 触发 F2FS 前台 GC 保护门禁，阻断新任务提交。';

test('stderr 有内容时优先取 stderr，正文原样保留', () => {
  const out = composeFailureEvidence({ exitCode: 1, stderrText: 'Rscript: object not found\n', stdoutText: GATE_TEXT });
  assert.equal(out, 'Rscript: object not found');
});

test('stderr 为空时兜底取 stdout，并标注来源', () => {
  const out = composeFailureEvidence({ exitCode: 1, stderrText: '   \n', stdoutText: GATE_TEXT });
  assert.match(out, /^\[stdout\]/);
  assert.match(out, /存储剩余空间低于安全阈值/);
  assert.match(out, /F2FS/);
});

test('ssh 噪声行不进取证正文（与既有 stripSshNoise 同口径）', () => {
  const out = composeFailureEvidence({
    exitCode: 1,
    stderrText: "Warning: Permanently added '[127.0.0.1]:10022' to the list of known hosts.\n",
    stdoutText: GATE_TEXT,
  });
  assert.ok(!out.includes('Warning: Permanently added'), out);
  assert.match(out, /F2FS/);
});

test('两条流都空时诚实留占位，并带上退出码', () => {
  const out = composeFailureEvidence({ exitCode: 4, stderrText: '', stdoutText: '' });
  assert.match(out, /stdout 与 stderr 均无内容/);
  assert.match(out, /退出码 4/);
  assert.ok(!out.includes('stderr 为空，退出码非零'), '旧文案不应再出现在新路径上');
});

test('占位文案把任务日志说成条件线索，不写成确定的取证位置', () => {
  const out = composeFailureEvidence({ exitCode: 1, stderrText: '', stdoutText: '', logFile: '/logs/task_x.log' });
  assert.match(out, /若执行体已启动/);
  assert.match(out, /\/logs\/task_x\.log/);
});

/**
 * 行为级反证：真因只在 stdout 时，台账 entry.error_log 必须带上它。
 *
 * 纯函数测试抓不到「接线被拆回只看 stderr」，这条走完整 runTask 链路，
 * 从 onExit 直接拿台账条目断言。2026-11-12 用它做过变异：把 finishTask 退回
 * 旧取证写法，本条立刻变红。
 */
test('门禁中止（真因在 stdout）时台账必须记到存储水位，不再记成 stderr 为空', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bio-evidence-'));
  const previousAdapter = process.env.BIO_COMPUTE_ADAPTER;
  const previousActions = process.env.BIO_ACTIONS_LEDGER;
  process.env.BIO_COMPUTE_ADAPTER = 'adb';
  process.env.BIO_ACTIONS_LEDGER = path.join(dir, 'actions.jsonl');
  t.after(() => {
    if (previousAdapter === undefined) delete process.env.BIO_COMPUTE_ADAPTER;
    else process.env.BIO_COMPUTE_ADAPTER = previousAdapter;
    if (previousActions === undefined) delete process.env.BIO_ACTIONS_LEDGER;
    else process.env.BIO_ACTIONS_LEDGER = previousActions;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // 台账落盘与远端探针都不需要真实结果：本条只断言 entry 构造出来的取证正文
  t.mock.method(childProcess, 'spawnSync', () => ({ status: 0, stdout: '', stderr: '', error: undefined }));
  t.mock.method(childProcess, 'spawn', () => {
    const child = new EventEmitter();
    child.stdout = new Readable({ read() {} });
    child.stderr = new Readable({ read() {} });
    child.stdin = { write() {}, end() {}, on() {} };
    child.kill = () => {};
    setImmediate(() => {
      child.stdout.push(`${GATE_TEXT}\n`);
      child.stdout.push(null);
      child.stderr.push(null);
      setImmediate(() => child.emit('exit', 1, null));
    });
    return child;
  });

  const entry = await new Promise((resolve) => {
    runTask({
      projectId: 'default',
      lineId: 'line1_bulk',
      step: 'prep_matrix',
      inputs: [],
      outputs: [],
      seed: 20261112,
    }, { onExit: (_code, ledgerEntry) => resolve(ledgerEntry) });
  });

  assert.equal(entry.status, 'failed');
  assert.match(entry.error_log, /存储剩余空间低于安全阈值/, `取证正文没带门禁真因: ${entry.error_log}`);
  assert.ok(!/stderr 为空，退出码非零/.test(entry.error_log),
    `旧的空取证不应出现: ${entry.error_log}`);
});
