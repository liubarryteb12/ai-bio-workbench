#!/usr/bin/env node
/**
 * 单命令总门禁（4 Argon 第二十四轮 Q4/Q6【立即做】）。
 *
 * 存在的理由：八道门禁此前散在各处，封板前要记八条命令、看八份输出。
 * 这里把它们串成一条命令，本地与私有 CI 行为 100% 同构：
 * 任何一道红即整体红，并明确点名是第几道、什么原因。
 *
 * 顺序按「越便宜越靠前」排（fail fast）：
 *   1. preflight            宿主机依赖（毫秒级，缺依赖后面全白跑）
 *   2. static_gate          静态语言门禁（2 秒）
 *   3. skip_reason_gate     跳过原因白名单静态面（毫秒级）
 *   4. ledger_gen --check   台账与真源字节级一致
 *   5. build_figure_templates --check  图件注册表与 CSV/r453 证据同步
 *   6. audit_summary        交付审计流可解析（只读）
 *   7. metrics_sync --check 全量测试 + 运行时 skip 核验 + 基线一致（最慢，约 90 秒）
 *
 * 刻意不含的两项（各有专门入口，不塞进封板门禁）：
 *   - 交付验收 npm run delivery:verify（要具体 tar 路径，不是仓库级门禁）
 *   - 工作区清理 npm run clean:workspace（破坏性动作，绝不能被门禁顺带触发）
 *
 * 用法：
 *   npm run gate:all          # 全量（约 100~150 秒）
 *   node ops/run_all_gates.mjs --skip-tests   # 跳过第七道（快速自检，约 5 秒）
 *   node ops/run_all_gates.mjs --json         # 机器读
 * 退出码：0 全绿，1 有红，2 参数错误。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..');

/**
 * 门禁清单。args 是相对仓库根的脚本参数；cwd 决定在哪个目录跑（metrics/build 要进子目录）。
 * slow 标记用于 --skip-tests 时跳过最耗时的一道。
 */
export const GATES = Object.freeze([
  { id: 'preflight', label: '宿主机依赖预检', exec: 'node', args: ['ops/preflight.mjs'], cwd: '.', slow: false },
  // static_gate 默认「缺工具即失败」。开发机长期没有 Rscript（16 个 .R 母版本轮未查），
  // 那边显式降级为警告：降级清单与 [SKIP] 行仍逐条打印，gate:all 的 tail 里看得到「本机少验了 16 个」。
  // CI runner 装齐 pwsh7 / r-base 后走 strict 路径（不带本参数）。
  { id: 'static_gate', label: '静态语言门禁', exec: 'node', args: ['ops/static_gate.mjs', '--allow-missing'], cwd: '.', slow: false },
  { id: 'skip_static', label: '跳过原因白名单（静态面）', exec: 'node', args: ['ops/skip_reason_gate.mjs'], cwd: '.', slow: false },
  { id: 'ledger', label: '台账与真源一致', exec: 'node', args: ['ops/ledger_gen.mjs', '--check'], cwd: '.', slow: false },
  { id: 'figure_registry', label: '图件注册表与证据同步', exec: 'node', args: ['ops/build_figure_templates.cjs', '--check'], cwd: '.', slow: false },
  { id: 'audit_summary', label: '交付审计流可解析', exec: 'node', args: ['ops/audit_summary.mjs'], cwd: '.', slow: false },
  // 第 8 道：变异门禁（T2-6）。它证明的不是「代码对不对」，而是「门禁会不会红」：
  // 对 7 条关键防线各注入一次真实破坏，任一条没让对应判据变红即整道失败。
  // 变异只在 .tmp/mutation_gate/ 的临时副本上做，不碰工作树（并发安全）。
  { id: 'mutation_gate', label: '变异门禁（7 条防线反证）', exec: 'node', args: ['ops/mutation_gate.mjs'], cwd: '.', slow: false },
  { id: 'metrics', label: '全量测试 + 运行时 skip + 基线一致', exec: 'node', args: ['ops/metrics_sync.mjs', '--check'], cwd: '.', slow: true },
]);

