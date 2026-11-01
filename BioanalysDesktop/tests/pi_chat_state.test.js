import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  appendChatMessage,
  dedupeTerminalMessages,
  evaluateCancelResponse,
  extractReplyFromCalls,
  extractReplyFromTask,
  hasUsableTerminalResult,
  loadChatHistory,
  normalizeA2ATaskState,
  normalizeTaskId,
  buildTaskPollUrl,
  nextPollDelayMs,
  nextCancelPollAction,
  canRetryCancel,
  nextPollLoopAction,
  resolvePollSettleAction,
  saveChatHistory,
  settleTaskMessages,
} from '../src/pi_chat_state.js';
import { isTerminalA2ATaskState } from '../server/a2a_state.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
  };
}

test('loadChatHistory returns a safe empty list for corrupt or invalid data', () => {
  assert.deepEqual(loadChatHistory(memoryStorage(), 'k'), []);
  assert.deepEqual(loadChatHistory(memoryStorage({ k: 'not-json' }), 'k'), []);
  assert.deepEqual(loadChatHistory(memoryStorage({ k: JSON.stringify({ nope: 1 }) }), 'k'), []);
  assert.deepEqual(
    loadChatHistory(memoryStorage({ k: JSON.stringify([{ role: 'user' }, 'junk', null]) }), 'k'),
    [],
  );
});

test('loadChatHistory keeps valid entries and drops malformed ones', () => {
  const stored = JSON.stringify([
    { id: 'm1', role: 'user', text: 'hello', ts: 1 },
    { role: 'assistant', text: 'hi', ts: 2 },
    { role: 'nope', text: 'bad', ts: 3 },
    { id: 'm4', role: 'system', text: '', ts: 4 },
  ]);
  const messages = loadChatHistory(memoryStorage({ k: stored }), 'k');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].text, 'hello');
  assert.equal(messages[1].id, 'assistant-2');
});

test('saveChatHistory persists trimmed messages and can be restored', () => {
  const storage = memoryStorage();
  const messages = appendChatMessage([], { role: 'user', text: '  hi  ', ts: 10 });
  assert.ok(saveChatHistory(storage, messages, 'k'));
  const restored = loadChatHistory(storage, 'k');
  assert.equal(restored.length, 1);
  assert.equal(restored[0].text, 'hi');
});

test('appendChatMessage assigns ids and caps history length', () => {
  let messages = [];
  for (let i = 0; i < 210; i += 1) {
    messages = appendChatMessage(messages, { role: i % 2 ? 'assistant' : 'user', text: `m${i}`, ts: i });
  }
  assert.equal(messages.length, 200);
  assert.equal(messages.at(-1).text, 'm209');
});

test('extractReplyFromCalls finds the Pi reply by task id and never invents one', () => {
  const calls = [
    { task_id: 'other', last_text: 'wrong' },
    { task_id: 'task-1', last_text: '  Pi 回复  ' },
  ];
  assert.equal(extractReplyFromCalls(calls, 'task-1'), 'Pi 回复');
  assert.equal(extractReplyFromCalls([], 'task-1'), null);
  assert.equal(extractReplyFromCalls(calls, ''), null);
  assert.equal(extractReplyFromCalls([{ task_id: 'task-1', last_text: '' }], 'task-1'), null);
});

test('A2A terminal-state helpers stay aligned with the shared state machine', () => {
  assert.equal(normalizeA2ATaskState('TASK_STATE_COMPLETED'), 'completed');
  assert.equal(isTerminalA2ATaskState('TASK_STATE_FAILED'), true);
  assert.equal(isTerminalA2ATaskState('TASK_STATE_WORKING'), false);
});

test('normalizeTaskId aligns A2A ids with telemetry short ids', () => {
  assert.equal(normalizeTaskId('task-0fbd1b3bfb2e443d'), '0fbd1b3bfb2e443d');
  assert.equal(normalizeTaskId('0fbd1b3bfb2e443d'), '0fbd1b3bfb2e443d');
  assert.equal(normalizeTaskId('  task-abc  '), 'abc');
  assert.equal(normalizeTaskId(null), '');
  assert.equal(normalizeTaskId(''), '');
});

