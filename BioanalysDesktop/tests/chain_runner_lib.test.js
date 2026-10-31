/**
 * cn_debug/lib/chain_runner.mjs 的回归守卫。
 *
 * 背景（第十二轮待办 4）：line1/line2/line3 三份 runner 各自实现了一遍 ssh、台账定位、
 * 输入预检，P-25/P-26 两条踩坑只修在某一两份里，另一两份还是旧写法——重复实现等于
 * 让修复只覆盖一部分。本轮把机制收口到 lib，runner 只留步骤表。
 * 本文件钉住三件事，防止再次分叉：
 *   1. 三份 runner 必须 import 公共库，不得再自带 ssh / 台账定位实现；
 *   2. 公共库自身必须满足 P-23/P-24/P-25/P-26 的口径（这些是踩坑台账的永久修复）；
 *   3. 台账正则必须能区分 enrichment 与 enrichment_figures（P-25 的原始触发器）。
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const LIB = path.join(REPO, 'cn_debug', 'lib', 'chain_runner.mjs');
const LIB_TEXT = fs.readFileSync(LIB, 'utf8');

const RUNNERS = [
  'cn_debug/2026-10-21_m1_line1_chain.mjs',
  'cn_debug/2026-10-21_m1_line2_chain.mjs',
  'cn_debug/2026-10-21_m1_line3_chain.mjs',
  'cn_debug/2026-10-22_m1_line2_rest.mjs',
];

test('三份 runner 都从公共库取机制，不得自带 ssh / 台账定位', () => {
  for (const rel of RUNNERS) {
    const text = fs.readFileSync(path.join(REPO, rel), 'utf8');
    assert.match(text, /from '\.\/lib\/chain_runner\.mjs'/, rel + ' 必须 import 公共库');
    // 本地不得再定义 ssh 执行体（execFileSync 直连 ssh 是分叉的起点）
    assert.doesNotMatch(text, /^function ssh\(/m, rel + ' 又自带 ssh()，机制分叉了');
    // 本地不得再实现台账文件名过滤
    assert.doesNotMatch(text, /new RegExp\('_' \+ /, rel + ' 又自带台账正则，口径会漂');
  }
});

test('公共库导出收口后的完整机制面', () => {
  for (const name of ['ssh', 'lsRemote', 'listLedgers', 'readLedger', 'waitNewLedger',
    'launchDetached', 'preflight', 'verifyOutputs', 'buildExecCmd', 'runStepHttp',
    'runStepDetached', 'renderTable', 'ledgerPattern', 'shellSingle', 'wrapperId']) {
    assert.match(LIB_TEXT, new RegExp('export (async )?function ' + name + '\\b'), '缺导出: ' + name);
  }
});

test('P-25：台账正则用 taskId 段锚定，enrichment 不会命中 enrichment_figures', () => {
  // 这是 P-25 的原始触发器：ls 的 glob "*_enrichment_*.json" 会同时命中两者
  const re = new RegExp('_' + 'line3_spatial' + '_' + 'enrichment' + '_[0-9a-f]{8,}\\.json$');
  assert.ok(re.test('2026-10-21_PRJ_E2E_SPATIAL_line3_spatial_enrichment_ab12cd34.json'),
    '合法台账必须命中');
  assert.ok(!re.test('2026-10-21_PRJ_E2E_SPATIAL_line3_spatial_enrichment_figures_ab12cd34.json'),
    'enrichment_figures 不得被当成 enrichment 的账');
});

test('P-25：listLedgers 二次过滤而非只靠 ls glob', () => {
  assert.match(LIB_TEXT, /ledgerPattern\(step, line\)/, 'listLedgers 必须用 ledgerPattern 二次过滤');
  assert.match(LIB_TEXT, /export function ledgerPattern/, 'ledgerPattern 必须导出（runner 与测试共用同一口径）');
});

test('line3 runner 固定本线路径，公共库按 projectId/lineId 核对产物', () => {
  const line3 = fs.readFileSync(path.join(REPO, 'cn_debug', '2026-10-21_m1_line3_chain.mjs'), 'utf8');
  assert.match(line3, /const P = `\$\{REMOTE_ROOT\}\/projects\/\$\{PROJECT\}\/\$\{LINE\}`/);
  assert.match(line3, /strictOutputs:\s*STEPS\[i\]\.strictOutputs !== false/);
  assert.match(LIB_TEXT, /projects\/\$\{projectId\}\/\$\{lineId\}/);
  assert.match(LIB_TEXT, /if \(spec\.strictOutputs\)/);
});

test('P-04：ssh 输出滤掉 known_hosts warning 行', () => {
  assert.match(LIB_TEXT, /Warning: Permanently added/, '必须滤 ssh 首连接 warning');
});

test('P-26：长任务必须 setsid nohup，且本机只轮询', () => {
  assert.match(LIB_TEXT, /setsid nohup bash/, 'launchDetached 必须用 setsid nohup 脱离本机进程树');
  assert.match(LIB_TEXT, /< \/dev\/null/, 'stdin 必须脱钩，否则 ssh 一断任务就收 SIGIPE');
  // runStepHttp 只用于短步骤：必须显式说明它不是判活依据
  assert.match(LIB_TEXT, /P-26/, 'HTTP 模式要写明 P-26 的适用范围');
});

test('P-24：判活依据是 _running 标记 / 日志字节数 / 台账 / 产物 mtime，不是 loadavg', () => {
  const codeLines = LIB_TEXT.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
  assert.deepEqual(codeLines.filter((l) => /loadavg/.test(l)), [], '不得用 /proc/loadavg 判活');
  assert.match(LIB_TEXT, /RUNNING_DIR/, '要把 _running 标记目录作为判活依据之一');
});

test('公共库不得送进程探针进容器（P-23）', () => {
  const codeLines = LIB_TEXT.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
  const bad = codeLines.filter((l) => /(^|[\s"';&|(`])(pgrep|pkill)\b|\bps\s+-(eo|ef|aux|e|f)\b/.test(l));
  assert.deepEqual(bad, [], 'chain_runner 里出现 guest 进程探针: ' + bad.join(' | '));
});

test('runStepDetached 的 wallSec 用真实起始时间，不是占位', () => {
  assert.match(LIB_TEXT, /const startedAt = Date\.now\(\);/, '必须记录起始时间');
  assert.doesNotMatch(LIB_TEXT, /Date\.now\(\) - Date\.now\(\)/, '不得留恒为 0 的占位计时');
});
