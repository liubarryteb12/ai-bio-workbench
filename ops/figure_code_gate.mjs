#!/usr/bin/env node
/**
 * figure_code_gate.mjs —— 出图源码规范门禁（Argon 第 75/76 轮，第 20 道）。
 *
 * 与 Gate 14（figure_spec_gate.mjs 读产出 PNG pHYs 判 300 DPI）职责正交：
 * 本门禁查源码级规范（cn_debug/figure_code_audit.py 的 C1-C14），关注点分离。
 *
 * 硬阻断集（blocking>0 即 Exit 1）：C1-C8（含 C4 字号零容忍）+ C12/C13/C14。
 * 校准集（C9/C10/C11）只报告不阻断（--report-only 下轮转正）。
 * Fail-Closed：审计器崩溃/ python 缺失一律 Exit 1，绝不静默放行。
 *
 * 用法：
 *   node ops/figure_code_gate.mjs            # 校验，blocking>0 退出 1
 *   node ops/figure_code_gate.mjs --json     # 机器可读
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

export const BLOCKING_KINDS = Object.freeze(new Set([
  'C1_LEGEND_INSIDE', 'C2_BAD_BACKEND', 'C3_LOW_DPI', 'C4_TINY_FONT',
  'C4_TINY_CEX', 'C4_RCPARAMS_FONT', 'C5_WRONG_DIR', 'C6_PDF_OUT',
  'C8_NO_RES', 'C9_NO_DPI', 'C12_BINARY_COLOR', 'C13_NO_CLOSE', 'C14_BACKEND_ORDER',
  'C15_LEGEND_BOTTOM',
]));
export const REPORT_KINDS = Object.freeze(new Set([
  'C9_CAPTION_POS', 'C10_LEGEND_LAYOUT', 'C11_KO_CAPTION',
]));

/**
 * 调用源码审计器并分类汇总。零仓库副作用（CSV 落进程隔离临时目录，REJ-010）。
 * @param {string} repoRoot
 * @returns {{ok:boolean, blocking:number, report:number, byKind:object, errors:string[]}}
 */
export function checkFigureCode(repoRoot = REPO) {
  const auditScript = path.join(repoRoot, 'cn_debug', 'figure_code_audit.py');
  const errors = [];
  if (!fs.existsSync(auditScript)) {
    return { ok: false, blocking: 0, report: 0, byKind: {}, errors: [`审计器缺失: ${auditScript}`] };
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `figcode-${process.pid}-`));
  const csvPath = path.join(tmpDir, 'audit.csv');
  let proc;
  try {
    proc = spawnSync('python', [auditScript, '--root', path.join(repoRoot, 'tools', 'bio'), '--csv', csvPath], {
      cwd: repoRoot, encoding: 'utf8', timeout: 60000,
    });
  } catch (cause) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return { ok: false, blocking: 0, report: 0, byKind: {}, errors: [`审计器执行异常: ${cause.message}`] };
  }
  // Fail-Closed：python 启动失败（ENOENT 等）或信号终止一律判失败。
  if (proc.error || proc.status === null) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return { ok: false, blocking: 0, report: 0, byKind: {}, errors: [`审计器无法运行: ${proc.error?.message || '信号终止'}`] };
  }
  const byKind = {};
  let blocking = 0;
  let report = 0;
  if (fs.existsSync(csvPath)) {
    const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).slice(1).filter(Boolean);
    for (const line of lines) {
      const kind = line.split(',')[0].replace(/^"|"$/g, '');
      byKind[kind] = (byKind[kind] || 0) + 1;
      if (BLOCKING_KINDS.has(kind)) blocking += 1;
      else if (REPORT_KINDS.has(kind)) report += 1;
    }
  } else if (proc.status !== 0) {
    // 审计器非零退出却无 CSV：视为执行异常，Fail-Closed。
    errors.push(`审计器退出码 ${proc.status} 且无 CSV 产出`);
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  const ok = errors.length === 0 && blocking === 0;
  return { ok, blocking, report, byKind, errors };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const asJson = process.argv.includes('--json');
  const result = checkFigureCode(REPO);
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }
  if (result.errors.length) {
    console.error('FIGURE_CODE_GATE_FAIL 审计执行异常（Fail-Closed）：');
    for (const e of result.errors) console.error('  - ' + e);
    process.exit(1);
  }
  const blockingKinds = Object.entries(result.byKind).filter(([k]) => BLOCKING_KINDS.has(k));
  if (blockingKinds.length) {
    console.error('FIGURE_CODE_GATE_FAIL 硬阻断违规：');
    for (const [kind, count] of blockingKinds) console.error(`  - ${kind}: ${count} 处`);
  }
  const reportKinds = Object.entries(result.byKind).filter(([k]) => REPORT_KINDS.has(k));
  if (reportKinds.length) {
    console.log('[INFO] 校准集（不阻断）：' + reportKinds.map(([k, c]) => `${k}=${c}`).join(' '));
  }
  if (result.ok) {
    console.log(`FIGURE_CODE_GATE_OK blocking=0 report=${result.report}（出图源码规范合规）`);
    process.exit(0);
  }
  process.exit(1);
}
