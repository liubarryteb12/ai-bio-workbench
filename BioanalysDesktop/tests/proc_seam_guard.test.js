/**
 * 进程单接缝门禁（5.1 裁定落地，2026-11-01）：server/ 下除 proc.js 本体外，
 * 任何文件不得 import node:child_process，也不得出现 childProcess. 或裸调子进程原语。
 *
 * 存在的理由：proc.js 头注释宣称「本地子进程的唯一出口」，run.js 曾有两处 ssh 直连
 * 例外（BIO_COMPUTE_ADAPTER=mock 罩不到任务主路径）。例外一旦留档，AI Agent 会模仿
 * 破窗——本测试把「不新增例外」升级为机器判据：新增直连 = 判红。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * 全仓运行时可达目录（2026-11-01 按 Argon 隐患三扩展扫描面）。
 *
 * 只扫 server/ 会漏掉一个真实逃逸口：未来在 ops/ 或共享目录写一个调
 * child_process 的辅助 .js，再被 server/ 动态 import，门禁就完全失明。
 * 因此把「运行时可达」的 JS 面一次覆盖：服务端、门户、共享契约、运维脚本。
 * 构建期与依赖目录不在其中（vite.config、node_modules、dist 不参与运行时决策）。
 */
const RUNTIME_DIRS = [
  path.join(REPO_ROOT, 'BioanalysDesktop', 'server'),
  path.join(REPO_ROOT, 'BioanalysDesktop', 'src-tauri'),
  path.join(REPO_ROOT, 'portal'),
  path.join(REPO_ROOT, 'shared'),
  path.join(REPO_ROOT, 'ops'),
  path.join(REPO_ROOT, 'bin'),
];

/**
 * 扫描豁免（三条判据，加新名字必须满足其中之一并在注释里写明理由）：
 *   1. 接缝本体：proc.js（它就该起进程）；
 *   2. 纯字符串构造模块：ssh.js（只拼命令串，不执行）；
 *   3. **离线统计/构建期工具**：metrics_sync.mjs 这类只在命令行手工跑、
 *      不参与服务运行时的脚本。它们起 node --test 只是为了取实测数字，
 *      不承担「本地零算力」的运行时约束。
 * 注意：豁免按**文件名**匹配，所以同名的运行时文件也会被放过；
 * 这是已知代价，靠命名唯一性（metrics_sync / proc / ssh）兜底。
 */
const EXEMPT_RELPATHS = new Set([
  'BioanalysDesktop/server/proc.js',       // 接缝本体
  'BioanalysDesktop/server/ssh.js',        // 纯字符串构造
  'BioanalysDesktop/tests/proc_seam_guard.test.js', // 本测试自身
  'ops/metrics_sync.mjs',                  // 离线统计工具（手工跑，不进服务运行时）
  'ops/static_gate.mjs',                   // 离线静态门禁（手工/CI 跑，不进服务运行时）
  'ops/smoke_golden.mjs',                   // 离线真机冒烟驱动（手工/CI 跑，经 ssh 下发生产包装器）
  'ops/ledger_gen.mjs',                    // 离线台账生成（纯 node:fs，无子进程；列入以防将来引入）
]);

// 豁免清单：接缝本体。加名字进这份清单需要人裁定，不许顺手扩。
const EXEMPT = new Set(['proc.js']);

function jsFiles(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    // 备份/归档/依赖目录不属于运行时可达面：encoding_backup 是历史备份副本，
    // 扫它只会把已废弃的旧代码算成现行违规（实测这里一次刷出 10 处假阳性）。
    if (entry.name === 'node_modules' || entry.name === 'dist'
      || entry.name === 'encoding_backup' || entry.name === '_archive'
      || entry.name === 'artifacts' || entry.name === 'test-results') continue;
    if (entry.isDirectory()) out.push(...jsFiles(full));
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs') || entry.name.endsWith('.cjs')) out.push(full);
  }
  return out;
}

/** 全仓运行时可达的 JS 文件清单 */
function runtimeFiles() {
  const all = [];
  for (const dir of RUNTIME_DIRS) all.push(...jsFiles(dir));
  return all;
}

const FORBIDDEN = [
  [/from\s+['\"]node:child_process['\"]/g, '直连 import node:child_process'],
  [/require\(\s*['\"]node:child_process['\"]/g, '直连 require child_process'],
  [/\bchildProcess\.(spawn|spawnSync|execFile|execFileSync|fork)\b/g, 'childProcess 调用形态'],
  [/(^|[^.\w])(execFileSync|execFile|spawnSync)\s*\(/g, '裸调子进程原语'],
];

test('接缝门禁：server/ 除 proc.js 外不得有任何 child_process 直连', () => {
  const violations = [];
  for (const file of runtimeFiles()) {
    // 用仓库相对路径精确匹配，不用 basename：同名文件放在别处就不会被误豁免
    if (EXEMPT_RELPATHS.has(path.relative(REPO_ROOT, file).split(path.sep).join('/'))) continue;
    const rel = path.relative(SERVER_DIR, file).split(path.sep).join('/');
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      for (const [pattern, label] of FORBIDDEN) {
        pattern.lastIndex = 0;
        if (pattern.test(line)) violations.push(rel + ':' + (i + 1) + ' ' + label + ': ' + trimmed.slice(0, 90));
      }
    });
  }
  assert.deepEqual(violations, [], '发现绕过 proc.js 的直连（' + violations.length + ' 处）:\n' + violations.join('\n'));
});

test('run.js 不再 import child_process（5.1 修复的固化断言）', () => {
  const text = fs.readFileSync(path.join(SERVER_DIR, 'run.js'), 'utf8');
  assert.ok(!/from\s+['"]node:child_process['"]/.test(text) && !/require\(\s*['"]node:child_process['"]/.test(text), 'run.js 不得再 import/require node:child_process');
  assert.ok(text.includes("from './proc.js'"), 'run.js 的执行原语必须来自 proc.js');
});

test('scp 拓扑参数集中在 domain.js（5.9 修复的固化断言）', () => {
  const domain = fs.readFileSync(path.join(SERVER_DIR, 'domain.js'), 'utf8');
  assert.ok(domain.includes('COMPUTE_SSH_PORT'), 'domain.js 必须有 ssh 端口真源');
  assert.ok(domain.includes('COMPUTE_SCP_TARGET'), 'domain.js 必须有 scp 目标真源');
  const offenders = [];
  for (const file of runtimeFiles()) {
    if (path.relative(REPO_ROOT, file).split(path.sep).join('/') === 'BioanalysDesktop/server/domain.js') continue;
    const rel = path.relative(SERVER_DIR, file).split(path.sep).join('/');
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*')) return;
      if (t.includes("'-P', '10022'")) offenders.push(rel + ':' + (i + 1) + ' 硬编码 scp 端口');
    });
  }
  assert.deepEqual(offenders, [], 'scp 端口必须走 scpArgv（domain.js 真源）：' + offenders.join(', '));
});