/**
 * 回归守卫：runner 不得用高频/并发 ssh 把 proot 的 15 秒 abort 环喂着（P-29）。
 *
 * 背景（ledger/pitfalls_ledger.md P-29，2026-10-23 实测）：
 * proot 每 15 秒 abort 的充分条件是 ssh 连接流，不是 /tmp 堆积（P-28 已推翻），
 * 也不是计算负载。停轮询后静默 3 分钟 abort 零增长，而 12 个并发 Accepted 之后
 * 71 秒内 abort 立刻恢复。
 *
 * 因此 chain_runner.mjs 必须守住三条：
 *   1. 轮询间隔下限 60s（10s 等于每分钟 6 次连接，重步骤必被拖死）；
 *   2. ssh 默认重试最多 2 次；
 *   3. 判活三信号合成单次往返（probeLiveness），不拆成三次 ssh。
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const LIB = path.join(REPO, 'cn_debug', 'lib', 'chain_runner.mjs');

function readLib() {
  assert.ok(fs.existsSync(LIB), `找不到 ${LIB}`);
  return fs.readFileSync(LIB, 'utf8');
}

test('P-29 轮询间隔下限为 60s', () => {
  const text = readLib();
  assert.match(text, /Math\.max\(60000, configuredPollMs\)/,
    'POLL_INTERVAL_MS 必须把环境变量钳制到至少 60000（60s）。');
  // waitNewLedger 必须用这个常量，不能再写死 sleepMs(10000)
  assert.match(text, /sleepMs\(POLL_INTERVAL_MS\)/, 'waitNewLedger 必须 sleepMs(POLL_INTERVAL_MS)');
  assert.doesNotMatch(text, /sleepMs\(10000\)/, '不得再出现写死的 10 秒轮询');
});

test('P-29 环境变量把轮询降到 60s 以下时会被钳制', () => {
  const moduleUrl = pathToFileURL(LIB).href;
  const child = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `const lib = await import(${JSON.stringify(moduleUrl)}); console.log(lib.POLL_INTERVAL_MS);`,
  ], {
    encoding: 'utf8',
    env: { ...process.env, POLL_INTERVAL_MS: '1000' },
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), '60000');
});

test('P-29 ssh 默认重试最多 2 次', () => {
  const text = readLib();
  assert.match(text, /Math\.min\(requestedRetries, 2\)/,
    'ssh() 默认重试最多 2。3 次重试在 abort 循环里等于多打一整轮连接。');
});

test('P-29 判活三信号走单次往返 probeLiveness', () => {
  const text = readLib();
  assert.match(text, /export function probeLiveness\(/, '必须导出 probeLiveness');
  // 三信号必须在同一次 ssh 里取回
  const fn = text.slice(text.indexOf('export function probeLiveness('));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3);
  const sshCalls = (body.match(/\bssh\(/g) || []).length;
  assert.equal(sshCalls, 1, `probeLiveness 内部只允许 1 次 ssh，实际 ${sshCalls} 次`);
  for (const signal of ['__LEDGERS__', '__MARKERS__', '__LOGSIZE__']) {
    assert.ok(body.includes(signal), `probeLiveness 缺少信号 ${signal}`);
  }
});

test('P-29 waitNewLedger 不再拆成多次 ssh 轮询', () => {
  const text = readLib();
  const fn = text.slice(text.indexOf('export function waitNewLedger('));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3);
  // 台账列表、日志字节、标记列表都不许再各自起 ssh
  assert.doesNotMatch(body, /listLedgers\(step\)/, 'waitNewLedger 不得再单独调 listLedgers（多一次往返）');
  assert.doesNotMatch(body, /stat -c %s/, 'waitNewLedger 不得再单独 ssh 取日志字节');
  assert.doesNotMatch(body, /lsRemote\(watch\.markerDir/, 'waitNewLedger 不得再单独 ssh 列标记');
  assert.match(body, /probeLiveness\(/, 'waitNewLedger 必须改用 probeLiveness');
});

test('P0 残留标记按 wrapper_pid 自动清扫', () => {
  const text = readLib();
  assert.match(text, /export function sweepStaleMarkers\(/, '必须导出 sweepStaleMarkers');
  const fn = text.slice(text.indexOf('export function sweepStaleMarkers('));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3);
  // 判活必须依据 wrapper 落盘的 pid，且只删 pid 已死的
  assert.match(body, /wrapper_pid/, '必须读 wrapper 落盘的 wrapper_pid');
  assert.match(body, /\/proc\/\$pid/, '必须查 /proc/<pid> 判定存活');
  assert.match(body, /STALE/, '必须能报出 STALE 标记');
  assert.match(body, /ALIVE/, '必须能报出 ALIVE 标记（活着的不删）');
  assert.match(body, /rm -f /, '必须删除死标记');
  // runStepDetached 必须先扫再 preflight，否则旧标记搅乱判活
  const run = text.slice(text.indexOf('export function runStepDetached('));
  assert.match(run, /sweepStaleMarkers\(\)/, 'runStepDetached 必须先扫残留标记');
});

test('P-29 纪律已写进文档', () => {
  const doc = path.join(REPO, 'docs', 'termux_keepalive.md');
  assert.ok(fs.existsSync(doc), 'docs/termux_keepalive.md 应存在');
  const text = fs.readFileSync(doc, 'utf8');
  assert.match(text, /禁止并发 ssh/, '文档必须写明禁止并发 ssh 到 k40-ubuntu');
  assert.match(text, /轮询间隔不小于 60 秒/, '文档必须写明轮询间隔下限');
});
