import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';

import { runSync, runSshRaw, runSshStrict, runStream } from '../server/proc.js';

function restoreEnv(t, previous, keys) {
  t.after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

test('BIO_COMPUTE_ADAPTER=mock 时 runSshRaw 不启动 ssh，返回显式 mock 输出', (t) => {
  const keys = [
    'BIO_COMPUTE_ADAPTER',
    'BIO_ALLOW_MOCK_COMPUTE',
    'BIO_COMPUTE_MOCK_STDOUT',
    'BIO_COMPUTE_MOCK_STDERR',
    'BIO_COMPUTE_MOCK_EXIT_CODE',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  restoreEnv(t, previous, keys);
  process.env.BIO_COMPUTE_ADAPTER = 'mock';
  process.env.BIO_ALLOW_MOCK_COMPUTE = '1';
  process.env.BIO_COMPUTE_MOCK_STDOUT = 'MOCKED_CONTAINER_OK\n';
  process.env.BIO_COMPUTE_MOCK_STDERR = '';
  process.env.BIO_COMPUTE_MOCK_EXIT_CODE = '0';

  let spawned = 0;
  t.mock.method(childProcess, 'spawnSync', () => {
    spawned += 1;
    throw new Error('mock 模式不得启动真实 ssh');
  });

  const result = runSshRaw('k40-ubuntu', 'echo CONTAINER_OK', { timeoutMs: 1000 });

  assert.deepEqual(result, { code: 0, text: 'MOCKED_CONTAINER_OK' });
  assert.equal(spawned, 0, 'mock 模式必须在进程接缝前短路');
});

test('未知 BIO_COMPUTE_ADAPTER 一律 fail-closed', (t) => {
  const keys = ['BIO_COMPUTE_ADAPTER', 'BIO_ALLOW_MOCK_COMPUTE'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  restoreEnv(t, previous, keys);
  process.env.BIO_COMPUTE_ADAPTER = 'bash';
  delete process.env.BIO_ALLOW_MOCK_COMPUTE;

  assert.throws(() => runSshRaw('k40-ubuntu', 'echo hi'), /仅接受 ssh \/ mock/);
  assert.throws(() => runSync(['scp', 'source', 'target']), /仅接受 ssh \/ mock/);
});

test('mock 门禁：非测试环境且未显式放行时抛错，测试环境可单靠 NODE_TEST_CONTEXT 放行', (t) => {
  const keys = ['BIO_COMPUTE_ADAPTER', 'BIO_ALLOW_MOCK_COMPUTE', 'BIO_COMPUTE_MOCK_STDOUT'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  restoreEnv(t, previous, keys);
  process.env.BIO_COMPUTE_ADAPTER = 'mock';
  delete process.env.BIO_ALLOW_MOCK_COMPUTE;
  process.env.BIO_COMPUTE_MOCK_STDOUT = 'GATE_OK\n';

  const savedTestContext = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  t.after(() => {
    if (savedTestContext === undefined) delete process.env.NODE_TEST_CONTEXT;
    else process.env.NODE_TEST_CONTEXT = savedTestContext;
  });

  assert.throws(
    () => runSshRaw('k40-ubuntu', 'echo hi'),
    /mock 计算面仅在测试环境或 BIO_ALLOW_MOCK_COMPUTE=1 时允许/,
  );

  process.env.NODE_TEST_CONTEXT = '1';
  assert.deepEqual(
    runSshRaw('k40-ubuntu', 'echo hi'),
    { code: 0, text: 'GATE_OK' },
  );
});

test('runSshStrict 复用宽松版：mock 非 0 或空输出仍抛错', (t) => {
  const keys = [
    'BIO_COMPUTE_ADAPTER',
    'BIO_ALLOW_MOCK_COMPUTE',
    'BIO_COMPUTE_MOCK_STDOUT',
    'BIO_COMPUTE_MOCK_STDERR',
    'BIO_COMPUTE_MOCK_EXIT_CODE',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  restoreEnv(t, previous, keys);
  process.env.BIO_COMPUTE_ADAPTER = 'mock';
  process.env.BIO_ALLOW_MOCK_COMPUTE = '1';
  process.env.BIO_COMPUTE_MOCK_STDOUT = '';
  process.env.BIO_COMPUTE_MOCK_STDERR = 'MOCKED_FAILURE\n';
  process.env.BIO_COMPUTE_MOCK_EXIT_CODE = '1';

  assert.throws(() => runSshStrict('k40-ubuntu', 'false'), /远端命令退出码 1/);

  process.env.BIO_COMPUTE_MOCK_EXIT_CODE = '0';
  process.env.BIO_COMPUTE_MOCK_STDERR = '';
  assert.throws(() => runSshStrict('k40-ubuntu', 'true'), /远端命令无输出/);
});

test('runStream 对 ssh mock 异步回调输出与退出码，kill 为 no-op', async (t) => {
  const keys = [
    'BIO_COMPUTE_ADAPTER',
    'BIO_ALLOW_MOCK_COMPUTE',
    'BIO_COMPUTE_MOCK_STDOUT',
    'BIO_COMPUTE_MOCK_STDERR',
    'BIO_COMPUTE_MOCK_EXIT_CODE',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  restoreEnv(t, previous, keys);
  process.env.BIO_COMPUTE_ADAPTER = 'mock';
  process.env.BIO_ALLOW_MOCK_COMPUTE = '1';
  process.env.BIO_COMPUTE_MOCK_STDOUT = 'STREAM_OUT\n';
  process.env.BIO_COMPUTE_MOCK_STDERR = 'STREAM_ERR\n';
  process.env.BIO_COMPUTE_MOCK_EXIT_CODE = '0';

  t.mock.method(childProcess, 'spawn', () => {
    throw new Error('mock 模式不得启动真实 ssh');
  });

  const events = [];
  const stream = runStream(['ssh', 'k40-ubuntu', 'echo STREAM_OUT'], {
    onStdout: (chunk) => events.push(['stdout', chunk]),
    onStderr: (chunk) => events.push(['stderr', chunk]),
    onExit: (code) => events.push(['exit', code]),
  });

  assert.doesNotThrow(() => stream.kill());
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [
    ['stdout', 'STREAM_OUT\n'],
    ['stderr', 'STREAM_ERR\n'],
    ['exit', 0],
  ]);
});

test('默认 BIO_COMPUTE_ADAPTER=ssh 保持既有真实子进程路径', (t) => {
  const keys = ['BIO_COMPUTE_ADAPTER', 'BIO_ALLOW_MOCK_COMPUTE'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  restoreEnv(t, previous, keys);
  delete process.env.BIO_COMPUTE_ADAPTER;
  delete process.env.BIO_ALLOW_MOCK_COMPUTE;

  const calls = [];
  t.mock.method(childProcess, 'spawnSync', (program, args) => {
    calls.push([program, ...args]);
    return { status: 0, stdout: 'SSH_DEFAULT_OK\n', stderr: '' };
  });

  assert.deepEqual(
    runSshRaw('k40-ubuntu', 'echo SSH_DEFAULT_OK'),
    { code: 0, text: 'SSH_DEFAULT_OK' },
  );
  assert.deepEqual(calls, [[
    'ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
    'k40-ubuntu', 'echo SSH_DEFAULT_OK',
  ]]);
});
