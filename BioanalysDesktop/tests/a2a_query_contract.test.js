import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeA2ATaskState, isTerminalA2ATaskState, normalizeA2ATask,
} from '../server/a2a_state.js';
import { resolveProjectParam } from '../server/query_views.js';

// 这两个模块都很小，但各自钉着一个容易静默出错的口径。
// a2a_state：远端 A2A 用 TASK_STATE_COMPLETED 这类大写枚举，控制面用 completed 这类短名。
//   归一化写错不会报错，只会让「任务是否终结」的判断恒为 false，任务永远停在 running。
// query_views：resolveProjectParam 是 URL 到项目 ID 的唯一入口，返回 null 代表调用方要回 400。
//   这里若把非法值放过去，穿越字符会直达成远端 shell 字符串。

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(here, '..', 'server');
const readServer = (name) => fs.readFileSync(path.join(serverDir, name), 'utf8');

test('A2A 状态归一化：去 TASK_STATE_ 前缀、去空白、转小写', () => {
  assert.equal(normalizeA2ATaskState('TASK_STATE_COMPLETED'), 'completed');
  assert.equal(normalizeA2ATaskState('task_state_working'), 'working');
  assert.equal(normalizeA2ATaskState('  TASK_STATE_FAILED  '), 'failed');
  assert.equal(normalizeA2ATaskState('completed'), 'completed');
});

test('A2A 状态归一化：空值与非常规输入不抛错', () => {
  assert.equal(normalizeA2ATaskState(null), '');
  assert.equal(normalizeA2ATaskState(undefined), '');
  assert.equal(normalizeA2ATaskState(''), '');
  // 数字走 String() 而不是崩掉：远端偶尔回数字码，这里宁可保留信息。
  assert.equal(normalizeA2ATaskState(123), '123');
});

test('终结态集合恰为 completed/failed/canceled/rejected', () => {
  for (const s of ['completed', 'failed', 'canceled', 'rejected']) {
    assert.equal(isTerminalA2ATaskState(s), true, s + ' 必须是终结态');
  }
  // working 与 submitted 是最容易被误判成终结的两个：误判会让任务在真正跑完之前就被收割。
  for (const s of ['working', 'submitted', 'input-required', '', 'unknown', 'COMPLETED_extra']) {
    assert.equal(isTerminalA2ATaskState(s), false, s + ' 不能是终结态');
  }
});

test('终结态判断接受远端大写枚举形式', () => {
  assert.equal(isTerminalA2ATaskState('TASK_STATE_CANCELED'), true);
  assert.equal(isTerminalA2ATaskState('TASK_STATE_WORKING'), false);
});

test('normalizeA2ATask 对非对象输入原样返回（保持同一引用）', () => {
  assert.equal(normalizeA2ATask(null), null);
  assert.equal(normalizeA2ATask(undefined), undefined);
  assert.equal(normalizeA2ATask(5), 5);
  const s = 'TASK_STATE_COMPLETED';
  assert.equal(normalizeA2ATask(s), s);
  const arr = [];
  assert.equal(normalizeA2ATask(arr), arr);
});

test('normalizeA2ATask 在没有合法 status 时原样返回', () => {
  const noStatus = { id: 'x' };
  assert.equal(normalizeA2ATask(noStatus), noStatus);
  const badStatus = { id: 'x', status: 5 };
  assert.equal(normalizeA2ATask(badStatus), badStatus);
  const arrStatus = { id: 'x', status: [] };
  assert.equal(normalizeA2ATask(arrStatus), arrStatus);
});

test('normalizeA2ATask 归一化 state 并把远端原值留在 remote_state', () => {
  const out = normalizeA2ATask({ id: 'x', status: { state: 'TASK_STATE_COMPLETED', message: 'ok' } });
  assert.equal(out.status.state, 'completed');
  // 审计要求：远端原样值必须留档，不能因为归一化就丢掉。
  assert.equal(out.status.remote_state, 'TASK_STATE_COMPLETED');
  // 同一层的其他字段一个都不能丢。
  assert.equal(out.status.message, 'ok');
  assert.equal(out.id, 'x');
});

test('已有的 remote_state 优先于归一化后的 state', () => {
  const out = normalizeA2ATask({ status: { state: 'working', remote_state: 'TASK_STATE_WORKING' } });
  assert.equal(out.status.state, 'working');
  assert.equal(out.status.remote_state, 'TASK_STATE_WORKING');
});

