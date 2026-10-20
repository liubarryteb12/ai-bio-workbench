import test from 'node:test';
import assert from 'node:assert/strict';

import { assertAllowedProgram, runSync } from '../server/proc.js';
import { buildRemoteCommand } from '../server/ssh.js';

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
