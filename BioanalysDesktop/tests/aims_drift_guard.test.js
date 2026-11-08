/**
 * v3.1 SSOT 防漂移守卫。
 *
 * 生信 v3.1 正本是 aims/bio/00_... 至 03_... 四卷；A2A 正本由独立守卫覆盖。
 * 旧 v3.0 spec 已归档到 aims/old，仅用于保留 20 条黑名单等历史明细。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const AIMS_PATHS = [
  path.join(ROOT, 'aims', 'bio', '00_20261027_1204.md'),
  path.join(ROOT, 'aims', 'bio', '01_aims_20261027_1204.md'),
  path.join(ROOT, 'aims', 'bio', '02_aimstodolist_20261027_1204.md'),
  path.join(ROOT, 'aims', 'bio', '03_aims_20261027_1204.md'),
];
const AIMS = AIMS_PATHS.map((file) => fs.readFileSync(file, 'utf8')).join('\n');

function assertIncludes(text, needles, label) {
  const missing = needles.filter((needle) => !text.includes(needle));
  assert.deepEqual(missing, [], label + ' 缺：' + missing.join(', '));
}

test('v3.1 四卷正本存在且包含微内核与 1+N×3 契约', () => {
  for (const file of AIMS_PATHS) assert.ok(fs.existsSync(file), `missing aims file: ${file}`);
  assertIncludes(AIMS, [
    'v3.1',
    '1 + N×3',
    'WIP=1',
    'ModManifest',
    'FigureTemplateEntry',
    'Zero-Touch Host',
  ], 'v3.1 微内核');
});

test('G1 至 G7 与 v3.1 四项裁定保留', () => {
  assertIncludes(AIMS, [
    'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7',
    'D-18', 'D-19', 'D-20', 'D-21',
    'pending_mapping',
    'tip.length = 0',
    'script_plot_matrix.json',
    'buildAdaptedFigureTasks',
  ], 'v3.1 缺口与裁定');
});

test('T-CORE、T-FT、T-LINES 与 T-SYNC 任务链完整', () => {
  assertIncludes(AIMS, [
    'T-CORE-01', 'T-CORE-02', 'T-CORE-03', 'T-CORE-04',
    'T-FT-01', 'T-FT-02', 'T-FT-03', 'T-FT-04', 'T-FT-05', 'T-FT-06',
    'T-LINES-01', 'T-SYNC-01',
  ], 'v3.1 任务链');
});

test('三层目录、项目自包含与适配副本契约保留', () => {
  assertIncludes(AIMS, [
    'src/core/',
    'src/engines/',
    'src/mods/',
    'local_projects/<project_id>/',
    'figures/adapt/',
    'con_hf/',
  ], 'v3.1 目录契约');
  for (const relative of [
    'docs/directories.md',
    'ops/init_project_scaffold.py',
    'tools/bio/figure_templates.json',
    'BioanalysDesktop/server/figure_graph.js',
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, relative)), '落点不存在：' + relative);
  }
});

test('保留 20 条黑名单、14 类格式、单向 Sync 与网络边界', () => {
  assertIncludes(AIMS, [
    '20 条',
    '14 类',
    'NO_PROXY=127.0.0.1,localhost',
    '/api/sync/*',
    '8080',
    '18787',
    '127.0.0.1',
  ], 'v3.1 安全与同步');
});

test('工作台默认端口在 aims、服务端、前端代理、守护与 Sync 中统一为 18787', () => {
  const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
  assert.match(read('BioanalysDesktop/server/index.js'), /process\.env\.BAD_PORT\s*\|\|\s*18787/);
  assert.match(read('BioanalysDesktop/vite.config.js'), /127\.0\.0\.1:18787/);
  assert.match(read('ops/sync_daemon.ps1'), /BIO_WORKBENCH_BASE[^\n]*18787/);
  assert.match(read('ops/serve_guard.ps1'), /BAD_PORT\s*=\s*'18787'/);
  assert.match(read('start_workbench.bat'), /-Port 18787/);
  assert.match(read('start_all.bat'), /127\.0\.0\.1:18787/);
});

test('v3.1 关键产物与门禁文件已落盘', () => {
  for (const relative of [
    'con_hf/SPEC_DECISIONS.md',
    'con_hf/ledger/actions.jsonl',
    'con_hf/ledger/changes.jsonl',
    'reference/05.可参考生信代码/可用代码预筛选/源码/_meta/script_plot_matrix.json',
    'local_projects/PRJ_AIMS_V3_20261027/handoff.md',
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, relative)), '关键产物不存在：' + relative);
  }
});
