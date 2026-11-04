/**
 * T3-7 请求体上限与 413（先红后绿）
 *
 * 缺陷：server/ 下 12 处 JSON 入口把请求体无上限累积成字符串再 JSON.parse。
 * 任何能连到 18787 的本地进程发一个无限 body 就能把服务进程的内存打爆（DoS）。
 *
 * 判据（每条都能判定「做完没做完」）：
 *   1. 未超限：逐字节原样 resolve 出正文（含多字节 UTF-8 不被切坏）。
 *   2. 边界：等于 maxBytes 放行，超过一字节才拒。
 *   3. 超限：413 + error 点名上限字节数，调用方拿到 null 短路，且只回一个响应。
 *   4. 判定必须发生在 data 事件里：413 到达时客户端远未写完 body。
 *   5. 超限 body 不进堆：几十 MB 突发后本进程堆增长有界。
 *   6. 客户端中途断开：resolve(null)，不抛到进程级、不悬挂。
 *   7. maxBytes 非法立即抛 TypeError，拒绝静默换一套上限。
 *   8. runJsonRoute：处理体异常收敛成 500，已回过响应则不双写。
 *   9. 源码扫描：server/ 下 JSON 裸累积点为 0；upload.routes.js 的 raw 分片端点白名单排除。
 *  10. 12 处全部改走 collectJsonBody 并传具名常量（不许裸数字）。
 *  11. JSON_BODY_LIMIT 集中定义在 http_body.js，值为 1MB。
 *  12. 静态反证：上限比较与 413 回写都落在 data 回调体内。
 *  13. 派发接线：handler 声明 async，index.js 全部 await（漏 await 就绕过闸门）。
 *  14. pi-agent heartbeat：超限只回 413 一次；非法 JSON 仍回 400（既有语义不变）。
 *  15. 超限连接被服务端释放：静音客户端不能长期占住连接（防资源泄漏）。
 *  16. 端到端：真 server 派发链上三个入口超限回 413，零远端调用，服务仍活着。
 *
 * 运行：node --test tests/http_body_limit.test.js
 * 期望（改造前）：FAIL（server/http_body.js 还不存在，第 1 条就红）。
 * 期望（改造后）：PASS。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import childProcess from 'node:child_process';
import { mock } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(HERE, '..', 'server');

const { collectJsonBody, runJsonRoute, JSON_BODY_LIMIT } = await import('../server/http_body.js');

/**
 * 客户端等响应的上限（毫秒）。
 *
 * 没有它，「服务端一个字都不回」这种退化（413 分支被删）会让测试永远挂着：
 * 变异反证跑起来收不到红，只能收到超时，那是门禁最没用的失败形态。
 * 超时要变成一条可读的红断言（status 为 null），不是无限等待。
 */
const RESPONSE_DEADLINE_MS = 8000;
const { json } = await import('../server/http_response.js');

// ───────────────────────── 真实 HTTP 接缝 ─────────────────────────

/**
 * 起最小 http server 把 collectJsonBody 挂在真实 IncomingMessage 上。
 * 用真实 server 而不是伪造 req：字节流、data/end/close 的顺序、socket 流控
 * 正是这个缺陷的案发面，伪造 req 测不到「判定在 data 里」。
 */
function startHarness(maxBytes) {
  const state = { bodies: [], parsed: [], responses: 0 };
  const server = http.createServer(async (req, res) => {
    const body = await collectJsonBody(req, res, json, { maxBytes });
    state.bodies.push(body);
    if (body === null) return;
    try {
      state.parsed.push(JSON.parse(body || '{}'));
    } catch {
      state.parsed.push('<非法 JSON>');
    }
    state.responses += 1;
    json(res, 200, { ok: true });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, state, port: server.address().port });
    });
  });
}

async function stopHarness(harness) {
  harness.server.closeAllConnections?.();
  await new Promise((resolve) => harness.server.close(resolve));
}

/** 收响应正文；服务端可能在回完 413 后断连，故对截断宽容（status 来自头部，始终可信） */
function collectBody(res) {
  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', done);
    res.on('close', done);
    res.on('aborted', done);
    res.on('error', done);
  });
}

