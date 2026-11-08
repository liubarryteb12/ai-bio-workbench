/**
 * 计算面通道契约：adb 默认、ssh 特殊开关、mock 测试。
 *
 * 这组断言钉住四件事：
 *   1. 未设置 BIO_COMPUTE_ADAPTER 时 computeMode 返回 adb；
 *   2. 显式 ssh 合法，未知值在 resolve 时 fail-closed；
 *   3. remote_exec 默认调用 adbRaw，只有显式 ssh 才走 runSshRaw；
 *   4. 文档不再宣称「默认 ssh」或「adb 失败自动回落 ssh」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  ADB_EXEC_SCRIPT, REPO_ROOT, adbRaw, computeMode, resolveComputeAdapter,
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

test('computeMode：未设置时默认 adb，显式 ssh 合法', () => {
  const saved = process.env.BIO_COMPUTE_ADAPTER;
  try {
    delete process.env.BIO_COMPUTE_ADAPTER;
    assert.equal(computeMode(), 'adb', '未设置时必须默认 ADB 主通道');
    process.env.BIO_COMPUTE_ADAPTER = 'adb';
    assert.equal(computeMode(), 'adb');
    process.env.BIO_COMPUTE_ADAPTER = 'ssh';
    assert.equal(computeMode(), 'ssh', '显式 ssh 必须保留为特殊开关');
  } finally {
    if (saved === undefined) delete process.env.BIO_COMPUTE_ADAPTER;
    else process.env.BIO_COMPUTE_ADAPTER = saved;
  }
});

test('resolveComputeAdapter：接受 adb/ssh，未知值 fail-closed', () => {
  const saved = process.env.BIO_COMPUTE_ADAPTER;
  try {
    delete process.env.BIO_COMPUTE_ADAPTER;
    assert.equal(resolveComputeAdapter(), 'adb');
    process.env.BIO_COMPUTE_ADAPTER = 'ssh';
    assert.equal(resolveComputeAdapter(), 'ssh');
    process.env.BIO_COMPUTE_ADAPTER = 'bash';
    assert.throws(
      () => resolveComputeAdapter(),
      /BIO_COMPUTE_ADAPTER 仅接受 adb \/ ssh \/ mock/,
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

test('runRemoteRaw 显式 ssh 时仍走 runSshRaw，不再碰 adbRaw', (t) => {
  setAdapter(t, 'ssh');
  const calls = [];
  t.mock.method(childProcess, 'spawnSync', (program, args) => {
    calls.push({ program, args });
    return { status: 0, stdout: 'SSH_OK\n', stderr: '', error: null };
  });

  const result = runRemoteRaw('echo SSH_OK');

  assert.deepEqual(result, { code: 0, text: 'SSH_OK' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].program, 'ssh');
  assert.equal(calls[0].args.at(-1), 'echo SSH_OK');
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
    /BIO_COMPUTE_ADAPTER 仅接受 adb \/ ssh \/ mock/,
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

test('README 与通道策略不再声称默认 ssh 或自动回落 ssh', () => {
  const readme = fs.readFileSync(path.join(REPO_ROOT, 'BioanalysDesktop', 'README.md'), 'utf8');
  assert.match(readme, /默认经 ADB/, 'README 必须写明默认经 ADB');
  assert.match(readme, /BIO_COMPUTE_ADAPTER=ssh/, 'README 必须写明 ssh 特殊开关');
  assert.doesNotMatch(readme, /所有计算命令经 ssh/, 'README 不得再宣称所有计算经 ssh');

  const policy = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'remote_channel_policy.md'), 'utf8');
  assert.match(policy, /默认.*ADB|ADB.*默认/i, '策略文档必须写明 ADB 默认');
  assert.match(policy, /不回落/, '策略文档必须写明默认不回落');
  assert.match(policy, /BIO_COMPUTE_ADAPTER=ssh/, '策略文档必须写明 ssh 特殊开关');
  assert.doesNotMatch(policy, /auto（默认，adb 失败回落 ssh）/, '不得保留 auto 回落口径');
});

test('remote_exec 头部注释不再声称所有计算经 ssh', () => {
  const src = fs.readFileSync(
    path.join(REPO_ROOT, 'BioanalysDesktop', 'server', 'remote_exec.js'),
    'utf8',
  );
  assert.match(src, /默认经 ADB/, '头部注释必须说明默认 ADB');
  assert.doesNotMatch(src, /所有计算都经 ssh/, '头部注释不得再声称所有计算经 ssh');
});
