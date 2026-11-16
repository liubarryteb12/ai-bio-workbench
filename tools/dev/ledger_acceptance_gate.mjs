#!/usr/bin/env node
/**
 * 台账验收字段门禁（2026-11-16，借鉴 standalone-project-scaffolder 的 --acceptance 强断言）
 *
 * 存在理由：changes / fixes 台账此前只记「改了什么」，不记「怎么证明改对了」。
 * 条目要回看时，只能靠写条人当时的信用。本门禁要求新条目自带可机器核对的完成判据，
 * 让「登记」与「验证」绑在同一行 JSONL 上。
 *
 * 判据（缺一即红）：
 *   1. 每行必须解析为 JSON 对象；
 *   2. id 在同一文件内唯一；
 *   3. ts >= 截止日的条目必须带非空 acceptance（字符串，或至少含一个非空字符串的数组）。
 *      截止日之前的条目按写入时的契约豁免，历史原文不回写。
 *
 * 用法：
 *   node tools/dev/ledger_acceptance_gate.mjs                 # 默认截止日 2026-11-16
 *   node tools/dev/ledger_acceptance_gate.mjs --cutoff 2026-12-01
 * 退出码：0 全绿，1 有违规，2 参数错误。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');

/** 纳入本门禁的台账文件（仓库相对路径）。 */
export const LEDGER_FILES = Object.freeze([
  'ledger/changes.jsonl',
  'ledger/fixes.jsonl',
]);

/** 截止日：此日及之后写入的条目必须带 acceptance。 */
export const DEFAULT_CUTOFF = '2026-11-16';

/** 验收判据：非空字符串，或至少含一个非空字符串的数组。 */
export function acceptanceIsPresent(value) {
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) {
    return value.some((item) => typeof item === 'string' && item.trim() !== '');
  }
  return false;
}

/**
 * 解析 JSONL 文本，返回 { entries, violations }。
 * 空行跳过；解析失败的行按 1 基行号点名。
 */
export function parseJsonl(text, file = '<inline>') {
  const entries = [];
  const violations = [];
  const lines = String(text ?? '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i].trim();
    if (raw === '') continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      violations.push({
        file, line: i + 1, kind: 'invalid-json',
        message: file + ':' + (i + 1) + ' 不是合法 JSON：' + error.message,
      });
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      violations.push({
        file, line: i + 1, kind: 'not-object',
        message: file + ':' + (i + 1) + ' 必须是 JSON 对象',
      });
      continue;
    }
    entries.push({ line: i + 1, entry: parsed });
  }
  return { entries, violations };
}

/** 条目的日期段（ts 的前 10 位），缺失或格式异常时返回 null。 */
export function entryDate(entry) {
  const ts = entry && entry.ts;
  if (typeof ts !== 'string') return null;
  const prefix = ts.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(prefix) ? prefix : null;
}

/**
 * 逐条校验已解析的条目。
 * @returns {{violations: Array, checked: number, exempt: number}}
 */
export function validateEntries(entries, { cutoff = DEFAULT_CUTOFF, file = '<inline>' } = {}) {
  const violations = [];
  const seenIds = new Map();
  let exempt = 0;
  let checked = 0;
  for (const { line, entry } of entries) {
    const id = typeof entry.id === 'string' && entry.id.trim() !== '' ? entry.id.trim() : null;
    if (id === null) {
      violations.push({ file, line, kind: 'missing-id', message: file + ':' + line + ' 缺少 id' });
    } else if (seenIds.has(id)) {
      violations.push({
        file, line, kind: 'duplicate-id',
        message: file + ':' + line + ' id 重复：' + id + '（首次出现于第 ' + seenIds.get(id) + ' 行）',
      });
    } else {
      seenIds.set(id, line);
    }
    const date = entryDate(entry);
    if (date === null) {
      violations.push({ file, line, kind: 'missing-ts', message: file + ':' + line + ' 缺少合法 ts（YYYY-MM-DD 前缀）' });
      continue;
    }
    if (date < cutoff) {
      exempt += 1;
      continue;
    }
    checked += 1;
    if (!acceptanceIsPresent(entry.acceptance)) {
      violations.push({
        file, line, kind: 'missing-acceptance',
        message: file + ':' + line + '（' + (id ?? '无 id') + '）ts=' + date
          + ' 在截止日 ' + cutoff + ' 之后，缺非空 acceptance 验收判据',
      });
    }
  }
  return { violations, checked, exempt };
}

/** 读仓库内一份台账并校验。文件缺失按违规处理（台账是受控资产）。 */
export function checkLedgerFile(repoRoot, relPath, { cutoff = DEFAULT_CUTOFF } = {}) {
  const full = path.join(repoRoot, relPath);
  if (!fs.existsSync(full)) {
    return {
      violations: [{ file: relPath, line: 0, kind: 'missing-file', message: relPath + ' 不存在' }],
      checked: 0, exempt: 0,
    };
  }
  const { entries, violations } = parseJsonl(fs.readFileSync(full, 'utf8'), relPath);
  const result = validateEntries(entries, { cutoff, file: relPath });
  return { violations: violations.concat(result.violations), checked: result.checked, exempt: result.exempt };
}

export function main(argv = process.argv.slice(2), io = { log: console.log, error: console.error }) {
  const arg = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : null;
  };
  const cutoff = arg('--cutoff') || DEFAULT_CUTOFF;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) {
    io.error('[ RED ] --cutoff 必须是 YYYY-MM-DD，实际：' + cutoff);
    return 2;
  }
  const violations = [];
  let checked = 0;
  let exempt = 0;
  for (const relPath of LEDGER_FILES) {
    const result = checkLedgerFile(REPO_ROOT, relPath, { cutoff });
    violations.push(...result.violations);
    checked += result.checked;
    exempt += result.exempt;
  }
  if (violations.length > 0) {
    for (const violation of violations) io.error('[ RED ] ' + violation.message);
    io.error('[ RED ] 台账验收字段门禁：' + violations.length + ' 处违规 / 截止日 ' + cutoff);
    return 1;
  }
  io.log('[ OK ] 台账验收字段门禁：' + checked + ' 条在截止日后且全部带 acceptance，'
    + exempt + ' 条历史条目豁免（截止日 ' + cutoff + '）');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
