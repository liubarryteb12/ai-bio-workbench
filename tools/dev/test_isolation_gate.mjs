#!/usr/bin/env node
/**
 * 测试 / 门禁共享资源隔离门禁（第三十四轮 4 Argon Q4 裁定，第三十六轮加固）。
 *
 * 背景：同一类并发互删缺陷反复出现，都是「两个 npm test 进程共用同一份资源」：
 *   1) wp33_figure_adapt.test.js 用固定 .tmp/wp33-figure-adapt-tests，test.after 删整个共享父目录；
 *   2) mutation_gate.mjs 的 freshScope 用固定 .tmp/mutation_gate/<id>，两进程互相覆写夹具；
 *   3) 第三十六轮实测：Lead 与子代理同时跑 npm test，出现 6 条红——
 *      consistency 共用远端 /tmp/bad_ledger_consistency 与 /tmp/03_check_logs_remote.sh；
 *      delivery_audit_ledger 的 tmpRoot 只用 Date.now()；
 *      jsonl_ledger_index 共用 artifacts/.../jsonl_ledger_index_tests 父目录；
 *      sync_upload_blocks_health 固定 BAD_PORT=19099 撞 EADDRINUSE。
 *
 * Argon 裁定：这类缺陷是团队编码习惯盲区，必须上升为机器静态规则。
 *
 * 四类判据（任一命中即判红）：
 *   R1 固定共享根：仓库锚定（REPO / REPO_ROOT / import.meta.dirname / path.resolve）拼出的常量，
 *      没有强隔离标记，**且该常量被递归删除** —— 那正是「删了自己没创建的目录」；
 *   R2 固定远端临时路径：const 是 '/tmp/xxx' 字面量，且被 rm -rf / mkdir -p / bash / scp 使用；
 *   R3 固定端口回退：process.env.*PORT* = ... || '<数字>'（两进程必然撞端口）；
 *   R4 递归删除无强隔离标记：文件有递归删除，但只有 Date.now() 没有 mkdtemp/pid/random。
 *
 * 强隔离标记 = mkdtemp / process.pid / randomUUID / randomBytes / Math.random。
 * Date.now() 刻意**不算**：同毫秒两进程会算出同一个名字，实测就是这么撞的。
 *
 * 豁免清单被冻结且逐条写理由；每条必须仍然含递归删除，否则视为清单腐化判红。
 *
 * 用法：
 *   node tools/dev/test_isolation_gate.mjs            # 检查，违规 exit 1
 *   node tools/dev/test_isolation_gate.mjs --json     # 机器可读
 */
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 强隔离标记：能在并发进程间产生不同结果。Date.now() 不在其中（同毫秒会撞）。 */
export const STRONG_TOKENS = Object.freeze([
  'mkdtemp', 'process.pid', 'randomUUID', 'randomBytes', 'Math.random',
]);

/** 弱标记：只是时间戳，同毫秒并发会算出同一路径。单独出现不算隔离。 */
export const WEAK_TOKENS = Object.freeze(['Date.now']);

/** 兼容旧名（既有契约测试引用 ISOLATION_TOKENS）。 */
export const ISOLATION_TOKENS = Object.freeze([...STRONG_TOKENS, ...WEAK_TOKENS]);

/** R1 认的「仓库锚点」：拼出来的路径必然是仓库内共享位置。 */
export const REPO_ANCHORS = Object.freeze(['REPO_ROOT', 'REPO', 'import.meta.dirname', 'path.resolve']);

/**
 * 门禁自身的夹具测试：里面的「违规源码」是字符串字面量，是被测输入而不是真代码。
 * 只放这一份，加别的文件名需人裁定。
 */
export const SELF_FIXTURE_FILES = Object.freeze([
  'BioanalysDesktop/tests/test_isolation_gate.test.js',
]);

/**
 * 调用方拥有的删除目标豁免。加名字进这份清单需要人裁定，不许顺手扩。
 * 每条必须仍然含递归删除，否则清单腐化会被判红。
 */
export const OWNED_OUTPUT_EXEMPTIONS = Object.freeze([
  { file: 'tools/dev/build_portable_package.mjs', reason: 'outDir 是 --out / DEFAULT_OUT 指定的构建输出根，清掉重建就是打包目的' },
  { file: 'tools/reporting/delivery_acceptance_core.mjs', reason: 'destDir 是调用方传入的 tar 解包目标，解包前清空是验收流程的既定步骤' },
  { file: 'tools/dev/clean_workspace.mjs', reason: '清理工具本身就是「删用户指定目标」，目标由 --execute 参数决定而非夹具' },
  { file: 'tools/dev/clean_tmp_cache.mjs', reason: 'Q4 缓存清理器：默认 dry-run，只有显式 --apply 才删 .tmp/ 下按 mtime 筛出的陈旧条目，作用域锁死且白名单保护，不碰任何测试夹具' },
]);

/**
 * 只丢「整行注释」，保留代码与字符串字面量（R1/R2 需要看字面量内容）。
 *
 * 刻意不用块注释正则 /\*[\s\S]*?\*\/：实测 build_portable_package.mjs 的模板字符串里
 * 含有 /* 片段，非贪婪匹配会从那里一路吃到文件末尾，把真正的 rmSync 一起抹掉，
 * 结果是「豁免被误判成腐化」。逐行判定没有这个跨行风险。
 */
