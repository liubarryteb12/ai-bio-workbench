/**
 * 台账验收字段门禁契约测试（2026-11-16）。
 *
 * 正反两问：
 *   正：真仓 changes/fixes 台账过门禁；
 *   反：截止日后的条目缺 acceptance、id 重复、JSON 坏行、非对象行都必须红。
 * 判据本体在 tools/dev/ledger_acceptance_gate.mjs，这里钉住语义与豁免边界。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_CUTOFF, LEDGER_FILES, acceptanceIsPresent, parseJsonl, entryDate,
  validateEntries, checkLedgerFile, main,
} from '../../tools/dev/ledger_acceptance_gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

test('验收判据：非空字符串或含非空字符串的数组才算有 acceptance', () => {
  assert.equal(acceptanceIsPresent('node tools/dev/run_all_gates.mjs'), true);
  assert.equal(acceptanceIsPresent(['pytest tests/unit']), true);
  assert.equal(acceptanceIsPresent(''), false);
  assert.equal(acceptanceIsPresent('   '), false);
  assert.equal(acceptanceIsPresent([]), false);
  assert.equal(acceptanceIsPresent(['', '  ']), false);
  assert.equal(acceptanceIsPresent(null), false);
  assert.equal(acceptanceIsPresent(42), false);
});

test('JSONL 解析：空行跳过，坏行与非对象行按 1 基行号点名', () => {
  const text = '{"id":"A","ts":"2026-11-16T00:00:00+08:00"}\n\nnot-json\n[1,2]\n';
  const { entries, violations } = parseJsonl(text, 'probe.jsonl');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].line, 1);
  assert.deepEqual(violations.map((v) => v.kind), ['invalid-json', 'not-object']);
  assert.deepEqual(violations.map((v) => v.line), [3, 4]);
});

test('日期段：ts 前 10 位必须是合法日期，缺失或格式错判无效', () => {
  assert.equal(entryDate({ ts: '2026-11-16T08:00:00+08:00' }), '2026-11-16');
  assert.equal(entryDate({ ts: '2026/11/16' }), null);
  assert.equal(entryDate({}), null);
});

test('豁免边界：截止日之前的条目免查 acceptance，截止日当天及之后必须带', () => {
  const entries = [
    { line: 1, entry: { id: 'OLD-1', ts: '2026-10-28T04:24:26+08:00' } },
    { line: 2, entry: { id: 'NEW-1', ts: DEFAULT_CUTOFF + 'T09:00:00+08:00', acceptance: 'node tools/dev/run_all_gates.mjs' } },
    { line: 3, entry: { id: 'NEW-2', ts: '2026-11-17T09:00:00+08:00' } },
  ];
  const result = validateEntries(entries, { file: 'probe.jsonl' });
  assert.equal(result.exempt, 1);
  assert.equal(result.checked, 2);
  assert.deepEqual(result.violations.map((v) => v.kind), ['missing-acceptance']);
  assert.match(result.violations[0].message, /NEW-2/);
});

test('必红面：id 重复、缺 id、缺 ts 都逐条点名', () => {
  const entries = [
    { line: 1, entry: { id: 'DUP', ts: '2026-10-01T00:00:00+08:00', acceptance: 'x' } },
    { line: 2, entry: { id: 'DUP', ts: '2026-10-02T00:00:00+08:00', acceptance: 'x' } },
    { line: 3, entry: { ts: '2026-11-20T00:00:00+08:00', acceptance: 'x' } },
    { line: 4, entry: { id: 'NO-TS', acceptance: 'x' } },
  ];
  const result = validateEntries(entries, { file: 'probe.jsonl' });
  assert.deepEqual(result.violations.map((v) => v.kind), ['duplicate-id', 'missing-id', 'missing-ts']);
});

test('真仓台账过门禁：changes 与 fixes 无违规，历史条目全部豁免', () => {
  const violations = [];
  let checked = 0;
  let exempt = 0;
  for (const relPath of LEDGER_FILES) {
    const result = checkLedgerFile(REPO, relPath);
    violations.push(...result.violations);
    checked += result.checked;
    exempt += result.exempt;
  }
  assert.deepEqual(violations, []);
  assert.ok(exempt > 0, '真仓应存在截止日前的历史条目');
  assert.equal(checked + exempt > 0, true);
});

test('入口：真仓 exit 0，非法 --cutoff 退出码 2', () => {
  const logs = [];
  const io = { log: (m) => logs.push(m), error: (m) => logs.push(m) };
  assert.equal(main([], io), 0, logs.join('\n'));
  assert.match(logs.join('\n'), /\[ OK \] 台账验收字段门禁/);
  assert.equal(main(['--cutoff', '2026/11/16'], io), 2);
});