test('extractReplyFromTask reads A2A artifact parts and never invents text', () => {
  assert.equal(
    extractReplyFromTask({ artifacts: [{ parts: [{ text: 'PI_CHAT_LIVE_OK' }] }] }),
    'PI_CHAT_LIVE_OK',
  );
  assert.equal(
    extractReplyFromTask({ artifacts: [{ parts: [{ text: 'a' }, { text: 'b' }] }] }),
    'a\n\nb',
  );
  assert.equal(extractReplyFromTask({ artifacts: [{ parts: [{ text: '  ' }] }] }), null);
  assert.equal(extractReplyFromTask({ artifacts: [] }), null);
  assert.equal(extractReplyFromTask({}), null);
  assert.equal(extractReplyFromTask(null), null);
});

test('extractReplyFromCalls matches telemetry short ids against task- prefixed ids', () => {
  const calls = [{ task_id: '0fbd1b3bfb2e443d', last_text: 'PI_CHAT_LIVE_OK' }];
  assert.equal(extractReplyFromCalls(calls, 'task-0fbd1b3bfb2e443d'), 'PI_CHAT_LIVE_OK');
  assert.equal(
    extractReplyFromCalls([{ task_id: 'task-abc', last_text: 'hi' }], 'abc'),
    'hi',
  );
  assert.equal(extractReplyFromCalls(calls, 'task-other'), null);
});

test('settleTaskMessages advances pending messages and is idempotent', () => {
  const messages = [
    { id: 'u1', role: 'user', text: 'q', ts: 1, taskId: 'task-1', status: 'working' },
    { id: 'u2', role: 'user', text: 'q2', ts: 2, taskId: 'task-2', status: 'working' },
    { id: 'a1', role: 'assistant', text: 'done', ts: 3, taskId: 'task-1', status: 'completed' },
  ];
  const settled = settleTaskMessages(messages, 'task-1', 'completed');
  assert.equal(settled[0].status, 'completed');
  assert.equal(settled[1].status, 'working');
  assert.equal(settled[2].status, 'completed');
  assert.deepEqual(settleTaskMessages(settled, 'task-1', 'completed'), settled);
  assert.deepEqual(settleTaskMessages(messages, '', 'completed'), messages);
  assert.deepEqual(settleTaskMessages(messages, 'task-1', ''), messages);
});

test('dedupeTerminalMessages keeps one terminal result per task and drops id duplicates', () => {
  const messages = [
    { id: 'u1', role: 'user', text: 'q', ts: 1, taskId: 'task-1', status: 'completed' },
    { id: 'a1', role: 'assistant', text: 'reply', ts: 2, taskId: 'task-1', status: 'completed' },
    { id: 's1', role: 'system', text: 'dup', ts: 3, taskId: 'task-1', status: 'completed' },
    { id: 'a2', role: 'assistant', text: 'other task', ts: 4, taskId: 'task-2', status: 'completed' },
    { id: 'dup-id', role: 'system', text: 'x', ts: 5 },
    { id: 'dup-id', role: 'system', text: 'y', ts: 6 },
  ];
  const deduped = dedupeTerminalMessages(messages);
  assert.deepEqual(deduped.map((m) => m.id), ['u1', 'a1', 'a2', 'dup-id']);
});

test('evaluateCancelResponse accepts only 2xx payloads with ok true', () => {
  assert.deepEqual(evaluateCancelResponse(200, { ok: true }), { ok: true, error: '' });
  const rejected = evaluateCancelResponse(500, { ok: false, error: 'boom' });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, 'boom');
  assert.equal(evaluateCancelResponse(200, { ok: false }).ok, false);
  assert.ok(evaluateCancelResponse(502, null).error.includes('502'));
});

test('evaluateCancelResponse reports retryable failure without terminalizing the task', () => {
  const fetchFailure = evaluateCancelResponse(null, null);
  assert.equal(fetchFailure.ok, false);
  assert.equal(fetchFailure.error, '取消服务不可用。');

  const rejected = evaluateCancelResponse(502, null);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, '取消服务不可用（HTTP 502）。');

  const denied = evaluateCancelResponse(409, { ok: false, error: 'ERR_CANCEL_REJECTED' });
  assert.equal(denied.ok, false);
  assert.equal(denied.error, 'ERR_CANCEL_REJECTED');
  assert.equal(denied.terminal, false);
});

