/**
 * aims 条款落点一致性测试（2026-10-21 校准）。
 *
 * 背景：2026-10-21 把 S28-S32 / D4 / D5 / D6 的实现结果回写进 aims/aims.txt，
 * 同时新增 §八「条款与实现落点对照」。回写型文档最大的风险是再次漂移：
 * 表里点名的文件被改名/删除，条款还在；阈值改了只改一边。
 *
 * 本文件钉死四件事（只读，不改任何实现）：
 *   1. §八 对照表存在且行数够，表里点名的路径都真实存在；
 *   2. §二 目录树与远端实测布局一致（projects/<项目>/<线>/，含 figures）；
 *   3. §二 合法根口径点名 ledger.js（单一事实源）；
 *   4. §三.3 / §三.4 / §三.1 的关键阈值与接口名没被改小或删掉。
 *
 * 改 aims 条款时：先改条款，再改落点文件，最后看本测试是否红。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const AIMS = fs.readFileSync(path.join(ROOT, 'aims', 'aims.txt'), 'utf8');

/** §八 全文（到文末；当前 §八 是最后一节） */
const SECTION_8_START = AIMS.indexOf('## 八、');
const SECTION_8 = SECTION_8_START === -1 ? '' : AIMS.slice(SECTION_8_START);

/** 表格数据行：以 | 开头且不是表头分隔行 */
function tableRows(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && !/^\|[\s:-]+\|/.test(line))
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 3 && cells[1] !== '条款');
}