/** 一次性小请求（带 Content-Length）；默认打 /x，端到端用例传真 pathname */
function postBytes(port, payload, pathname = '/x') {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1', port, method: 'POST', path: pathname,
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
      },
      (res) => { collectBody(res).then((text) => resolve({ status: res.statusCode, text })).catch(reject); },
    );
    req.setTimeout(RESPONSE_DEADLINE_MS, () => req.destroy(new Error('等待响应超时：服务端没回出任何响应')));
    req.on('error', () => resolve({ status: null, text: '' }));
    req.end(payload);
  });
}

/**
 * 分片灌 totalBytes 字节的请求体，每片 sliceBytes 片间隔 delayMs。
 * 收到响应即记录 respondedAtBytes（此刻客户端已写出的字节数）并停止推送：
 * 这个数就是「判定发生在 data 事件里」的量尺。间隔让客户端写出量回到
 * 确定性尺度，不靠内核缓冲区大小赌时序。
 */
function blast(port, totalBytes, sliceBytes, delayMs) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.alloc(sliceBytes, 0x61); // 'aaaa...'：非合法 JSON，好计数
    let written = 0;
    let respondedAtBytes = null;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = http.request(
      { host: '127.0.0.1', port, method: 'POST', path: '/x', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        respondedAtBytes = written;
        collectBody(res).then((text) => finish({ status: res.statusCode, text, respondedAtBytes }));
      },
    );
    req.setTimeout(RESPONSE_DEADLINE_MS, () => req.destroy(new Error('等待响应超时')));
    // 服务端回完 413 会断开连接：客户端后续写入报错属预期，响应已在路上就忽略
    req.on('error', (err) => {
      finish({ status: null, text: '', respondedAtBytes });
    });
    function pump() {
      if (settled || req.destroyed) return;
      if (written >= totalBytes) { req.end(); return; }
      written += sliceBytes;
      try {
        if (req.write(payload) === false) req.once('drain', pump);
        else setTimeout(pump, delayMs);
      } catch (err) {
        if (respondedAtBytes === null) reject(err);
      }
    }
    pump();
  });
}

test('1. 未超限：逐字节原样 resolve 出正文，200 正常返回', async () => {
  const harness = await startHarness(1024);
  try {
    const payload = Buffer.from(JSON.stringify({ projectId: 'default', 名称: '中文键', n: 1 }), 'utf8');
    const response = await postBytes(harness.port, payload);
    assert.equal(response.status, 200, response.text);
    assert.deepEqual(JSON.parse(response.text), { ok: true });
    assert.equal(harness.state.bodies.length, 1);
    assert.equal(harness.state.bodies[0], payload.toString('utf8'), 'resolve 的必须是请求体原文');
    assert.deepEqual(harness.state.parsed[0], { projectId: 'default', 名称: '中文键', n: 1 },
      '多字节 UTF-8 不能被切坏：逐 chunk 强转会替换字符，必须按字节缓冲后整体解码');
    assert.equal(harness.state.responses, 1);
  } finally {
    await stopHarness(harness);
  }
});

test('2. 边界：正文恰好等于 maxBytes 放行，多一字节才拒', async () => {
  const maxBytes = 256;
  const harness = await startHarness(maxBytes);
  try {
    const atLimit = await postBytes(harness.port, Buffer.alloc(maxBytes, 0x61));
    assert.equal(atLimit.status, 200, '等于上限是合法请求，不该 413');
    assert.equal(harness.state.bodies[0].length, maxBytes);

    const overLimit = await postBytes(harness.port, Buffer.alloc(maxBytes + 1, 0x61));
    assert.equal(overLimit.status, 413, '超过上限必须 413；null 表示服务端一个响应都没回');
    assert.match(JSON.parse(overLimit.text).error, /请求体超过上限 256 字节/);
    assert.deepEqual(harness.state.bodies.slice(1), [null], '超限后调用方必须拿到 null 短路');
  } finally {
    await stopHarness(harness);
  }
});

