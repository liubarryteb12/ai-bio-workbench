/**
 * 跨项目审计汇总 CLI 契约测试（4 Argon 第二十三轮 Q5，收官拼图）。
 *
 * 判据按裁定原文四条：多项目合并去重排序、空目录优雅返回 0、
 * 损坏行精准拦截并计数、7 个标准键锁死（多一个少一个都不行）。
 * 全部在临时夹具目录里真跑，不读仓库真实交付数据。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  summarizeAudits, findAuditLedgers, parseAuditLedger, validateAuditLine, main,
  REQUIRED_AUDIT_KEYS, INVALID_LINE_CODE, AUDIT_NAME,
} from '../../ops/audit_summary.mjs';

const BIOANALYS_DIR = path.resolve(import.meta.dirname, '..');
const REPO = path.resolve(BIOANALYS_DIR, '..');

function tmpRoot(tag) {
  // 夹具必须完全隔离：只建 local_projects 子树，绝不指向仓库根。
  // （首版把 root 设成 .tmp 下的目录，仍会被仓库真实 local_projects 干扰，实测踩到）
  const base = path.join(REPO, '.tmp', 'audit-sum-' + tag + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
  fs.mkdirSync(base, { recursive: true });   // 只建根；local_projects 由各用例按需创建
  return base;
}

function validEntry({ projectHash, tarHash, at, verified = 100 }) {
  return {
    schema_version: 1,
    at,
    project_id_sha256: projectHash,
    tar_sha256: tarHash,
    verified_count: verified,
    coverage_ok: true,
    verifier_version: 'delivery-acceptance-core/1.0.0',
  };
}

function writeLedger(root, pid, entries) {
  const dir = path.join(root, 'local_projects', pid, 'deliverables');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, AUDIT_NAME), entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  return path.join(dir, AUDIT_NAME);
}

test('7 个标准键锁死：多键、缺键、类型错都判非法', () => {
  assert.deepEqual([...REQUIRED_AUDIT_KEYS].sort(), [
    'at', 'coverage_ok', 'project_id_sha256', 'schema_version', 'tar_sha256',
    'verified_count', 'verifier_version',
  ]);
  const good = validEntry({ projectHash: 'a'.repeat(16), tarHash: 'b'.repeat(64), at: '2026-11-03T00:00:00.000Z' });
  assert.equal(validateAuditLine(good).ok, true);
  assert.equal(validateAuditLine({ ...good, host_path: '/x' }).ok, false, '多一个键必须判非法');
  assert.equal(validateAuditLine({ ...good, coverage_ok: undefined } && { schema_version: 1 }).ok, false, '缺键必须判非法');
  assert.equal(validateAuditLine({ ...good, project_id_sha256: 'PRJ_AIMS' }).ok, false, '明文项目号必须判非法');
  assert.equal(validateAuditLine({ ...good, tar_sha256: 'short' }).ok, false);
  assert.equal(validateAuditLine({ ...good, at: 'not-a-date' }).ok, false);
  assert.equal(validateAuditLine({ ...good, verified_count: -1 }).ok, false);
  assert.equal(validateAuditLine([]).ok, false);
});

test('多项目合并：跨目录收集、按时间升序、唯一项目去重、累计文件数正确', () => {
  const root = tmpRoot('merge');
  try {
    writeLedger(root, 'PRJ_A', [
      validEntry({ projectHash: 'a'.repeat(16), tarHash: '1'.repeat(64), at: '2026-11-01T00:00:00.000Z', verified: 50 }),
      validEntry({ projectHash: 'a'.repeat(16), tarHash: '2'.repeat(64), at: '2026-11-03T00:00:00.000Z', verified: 80 }),
    ]);
    writeLedger(root, 'PRJ_B', [
      validEntry({ projectHash: 'b'.repeat(16), tarHash: '3'.repeat(64), at: '2026-11-02T00:00:00.000Z', verified: 30 }),
    ]);
    assert.equal(findAuditLedgers({ root }).length, 2);
    const s = summarizeAudits({ root });
    assert.equal(s.ok, true);
    assert.equal(s.deliveries, 3);
    assert.equal(s.uniqueProjects, 2, '同项目两次交付只算一个项目');
    assert.equal(s.verifiedTotal, 160);
    assert.deepEqual(s.entries.map((e) => e.at), [
      '2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z', '2026-11-03T00:00:00.000Z',
    ], '必须按时间升序');
    assert.equal(s.latest.at, '2026-11-03T00:00:00.000Z');
    assert.equal(s.latest.tar_sha256_prefix, '2'.repeat(12), '最近一次取 tar 前 12 位');
    assert.equal(s.latest.verified_count, 80);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('空目录：local_projects 完全不存在时优雅返回 0，不抛错', () => {
  // 这条必须覆盖「目录根本不存在」：首版 tmpRoot 预建了 local_projects，
  // 结果 M5（把 catch 去掉）存活——空目录断言名不副实，实测修正。
  const root = tmpRoot('empty');
  try {
    const s = summarizeAudits({ root });
    assert.equal(s.ok, true);
    assert.equal(s.deliveries, 0);
    assert.equal(s.uniqueProjects, 0);
    assert.equal(s.latest, null);
    const logs = [];
    const code = main(['--root', root], { log: (m) => logs.push(m), error: (m) => logs.push(m) });
    assert.equal(code, 0);
    assert.match(logs.join('\n'), /AUDIT_SUMMARY_OK 无数据/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('损坏行精准拦截：bad JSON 与非法键集都报 INVALID_AUDIT_LINE 并计数', () => {
  const root = tmpRoot('bad');
  try {
    const dir = path.join(root, 'local_projects', 'PRJ_BAD', 'deliverables');
    fs.mkdirSync(dir, { recursive: true });
    const good = validEntry({ projectHash: 'c'.repeat(16), tarHash: 'd'.repeat(64), at: '2026-11-01T00:00:00.000Z' });
    fs.writeFileSync(path.join(dir, AUDIT_NAME), [
      JSON.stringify(good),
      '{not json',
      JSON.stringify({ ...good, extra_key: 1 }),
      '',
    ].join('\n'), 'utf8');
    const s = summarizeAudits({ root });
    assert.equal(s.ok, false, '有坏行必须 ok=false');
    assert.equal(s.deliveries, 1, '好行仍然计入');
    assert.equal(s.invalid.length, 2, '两条坏行都要计数');
    assert.equal(s.invalid[0].reason, 'bad_json');
    assert.equal(s.invalid[1].reason, 'key_set_mismatch');
    const logs = [];
    const code = main(['--root', root], { log: (m) => logs.push(m), error: (m) => logs.push(m) });
    assert.equal(code, 1, '坏行必须 exit 1');
    const text = logs.join('\n');
    assert.ok(text.includes(INVALID_LINE_CODE), '必须打出 INVALID_AUDIT_LINE 码');
    assert.ok(text.includes('AUDIT_SUMMARY_FAILED'), '必须有失败哨兵');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('--json 可解析且字段与文本口径一致', () => {
  const root = tmpRoot('json');
  try {
    writeLedger(root, 'PRJ_J', [
      validEntry({ projectHash: 'e'.repeat(16), tarHash: 'f'.repeat(64), at: '2026-11-03T00:00:00.000Z', verified: 12 }),
    ]);
    const logs = [];
    const code = main(['--root', root, '--json'], { log: (m) => logs.push(m), error: (m) => logs.push(m) });
    assert.equal(code, 0);
    const parsed = JSON.parse(logs.join('\n'));
    assert.equal(parsed.ok, true);
    assert.equal(parsed.deliveries, 1);
    assert.equal(parsed.unique_projects, 1);
    assert.equal(parsed.verified_total, 12);
    assert.equal(parsed.invalid, 0);
    assert.equal(parsed.latest.tar_sha256_prefix, 'f'.repeat(12));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('只读契约：不写任何文件（跑完夹具目录 mtime 与内容不变）', () => {
  const root = tmpRoot('readonly');
  try {
    const file = writeLedger(root, 'PRJ_R', [
      validEntry({ projectHash: 'a'.repeat(16), tarHash: 'b'.repeat(64), at: '2026-11-03T00:00:00.000Z' }),
    ]);
    const before = fs.readFileSync(file, 'utf8');
    const beforeMtime = fs.statSync(file).mtimeMs;
    summarizeAudits({ root });
    assert.equal(fs.readFileSync(file, 'utf8'), before, '审计流内容不得被改写');
    assert.equal(fs.statSync(file).mtimeMs, beforeMtime);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('静态契约：不侵入 server/ 运行时，只做只读扫描', () => {
  const src = fs.readFileSync(path.join(REPO, 'ops', 'audit_summary.mjs'), 'utf8');
  assert.equal(/writeFileSync|appendFileSync|rmSync/.test(src), false, '汇总脚本禁止任何写操作');
  assert.ok(src.includes("path.join(root, 'local_projects')"), '只认白名单扫描位置');
  assert.ok(src.includes('INVALID_AUDIT_LINE'));
});
