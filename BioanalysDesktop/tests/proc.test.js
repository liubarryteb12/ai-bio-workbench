import test from 'node:test';
import assert from 'node:assert/strict';

import { assertAllowedProgram, childEnv, runSync } from '../server/proc.js';
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

async function remoteReachable() {
  // 与 preview_mods.test.js 同一口径：真的探一次 ssh，不可达按白名单原因跳过。
  try {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40-ubuntu', 'echo PROBE_OK'],
      { encoding: 'utf8', timeout: 20000 });
    return r.status === 0 && /PROBE_OK/.test(r.stdout || '');
  } catch {
    return false;
  }
}

test('真实链路：经接缝 ssh 到容器应返回 CONTAINER_OK', async (testContext) => {
  if (!(await remoteReachable())) { testContext.skip('HOST_UNREACHABLE_K40: 远端 k40-ubuntu 不可达'); return; }
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

// ── Winsock 环境保底（2026-11-02，4 Argon 第十一轮第 6 节第 1 项）──
//
// 事故形态：调用方传精简 env（只有 PATH 等少数变量）时，Windows 原生
// System32/OpenSSH/ssh.exe 连 -V 都不解析就静默 exit 255。原因是 WSAStartup
// 要靠 SystemRoot 定位 mswsock.dll 与 Winsock 传输提供程序。
//
// 判据必须是"进程环境残缺"这一真实故障条件，所以测试临时把 SystemRoot 与
// windir 从 process.env 里摘掉，再断言 childEnv 仍能产出可用的 SystemRoot。
// 若主体只用 ...process.env 而不补保底，这条必红（已实测反证，见提交信息）。
function withoutSystemRoot(fn) {
  const saved = { SystemRoot: process.env.SystemRoot, windir: process.env.windir };
  delete process.env.SystemRoot;
  delete process.env.windir;
  try {
    return fn();
  } finally {
    if (saved.SystemRoot !== undefined) process.env.SystemRoot = saved.SystemRoot;
    if (saved.windir !== undefined) process.env.windir = saved.windir;
  }
}

test('childEnv：进程环境缺 SystemRoot 时仍补出可用值（Winsock 根因防线）', () => {
  const env = withoutSystemRoot(() => childEnv({ PATH: 'C:\\fake', BIO_CUSTOM: '1' }));
  assert.match(String(env.SystemRoot), /^[A-Za-z]:\\/,
    'SystemRoot 必须是盘符路径，否则 ssh 的 WSAStartup 找不到 mswsock.dll');
  assert.equal(env.windir, env.SystemRoot, 'windir 与 SystemRoot 必须同源');
  assert.equal(env.PATH, 'C:\\fake', '调用方的增量变量不能被吞掉');
  assert.equal(env.BIO_CUSTOM, '1');
});

test('childEnv：环境完整时调用方自定义 SystemRoot 优先（保底不是强改）', () => {
  const env = childEnv({ SystemRoot: 'D:\\WinAlt' });
  assert.equal(env.SystemRoot, 'D:\\WinAlt');
});