/** 从一行表格里取出所有反引号包裹的 token */
function backticked(cell) {
  return [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

/** 看起来像仓库内相对路径的 token（排除 <项目>/<线> 这类占位、通配与花括号） */
function pathTokens(cell) {
  return backticked(cell).filter(
    (token) =>
      token.includes('/') &&
      /\.[a-z0-9]+$/i.test(token) &&
      !/[<>{}*?]/.test(token),
  );
}

/**
 * 明知不存在、但条款必须点名的路径：ops/09_package_delivery.ps1 已于 2026-10-21 作废
 * （交付打包改由 ops/build_client_report.py 承担），表里保留它是为了让读者知道
 * "别再去找这个脚本"。除此以外任何缺失都算落点漂移。
 */
const ALLOW_MISSING = new Set(['ops/09_package_delivery.ps1']);

/** 依次在仓库根与工作台目录下解析，命中即返回绝对路径 */
function resolveRepoPath(token) {
  const bases = [ROOT, path.join(ROOT, 'BioanalysDesktop')];
  for (const base of bases) {
    const abs = path.join(base, token);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

test('§八 条款与实现落点对照表存在，且至少 12 行', () => {
  assert.ok(SECTION_8_START !== -1, 'aims/aims.txt 里找不到 §八 对照表');
  const rows = tableRows(SECTION_8);
  assert.ok(rows.length >= 12, `§八 对照表只有 ${rows.length} 行，少于 12 行`);
});

test('§八 表里点名的每个路径都真实存在（落点没被改名或删除）', () => {
  const rows = tableRows(SECTION_8);
  const missing = [];
  let checked = 0;
  for (const cells of rows) {
    for (const token of pathTokens(cells.join(' '))) {
      if (ALLOW_MISSING.has(token)) continue;
      checked += 1;
      if (!resolveRepoPath(token)) missing.push(`${cells[1]} -> ${token}`);
    }
  }
  assert.ok(checked >= 10, `§八 只解析出 ${checked} 个路径，表可能被删空`);
  assert.deepEqual(missing, [], `§八 点名的落点不存在：\n${missing.join('\n')}`);
});

test('§二 目录树与实测布局一致：projects/<项目>/<线>/ 且每线含 figures', () => {
  const start = AIMS.indexOf('## 二、');
  const end = AIMS.indexOf('## 三、');
  assert.ok(start !== -1 && end > start, 'aims 里找不到 §二 目录结构章节');
  const section = AIMS.slice(start, end);
  assert.ok(section.includes('projects/'), '§二 目录树缺 projects/ 层（2026-10 起数据面唯一入口）');
  assert.ok(section.includes('line1_bulk/'), '§二 目录树缺 line1_bulk/');
  assert.ok(section.includes('line2_scrna/'), '§二 目录树缺 line2_scrna/');
  assert.ok(section.includes('line3_spatial/'), '§二 目录树缺 line3_spatial/');
  assert.ok(section.includes('figures/'), '§二 目录树缺 figures/（300 DPI 图件落点）');
  assert.ok(section.includes('bin/'), '§二 目录树缺 bin/');
  assert.ok(section.includes('envs/'), '§二 目录树缺 envs/');
});

test('§二 合法根口径点名单一事实源 ledger.js 与三条硬规则', () => {
  const start = AIMS.indexOf('## 二、');
  const end = AIMS.indexOf('## 三、');
  const section = AIMS.slice(start, end);
  assert.ok(section.includes('合法根与归属口径'), '§二 缺「合法根与归属口径」小节');
  assert.ok(section.includes('ledger.js'), '§二 合法根口径没点名单一事实源 ledger.js');
  assert.ok(section.includes('analyzePath') && section.includes('inspectTaskPath'), '§二 合法根口径缺 analyzePath / inspectTaskPath');
  assert.ok(section.includes('system_logs/'), '§二 合法根口径没写 system_logs/ 的归属限制');
  assert.ok(section.includes('..'), '§二 合法根口径没写 .. 拒绝规则');
});

test('§三.3 五维自检口径：接口名、四档状态与关键阈值都在', () => {
  const start = AIMS.indexOf('### 3. 服务端运维与审计控制台');
  const end = AIMS.indexOf('### 4. 分析结果预览与交付界面');
  assert.ok(start !== -1 && end > start, 'aims 里找不到 §三.3');
  const section = AIMS.slice(start, end);
  for (const needle of ['/api/selfcheck', 'selfcheck.js', 'warn', 'unknown', '20%', '85', '95', '7.5GB', '1.5', 'check_storage_and_isolation.sh', 'verify_bridge_checkpoint.py']) {
    assert.ok(section.includes(needle), `§三.3 自检口径缺「${needle}」`);
  }
});

test('§三.4 交付门禁口径：四道闸、409 与 sha256 旁挂都在', () => {
  const start = AIMS.indexOf('### 4. 分析结果预览与交付界面');
  assert.ok(start !== -1, 'aims 里找不到 §三.4');
  const section = AIMS.slice(start, AIMS.indexOf('## 四、'));
  for (const needle of ['/api/report/build', 'runReportPreflight', '409', 'sha256', 'build_client_report.py', 'CHECKSUMS']) {
    assert.ok(section.includes(needle), `§三.4 交付口径缺「${needle}」`);
  }
});

test('§三.1 模块 B 白名单与体积上限指向单一事实源', () => {
  const start = AIMS.indexOf('### 1. 独立页面：新建项目向导页');
  const end = AIMS.indexOf('### 2. 客户分析输入端');
  assert.ok(start !== -1 && end > start, 'aims 里找不到 §三.1');
  const section = AIMS.slice(start, end);
  assert.ok(section.includes('shared/data_formats.mjs'), '§三.1 模块 B 没指向 shared/data_formats.mjs');
  assert.ok(section.includes('5GiB'), '§三.1 模块 B 没写 5GiB 上限');
  assert.ok(section.includes('.h5ad') && section.includes('.loom'), '§三.1 模块 B 没写数据格式白名单');
});

test('§六 防崩套件标注了与 8787 自检的同口径要求', () => {
  const start = AIMS.indexOf('## 六、');
  const end = AIMS.indexOf('## 七、');
  assert.ok(start !== -1 && end > start, 'aims 里找不到 §六');
  const section = AIMS.slice(start, end);
  assert.ok(section.includes('同口径要求'), '§六 缺「同口径要求」提示（避免界面绿、脚本红）');
  assert.ok(section.includes('selfcheck.js'), '§六 同口径要求没点名 server/selfcheck.js');
});