export function stripComments(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');
}

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

/** 任意 const 声明（单行）：name -> { init, line }。 */
export function constDeclarations(text) {
  const out = new Map();
  const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+);/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.set(m[1], { init: m[2].trim(), line: text.slice(0, m.index).split('\n').length });
  }
  return out;
}

/** 纯判据：给一段源码，返回该文件命中的全部违规类别。可单测。 */
export function judgeSource(text) {
  const code = stripComments(text);
  const calls = recursiveRmTargets(code);
  const consts = constDeclarations(code);
  const violations = [];
  const strongFound = STRONG_TOKENS.filter((t) => code.includes(t));
  const weakFound = WEAK_TOKENS.filter((t) => code.includes(t));

  // R1：仓库锚定常量，无强隔离标记，且被递归删除
  for (const [name, decl] of consts) {
    if (STRONG_TOKENS.some((t) => decl.init.includes(t))) continue;
    if (!REPO_ANCHORS.some((a) => decl.init.includes(a))) continue;
    if (!/path\.(?:join|resolve)/.test(decl.init)) continue;
    const deleted = calls.some((c) => c.arg === name);
    if (deleted) {
      violations.push({ rule: 'R1 固定共享根被递归删除', line: decl.line, detail: name + ' = ' + decl.init.slice(0, 140) });
    }
  }

  // R2：固定远端 /tmp 字面量常量 + 被远端破坏性命令使用
  for (const [name, decl] of consts) {
    const isTmpLiteral = /^'\/tmp\/[^']*'$/.test(decl.init) || /^"\/tmp\/[^"]*"$/.test(decl.init);
    if (!isTmpLiteral) continue;
    const esc = name.replace(/\$/g, '\\$');
    const usedRemote = new RegExp('(?:rm\\s+-rf\\s+|mkdir\\s+-p\\s+|bash\\s+|:[^;\n]*|k40[^\\s]*:)[^;\n]*\\b' + esc + '\\b').test(code);
    if (usedRemote) violations.push({ rule: 'R2 固定远端临时路径', line: decl.line, detail: name + ' = ' + decl.init });
  }

  // R3：固定端口回退
  const portRe = /process\.env\.(\w*PORT\w*)\s*=\s*[^;\n]*\|\|\s*['"]?(\d{4,5})['"]?/g;
  let pm;
  while ((pm = portRe.exec(code)) !== null) {
    violations.push({ rule: 'R3 固定端口回退', line: code.slice(0, pm.index).split('\n').length, detail: pm[1] + ' || ' + pm[2] });
  }

  // R4：有递归删除但缺强隔离标记
  if (calls.length > 0 && strongFound.length === 0) {
    violations.push({
      rule: 'R4 递归删除无强隔离标记',
      line: calls[0].line,
      detail: weakFound.length ? '只有 Date.now()（同毫秒会撞）' : '无任何隔离标记',
    });
  }

  return { hasRecursiveRm: calls.length > 0, isolated: violations.length === 0, strongTokens: strongFound, weakTokens: weakFound, violations, calls };
}

export function checkTestIsolation() {
  const listed = cp.execSync('git ls-files BioanalysDesktop/tests/*.test.js ops/*.mjs tools/dev/*.mjs tools/dev/lib/*.mjs tools/reporting/*.mjs', { cwd: REPO, encoding: 'utf8' });
  const files = listed.split(/\r?\n/).filter(Boolean);
  const violations = [];
  const staleExemptions = [];
  let scannedFiles = 0;
  let scannedCalls = 0;
  const exemptionFiles = new Set(OWNED_OUTPUT_EXEMPTIONS.map((e) => e.file));
  const selfFixtureFiles = new Set(SELF_FIXTURE_FILES);
  const stillHasRm = new Set();

  for (const rel of files) {
    const full = path.join(REPO, rel);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, 'utf8');
    const judge = judgeSource(text);
    if (judge.hasRecursiveRm) {
      scannedFiles += 1;
      scannedCalls += judge.calls.length;
    }
    if (selfFixtureFiles.has(rel)) continue;
    if (exemptionFiles.has(rel)) {
      if (judge.hasRecursiveRm) stillHasRm.add(rel);
      continue;
    }
    if (judge.violations.length === 0) continue;
    for (const v of judge.violations) violations.push({ file: rel, rule: v.rule, line: v.line, detail: v.detail });
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
  console.log(`共享资源隔离：${r.files} 个候选 / ${r.scannedFiles} 个含递归删除 / ${r.scannedCalls} 处调用，违规 ${r.violations.length} 条，腐化豁免 ${r.staleExemptions.length} 条`);
  for (const v of r.violations) console.log(`  [FAIL] ${v.file}:${v.line}  ${v.rule}  ${v.detail}`);
  for (const f of r.staleExemptions) console.log(`  [FAIL] 豁免清单腐化：${f} 已不再含递归删除，应撤掉该豁免`);
  console.log(ok ? '共享资源隔离通过' : '共享资源隔离失败');
  return ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
