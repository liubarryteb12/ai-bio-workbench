/**
 * aims 防漂移测试（v2.5 校准，2026-10-21）。
 *
 * 背景：aims/aims.txt 于 2026-10-21 升级为 v2.5「工程硬化与治理定稿版」
 * （旧版归档在 aims/old/aims_v2.4_2026-10-21.txt）。v2.5 新增 §八 五本台账治理、
 * §九 条款与实现落点对照表、§十 M1-M4 路线图与风险预案矩阵。
 *
 * 宪章级文档最大的风险不是写错，是写着写着就与代码脱钩：表里点名的文件被改名、
 * 阈值只改了一边、状态列被写成散文。本文件只读不写，钉死五件事：
 *   1. §九 对照表存在且行数够，表里点名的每个路径都真实存在；
 *   2. §九 状态列只能用受控词表（禁止散文式状态，防止「看起来实现了」）；
 *   3. §一/§二/§三/§六 的关键阈值、接口名、单一事实源没被改小或删掉；
 *   4. §八 五本台账的物理落点都在（新章不能只是文字）；
 *   5. 全文不得残留已被实现取代的过期论断。
 *
 * 改 aims 条款的顺序：先改条款，再改落点文件，最后看本测试是否红。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const AIMS = fs.readFileSync(path.join(ROOT, 'aims', 'aims.txt'), 'utf8');
const BT = String.fromCharCode(96);

/** 取两个标记之间的正文；endMark 为空则取到文末 */
function section(startMark, endMark) {
  const start = AIMS.indexOf(startMark);
  if (start === -1) return '';
  const end = endMark ? AIMS.indexOf(endMark, start + startMark.length) : -1;
  return end === -1 ? AIMS.slice(start) : AIMS.slice(start, end);
}

/** 表格数据行：以 | 开头、非表头分隔行、至少 3 个非空单元格 */
function tableRows(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'))
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.filter((c) => c !== '').length >= 3)
    .filter((cells) => !/^[\s:-]+$/.test(cells[1] || ''));
}

/** 取单元格里所有反引号包裹的 token（正则用 BT 拼，避免源码里出现裸反引号） */
function backticked(cell) {
  return [...cell.matchAll(new RegExp(BT + '([^' + BT + ']+)' + BT, 'g'))].map((m) => m[1]);
}

/** 仓库内相对路径形态的 token（排除占位、通配、无扩展名目录） */
function pathTokens(cell) {
  return backticked(cell).filter(
    (token) => token.includes('/') && /\.[a-z0-9]+$/i.test(token) && !/[<>{}*?]/.test(token),
  );
}

/**
 * 明知不存在但条款必须点名的路径：ops/09_package_delivery.ps1 已于 2026-10-21 作废
 * （交付打包改由 ops/build_client_report.py 承担），留在表里是告诉读者别再找它。
 */
const ALLOW_MISSING = new Set(['ops/09_package_delivery.ps1']);

function resolveRepoPath(token) {
  for (const base of [ROOT, path.join(ROOT, 'BioanalysDesktop')]) {
    if (fs.existsSync(path.join(base, token))) return true;
  }
  return false;
}

const SEC9 = section('## 九、', '## 十、');

test('§九 条款与实现落点对照表存在，且至少 12 行', () => {
  assert.ok(SEC9 !== '', 'aims/aims.txt 里找不到 §九 对照表');
  const rows = tableRows(SEC9);
  assert.ok(rows.length >= 12, '§九 对照表只有 ' + rows.length + ' 行，少于 12 行');
});

test('§九 表里点名的每个路径都真实存在（落点没被改名或删除）', () => {
  const missing = [];
  let checked = 0;
  for (const cells of tableRows(SEC9)) {
    for (const token of pathTokens(cells.join(' '))) {
      if (ALLOW_MISSING.has(token)) continue;
      checked += 1;
      if (!resolveRepoPath(token)) missing.push((cells[1] || '?') + ' -> ' + token);
    }
  }
  assert.ok(checked >= 12, '§九 只解析出 ' + checked + ' 个路径，表可能被删空');
  assert.deepEqual(missing, [], '§九 点名的落点不存在：\n' + missing.join('\n'));
});

test('§九 状态列只用受控词表（禁止散文式状态）', () => {
  const ALLOWED_PREFIX = [
    '已实现', '已对齐', '已接线', '单一事实源', '持续强制',
    '已按实测校准', '100% PASS', '97% 落地',
  ];
  const bad = [];
  for (const cells of tableRows(SEC9)) {
    // 行尾可能带一个空单元格，取最后一个非空单元格做状态列
    const status = cells.filter((c) => c !== '').pop() || '';
    if (status === '当前状态') continue;
    if (!ALLOWED_PREFIX.some((p) => status.startsWith(p))) bad.push((cells[1] || '?') + ' -> ' + status);
  }
  assert.deepEqual(bad, [], '§九 状态列出现词表外的写法：\n' + bad.join('\n'));
});

test('§一.2 三大铁律：20 条黑名单、阶段感知 --stage、seed 都在', () => {
  const s = section('## 一、', '## 二、');
  assert.ok(s.includes('20 条黑名单'), '§一.2 没写 20 条黑名单正本（2026-10-21 二次裁定口径）');
  assert.ok(s.includes('tumor_blacklist.js'), '§一.2 没点名黑名单单一事实源');
  assert.ok(s.includes('--stage post-dimred') && s.includes('--stage pre-dimred'), '§一.2 缺阶段感知 --stage 口径');
  assert.ok(s.includes('20261013'), '§一.2 缺全局随机种子');
  assert.ok(s.includes('verify_bridge_checkpoint.py'), '§一.2 缺桥接引擎落点');
  assert.ok(s.includes('DEG') && s.includes('DR Genes'), '§一.2 缺 DEG / DR Genes 隔离条款');
});