test('3. 超限：413 且 error 点名上限字节数，调用方 null 短路，只回一个响应', async () => {
  const harness = await startHarness(1024);
  try {
    const response = await postBytes(harness.port, Buffer.alloc(5 * 1024, 0x61));
    assert.equal(response.status, 413, '超限必须回 413；null 表示服务端一个响应都没回');
    assert.deepEqual(JSON.parse(response.text), { error: '请求体超过上限 1024 字节' });
    assert.deepEqual(harness.state.bodies, [null], '超限必须 resolve(null)，让调用方短路返回');
    assert.equal(harness.state.responses, 0,
      '短路后不得再写第二个响应：双写会抛 ERR_HTTP_HEADERS_SENT 打死进程');
  } finally {
    await stopHarness(harness);
  }
});

test('4. 判定在 data 事件里：413 到达时客户端远未写完 body', async () => {
  // 这条是内存防线的行为证据。把上限判定挪到 end 之后（先累积完再查长度），
  // 服务端只能在全量字节落地后才可能回响应，respondedAtBytes 就等于总字节数，
  // 而那时内存已经打爆：本断言必红。
  const totalBytes = 16 * 1024 * 1024;
  const sliceBytes = 256 * 1024;
  const harness = await startHarness(4096);
  try {
    const response = await blast(harness.port, totalBytes, sliceBytes, 5);
    assert.equal(response.status, 413, '超限请求必须回 413；null 表示服务端一个响应都没回');
    assert.ok(response.respondedAtBytes !== null, '客户端必须收到响应');
    assert.ok(
      response.respondedAtBytes < 2 * 1024 * 1024,
      '413 应在第一个超限 chunk 到达时就回出；实际客户端已写出 ' + response.respondedAtBytes
      + ' 字节（阈值 2MB / 总 16MB）：说明判定没有发生在 data 事件里',
    );
  } finally {
    await stopHarness(harness);
  }
});

test('5. 超限 body 不进堆：16MB 突发后本进程堆增长有界', async () => {
  const harness = await startHarness(4096);
  // 预热一次分配路径，避免把首请求的一次性开销算成 body 残留
  await postBytes(harness.port, Buffer.alloc(16, 0x61)).catch(() => {});
  const before = process.memoryUsage().heapUsed;
  try {
    const response = await blast(harness.port, 16 * 1024 * 1024, 256 * 1024, 1);
    assert.equal(response.status, 413);
    const growth = process.memoryUsage().heapUsed - before;
    // 裸累积会把 16MB（外加 Buffer.concat 的再一份）留在堆上；按 data 闸门丢弃后
    // 只剩 4KB 上限内的常量级分配。阈值取突发的三分之一：绿侧余量足够，红侧必超。
    assert.ok(growth < 6 * 1024 * 1024,
      '堆增长 ' + Math.round(growth / 1024 / 1024) + 'MB，body 被保留了');
    assert.deepEqual(harness.state.bodies.slice(-1), [null], '超限请求不得把正文交给调用方');
  } finally {
    await stopHarness(harness);
  }
});

