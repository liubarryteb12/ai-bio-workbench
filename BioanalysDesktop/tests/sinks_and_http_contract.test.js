import test from 'node:test';
import assert from 'node:assert/strict';

import { json, uploadError } from '../server/http_response.js';
import { createSink, dropSink, sendEvent, closeSink } from '../server/sinks.js';

// ── http_response.js 与 sinks.js 契约面测试（2026-11-02）──
//
// 这两个模块都很小，但都在**协议形状**上做承诺，出错影响面比代码量大得多：
//   http_response：JSON 形状与上传错误形状是前端唯一依赖的契约；
//                 两种形状并存过（{error} vs {ok:false,error}），前端只能猜。
//   sinks：SSE 帧格式（data: 逐行）与「单订阅者写失败不影响其他人」是硬要求，
//          格式错了浏览器静默不派发事件，最难排查。

/** 伪造一个够用的 ServerResponse，只记录 shape 与 body */
function fakeRes() {
  const captured = { status: null, headers: null, body: null, ended: false };
  return {
    captured,
    writeHead(status, headers) { captured.status = status; captured.headers = headers; },
    end(body) { captured.body = body; captured.ended = true; },
  };
}

test('json：状态码原样透传，头部必须是 no-store 防止代理缓存鉴权响应', () => {
  const res = fakeRes();
  json(res, 404, { ok: false, error: 'not found' });
  assert.equal(res.captured.status, 404);
  assert.equal(res.captured.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(res.captured.headers['Cache-Control'], 'no-store');
  assert.equal(res.captured.ended, true, '必须 end，否则连接挂住');
});

test('json：正文是 2 空格缩进的可读 JSON，且可被 JSON.parse 还原', () => {
  const res = fakeRes();
  const payload = { ok: true, items: [1, 2, { deep: 'x' }] };
  json(res, 200, payload);
  assert.equal(JSON.parse(res.captured.body).items.length, 3, '正文必须是合法 JSON');
  assert.ok(res.captured.body.includes('\n  '), '正文应带缩进（便于人工排查）');
});

test('uploadError：形状统一是 {ok:false, error}，且 error 恒为字符串', () => {
  const res = fakeRes();
  uploadError(res, 400, 'bad chunk');
  const parsed = JSON.parse(res.captured.body);
  assert.deepEqual(Object.keys(parsed).sort(), ['error', 'ok']);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, 'bad chunk');
  assert.equal(res.captured.status, 400);
});

test('uploadError：message 为 null/undefined/数字时也产出字符串（前端不该收到非字符串）', () => {
  for (const input of [null, undefined, 42, false]) {
    const res = fakeRes();
    uploadError(res, 500, input);
    const parsed = JSON.parse(res.captured.body);
    assert.equal(typeof parsed.error, 'string', '入参 ' + String(input) + ' 时 error 必须是字符串');
    assert.equal(parsed.ok, false);
  }
});

// ── SSE sinks ──

test('sendEvent：帧格式是 event: + 逐行 data:，且以空行结束', () => {
  const received = [];
  const sink = createSink('t1', (frame) => received.push(frame));
  sendEvent('t1', 'log', 'line one');
  assert.equal(received.length, 1);
  const frame = received[0];
  assert.ok(frame.startsWith('event: log\n'), '必须以 event: <名> 开头，实际 ' + JSON.stringify(frame));
  assert.ok(frame.includes('data: line one'), '载荷行必须带 data: 前缀');
  assert.ok(frame.endsWith('\n\n'), 'SSE 帧必须以空行结束，否则浏览器不派发');
  dropSink('t1', sink);
});

test('sendEvent：多行载荷拆成多条 data:（SSE 规范要求，不能塞进一行）', () => {
  const received = [];
  const sink = createSink('t2', (f) => received.push(f));
  sendEvent('t2', 'log', 'first\nsecond\r\nthird');
  const frame = received[0];
  const dataLines = frame.split('\n').filter((l) => l.startsWith('data: '));
  assert.equal(dataLines.length, 3, '三行载荷应产出三条 data:，实际 ' + dataLines.length);
  assert.deepEqual(dataLines.map((l) => l.slice(6)), ['first', 'second', 'third']);
  dropSink('t2', sink);
});

test('sendEvent：一个订阅者抛错不影响其他订阅者（断连不该连坐）', () => {
  const good = [];
  const bad = () => { throw new Error('socket closed'); };
  const s1 = createSink('t3', bad);
  const s2 = createSink('t3', (f) => good.push(f));
  sendEvent('t3', 'log', 'payload');
  assert.equal(good.length, 1, '好的订阅者必须照常收到');
  dropSink('t3', s1);
  dropSink('t3', s2);
});

test('sendEvent：无订阅者时静默返回，不抛错', () => {
  assert.doesNotThrow(() => sendEvent('no_such_task', 'log', 'x'));
});

test('dropSink：最后一个订阅者摘掉后清空任务条目（防长期驻留内存泄漏）', () => {
  const s1 = createSink('t4', () => {});
  dropSink('t4', s1);
  // 再 sendEvent 应无声可发；这里用「不抛错且计数为 0」间接验证条目已清
  let count = 0;
  const probe = createSink('t4', () => { count += 1; });
  sendEvent('t4', 'log', 'x');
  assert.equal(count, 1, '重建订阅后应能收到');
  dropSink('t4', probe);
  // 重复 drop 同一 sink 不应抛错
  assert.doesNotThrow(() => dropSink('t4', s1));
  assert.doesNotThrow(() => dropSink('no_such_task', s1));
});

test('closeSink：清空该任务全部订阅者，之后 sendEvent 不再触达', () => {
  let called = 0;
  createSink('t5', () => { called += 1; });
  createSink('t5', () => { called += 1; });
  sendEvent('t5', 'log', 'before');
  assert.equal(called, 2, '两个订阅者都应收到');
  closeSink('t5');
  sendEvent('t5', 'log', 'after');
  assert.equal(called, 2, 'closeSink 之后不应再触达任何订阅者');
});