test('原本就是短名的状态，remote_state 等于该短名', () => {
  const out = normalizeA2ATask({ status: { state: 'completed' } });
  assert.equal(out.status.state, 'completed');
  assert.equal(out.status.remote_state, 'completed');
});

test('normalizeA2ATask 不改动入参对象（无副作用）', () => {
  const input = { status: { state: 'TASK_STATE_COMPLETED' } };
  normalizeA2ATask(input);
  assert.equal(input.status.state, 'TASK_STATE_COMPLETED');
  assert.equal('remote_state' in input.status, false);
});

test('resolveProjectParam：缺省与空串都落到默认项目', () => {
  assert.equal(resolveProjectParam(new URL('http://x/api')), 'default');
  assert.equal(resolveProjectParam(new URL('http://x/api?project=')), 'default');
});

test('resolveProjectParam：合法 ID 去空白后原样返回', () => {
  assert.equal(resolveProjectParam(new URL('http://x/api?project=abc')), 'abc');
  assert.equal(resolveProjectParam(new URL('http://x/api?project=%20AIMS%20')), 'AIMS');
  assert.equal(resolveProjectParam(new URL('http://x/api?project=PRJ_AIMS_V3_20261027')), 'PRJ_AIMS_V3_20261027');
});

test('resolveProjectParam：穿越与非法字符返回 null（调用方回 400）', () => {
  assert.equal(resolveProjectParam(new URL('http://x/api?project=..%2Fetc')), null);
  assert.equal(resolveProjectParam(new URL('http://x/api?project=a%2Fb')), null);
  assert.equal(resolveProjectParam(new URL('http://x/api?project=a%5Cb')), null);
  assert.equal(resolveProjectParam(new URL('http://x/api?project=.hidden')), null);
  assert.equal(resolveProjectParam(new URL('http://x/api?project=..')), null);
  assert.equal(resolveProjectParam(new URL('http://x/api?project=' + 'x'.repeat(70))), null);
});

test('listFiguresForLine 先过路径守卫再碰远端', () => {
  const src = readServer('query_views.js');
  // 必须切到该函数体内比较：listProjectsWithMeta 在上面也调用 runRemote，
  // 全文取 indexOf 会拿到更早的那一处，得到假的顺序结论。
  const fnAt = src.indexOf('export function listFiguresForLine');
  assert.ok(fnAt > 0, '找不到 listFiguresForLine');
  const body = src.slice(fnAt);
  const guardAt = body.indexOf('assertFiguresPath(');
  const remoteAt = body.indexOf('runRemote(');
  assert.ok(guardAt >= 0, '必须调用 assertFiguresPath 做路径守卫');
  assert.ok(guardAt < remoteAt, '路径守卫必须在任何远端调用之前');
  // 守卫失败要直接返回 blocked:true，不能继续往下走。
  assert.match(body, /if\s*\(\s*!guard\.ok\s*\)\s*\{[\s\S]*?blocked:\s*true/);
});

test('listFiguresForLine 本地副本优先于远端实时读取', () => {
  const src = readServer('query_views.js');
  const fnAt = src.indexOf('export function listFiguresForLine');
  const body = src.slice(fnAt);
  const localAt = src.indexOf('readLocalFigures(');
  const probeAt = src.indexOf("echo EXISTS");
  assert.ok(localAt >= 0, '必须优先读本地回搬副本');
  assert.ok(probeAt > localAt, '本地没有才回落远端，顺序不能反');
  // source 字段必须区分来源，否则「本地还没回搬」会被读成「这条线没出图」。
  // 顺序比较对 `if (false && local)` 这类行为变异无效，必须钉住结构本身：
  // if (local) 分支内联产出 source:'local'，反转即断链。
  assert.match(body, /if\s*\(\s*local\s*\)\s*\{[\s\S]{0,400}?source:\s*'local'/);
  assert.match(body, /source:\s*'remote'/);
});

test('listFiguresForLine 的远端列目录必须限深', () => {
  const src = readServer('query_views.js');
  // P-23：递归遍历在容器里会 abort。列图只允许一层。
  assert.match(src, /-maxdepth 1/);
  assert.doesNotMatch(src, /find\s+[^\n]*-maxdepth\s+[2-9]/);
});

test('listProjectsWithMeta 缺 project.json 时仍列出项目且 meta 为 null', () => {
  const src = readServer('query_views.js');
  // 目录在但元数据缺失时不能假装项目不存在，否则前端会漏掉一个真实项目。
  assert.match(src, /let\s+meta\s*=\s*null/);
  assert.match(src, /return\s*\{\s*projectId:\s*id,\s*meta\s*\}/);
});
