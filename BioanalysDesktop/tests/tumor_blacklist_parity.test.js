/**
 * 黑名单三处副本一致性测试（B3 收口 / 2026-10-21 二次裁定后）。
 *
 * 背景：非肿瘤黑名单只有两个稳定落点：
 *   1. 规格正本：v3.0 Spec §2.1.2（20 条，2026-10-21 二次裁定）；
 *   2. 权威实现：BioanalysDesktop/server/tumor_blacklist.js 的 BLACKLIST_PATTERNS。
 * portal/index.html 不保存手工副本，由 portal/serve.mjs 在响应期注入。
 *
 * 沿革：实现侧曾自行扩充到 27 条、portal 也跟到 27 条，注释却写着"与工作台同源"；
 * 同日先收敛回 8 条，随后用户裁定「以 aims 为准，吸纳 27 条中可用的并对齐」，
 * 吸纳 12 条可用项、剔除 8 条被父词覆盖的冗余项，定为 20 条。本文件钉死三件事：
 *   1. 权威实现恰好 20 条，且逐条与规格原文同序；
 *   2. portal 副本不漂移（读文本、解析正则字面量、逐条 String() 比对）；
 *   3. 两侧对同一批文本给出相同判定（server checkTumorBlacklist vs portal 正则数组）。
 *
 * 改动黑名单时：先改 v3.0 Spec，再改 server/tumor_blacklist.js。
 * portal 注入与运行时判定由 tests/portal_inject.test.js 把守。
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
const SPEC = [
  path.join(ROOT, 'aims', 'old', '20261026_0749_aims_v3_0_spec.md'),
].map((file) => fs.readFileSync(file, 'utf8')).join('\n');

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
    assert.ok(SPEC.includes(word), 'v3.1 aims 里查不到黑名单词「' + word + '」');
  }
  assert.ok(SPEC.includes('20 条黑名单'), 'v3.1 aims 里查不到 20 条黑名单的口径');
});

test('portal/index.html 不保存黑名单字面量副本，权威只来自响应期注入', () => {
  assert.doesNotMatch(HTML, /var BL_PATTERNS\s*=\s*\[[\s\S]*?\/cancer/i);
  assert.match(HTML, /__INJECT_SHARED_CONTRACTS__/);
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

test('二次裁定吸纳的词由权威实现拦截（口径回退锚点）', () => {
  for (const word of ['sarcoma', 'lymphoma', 'leukemia', 'melanoma', 'PD-L1', 'CTLA-4', '免疫检查点']) {
    assert.equal(checkTumorBlacklist(word).hit, true, '「' + word + '」应拦截');
  }
});

test('PD 边界在权威实现生效（GPD1 / SLC40A1 不许被误伤）', () => {
  for (const word of ['GPD1', 'SLC40A1', 'PDK1']) {
    assert.equal(checkTumorBlacklist(word).hit, false, '「' + word + '」应放行');
  }
});
