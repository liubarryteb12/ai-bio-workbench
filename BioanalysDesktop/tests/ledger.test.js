import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  analyzePath,
  auditLedgerEntry,
  classifyPath,
  inspectTaskPath,
  isPathUnderLegalRoot,
  summarizeLedger,
} from '../server/ledger.js';
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

// ─────────────────────────────────────────────────────────────
// 2026-10-21 合法根单一事实源（task-7 / 对齐 S29 遗留风险 2、3）
// 同一批样例同时过 classifyPath 与提交预校验期望，断言两处结论一致。
// ─────────────────────────────────────────────────────────────

const SSD = '/mnt/ssd/bio_data';

test('合法根：SSD_ROOT 下 projects/<pid>/ 任意子路径，含非三线子目录', () => {
  const legal = [
    `${SSD}/projects/PRJ_X/line1_bulk/raw_data/GSE1_series_matrix.txt.gz`,
    `${SSD}/projects/PRJ_X/line1_bulk/processed/expr.tsv`,
    `${SSD}/projects/PRJ_X/line1_bulk/results/deg.tsv`,
    `${SSD}/projects/PRJ_X/line1_bulk/figures/volcano.png`,
    `${SSD}/projects/PRJ_X/whatever/deep/x.tsv`,
    `${SSD}/public_references/hg38.gtf`,
    `${SSD}/system_logs/x.json`,
    `${SSD}/line2_scrna/processed/ctrl.h5ad`,
  ];
  for (const p of legal) {
    assert.equal(isPathUnderLegalRoot(p), true, `应判在合法根下: ${p}`);
    assert.notEqual(classifyPath(p), null, `classifyPath 不应为 null: ${p}`);
  }
  assert.equal(classifyPath(`${SSD}/projects/PRJ_X/whatever/deep/x.tsv`), 'projects');
  assert.equal(classifyPath(`${SSD}/projects/PRJ_X/line1_bulk/results/deg.tsv`), 'line1_bulk');
});

test('合法根：裸相对文件名与 projects/<pid>/... 相对形态', () => {
  assert.equal(isPathUnderLegalRoot('pseudobulk.tsv'), true);
  assert.equal(classifyPath('pseudobulk.tsv'), 'relative');
  assert.equal(classifyPath('pseudobulk.tsv', 'line2_scrna'), 'line2_scrna', '裸文件名按相对当前线目录解释');
  assert.equal(isPathUnderLegalRoot('projects/PRJ_X/line1_bulk/processed/x.tsv'), true);
  assert.equal(classifyPath('projects/PRJ_X/line1_bulk/processed/x.tsv'), 'line1_bulk');
  assert.equal(classifyPath('projects/PRJ_X/whatever/x.tsv'), 'projects');
});

test('合法根：拒绝 .. 穿越、SSD_ROOT 之外、空串、相对多级路径', () => {
  const illegal = [
    '',
    '   ',
    '/etc/passwd',
    SSD,
    `${SSD}/`,
    `${SSD}/projects/PRJ_X/line1_bulk/../../system_logs/x.json`,
    'projects/../system_logs/x.json',
    'C:\\Users\\x\\expr.tsv',
    'processed/x.tsv',
    'foo/bar.tsv',
    `${SSD}/projects`,
  ];
  for (const p of illegal) {
    assert.equal(isPathUnderLegalRoot(p), false, `应拒绝: ${JSON.stringify(p)}`);
    assert.equal(classifyPath(p), null, `classifyPath 应为 null: ${JSON.stringify(p)}`);
  }
});