test('buildTaskPollUrl uses normalized task endpoint when dispatch omits poll_url', () => {
  assert.equal(buildTaskPollUrl('/api/pi-agent/task?id=abc', 'task-1'), '/api/pi-agent/task?id=abc');
  assert.equal(buildTaskPollUrl('', 'task-abc'), '/api/pi-agent/task?id=task-abc');
  assert.equal(buildTaskPollUrl(null, 'abc'), '/api/pi-agent/task?id=abc');
  assert.equal(buildTaskPollUrl('   ', ''), '');
});

test('poll backoff follows D-06 5s to 30s cap', () => {
  assert.deepEqual(
    Array.from({ length: 6 }, (_, index) => nextPollDelayMs(index)),
    [5000, 10000, 20000, 30000, 30000, 30000],
  );
  assert.equal(nextPollDelayMs(-1), 5000);
  assert.equal(nextPollDelayMs(0), 5000);
});

test('cancel window distinguishes ignored GetTask from resumable polling', () => {
  assert.equal(nextCancelPollAction('pending'), 'ignore');
  assert.equal(nextCancelPollAction('confirmed'), 'stop');
  assert.equal(nextCancelPollAction('failed'), 'resume');
});

test('cancel retry and poll loop actions prevent infinite restart', () => {
  assert.equal(canRetryCancel(null), true);
  assert.equal(canRetryCancel('failed'), true);
  assert.equal(canRetryCancel('pending'), false);
  assert.equal(canRetryCancel('confirmed'), false);

  assert.equal(nextPollLoopAction({ elapsedMs: 0, cancelState: null }), 'continue');
  assert.equal(nextPollLoopAction({ elapsedMs: 86_399_999, cancelState: 'failed' }), 'resume');
  assert.equal(nextPollLoopAction({ elapsedMs: 86_400_000, cancelState: 'failed' }), 'timeout');
  assert.equal(nextPollLoopAction({ elapsedMs: 0, cancelState: 'confirmed' }), 'confirmed');
  assert.equal(nextPollLoopAction({ elapsedMs: 0, cancelState: null, canceled: true }), 'canceled');

  const actions = [];
  for (let elapsedMs = 86_399_000; elapsedMs <= 86_400_000; elapsedMs += 1_000) {
    actions.push(nextPollLoopAction({ elapsedMs, cancelState: 'failed' }));
  }
  assert.equal(actions.filter((action) => action === 'resume').length, 1);
  assert.equal(actions.at(-1), 'timeout');
});

test('poll settle gate discards completed GetTask after confirmed cancel', () => {
  // 旧轮询 generation=1 在途，CancelTask 确认后把代际推进到 2，
  // 旧 GetTask 随后返回 completed，门必须直接退出，canceled 终态保持权威。
  assert.equal(
    resolvePollSettleAction({ generation: 1, activeGeneration: 2, cancelState: 'confirmed' }),
    'exit',
  );

  // 同代际但取消已确认：同样退出，禁止把 canceled 覆盖成 completed。
  assert.equal(
    resolvePollSettleAction({ generation: 2, activeGeneration: 2, cancelState: 'confirmed' }),
    'exit',
  );

  // 新任务已把取消状态重置为 null，旧代际回包仍必须退出。
  assert.equal(
    resolvePollSettleAction({ generation: 1, activeGeneration: 2, cancelState: null }),
    'exit',
  );

  // 取消在途只观察；取消失败或无取消时按 GetTask 正常结算。
  assert.equal(
    resolvePollSettleAction({ generation: 2, activeGeneration: 2, cancelState: 'pending' }),
    'ignore',
  );
  assert.equal(
    resolvePollSettleAction({ generation: 2, activeGeneration: 2, cancelState: 'failed' }),
    'settle',
  );
  assert.equal(
    resolvePollSettleAction({ generation: 2, activeGeneration: 2, cancelState: null }),
    'settle',
  );
});

test('hasUsableTerminalResult detects settled tasks for restore guard', () => {
  const messages = [
    { id: 'u1', role: 'user', text: 'q', ts: 1, taskId: 'task-1', status: 'working' },
    { id: 'a1', role: 'assistant', text: 'done', ts: 2, taskId: 'task-1', status: 'completed' },
  ];
  assert.equal(hasUsableTerminalResult(messages, 'task-1'), true);
  assert.equal(hasUsableTerminalResult(messages, 'task-2'), false);
  assert.equal(hasUsableTerminalResult([], 'task-1'), false);
  assert.equal(hasUsableTerminalResult([{ id: 's', role: 'system', text: 'e', ts: 3, taskId: 'task-3', status: 'failed' }], 'task-3'), true);
});
