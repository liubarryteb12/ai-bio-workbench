/**
 * 黑名单三处副本一致性测试（B3 收口 / 2026-10-21 二次裁定后）。
 *
 * 背景：非肿瘤黑名单有三个"应该一致"的落点：
 *   1. 规格正本：aims/aims.txt §三.1「黑名单确认清单」（20 条，2026-10-21 二次裁定）；
 *   2. 权威实现：BioanalysDesktop/server/tumor_blacklist.js 的 BLACKLIST_PATTERNS；
 *   3. 纯前端副本：portal/index.html 的 var BL_PATTERNS（门户单文件页无打包步骤，不能 import）。
 *
 * 沿革：实现侧曾自行扩充到 27 条、portal 也跟到 27 条，注释却写着"与工作台同源"；
 * 同日先收敛回 8 条，随后用户裁定「以 aims 为准，吸纳 27 条中可用的并对齐」，
 * 吸纳 12 条可用项、剔除 8 条被父词覆盖的冗余项，定为 20 条。本文件钉死三件事：
 *   1. 权威实现恰好 20 条，且逐条与规格原文同序；
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

/** 规格正本 20 条：英文 16 + 中文 4，顺序与 aims 清单一致 */
const EXPECTED = [
  { source: 'cancer', flags: 'i' },
  { source: 'tumor', flags: 'i' },
  { source: 'tumour', flags: 'i' },
  { source: 'carcinoma', flags: 'i' },
  { source: 'glioma', flags: 'i' },
  { source: 'sarcoma', flags: 'i' },
  { source: 'lymphoma', flags: 'i' },
  { source: 'leukemia', flags: 'i' },
  { source: 'leukaemia', flags: 'i' },
  { source: 'melanoma', flags: 'i' },
  { source: 'immune\\s*infiltration', flags: 'i' },
  { source: 'immune\\s*checkpoint', flags: 'i' },
  { source: '(?<![A-Za-z0-9])PD-?L1(?![0-9])', flags: 'i' },
  { source: '(?<![A-Za-z0-9])PD-?1(?![0-9])', flags: 'i' },
  { source: 'CTLA-?4', flags: 'i' },
  { source: 'oncogene', flags: 'i' },
  { source: '肿瘤', flags: '' },
  { source: '癌', flags: '' },
  { source: '免疫浸润', flags: '' },
  { source: '免疫检查点', flags: '' },
];

/** 从 index.html 取出 var BL_PATTERNS = [...]; 并解析成正则数组 */
function parseHtmlBlacklist(text) {
  const block = text.match(/var BL_PATTERNS\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(block, 'portal/index.html 里找不到 var BL_PATTERNS = [...]; 字面量');
  const tokens = [...block[1].matchAll(/\/((?:[^\/\\\n]|\\.)+)\/([gimsuy]*)/g)];
  assert.ok(tokens.length > 0, 'portal/index.html 的 BL_PATTERNS 里没解析出任何正则');
  return tokens.map((m) => new RegExp(m[1], m[2]));
}

const PORTAL_PATTERNS = parseHtmlBlacklist(HTML);

test('权威实现恰好 20 条，且与规格原文逐条同序', () => {
  assert.equal(BLACKLIST_PATTERNS.length, 20);
  const actual = BLACKLIST_PATTERNS.map((re) => ({ source: re.source, flags: re.flags }));
  assert.deepEqual(actual, EXPECTED);
});

test('aims 规格正本里能查到这 20 条关键词（规格未被偷偷改小）', () => {
  for (const { source } of EXPECTED) {
    // 正则写法还原成人读关键词：去掉边界断言、空白转义与可选连字符
    const word = source
      .replace(/\(\?<![^)]*\)/g, '')
      .replace(/\(\?![^)]*\)/g, '')
      .replace(/\\s\*/g, ' ')
      .replace(/\?/g, '');
    assert.ok(AIMS.includes(word), 'aims/aims.txt 里查不到黑名单词「' + word + '」');
  }
  assert.ok(AIMS.includes('20 条黑名单'), 'aims/aims.txt 里查不到 20 条黑名单的口径');
});

test('portal 副本条数与权威实现一致（20 条）', () => {
  assert.equal(PORTAL_PATTERNS.length, BLACKLIST_PATTERNS.length);
  assert.equal(PORTAL_PATTERNS.length, 20);
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
  // 该命中（原 8 条口径）
  'Lung cancer cohort',
  'tumor samples from GSE30528',
  'carcinoma cell line',
  'glioma microenvironment',
  'immune infiltration score',
  'immune   infiltration',
  '肿瘤组织',
  '癌旁组织',
  '免疫浸润水平',
  // 该命中（2026-10-21 二次裁定吸纳的 12 条）
  'tumour microenvironment',
  'Ewing sarcoma cohort',
  'lymphoma patient',
  'acute leukemia',
  'acute leukaemia',
  'melanoma cell line',
  'immune checkpoint blockade',
  'PD-L1 inhibitor',
  'PD-1 antibody',
  'PD1 blockade',
  'CTLA-4 antibody',
  'oncogene addiction',
  '免疫检查点',
  // 该命中（被剔除的冗余项仍因父词命中，如实记录）
  'adenocarcinoma',
  'tumor microenvironment',
  'squamous cell carcinoma',
  // 该放行
  'ischemic stroke',
  'Alzheimer disease',
  'pulmonary fibrosis',
  'non-alcoholic fatty liver',
  'GPD1 expression',
  'SLC40A1 transporter',
  'PDK1 kinase',
  '',
  '   ',
];

test('两侧判定矩阵完全一致（命中/放行结论逐条相同）', () => {
  const diffs = [];
  for (const text of SAMPLES) {
    const serverHit = checkTumorBlacklist(text).hit;
    const portalHit = PORTAL_PATTERNS.some((re) => re.test(text));
    if (serverHit !== portalHit) diffs.push(JSON.stringify(text) + ': server=' + serverHit + ' portal=' + portalHit);
  }
  assert.deepEqual(diffs, []);
});

test('二次裁定吸纳的词两侧都必须拦截（口径回退锚点）', () => {
  for (const word of ['sarcoma', 'lymphoma', 'leukemia', 'melanoma', 'PD-L1', 'CTLA-4', '免疫检查点']) {
    assert.equal(checkTumorBlacklist(word).hit, true, '「' + word + '」应拦截');
    assert.equal(PORTAL_PATTERNS.some((re) => re.test(word)), true, 'portal 侧「' + word + '」应拦截');
  }
});

test('PD 边界两侧都生效（GPD1 / SLC40A1 不许被误伤）', () => {
  for (const word of ['GPD1', 'SLC40A1', 'PDK1']) {
    assert.equal(checkTumorBlacklist(word).hit, false, '「' + word + '」应放行');
    assert.equal(PORTAL_PATTERNS.some((re) => re.test(word)), false, 'portal 侧「' + word + '」应放行');
  }
});
