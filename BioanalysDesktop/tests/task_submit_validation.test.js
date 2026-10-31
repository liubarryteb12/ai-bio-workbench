/**
 * S29 任务提交路径预校验测试（只增不改既有断言）
 *
 * 覆盖两块：
 *   A. validateTaskPaths 纯函数：现行形态 / 历史三线形态（兼容红线）/ 跨项目 /
 *      含 .. / system_logs 与 public_references 越界 / 空数组 / error 点名路径。
 *   B. 提交层接线：in-process 起真服务打真 HTTP + 假 ssh 垫片，验证跨项目路径在
 *      "提交前"就被 400 拦下（垫片调用计数为 0，证明没有白跑远端），且合法路径
 *      与历史形态仍能正常下发（E2E 旧形态不被打断）。
 *
 * in-process 而非子进程的原因同 bridge_checkpoint.test.js：子进程形态没法替换
 * ssh（Windows 下 spawn 只认 ssh.exe，脚本垫片不可执行）。
 *
 * 口径来源（报告里注明）：server/ledger.js 的 extractProject / classifyPath
 * （跨项目与 legacy 判据）、server/files.js 的 assertPathInsideProject
 * （public_references 是唯一合法共享读入口）、server/audit.js 的跨线审计。
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
// default 导入：run.js/task.js 同款接缝，mock.method 拦得到的才是真调用点
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';

// validateTaskPaths 由 server/index.js 导出；index.js 顶层会按 BAD_PORT listen，
// 所以必须先定端口再动态 import（与 bridge_checkpoint.test.js 同款）。
let validateTaskPaths;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const PORT = await freePort();
const BASE = `http://127.0.0.1:${PORT}`;

/** 垫片配置：calls 记录全部 ssh 调用，用于证明"提交前拦下" */
const shim = {
  taskExit: 17, // 任务本体退出码（非 0，避免触发真实回搬 scp）
  calls: [],
};

function fakeSshChild(exitCode) {
  const child = new EventEmitter();
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.stdin = new Writable({ write(_chunk, _enc, cb) { cb(); } });
  child.kill = () => child.emit('exit', exitCode, null);
  setImmediate(() => {
    child.stdout.push(null);
    child.stderr.push(null);
    // exit 必须 setImmediate：先让调用方把 stdout/stderr 挂上，再落 exit
    setImmediate(() => child.emit('exit', exitCode, null));
  });
  return child;
}

