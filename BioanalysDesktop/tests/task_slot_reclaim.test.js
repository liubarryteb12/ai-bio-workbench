/**
 * T0-6 任务位不得被已收敛的任务长期占用（幽灵 409）。
 *
 * 背景（2026-11 全量审查 SV-09/SV-10 实测改判）：
 *   server/routes/tasks.routes.js 先 `runningTasks.set(taskId, ...)` 再等 onExit 删除；
 *   而 server/run.js 的审计拒绝路径是**同步**回调 onExit 的，删除发生在登记之前，
 *   那条永远不会退出的人物就留在表里。提交层用 `runningTasks.size > 0` 做 P-29
 *   全局串行闸门（docs/termux_keepalive.md:125 禁止并发 ssh），于是一次失败
 *   就把后面所有项目的提交永久锁成 409，只能重启进程恢复。
 *
 * 本用例钉两条可观测契约：
 *   1. 新鲜任务位仍然硬拦（P-29 语义不许放松）；
 *   2. 超过回收上限的陈旧任务位必须被回收，让提交重新可用。
 * 回收上限取 80 分钟，是引擎自身 detached 超时（40 分钟，server/run.js:24）的两倍，
 * 比引擎给活任务的最长寿命还宽，不会误杀在跑的任务。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';

let runningTasks;

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

function fakeSshChild(exitCode) {
  const child = new EventEmitter();
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.stdin = new Writable({ write(_chunk, _enc, cb) { cb(); } });
  child.kill = () => child.emit('exit', exitCode, null);
  setImmediate(() => {
    child.stdout.push(null);
    child.stderr.push(null);
    setImmediate(() => child.emit('exit', exitCode, null));
  });
  return child;
}

before(async () => {
  process.env.BAD_PORT = String(PORT);
  const { mock } = await import('node:test');
  mock.method(childProcess, 'spawnSync', () => ({ status: 0, stdout: '', stderr: '' }));
  mock.method(childProcess, 'spawn', () => fakeSshChild(17));
  const mod = await import('../server/index.js');
  runningTasks = mod.runningTasks;
  assert.ok(runningTasks instanceof Map, 'server/index.js 必须导出 runningTasks 供状态回收断言');

  const deadline = Date.now() + 10000;
  for (;;) {
    try {
      const response = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) break;
    } catch { /* 没起来就继续等 */ }
    if (Date.now() > deadline) throw new Error(`服务 10s 内没就绪（端口 ${PORT}）`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
});

after(async () => {
  const mod = await import('../server/index.js');
  mod.server.closeAllConnections?.();
  await new Promise((resolve) => mod.server.close(resolve));
});

const P = 'default';
const IN = `/mnt/ssd/bio_data/projects/${P}/line1_bulk/processed/expr_genes.tsv`;
const OUT = `/mnt/ssd/bio_data/projects/${P}/line1_bulk/results/deg.tsv`;

async function submit(step) {
  return fetch(`${BASE}/api/tasks/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: P, lineId: 'line1_bulk', step, inputs: [IN], outputs: [OUT], seed: 42 }),
    signal: AbortSignal.timeout(30000),
  });
}

/** 往任务表里塞一条指定年龄的占位任务，模拟「登记后再也没退出」的幽灵 */
function seedSlot(ageMs, taskId = 'ghost-slot') {
  runningTasks.set(taskId, {
    kill: () => {},
    projectId: 'PRJ_OTHER',
    lineId: 'line1_bulk',
    step: 'deg',
    startedAt: new Date(Date.now() - ageMs).toISOString(),
  });
  return taskId;
}

test('新鲜任务位必须继续硬拦：P-29 禁止并发 SSH 的语义不许放松', async () => {
  runningTasks.clear();
  seedSlot(1000);
  const res = await submit('deg');
  assert.equal(res.status, 409, '有在跑任务时提交必须 409');
  const body = await res.json();
  assert.match(body.error, /P-29 禁止并发 SSH/);
  assert.equal(runningTasks.has('ghost-slot'), true, '新鲜任务位不许被回收');
  runningTasks.clear();
});

test('陈旧任务位必须被回收，让提交重新可用（幽灵 409 不再只能靠重启恢复）', async () => {
  runningTasks.clear();
  seedSlot(90 * 60 * 1000);
  const res = await submit('deg');
  const body = await res.json().catch(() => ({}));
  assert.equal(res.status, 200, `陈旧任务位应被回收并放行提交，实际 ${res.status}: ${JSON.stringify(body)}`);
  assert.equal(runningTasks.has('ghost-slot'), false, '陈旧任务位必须已被移除');
  runningTasks.clear();
});

test('startedAt 不可解析的任务位按新鲜处理，不得被误回收', async () => {
  runningTasks.clear();
  runningTasks.set('broken-slot', {
    kill: () => {}, projectId: 'PRJ_OTHER', lineId: 'line1_bulk', step: 'deg', startedAt: 'not-a-date',
  });
  const res = await submit('deg');
  assert.equal(res.status, 409, '时间戳坏掉时按新鲜保守处理，宁可拦也不放行并发');
  runningTasks.clear();
});
// T0-6 核心复现：审计拒绝路径在 runTask 内**同步**回调 onExit，而登记发生在它返回之后。
// 不修时这条任务位永久留在表里，下一次提交直接 409，只能重启进程恢复。
//
// 直接驱动登记接缝而不是整条 HTTP 链路：提交层的审计拒绝在路由里已经先拦成 400，
// 真正留幽灵的是引擎内部拒绝（run.js:53-58），那条路径在 HTTP 上不可控输入，
// 所以用纯函数把「onExit 已跑过」这个事实喂进去。
test('审计拒绝的任务位不得登记（onExit 早于登记时不留幽灵）', async () => {
  const { registerTaskSlot } = await import('../server/routes/tasks.routes.js');
  const table = new Map();
  const slot = { kill: () => {}, projectId: P, lineId: 'line1_bulk', step: 'deg', startedAt: new Date().toISOString() };

  // 正常路径：先登记，后退出
  assert.equal(registerTaskSlot(table, 'live-slot', slot, false), true, '正常任务必须登记');
  assert.equal(table.has('live-slot'), true);

  // 审计拒绝路径：runTask 返回前 onExit 已经跑过
  table.clear();
  assert.equal(registerTaskSlot(table, 'rejected-slot', slot, true), false, '已退出的任务不得登记');
  assert.equal(table.has('rejected-slot'), false, '幽灵条目必须被拦在登记口');
  assert.equal(table.size, 0, '表里不得留下任何幽灵任务位，否则 P-29 全局闸门恒 409');
});

