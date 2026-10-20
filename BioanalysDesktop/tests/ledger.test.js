import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { auditLedgerEntry, summarizeLedger } from '../server/ledger.js';
import { LINES } from '../server/domain.js';

const samplesDir = path.resolve(import.meta.dirname, '../../cn_debug/samples/system_logs');

async function loadSample(name) {
  const raw = await readFile(path.join(samplesDir, name), 'utf8');
  return JSON.parse(raw);
}

test('合法样例：无违规', async () => {
  const entry = await loadSample('task_ok.json');
  const result = auditLedgerEntry(entry);
  assert.deepEqual(result.problems, []);
});

test('跨线样例：精确报出是哪条线、哪个方向', async () => {
  const entry = await loadSample('task_cross.json');
  const result = auditLedgerEntry(entry);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /line2_scrna/);
  assert.match(result.problems[0], /input/);
});

test('缺种子样例：checkpoint passed 但无 random_seed', async () => {
  const entry = await loadSample('task_noseed.json');
  const result = auditLedgerEntry(entry);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /random_seed/);
});

test('line_id 非法直接判违规', () => {
  const result = auditLedgerEntry({ line_id: 'line4_nope', io_files: {} });
  assert.ok(result.problems.some((problem) => /line_id/.test(problem)));
});

test('output 写 public_references 被拒，input 引用放行', () => {
  const bad = auditLedgerEntry({
    line_id: 'line1_bulk',
    io_files: { output: ['/mnt/ssd/bio_data/public_references/x.tsv'] },
  });
  assert.ok(bad.problems.some((problem) => /public_references/.test(problem)));

  const good = auditLedgerEntry({
    line_id: 'line1_bulk',
    io_files: { input: ['/mnt/ssd/bio_data/public_references/hg38.gtf'] },
  });
  assert.deepEqual(good.problems, []);
});

test('路径不在任何合法根下也被拒', () => {
  const result = auditLedgerEntry({
    line_id: 'line2_scrna',
    io_files: { input: ['/tmp/somewhere/random.tsv'] },
  });
  assert.ok(result.problems.some((problem) => /不在任何合法根下/.test(problem)));
});

test('Windows 风格分隔符的跨线路径同样被拒', () => {
  const result = auditLedgerEntry({
    line_id: 'line1_bulk',
    io_files: { input: ['/mnt/ssd/bio_data\\line3_spatial\\results\\x.tsv'] },
  });
  assert.ok(result.problems.some((problem) => /line3_spatial/.test(problem)));
});

test('项目名大小写必须精确匹配：大写 project_id 不被误判为跨项目', () => {
  // Linux 路径大小写敏感，PRJ_2026_001 与 prj_2026_001 是两个目录。
  // 曾经把路径整体转小写再比较，导致每个合法台账都被拒落盘（2026-10-19 实测）。
  const result = auditLedgerEntry({
    project_id: 'PRJ_E2E_GSE277173',
    line_id: 'line1_bulk',
    io_files: {
      input: ['/mnt/ssd/bio_data/projects/PRJ_E2E_GSE277173/line1_bulk/raw_data/GSE1_series_matrix.txt.gz'],
      output: ['/mnt/ssd/bio_data/projects/PRJ_E2E_GSE277173/line1_bulk/processed/expr_genes.tsv'],
    },
  });
  assert.deepEqual(result.problems, []);
});

test('真正跨项目仍然被拒（大小写只差也不算同一个项目）', () => {
  const result = auditLedgerEntry({
    project_id: 'PRJ_A',
    line_id: 'line1_bulk',
    io_files: { input: ['/mnt/ssd/bio_data/projects/prj_a/line1_bulk/processed/x.tsv'] },
  });
  assert.ok(result.problems.some((problem) => /跨项目/.test(problem)));
});

test('汇总：三类样例合起来应是 1 合法 2 违规，且能按线分组', async () => {
  const entries = await Promise.all(
    ['task_ok.json', 'task_cross.json', 'task_noseed.json'].map(loadSample)
  );
  const summary = summarizeLedger(entries);
  assert.equal(summary.total, 3);
  assert.equal(summary.legal, 1);
  assert.equal(summary.violations, 2);
  // 按线计：line2_scrna 1 条合法，line3_spatial 1 条违规，line1_bulk 1 条违规
  assert.equal(summary.byLine.line2_scrna.legal, 1);
  assert.equal(summary.byLine.line3_spatial.violations, 1);
  assert.equal(summary.byLine.line1_bulk.violations, 1);
});

test('空列表不炸，判 0/0', () => {
  const summary = summarizeLedger([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.legal, 0);
});

test('三条线都在统计键里出现（哪怕没有台账）', () => {
  const summary = summarizeLedger([]);
  for (const line of LINES) {
    assert.ok(summary.byLine[line], `${line} 应有统计位`);
  }
});
