/**
 * 提交包归档契约测试（portal/lib/archive.mjs）。
 *
 * 背景：客户端一次提交现在只落一个平铺 JSON，上传的文献落在随机 sid 目录下，
 * 与项目名无关、不重命名、也不和数据文件放在一起。对接人拿到收件箱后无法判断
 * "哪几个文件属于哪次需求"。这里把"一次提交 = 一个包目录"的命名与校验规则固化。
 *
 * 另一条硬要求：上传的文件名必须和用户自己填写的名称对得上。
 * 这条最容易做成"看起来校验了、其实没比对"，所以逐条锁死。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DATA_ROLES, DATA_EXT, MAX_DATA_FILES_PER_ROLE, MAX_DATA_BYTES,
  sanitizeFileName, buildPackageName, refArchiveName, dataArchiveName,
  validateDataFiles, buildPackagePlan,
} from '../../portal/lib/archive.mjs';

// ---------- 文件名安全化 ----------

test('sanitizeFileName 保留扩展名、剔除路径分隔与危险字符', () => {
  assert.equal(sanitizeFileName('GSE277173_series_matrix.txt.gz'), 'GSE277173_series_matrix.txt.gz');
  assert.equal(sanitizeFileName('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFileName('a\\b\\c.tsv'), 'c.tsv');
  assert.equal(sanitizeFileName('分组 表.xlsx'), '分组_表.xlsx');
  assert.equal(sanitizeFileName(''), 'file');
});

test('sanitizeFileName 保留 tar.gz 双扩展名', () => {
  assert.equal(sanitizeFileName('raw data.tar.gz'), 'raw_data.tar.gz');
});

// ---------- 包目录名 ----------

test('buildPackageName：时间戳 + 项目名，且不含路径分隔', () => {
  const name = buildPackageName('2026-10-18_231500', '银屑病皮损分期/演进');
  assert.ok(name.startsWith('PKG_2026-10-18_231500_'));
  assert.ok(!name.includes('/'));
  assert.ok(name.includes('银屑病皮损分期'));
});

test('buildPackageName：项目名为空时用 requirement 兜底', () => {
  const name = buildPackageName('2026-10-18_231500', '');
  assert.equal(name, 'PKG_2026-10-18_231500_requirement');
});

// ---------- 归档重命名 ----------

test('refArchiveName：两位序号前缀，保留原名便于人工核对', () => {
  assert.equal(refArchiveName(0, 'Nature2024.pdf'), '01_Nature2024.pdf');
  assert.equal(refArchiveName(11, 'a.pdf'), '12_a.pdf');
});

test('dataArchiveName：角色 + 绑定编号 + 原名三段式', () => {
  assert.equal(dataArchiveName('train_matrix', 'GSE277173', 'series_matrix.txt.gz'),
    'train_matrix__GSE277173__series_matrix.txt.gz');
  // 无绑定编号（自有上传）时只留角色与原名
  assert.equal(dataArchiveName('train_matrix', '', 'mouse.tsv'),
    'train_matrix__mouse.tsv');
  // 绑定编号里的路径分隔被清掉
  assert.equal(dataArchiveName('val_matrix', '../evil', 'v.tsv'),
    'val_matrix__evil__v.tsv');
});

// ---------- 角色与扩展名枚举 ----------

test('角色枚举覆盖三类必需文件与兜底', () => {
  for (const r of ['train_matrix', 'val_matrix', 'sample_sheet', 'group_map',
    'platform_annotation', 'other']) {
    assert.ok(DATA_ROLES.includes(r), r);
  }
  assert.ok(!DATA_ROLES.includes('random_role'));
});

test('扩展名白名单覆盖常见生信输入，拒绝可执行与脚本', () => {
  for (const e of ['.tsv', '.csv', '.txt', '.gz', '.zip', '.xlsx', '.h5ad', '.rds', '.mtx']) {
    assert.ok(DATA_EXT.includes(e), e);
  }
  for (const e of ['.exe', '.sh', '.bat', '.js']) {
    assert.ok(!DATA_EXT.includes(e), e);
  }
});

// ---------- 数据文件校验（核心：文件名必须与用户填写一致） ----------

const inHousePayload = {
  dataSource: {
    data_source_mode: 'IN_HOUSE_UPLOAD',
    uploaded_files: { train_matrix: 'raw_data/mouse_cortex.tsv', val_matrix: null },
  },
};

test('IN_HOUSE：上传文件名与用户填写的 train_matrix 完全一致才通过', () => {
  const ok = validateDataFiles(
    [{ role: 'train_matrix', bind: '', name: 'mouse_cortex.tsv', size: 100 }],
    inHousePayload);
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));

  const bad = validateDataFiles(
    [{ role: 'train_matrix', bind: '', name: 'mouse_cortex_v2.tsv', size: 100 }],
    inHousePayload);
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(' '), /与填写的矩阵文件名 .* 不一致/);
});

test('IN_HOUSE：用户没填 val_matrix 却上传验证集矩阵 → 拒绝', () => {
  const r = validateDataFiles(
    [{ role: 'val_matrix', bind: '', name: 'val.tsv', size: 100 }],
    inHousePayload);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /未填写验证集矩阵/);
});

test('IN_HOUSE：路径只取 basename 比对，允许用户填相对路径', () => {
  const r = validateDataFiles(
    [{ role: 'train_matrix', bind: '', name: 'mouse_cortex.tsv', size: 100 }],
    { dataSource: { data_source_mode: 'IN_HOUSE_UPLOAD',
      uploaded_files: { train_matrix: './data/deep/mouse_cortex.tsv', val_matrix: null } } });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

const publicPayload = {
  dataSource: {
    data_source_mode: 'PUBLIC_DB',
    datasets: [
      { gse: 'GSE277173', gpl: 'GPL11532', role: 'train' },
      { gse: 'GSE13355', gpl: 'GPL570', role: 'validation' },
    ],
  },
};

test('PUBLIC_DB：绑定编号必须是已填的 GSE', () => {
  const ok = validateDataFiles(
    [{ role: 'train_matrix', bind: 'GSE277173', name: 'series_matrix.txt.gz', size: 100 }],
    publicPayload);
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));

  const bad = validateDataFiles(
    [{ role: 'train_matrix', bind: 'GSE999999', name: 'x.txt.gz', size: 100 }],
    publicPayload);
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(' '), /不在需求填写的数据集列表里/);
});

test('PUBLIC_DB：文件名里带 GSE 时必须与绑定编号一致', () => {
  const bad = validateDataFiles(
    [{ role: 'train_matrix', bind: 'GSE277173', name: 'GSE13355_series_matrix.txt.gz', size: 100 }],
    publicPayload);
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(' '), /文件名中的 GSE13355 与绑定编号 GSE277173 不一致/);
});

test('PUBLIC_DB：train_matrix 角色必须绑定训练集 GSE', () => {
  const bad = validateDataFiles(
    [{ role: 'train_matrix', bind: 'GSE13355', name: 'x.txt.gz', size: 100 }],
    publicPayload);
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(' '), /不是训练集/);
});

test('PUBLIC_DB：sample_sheet 可以不绑定编号', () => {
  const r = validateDataFiles(
    [{ role: 'sample_sheet', bind: '', name: 'groups.xlsx', size: 100 }],
    publicPayload);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

// ---------- 通用约束 ----------

test('扩展名不在白名单时拒绝并点名文件', () => {
  const r = validateDataFiles(
    [{ role: 'other', bind: '', name: 'malware.exe', size: 100 }], publicPayload);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /malware\.exe/);
});

test('超过单文件上限时拒绝', () => {
  const r = validateDataFiles(
    [{ role: 'other', bind: '', name: 'big.tsv', size: MAX_DATA_BYTES + 1 }], publicPayload);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /超过/);
});

test('同一角色重复上传被拒（train_matrix 只允许一个）', () => {
  const r = validateDataFiles([
    { role: 'train_matrix', bind: 'GSE277173', name: 'a.txt.gz', size: 10 },
    { role: 'train_matrix', bind: 'GSE277173', name: 'b.txt.gz', size: 10 },
  ], publicPayload);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /train_matrix/);
});

test('other 角色允许最多 MAX_DATA_FILES_PER_ROLE 个', () => {
  const files = [];
  for (let i = 0; i < MAX_DATA_FILES_PER_ROLE; i += 1) {
    files.push({ role: 'other', bind: '', name: `extra_${i}.tsv`, size: 10 });
  }
  assert.equal(validateDataFiles(files, publicPayload).ok, true);
  files.push({ role: 'other', bind: '', name: 'overflow.tsv', size: 10 });
  assert.equal(validateDataFiles(files, publicPayload).ok, false);
});

test('角色非法时拒绝', () => {
  const r = validateDataFiles(
    [{ role: 'shell', bind: '', name: 'x.tsv', size: 10 }], publicPayload);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /角色非法/);
});

test('空数组视为合法（数据文件全部选填）', () => {
  assert.equal(validateDataFiles([], publicPayload).ok, true);
  assert.equal(validateDataFiles(undefined, publicPayload).ok, true);
});

// ---------- 包计划 ----------

test('buildPackagePlan：给出目录名、需求文件路径与每个文件的归档落点', () => {
  const plan = buildPackagePlan({
    payload: publicPayload,
    sid: 'sid_abc123',
    timestamp: '2026-10-18_231500',
    projectName: '银屑病皮损分期',
    references: [{ name: 'Nature2024.pdf', size: 1000 }],
    dataFiles: [
      { role: 'train_matrix', bind: 'GSE277173', name: 'series_matrix.txt.gz', size: 5000 },
      { role: 'sample_sheet', bind: '', name: 'groups.xlsx', size: 800 },
    ],
  });
  assert.equal(plan.packageDir, 'PKG_2026-10-18_231500_银屑病皮损分期');
  assert.equal(plan.requirementPath, 'PKG_2026-10-18_231500_银屑病皮损分期/requirement.json');
  assert.equal(plan.manifestPath, 'PKG_2026-10-18_231500_银屑病皮损分期/package_manifest.json');
  assert.deepEqual(plan.references.map((r) => ({ from: r.from, to: r.to })), [
    { from: 'refs/sid_abc123/Nature2024.pdf',
      to: 'PKG_2026-10-18_231500_银屑病皮损分期/references/01_Nature2024.pdf' },
  ]);
  // 清单要能自解释：归档名与原名都要留在计划里
  assert.equal(plan.references[0].archiveName, '01_Nature2024.pdf');
  assert.equal(plan.references[0].originalName, 'Nature2024.pdf');
  assert.deepEqual(plan.dataFiles.map((d) => d.to), [
    'PKG_2026-10-18_231500_银屑病皮损分期/raw_data/train_matrix__GSE277173__series_matrix.txt.gz',
    'PKG_2026-10-18_231500_银屑病皮损分期/raw_data/sample_sheet__groups.xlsx',
  ]);
});

test('buildPackagePlan：同名文件不会互相覆盖（归档名加序号）', () => {
  const plan = buildPackagePlan({
    payload: publicPayload, sid: 's1', timestamp: 'T', projectName: 'p',
    references: [],
    dataFiles: [
      { role: 'other', bind: '', name: 'dup.tsv', size: 1 },
      { role: 'other', bind: '', name: 'dup.tsv', size: 1 },
    ],
  });
  const tos = plan.dataFiles.map((d) => d.to);
  assert.notEqual(tos[0], tos[1]);
});