before(async () => {
  process.env.BAD_PORT = String(PORT);
  const { mock } = await import('node:test');
  mock.method(childProcess, 'spawnSync', (cmd, args) => {
    shim.calls.push({ kind: 'spawnSync', cmd, joined: (args || []).join(' ') });
    return { status: 0, stdout: '', stderr: '' };
  });
  mock.method(childProcess, 'spawn', (cmd, args) => {
    shim.calls.push({ kind: 'spawn', cmd, joined: (args || []).join(' ') });
    return fakeSshChild(shim.taskExit);
  });
  const mod = await import('../server/index.js');
  validateTaskPaths = mod.validateTaskPaths;
  assert.equal(typeof validateTaskPaths, 'function', 'server/index.js 必须导出 validateTaskPaths 纯函数');

  const deadline = Date.now() + 25000;
  for (;;) {
    try {
      const response = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) break;
    } catch { /* 没起来就继续等 */ }
    if (Date.now() > deadline) throw new Error(`服务 25s 内没就绪（端口 ${PORT}）`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
});

after(async () => {
  const mod = await import('../server/index.js');
  mod.server.closeAllConnections?.();
  await new Promise((resolve) => mod.server.close(resolve));
});

async function submit(body) {
  return fetch(`${BASE}/api/tasks/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
}

const P = 'default';
const CURRENT = `/mnt/ssd/bio_data/projects/${P}/line1_bulk/processed/expr_genes.tsv`;
const CURRENT_OUT = `/mnt/ssd/bio_data/projects/${P}/line1_bulk/results/deg.tsv`;

// ───────────── A. validateTaskPaths 纯函数 ─────────────

test('S29: 现行形态 projects/<项目>/... 合法（输入与输出）', () => {
  assert.deepEqual(validateTaskPaths([CURRENT], [CURRENT_OUT], P), { ok: true });
});

test('S29: 历史三线形态 /mnt/ssd/bio_data/<line>/... 合法（兼容红线，E2E 旧形态不许失效）', () => {
  const result = validateTaskPaths(
    ['/mnt/ssd/bio_data/line1_bulk/processed/expr_genes.tsv'],
    ['/mnt/ssd/bio_data/line1_bulk/results/deg.tsv'],
    P,
  );
  assert.deepEqual(result, { ok: true });
});

test('S29: processed/ 下的裸相对文件名合法（既有提交用例依赖，shell 按 cwd 解析）', () => {
  assert.deepEqual(validateTaskPaths(['pseudobulk.tsv'], [], P), { ok: true });
});

test('S29: 空数组 ok（无输入输出不是越界）', () => {
  assert.deepEqual(validateTaskPaths([], [], P), { ok: true });
});

test('S29: 跨项目路径拒绝，且 error 点名路径、实际项目与当前项目', () => {
  const bad = '/mnt/ssd/bio_data/projects/PRJ_OTHER/line1_bulk/processed/expr.tsv';
  const result = validateTaskPaths([bad], [], P);
  assert.equal(result.ok, false);
  assert.match(result.error, /跨项目/);
  assert.match(result.error, /inputs\[0\]/, 'error 必须点名是第几条');
  assert.ok(result.error.includes(bad), `error 必须含违规路径原文: ${result.error}`);
  assert.match(result.error, /PRJ_OTHER/, 'error 要点名路径实际所属项目');
  assert.match(result.error, /当前项目为 default/);
});

test('S29: 项目段大小写敏感（projects/DEFAULT 不等于 default，拒）', () => {
  const result = validateTaskPaths([`/mnt/ssd/bio_data/projects/DEFAULT/line1_bulk/processed/expr.tsv`], [], P);
  assert.equal(result.ok, false);
  assert.match(result.error, /跨项目/);
});

test('S29: 含 .. 的路径拒绝（不许借归一化绕过项目比对）', () => {
  const bad = `/mnt/ssd/bio_data/projects/${P}/line1_bulk/../../system_logs/x.json`;
  const result = validateTaskPaths([bad], [], P);
  assert.equal(result.ok, false);
  assert.match(result.error, /含 \.\./);
  assert.ok(result.error.includes(bad), `error 必须含违规路径原文: ${result.error}`);
});

test('S29: system_logs 作为输入/输出都拒绝', () => {
  const bad = '/mnt/ssd/bio_data/system_logs/2026-10-19_task.json';
  const asInput = validateTaskPaths([bad], [], P);
  assert.equal(asInput.ok, false);
  assert.match(asInput.error, /system_logs/);
  const asOutput = validateTaskPaths([], [bad], P);
  assert.equal(asOutput.ok, false);
  assert.match(asOutput.error, /outputs\[0\]/);
});

test('S29: public_references 可作输入（只读共享读入口），不可作输出', () => {
  const shared = '/mnt/ssd/bio_data/public_references/gencode_v44.gtf';
  assert.deepEqual(validateTaskPaths([shared], [], P), { ok: true });
  const result = validateTaskPaths([], [shared], P);
  assert.equal(result.ok, false);
  assert.match(result.error, /public_references/);
  assert.match(result.error, /只读/);
});

test('S29: 数据根之外的绝对路径拒绝（禁绝对路径逃逸）', () => {
  const result = validateTaskPaths(['/etc/passwd'], [], P);
  assert.equal(result.ok, false);
  assert.match(result.error, /不在数据根之下/);
  assert.ok(result.error.includes('/etc/passwd'));
});

test('S29: Windows 绝对路径拒绝（远端是 Linux）', () => {
  const result = validateTaskPaths(['C:\\Users\\x\\expr.tsv'], [], P);
  assert.equal(result.ok, false);
  assert.match(result.error, /Windows 绝对路径/);
});

test('S29: 空字符串条目拒绝并点名索引', () => {
  const result = validateTaskPaths([CURRENT, '   '], [], P);
  assert.equal(result.ok, false);
  assert.match(result.error, /inputs\[1\]/);
});

test('S29: 数据根本身不是文件路径，拒绝', () => {
  const result = validateTaskPaths(['/mnt/ssd/bio_data'], [], P);
  assert.equal(result.ok, false);
  assert.match(result.error, /不是文件路径/);
});

// ───────────── B. 提交层接线（真 HTTP + 假 ssh 垫片）─────────────

test('S29: 跨项目路径提交 400，且 ssh 垫片调用计数为 0（提交前就拦下）', async () => {
  shim.calls = [];
  const response = await submit({
    projectId: P,
    lineId: 'line1_bulk',
    step: 's29_deny_probe',
    inputs: ['/mnt/ssd/bio_data/projects/PRJ_OTHER/line1_bulk/processed/expr.tsv'],
    outputs: [],
    seed: 20261013,
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /跨项目/);
  assert.equal(
    shim.calls.filter((c) => c.kind === 'spawn').length,
    0,
    `跨项目路径必须在提交前拦下，不许有任何 ssh 下发: ${JSON.stringify(shim.calls)}`,
  );
});

test('S29: 含 .. 路径提交 400，且 ssh 垫片调用计数为 0', async () => {
  shim.calls = [];
  const response = await submit({
    projectId: P,
    lineId: 'line1_bulk',
    step: 's29_dotdot_probe',
    inputs: [`/mnt/ssd/bio_data/projects/${P}/line1_bulk/../../system_logs/x.json`],
    outputs: [],
    seed: 20261013,
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /含 \.\./);
  assert.equal(shim.calls.filter((c) => c.kind === 'spawn').length, 0);
});

test('S29: 现行形态合法路径仍能下发（200 + taskId + 任务 ssh 已启动）', async () => {
  shim.calls = [];
  const response = await submit({
    projectId: P,
    lineId: 'line1_bulk',
    step: 's29_ok_probe',
    inputs: [CURRENT],
    outputs: [],
    seed: 20261013,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.taskId, `应有 taskId: ${JSON.stringify(body)}`);
  assert.equal(
    shim.calls.some((c) => c.kind === 'spawn' && c.joined.includes('s29_ok_probe')),
    true,
    `合法路径应正常下发任务: ${JSON.stringify(shim.calls)}`,
  );
  // 收尾：垫片里任务已在退（exit 17），保险起见显式中止，不占并发位
  await fetch(`${BASE}/api/tasks/stop?id=${encodeURIComponent(body.taskId)}`, { signal: AbortSignal.timeout(5000) }).catch(() => {});
});

test('S29: 历史三线形态经 HTTP 仍能下发（E2E 旧形态不被打断）', async () => {
  shim.calls = [];
  const response = await submit({
    projectId: P,
    lineId: 'line1_bulk',
    step: 's29_legacy_probe',
    inputs: ['/mnt/ssd/bio_data/line1_bulk/processed/expr_genes.tsv'],
    outputs: [],
    seed: 20261013,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.taskId, `历史形态应正常下发: ${JSON.stringify(body)}`);
  assert.equal(
    shim.calls.some((c) => c.kind === 'spawn' && c.joined.includes('s29_legacy_probe')),
    true,
  );
  await fetch(`${BASE}/api/tasks/stop?id=${encodeURIComponent(body.taskId)}`, { signal: AbortSignal.timeout(5000) }).catch(() => {});
});
