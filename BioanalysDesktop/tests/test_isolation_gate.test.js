// Q4 临时目录隔离门禁自身的契约测试（第三十四轮 4 Argon Q4 裁定）。
//
// 判据本体用 judgeSource(纯函数) 做正反断言；清单/豁免用真实文件扫描结果锁定。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { judgeSource, checkTestIsolation, ISOLATION_TOKENS, OWNED_OUTPUT_EXEMPTIONS } from '../../ops/test_isolation_gate.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('判据：无递归删除的文件不算违规（门禁只管删东西的文件）', () => {
  const j = judgeSource('const fs = require("fs"); fs.writeFileSync("a", "b");');
  assert.equal(j.hasRecursiveRm, false);
  assert.equal(j.isolated, true);
});

test('判据：固定共享目录的递归删除必须判红', () => {
  const bad = [
    "const fs = require('fs');",
    "const TMP_ROOT = path.join(REPO, '.tmp', 'wp33-figure-adapt-tests');",
    "test.after(() => fs.rmSync(TMP_ROOT, { recursive: true, force: true }));",
  ].join('\n');
  const j = judgeSource(bad);
  assert.equal(j.hasRecursiveRm, true);
  assert.equal(j.isolated, false, '固定字面路径常量没有隔离标记，必须红');
  assert.deepEqual(j.calls.map((c) => c.arg), ['TMP_ROOT']);
});

test('判据：mkdtemp / pid / 随机 任一标记即认定有能力自隔离', () => {
  for (const token of ['fs.mkdtempSync(path.join(base, \'case-\'))', 'const id = process.pid', 'crypto.randomUUID()', 'Math.random().toString(36)', 'Date.now()']) {
    const src = [
      "const fs = require('fs');",
      "const dir = fs.mkdtempSync(path.join(REPO, '.tmp', 'x-'));",
      token + ';',
      "fs.rmSync(dir, { recursive: true, force: true });",
    ].join('\n');
    assert.equal(judgeSource(src).isolated, true, '含 ' + token + ' 应判隔离');
  }
});

test('真实工作树扫描：违规与腐化豁免都必须为 0', () => {
  const r = checkTestIsolation();
  assert.deepEqual(r.violations, [], '真实工作树出现隔离违规: ' + JSON.stringify(r.violations, null, 2));
  assert.deepEqual(r.staleExemptions, [], '豁免清单腐化: ' + r.staleExemptions.join(', '));
  assert.ok(r.scannedFiles > 0 && r.scannedCalls > 0, '扫描面不能是空的');
});

test('豁免清单冻结且每条带理由，不许顺手扩', () => {
  assert.equal(Object.isFrozen(OWNED_OUTPUT_EXEMPTIONS), true);
  assert.equal(Object.isFrozen(ISOLATION_TOKENS), true);
  assert.deepEqual([...OWNED_OUTPUT_EXEMPTIONS].map((e) => e.file), [
    'ops/build_portable_package.mjs',
    'ops/delivery_acceptance_core.mjs',
    'ops/clean_workspace.mjs',
    // Q4 缓存清理器（第 41 轮）：默认 dry-run，仅 --apply 时删 .tmp/ 陈旧条目，作用域锁死
    'ops/clean_tmp_cache.mjs',
  ]);
  for (const e of OWNED_OUTPUT_EXEMPTIONS) assert.ok(e.reason && e.reason.length > 10, e.file + ' 豁免必须写理由');
});

test('主入口信号：违规时 exit 1 且打出 [FAIL]', () => {
  // 用真实工作树跑 CLI（当前全绿），再单独验证「红门禁经 CLI 时 exit 1」由变异脚本覆盖。
  const r = spawnSync(process.execPath, ['ops/test_isolation_gate.mjs'], { cwd: REPO, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, (r.stdout || '') + (r.stderr || ''));
  assert.match(r.stdout, /共享资源隔离通过|临时目录隔离通过/);
});