/**
 * 数据源双模态契约测试（aims v2.8 细化专题一）。
 *
 * 背景：客户除 GEO 编号外还会自测上传 counts 矩阵，此时没有 GSE/GPL/GSM。
 * 双模态切换如果实现错了，要么把自有样本判成"非法 GSM"直接卡死客户，
 * 要么把公共库的脏编号放过去让 GEOquery 跑飞。两条路径都要守住。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DATA_SOURCE_MODES, ID_TYPES, VALUE_SCALES, ID_TYPE_IDS, VALUE_SCALE_IDS,
  normalizeDataSourceMode, normalizeIdType, normalizeValueScale,
  buildLocAccession, isValidSampleId,
  normalizeDataSource, PUBLIC_ACCESSION_RE, LOC_ACCESSION_RE,
} from '../server/domain.js';
import { buildProjectMeta } from '../server/project.js';

// ---------- 常量与归一化 ----------

test('双模态枚举完整', () => {
  assert.equal(DATA_SOURCE_MODES.length, 2);
  assert.equal(ID_TYPE_IDS.length, 3);
  assert.equal(VALUE_SCALE_IDS.length, 3);
});

test('模式归一化：缺失 / 非法 / 空值一律回落到 PUBLIC_DB，大小写与空白容忍', () => {
  assert.equal(normalizeDataSourceMode(undefined), 'PUBLIC_DB');
  assert.equal(normalizeDataSourceMode(''), 'PUBLIC_DB');
  assert.equal(normalizeDataSourceMode('in_house'), 'PUBLIC_DB');
  assert.equal(normalizeDataSourceMode('IN_HOUSE_UPLOAD'), 'IN_HOUSE_UPLOAD');
  assert.equal(normalizeDataSourceMode(' in_house_upload '), 'IN_HOUSE_UPLOAD');
});

test('id_type / value_scale 归一化：非法返回空串', () => {
  assert.equal(normalizeIdType('Ensembl_ID'), 'Ensembl_ID');
  assert.equal(normalizeIdType('ensembl'), '');
  assert.equal(normalizeIdType(undefined), '');
  assert.equal(normalizeValueScale('Raw_Counts'), 'Raw_Counts');
  assert.equal(normalizeValueScale('raw_counts'), '');
  assert.equal(normalizeValueScale(null), '');
});

// ---------- LOC 内部编号 ----------

test('LOC 编号：train/val 派生正确，正则匹配', () => {
  assert.equal(buildLocAccession('PRJ2026', 'train'), 'LOC_PRJ2026_TRAIN');
  assert.equal(buildLocAccession('PRJ2026', 'validation'), 'LOC_PRJ2026_VAL');
  assert.ok(LOC_ACCESSION_RE.test(buildLocAccession('my-proj_1', 'train')));
  assert.ok(!LOC_ACCESSION_RE.test('GSE16561'));
  assert.ok(PUBLIC_ACCESSION_RE.test('GSE16561'));
  assert.ok(PUBLIC_ACCESSION_RE.test('E-MTAB-1234'));
  assert.ok(!PUBLIC_ACCESSION_RE.test('LOC_prj_TRAIN'));
});

// ---------- 样本编号双模态 ----------

test('样本编号：公共库只认 GSM，自有上传放开限制', () => {
  assert.ok(isValidSampleId('GSM123', 'PUBLIC_DB'));
  assert.ok(!isValidSampleId('Ctrl_1', 'PUBLIC_DB'));
  assert.ok(!isValidSampleId('GSM', 'PUBLIC_DB'));

  assert.ok(isValidSampleId('Ctrl_1', 'IN_HOUSE_UPLOAD'));
  assert.ok(isValidSampleId('Stroke_Mouse.02', 'IN_HOUSE_UPLOAD'));
  assert.ok(isValidSampleId('a-b', 'IN_HOUSE_UPLOAD'));
  assert.ok(!isValidSampleId('has space', 'IN_HOUSE_UPLOAD'));
  assert.ok(!isValidSampleId('', 'IN_HOUSE_UPLOAD'));
  assert.ok(!isValidSampleId('中文样本', 'IN_HOUSE_UPLOAD'));
});

// ---------- normalizeDataSource ----------

const inHouseBase = {
  data_source_mode: 'IN_HOUSE_UPLOAD',
  id_type: 'Ensembl_ID',
  value_scale: 'Raw_Counts',
  species: 'Mus musculus',
  dataType: 'bulk_rnaseq',
  tissue: 'Brain Cortex',
  uploaded_files: { train_matrix: 'raw_data/mouse_cortex_counts.tsv', val_matrix: null },
};

test('IN_HOUSE_UPLOAD：补齐 accession_and_platform 与 LOC 编号', () => {
  const result = normalizeDataSource(inHouseBase, 'PRJ2026');
  assert.equal(result.mode, 'IN_HOUSE_UPLOAD');
  const a = result.accession;
  assert.equal(a.train_id, 'LOC_PRJ2026_TRAIN');
  assert.equal(a.val_id, null);
  assert.equal(a.id_type, 'Ensembl_ID');
  assert.equal(a.value_scale, 'Raw_Counts');
  assert.equal(a.species, 'Mus musculus');
  assert.equal(a.data_modality, 'bulk_rnaseq');
  assert.equal(a.tissue_source, 'Brain Cortex');
  assert.equal(a.uploaded_files.train_matrix, 'raw_data/mouse_cortex_counts.tsv');
  assert.equal(a.uploaded_files.val_matrix, null);
});

test('IN_HOUSE_UPLOAD：只有提供 val_matrix 才派生 _VAL 编号', () => {
  const result = normalizeDataSource({
    ...inHouseBase,
    uploaded_files: { train_matrix: 'raw_data/a.tsv', val_matrix: 'raw_data/b.tsv' },
  }, 'PRJ9');
  assert.equal(result.accession.val_id, 'LOC_PRJ9_VAL');
});

test('IN_HOUSE_UPLOAD：兼容嵌套 accession_and_platform 形态', () => {
  const result = normalizeDataSource({
    data_source_mode: 'IN_HOUSE_UPLOAD',
    accession_and_platform: {
      id_type: 'Gene_Symbol',
      value_scale: 'TPM_FPKM',
      uploaded_files: { train_matrix: 'raw_data/x.tsv' },
    },
  }, 'P1');
  assert.equal(result.accession.id_type, 'Gene_Symbol');
  assert.equal(result.accession.value_scale, 'TPM_FPKM');
  assert.equal(result.accession.uploaded_files.train_matrix, 'raw_data/x.tsv');
});

test('IN_HOUSE_UPLOAD：三个必填缺一即抛错（不静默放行）', () => {
  assert.throws(() => normalizeDataSource({ data_source_mode: 'IN_HOUSE_UPLOAD' }, 'P'), /id_type/);
  assert.throws(
    () => normalizeDataSource({ data_source_mode: 'IN_HOUSE_UPLOAD', id_type: 'Gene_Symbol' }, 'P'),
    /value_scale/
  );
  assert.throws(
    () => normalizeDataSource({ data_source_mode: 'IN_HOUSE_UPLOAD', id_type: 'Gene_Symbol', value_scale: 'Raw_Counts' }, 'P'),
    /train_matrix/
  );
});

test('IN_HOUSE_UPLOAD：无 projectId 时 train_id 留空，不造假编号', () => {
  // 收件箱预览阶段还没有项目 ID，此时不能塞 LOC_UNKNOWN_TRAIN 这类占位编号，
  // 否则会被下游当真实数据集编号用
  const r1 = normalizeDataSource(inHouseBase, '');
  assert.equal(r1.accession.train_id, '');
  assert.equal(r1.accession.val_id, null);
  const r2 = normalizeDataSource({ ...inHouseBase, uploaded_files: { train_matrix: 'raw_data/a.tsv', val_matrix: 'raw_data/b.tsv' } }, '');
  assert.equal(r2.accession.val_id, null);
});

test('PUBLIC_DB：不产出 accession，datasets 走原配对逻辑', () => {
  const result = normalizeDataSource({ dataType: 'microarray', datasets: [{ gse: 'GSE16561', gpl: 'GPL6883', role: 'train' }] }, 'P');
  assert.equal(result.mode, 'PUBLIC_DB');
  assert.equal(result.accession, null);
  assert.equal(result.datasets.length, 1);
  assert.equal(result.datasets[0].gse, 'GSE16561');
});

test('无 dataSource：回落到 PUBLIC_DB 且 datasets 为空（不抛错）', () => {
  const result = normalizeDataSource(undefined, 'P');
  assert.equal(result.mode, 'PUBLIC_DB');
  assert.deepEqual(result.datasets, []);
});

// ---------- buildProjectMeta 集成 ----------

const groupsInHouse = {
  mode: 'two_group',
  groups: [
    { groupId: 'g1', groupName: '对照', role: 'reference', stageOrder: 0, colorHex: '#3B4992', sampleIds: ['Ctrl_1', 'Ctrl_2'] },
    { groupId: 'g2', groupName: '处理', role: 'disease_stage', stageOrder: 1, colorHex: '#EE0000', sampleIds: ['Treat_1', 'Treat_2'] },
  ],
};

test('buildProjectMeta：IN_HOUSE 模式落 data_source_mode + accession_and_platform', () => {
  const meta = buildProjectMeta({
    id: 'prj_inhouse',
    basicInfo: { name: '自有数据项目' },
    dataSource: {
      data_source_mode: 'IN_HOUSE_UPLOAD',
      id_type: 'Ensembl_ID',
      value_scale: 'Raw_Counts',
      species: 'Mus musculus',
      uploaded_files: { train_matrix: 'raw_data/counts.tsv' },
    },
    groupingDesign: groupsInHouse,
  });
  assert.equal(meta.data_source.data_source_mode, 'IN_HOUSE_UPLOAD');
  assert.equal(meta.data_source.accession_and_platform.train_id, 'LOC_prj_inhouse_TRAIN');
  assert.equal(meta.data_source.accession_and_platform.id_type, 'Ensembl_ID');
});

test('buildProjectMeta：自有样本编号在 IN_HOUSE 下通过，Public 下被拒', () => {
  const base = {
    id: 'prj_mode',
    basicInfo: { name: '样本编号口径' },
    dataSource: { source: 'GEO', dataType: 'microarray', datasets: [{ gse: 'GSE1', gpl: 'GPL1', role: 'train' }] },
    groupingDesign: groupsInHouse,
  };
  // 公共库模式下 Ctrl_1 不是合法 GSM
  assert.throws(() => buildProjectMeta(base), /样本编号格式非法.*公共数据库模式/);
  // 切成自有上传模式后放行
  const meta = buildProjectMeta({
    ...base,
    dataSource: { ...base.dataSource, ...inHouseBase, dataType: undefined },
  });
  assert.equal(meta.data_source.data_source_mode, 'IN_HOUSE_UPLOAD');
});

test('buildProjectMeta：IN_HOUSE 缺 id_type 时建项被拒（不落残缺 project.json）', () => {
  assert.throws(
    () => buildProjectMeta({
      id: 'prj_bad',
      basicInfo: { name: '缺 id_type' },
      dataSource: { data_source_mode: 'IN_HOUSE_UPLOAD', value_scale: 'Raw_Counts', uploaded_files: { train_matrix: 'raw_data/a.tsv' } },
      groupingDesign: groupsInHouse,
    }),
    /id_type/
  );
});

test('buildProjectMeta：行级三元组逐行落盘，不被项目级覆盖', () => {
  const meta = buildProjectMeta({
    id: 'prj_triple',
    basicInfo: { name: '多数据集三元组' },
    dataSource: {
      source: 'GEO',
      dataType: 'microarray',
      sampleCount: 84,
      tissue: 'Peripheral Blood',
      datasets: [
        { gse: 'GSE16561', gpl: 'GPL6883', role: 'train', dataType: 'microarray', sampleCount: 60, tissue: 'Peripheral Blood' },
        { gse: 'GSE58294', gpl: '', role: 'validation', dataType: 'bulk_rnaseq', sampleCount: 24, tissue: 'Skin Lesion' },
      ],
    },
    groupingDesign: {
      mode: 'two_group',
      groups: [
        { groupId: 'g1', groupName: '对照', role: 'reference', stageOrder: 0, colorHex: '#3B4992', sampleIds: ['GSM1', 'GSM2'] },
        { groupId: 'g2', groupName: '处理', role: 'disease_stage', stageOrder: 1, colorHex: '#EE0000', sampleIds: ['GSM3'] },
      ],
    },
  });
  assert.deepEqual(
    meta.data_source.datasets.map((d) => [d.gse, d.dataType, d.sampleCount, d.tissue]),
    [
      ['GSE16561', 'microarray', 60, 'Peripheral Blood'],
      ['GSE58294', 'bulk_rnaseq', 24, 'Skin Lesion'],
    ]
  );
});

test('buildProjectMeta：公共库模式落归一化配对表，行级三元组带兜底值', () => {
  const ds = { source: 'GEO', dataType: 'microarray', datasets: [{ gse: 'GSE16561', gpl: 'GPL6883', role: 'train' }], sampleCount: 16, tissue: 'blood' };
  const meta = buildProjectMeta({
    id: 'prj_public',
    basicInfo: { name: '公共库' },
    dataSource: ds,
    groupingDesign: {
      mode: 'two_group',
      groups: [
        { groupId: 'g1', groupName: '对照', role: 'reference', stageOrder: 0, colorHex: '#3B4992', sampleIds: ['GSM1', 'GSM2'] },
        { groupId: 'g2', groupName: '处理', role: 'disease_stage', stageOrder: 1, colorHex: '#EE0000', sampleIds: ['GSM3'] },
      ],
    },
  });
  // 顶层字段原样保留，datasets 换成归一化结果（行级未填时继承项目级）
  assert.equal(meta.data_source.source, 'GEO');
  assert.equal(meta.data_source.dataType, 'microarray');
  assert.equal(meta.data_source.datasets_inferred, false);
  assert.deepEqual(meta.data_source.datasets, [
    { gse: 'GSE16561', gpl: 'GPL6883', role: 'train', dataType: 'microarray', sampleCount: 16, tissue: 'blood' },
  ]);
});