test('历史兼容分支：SSD_ROOT 之外但含线标记的路径只对审计放行（与 ops/03 同口径）', () => {
  // 既有样例 cn_debug/samples/system_logs 的路径都在 SSD_ROOT 之外，
  // 服务器侧 tools/ops/03_check_logs_remote.sh 按 marker 判定合法；审计必须与之一致。
  const legacy = '/data/data/com.termux/files/home/bio_data_logs_test/line2_scrna/processed/ctrl.mtx';
  const info = analyzePath(legacy);
  assert.equal(info.ok, true);
  assert.equal(info.legacy, true);
  assert.equal(info.kind, 'line2_scrna');
  assert.equal(classifyPath(legacy), 'line2_scrna', '审计侧必须与服务器 bash 判定一致');
  assert.equal(isPathUnderLegalRoot(legacy), false, '严格口径不把 SSD_ROOT 之外的路径算合法根');
  assert.equal(inspectTaskPath(legacy, 'default', 'input').reason, '不在数据根之下', '提交层不继承历史分支');
  assert.equal(analyzePath(legacy, { allowLegacyOutsideRoot: false }).reason, '不在数据根之下');
});

test('analyzePath 返回归属、head 与项目段，供两种口径各取所需', () => {
  const info = analyzePath(`${SSD}/projects/PRJ_X/whatever/deep/x.tsv`);
  assert.equal(info.ok, true);
  assert.equal(info.kind, 'projects');
  assert.equal(info.head, 'projects');
  assert.equal(info.projectId, 'PRJ_X');
  assert.equal(info.legacy, undefined);

  const line = analyzePath(`${SSD}/line3_spatial/results/x.tsv`);
  assert.equal(line.kind, 'line3_spatial');
  assert.equal(line.head, 'line3_spatial');
  assert.equal(line.projectId, null);

  const rel = analyzePath('projects/PRJ_X/whatever/x.tsv');
  assert.equal(rel.head, 'projects');
  assert.equal(rel.projectId, 'PRJ_X');
});

test('台账审计：projects/<pid>/ 任意子路径与裸相对文件名不再被判"不在合法根下"', () => {
  const entry = {
    project_id: 'PRJ_X',
    line_id: 'line1_bulk',
    io_files: {
      input: ['projects/PRJ_X/line1_bulk/processed/expr.tsv', 'pseudobulk.tsv'],
      output: [`${SSD}/projects/PRJ_X/whatever/deep/x.tsv`, 'degs.tsv'],
    },
  };
  assert.deepEqual(auditLedgerEntry(entry).problems, []);
});

test('台账审计：裸相对文件名按当前线解释，不会误判跨线', () => {
  const entry = {
    project_id: 'default',
    line_id: 'line2_scrna',
    io_files: { input: ['pseudobulk.tsv'], output: ['DR_genes.csv'] },
  };
  assert.deepEqual(auditLedgerEntry(entry).problems, []);
});

test('台账审计：相对 projects/<其他项目>/ 仍判跨项目', () => {
  const result = auditLedgerEntry({
    project_id: 'PRJ_A',
    line_id: 'line1_bulk',
    io_files: { input: ['projects/PRJ_B/line1_bulk/processed/x.tsv'] },
  });
  assert.ok(result.problems.some((problem) => /跨项目/.test(problem)), JSON.stringify(result.problems));
});

test('台账审计：相对多级路径与 .. 仍判不在合法根下', () => {
  const result = auditLedgerEntry({
    line_id: 'line1_bulk',
    io_files: { input: ['processed/x.tsv', '../x.tsv'] },
  });
  assert.equal(result.problems.filter((problem) => /不在任何合法根下/.test(problem)).length, 2);
});

