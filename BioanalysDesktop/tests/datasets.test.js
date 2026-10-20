/**
 * 数据集 ↔ 平台配对归一化的单元测试。
 *
 * 用户端提交的 manifest 可能是两种形态：
 *   - 新格式：dataSource.datasets = [{gse, gpl, role, dataType, sampleCount, tissue}]（显式配对，可信）
 *   - 旧格式：dataSource.trainGse / valGse / gpl 三个扁平数组（无显式对应，须推断）
 * 工作台读收件箱时统一走 normalizeDatasets 归一化，inferred=true 必须提示用户核对。
 *
 * 2026-10-19：每行新增「数据类型 / 样本数量 / 组织来源」三元组。
 * 一个项目合入多个 GSE 时这三项常不同，只按项目级存一份会让预处理用错注释分支。
 * 纯函数，不依赖网络与手机。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeDatasets,
  normalizeDatasetDataType,
  normalizeDatasetSampleCount,
} from '../server/domain.js';

/** 补齐行级三元组默认值，避免每个用例都写一遍 */
const row = (gse, gpl, role, extra = {}) => ({
  gse, gpl, role, dataType: '', sampleCount: 0, tissue: '', ...extra,
});

test('新格式：显式配对透传，inferred=false', () => {
  const { datasets, inferred } = normalizeDatasets({
    datasets: [
      { gse: ' GSE16561 ', gpl: ' GPL6883 ', role: 'train' },
      { gse: 'GSE58294', gpl: 'GPL570', role: 'validation' },
    ],
  });
  assert.equal(inferred, false);
  assert.deepEqual(datasets, [
    row('GSE16561', 'GPL6883', 'train'),
    row('GSE58294', 'GPL570', 'validation'),
  ]);
});

test('新格式：空 gse 行被剔除，role 非法一律归为 train', () => {
  const { datasets } = normalizeDatasets({
    datasets: [
      { gse: '', gpl: 'GPL6883', role: 'train' },
      { gse: 'GSE1', gpl: 'GPL1', role: 'whatever' },
      null,
    ],
  });
  assert.deepEqual(datasets, [row('GSE1', 'GPL1', 'train')]);
});

test('旧格式：按位置逐行配对，inferred=true', () => {
  const { datasets, inferred } = normalizeDatasets({
    trainGse: ['GSE16561'],
    valGse: ['GSE58294'],
    gpl: ['GPL6883', 'GPL570'],
  });
  assert.equal(inferred, true);
  assert.deepEqual(datasets, [
    row('GSE16561', 'GPL6883', 'train'),
    row('GSE58294', 'GPL570', 'validation'),
  ]);
});

test('旧格式：单个 GPL 广播给全部 GSE（单平台多数据集）', () => {
  const { datasets, inferred } = normalizeDatasets({
    trainGse: ['GSE1', 'GSE2'],
    valGse: ['GSE3'],
    gpl: ['GPL6883'],
  });
  assert.equal(inferred, true);
  assert.deepEqual(datasets, [
    row('GSE1', 'GPL6883', 'train'),
    row('GSE2', 'GPL6883', 'train'),
    row('GSE3', 'GPL6883', 'validation'),
  ]);
});

test('旧格式：GPL 数量对不上时越界留空，宁缺勿错配', () => {
  const { datasets, inferred } = normalizeDatasets({
    trainGse: ['GSE1', 'GSE2'],
    valGse: [],
    gpl: ['GPL1', 'GPL2', 'GPL3'],
  });
  assert.equal(inferred, true);
  assert.deepEqual(datasets, [
    row('GSE1', 'GPL1', 'train'),
    row('GSE2', 'GPL2', 'train'),
  ]);
  const missing = normalizeDatasets({ trainGse: ['GSE1', 'GSE2'], gpl: ['GPL1'] });
  assert.deepEqual(missing.datasets, [
    row('GSE1', 'GPL1', 'train'),
    row('GSE2', 'GPL1', 'train'),
  ]);
});

