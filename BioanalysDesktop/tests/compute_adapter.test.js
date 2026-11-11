import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';

import { runSync, runSshRaw, runSshStrict, runStream } from '../server/proc.js';
import { probeNodeHealth, runBridgeCheckSync } from '../server/task.js';
import { runSha256ParityCheck, collectLocalSha256, CORE_SYNC_FILES, SHA256_SENTINEL } from '../server/selfcheck.js';
import { probeRemoteState, RECONCILE_PROBE_SENTINEL } from '../server/reconcile.js';

/** 五个 MOCK_* 环境变量的统一设定，供每条接缝用例复用 */
function useMockCompute(t, { stdout = '', stderr = '', exitCode = '0' } = {}) {
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
  process.env.BIO_COMPUTE_MOCK_STDOUT = stdout;
  process.env.BIO_COMPUTE_MOCK_STDERR = stderr;
  process.env.BIO_COMPUTE_MOCK_EXIT_CODE = exitCode;
}

/** 起一个会抛错的 spawnSync 垫片，返回调用次数；接缝短路的用例靠它证明没起真进程 */
function forbidSpawnSync(t) {
  const box = { count: 0 };
  t.mock.method(childProcess, 'spawnSync', () => {
    box.count += 1;
    throw new Error('mock 模式不得启动真实 ssh');
  });
  return box;
}

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

  assert.throws(() => runSshRaw('k40-ubuntu', 'echo hi'), /仅接受 adb \/ mock/);
  assert.throws(() => runSync(['scp', 'source', 'target']), /仅接受 adb \/ mock/);
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

test('task.js 节点健康探针走 proc 接缝：mock 模式不启动真实 ssh', (t) => {
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
  process.env.BIO_COMPUTE_MOCK_STDOUT = 'TEMP|48000\nNODE_HEALTH_END\n';
  process.env.BIO_COMPUTE_MOCK_STDERR = '';
  process.env.BIO_COMPUTE_MOCK_EXIT_CODE = '0';

  let spawned = 0;
  t.mock.method(childProcess, 'spawnSync', () => {
    spawned += 1;
    throw new Error('mock 模式不得启动真实 ssh');
  });

  const health = probeNodeHealth(
    { id: 'k40-ubuntu', host: 'k40-ubuntu', primary: true },
    { timeoutMs: 1000 },
  );

  assert.equal(spawned, 0, 'task.js 探针必须在进程接缝前短路');
  assert.equal(health.reachable, true, 'mock 输出应判为可达');
  assert.equal(health.tempC, 48);
  assert.equal(health.sawEnd, true);
  assert.equal(health.reason, null);
});

test('task.js 桥接校验走 proc 接缝：mock 模式返回 mock 输出与退出码', (t) => {
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
  process.env.BIO_COMPUTE_MOCK_STDOUT = '[BRIDGE OK] line=line1_bulk\n';
  process.env.BIO_COMPUTE_MOCK_STDERR = '';
  process.env.BIO_COMPUTE_MOCK_EXIT_CODE = '0';

  let spawned = 0;
  t.mock.method(childProcess, 'spawnSync', () => {
    spawned += 1;
    throw new Error('mock 模式不得启动真实 ssh');
  });

  const result = runBridgeCheckSync({ remoteScript: 'checkpoint_bulk_bridge.py --input x' });

  assert.equal(spawned, 0, 'task.js 桥接校验必须在进程接缝前短路');
  assert.equal(result.code, 0);
  assert.match(result.stdout, /\[BRIDGE OK\]/);
  assert.equal(typeof result.durationMs, 'number');
});

test('selfcheck.js SHA256 比对走 proc 接缝：mock 模式不启动真实 ssh', (t) => {
  const local = collectLocalSha256(CORE_SYNC_FILES);
  const stdout = CORE_SYNC_FILES.map((item) => local.get(item.repo) + '  ' + item.remote).join('\n')
    + '\n' + SHA256_SENTINEL + '\n';
  useMockCompute(t, { stdout });
  const spawned = forbidSpawnSync(t);

  const light = runSha256ParityCheck();

  assert.equal(spawned.count, 0, 'selfcheck 必须在进程接缝前短路');
  assert.equal(light.id, 'isolation_sha256');
  assert.equal(light.status, 'pass');
  assert.equal(light.value, CORE_SYNC_FILES.length + '/' + CORE_SYNC_FILES.length + ' 一致');
});

test('reconcile.js 远端探针走 proc 接缝：mock 模式不启动真实 ssh', (t) => {
  useMockCompute(t, { stdout: 'RUNNING\nPRESENT\n' + RECONCILE_PROBE_SENTINEL + '\n' });
  const spawned = forbidSpawnSync(t);

  const probe = probeRemoteState('task_probe_1', [
    '/mnt/ssd/bio_data/projects/p/line1_bulk/results/x.tsv',
  ]);

  assert.equal(spawned.count, 0, 'reconcile 必须在进程接缝前短路');
  assert.equal(probe.state, 'ok');
  assert.deepEqual(probe.runningMarkers, ['task_probe_1.json']);
  assert.deepEqual(probe.expectedOutputs, [
    { path: '/mnt/ssd/bio_data/projects/p/line1_bulk/results/x.tsv', exists: true },
  ]);
});

