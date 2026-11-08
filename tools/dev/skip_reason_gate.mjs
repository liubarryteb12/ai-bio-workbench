#!/usr/bin/env node
/**
 * 条件跳过原因白名单门禁（Argon 第二十一轮 Q4 落地，2026-11-03）。
 *
 * 存在的理由：skipped 数随宿主漂移（本机缺 bash / python / anndata 就多几条），
 * 「skipped <= N」这类上限断言挡不住两种坏味道：
 *   1. 裸 .skip() / { skip: true } 把「跑不了」静默伪装成「本机不跑」；
 *   2. 新的环境依赖随手加一条跳过，没有人知道它为什么存在。
 * 本门禁把跳过收紧成封闭白名单：每条跳过必须写明「哪一类宿主能力缺失」或
 * 「哪一类环境不可达」，且标签必须是 ALLOWED_SKIP_REASONS 里的一员。
 * 新增一类跳过 = 改这个枚举 + 在文档里写明理由，等于一次可见的裁定。
 *
 * 两道判据，缺一不可：
 *   静态面  scanTestSources()：扫 tests 下全部 .test.js 的 skip 表达式，常量会展开；
 *   运行时面 checkTapSkips()：解析真实 TAP 的 "# SKIP <reason>"，抓拼接出来的原因。
 *
 * 用法：
 *   node tools/dev/skip_reason_gate.mjs                              # 静态扫描
 *   node tools/dev/skip_reason_gate.mjs --tap-file <tap.txt>         # 解析 TAP 文件
 *   node --test --test-reporter=tap tests/ | node tools/dev/skip_reason_gate.mjs --tap-stdin
 * 退出码：0 全绿，1 有违规。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const DEFAULT_TESTS_DIR = path.join(REPO_ROOT, 'BioanalysDesktop', 'tests');

/** 引号三件套：单引号、双引号、反引号（用码点写，门禁源码自身不含模板串字面量）。 */
const QUOTE_RE = /['"\u0060]/;

/**
 * 白名单枚举。前四条来自 Argon 第二十一轮 Q4 原文；后两条是本轮按既有用例补的
 * 环境类（远端算力不可达、本地项目数据已清理），已在 round22 汇报里标为偏差。
 * 标签只增不减需要人裁定：测试里出现枚举外的前缀，门禁直接判红。
 */
export const ALLOWED_SKIP_REASONS = Object.freeze([
  'HOST_MISSING_BASH',
  'HOST_MISSING_PYTHON',
  'HOST_MISSING_ANNDATA',
  'HOST_MISSING_RSCRIPT',
  'HOST_UNREACHABLE_K40',
  'HOST_MISSING_LOCAL_DATA',
  // 便携包/干净 Windows 机器实测需要的两类：PowerShell 完全缺失、git 完全缺失。
  // 这两项在开发机永远存在，在纯目标机可能整体不存在，属环境形态而非偷懒跳过。
  'HOST_MISSING_SHELL',
  'HOST_MISSING_GIT',
]);

/** 跳过原因必须长这样：<TAG>: <非空说明>。冒号后空字符串不算理由。 */
export const SKIP_REASON_RE = new RegExp(
  '^(?:' + ALLOWED_SKIP_REASONS.join('|') + ')\\s*:\\s*\\S',
);

export function skipReasonIsAllowed(reason) {
  return typeof reason === 'string' && SKIP_REASON_RE.test(reason.trim());
}

/** 解析 TAP 文本里的 "# SKIP <reason>"，返回 [{ line, reason }]（reason 可能为空串）。 */
export function parseTapSkipReasons(tapText) {
  const entries = [];
  const lines = String(tapText ?? '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const match = /# SKIP(?:\s(.*))?$/.exec(lines[i]);
    if (!match) continue;
    entries.push({ line: i + 1, reason: (match[1] ?? '').trim() });
  }
  return entries;
}

/** TAP 面判据：每条真实出现过的跳过原因都必须命中白名单。顺手统计 not ok。 */
export function checkTapSkips(tapText) {
  const text = String(tapText ?? '');
  const entries = parseTapSkipReasons(text);
  const violations = entries
    .filter((entry) => !skipReasonIsAllowed(entry.reason))
    .map((entry) => ({
      line: entry.line,
      reason: entry.reason,
      kind: entry.reason === '' ? 'missing-reason' : 'untagged-reason',
      message: entry.reason === ''
        ? 'TAP 第 ' + entry.line + ' 行：跳过没有原因字符串'
        : 'TAP 第 ' + entry.line + ' 行：跳过原因不在白名单：' + entry.reason,
    }));
  const failures = text.split(/\r?\n/).filter((line) => /^not ok\b/.test(line)).length;
  return { ok: violations.length === 0 && failures === 0, total: entries.length, failures, violations };
}

/**
 * 把源码切成「代码位 / 非代码位」两张表。字符串、模板串、注释里的 skip 字样不算
 * 关键字（测试自身会拿 '{ skip: ... }' 当夹具文本，不遮就会自伤）。
 */
function codeMask(text) {
  const mask = new Uint8Array(text.length);
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (QUOTE_RE.test(ch)) {
      const quote = ch;
      i += 1;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === quote) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    mask[i] = 1;
    i += 1;
  }
  return mask;
}