test('§二 目录树与实测布局一致：projects/<项目>/<线>/ 且每线含 figures', () => {
  const s = section('## 二、', '## 三、');
  for (const needle of ['projects/', 'line1_bulk/', 'line2_scrna/', 'line3_spatial/', 'figures/', 'bin/', 'envs/', 'public_references/', 'system_logs/']) {
    assert.ok(s.includes(needle), '§二 目录树缺「' + needle + '」');
  }
});

test('§二 合法根口径点名单一事实源 ledger.js 与硬规则', () => {
  const s = section('## 二、', '## 三、');
  assert.ok(s.includes('合法根与归属口径'), '§二 缺「合法根与归属口径」小节');
  assert.ok(s.includes('ledger.js'), '§二 没点名 ledger.js');
  assert.ok(s.includes('analyzePath') && s.includes('inspectTaskPath'), '§二 缺 analyzePath / inspectTaskPath');
  assert.ok(s.includes('system_logs/'), '§二 没写 system_logs/ 归属限制');
  assert.ok(s.includes('..'), '§二 没写 .. 拒绝规则');
  assert.ok(s.includes('400'), '§二 没写越界回 400');
});

test('§三.1 模块 B：白名单、配额、错误体、预留闸门都在', () => {
  const s = section('### 1. 独立页面', '### 2. 客户分析输入端');
  assert.ok(s !== '', '§三.1 找不到');
  for (const needle of ['shared/data_formats.mjs', '5GiB', '.h5ad', '.loom', 'BIO_UPLOAD_QUOTA_BYTES', '507', 'reservedBytes', '413']) {
    assert.ok(s.includes(needle), '§三.1 模块 B 缺「' + needle + '」');
  }
  assert.ok(s.includes('ok: false') || s.includes('{ok:false, error}'), '§三.1 模块 B 缺统一错误契约');
});

test('§三.2 提交三道闸：路径预检、跨线审计、去注释桥接识别', () => {
  const s = section('### 2. 客户分析输入端', '### 3. 服务端运维与审计控制台');
  assert.ok(s !== '', '§三.2 找不到');
  for (const needle of ['inspectTaskPath', 'server/audit.js', 'stripShellAndCodeComments', 'bridge_guard.sh', 'verify_bridge_checkpoint.py']) {
    assert.ok(s.includes(needle), '§三.2 缺「' + needle + '」');
  }
});

test('§三.3 五维自检：接口名、四档状态、关键阈值都在', () => {
  const s = section('### 3. 服务端运维与审计控制台', '### 4. 分析结果预览与交付界面');
  assert.ok(s !== '', '§三.3 找不到');
  for (const needle of ['/api/selfcheck', 'selfcheck.js', 'warn', 'unknown', '20%', '85', '95', '7.5GB', '1.5', 'check_storage_and_isolation.sh', 'verify_bridge_checkpoint.py', 'SHA256']) {
    assert.ok(s.includes(needle), '§三.3 缺「' + needle + '」');
  }
});

test('§三.4 交付门禁：四道闸、409、双凭证都在', () => {
  const s = section('### 4. 分析结果预览与交付界面', '## 四、');
  assert.ok(s !== '', '§三.4 找不到');
  for (const needle of ['/api/report/build', 'runReportPreflight', '409', 'write_checksums', 'CHECKSUMS.sha256', 'build_client_report.py']) {
    assert.ok(s.includes(needle), '§三.4 缺「' + needle + '」');
  }
});

test('§六 防崩套件与 8787 自检同源（阈值不许各写一套）', () => {
  const s = section('## 六、', '## 七、');
  assert.ok(s.includes('selfcheck.js'), '§六 没写与 server/selfcheck.js 同源');
  assert.ok(s.includes('20%') || s.includes('20\\%'), '§六 缺存储水位阈值');
  assert.ok(s.includes('90') && s.includes('78'), '§六 缺高温冷却阈值');
  assert.ok(s.includes('sync_and_verify_remote.ps1'), '§六 缺本地与远端原子同步工具');
});

test('§八 五本台账的物理落点全部存在（新章不能只是文字）', () => {
  const s = section('## 八、', '## 九、');
  assert.ok(s !== '', '§八 找不到');
  for (const p of ['con_hf/SPEC_DECISIONS.md', 'con_hf/ops_ledger.md', 'con_hf/pitfalls_ledger.md', 'con_hf/handoff.md']) {
    assert.ok(s.includes(p), '§八 没写台账落点「' + p + '」');
    assert.ok(fs.existsSync(path.join(ROOT, p)), '§八 点名的台账不存在：' + p);
  }
});

test('§十 路线图三阶段与风险预案矩阵都在', () => {
  const s = section('## 十、', null);
  assert.ok(s !== '', '§十 找不到');
  for (const needle of ['M1', 'M2', 'M3', 'M4', '风险']) {
    assert.ok(s.includes(needle), '§十 缺「' + needle + '」');
  }
});

test('aims 全文不得残留已被实现取代的过期论断', () => {
  const stale = ['仍为已知缺口', '断点续传未实现', '五维自检缺温度', '桥接断言尚未接线'];
  for (const phrase of stale) {
    assert.ok(!AIMS.includes(phrase), 'aims 仍残留过期论断：「' + phrase + '」');
  }
});