test('runSync 透传 input 到子进程 stdin，未传时不出现该键（reconcile 的 base64 载荷依赖它）', (t) => {
  const keys = ['BIO_COMPUTE_ADAPTER', 'BIO_ALLOW_MOCK_COMPUTE'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  restoreEnv(t, previous, keys);
  delete process.env.BIO_COMPUTE_ADAPTER;
  delete process.env.BIO_ALLOW_MOCK_COMPUTE;

  const options = [];
  t.mock.method(childProcess, 'spawnSync', (_program, _args, opts) => {
    options.push(opts);
    return { status: 0, stdout: 'OK\n', stderr: '' };
  });

  runSync(['ssh', 'k40-ubuntu', 'base64 -d'], { input: 'PAYLOAD_BASE64' });
  assert.equal(options[0].input, 'PAYLOAD_BASE64');

  runSync(['ssh', 'k40-ubuntu', 'true']);
  assert.equal('input' in options[1], false, '未传 input 时不得把 stdin 语义改掉');
});

test('mock 覆盖 scp：runStream 对 scp argv 同样短路（report.js 拉包依赖）', async (t) => {
  useMockCompute(t, { stdout: '', stderr: '', exitCode: '0' });
  const spawned = [];
  t.mock.method(childProcess, 'spawn', (program) => {
    spawned.push(program);
    throw new Error('mock 模式不得启动真实 scp');
  });

  const events = [];
  const stream = runStream(['scp', '-o', 'BatchMode=yes', 'k40-ubuntu:/tmp/a.tar.gz', 'C:/tmp/a.tar.gz'], {
    onExit: (code) => events.push(code),
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(spawned.length, 0, 'scp 必须在接缝前短路');
  assert.deepEqual(events, [0]);
  assert.doesNotThrow(() => stream.kill());
});

test('SSH 适配器已封存，显式设置也 fail-closed', (t) => {
  const keys = ['BIO_COMPUTE_ADAPTER', 'BIO_ALLOW_MOCK_COMPUTE'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  restoreEnv(t, previous, keys);
  process.env.BIO_COMPUTE_ADAPTER = 'ssh';
  delete process.env.BIO_ALLOW_MOCK_COMPUTE;

  assert.throws(() => runSshRaw('k40-ubuntu', 'echo hi'), /SSH 通道已封存/);
  assert.throws(() => runSync(['scp', 'source', 'target']), /SSH 通道已封存/);
});

// ───────── 5.1 收尾新增（2026-11-01）：execFile/流式接缝的 mock 覆盖 ─────────
import { runExecFile, runExecStream, sshArgv, scpArgv } from '../server/proc.js';
import { COMPUTE_SCP_TARGET, COMPUTE_SSH_PORT } from '../server/domain.js';

test('runExecFile 在 mock 下走假算力，不碰 childProcess.execFile', async (t) => {
  useMockCompute(t, { stdout: 'SEAM_EXEC_OK\n' });
  let execCalls = 0;
  t.mock.method(childProcess, 'execFile', () => { execCalls += 1; throw new Error('mock 模式不得启动真实 execFile'); });
  const reply = await new Promise((resolve, reject) => {
    runExecFile(sshArgv('k40-ubuntu', 'echo hi'), {
      callback: (error, stdout) => (error ? reject(error) : resolve(stdout)),
    });
  });
  assert.match(reply, /SEAM_EXEC_OK/);
  assert.equal(execCalls, 0);
});

test('runExecStream 在 mock 下回放输出与退出码，stdin/kill 为 no-op', async (t) => {
  useMockCompute(t, { stdout: 'SEAM_STREAM_OK\n', exitCode: '0' });
  let spawnCalls = 0;
  t.mock.method(childProcess, 'spawn', () => { spawnCalls += 1; throw new Error('mock 模式不得启动真实 spawn'); });
  const seen = [];
  await new Promise((resolve) => {
    const handle = runExecStream(sshArgv('k40-ubuntu', 'task'), {
      onStdout: (text) => seen.push(text),
      onExit: (code) => { seen.push('EXIT:' + code); resolve(); },
    });
    handle.stdin.end('payload');
    handle.kill();
  });
  assert.match(seen.join(''), /SEAM_STREAM_OK/);
  assert.ok(seen.includes('EXIT:0'));
  assert.equal(spawnCalls, 0);
});

test('sshArgv/scpArgv 组装固定参数段（5.9 拓扑真源）', () => {
  const argv = sshArgv('k40-ubuntu', 'echo hi');
  assert.deepEqual(argv, ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40-ubuntu', 'echo hi']);
  const scp = scpArgv('C:/tmp/a.tsv', '/mnt/ssd/bio_data/x.tsv');
  assert.equal(scp[0], 'scp');
  assert.ok(scp.includes('-P'), 'scp argv 必须带端口段');
  assert.equal(scp[scp.indexOf('-P') + 1], String(COMPUTE_SSH_PORT), '端口必须来自 domain.js 真源');
  assert.match(scp.at(-1), new RegExp('^' + COMPUTE_SCP_TARGET.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':/mnt/ssd/bio_data/x\\.tsv$'), '远端目标必须拼在最后一个 argv');
});
