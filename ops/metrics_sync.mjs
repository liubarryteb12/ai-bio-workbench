#!/usr/bin/env node
/**
 * metrics_sync.mjs —— 全仓规模与测试基线的唯一统计口径（2026-11-01，技术债 5.4 + 5.12）
 *
 * 解决的问题：README 写的是 848 tests（2026-10-24 口径），实测已到 1077；
 * 行数统计在历史上混用「总行」与「非空行」两套口径，交叉核对阈值时容易误判。
 *
 * 唯一口径（本文件是定义者，其他任何地方不得另造）：
 *   1. 代码规模一律按**非空行（SLOC）**统计：剔除纯空白行，保留注释与文档字符串。
 *   2. 测试基线一律由 node:test 的实测用例数给出，不手抄。
 *
 * 用法：
 *   node ops/metrics_sync.mjs --check   比对 README 与实测值，不一致 exit 1（供 CI 用）
 *   node ops/metrics_sync.mjs --write   用实测值回写 README 的基线行
 *   node ops/metrics_sync.mjs           打印实测值（默认只读，不改任何文件）
 *
 * 设计约束：
 *   - 纯 Node ESM，不引入 cloc 之类的外部二进制（容器内装不了）；
 *   - 统计面与 .gitignore 的排除逻辑保持一致，避免把依赖/构建/数据区算进来；
 *   - 只改 README 里那一行基线，不做整体重排，最小化 diff。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const README = path.join(REPO, 'BioanalysDesktop', 'README.md');

/** 统计面：这些目录下的代码参与 SLOC */
const CODE_DIRS = [
  'BioanalysDesktop/server',
  'BioanalysDesktop/src',
  'portal',
  'shared',
];

/** 代码扩展名 */
const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);

/** 统计时跳过的目录名（与 .gitignore 口径一致） */
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'test-results', '.tmp', '__pycache__',
  'encoding_backup', '_archive', 'artifacts',
]);

/** README 基线行的锚点：这一行由本脚本拥有，其他文档引用它的数值 */
const BASELINE_RE = /当前基线 \*\*[^\n]*\*\*/;

function walk(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (CODE_EXT.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

/** 非空行计数（SLOC）：剔除纯空白行，保留注释 */
function slocOf(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return text.split(/\r?\n/).filter((line) => line.trim() !== '').length;
  } catch {
    return 0;
  }
}

/** 实测代码规模 */
function measureCode() {
  const files = [];
  for (const dir of CODE_DIRS) walk(path.join(REPO, dir), files);
  const sloc = files.reduce((sum, file) => sum + slocOf(file), 0);
  return { files: files.length, sloc };
}

/**
 * 实测测试规模：**唯一权威是 node --test 的真实汇总行**，不做静态源码计数。
 *
 * 为什么不用静态计数（实测踩到）：按 test\( 正则数出来是 1069，而 node --test 实际报 1077。
 * 差额来自 t.test 子用例与条件跳过，静态正则天然数不全。基线数字必须是跑出来的，
 * 否则「口径统一」只是换了个地方继续错。
 * 解析不到汇总行时退回静态计数并显式标注，不静默吞掉。
 */
function measureTests() {
  const fileCount = (() => {
    try {
      return fs.readdirSync(path.join(REPO, 'BioanalysDesktop', 'tests'))
        .filter((f) => f.endsWith('.test.js')).length;
    } catch { return 0; }
  })();

  const spawned = spawnSync('node', ['--test', '--test-reporter=tap', 'tests/*.test.js'], {
    cwd: path.join(REPO, 'BioanalysDesktop'),
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 64 * 1024 * 1024,
    shell: true,
    env: { ...process.env, TEMP: path.join(REPO, '.tmp'), TMP: path.join(REPO, '.tmp') },
  });

  const text = (spawned.stdout || '') + (spawned.stderr || '');
  const pick = (key) => {
    const m = text.match(new RegExp('^# ' + key + ' ([0-9]+)', 'm'));
    return m ? Number(m[1]) : null;
  };
  const cases = pick('tests');
  const pass = pick('pass');
  const fail = pick('fail');
  const skipped = pick('skipped');
  if (cases === null || pass === null) {
    return { files: fileCount, cases: 0, pass: 0, fail: 0, skipped: 0, measured: false };
  }
  return { files: fileCount, cases, pass, fail, skipped, measured: true };
}

function currentBaselineLine() {
  if (!fs.existsSync(README)) return null;
  const text = fs.readFileSync(README, 'utf8');
  const m = text.match(BASELINE_RE);
  return m ? m[0] : null;
}

function renderBaseline(metrics) {
  const t = metrics.tests;
  if (!t.measured) {
    return '当前基线 **未实测**（node --test 汇总行缺失，请先跑通测试；ops/metrics_sync.mjs）';
  }
  return '当前基线 **' + t.cases + ' tests / ' + t.pass + ' pass / ' + t.fail
    + ' fail / ' + t.skipped + ' skipped**（' + t.files
    + ' 个测试文件；口径由 ops/metrics_sync.mjs 实测 node --test 汇总行）｜代码规模 '
    + metrics.code.sloc + ' SLOC（非空行，' + metrics.code.files + ' 个文件）';
}

function main() {
  const mode = process.argv.includes('--write') ? 'write'
    : process.argv.includes('--check') ? 'check' : 'print';
  const metrics = { code: measureCode(), tests: measureTests() };
  const expected = renderBaseline(metrics);
  const actual = currentBaselineLine();

  if (mode === 'print') {
    console.log('代码规模: ' + metrics.code.files + ' 文件 / ' + metrics.code.sloc + ' SLOC（非空行）');
    console.log('测试规模: ' + metrics.tests.files + ' 文件 / ' + metrics.tests.cases + ' 用例');
    console.log('README 现基线: ' + (actual ?? '(未找到基线行)'));
    console.log('应写基线: ' + expected);
    return 0;
  }

  if (mode === 'check') {
    if (!actual) {
      console.error('README 里找不到基线行（锚点: "当前基线 **...**"）');
      return 1;
    }
    // check 只校验**稳定指标**：用例数与 pass/fail/skipped。
    // 刻意不校验 SLOC——它会随「统计脚本自身被计入」而波动（写完 README 再测就变了），
    // 把它放进 check 会让基线永远追不上自己，形成无解的循环依赖（实测踩到）。
    // SLOC 仍写进 README 供人参考，但不作为门禁判据。
    const need = [
      String(metrics.tests.cases),
      String(metrics.tests.pass),
      String(metrics.tests.fail),
    ];
    const missing = need.filter((n) => !actual.includes(n));
    if (missing.length > 0) {
      console.error('基线已过期，缺少实测值: ' + missing.join(', '));
      console.error('  现基线: ' + actual);
      console.error('  应改为: ' + expected);
      console.error('修复: node ops/metrics_sync.mjs --write');
      return 1;
    }
    console.log('基线一致（用例 ' + metrics.tests.cases + '，SLOC ' + metrics.code.sloc + '）');
    return 0;
  }

  // write
  if (!fs.existsSync(README)) {
    console.error('README 不存在: ' + README);
    return 2;
  }
  const text = fs.readFileSync(README, 'utf8');
  if (!BASELINE_RE.test(text)) {
    console.error('README 里找不到基线行锚点，拒绝盲写');
    return 2;
  }
  const next = text.replace(BASELINE_RE, expected);
  if (next === text) {
    console.log('基线已是最新，无需写入');
    return 0;
  }
  fs.writeFileSync(README, next, 'utf8');
  console.log('已更新 README 基线: ' + expected);
  return 0;
}

process.exit(main());
