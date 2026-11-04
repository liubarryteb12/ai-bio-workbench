/**
 * 跳过原因白名单门禁的契约测试（Argon 第二十一轮 Q4，2026-11-03）。
 *
 * 两道面都要有正反两问：
 *   静态面：真仓 tests 全绿；构造的裸跳过/无标签/常量展开违规各自判红；
 *          注释与字符串里的 skip 字样不得误伤（测试自身就是夹具文本大户）。
 *   运行时面：解析真实 TAP 的 # SKIP，空原因与白名单外都必须红，not ok 也必须红。
 * 变异反证由 ops 侧脚本另跑；这里钉住的是「判据本体」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALLOWED_SKIP_REASONS, scanTestSource, scanTestSources, checkTapSkips,
  parseTapSkipReasons, skipReasonIsAllowed, main,
} from '../../ops/skip_reason_gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const TESTS_DIR = path.join(REPO, 'BioanalysDesktop', 'tests');

test('白名单枚举钉死：Argon 点名的四类 + 便携包/干净机器实测补的四类环境类', () => {
  assert.deepEqual([...ALLOWED_SKIP_REASONS], [
    'HOST_MISSING_BASH',
    'HOST_MISSING_PYTHON',
    'HOST_MISSING_ANNDATA',
    'HOST_MISSING_RSCRIPT',
    'HOST_UNREACHABLE_K40',
    'HOST_MISSING_LOCAL_DATA',
    'HOST_MISSING_SHELL',
    'HOST_MISSING_GIT',
  ]);  assert.equal(Object.isFrozen(ALLOWED_SKIP_REASONS), true, '枚举必须冻结，运行期不得改写');
});

test('原因格式：标签 + 冒号 + 非空说明才算合法', () => {
  assert.equal(skipReasonIsAllowed('HOST_MISSING_BASH: 宿主无 bash 解释器'), true);
  assert.equal(skipReasonIsAllowed('HOST_MISSING_PYTHON:host python'), true);
  assert.equal(skipReasonIsAllowed('HOST_MISSING_BASH:'), false, '冒号后空说明不算理由');
  assert.equal(skipReasonIsAllowed('HOST_MISSING_BASH'), false, '缺冒号与说明');
  assert.equal(skipReasonIsAllowed('宿主无 bash 解释器'), false, '无标签');
  assert.equal(skipReasonIsAllowed('SOME_OTHER_TAG: x'), false, '枚举外标签');
  assert.equal(skipReasonIsAllowed(''), false);
});

test('静态面：真仓全部测试文件零违规（门禁在本机常态绿）', () => {
  const files = fs.readdirSync(TESTS_DIR)
    .filter((name) => name.endsWith('.test.js'))
    .map((name) => ({ path: name, text: fs.readFileSync(path.join(TESTS_DIR, name), 'utf8') }));
  assert.ok(files.length > 100, '测试文件数异常，扫描面失真：' + files.length);
  assert.deepEqual(scanTestSources(files), [], '真仓出现白名单外的跳过原因');
});

test('静态面红路径：裸 true / 空串 / 无标签 / 常量展开 全部判红并点名行号', () => {
  const text = [
    "test('bare', { skip: true }, () => {});",
    "test('empty', { skip: '' }, () => {});",
    "test('untagged', { skip: '宿主无 bash 解释器' }, () => {});",
    "const WHY = 'NO_TAG_REASON';",
    "test('const-expand', { skip: WHY }, () => {});",
  ].join('\n');
  const violations = scanTestSource(text, 'probe.test.js');
  assert.equal(violations.length, 4, JSON.stringify(violations));
  assert.deepEqual(violations.map((v) => v.kind).sort(),
    ['bare-skip', 'missing-reason', 'untagged-reason', 'untagged-reason']);
  assert.deepEqual(violations.map((v) => v.line).sort((a, b) => a - b), [1, 2, 3, 5]);
  assert.ok(violations.every((v) => v.file === 'probe.test.js'));
});

test('静态面白路径：三元与短路形态带标签即放行，显式 false 放行', () => {
  const text = [
    "const BASH = null;",
    "test('ternary', { skip: BASH === null ? 'HOST_MISSING_BASH: 宿主无 bash' : false }, () => {});",
    "test('and', { skip: !ok && 'HOST_MISSING_LOCAL_DATA: 本地数据已清理' }, () => {});",
    "test('false', { skip: false }, () => {});",
  ].join('\n');
  assert.deepEqual(scanTestSource(text, 'ok.test.js'), []);
});

test('静态面不误伤：注释、普通字符串与夹具模板串里的 skip 字样不算关键字', () => {
  const text = [
    '// 示例：{ skip: true } 这种写法会被门禁判红',
    "/* 这里也写一个 skip: true 做说明 */",
    "const FIXTURE = \"test('x', { skip: true })\";",
    "const NOTE = 'skip: true 是禁止形态';",
    "test('real', { skip: 'HOST_MISSING_BASH: 宿主无 bash 解释器' }, () => {});",
  ].join('\n');
  assert.deepEqual(scanTestSource(text, 'notes.test.js'), []);
});

test('静态面：t.skip() 调用形态同样受管，裸调用与无标签都红', () => {
  const text = [
    "test('bareCall', (t) => { t.skip(); });",
    "test('untaggedCall', (t) => { t.skip('远端不可达'); });",
    "test('taggedCall', (t) => { t.skip('HOST_UNREACHABLE_K40: 远端不可达'); });",
  ].join('\n');
  const violations = scanTestSource(text, 'calls.test.js');
  assert.equal(violations.length, 2, JSON.stringify(violations));
});

// 用例名不得含字面量 TAP 指令记号：TAP 规定名字里的 # must be escaped，
// 含未转义的 "# SKIP" 会让任何 TAP 消费者把它读成真指令（本门禁首版就是这样自伤）。
test('TAP 面：解析跳过指令行，空原因与白名单外都判红，not ok 也判红', () => {
  const good = [
    'ok 1 - a # SKIP HOST_MISSING_BASH: 宿主无 bash 解释器',
    'ok 2 - b # SKIP HOST_UNREACHABLE_K40: 远端不可达',
    'ok 3 - c',
  ].join('\n');
  const goodResult = checkTapSkips(good);
  assert.equal(goodResult.ok, true);
  assert.equal(goodResult.total, 2);
  assert.deepEqual(goodResult.violations, []);

  const bad = [
    'ok 1 - bare # SKIP',
    'ok 2 - untagged # SKIP 远端不可达',
    'not ok 3 - failing',
  ].join('\n');
  const badResult = checkTapSkips(bad);
  assert.equal(badResult.ok, false);
  assert.equal(badResult.failures, 1);
  assert.deepEqual(badResult.violations.map((v) => v.kind), ['missing-reason', 'untagged-reason']);
  assert.deepEqual(parseTapSkipReasons('ok 1 - x # SKIP TAG: y').map((e) => e.line), [1]);
});

test('CLI main：真仓静态扫描 exit 0，违规目录 exit 1', () => {
  const logs = [];
  const io = { log: (m) => logs.push('L ' + m), error: (m) => logs.push('E ' + m) };
  const ok = main([], io);
  assert.equal(ok, 0, logs.join('\n'));
  const dir = path.join(REPO, '.tmp', 'skip-gate-probe-' + process.pid + '-' + Math.random().toString(36).slice(2, 8));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'bad.test.js'), "test('x', { skip: true }, () => {});\n", 'utf8');
  const bad = main(['--tests-dir', dir], io);
  assert.equal(bad, 1, '违规目录必须 exit 1');
  fs.rmSync(dir, { recursive: true, force: true });
});
