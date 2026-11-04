/**
 * 宿主机依赖预检契约测试（Ticket 3，4 Argon 第二十一轮 Q5）。
 *
 * 判据两条：
 *   - 真机态：必需项（node >= 22 / ssh / scp）齐备即 exit 0，可选缺失只 warn；
 *   - 红路径：注入假 PATH 让必需项查不到，必须 exit 1 且点名缺哪一项。
 * 不做真实网络/设备调用：预检只查 PATH 与版本，天然可离线断言。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { CHECKS, MIN_NODE_MAJOR, findExecutable, nodeVersionOk, runPreflight, main }
  from '../../ops/preflight.mjs';

const BIOANALYS_DIR = path.resolve(import.meta.dirname, '..');
const REPO = path.resolve(BIOANALYS_DIR, '..');

test('清单形状：必需/可选分层，且每条都带安装指引', () => {
  assert.ok(CHECKS.length >= 5, '预检项过少：' + CHECKS.length);
  for (const spec of CHECKS) {
    assert.equal(typeof spec.id, 'string');
    assert.equal(typeof spec.label, 'string');
    assert.equal(typeof spec.required, 'boolean');
    assert.ok(spec.install && spec.install.length > 10, spec.id + ' 缺安装指引');
  }
  const required = CHECKS.filter((c) => c.required).map((c) => c.id);
  assert.deepEqual(required.sort(), ['node', 'scp', 'ssh'], '必需项集合必须锁死');
});

test('node 版本判据：22 及以上通过，以下判红', () => {
  assert.equal(MIN_NODE_MAJOR, 22);
  assert.equal(nodeVersionOk('24.19.0').ok, true);
  assert.equal(nodeVersionOk('22.0.0').ok, true);
  assert.equal(nodeVersionOk('21.9.9').ok, false, '21 必须判红');
  assert.equal(nodeVersionOk('18.20.0').ok, false);
});

test('findExecutable：按 PATH 段找，支持 PATHEXT，找不到返回 null', () => {
  const dir = path.join(REPO, '.tmp', 'preflight-probe-' + process.pid + '-' + Math.random().toString(36).slice(2, 8));
  fs.mkdirSync(dir, { recursive: true });
  try {
    const exe = path.join(dir, 'fake-tool.EXE');
    fs.writeFileSync(exe, '', 'utf8');
    assert.equal(findExecutable('fake-tool', { pathValue: dir, pathext: '.EXE' }), exe);
    assert.equal(findExecutable('nope-tool', { pathValue: dir, pathext: '.EXE' }), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('真机态：runPreflight 的必需项全绿，ok 与 missingRequired 一致', () => {
  const report = runPreflight();
  assert.equal(report.ok, true, '本机必需项缺失：' + report.missingRequired.join(', '));
  assert.deepEqual(report.missingRequired, []);
  for (const check of report.checks) {
    if (check.required) assert.equal(check.found, true, check.id + ' 必需项未找到');
  }
  // 可选缺失只进 warnings，不进 missingRequired
  for (const id of report.warnings) {
    assert.equal(report.missingRequired.includes(id), false, id + ' 是可选项，不该算必需缺失');
  }
});

test('红路径：注入空 PATH 时必需项全缺，ok=false 且点名', () => {
  const report = runPreflight({ pathValue: '', pathext: '.EXE' });
  assert.equal(report.ok, false);
  assert.deepEqual(report.missingRequired.sort(), ['scp', 'ssh']);
  // node 由版本判据决定，不依赖 PATH：版本达标时仍为 found
  const nodeCheck = report.checks.find((c) => c.id === 'node');
  assert.equal(nodeCheck.found, true, '版本达标时 node 不受空 PATH 影响');
});

test('红路径：node 版本过低时即使 PATH 齐备也判红并点名 node', () => {
  const report = runPreflight({ pathValue: process.env.PATH, versionText: '18.0.0' });
  assert.equal(report.ok, false);
  assert.deepEqual(report.missingRequired, ['node']);
});

test('CLI 双出口：人读带 PREFLIGHT 哨兵，--json 给机器读且可解析', () => {
  const human = [];
  const code = main([], { log: (m) => human.push(m), error: (m) => human.push(m) });
  assert.equal(code, 0);
  const text = human.join('\n');
  assert.match(text, /PREFLIGHT_OK/);
  assert.match(text, /Node\.js >= /);
  const machine = [];
  const codeJson = main(['--json'], { log: (m) => machine.push(m), error: (m) => machine.push(m) });
  assert.equal(codeJson, 0);
  const parsed = JSON.parse(machine.join('\n'));
  assert.equal(parsed.ok, true);
  assert.ok(Array.isArray(parsed.checks));
  assert.ok(parsed.checks.every((c) => c.id && typeof c.found === 'boolean'));
});

test('静态契约：预检不 spawn 子进程（只查 PATH 与版本，天然离线）', () => {
  const src = fs.readFileSync(path.join(REPO, 'ops', 'preflight.mjs'), 'utf8');
  const code = src.split('\n').filter((line) => {
    const trimmed = line.trim();
    return !trimmed.startsWith('*') && !trimmed.startsWith('//');
  }).join('\n');
  assert.equal(/spawnSync|execFile|child_process/.test(code), false, '预检不应起子进程');
});
