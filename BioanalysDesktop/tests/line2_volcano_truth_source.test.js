// T1-4 line2 火山接真源：配色与阈值不许再散落硬编码。
//
// 背景（第三十二轮 4 Argon Q2/Q4 裁定 + figure-provenance 实测）：
//   src/line2_scrna/scripts/scrna_figures:81-83 仍是旧三色 #D62728/#1F77B4/#BBBBBB；
//   :718-719 硬编码 padj<0.05 与 |l2|>1；:727/733/760 还有三处字面量；
//   :269-270 早已有 CASE_COLOR=#EE0000 / CTRL_COLOR=#3B4992 却没被火山段复用；
//   line2 全部 scripts 读 analysis_cutoffs 命中 0，而 line1 的 bulk_figures 早已接真源。
//   像素实证：现网 l2_08_deg_volcano_*.png 命中 #D62728 738px、#EE0000 0px。
//
// 判据分两层：源码层（配色常量与阈值必须来自真源）与产物层（重渲染后像素命中规范色）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';


const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const L2 = path.join(REPO_ROOT, 'src', 'line2_scrna', 'scripts');

function readScript(name) {
  return fs.readFileSync(path.join(L2, name), 'utf8');
}

test('scrna_figures 三色必须是规范三色，且不再出现旧色号', () => {
  const text = readScript('scrna_figures');
  assert.match(text, /UP\s*=\s*"#EE0000"/, '上调色必须是 #EE0000');
  assert.match(text, /DOWN\s*=\s*"#3B4992"/, '下调色必须是 #3B4992');
  assert.match(text, /NS\s*=\s*"#BEBEBE"/, '中性色必须是 #BEBEBE');
  // 只禁「被赋给变量」的旧色号（形如 UP = "#D62728"）。注释里记录历史变迁是允许的：
  // 把旧色号从注释里也抹掉，等于让后人看不出为什么改过、改的是哪几个值。
  for (const old of ['#D62728', '#1F77B4', '#BBBBBB']) {
    const assign = new RegExp('=\\s*"' + old + '"', 'i');
    assert.ok(!assign.test(text), `旧色号 ${old} 仍被赋值给变量（scrna_figures）`);
  }
});

test('scrna_figures 火山阈值必须来自 read_cutoffs，不许硬编码 0.05 与 |l2|>1', () => {
  const text = readScript('scrna_figures');
  assert.match(text, /def read_cutoffs/, 'scrna_figures 必须自带 read_cutoffs（与 line1 同款真源读取）');
  assert.match(text, /analysis_cutoffs/, 'read_cutoffs 必须从 project.json 的 analysis_cutoffs 读');
  assert.match(text, /effective_p_field/, '必须读 effective_p_field');
  assert.match(text, /effective_p_threshold/, '必须读 effective_p_threshold');
  // 火山段的具体字面量：这三处必须已经变量化
  const volcanoBlock = text.split('sig_up =')[1] || '';
  assert.ok(!/padj < 0\.05/.test(volcanoBlock), '火山段仍是硬编码 padj < 0.05');
  assert.ok(!/\(l2 > 1\)/.test(volcanoBlock), '火山段仍是硬编码 l2 > 1');
  assert.ok(!/np\.log10\(0\.05\)/.test(volcanoBlock), '阈值线仍是硬编码 np.log10(0.05)');
});

test('line2 的其他图脚本不许引入新的硬编码火山阈值（防漏网）', () => {
  const offenders = [];
  for (const name of fs.readdirSync(L2)) {
    const file = path.join(L2, name);
    if (!fs.statSync(file).isFile()) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes('volcano') && !text.includes('sig_up')) continue;
    if (/padj\s*<\s*0\.05\s*\)\s*&\s*\(\s*l2\s*>\s*1/.test(text)) offenders.push(name);
  }
  assert.deepEqual(offenders, [], `仍硬编码火山阈值的脚本: ${offenders.join(', ')}`);
});
// 函数体级断言：只查「整个文件里有没有 analysis_cutoffs 字样」会被绕过。
// 变异实测：把 `cut = (meta or {}).get("analysis_cutoffs") or {}` 换成 `cut = {}` 后，
// 全文断言仍绿（因为注释和别处还有这个词），而阈值会静默退回标准档。
// 所以判据必须收紧到 read_cutoffs 的函数体，且要求三个字段各自被真正读取。
test('read_cutoffs 函数体必须真正读 analysis_cutoffs 的三个字段', () => {
  const text = readScript('scrna_figures');
  const start = text.indexOf('def read_cutoffs():');
  assert.ok(start >= 0, 'scrna_figures 必须有 read_cutoffs');
  const lines = text.slice(start).split('\n');
  const keep = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (i > 0 && /^[^ \t#]/.test(lines[i])) break;
    keep.push(lines[i]);
  }
  const body = keep.join('\n');
  assert.match(body, /\.get\("analysis_cutoffs"\)/, '函数体必须真的去取 analysis_cutoffs，不能是空对象');
  assert.match(body, /cut\.get\("log2fc_threshold"\)/, '函数体必须读 log2fc_threshold');
  assert.match(body, /cut\.get\("effective_p_threshold"\)/, '函数体必须读 effective_p_threshold');
  assert.match(body, /cut\.get\("effective_p_field"\)/, '函数体必须读 effective_p_field');
});

test('火山段必须由 read_cutoffs 的结果驱动，且火山段自身就在调用', () => {
  const text = readScript('scrna_figures');
  const lines = text.split('\n');
  const sigIdx = lines.findIndex((l) => l.includes('sig_up ='));
  assert.ok(sigIdx > 0, '找不到火山段 sig_up 判定');
  // 只认火山段**自己**那次调用：往上 40 行内必须有 read_cutoffs()。
  // 若只数全文调用次数，别处（如 deg count 图）的调用会让这条断言假绿，
  // 变异实测：把火山段那次换成写死对象后全文仍有 1 次调用，exit 0。
  const window = lines.slice(Math.max(0, sigIdx - 40), sigIdx).join('\n');
  assert.match(window, /read_cutoffs\(\)/, '火山段自己在调用 read_cutoffs');
  assert.match(text, /l2_cut = cuts\["log2fc"\]/, '阈值线必须取 cuts 的 log2fc');
  assert.match(text, /p_cut = cuts\["p_cut"\]/, '显著性判定必须取 cuts 的 p_cut');
  assert.match(text, /sig_up = \(padj < p_cut\) & \(l2 > l2_cut\)/, '上调判定必须是变量驱动');
  assert.match(text, /sig_dn = \(padj < p_cut\) & \(l2 < -l2_cut\)/, '下调判定必须是变量驱动');
});