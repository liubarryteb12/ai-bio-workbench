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
 * 规格正本：aims/aims.txt §三.1 模块 A「黑名单确认清单」8 条
 * （2026-10-21 用户裁定：由 27 条收敛回 8 条）。
 *
 * 本文件是口径的锚，四件事都锁住：
 * 1) 8 条规格词必须逐条命中；
 * 2) 被收敛掉的历史扩充词不再命中（防止口径悄悄漂回去）；
 * 3) 正常非肿瘤文本不被误伤；
 * 4) validateProjectFields 全量 key 扫描（踩坑台账 #153 回归）。
 */

// aims 清单 8 条原文，顺序与 tumor_blacklist.js 的 BLACKLIST_PATTERNS 一致
const SPEC_PATTERNS = [
  /cancer/i,
  /tumor/i,
  /carcinoma/i,
  /glioma/i,
  /immune\s*infiltration/i,
  /肿瘤/,
  /癌/,
  /免疫浸润/,
];

test('黑名单恰好 8 条，且与 aims 清单逐条同序一致', () => {
  assert.equal(BLACKLIST_PATTERNS.length, 8, '规格正本为 8 条，多一条或少一条都算口径漂移');
  SPEC_PATTERNS.forEach((spec, index) => {
    const actual = BLACKLIST_PATTERNS[index];
    assert.ok(actual instanceof RegExp, `第 ${index + 1} 条应是正则`);
    assert.equal(String(actual), String(spec), `第 ${index + 1} 条与 aims 清单不一致`);
  });
});

test('英文模式大小写不敏感', () => {
  for (const text of ['CANCER', 'Tumor', 'CARCINOMA', 'Glioma', 'IMMUNE INFILTRATION']) {
    assert.equal(checkTumorBlacklist(text).hit, true, `应命中: ${text}`);
  }
});

test('逐模式正例：8 条模式各自命中规格词', () => {
  const cases = [
    { pattern: /cancer/i, text: 'Breast cancer cohort', expected: 'cancer' },
    { pattern: /tumor/i, text: 'tumor suppressor gene', expected: 'tumor' },
    { pattern: /carcinoma/i, text: 'hepatocellular carcinoma', expected: 'carcinoma' },
    { pattern: /glioma/i, text: 'glioma stem cells', expected: 'glioma' },
    { pattern: /immune\s*infiltration/i, text: 'immune infiltration score', expected: 'immune infiltration' },
    { pattern: /肿瘤/, text: '肿瘤微环境', expected: '肿瘤' },
    { pattern: /癌/, text: '癌症', expected: '癌' },
    { pattern: /免疫浸润/, text: '免疫浸润分析', expected: '免疫浸润' },
  ];
  assert.equal(cases.length, 8, '逐模式正例必须覆盖 8 条');
  for (const { pattern, text, expected } of cases) {
    const result = checkTumorBlacklist(text);
    assert.equal(result.hit, true, `模式 ${pattern} 应命中: ${text}`);
    assert.equal(result.matches[0], expected, `模式 ${pattern} 命中词不对`);
  }
});

test('immune infiltration 允许词间空白', () => {
  for (const text of ['immune infiltration', 'Immune  Infiltration', 'immune\tinfiltration']) {
    assert.equal(checkTumorBlacklist(text).hit, true, `应命中: ${JSON.stringify(text)}`);
  }
});

test('收敛后不再命中的历史扩充词（口径回退的回归锚）', () => {
  const removed = [
    'tumour',                  // 英式拼写
    'tumour microenvironment',
    'sarcoma',
    'lymphoma',
    'leukemia',
    'leukaemia',
    'melanoma',
    'immune checkpoint',
    'PD-L1',
    'PD1',
    'CTLA-4',
    'oncogene',
    '免疫检查点',
  ];
  for (const text of removed) {
    assert.equal(checkTumorBlacklist(text).hit, false, `27 条时代的扩充词不应再单独拦截: ${text}`);
  }
});

test('父词覆盖：这些词虽移出清单，仍因含父词而命中（如实记录边界）', () => {
  const stillHit = [
    ['adenocarcinoma', 'carcinoma'],
    ['squamous cell carcinoma', 'carcinoma'],
    ['tumor microenvironment', 'tumor'],
    ['肿瘤微环境', '肿瘤'],
    ['癌细胞', '癌'],
    ['癌症', '癌'],
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
    'PD1 抑制剂处理组',        // PD-L1 模式收敛后不再误伤 PD1 标识符
    'CTLA4 表达量差异',
    'TP53、EGFR、MYC 关注基因',
    'GSE16561 / GPL6883 外周血队列',
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