// 提交侧期望表：报告给出的 index.js diff 让 validateTaskPaths 直接复用 ledger.inspectTaskPath，
// 所以这里用 inspectTaskPath 代表 validateTaskPaths 的期望结论（同一实现、同一批样例）。
const SUBMIT_SAMPLES = [
  { path: `${SSD}/projects/default/line1_bulk/processed/expr.tsv`, direction: 'input', legalRoot: true, submitOk: true },
  { path: `${SSD}/projects/default/line1_bulk/results/deg.tsv`, direction: 'output', legalRoot: true, submitOk: true },
  { path: `${SSD}/projects/default/whatever/x.tsv`, direction: 'input', legalRoot: true, submitOk: true },
  { path: `${SSD}/line1_bulk/processed/expr.tsv`, direction: 'input', legalRoot: true, submitOk: true },
  { path: `${SSD}/public_references/hg38.gtf`, direction: 'input', legalRoot: true, submitOk: true },
  { path: 'pseudobulk.tsv', direction: 'input', legalRoot: true, submitOk: true },
  { path: 'projects/default/line1_bulk/processed/x.tsv', direction: 'input', legalRoot: true, submitOk: true },
  { path: `${SSD}/projects/PRJ_OTHER/line1_bulk/x.tsv`, direction: 'input', legalRoot: true, submitOk: false, reason: '跨项目' },
  { path: 'projects/PRJ_OTHER/line1_bulk/x.tsv', direction: 'input', legalRoot: true, submitOk: false, reason: '跨项目' },
  { path: `${SSD}/system_logs/x.json`, direction: 'input', legalRoot: true, submitOk: false, reason: '系统目录禁止作为任务输入/输出' },
  { path: `${SSD}/public_references/x.gtf`, direction: 'output', legalRoot: true, submitOk: false, reason: '输出不得写只读共享区' },
  { path: `${SSD}/bin/line1_bulk/x.sh`, direction: 'input', legalRoot: true, submitOk: false, reason: '不属于本项目' },
  { path: `${SSD}/projects/default/line1_bulk/../../system_logs/x.json`, direction: 'input', legalRoot: false, submitOk: false, reason: '含 ..' },
  { path: '/etc/passwd', direction: 'input', legalRoot: false, submitOk: false, reason: '不在数据根之下' },
  { path: '', direction: 'input', legalRoot: false, submitOk: false, reason: '空路径' },
  { path: SSD, direction: 'input', legalRoot: false, submitOk: false, reason: '不是文件路径' },
  { path: 'C:\\Users\\x.tsv', direction: 'input', legalRoot: false, submitOk: false, reason: 'Windows 绝对路径' },
  { path: 'processed/x.tsv', direction: 'input', legalRoot: false, submitOk: false, reason: '相对路径缺少合法根' },
  { path: `${SSD}/projects`, direction: 'input', legalRoot: false, submitOk: false, reason: '缺少项目段' },
];

test('两处口径一致：classifyPath 的合法根结论与提交预校验结论同批样例一致', () => {
  for (const sample of SUBMIT_SAMPLES) {
    const rootLegal = isPathUnderLegalRoot(sample.path);
    const classifyLegal = classifyPath(sample.path) !== null;
    const verdict = inspectTaskPath(sample.path, 'default', sample.direction);
    const submitOk = verdict === null;

    // 合法根的两套读法必须一致（审计 classifyPath 与严格 isPathUnderLegalRoot）
    assert.equal(classifyLegal, rootLegal, `classifyPath 与 isPathUnderLegalRoot 不一致: ${JSON.stringify(sample.path)}`);
    assert.equal(rootLegal, sample.legalRoot, `合法根结论不符: ${JSON.stringify(sample.path)}`);
    // 提交预校验结论与期望表一致，并点名原因
    assert.equal(submitOk, sample.submitOk, `提交结论不符: ${JSON.stringify(sample.path)} → ${JSON.stringify(verdict)}`);
    if (!sample.submitOk) {
      assert.equal(verdict.reason, sample.reason, `拒绝原因不符: ${JSON.stringify(sample.path)}`);
    }
    // 一致性不变量：放行必在合法根下；不在合法根下必拒绝
    if (submitOk) assert.equal(rootLegal, true, `放行路径必须判在合法根下: ${sample.path}`);
    if (!rootLegal) assert.equal(submitOk, false, `非法根必须拒绝: ${sample.path}`);
    // 合法根但被 ownership 规则拒绝的样例，拒绝原因不得是根问题
    if (rootLegal && !submitOk) {
      assert.ok(
        ['跨项目', '系统目录禁止作为任务输入/输出', '输出不得写只读共享区', '不属于本项目'].includes(verdict.reason),
        `合法根下的拒绝必须是 ownership 原因: ${sample.path} → ${verdict.reason}`
      );
    }
  }
});
