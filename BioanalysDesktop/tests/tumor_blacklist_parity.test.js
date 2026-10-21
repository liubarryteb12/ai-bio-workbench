/**
 * 黑名单三处副本一致性测试（B3 收口 / 2026-10-21）。
 *
 * 背景：非肿瘤黑名单有三个"应该一致"的落点：
 *   1. 规格正本：aims/aims.txt §三.1「黑名单确认清单」（8 条，2026-10-21 用户裁定收敛）；
 *   2. 权威实现：BioanalysDesktop/server/tumor_blacklist.js 的 BLACKLIST_PATTERNS；
 *   3. 纯前端副本：portal/index.html 的 var BL_PATTERNS（门户单文件页无打包步骤，不能 import）。
 *
 * 2026-10-21 之前实现侧自行扩充到 27 条、portal 也是 27 条，注释却写着"与工作台同源"。
 * B3 把实现收敛回规格正本 8 条后，本文件钉死三件事：
 *   1. 权威实现恰好 8 条，且逐条与规格原文同序；
 *   2. portal 副本不漂移（读文本、解析正则字面量、逐条 String() 比对）；
 *   3. 两侧对同一批文本给出相同判定（server checkTumorBlacklist vs portal 正则数组）。
 *
 * 改动黑名单时：先改 aims/aims.txt，再改 server/tumor_blacklist.js，最后同步
 * portal/index.html 的字面量，否则本测试会红。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BLACKLIST_PATTERNS, checkTumorBlacklist } from '../server/tumor_blacklist.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'portal', 'index.html'), 'utf8');
const AIMS = fs.readFileSync(path.join(ROOT, 'aims', 'aims.txt'), 'utf8');

/** 规格正本 8 条：英文 5 + 中文 3，顺序与 aims 清单一致 */
const EXPECTED = [
  { source: 'cancer', flags: 'i' },
  { source: 'tumor', flags: 'i' },
  { source: 'carcinoma', flags: 'i' },
  { source: 'glioma', flags: 'i' },
  { source: 'immune\\s*infiltration', flags: 'i' },
  { source: '肿瘤', flags: '' },
  { source: '癌', flags: '' },
  { source: '免疫浸润', flags: '' },
];

/** 从 index.html 取出 `var BL_PATTERNS = [...];` 并解析成正则数组 */
function parseHtmlBlacklist(text) {
  const block = text.match(/var BL_PATTERNS\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(block, 'portal/index.html 里找不到 var BL_PATTERNS = [...]; 字面量');
  const tokens = [...block[1].matchAll(/\/((?:[^\/\\\n]|\\.)+)\/([gimsuy]*)/g)];
  assert.ok(tokens.length > 0, 'portal/index.html 的 BL_PATTERNS 里没解析出任何正则');
  return tokens.map((m) => new RegExp(m[1], m[2]));
}

const PORTAL_PATTERNS = parseHtmlBlacklist(HTML);

test('权威实现恰好 8 条，且与规格原文逐条同序', () => {
  assert.equal(BLACKLIST_PATTERNS.length, 8);
  const actual = BLACKLIST_PATTERNS.map((re) => ({ source: re.source, flags: re.flags }));
  assert.deepEqual(actual, EXPECTED);
});

test('aims 规格正本里能查到这 8 条关键词（规格未被偷偷改小）', () => {
  for (const { source } of EXPECTED) {
    const word = source.replace(/\\s\*/g, ' ');
    assert.ok(AIMS.includes(word), `aims/aims.txt 里查不到黑名单词「${word}」`);
  }
  assert.ok(AIMS.includes('黑名单'), 'aims/aims.txt 里查不到黑名单章节');
});

test('portal 副本条数与权威实现一致（8 条）', () => {
  assert.equal(PORTAL_PATTERNS.length, BLACKLIST_PATTERNS.length);
});

test('portal 副本逐条与权威实现同源同序（防止单侧漂移）', () => {
  const server = BLACKLIST_PATTERNS.map((re) => re.toString());
  const portal = PORTAL_PATTERNS.map((re) => re.toString());
  assert.deepEqual(portal, server);
});

test('portal/index.html 注明权威实现位置（副本不许自称同源）', () => {
  assert.match(HTML, /权威实现：BioanalysDesktop\/server\/tumor_blacklist\.js/);
});

/** 判定矩阵：两侧对同一批文本必须给出相同"是否命中"结论 */
const SAMPLES = [
  // 该命中
  'Lung cancer cohort',
  'tumor samples from GSE30528',
  'carcinoma cell line',
  'glioma microenvironment',
  'immune infiltration score',
  'immune   infiltration',
  '肿瘤组织',
  '癌旁组织',
  '免疫浸润水平',
  // 该放行（收敛后的口径）
  'ischemic stroke',
  'Alzheimer disease',
  'pulmonary fibrosis',
  'non-alcoholic fatty liver',
  'sarcoma cohort',
  'lymphoma patient',
  'melanoma cell line',
  'PD-L1 inhibitor',
  'immune checkpoint blockade',
  '免疫检查点',
  'tumour microenvironment',
  'tumor microenvironment',
  'adenocarcinoma',
  '',
  '   ',
];

test('两侧判定矩阵完全一致（命中/放行结论逐条相同）', () => {
  const diffs = [];
  for (const text of SAMPLES) {
    const serverHit = checkTumorBlacklist(text).hit;
    const portalHit = PORTAL_PATTERNS.some((re) => re.test(text));
    if (serverHit !== portalHit) diffs.push(`${JSON.stringify(text)}: server=${serverHit} portal=${portalHit}`);
  }
  assert.deepEqual(diffs, []);
});

test('收敛后历史扩充词不再单独拦截（口径回退锚点）', () => {
  for (const word of ['sarcoma', 'lymphoma', 'melanoma', 'PD-L1', 'CTLA-4', '免疫检查点']) {
    assert.equal(checkTumorBlacklist(word).hit, false, `「${word}」应放行`);
    assert.equal(PORTAL_PATTERNS.some((re) => re.test(word)), false, `portal 侧「${word}」应放行`);
  }
});
