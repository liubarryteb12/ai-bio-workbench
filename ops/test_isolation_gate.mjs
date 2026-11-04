#!/usr/bin/env node
/**
 * 测试 / 门禁临时目录隔离门禁（第三十四轮 4 Argon Q4 裁定）。
 *
 * 背景：同一类并发互删缺陷连续出现两次，都是「删了自己没创建的共享目录」：
 *   1) BioanalysDesktop/tests/wp33_figure_adapt.test.js 原先把 TMP_TEST_ROOT 写成
 *      path.join(REPO, 'BioanalysDesktop', '.tmp', 'wp33-figure-adapt-tests')（固定共享目录），
 *      test.after 里 fs.rmSync(TMP_TEST_ROOT, { recursive: true }) 把其他实例正在用的目录一起删掉，
 *      全量并行跑时 4 条随机红，单独跑全绿。
 *   2) ops/mutation_gate.mjs 的 freshScope(id) 用固定 .tmp/mutation_gate/<id>，
 *      两个进程互相覆写夹具，同样随机红。
 *
 * Argon 裁定：这类缺陷是团队编码习惯盲区，必须上升为机器静态规则。
 *
 * 判据：扫描 BioanalysDesktop/tests/*.test.js 与 ops/*.mjs，凡出现递归删除
 * （fs.rmSync / fsp.rm / fs.promises.rm 带 { recursive: true }）的文件，
 * 必须出现至少一种「本次运行独有」的隔离标记：
 *   mkdtemp / process.pid / randomUUID / randomBytes / Math.random / Date.now。
 * 判据是文件级的：逐调用点判「目标变量声明里有没有 mkdtemp」会漏掉声明在别处的情况
 * （实测 9 处假阳性里有 5 处），也会把函数参数（dir / scope / outDir）误判成共享目录。
 * 文件级只看「这个文件删东西时有没有能力造独立目录」，能造即认定有自隔离能力。
 * 这正是 wp33 与 mutation_gate 修复后各自具备、旧版不具备的能力。
 *
 * 两类显式豁免（调用方拥有的输出目录，删它就是操作目的，不是共享夹具）：
 *   - ops/build_portable_package.mjs 的 outDir（--out 或 DEFAULT_OUT，构建输出根）
 *   - ops/delivery_acceptance_core.mjs 的 destDir（tar 解包目标，调用方传入）
 * 豁免清单被冻结且逐条写理由；同时要求每条豁免文件当前确实含递归删除，
 * 否则视为清单腐化（文件已重构，豁免该撤了），整道门禁判红。
 *
 * 用法：
 *   node ops/test_isolation_gate.mjs            # 检查，违规 exit 1
 *   node ops/test_isolation_gate.mjs --json     # 机器可读
 */
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const ISOLATION_TOKENS = Object.freeze([
  'mkdtemp', 'process.pid', 'randomUUID', 'randomBytes', 'Math.random', 'Date.now',
]);

/**
 * 调用方拥有的输出目录豁免。加名字进这份清单需要人裁定，不许顺手扩。
 * 每条必须仍然含递归删除，否则清单腐化会被判红。
 */
export const OWNED_OUTPUT_EXEMPTIONS = Object.freeze([
  { file: 'ops/build_portable_package.mjs', reason: 'outDir 是 --out / DEFAULT_OUT 指定的构建输出根，清掉重建就是打包目的' },
  { file: 'ops/delivery_acceptance_core.mjs', reason: 'destDir 是调用方传入的 tar 解包目标，解包前清空是验收流程的既定步骤' },
]);

/** 文件里所有递归删除调用：返回 [{ arg, line }]。 */
export function recursiveRmTargets(text) {
  const out = [];
  const re = /(?:fs\s*\.\s*(?:promises\s*\.\s*)?rmSync|fsp\s*\.\s*rm|fs\s*\.\s*promises\s*\.\s*rm)\s*\(\s*([^,]+?)\s*,\s*\{[^}]*recursive\s*:\s*true/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ arg: m[1].trim(), line: text.slice(0, m.index).split('\n').length });
  }
  return out;
}

/** 纯判据：给一段源码，判断它是否属于「有递归删除但无隔离能力」。可单测。 */
export function judgeSource(text) {
  const calls = recursiveRmTargets(text);
  if (calls.length === 0) return { hasRecursiveRm: false, isolated: true, calls: [] };
  const found = ISOLATION_TOKENS.filter((t) => text.includes(t));
  return { hasRecursiveRm: true, isolated: found.length > 0, tokens: found, calls };
}

export function checkTestIsolation() {
  const listed = cp.execSync('git ls-files BioanalysDesktop/tests/*.test.js ops/*.mjs', { cwd: REPO, encoding: 'utf8' });
  const files = listed.split(/\r?\n/).filter(Boolean);
  const violations = [];
  const staleExemptions = [];
  let scannedFiles = 0;
  let scannedCalls = 0;
  const exemptionFiles = new Set(OWNED_OUTPUT_EXEMPTIONS.map((e) => e.file));
  const stillHasRm = new Set();

  for (const rel of files) {
    const full = path.join(REPO, rel);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, 'utf8');
    const judge = judgeSource(text);
    if (!judge.hasRecursiveRm) continue;
    scannedFiles += 1;
    scannedCalls += judge.calls.length;
    if (exemptionFiles.has(rel)) {
      stillHasRm.add(rel);
      continue;
    }
    if (judge.isolated) continue;
    violations.push({
      file: rel,
      lines: judge.calls.map((c) => c.line),
      args: [...new Set(judge.calls.map((c) => c.arg))],
      reason: '文件有递归删除但没有任何 mkdtemp / pid / 随机 隔离标记',
    });
  }

  for (const e of OWNED_OUTPUT_EXEMPTIONS) {
    if (!stillHasRm.has(e.file)) staleExemptions.push(e.file);
  }

  return { files: files.length, scannedFiles, scannedCalls, violations, staleExemptions };
}

function main() {
  const asJson = process.argv.includes('--json');
  const r = checkTestIsolation();
  const ok = r.violations.length === 0 && r.staleExemptions.length === 0;
  if (asJson) {
    console.log(JSON.stringify({ ok, ...r }, null, 2));
    return ok ? 0 : 1;
  }
  console.log(`临时目录隔离：${r.files} 个候选 / ${r.scannedFiles} 个含递归删除 / ${r.scannedCalls} 处调用，违规 ${r.violations.length} 个文件，腐化豁免 ${r.staleExemptions.length} 条`);
  for (const v of r.violations) {
    console.log(`  [FAIL] ${v.file}:${v.lines.join(',')}  rmSync(${v.args.join(' | ')}, ...)  ${v.reason}`);
  }
  for (const f of r.staleExemptions) {
    console.log(`  [FAIL] 豁免清单腐化：${f} 已不再含递归删除，应撤掉该豁免`);
  }
  console.log(ok ? '临时目录隔离通过' : '临时目录隔离失败');
  return ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}