test('6. 客户端中途断开：resolve(null)，不抛到进程级也不悬挂', async () => {
  const harness = await startHarness(1024 * 1024);
  const uncaught = [];
  const onUncaught = (err) => uncaught.push(err);
  process.on('uncaughtException', onUncaught);
  try {
    await new Promise((resolve) => {
      const req = http.request(
        { host: '127.0.0.1', port: harness.port, method: 'POST', path: '/x', agent: false },
        (res) => { res.resume(); res.on('close', resolve); res.on('end', resolve); },
      );
      req.on('error', resolve); // 半截 body 被服务端断开是预期路径
      // 先把请求头与 body 真的推到对端：flushHeaders 之前 destroy 等于什么都没发，
      // 服务端 handler 根本不会跑，那条断言就变成测客户端自己的缓冲。
      req.flushHeaders();
      setTimeout(() => { req.write(Buffer.alloc(64 * 1024, 0x61)); }, 80);
      setTimeout(() => { req.destroy(); }, 200);
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.deepEqual(harness.state.bodies, [null], '断开必须以 null 收尾，Promise 不许永远悬着');
    assert.deepEqual(uncaught.map((e) => String(e && e.message)), [], '断开不得把异常抛到进程级');
    const alive = await postBytes(harness.port, Buffer.from('{"ok":1}', 'utf8'));
    assert.equal(alive.status, 200, '断开一次后服务仍要可用');
  } finally {
    process.removeListener('uncaughtException', onUncaught);
    await stopHarness(harness);
  }
});

test('7. maxBytes 非法立即抛 TypeError，拒绝静默换一套上限', async () => {
  for (const bad of [0, -1, Number.NaN, Infinity, '1024', null, undefined, 1.5]) {
    assert.throws(
      () => collectJsonBody(new EventEmitter(), {}, json, { maxBytes: bad }),
      TypeError,
      'maxBytes=' + String(bad) + ' 必须当场抛错，而不是悄悄按默认值放行',
    );
  }
});

test('8. runJsonRoute：处理体异常收敛成 500，已回过响应则不双写', async () => {
  const writes = [];
  const spyJson = (res, status, payload) => { writes.push({ status, payload }); };

  await runJsonRoute(async () => { throw new Error('inputs 传了对象'); }, {}, spyJson);
  assert.equal(writes.length, 1, '异常必须回且只回一次');
  assert.equal(writes[0].status, 500);
  assert.match(writes[0].payload.error, /inputs 传了对象/);

  writes.length = 0;
  // resStub 表示「响应已经写出」：处理体里自己回过 200 之后再抛错，
  // 收敛层必须闭嘴，不能补第二个响应（补写会抛 ERR_HTTP_HEADERS_SENT 打死进程）。
  await runJsonRoute(async () => { throw new Error('收尾再炸'); }, resStub(), spyJson);
  assert.deepEqual(writes, [], '响应已写出时不得再补第二个响应');

  writes.length = 0;
  await runJsonRoute(async () => '返回值', {}, spyJson);
  assert.deepEqual(writes, [], '正常路径不写任何响应');
});

function resStub() {
  return { headersSent: true, writableEnded: true, writeHead() {}, end() {} };
}

// ───────────────────────── 源码扫描接缝 ─────────────────────────

/** 12 处 JSON 入口的期望分布：helper 收口的 pi_agent 记 1 处 */
const EXPECTED_CALLS = {
  'pi_agent_routes.js': 1,
  'routes/figures.routes.js': 2,
  'routes/projects.routes.js': 5,
  'routes/report.routes.js': 1,
  'routes/tasks.routes.js': 1,
  'routes/upload.routes.js': 2,
};
const EXPECTED_TOTAL = Object.values(EXPECTED_CALLS).reduce((a, b) => a + b, 0);
const CALL_SHAPE = 'collectJsonBody(req, res, json, { maxBytes: JSON_BODY_LIMIT })';

function trackedSource(relPath) {
  return fs.readFileSync(path.join(SERVER_DIR, relPath), 'utf8');
}

function listServerJs(dir = SERVER_DIR, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listServerJs(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('9. 源码扫描：server/ 下 JSON 裸累积点为 0（raw 分片端点白名单排除）', () => {
  // 案发形态是「字符串累加后 JSON.parse」。分片写盘链路是 raw 二进制进 Buffer 数组
  // 加字节预算（走会话预留额度 413），形态不同且不在本任务范围：这里既断言它没被
  // 误改成 collectJsonBody，也断言它的预算闸门原样还在。
  const offenders = [];
  for (const file of listServerJs()) {
    const rel = path.relative(SERVER_DIR, file).split(path.sep).join('/');
    if (rel === 'http_body.js') continue; // 闸门本体
    const lines = trackedSource(rel).split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (/body\s*\+=\s*chunk/.test(line)) offenders.push(rel + ':' + (idx + 1) + ': ' + line.trim());
    });
  }
  assert.deepEqual(offenders, [], '仍有 JSON 请求体无上限累积：\n' + offenders.join('\n'));

  const uploadRaw = trackedSource('routes/upload.routes.js');
  assert.match(uploadRaw, /chunks\.push\(chunk\)/, '分片写盘链路的 raw Buffer 累积必须保持原样');
  assert.match(uploadRaw, /size > CHUNK_SIZE \* 2/, '分片端点的字节预算闸门必须还在');
  assert.equal(uploadRaw.includes('collectJsonBody(req, res, json, { maxBytes: JSON_BODY_LIMIT })\n    req.on') , false);
});

test('10. 12 处全部改走 collectJsonBody 并传具名常量，且无裸数字上限', () => {
  let total = 0;
  for (const [rel, expected] of Object.entries(EXPECTED_CALLS)) {
    const calls = trackedSource(rel).split(CALL_SHAPE).length - 1;
    assert.equal(calls, expected,
      rel + ' 的 collectJsonBody 调用点数量不符：期望 ' + expected + '，实得 ' + calls);
    total += calls;
    assert.match(trackedSource(rel), /from '\.\.\/http_body\.js'|from '\.\/http_body\.js'/,
      rel + ' 未 import http_body.js');
  }
  assert.equal(total, EXPECTED_TOTAL,
    '调用点总数应为 12（pi_agent 1 + figures 2 + projects 5 + report 1 + tasks 1 + upload 2）');

  for (const file of listServerJs()) {
    const rel = path.relative(SERVER_DIR, file).split(path.sep).join('/');
    if (rel === 'http_body.js') continue;
    const bare = fs.readFileSync(file, 'utf8').match(/maxBytes:\s*\d/g) || [];
    assert.deepEqual(bare, [], rel + ' 里 maxBytes 用了裸数字，上限必须引用命名常量');
  }
});

test('11. JSON_BODY_LIMIT：值为 1MB 且集中定义在 http_body.js', () => {
  assert.equal(JSON_BODY_LIMIT, 1024 * 1024, 'JSON 配置类端点上限按裁定取 1MB');
  assert.match(trackedSource('http_body.js'), /export const JSON_BODY_LIMIT = 1024 \* 1024;/,
    '常量必须是导出真源，不许各路由各写一份');
});

test('12. 静态反证：上限比较与 413 回写都落在 data 回调体内', () => {
  const text = trackedSource('http_body.js');
  const dataAt = text.indexOf("req.on('data'");
  const endAt = text.indexOf("req.on('end'");
  assert.ok(dataAt >= 0, "缺 req.on('data')");
  assert.ok(endAt > dataAt, "缺 req.on('end') 或顺序颠倒");
  const dataBody = text.slice(dataAt, endAt);
  assert.match(dataBody, /maxBytes/, '上限比较必须在 data 回调内，不能等 end 后查长度');
  assert.match(dataBody, />\s*maxBytes/, '判定形态必须是「超过上限」（等于上限放行由断言 2 兜）');
  assert.match(dataBody, /json\(\s*res\s*,\s*413/, '413 必须在 data 回调里直接回出');
  assert.match(dataBody, /chunks\.length = 0|resolve\(null\)/, '超限必须丢弃已缓冲的字节');
});

test('13. 派发接线：handler 声明 async，index.js 全部 await', () => {
  // 上限闸门在 await 之后才生效。handler 漏 async 或调用点漏 await，
  // 「命中即 return true」的派发约定会拿到 Promise 之外的值，请求直接悬挂。
  const handlers = [
    ['routes/projects.routes.js', 'handleProjectRoutes'],
    ['routes/figures.routes.js', 'handleFiguresRoutes'],
    ['routes/tasks.routes.js', 'handleTasksRoutes'],
    ['routes/report.routes.js', 'handleReportRoutes'],
    ['routes/upload.routes.js', 'handleUploadRoutes'],
    ['pi_agent_routes.js', 'handlePiAgentRoutes'],
    ['routes/diagnostics.routes.js', 'handleDiagnosticsRoutes'],
  ];
  for (const [rel, name] of handlers) {
    assert.match(trackedSource(rel), new RegExp('export async function ' + name + '\\('),
      name + ' 必须声明为 async');
  }
  const index = trackedSource('index.js');
  for (const [, name] of handlers) {
    assert.match(index, new RegExp('await ' + name + '\\('), 'index.js 必须 await ' + name);
    assert.equal(new RegExp('if \\(' + name + '\\(').test(index), false,
      'index.js 里 ' + name + ' 还有一处未 await 的裸调用');
  }
  // 派发约定不退化：命中仍 return true / 未命中 return false
  assert.match(index, /if \(await handleTasksRoutes\(req, res, url, routeCtx\)\) \{/,
    '任务路由派发必须保持 if (await ...) 形态');
});

// ───────────── pi-agent 接线：helper 收口，超限与非法 JSON 不双写 ─────────────

/** 伪造与既有 pi_agent_routes.test.js 同款的事件流 req（无 socket：闸门实现不碰 socket） */
function fakeReq(chunks) {
  const req = new EventEmitter();
  req.method = 'POST';
  req.url = '/api/v1/a2a/heartbeat';
  req.pause = () => {};
  req.resume = () => {};
  process.nextTick(() => {
    for (const chunk of chunks) req.emit('data', chunk);
    req.emit('end');
  });
  return req;
}

/** ledgerRoot 注入临时目录：心跳会写 actions 台账，测试不得污染 con_hf/ledger 正本 */
function tempLedgerRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pi-body-limit-'));
}

async function driveHeartbeat(chunks) {
  const { handlePiAgentRoutes } = await import('../server/pi_agent_routes.js');
  const responses = [];
  const sshCalls = [];
  const handled = await handlePiAgentRoutes(
    fakeReq(chunks),
    {},
    new URL('http://x/api/v1/a2a/heartbeat'),
    {
      json: (res, status, payload) => responses.push({ status, payload }),
      runSshRaw: () => { sshCalls.push(1); return { code: 0, text: '' }; },
      ledgerRoot: tempLedgerRoot(),
    },
  );
  return { handled, responses, sshCalls };
}

test('14. pi-agent heartbeat：超限只回 413 一次，非法 JSON 仍回 400', async () => {
  const big = await driveHeartbeat([Buffer.alloc(2 * 1024 * 1024, 0x7b)]); // 2MB 的 '{'
  assert.equal(big.handled, true);
  assert.deepEqual(big.responses.map((r) => r.status), [413],
    '超限后不得再补第二个响应：双写会抛 ERR_HTTP_HEADERS_SENT 打死进程');
  assert.match(big.responses[0].payload.error, /请求体超过上限 1048576 字节/);

  const bad = await driveHeartbeat([Buffer.from('not-json', 'utf8')]);
  assert.deepEqual(bad.responses.map((r) => r.status), [400], '非法 JSON 的既有语义必须保持 400');

  const ok = await driveHeartbeat([Buffer.from(JSON.stringify({ node_id: 'k40-ubuntu-node01' }), 'utf8')]);
  assert.deepEqual(ok.responses.map((r) => r.status), [200], '合法心跳仍照常 200');
  assert.equal(ok.handled, true);
});

test('15. 超限连接被服务端释放：客户端静音不写也躲不掉', async () => {
  // 真实攻击形态是「发够超限字节就静音」：连接不释放就是长期占住句柄的资源泄漏。
  // 用 raw net socket 精确控制：只发超限 body，之后一个字都不写。
  const harness = await startHarness(1024);
  try {
    const closed = await new Promise((resolve, reject) => {
      const socket = net.connect(harness.port, '127.0.0.1');
      let status = null;
      let buf = '';
      socket.on('error', reject);
      socket.on('data', (chunk) => {
        buf += chunk.toString('latin1');
        if (status === null && buf.startsWith('HTTP/1.')) {
          const nl = buf.indexOf('\r\n');
          const code = Number(buf.slice(0, nl > 0 ? nl : 12).split(' ')[1]);
          if (Number.isInteger(code)) status = code;
        }
      });
      socket.on('close', () => resolve({ status }));
      socket.on('connect', () => {
        // 声明很长的 Content-Length，实际只发超限的一点点，然后彻底静音
        socket.write('POST /x HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 1000000\r\n\r\n');
        socket.write(Buffer.alloc(4096, 0x61));
      });
      setTimeout(() => { socket.destroy(); resolve({ status, timedOut: true }); }, 5000);
    });
    assert.equal(closed.status, 413, 'raw 客户端必须先读到 413');
    assert.equal(closed.timedOut, undefined,
      '超限后服务端必须在一个短窗口内主动断开，静音客户端不该长期占住连接');
    assert.deepEqual(harness.state.bodies, [null]);
  } finally {
    await stopHarness(harness);
  }
});

// ───────────── 端到端：真实 index.js 派发链上的 413 ─────────────

/** 取空闲端口（与 index.test.js / task_submit_validation.test.js 同款先例） */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

test('16. 端到端：真服务派发链上超限回 413，进程存活且合法请求照常', async () => {
  // 断言 9~13 是静态面（源码扫描 + 接线文本），这条是动态面：真 http.createServer
  // 走完鉴权、派发、handler、闸门、业务校验的完整链。漏接一个 await 或漏改一处
  // 入口，这条会直接给出 200/超时，而不是靠文本匹配蒙过去。
  const port = await freePort();
  process.env.BAD_PORT = String(port);
  process.env.BIO_ALLOW_DEV_NOAUTH = '1';
  delete process.env.BIO_AUTH_RUNTIME_FILE;
  // ssh/scp 垫片：超限请求本不该走到远端；真走到了就让 mock 计数暴露它（不碰真实链路）
  const sshCalls = [];
  mock.method(childProcess, 'spawnSync', (cmd, args) => {
    sshCalls.push({ api: 'spawnSync', cmd, joined: (args || []).join(' ') });
    return { status: 0, stdout: '', stderr: '', error: null };
  });
  mock.method(childProcess, 'spawn', (cmd, args) => {
    sshCalls.push({ api: 'spawn', cmd, joined: (args || []).join(' ') });
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdout.push = () => true; child.stdout.end = () => {}; child.stderr.push = () => true; child.stderr.end = () => {};
    child.stdin = { write() {}, end() {} }; child.kill = () => {}; child.unref = () => {};
    setImmediate(() => child.emit('exit', 0, null));
    return child;
  });
  const mod = await import('../server/index.js');
  try {
    const deadline = Date.now() + 15000;
    for (;;) {
      try {
        const probe = await fetch('http://127.0.0.1:' + port + '/api/health', { signal: AbortSignal.timeout(1000) });
        if (probe.ok) break;
      } catch { /* 还没起来 */ }
      if (Date.now() > deadline) throw new Error('服务 15s 内没就绪（端口 ' + port + '）');
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    // 三个不同前缀的入口：任务下发、建项、上传初始化（三条不同 handler 模块）
    for (const pathname of ['/api/tasks/submit', '/api/projects/create', '/api/upload/init']) {
      const response = await postBytes(port, Buffer.alloc(JSON_BODY_LIMIT + 64 * 1024, 0x61), pathname);
      assert.equal(response.status, 413, pathname + ' 的超限请求必须被闸门拒掉');
      assert.match(JSON.parse(response.text).error, /请求体超过上限 1048576 字节/);
    }
    assert.deepEqual(sshCalls, [], '超限请求必须在闸门处就短路，一次远端调用都不该发');

    // 闸门没把服务打坏：合法的小请求照常进业务校验
    const small = await postBytes(port, Buffer.from(JSON.stringify({ projectId: 'default', lineId: 'nope', filename: 'a.csv' }), 'utf8'), '/api/upload/init');
    assert.notEqual(small.status, 413, '合法大小的请求不该被上限误伤');
    assert.match(JSON.parse(small.text).error, /归属线|lineId/, '必须走到既有的业务校验（证明只是加了闸门）');
    const health = await fetch('http://127.0.0.1:' + port + '/api/health', { signal: AbortSignal.timeout(3000) });
    assert.equal(health.status, 200, '三次超限之后服务进程仍活着');
  } finally {
    mock.restoreAll();
    mod.server.closeAllConnections?.();
    await new Promise((resolve) => mod.server.close(resolve));
  }
});
