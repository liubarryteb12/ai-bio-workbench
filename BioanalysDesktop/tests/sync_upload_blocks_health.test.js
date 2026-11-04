/**
 * 红测：同步 scp 上传会卡死事件循环（改造前必红，改造后必绿）
 * ============================================================
 * 判据：在 POST /api/upload/complete 走完 scp + 字节校验的那段时间里，
 *       从**进程外**的健康探针每 40ms 打一次 GET /api/health，
 *       上传窗口内单次响应耗时必须 <= HEALTH_DEADLINE_MS。
 *
 * 探针必须另起进程：若探针与服务器同在一个事件循环，spawnSync 一阻塞，
 * 探针自己的 setTimeout 也停摆，测出的延迟永远是阻塞结束后 2ms，得到假绿。
 * 2026-11-04 实测（同进程版）：healthLatencyMs=2，而实际上传耗时 3026ms。
 * 所以下面还有一条反向断言：探针必须是独立子进程，且样本数 >= 3。
 *
 * 用替身而不真跑 scp：两处调用点的 timeoutMs 都写死 900000（15 分钟），红测等不起。
 * 替身挂在 proc.js 的唯一出口 child_process.spawnSync / child_process.spawn 上，
 * 同一断言对同步实现（红）与异步实现（绿）都成立。
 *
 * 改造前实测（2026-11-04，三处调用点全是 runSync）：
 *   completeLatencyMs 3022，探针最慢 2993ms，childCalls [spawnSync:scp, spawnSync:ssh]
 * 改造中间态实测（只改 scp、stat 探针仍同步）：探针最慢 1495ms，仍 > 1000ms 必红。
 * 所以本测试的真实判据是「整条上传链路上再没有任何同步子进程出口」。
 *
 * 运行：node --test tests/sync_upload_blocks_health.test.js
 * 期望（改造前）：FAIL。期望（改造后）：PASS。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const SLOW_TRANSFER_MS = 1500;
const HEALTH_DEADLINE_MS = 1000;
const PAYLOAD_BYTES = 4096;
const POLL_INTERVAL_MS = 40;

// 端口固定：其它用例也用 BAD_PORT，串行执行不会撞车（npm test 带 --test-concurrency=1）
process.env.BAD_PORT = process.env.BAD_PORT || '19099';
process.env.BIO_ALLOW_DEV_NOAUTH = '1';
delete process.env.BIO_AUTH_RUNTIME_FILE;
const PORT = Number(process.env.BAD_PORT);

// 先抓住真出口，替身只拦 scp / ssh，探针子进程要走真 spawn
const realSpawnSync = childProcess.spawnSync.bind(childProcess);
const realSpawn = childProcess.spawn.bind(childProcess);
const calls = [];

function isStatCommand(args) {
  return (args || []).some((part) => String(part).includes('stat -c %s'));
}

/** 同步阻塞替身：Atomics.wait 精确占住主线程，等价于 spawnSync 的阻塞语义 */
function blockMainThread(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

childProcess.spawnSync = function fakeSpawnSync(program, args, options) {
  if (!['scp', 'ssh'].includes(program)) return realSpawnSync(program, args, options);
  calls.push({ api: 'spawnSync', program: String(program) });
  blockMainThread(SLOW_TRANSFER_MS);
  return { status: 0, stdout: isStatCommand(args) ? String(PAYLOAD_BYTES) : '', stderr: '', error: null, signal: null };
};

childProcess.spawn = function fakeSpawn(program, args, options) {
  if (!['scp', 'ssh'].includes(program)) return realSpawn(program, args, options);
  calls.push({ api: 'spawn', program: String(program) });
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  const timer = setTimeout(() => {
    if (isStatCommand(args)) child.stdout.write(String(PAYLOAD_BYTES));
    child.stdout.end();
    child.stderr.end();
    child.emit('exit', 0);
    child.emit('close', 0);
  }, SLOW_TRANSFER_MS);
  timer.unref();
  return child;
};

// 健康探针子进程源码：独立事件循环，只做一件事，每 40ms 打一次 /api/health
const PROBE_SOURCE = [
  "const http = require('node:http');",
  'const deadline = Date.now() + 12000;',
  'let started = 0;',
  'function stamp(line) { process.stdout.write(line + String.fromCharCode(10)); }',
  'function one() {',
  '  started = Date.now();',
  '  const req = http.get({ host: "127.0.0.1", port: ' + PORT + ', path: "/api/health", timeout: 5000 }, (res) => {',
  '    res.resume();',
  '    res.on("end", () => {',
  '      stamp("PROBE " + started + " " + (Date.now() - started) + " " + res.statusCode);',
  '      next();',
  '    });',
  '  });',
  '  req.on("error", () => { stamp("PROBE " + started + " -1 0"); next(); });',
  '  req.on("timeout", () => { req.destroy(); });',
  '}',
  'function next() {',
  '  if (Date.now() < deadline) setTimeout(one, ' + POLL_INTERVAL_MS + ');',
  '  else process.exit(0);',
  '}',
  'setTimeout(one, 30);',
].join(String.fromCharCode(10));

function request(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1', port: PORT, method, path: pathname, timeout: 30000,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {},
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function sendChunk(uploadId, index, buf) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: PORT, method: 'POST',
      path: '/api/upload/chunk?uploadId=' + encodeURIComponent(uploadId) + '&index=' + index,
      timeout: 30000, headers: { 'Content-Length': buf.length },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(buf);
  });
}

