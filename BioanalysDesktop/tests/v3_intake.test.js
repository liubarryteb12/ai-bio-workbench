/**
 * aims v3.0 intake 契约测试（生物学先验 / 统计阈值 / 排版配置 / 实验设计）。
 *
 * 背景：v3.0 把建项契约从"四段式"扩成四段 + 四个 intake 块。这些字段
 * 直接决定下游脚本跑什么阈值、按什么统计模型、出图套哪个模板，
 * 归一化写错不会立刻报错，而是静默按错误的阈值跑完整个分析。
 * 因此每块都要锁死默认值、非法回退与取值范围。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ANALYSIS_CUTOFFS, CUTOFF_PROFILES, KO_FALLBACK_POLICIES,
  normalizeAnalysisCutoffs, normalizeBiologicalPriors,
  PLOT_LAYOUT_TEMPLATES, DEFAULT_TEMPLATE_ID, normalizePlotLayoutConfig,
  normalizeExperimentalDesign, normalizeValidationGroupMapping, normalizeDataFiles, buildProjectMeta,
} from '../server/project.js';

// ---------- 统计阈值三档 ----------

test('三档阈值数值与 aims v3.0 完全一致', () => {
  assert.deepEqual(ANALYSIS_CUTOFFS.standard_sci, { log2fc: 1.0, padj: 0.05, p: null });
  assert.deepEqual(ANALYSIS_CUTOFFS.sensitive, { log2fc: 0.585, padj: null, p: 0.05 });
  assert.deepEqual(ANALYSIS_CUTOFFS.strict, { log2fc: 1.5, padj: 0.01, p: null });
  assert.deepEqual(CUTOFF_PROFILES, ['standard_sci', 'sensitive', 'strict']);
});

test('阈值归一化：缺失回标准档，非法档位回落并标记', () => {
  const def = normalizeAnalysisCutoffs(undefined);
  assert.equal(def.profile, 'standard_sci');
  assert.equal(def.log2fc_threshold, 1.0);
  assert.equal(def.padj_threshold, 0.05);
  assert.equal(def.max_mt_percent, 15);
  assert.equal(def.profileFallback, false);

  const sens = normalizeAnalysisCutoffs({ profile: 'sensitive' });
  assert.equal(sens.log2fc_threshold, 0.585);
  assert.equal(sens.padj_threshold, 0.05);

  const bad = normalizeAnalysisCutoffs({ profile: 'whatever' });
  assert.equal(bad.profile, 'standard_sci');
  assert.equal(bad.profileFallback, true);
});

test('阈值归一化：调用方给的显式数值优先于档位预设', () => {
  const c = normalizeAnalysisCutoffs({ profile: 'strict', log2fc_threshold: 2.0, max_mt_percent: 20 });
  assert.equal(c.log2fc_threshold, 2.0);
  assert.equal(c.max_mt_percent, 20);
  // padj 未显式给，仍取 strict 预设
  assert.equal(c.padj_threshold, 0.01);
});

// ---------- 生物学先验 ----------

test('focus_genes：数组 / 字符串 / 空值都能归一化，上限 5 个', () => {
  assert.deepEqual(normalizeBiologicalPriors({ focusGenes: ['IL17A', 'S100A8'] }).focus_genes, ['IL17A', 'S100A8']);
  assert.deepEqual(normalizeBiologicalPriors({ focusGenes: 'IL17A, S100A8 S100A9' }).focus_genes, ['IL17A', 'S100A8', 'S100A9']);
  assert.deepEqual(normalizeBiologicalPriors({ focusGenes: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }).focus_genes, ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(normalizeBiologicalPriors(undefined).focus_genes, []);
  assert.deepEqual(normalizeBiologicalPriors({ focusGenes: [' ', ''] }).focus_genes, []);
});

test('敲除靶基因与兜底策略：非法策略回落 strict_abort', () => {
  assert.equal(normalizeBiologicalPriors({ targetKoGene: ' TNF ' }).target_ko_gene, 'TNF');
  assert.equal(normalizeBiologicalPriors({ koFallbackPolicy: 'auto_recommend' }).ko_fallback_policy, 'auto_recommend');
  assert.equal(normalizeBiologicalPriors({ koFallbackPolicy: '随手写的' }).ko_fallback_policy, 'strict_abort');
  assert.equal(normalizeBiologicalPriors(undefined).ko_fallback_policy, 'strict_abort');
  assert.ok(KO_FALLBACK_POLICIES.includes('strict_abort'));
  assert.ok(KO_FALLBACK_POLICIES.includes('auto_recommend'));
});

// ---------- 排版两档（4:3 / 16:9） ----------

test('两档模板的图例/画幅/脚注配置符合 2026-10-19 拍板的映射表', () => {
  const t4x3 = PLOT_LAYOUT_TEMPLATES.template_4x3;
  const t16x9 = PLOT_LAYOUT_TEMPLATES.template_16x9;
  assert.equal(t4x3.legend_position, 'outside_right');
  assert.equal(t4x3.legend_direction, 'vertical');
  assert.equal(t4x3.axis_style, 'classic_L');
  assert.equal(t4x3.aspect_ratio, '4:3');
  assert.equal(t4x3.x_label_rotation, 'auto_45');
  assert.equal(t4x3.show_footnote_panel, false);
  assert.equal(t16x9.legend_position, 'bottom_center');
  assert.equal(t16x9.legend_direction, 'horizontal');
  assert.equal(t16x9.axis_style, 'boxed');
  assert.equal(t16x9.aspect_ratio, '16:9');
  assert.equal(t16x9.x_label_rotation, 'auto_45');
  assert.equal(t16x9.show_footnote_panel, true);
  // 模板 id 恰好是新两档
  assert.deepEqual(Object.keys(PLOT_LAYOUT_TEMPLATES).sort(), [
    'template_16x9', 'template_4x3',
  ]);
  assert.equal(DEFAULT_TEMPLATE_ID, 'template_4x3');
});

test('旧 id 兼容：三套旧 id 映射到新 id 后规则逐字段相同', () => {
  const eq = (a, b) => assert.deepEqual(a, b);
  eq(normalizePlotLayoutConfig({ templateId: 'template_2_cell_wide' }),
    normalizePlotLayoutConfig({ templateId: 'template_16x9' }));
  eq(normalizePlotLayoutConfig({ templateId: 'template_1_nature_side' }),
    normalizePlotLayoutConfig({ templateId: 'template_4x3' }));
  eq(normalizePlotLayoutConfig({ templateId: 'template_3_clinical_note' }),
    normalizePlotLayoutConfig({ templateId: 'template_4x3' }));
  // 旧 id 是合法输入，不算回落
  assert.equal(normalizePlotLayoutConfig({ templateId: 'template_2_cell_wide' }).templateFallback, false);
});

test('排版归一化：缺失 / 非法回落默认模板，dpi 恒 300', () => {
  assert.equal(normalizePlotLayoutConfig(undefined).template_id, 'template_4x3');
  assert.equal(normalizePlotLayoutConfig({ templateId: 'template_16x9' }).template_id, 'template_16x9');
  const bad = normalizePlotLayoutConfig({ templateId: 'nope' });
  assert.equal(bad.template_id, 'template_4x3');
  assert.equal(bad.templateFallback, true);
  for (const cfg of [undefined, { templateId: 'x' }, { templateId: 'template_3_clinical_note' }]) {
    assert.equal(normalizePlotLayoutConfig(cfg).dpi, 300);
  }
});

// ---------- 实验设计（配对 / 协变量） ----------

test('配对设计：未勾选时 pair_map 强制清空，避免残留污染下游模型', () => {
  const r = normalizeExperimentalDesign({ isPaired: false, pairMap: { GSM1: 'D1', GSM2: 'D1' } });
  assert.equal(r.is_paired, false);
  assert.deepEqual(r.pair_map, {});
});

test('配对设计：勾选后保留 pair_map 与协变量', () => {
  const r = normalizeExperimentalDesign({
    isPaired: true,
    pairMap: { GSM1: 'Donor_01', GSM2: 'Donor_01' },
    covariates: { batchCol: 'plate', adjustedVariables: ['age', 'sex'] },
  });
  assert.equal(r.is_paired, true);
  assert.deepEqual(r.pair_map, { GSM1: 'Donor_01', GSM2: 'Donor_01' });
  assert.equal(r.cov.batch_col, 'plate');
  assert.deepEqual(r.cov.adjusted_variables, ['age', 'sex']);
});

test('实验设计：缺省值安全', () => {
  const r = normalizeExperimentalDesign(undefined);
  assert.equal(r.is_paired, false);
  assert.deepEqual(r.pair_map, {});
  assert.equal(r.cov.batch_col, '');
  assert.deepEqual(r.cov.adjusted_variables, []);
});

// ---------- 验证集分组映射 ----------

test('验证集映射：正常填写裁剪空白并保留两侧', () => {
  const r = normalizeValidationGroupMapping({
    valControlSamples: [' GSM1 ', 'GSM2', ''],
    valTreatSamples: ['GSM3', 'GSM4'],
  });
  assert.deepEqual(r.val_control_samples, ['GSM1', 'GSM2']);
  assert.deepEqual(r.val_treat_samples, ['GSM3', 'GSM4']);
  assert.equal(r.invalid, false);
});

test('验证集映射：兼容 snake_case 键名', () => {
  const r = normalizeValidationGroupMapping({ val_control_samples: ['A'], val_treat_samples: ['B'] });
  assert.deepEqual(r.val_control_samples, ['A']);
  assert.deepEqual(r.val_treat_samples, ['B']);
  assert.equal(r.invalid, false);
});

test('验证集映射：兼容 aims 示例里的 gsms 键名', () => {
  const r = normalizeValidationGroupMapping({ val_control_gsms: ['GSM1'], val_treat_gsms: ['GSM3'] });
  assert.deepEqual(r.val_control_samples, ['GSM1']);
  assert.deepEqual(r.val_treat_samples, ['GSM3']);
  assert.equal(r.invalid, false);
});

test('验证集映射：缺省 / 非数组一律回落空数组并标 invalid', () => {
  for (const input of [undefined, null, {}, { valControlSamples: 'GSM1', valTreatSamples: ['GSM3'] }]) {
    const r = normalizeValidationGroupMapping(input);
    assert.deepEqual(r.val_control_samples, []);
    assert.deepEqual(r.val_treat_samples, []);
    assert.equal(r.invalid,true);
  }
});

test('验证集映射：同一批样本横跨两侧时直接拒绝（冻结评估会失真）', () => {
  assert.throws(
    () => normalizeValidationGroupMapping({ valControlSamples: ['GSM1', 'GSM9'], valTreatSamples: ['GSM9', 'GSM3'] }),
    /同时出现在对照与处理两侧/
  );
});

// ---------- 数据文件清单 ----------

test('dataFiles：正常清单归一化并保留 sha256', () => {
  const r = normalizeDataFiles([
    { role: 'train_matrix', bind: 'GSE277173', name: 'm.txt', path: 'PKG_x/raw_data/train_matrix__GSE277173__m.txt', size: 10, sha256: 'abc' },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].role, 'train_matrix');
  assert.equal(r[0].bind, 'GSE277173');
  assert.equal(r[0].sha256, 'abc');
});

test('dataFiles：缺 name 或 path 的条目被丢弃而不是写进 project.json', () => {
  const r = normalizeDataFiles([
    { role: 'other', name: '', path: 'PKG_x/raw_data/a.tsv' },
    { role: 'other', name: 'b.tsv', path: '' },
    null,
    { role: 'other', name: 'ok.tsv', path: 'PKG_x/raw_data/ok.tsv' },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].name, 'ok.tsv');
});

test('dataFiles：路径穿越与绝对路径一律拒绝', () => {
  for (const bad of ['../etc/passwd', '/etc/passwd', 'PKG_x\\raw_data\\a.tsv']) {
    assert.throws(
      () => normalizeDataFiles([{ role: 'other', name: 'a.tsv', path: bad }]),
      /数据文件路径非法/,
      bad
    );
  }
});

test('buildProjectMeta：dataFiles 落进 project.json', () => {
  const meta = buildProjectMeta({
    id: 'prj_df',
    basicInfo: { name: '数据文件' },
    groupingDesign: twoGroups,
    dataFiles: [{ role: 'train_matrix', bind: 'GSE277173', name: 'm.txt', path: 'PKG_x/raw_data/m.txt', size: 3 }],
  });
  assert.equal(meta.data_files.length, 1);
  assert.equal(meta.data_files[0].path, 'PKG_x/raw_data/m.txt');
});

test('buildProjectMeta：不传 dataFiles 时为空数组（不留 undefined）', () => {
  const meta = buildProjectMeta({ id: 'prj_df2', basicInfo: { name: '无文件' }, groupingDesign: twoGroups });
  assert.deepEqual(meta.data_files, []);
});

// ---------- 集成 ----------

const twoGroups = {
  mode: 'two_group',
  groups: [
    { groupId: 'g1', groupName: '对照', role: 'reference', stageOrder: 0, colorHex: '#3B4992', sampleIds: ['GSM1', 'GSM2'] },
    { groupId: 'g2', groupName: '处理', role: 'disease_stage', stageOrder: 1, colorHex: '#EE0000', sampleIds: ['GSM3', 'GSM4'] },
  ],
};

test('buildProjectMeta：四个 intake 块全部落进 project.json', () => {
  const meta = buildProjectMeta({
    id: 'prj_v3',
    basicInfo: { name: 'v3 契约' },
    groupingDesign: twoGroups,
    biologicalPriors: { focusGenes: ['IL17A', 'S100A8'], targetKoGene: 'TNF' },
    analysisCutoffs: { profile: 'sensitive' },
    plotLayoutConfig: { templateId: 'template_2_cell_wide' },
    experimentalDesign: { isPaired: true, pairMap: { GSM1: 'D1', GSM2: 'D1' } },
  });
  assert.equal(meta.schema_version, 3);
  assert.deepEqual(meta.biological_priors.focus_genes, ['IL17A', 'S100A8']);
  assert.equal(meta.biological_priors.target_ko_gene, 'TNF');
  assert.equal(meta.analysis_cutoffs.profile, 'sensitive');
  assert.equal(meta.analysis_cutoffs.log2fc_threshold, 0.585);
  // 旧 id 落进 project.json 时归一成新 id（规则逐字段相同）
  assert.equal(meta.plot_layout_config.template_id, 'template_16x9');
  assert.equal(meta.plot_layout_config.theme_rules.legend_position, 'bottom_center');
  assert.equal(meta.experimental_design.is_paired, true);
  assert.deepEqual(meta.experimental_design.pair_map, { GSM1: 'D1', GSM2: 'D1' });
});

test('buildProjectMeta：什么都不传时四块取安全默认值（不抛错、不留 undefined）', () => {
  const meta = buildProjectMeta({ id: 'prj_default', basicInfo: { name: '默认' }, groupingDesign: twoGroups });
  assert.deepEqual(meta.biological_priors, { focus_genes: [], target_ko_gene: '', ko_fallback_policy: 'strict_abort' });
  assert.equal(meta.analysis_cutoffs.profile, 'standard_sci');
  assert.equal(meta.plot_layout_config.template_id, 'template_4x3');
  assert.equal(meta.experimental_design.is_paired, false);
  assert.deepEqual(meta.validation_group_mapping, { val_control_samples: [], val_treat_samples: [], invalid: true });
});

test('buildProjectMeta：验证集映射落进 project.json', () => {
  const meta = buildProjectMeta({
    id: 'prj_vm',
    basicInfo: { name: '验证集映射' },
    groupingDesign: twoGroups,
    validationGroupMapping: { valControlSamples: ['GSM1', 'GSM2'], valTreatSamples: ['GSM3'] },
  });
  assert.deepEqual(meta.validation_group_mapping.val_control_samples, ['GSM1', 'GSM2']);
  assert.deepEqual(meta.validation_group_mapping.val_treat_samples, ['GSM3']);
  assert.equal(meta.validation_group_mapping.invalid, false);
});

test('buildProjectMeta：验证集映射两侧重叠时建项被拒', () => {
  assert.throws(
    () => buildProjectMeta({
      id: 'prj_vm_bad',
      basicInfo: { name: '重叠' },
      groupingDesign: twoGroups,
      validationGroupMapping: { valControlSamples: ['GSM9'], valTreatSamples: ['GSM9'] },
    }),
    /同时出现在对照与处理两侧/
  );
});

test('buildProjectMeta：focus_genes 命中黑名单时建项被拒', () => {
  assert.throws(
    () => buildProjectMeta({
      id: 'prj_bl',
      basicInfo: { name: '黑名单基因' },
      groupingDesign: twoGroups,
      biologicalPriors: { focusGenes: ['cancer_gene'] },
    }),
    /非肿瘤合规拦截/
  );
});
