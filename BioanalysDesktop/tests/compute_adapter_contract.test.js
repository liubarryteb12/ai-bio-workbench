/**
 * 计算面通道契约：ADB 单通道、SSH 封存、mock 测试。
 *
 * 这组断言钉住四件事：
 *   1. 未设置 BIO_COMPUTE_ADAPTER 时 computeMode 返回 adb；
 *   2. 显式 ssh 已封存，未知值在 resolve 时 fail-closed；
 *   3. remote_exec 固定调用 adbRaw；
 *   4. 文档写明 SSH 封存目录与恢复手册。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  ADB_EXEC_SCRIPT, REPO_ROOT, adbRaw, computeMode, resolveComputeAdapter,
  runExecStream, runStream, sshArgv,
} from '../server/proc.js';
import { runRemoteRaw } from '../server/remote_exec.js';

function restoreEnv(t, keys) {
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  return previous;
}

function setAdapter(t, value) {
  const keys = ['BIO_COMPUTE_ADAPTER', 'BIO_ALLOW_MOCK_COMPUTE'];
  restoreEnv(t, keys);
  if (value === undefined) delete process.env.BIO_COMPUTE_ADAPTER;
  else process.env.BIO_COMPUTE_ADAPTER = value;
  delete process.env.BIO_ALLOW_MOCK_COMPUTE;
}

test('computeMode：未设置时默认 adb，显式 ssh 已封存', () => {
  const saved = process.env.BIO_COMPUTE_ADAPTER;
  try {
    delete process.env.BIO_COMPUTE_ADAPTER;
    assert.equal(computeMode(), 'adb', '未设置时必须默认 ADB 主通道');
    process.env.BIO_COMPUTE_ADAPTER = 'adb';
    assert.equal(computeMode(), 'adb');
    process.env.BIO_COMPUTE_ADAPTER = 'ssh';
    assert.throws(() => computeMode(), /SSH 通道已封存/);
  } finally {
    if (saved === undefined) delete process.env.BIO_COMPUTE_ADAPTER;
    else process.env.BIO_COMPUTE_ADAPTER = saved;
  }
});

test('resolveComputeAdapter：接受 adb，ssh 封存，未知值 fail-closed', () => {
  const saved = process.env.BIO_COMPUTE_ADAPTER;
  try {
    delete process.env.BIO_COMPUTE_ADAPTER;
    assert.equal(resolveComputeAdapter(), 'adb');
    process.env.BIO_COMPUTE_ADAPTER = 'ssh';
    assert.throws(() => resolveComputeAdapter(), /SSH 通道已封存/);
    process.env.BIO_COMPUTE_ADAPTER = 'bash';
    assert.throws(
      () => resolveComputeAdapter(),
      /BIO_COMPUTE_ADAPTER 仅接受 adb \/ mock/,
    );
  } finally {
    if (saved === undefined) delete process.env.BIO_COMPUTE_ADAPTER;
    else process.env.BIO_COMPUTE_ADAPTER = saved;
  }
});

test('runRemoteRaw 默认调用 adbRaw：pwsh + tools/ops/adb_exec.ps1 + Transport adb', (t) => {
  setAdapter(t, undefined);
  const calls = [];
  t.mock.method(childProcess, 'spawnSync', (program, args, options) => {
    calls.push({ program, args, options });
    return { status: 0, stdout: 'DEFAULT_ADB_OK\n', stderr: '', error: null };
  });

  const result = runRemoteRaw('echo DEFAULT_ADB_OK');

  assert.deepEqual(result, { code: 0, text: 'DEFAULT_ADB_OK' });
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.program, 'pwsh');
  assert.ok(call.args.includes('-NoProfile'));
  assert.equal(call.args[call.args.indexOf('-File') + 1], ADB_EXEC_SCRIPT);
  assert.equal(call.args[call.args.indexOf('-Level') + 1], 'ubuntu');
  assert.equal(call.args[call.args.indexOf('-Transport') + 1], 'adb');
  assert.ok(call.args.includes('-RequireAdb'));
  assert.equal(call.args[call.args.indexOf('-Command') + 1], 'echo DEFAULT_ADB_OK');
  assert.equal(call.options.cwd, REPO_ROOT, 'adbRaw 必须在仓库根执行');
});

test('runRemoteRaw 固定走 adbRaw，显式 ssh 配置 fail-closed', (t) => {
  setAdapter(t, 'ssh');
  const calls = [];
  t.mock.method(childProcess, 'spawnSync', (program, args) => {
    calls.push({ program, args });
    return { status: 0, stdout: '', stderr: '', error: null };
  });

  assert.throws(() => runRemoteRaw('echo ADB_OK'), /SSH 通道已封存/);
  assert.equal(calls.length, 0);
});

test('未知适配器在执行时 fail-closed，不悄悄发起任何通道', (t) => {
  setAdapter(t, 'bash');
  let spawned = 0;
  t.mock.method(childProcess, 'spawnSync', () => {
    spawned += 1;
    return { status: 0, stdout: '', stderr: '', error: null };
  });

  assert.throws(
    () => runRemoteRaw('echo should-not-run'),
    /BIO_COMPUTE_ADAPTER 仅接受 adb \/ mock/,
  );
  assert.equal(spawned, 0, '非法配置不得启动任何子进程');
});

test('adbRaw 多行命令改走 -ScriptPath，不把多行内容塞进 argv', (t) => {
  setAdapter(t, 'adb');
  let seen = null;
  t.mock.method(childProcess, 'spawnSync', (program, args, options) => {
    const scriptIndex = args.indexOf('-ScriptPath');
    const scriptPath = scriptIndex >= 0 ? args[scriptIndex + 1] : null;
    seen = {
      program,
      args,
      options,
      scriptPath,
      scriptText: scriptPath ? fs.readFileSync(scriptPath, 'utf8') : null,
    };
    return { status: 0, stdout: 'SCRIPT_OK\n', stderr: '', error: null };
  });

  const result = adbRaw('echo one\necho two');

  assert.deepEqual(result, { code: 0, text: 'SCRIPT_OK' });
  assert.equal(seen.program, 'pwsh');
  assert.ok(seen.scriptPath, '多行命令必须落临时 .sh');
  assert.equal(seen.args.includes('-Command'), false, '多行命令不得进 -Command');
  assert.equal(seen.scriptText, 'echo one\necho two');
  assert.equal(fs.existsSync(seen.scriptPath), false, '执行后临时脚本必须清理');
});

test('README 与通道策略写明 ADB 单通道与 SSH 封存', () => {
  const readme = fs.readFileSync(path.join(REPO_ROOT, 'BioanalysDesktop', 'README.md'), 'utf8');
  assert.match(readme, /默认经 ADB/, 'README 必须写明默认经 ADB');
  assert.doesNotMatch(readme, /所有计算命令经 ssh/, 'README 不得再宣称所有计算经 ssh');

  const policy = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'remote_channel_policy.md'), 'utf8');
  assert.match(policy, /ADB 单通道/, '策略文档必须写明 ADB 单通道');
  assert.match(policy, /ssh_retired_20261111/, '策略文档必须写明 SSH 封存目录');
  assert.match(policy, /无 `auto` 回落路径/, '策略文档必须写明不回落');
});

test('remote_exec 头部注释不再声称所有计算经 ssh', () => {
  const src = fs.readFileSync(
    path.join(REPO_ROOT, 'BioanalysDesktop', 'server', 'remote_exec.js'),
    'utf8',
  );
  assert.match(src, /固定经 ADB/, '头部注释必须说明固定 ADB');
  assert.doesNotMatch(src, /所有计算都经 ssh/, '头部注释不得再声称所有计算经 ssh');
});

function fakeChild() {
  return {
    stdout: { on() {} },
    stderr: { on() {} },
    stdin: { on() {}, end() {} },
    on() {},
    kill() {},
  };
}

test('runExecStream 在 adb 模式下把 ssh 重写为 adb_exec，不直连 ssh', (t) => {
  setAdapter(t, 'adb');
  const calls = [];
  t.mock.method(childProcess, 'spawn', (program, args) => {
    calls.push({ program, args });
    return fakeChild();
  });

  runExecStream(sshArgv('k40-ubuntu', 'echo TASK_BODY'), {});

  assert.equal(calls.length, 1);
  assert.equal(calls[0].program, 'pwsh');
  assert.equal(calls[0].args[calls[0].args.indexOf('-File') + 1], ADB_EXEC_SCRIPT);
  assert.equal(calls[0].args[calls[0].args.indexOf('-Transport') + 1], 'adb');
  assert.equal(calls[0].args[calls[0].args.indexOf('-Command') + 1], 'echo TASK_BODY');
});

test('runStream 在 adb 模式下同样走 adb_exec', (t) => {
  setAdapter(t, 'adb');
  const calls = [];
  t.mock.method(childProcess, 'spawn', (program, args) => {
    calls.push({ program, args });
    return fakeChild();
  });

  runStream(sshArgv('k40-ubuntu', 'echo REPORT_BODY'), {});

  assert.equal(calls.length, 1);
  assert.equal(calls[0].program, 'pwsh');
  assert.equal(calls[0].args[calls[0].args.indexOf('-Transport') + 1], 'adb');
  assert.equal(calls[0].args[calls[0].args.indexOf('-Command') + 1], 'echo REPORT_BODY');
});

test('runExecStream 显式 ssh 仍被封存，不直连 ssh', (t) => {
  setAdapter(t, 'ssh');
  process.env.NODE_TEST_CONTEXT = '1';
  const calls = [];
  t.mock.method(childProcess, 'spawn', (program, args) => {
    calls.push({ program, args });
    return fakeChild();
  });

  assert.throws(
    () => runExecStream(sshArgv('k40-ubuntu', 'echo SSH_TASK'), {}),
    /SSH 通道已封存/,
  );
  assert.equal(calls.length, 0);
  delete process.env.NODE_TEST_CONTEXT;
});