test('无数据集：返回空表且不标推断', () => {
  assert.deepEqual(normalizeDatasets(undefined), { datasets: [], inferred: false });
  assert.deepEqual(normalizeDatasets({ dataType: 'spatial' }), { datasets: [], inferred: false });
  assert.deepEqual(normalizeDatasets({ trainGse: [], valGse: [], gpl: [] }), { datasets: [], inferred: false });
});

test('旧格式：GPL 缺失时配对表仍生成，gpl 留空', () => {
  const { datasets, inferred } = normalizeDatasets({ trainGse: ['GSE1'], valGse: ['GSE2'] });
  assert.equal(inferred, true);
  assert.deepEqual(datasets, [
    row('GSE1', '', 'train'),
    row('GSE2', '', 'validation'),
  ]);
});

// ---------- 行级三元组：数据类型 / 样本数量 / 组织来源 ----------

test('行级三元组：显式填写时原样保留（多 GSE 各不同）', () => {
  const { datasets } = normalizeDatasets({
    datasets: [
      { gse: 'GSE16561', gpl: 'GPL6883', role: 'train', dataType: 'microarray', sampleCount: 60, tissue: 'Peripheral Blood' },
      { gse: 'GSE58294', gpl: '', role: 'validation', dataType: 'bulk_rnaseq', sampleCount: 24, tissue: 'Skin Lesion' },
    ],
  });
  assert.deepEqual(datasets.map((d) => [d.dataType, d.sampleCount, d.tissue]), [
    ['microarray', 60, 'Peripheral Blood'],
    ['bulk_rnaseq', 24, 'Skin Lesion'],
  ]);
});

test('行级三元组：行内未填时继承项目级，逐行可覆盖', () => {
  const { datasets } = normalizeDatasets({
    dataType: 'microarray',
    sampleCount: 60,
    tissue: 'Peripheral Blood',
    datasets: [
      { gse: 'GSE1', gpl: 'GPL1', role: 'train' },
      { gse: 'GSE2', gpl: '', role: 'validation', dataType: 'bulk_rnaseq', sampleCount: 24, tissue: 'Liver' },
    ],
  });
  assert.deepEqual(datasets.map((d) => [d.dataType, d.sampleCount, d.tissue]), [
    ['microarray', 60, 'Peripheral Blood'],
    ['bulk_rnaseq', 24, 'Liver'],
  ]);
});

test('行级三元组：项目级也没有时留空串 / 0，不编造默认值', () => {
  const { datasets } = normalizeDatasets({ datasets: [{ gse: 'GSE1', gpl: 'GPL1', role: 'train' }] });
  assert.equal(datasets[0].dataType, '');
  assert.equal(datasets[0].sampleCount, 0);
  assert.equal(datasets[0].tissue, '');
});

test('行级三元组：旧扁平格式同样继承项目级值', () => {
  const { datasets } = normalizeDatasets({
    dataType: 'scrna',
    sampleCount: 12,
    tissue: 'Brain Cortex',
    trainGse: ['GSE1'],
    valGse: ['GSE2'],
    gpl: [],
  });
  assert.deepEqual(datasets.map((d) => [d.dataType, d.sampleCount, d.tissue]), [
    ['scrna', 12, 'Brain Cortex'],
    ['scrna', 12, 'Brain Cortex'],
  ]);
});

test('dataType 归一化：只认四种枚举，大小写与空白不容忍', () => {
  assert.equal(normalizeDatasetDataType('microarray'), 'microarray');
  assert.equal(normalizeDatasetDataType(' Microarray '), '');
  assert.equal(normalizeDatasetDataType('RNA-seq'), '');
  assert.equal(normalizeDatasetDataType(undefined), '');
  assert.equal(normalizeDatasetDataType(null), '');
});

test('sampleCount 归一化：只收正整数，非法归 0（表示未填）', () => {
  assert.equal(normalizeDatasetSampleCount(60), 60);
  assert.equal(normalizeDatasetSampleCount('24'), 24);
  assert.equal(normalizeDatasetSampleCount(0), 0);
  assert.equal(normalizeDatasetSampleCount(-3), 0);
  assert.equal(normalizeDatasetSampleCount(2.5), 0);
  assert.equal(normalizeDatasetSampleCount('abc'), 0);
  assert.equal(normalizeDatasetSampleCount(undefined), 0);
});
