#!/usr/bin/env node
/**
 * 跨项目交付审计只读汇总（4 Argon 第二十三轮 Q5，收官拼图最后一块）。
 *
 * 纯只读、零副作用：只扫各项目的 acceptance_audit.jsonl 并汇总，不写任何文件。
 * 刻意不进 server/ 运行时——它是交付复盘用的人工 CLI，不是服务端能力。
 *
 * 为什么需要它：审计流按项目分散（每个项目一份），交付复盘时想知道
 * 「一共交付了多少单、涉及哪些项目、最近一次是什么」得挨个目录翻。
 *
 * 契约（按裁定原文）：
 *   - 扫描各项目 deliverables 下的 acceptance_audit.jsonl（--root 可注入测试夹具目录）
 *   - 逐行解析审计流，每行必须含 7 个标准键；坏行显式报 INVALID_AUDIT_LINE 并计数，不静默吞
 *   - 按时间戳排序，输出总次数 / 唯一项目哈希数 / 累计校验文件数 / 最近一次时间与 tar 前 12 位
 *   - --json 供机器消费
 * 退出码：0 正常（含无数据），1 有坏行。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.resolve(HERE, '..', '..');
export const AUDIT_NAME = 'acceptance_audit.jsonl';
export const INVALID_LINE_CODE = 'INVALID_AUDIT_LINE';

/** 第二十二轮锁死的 7 个标准键：多一个少一个都算非法行。 */
export const REQUIRED_AUDIT_KEYS = Object.freeze([
  'schema_version', 'at', 'project_id_sha256', 'tar_sha256',
  'verified_count', 'coverage_ok', 'verifier_version',
]);

export function validateAuditLine(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { ok: false, reason: 'not_an_object' };
  }
  const keys = Object.keys(entry).sort();
  const required = [...REQUIRED_AUDIT_KEYS].sort();
  if (keys.length !== required.length || keys.some((k, i) => k !== required[i])) {
    return { ok: false, reason: 'key_set_mismatch', keys };
  }
  if (typeof entry.project_id_sha256 !== 'string' || !/^[0-9a-f]{16}$/.test(entry.project_id_sha256)) {
    return { ok: false, reason: 'bad_project_hash' };
  }
  if (typeof entry.tar_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.tar_sha256)) {
    return { ok: false, reason: 'bad_tar_hash' };
  }
  const at = new Date(entry.at);
  if (Number.isNaN(at.getTime())) return { ok: false, reason: 'bad_timestamp' };
  if (!Number.isInteger(entry.verified_count) || entry.verified_count < 0) {
    return { ok: false, reason: 'bad_verified_count' };
  }
  return { ok: true };
}

/** 找出所有审计流文件：[{ projectDir, path }]。只认白名单位置，不做全仓通扫。 */
export function findAuditLedgers({ root = DEFAULT_ROOT } = {}) {
  const out = [];
  const projectsDir = path.join(root, 'workspace/projects');
  let pids = [];
  try { pids = fs.readdirSync(projectsDir); } catch { return out; }
  for (const pid of pids.sort()) {
    const file = path.join(projectsDir, pid, 'deliverables', AUDIT_NAME);
    if (fs.existsSync(file)) out.push({ projectDir: pid, path: file });
  }
  return out;
}

/**
 * 解析一个审计流。返回 { entries, invalid, total }。
 * 坏行不静默：逐条记 line 号与原因，最终由调用方统计并判红。
 */
export function parseAuditLedger(file, projectDir = '') {
  const entries = [];
  const invalid = [];
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (cause) {
    return { entries, invalid: [{ line: 0, reason: 'unreadable', detail: cause.message, projectDir }], total: 0 };
  }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].trim()) continue;
    let entry;
    try { entry = JSON.parse(lines[i]); } catch {
      invalid.push({ line: i + 1, reason: 'bad_json', detail: lines[i].slice(0, 80), projectDir });
      continue;
    }
    const verdict = validateAuditLine(entry);
    if (!verdict.ok) {
      invalid.push({ line: i + 1, reason: verdict.reason, projectDir });
      continue;
    }
    entries.push({ ...entry, projectDir });
  }
  return { entries, invalid, total: entries.length };
}

/** 汇总：按时间戳排序，给出裁定点名的四项指标。 */
export function summarizeAudits({ root = DEFAULT_ROOT } = {}) {
  const ledgers = findAuditLedgers({ root });
  const entries = [];
  const invalid = [];
  for (const ledger of ledgers) {
    const parsed = parseAuditLedger(ledger.path, ledger.projectDir);
    entries.push(...parsed.entries);
    invalid.push(...parsed.invalid);
  }
  entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const uniqueProjects = new Set(entries.map((e) => e.project_id_sha256));
  const verifiedTotal = entries.reduce((sum, e) => sum + Number(e.verified_count || 0), 0);
  const latest = entries.length > 0 ? entries[entries.length - 1] : null;
  return {
    ok: invalid.length === 0,
    ledgers: ledgers.length,
    deliveries: entries.length,
    uniqueProjects: uniqueProjects.size,
    verifiedTotal,
    latest: latest ? {
      at: latest.at,
      tar_sha256_prefix: String(latest.tar_sha256).slice(0, 12),
      verified_count: latest.verified_count,
      project_id_sha256: latest.project_id_sha256,
    } : null,
    entries,
    invalid,
  };
}

export function main(argv = process.argv.slice(2), io = { log: console.log, error: console.error }) {
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const root = value('--root') ? path.resolve(value('--root')) : DEFAULT_ROOT;
  const summary = summarizeAudits({ root });
  if (!summary.ok) {
    for (const item of summary.invalid) {
      io.error('[ RED ] ' + INVALID_LINE_CODE + '：' + item.projectDir + ' 第 ' + item.line + ' 行（' + item.reason + '）'
        + (item.detail ? '：' + item.detail : ''));
    }
  }
  if (argv.includes('--json')) {
    io.log(JSON.stringify({
      ok: summary.ok, ledgers: summary.ledgers, deliveries: summary.deliveries,
      unique_projects: summary.uniqueProjects, verified_total: summary.verifiedTotal,
      latest: summary.latest, invalid: summary.invalid.length,
    }, null, 2));
    return summary.ok ? 0 : 1;
  }
  io.log('交付审计汇总（只读）');
  io.log('  审计流文件: ' + summary.ledgers + ' 份');
  if (summary.deliveries === 0) {
    io.log('  暂无交付记录。');
    io.log(summary.ok ? 'AUDIT_SUMMARY_OK 无数据' : 'AUDIT_SUMMARY_FAILED ' + summary.invalid.length + ' 处坏行');
    return summary.ok ? 0 : 1;
  }
  io.log('  交付次数: ' + summary.deliveries);
  io.log('  唯一项目数: ' + summary.uniqueProjects);
  io.log('  累计校验文件数: ' + summary.verifiedTotal);
  if (summary.latest) {
    io.log('  最近一次: ' + summary.latest.at + '｜tar 前 12 位 ' + summary.latest.tar_sha256_prefix
      + '｜校验 ' + summary.latest.verified_count + ' 个文件');
  }
  if (!summary.ok) {
    io.error('AUDIT_SUMMARY_FAILED ' + summary.invalid.length + ' 处坏行');
    return 1;
  }
  io.log('AUDIT_SUMMARY_OK ' + summary.deliveries + ' 次交付 / ' + summary.uniqueProjects + ' 个项目');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
