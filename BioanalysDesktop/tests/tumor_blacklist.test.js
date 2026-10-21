import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BLACKLIST_PATTERNS,
  BLACKLIST_HINT,
  checkTumorBlacklist,
  validateProjectFields,
} from '../server/tumor_blacklist.js';

/**
 * 非肿瘤黑名单口径测试（B3 切片）。
 *
 * 规格正本：aims/aims.txt §三.1 模块 A「黑名单确认清单」20 条
 * （2026-10-21 二次裁定：以 aims 为准，吸纳实现侧 27 条中可用的 12 条，
 *  剔除 8 条被父词覆盖的冗余项）。
 *
 * 本文件是口径的锚，五件事都锁住：
 * 1) 20 条规格词必须逐条命中；
 * 2) 被剔除的 8 条冗余项仍因父词命中（如实记录边界，不假装它们不拦）；
 * 3) PD-L1 / PD-1 的边界写法不许回退成 /PD-?L?1/（否则 GPD1、SLC40A1 被误伤）；
 * 4) 正常非肿瘤文本不被误伤；
 * 5) validateProjectFields 全量 key 扫描（踩坑台账 #153 回归）。
 */

// aims 清单 20 条原文，顺序与 tumor_blacklist.js 的 BLACKLIST_PATTERNS 一致
const SPEC_PATTERNS = [
  /cancer/i,
  /tumor/i,
  /tumour/i,
  /carcinoma/i,
  /glioma/i,
  /sarcoma/i,
  /lymphoma/i,
  /leukemia/i,
  /leukaemia/i,
  /melanoma/i,
  /immune\s*infiltration/i,
  /immune\s*checkpoint/i,
  /(?<![A-Za-z0-9])PD-?L1(?![0-9])/i,
  /(?<![A-Za-z0-9])PD-?1(?![0-9])/i,
  /CTLA-?4/i,
  /oncogene/i,
  /肿瘤/,
  /癌/,
  /免疫浸润/,
  /免疫检查点/,
];

test('黑名单恰好 20 条，且与 aims 清单逐条同序一致', () => {
  assert.equal(BLACKLIST_PATTERNS.length, 20, '规格正本为 20 条，多一条或少一条都算口径漂移');
  SPEC_PATTERNS.forEach((spec, index) => {
    const actual = BLACKLIST_PATTERNS[index];
    assert.ok(actual instanceof RegExp, `第 ${index + 1} 条应是正则`);
    assert.equal(String(actual), String(spec), `第 ${index + 1} 条与 aims 清单不一致`);
  });
});

test('英文模式大小写不敏感', () => {
  for (const text of ['CANCER', 'Tumor', 'TUMOUR', 'CARCINOMA', 'Glioma', 'SARCOMA', 'IMMUNE INFILTRATION', 'ONCOGENE']) {
    assert.equal(checkTumorBlacklist(text).hit, true, `应命中: ${text}`);
  }
});

test('逐模式正例：20 条模式各自命中规格词', () => {
  const cases = [
    { text: 'Breast cancer cohort', expected: 'cancer' },
    { text: 'tumor suppressor gene', expected: 'tumor' },
    { text: 'tumour microenvironment', expected: 'tumour' },
    { text: 'hepatocellular carcinoma', expected: 'carcinoma' },
    { text: 'glioma stem cells', expected: 'glioma' },
    { text: 'Ewing sarcoma biopsy', expected: 'sarcoma' },
    { text: 'diffuse large B cell lymphoma', expected: 'lymphoma' },
    { text: 'acute myeloid leukemia', expected: 'leukemia' },
    { text: 'acute lymphoblastic leukaemia', expected: 'leukaemia' },
    { text: 'cutaneous melanoma', expected: 'melanoma' },
    { text: 'immune infiltration score', expected: 'immune infiltration' },
    { text: 'immune checkpoint blockade', expected: 'immune checkpoint' },
    { text: 'PD-L1 IHC score', expected: 'PD-L1' },
    { text: 'PD-1 expression', expected: 'PD-1' },
    { text: 'CTLA-4 antibody', expected: 'CTLA-4' },
    { text: 'oncogene addiction', expected: 'oncogene' },
    { text: '肿瘤微环境', expected: '肿瘤' },
    { text: '癌症', expected: '癌' },
    { text: '免疫浸润分析', expected: '免疫浸润' },
    { text: '免疫检查点抑制剂', expected: '免疫检查点' },
  ];
  assert.equal(cases.length, 20, '逐模式正例必须覆盖 20 条');
  for (const { text, expected } of cases) {
    const result = checkTumorBlacklist(text);
    assert.equal(result.hit, true, `应命中: ${text}`);
    assert.equal(result.matches[0], expected, `命中词不对: ${text}`);
  }
});

test('immune infiltration / immune checkpoint 允许词间空白', () => {
  for (const text of [
    'immune infiltration', 'Immune  Infiltration', 'immune\tinfiltration',
    'immune checkpoint', 'Immune   Checkpoint',
  ]) {
    assert.equal(checkTumorBlacklist(text).hit, true, `应命中: ${JSON.stringify(text)}`);
  }
});

test('PD-L1 / PD-1 两种写法都命中（连字符可省）', () => {
  for (const text of ['PD-L1', 'PDL1', 'pd-l1', 'PD-1', 'PD1', 'pd1']) {
    assert.equal(checkTumorBlacklist(text).hit, true, `应命中: ${text}`);
  }
});