/** 从 start 起读一个表达式，遇到 depth 0 的停止字符或分号就收尾。 */
function readExpression(text, start, stopChars) {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (QUOTE_RE.test(ch)) {
      const quote = ch;
      i += 1;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === quote) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') { depth += 1; i += 1; continue; }
    if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return text.slice(start, i);
      depth -= 1;
      i += 1;
      continue;
    }
    if (depth === 0 && stopChars.includes(ch)) return text.slice(start, i);
    i += 1;
  }
  return text.slice(start);
}

/** 收集同文件里的单行 const 定义：名字 -> 表达式原文。 */
function constDefinitions(text) {
  const map = new Map();
  const re = /(^|\n)\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const start = match.index + match[0].length;
    const expr = readExpression(text, start, [';', '\n']).trim();
    if (expr && !map.has(match[2])) map.set(match[2], expr);
  }
  return map;
}

/** 把标识符替换成同文件常量表达式（最多四层），字符串里的单词不动。 */
function expandConstants(expr, definitions, depth = 0) {
  if (depth > 3) return expr;
  let out = '';
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (QUOTE_RE.test(ch)) {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < expr.length) {
        out += expr[i];
        if (expr[i] === '\\') { out += expr[i + 1] ?? ''; i += 2; continue; }
        if (expr[i] === quote) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    const ident = /^[A-Za-z_$][\w$]*/.exec(expr.slice(i));
    if (ident && definitions.has(ident[0])) {
      const value = definitions.get(ident[0]);
      out += '(' + expandConstants(value, definitions, depth + 1) + ')';
      i += ident[0].length;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** 抽出表达式里的字符串字面量（引号三种都算）。 */
function stringLiterals(expr) {
  const out = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (QUOTE_RE.test(ch)) {
      const quote = ch;
      let value = '';
      i += 1;
      while (i < expr.length) {
        if (expr[i] === '\\') { value += expr[i + 1] ?? ''; i += 2; continue; }
        if (expr[i] === quote) { i += 1; break; }
        value += expr[i];
        i += 1;
      }
      out.push({ quote, value });
      continue;
    }
    i += 1;
  }
  return out;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

/**
 * 静态面判据：扫一个测试文件的 skip 表达式。
 * 接受两种写法：{ skip: <expr> } 与 t.skip(<expr>) / testContext.skip(<expr>)。
 * <expr> 允许是三元、短路、常量引用；展开常量后必须含白名单标签字面量。
 */
export function scanTestSource(text, file = '<inline>') {
  const mask = codeMask(text);
  const definitions = constDefinitions(text);
  const violations = [];
  const seen = new Set();

  const judge = (exprRaw, index, kind) => {
    const expr = exprRaw.trim();
    const line = lineOf(text, index);
    const key = line + ':' + kind;
    if (seen.has(key)) return;
    seen.add(key);
    if (expr === 'false') return; // 显式「本机可跑」
    if (expr === '' || expr === 'true') {
      violations.push({
        file, line, kind: 'bare-skip', expression: expr,
        message: file + ':' + line + ' 裸跳过（skip: ' + (expr || '<空>') + '），没有写原因',
      });
      return;
    }
    const expanded = expandConstants(expr, definitions);
    const literals = stringLiterals(expanded).map((item) => item.value.trim());
    if (literals.some((value) => skipReasonIsAllowed(value))) return;
    // 纯空字符串字面量（skip: ''）等于没写原因：归到 missing-reason，不冒充 untagged。
    const isEmptyLiteral = literals.length > 0 && literals.every((value) => value === '');
    violations.push({
      file, line, kind: isEmptyLiteral ? 'missing-reason' : 'untagged-reason', expression: expr,
      message: isEmptyLiteral
        ? file + ':' + line + ' 跳过原因是空字符串，没有写原因'
        : file + ':' + line + ' 跳过原因不在白名单：' + (literals.join(' | ') || expr),
    });
  };

  const skipKeyRe = /\bskip\s*:/g;
  let match;
  while ((match = skipKeyRe.exec(text)) !== null) {
    if (!mask[match.index]) continue;
    const start = match.index + match[0].length;
    judge(readExpression(text, start, [',', '}', '\n']), match.index, 'object-option');
  }
  const skipCallRe = /\.\s*skip\s*\(/g;
  while ((match = skipCallRe.exec(text)) !== null) {
    if (!mask[match.index]) continue;
    const start = match.index + match[0].length;
    judge(readExpression(text, start, [')', ',', '\n']), match.index, 'call');
  }
  return violations;
}

/** 扫一批文件：[{ path, text }]。 */
export function scanTestSources(files) {
  const violations = [];
  for (const file of files) violations.push(...scanTestSource(file.text, file.path));
  return violations;
}

function listTestFiles(dir) {
  const out = [];
  const walk = (current) => {
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.tmp' || entry.name === 'dist') continue;
        walk(full);
      } else if (entry.name.endsWith('.test.js') || entry.name.endsWith('.test.mjs')) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out.sort();
}

function printViolations(io, violations) {
  for (const violation of violations) io.error('[ RED ] ' + violation.message);
}

/** CLI 入口；返回退出码（便于单测直接调用，不 spawn）。 */
export function main(argv = process.argv.slice(2), io = { log: console.log, error: console.error }) {
  const arg = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : null;
  };
  if (argv.includes('--tap-file')) {
    const file = arg('--tap-file');
    if (!file || !fs.existsSync(file)) {
      io.error('[ RED ] --tap-file 指向不存在的文件：' + String(file));
      return 1;
    }
    return reportTap(io, fs.readFileSync(file, 'utf8'), file);
  }
  if (argv.includes('--tap-stdin')) {
    return reportTap(io, fs.readFileSync(0, 'utf8'), '<stdin>');
  }
  const testsDir = arg('--tests-dir') || DEFAULT_TESTS_DIR;
  const files = listTestFiles(testsDir).map((full) => ({ path: full, text: fs.readFileSync(full, 'utf8') }));
  const violations = scanTestSources(files);
  if (violations.length > 0) {
    printViolations(io, violations);
    io.error('[ RED ] skip 白名单门禁：' + violations.length + ' 处违规 / ' + files.length + ' 个测试文件');
    return 1;
  }
  io.log('[ OK ] skip 白名单门禁：' + files.length + ' 个测试文件，跳过原因全部命中白名单');
  return 0;
}

function reportTap(io, tapText, label) {
  const result = checkTapSkips(tapText);
  if (result.ok) {
    io.log('[ OK ] TAP skip 白名单（' + label + '）：' + result.total + ' 条跳过全部带白名单原因');
    return 0;
  }
  printViolations(io, result.violations);
  if (result.failures > 0) io.error('[ RED ] TAP 里有 ' + result.failures + ' 条 not ok');
  io.error('[ RED ] TAP skip 白名单（' + label + '）：' + (result.violations.length + result.failures) + ' 处违规');
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
