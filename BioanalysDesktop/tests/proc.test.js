import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { assertAllowedProgram, findAdb, runSync } from '../server/proc.js';
import { buildRemoteCommand } from '../server/ssh.js';

function makeAdbCandidate(directory, name = process.platform === 'win32' ? 'adb.exe' : 'adb') {
  const candidate = path.join(directory, name);
  writeFileSync(candidate, '');
  if (process.platform !== 'win32') chmodSync(candidate, 0o755);
  return candidate;
}

function withEnvironment(testContext, overrides) {
  const previous = {};
  for (const [name, value] of Object.entries(overrides)) {
    previous[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  testContext.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

test('findAdb：BIO_ADB_PATH 优先于 ADB_PATH 和 PATH', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'proc-adb-priority-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bioAdb = makeAdbCandidate(root, process.platform === 'win32' ? 'bio-adb.exe' : 'bio-adb');
  const adbPath = makeAdbCandidate(root, process.platform === 'win32' ? 'adb-path.exe' : 'adb-path');
  withEnvironment(t, {
    BIO_ADB_PATH: bioAdb,
    ADB_PATH: adbPath,
    PATH: root,
  });
  assert.equal(findAdb(), bioAdb);
});

test('findAdb：没有 BIO_ADB_PATH 时使用 ADB_PATH', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'proc-adb-env-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const adbPath = makeAdbCandidate(root, process.platform === 'win32' ? 'adb-path.exe' : 'adb-path');
  withEnvironment(t, {
    BIO_ADB_PATH: undefined,
    ADB_PATH: adbPath,
  });
  assert.equal(findAdb(), adbPath);
});

test('findAdb：环境变量为空时通过系统 PATH 查询 adb', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'proc-adb-path-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pathAdb = makeAdbCandidate(root);
  const lookup = mock.method(childProcess, 'spawnSync', (command, args) => {
    assert.equal(command, process.platform === 'win32' ? 'where.exe' : 'which');
    assert.deepEqual(args, ['adb']);
    return { status: 0, stdout: `${pathAdb}\r\n`, stderr: '' };
  });
  t.after(() => lookup.mock.restore());
  withEnvironment(t, {
    BIO_ADB_PATH: undefined,
    ADB_PATH: undefined,
    LOCALAPPDATA: undefined,
    USERPROFILE: undefined,
    PATH: root,
  });
  assert.equal(findAdb(), pathAdb);
});

test('findAdb：所有来源都不存在时回落 adb', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'proc-adb-empty-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const lookup = mock.method(childProcess, 'spawnSync', () => ({
    status: 1,
    stdout: '',
    stderr: '',
  }));
  t.after(() => lookup.mock.restore());
  withEnvironment(t, {
    BIO_ADB_PATH: undefined,
    ADB_PATH: undefined,
    LOCALAPPDATA: undefined,
    USERPROFILE: undefined,
    PATH: root,
  });
  assert.equal(findAdb(), 'adb');
});

test('白名单：ssh / scp / adb 放行', () => {
  assert.doesNotThrow(() => assertAllowedProgram(['ssh', 'k40', 'echo hi']));
  assert.doesNotThrow(() => assertAllowedProgram(['scp', 'a', 'b']));
  assert.doesNotThrow(() => assertAllowedProgram(['adb', 'devices']));
  assert.doesNotThrow(() => assertAllowedProgram(['ssh.exe', 'k40', 'echo hi']));
});

test('白名单按 basename 判定，绝对路径同样放行', () => {
  assert.doesNotThrow(() => assertAllowedProgram(['C:/adb/platform-tools/adb.exe', 'devices']));
  assert.doesNotThrow(() => assertAllowedProgram(['C:\\Windows\\System32\\OpenSSH\\ssh.exe', 'k40', 'echo hi']));
});

test('白名单：伪装的路径也不放行（像 Rscript 但不是白名单程序）', () => {
  assert.throws(() => assertAllowedProgram(['C:/Program Files/R/R-4.3.3/bin/Rscript.exe', 'deg.R']), /本地禁止执行/);
  assert.throws(() => assertAllowedProgram(['python.exe', 'train.py']), /本地禁止执行/);
  assert.throws(() => assertAllowedProgram(['C:/Python314/python.exe', 'train.py']), /本地禁止执行/);
});

test('零算力红线：本地跑 R / Python / Rscript 一律拒绝', () => {
  for (const bad of [
    ['Rscript', 'deg.R'],
    ['R.exe', 'deg.R'],
    ['python', 'train.py'],
    ['python3', 'train.py'],
    ['bash', 'run.sh'],
  ]) {
    assert.throws(() => assertAllowedProgram(bad), /本地禁止执行/, `${bad[0]} 必须被拒绝`);
  }
});

test('runSync 也会先过白名单，不会真的启动 R', () => {
  assert.throws(() => runSync(['Rscript', '-e', '1+1']), /本地禁止执行/);
});

test('真实链路：经接缝 ssh 到容器应返回 CONTAINER_OK', () => {
  // 这是唯一一条真连服务器的测试；链路不通时它红，正是我们要的信号
  const remote = buildRemoteCommand('echo CONTAINER_OK', 'compute');
  // 命令形如：ssh -o ... k40-ubuntu 'echo CONTAINER_OK'，取 argv
  const argv = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40-ubuntu', 'echo CONTAINER_OK'];
  const result = runSync(argv, { timeoutMs: 20000 });
  const noiseStripped = [result.stdout, result.stderr]
    .join('\n')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('Warning: Permanently added'))
    .join('\n');
  assert.match(noiseStripped, /CONTAINER_OK/, `链路应通。remote=${remote}`);
  assert.equal(result.code, 0);
});