test('上传期间并发 /api/health 必须持续可用', async (t) => {
  const { server } = await import('../server/index.js');
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));

  // 反向断言 1（防假绿）：探针必须是独立进程，不是服务器事件循环里的一个定时器
  const prober = realSpawn(process.execPath, ['-e', PROBE_SOURCE], { stdio: ['ignore', 'pipe', 'ignore'] });
  assert.equal(typeof prober.pid, 'number', '健康探针必须是独立子进程（同进程探针会假绿）');
  const probeLines = [];
  prober.stdout.on('data', (buf) => {
    for (const line of buf.toString('utf8').split(String.fromCharCode(10))) {
      if (!line.startsWith('PROBE ')) continue;
      const parts = line.trim().split(' ');
      probeLines.push({ startedAt: Number(parts[1]), latencyMs: Number(parts[2]), status: Number(parts[3]) });
    }
  });

  t.after(() => {
    childProcess.spawnSync = realSpawnSync;
    childProcess.spawn = realSpawn;
    try { prober.kill(); } catch {}
    server.close();
  });

  await new Promise((resolve) => setTimeout(resolve, 250));

  const init = await request('POST', '/api/upload/init', {
    lineId: 'line1_bulk', projectId: 'PRJ_REDTEST', filename: 'red_probe_data.txt',
    size: PAYLOAD_BYTES, lastModified: 1762260000000,
  });
  assert.equal(init.status, 200, 'init 失败：' + init.body);
  const uploadId = JSON.parse(init.body).uploadId;

  const chunk = Buffer.from(('bioanalys red probe line' + String.fromCharCode(10)).repeat(200).slice(0, PAYLOAD_BYTES), 'utf8');
  const chunkRes = await sendChunk(uploadId, 0, chunk);
  assert.equal(chunkRes.status, 200, 'chunk 写入失败：' + chunkRes.body);

  calls.length = 0;
  const completeStartedAt = Date.now();
  const complete = await request('POST', '/api/upload/complete', {
    uploadId, lineId: 'line1_bulk', projectId: 'PRJ_REDTEST', filename: 'red_probe_data.txt',
  });
  const completeEndedAt = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 400));
  try { prober.kill(); } catch {}

  assert.equal(complete.status, 200, 'complete 非 200：' + complete.body);

  // 只取落在上传窗口内、且探针确实拿到 200 的样本
  const inWindow = probeLines
    .filter((row) => row.status === 200 && row.latencyMs >= 0)
    .filter((row) => row.startedAt >= completeStartedAt - POLL_INTERVAL_MS
      && row.startedAt <= completeEndedAt + POLL_INTERVAL_MS)
    .sort((a, b) => a.startedAt - b.startedAt);

  let maxGapMs = 0;
  for (let i = 1; i < inWindow.length; i += 1) {
    maxGapMs = Math.max(maxGapMs, inWindow[i].startedAt - inWindow[i - 1].startedAt);
  }
  const maxLatencyMs = inWindow.reduce((max, row) => Math.max(max, row.latencyMs), 0);

  console.log(JSON.stringify({
    completeLatencyMs: completeEndedAt - completeStartedAt,
    slowTransferMs: SLOW_TRANSFER_MS,
    healthDeadlineMs: HEALTH_DEADLINE_MS,
    probesInWindow: inWindow.length,
    maxProbeGapMs: maxGapMs,
    maxProbeLatencyMs: maxLatencyMs,
    childCalls: calls,
  }, null, 2));

  // 反向断言 2（防假绿）：独立进程必须真的产出样本，否则断言 vacuously true
  assert.ok(probeLines.length >= 3, '探针样本过少（应 >= 3），反馈环不成立：' + probeLines.length);
  assert.ok(inWindow.length >= 3, '上传窗口内探针样本过少：' + inWindow.length);
  assert.ok(maxLatencyMs <= HEALTH_DEADLINE_MS,
    '上传链路阻塞事件循环：上传窗口内并发 /api/health 最慢一次等了 ' + maxLatencyMs + 'ms（上限 '
      + HEALTH_DEADLINE_MS + 'ms），探针空档 ' + maxGapMs + 'ms，上传请求本身 '
      + (completeEndedAt - completeStartedAt) + 'ms；子进程出口：' + JSON.stringify(calls));
});
/**
 * 静态面：上传链路这几处不许再退回同步出口。
 *
 * 上面那条运行时用例只覆盖 POST /api/upload/complete 真正走到的两个出口
 * （scp 与字节校验的 stat）。task_input.js 的 deployDataFiles /
 * uploadPreparedFigureScripts 走的是建项链路，红色反馈环够不到，
 * 所以「同一件事」在这里用源码断言钉住：这几处一旦改回 runSync / runRemote，
 * 事件循环阻塞会原样复现，而运行时用例因为不经过那条路径会假绿。
 */
test('上传与建项链路的 scp / stat 出口全部是异步版', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server');

  const cases = [
    { rel: 'routes/upload.routes.js', forbidden: [/\brunSync\(/, /\brunRemote\(/, /\brunRemoteRaw\(/] },
    { rel: 'task_input.js', forbidden: [/\brunSync\(/, /\brunRemote\(/, /\brunRemoteRaw\(/] },
  ];
  const violations = [];
  for (const item of cases) {
    const text = fs.readFileSync(path.join(SERVER, item.rel), 'utf8');
    for (const re of item.forbidden) {
      if (re.test(text)) violations.push(item.rel + ' -> ' + re.source);
    }
    // 五处出口必须真的走异步函数，防止「删掉了同步调用」也顺手删掉上传本身
    const expected = item.rel === 'task_input.js'
      ? [/\brunAsync\(/, /\brunSshAsync\(/]
      : [/\brunAsync\(/, /\brunSshAsync\(/];
    for (const re of expected) {
      if (!re.test(text)) violations.push(item.rel + ' 缺异步出口 ' + re.source);
    }
  }
  assert.deepEqual(violations, [], '上传链路退回同步出口：' + JSON.stringify(violations));
});
