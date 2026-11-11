/**
 * 监督器对账测试。
 *
 * 判定逻辑全部走纯函数；probeRemoteState 的 SSH 只用 mock 垫片，
 * 测试既不连 K40，也不在本地执行分析代码。真实链路验收仍走
 * ops/run_k40_node_test_workspace.ps1 的既有测试通道。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// default 导入是既有进程接缝：mock.method(childProcess, 'spawnSync') 才拦得到。
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';

import {
  RECONCILE_STATES,
  RECONCILE_PROBE_SENTINEL,
  classifyRemoteState,
  reconcileTask,
  probeRemoteState,
} from '../server/reconcile.js';
import { runTask, buildLedgerWriteCommand } from '../server/run.js';

const TASK_ID = '6d1f0d24-2a37-4a53-8d02-1d33f65938c2';

test('五种判定状态名固定，避免调用方接错枚举', () => {
  assert.deepEqual([...RECONCILE_STATES], [
    'completed',
    'link_lost_still_running',
    'link_lost_output_present',
    'failed',
    'unknown',
  ]);
});

test('classifyRemoteState: exit 0 判 completed，不额外要求产物信号', () => {
  const result = classifyRemoteState({
    exitCode: 0,
    runningMarkers: [],
    expectedOutputs: [],
  });
  assert.equal(result, 'completed');
});

test('classifyRemoteState: 标记存在时按仍在跑处理，即使退出码非 0', () => {
  const result = classifyRemoteState({
    exitCode: 255,
    runningMarkers: [`${TASK_ID}.json`],
    expectedOutputs: [{ path: '/mnt/ssd/bio_data/projects/p/line2_scrna/results/x.csv', exists: false }],
  });
  assert.equal(result, 'link_lost_still_running');
});

test('classifyRemoteState: 标记消失且全部产物存在，判定链路丢失但产物已出', () => {
  const result = classifyRemoteState({
    exitCode: null,
    runningMarkers: [],
    expectedOutputs: [
      { path: '/mnt/ssd/bio_data/projects/p/line2_scrna/results/a.csv', exists: true },
      { path: '/mnt/ssd/bio_data/projects/p/line2_scrna/results/b.png', exists: true },
    ],
  });
  assert.equal(result, 'link_lost_output_present');
});

test('classifyRemoteState: 标记消失且产物缺失，判真实失败', () => {
  const result = classifyRemoteState({
    exitCode: 1,
    runningMarkers: [],
    expectedOutputs: [{ path: '/mnt/ssd/bio_data/projects/p/line1_bulk/results/x.tsv', exists: false }],
  });
  assert.equal(result, 'failed');
});

test('classifyRemoteState: 产物存在性数组本身缺失时判 unknown', () => {
  const result = classifyRemoteState({
    exitCode: 1,
    runningMarkers: [],
    expectedOutputs: null,
  });
  assert.equal(result, 'unknown');
});

test('classifyRemoteState: 无产物声明且标记已消失，不把非 0 退出硬猜成成功', () => {
  const result = classifyRemoteState({
    exitCode: 1,
    runningMarkers: [],
    expectedOutputs: [],
  });
  assert.equal(result, 'unknown');
});

test('classifyRemoteState: exitCode 违背契约显式抛 TypeError，不伪装成 unknown', () => {
  assert.throws(
    () => classifyRemoteState({
      exitCode: undefined,
      runningMarkers: [],
      expectedOutputs: [],
    }),
    TypeError
  );
  assert.throws(
    () => classifyRemoteState({
      exitCode: '255',
      runningMarkers: [],
      expectedOutputs: [],
    }),
    TypeError
  );
});

test('reconcileTask: 仍在跑时保留原始 error_log，并收敛成可统计的终态 failed', () => {
  const entry = {
    status: 'failed',
    checkpoint_status: 'failed',
    error_log: 'Connection closed by 127.0.0.1 port 10022',
    environment: { random_seed: 7 },
    exit_code: 255,
  };
  const corrected = reconcileTask(entry, {
    state: 'ok',
    runningMarkers: [`${TASK_ID}.json`],
    expectedOutputs: [],
  });
  assert.deepEqual(corrected, {
    status: 'failed',
    checkpoint_status: 'skipped',
    reconcile_note: `reconcile: link_lost_still_running; _running 标记存在; 链路丢失，远端仍在运行，需人工确认; exit_code=255; 未重试`,
  });
  assert.equal(entry.status, 'failed', '纯函数只返回修正字段，不改入参台账');
});

test('reconcileTask: 产物齐备时按 completed 修正，checkpoint 依种子可复现性定档', () => {
  const output = '/mnt/ssd/bio_data/projects/p/line2_scrna/results/x.csv';
  const entry = {
    status: 'failed',
    checkpoint_status: 'failed',
    exit_code: 1,
    environment: { random_seed: 7 },
    io_files: { output: [output] },
  };
  const corrected = reconcileTask(entry, {
    state: 'ok',
    runningMarkers: [],
    expectedOutputs: [{ path: output, exists: true }],
  });
  assert.equal(corrected.status, 'completed');
  assert.equal(corrected.checkpoint_status, 'passed');
  assert.match(corrected.reconcile_note, /link_lost_output_present/);
  assert.match(corrected.reconcile_note, /1\/1 产物存在/);
});

test('reconcileTask: unknown 探针不产生修正，保持原判', () => {
  const entry = {
    status: 'failed',
    checkpoint_status: 'failed',
    environment: { random_seed: null },
    io_files: { output: [] },
  };
  assert.equal(reconcileTask(entry, { state: 'unknown', runningMarkers: null, expectedOutputs: null }), null);
});

test('reconcileTask: completed/failed/unknown 对账结论都不改既有台账字段', () => {
  const entry = {
    status: 'failed',
    checkpoint_status: 'failed',
    environment: { random_seed: 1 },
    exit_code: 1,
  };
  const failed = reconcileTask(entry, {
    state: 'ok',
    runningMarkers: [],
    expectedOutputs: [{ path: '/mnt/ssd/bio_data/projects/p/line1_bulk/results/x.tsv', exists: false }],
  });
  assert.equal(failed, null);

  const completed = reconcileTask(
    { ...entry, exit_code: 0, io_files: { output: [] } },
    { state: 'ok', runningMarkers: [], expectedOutputs: [] }
  );
  assert.equal(completed, null);
});

test('probeRemoteState: 只发一次只读 SSH，解析本任务标记与产物存在性', (t) => {
  const paths = [
    '/mnt/ssd/bio_data/projects/p/line2_scrna/results/a.csv',
    '/mnt/ssd/bio_data/projects/p/line2_scrna/results/b.png',
  ];
  const calls = [];
  t.mock.method(childProcess, 'spawnSync', (program, args, options) => {
    calls.push({ program, args, options });
    return { status: 0, stdout: `RUNNING\nPRESENT\nMISSING\n${RECONCILE_PROBE_SENTINEL}\n`, stderr: '' };
  });

  const probe = probeRemoteState(TASK_ID, paths);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].program, 'pwsh');
  assert.match(JSON.stringify(calls[0].args), /adb_exec\.ps1/);
  assert.equal(calls[0].options.input, Buffer.from(paths.map((p) => `${p}\0`).join(''), 'utf8').toString('base64'));
  assert.equal(probe.state, 'ok');
  assert.deepEqual(probe.runningMarkers, [`${TASK_ID}.json`]);
  assert.deepEqual(probe.expectedOutputs, [
    { path: paths[0], exists: true },
    { path: paths[1], exists: false },
  ]);
  assert.ok(calls[0].args.at(-1).includes('/mnt/ssd/bio_data/system_logs/_running'));
  assert.ok(calls[0].args.at(-1).includes(RECONCILE_PROBE_SENTINEL));
  assert.ok(!calls[0].args.at(-1).includes('>'), '探针命令必须只读，不得带重定向写动作');
});

test('probeRemoteState: SSH 链路失败返回 unknown，信号置 null', (t) => {
  t.mock.method(childProcess, 'spawnSync', () => ({
    status: 255,
    stdout: '',
    stderr: 'ssh: Connection closed by 127.0.0.1 port 10022',
  }));
  const probe = probeRemoteState(TASK_ID, ['/mnt/ssd/bio_data/projects/p/line1_bulk/results/x.tsv']);
  assert.equal(probe.state, 'unknown');
  assert.match(probe.reason, /exit=255/);
  assert.equal(probe.runningMarkers, null);
  assert.equal(probe.expectedOutputs, null);
});

test('probeRemoteState: 输出缺哨兵判 unknown，不用空输出伪装成功', (t) => {
  t.mock.method(childProcess, 'spawnSync', () => ({ status: 0, stdout: 'RUNNING\n', stderr: '' }));
  const probe = probeRemoteState(TASK_ID, []);
  assert.equal(probe.state, 'unknown');
  assert.match(probe.reason, /哨兵/);
  assert.equal(probe.runningMarkers, null);
  assert.equal(probe.expectedOutputs, null);
});

test('probeRemoteState: 相对产物路径拒绝探测，返回 unknown 而不是猜测 cwd', (t) => {
  const calls = [];
  t.mock.method(childProcess, 'spawnSync', (program, args, options) => {
    calls.push({ program, args, options });
    return { status: 0, stdout: `RUNNING\nPRESENT\n${RECONCILE_PROBE_SENTINEL}\n`, stderr: '' };
  });

  const probe = probeRemoteState(TASK_ID, ['x.tsv']);
  assert.equal(probe.state, 'unknown');
  assert.match(probe.reason, /绝对路径/);
  assert.equal(probe.runningMarkers, null);
  assert.equal(probe.expectedOutputs, null);
  assert.equal(calls.length, 0);
});

// 引擎接线：任务退出 255 + 标记仍在，exit 回调先对账再审计。
// 假 ssh 子进程不执行远端；persistEntry 也由同一垫片接走，避免测试触网。
test('runTask: 链路丢失但远端仍在跑，台账先修正为终态 failed 再审计落盘', async (t) => {
  const stdout = [];
  const stderr = [];
  let received = null;

  const taskChild = new EventEmitter();
  taskChild.stdout = new Readable({ read() {} });
  taskChild.stderr = new Readable({ read() {} });
  taskChild.kill = () => {};
  setImmediate(() => taskChild.emit('exit', 255, null));

  function persistChild() {
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
        const encoded = Buffer.concat(chunks).toString('utf8');
        const payload = Buffer.from(encoded, 'base64').toString('utf8');
        const { remotePath } = buildLedgerWriteCommand(JSON.parse(payload));
        child.stdout.push(`WROTE '${remotePath}' ${Buffer.byteLength(payload, 'utf8')}\n`);
        child.stdout.push(null);
        child.stderr.push(null);
        child.emit('exit', 0, null);
      });
    });
    return child;
  }

  t.mock.method(childProcess, 'spawn', (program, args) => {
    const joined = (args || []).join(' ');
    if (joined.includes('mkdir -p')) return persistChild();
    return taskChild;
  });
  t.mock.method(childProcess, 'spawnSync', (program, args) => {
    assert.equal(program, 'pwsh');
    assert.match((args || []).at(-1), /RECONCILE_END/);
    return { status: 0, stdout: `RUNNING\n${RECONCILE_PROBE_SENTINEL}\n`, stderr: '' };
  });

  runTask(
    {
      projectId: 'default',
      lineId: 'line2_scrna',
      step: 'qc_cells',
      inputs: ['/mnt/ssd/bio_data/projects/default/line2_scrna/processed/cells.h5ad'],
      outputs: [],
      seed: 7,
    },
    {
      onStdout: (text) => stdout.push(text),
      onStderr: (text) => stderr.push(text),
      onExit: (code, entry) => { received = { code, entry }; },
    }
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(received, '任务退出回调应触发');
  assert.equal(received.code, 255);
  assert.equal(received.entry.status, 'failed');
  assert.match(received.entry.reconcile_note, /需人工确认/);
  assert.equal(received.entry.checkpoint_status, 'skipped');
  assert.match(received.entry.reconcile_note, /link_lost_still_running/);
  assert.equal(stderr.join('').includes('拒绝落盘'), false, `修正后的台账应过审计: ${stderr.join('')}`);
  assert.equal(stdout.length, 0);
});