/** 取子进程环境的保底：Windows 原生 ssh 缺 SystemRoot 会静默 255（proc.js 同款教训）。 */
function gateEnv(extra = {}) {
  const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  return { ...process.env, SystemRoot: systemRoot, windir: process.env.windir || systemRoot, ...extra };
}

/**
 * 跑一道门禁。返回 { id, ok, exitCode, seconds, tail }。
 * tail 只留最后几行：门禁红时最重要的是「哪一句红」，不是整篇日志。
 */
export function runGate(gate, { repoRoot = REPO_ROOT, env = gateEnv(), timeoutMs = 300000 } = {}) {
  const started = Date.now();
  const result = spawnSync(gate.exec, gate.args, {
    cwd: path.join(repoRoot, gate.cwd),
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env,
    windowsHide: true,
  });
  const combined = ((result.stdout || '') + (result.stderr || '')).trim();
  const lines = combined.split(/\r?\n/);
  return {
    id: gate.id,
    label: gate.label,
    ok: result.status === 0,
    exitCode: result.status,
    seconds: (Date.now() - started) / 1000,
    tail: lines.slice(-8),
  };
}

export function runAllGates({ repoRoot = REPO_ROOT, skipSlow = false, env = gateEnv(), gates = GATES } = {}) {
  const results = [];
  for (const gate of gates) {
    if (skipSlow && gate.slow) { results.push({ id: gate.id, label: gate.label, skipped: true }); continue; }
    results.push(runGate(gate, { repoRoot, env }));
  }
  const failed = results.filter((r) => r.skipped !== true && r.ok === false);
  return { ok: failed.length === 0, results, failed };
}

export function main(argv = process.argv.slice(2), io = { log: console.log, error: console.error }) {
  const skipSlow = argv.includes('--skip-tests');
  const asJson = argv.includes('--json');
  if (!fs.existsSync(path.join(REPO_ROOT, 'ops'))) {
    io.error('不在仓库根（缺 ops/），拒绝猜测路径');
    return 2;
  }
  const total = Date.now();
  const outcome = runAllGates({ skipSlow, env: process.env });
  const elapsed = ((Date.now() - total) / 1000).toFixed(0);
  if (asJson) {
    io.log(JSON.stringify({
      ok: outcome.ok,
      elapsed_seconds: Number(elapsed),
      gates: outcome.results.map((r) => ({
        id: r.id, label: r.label,
        status: r.skipped ? 'skipped' : (r.ok ? 'pass' : 'fail'),
        seconds: r.skipped ? 0 : Number(r.seconds.toFixed(2)),
        exit_code: r.skipped ? null : r.exitCode,
      })),
      failed: outcome.failed.map((r) => r.id),
    }, null, 2));
    return outcome.ok ? 0 : 1;
  }
  io.log('总门禁（' + outcome.results.length + ' 道串联，越便宜越靠前）');
  for (let i = 0; i < outcome.results.length; i += 1) {
    const r = outcome.results[i];
    const tag = r.skipped ? '[SKIP]' : (r.ok ? '[ OK ]' : '[ RED]');
    io.log(tag + ' ' + (i + 1) + '. ' + r.label + (r.skipped ? '' : '（' + r.seconds.toFixed(1) + 's）'));
    if (r.skipped) { io.log('       → --skip-tests 跳过（含全量测试，日常快检用）'); continue; }
    if (!r.ok) {
      for (const line of r.tail) io.log('       ' + line);
    }
  }
  if (outcome.ok) {
    io.log('');
    io.log('GATE_ALL_OK ' + outcome.results.length + ' 道全绿（' + elapsed + ' 秒）');
    return 0;
  }
  io.log('');
  io.error('GATE_ALL_FAILED ' + outcome.failed.length + ' 道红：' + outcome.failed.map((r) => r.id).join(', '));
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