test('PD 边界：GPD1 / SLC40A1 等基因符号不许被误伤（2026-10-21 二次裁定实测）', () => {
  for (const text of ['GPD1 表达上调', 'SLC40A1 转运蛋白', 'PDK1 激酶活性', 'PDGFB 通路', 'TPD52 基因']) {
    assert.equal(checkTumorBlacklist(text).hit, false, `不应命中: ${text}`);
  }
});

test('被剔除的 8 条冗余项仍因父词命中（如实记录边界，不是漏洞）', () => {
  const stillHit = [
    ['adenocarcinoma', 'carcinoma'],
    ['squamous cell carcinoma', 'carcinoma'],
    ['tumor microenvironment', 'tumor'],
    ['tumour microenvironment', 'tumour'],
    ['tumor suppressor', 'tumor'],
    ['癌症', '癌'],
    ['肿瘤微环境', '肿瘤'],
    ['癌细胞', '癌'],
    ['致癌物', '癌'],
    ['免疫浸润微环境', '免疫浸润'],
  ];
  for (const [text, expected] of stillHit) {
    const result = checkTumorBlacklist(text);
    assert.equal(result.hit, true, `应命中: ${text}`);
    assert.equal(result.matches[0], expected, `命中词不对: ${text}`);
  }
});

test('正常非肿瘤文本必须放行（误伤负例）', () => {
  const safe = [
    '缺血性脑卒中核心 Hub 基因筛选与 SHAP 可解释性验证',
    '阿尔茨海默病海马区单细胞转录组图谱',
    '特发性肺纤维化成纤维细胞活化机制',
    '代谢相关脂肪性肝病与肠道菌群',
    '帕金森病多巴胺能神经元退变',
    '免疫',                    // 领域下拉的"免疫"是合规研究领域
    '免疫微环境',              // 不含"免疫浸润"
    'TP53、EGFR、MYC 关注基因',
    'GSE16561 / GPL6883 外周血队列',
    'PDK1 与 AKT 磷酸化',
  ];
  for (const text of safe) {
    assert.equal(checkTumorBlacklist(text).hit, false, `不应命中: ${text}`);
  }
});

test('子串匹配的固有边界："非肿瘤"仍会被拦（如实记录，不视为 bug）', () => {
  const result = checkTumorBlacklist('非肿瘤疾病对照队列');
  assert.equal(result.hit, true);
  assert.equal(result.matches[0], '肿瘤');
});

test('matches 去重且保留原文大小写', () => {
  const result = checkTumorBlacklist('CANCER 与 cancer 的肿瘤研究');
  assert.equal(result.hit, true);
  assert.deepEqual(result.matches, ['CANCER', '肿瘤']);
});

test('空值与非字符串输入安全放行', () => {
  for (const input of ['', '   ', null, undefined, 0, 123, {}, []]) {
    const result = checkTumorBlacklist(input);
    assert.equal(result.hit, false, `不应命中: ${String(input)}`);
    assert.deepEqual(result.matches, []);
  }
});

test('BLACKLIST_HINT 保持非肿瘤定位提示', () => {
  assert.ok(BLACKLIST_HINT.includes('非肿瘤'), '提示应说明专精非肿瘤领域');
  assert.ok(BLACKLIST_HINT.includes('肿瘤/免疫浸润'), '提示应说明不接收肿瘤/免疫浸润项目');
});

test('validateProjectFields：固定语义字段逐字段命中', () => {
  const cases = [
    ['name', { name: '肿瘤微环境项目' }],
    ['description', { description: '拟分析 cancer 样本' }],
    ['disease', { disease: 'glioma' }],
    ['tissue', { tissue: 'carcinoma adjacent tissue' }],
    ['notes', { notes: '客户希望做免疫浸润打分' }],
  ];
  for (const [field, fields] of cases) {
    const result = validateProjectFields(fields);
    assert.equal(result.hit, true, `字段 ${field} 应命中`);
    assert.equal(result.field, field);
    assert.ok(result.matches.length > 0);
  }
});

test('validateProjectFields：非固定 key 也全量扫描（踩坑台账 #153 回归）', () => {
  const groupHit = validateProjectFields({ name: '脑卒中队列', 'group_试验组': '肿瘤组' });
  assert.equal(groupHit.hit, true, 'group_* 必须过检');
  assert.equal(groupHit.field, 'group_试验组');

  const geneHit = validateProjectFields({ name: '脑卒中队列', focus_gene_cancer_gene: 'cancer_gene' });
  assert.equal(geneHit.hit, true, 'focus_gene_* 必须过检');
  assert.equal(geneHit.field, 'focus_gene_cancer_gene');

  const absorbedHit = validateProjectFields({ name: '脑卒中队列', notes: '顺带看 immune checkpoint' });
  assert.equal(absorbedHit.hit, true, '二次裁定吸纳的 immune checkpoint 必须过检');
});

test('validateProjectFields：无命中与空输入安全', () => {
  const clean = validateProjectFields({
    name: '脑卒中队列',
    description: '比较对照组与处理组的差异表达',
    disease: 'Ischemic Stroke',
    tissue: 'Peripheral Blood',
    notes: '无',
    'group_对照组': 'Control',
    focus_gene_TP53: 'TP53',
    focus_gene_GPD1: 'GPD1',
  });
  assert.deepEqual(clean, { hit: false, matches: [], field: null });

  assert.deepEqual(validateProjectFields({}), { hit: false, matches: [], field: null });
  assert.deepEqual(validateProjectFields(), { hit: false, matches: [], field: null });
  assert.deepEqual(validateProjectFields(null), { hit: false, matches: [], field: null });
});

test('validateProjectFields：非字符串字段值不抛错', () => {
  const result = validateProjectFields({ name: 123, description: {}, tissue: [] });
  assert.equal(result.hit, false);
});
