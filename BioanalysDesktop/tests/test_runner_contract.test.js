// 测试口径防呆：官方入口必须串行，避免有人用 node --test tests/*.test.js 并行跑出随机红。
//
// 背景（2026-11-04 实测）：用 node --test tests/*.test.js（默认并发=CPU 核数）连跑 4 次，
// 第 3、4 次各出现 1 条与 8 条红（health 接口 10s 超时 + index.test.js 整片 400 断言），
// 单独跑 tests/index.test.js 六次全绿，四个并发实例也全绿。官方 npm test 用 --test-concurrency=1，
// 同机连跑六次零红。所以红是并行调度下的端口/资源竞争，不是业务缺陷；但「换条命令就随机红」
// 本身就是会被误当成回归的陷阱，必须让它当场可见。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');

test('官方测试入口必须串行执行（--test-concurrency=1）', () => {
  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
  const script = String(pkg.scripts?.test || '');
  assert.match(script, /--test-concurrency=1/, `package.json 的 test 脚本必须带 --test-concurrency=1，当前: ${script}`);
  assert.ok(script.includes('tests/*.test.js'), `test 脚本必须显式列出 tests/*.test.js，当前: ${script}`);
});

test('ops 门禁里的全量测试同样必须串行', () => {
  const ops = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools', 'dev');
  const candidates = ['run_all_gates.mjs', 'metrics_sync.mjs'];
  const offenders = [];
  for (const name of candidates) {
    const file = path.join(ops, name);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    // 只认真实 argv 片段，不认注释：注释里写 --test-concurrency=1 但实际没传，
    // 正是这条断言第一版被绕过的形态（2026-11-04 变异反证实测 exit 0）。
    // 判据：凡出现 '--test' 作为独立 argv 元素的脚本，必须紧跟 '--test-concurrency=1'。
    const runsNodeTest = /['"]--test['"]/.test(text);
    const serialized = text.includes("'--test', '--test-concurrency=1'")
      || text.includes('"--test", "--test-concurrency=1"');
    if (runsNodeTest && !serialized) offenders.push(name);
  }
  assert.deepEqual(offenders, [], `这些门禁脚本跑 node --test 却没固定串行: ${offenders.join(', ')}`);
});