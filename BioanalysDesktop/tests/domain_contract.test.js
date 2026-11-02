import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LINES,
  LINE_SUBDIRS,
  SSD_ROOT,
  PROJECTS_ROOT,
  BIN_ROOT,
  ENVS_ROOT,
  SYSTEM_LOGS,
  DATA_TYPES,
  DATA_TYPE_IDS,
  DATATYPE_TO_LINE,
  SPECIES_ENUM,
  DOMAIN_ENUM,
  resolveLineFromDataType,
  normalizeDataSourceMode,
  normalizeIdType,
  normalizeValueScale,
  PUBLIC_ACCESSION_RE,
  LOC_ACCESSION_RE,
  buildLocAccession,
  isValidSampleId,
  normalizeDatasetDataType,
  normalizeDatasetSampleCount,
  sanitizeProjectId,
  projectRoot,
  projectLineDir,
  binDir,
  envsDir,
  COMPUTE_SSH_PORT,
  COMPUTE_SCP_TARGET,
} from '../server/domain.js';

// ── domain.js 契约面独立测试（2026-11-02）──
//
// 为什么值得单独测：这个模块是**路径契约与枚举真源**，45 个 server 模块里有一大半
// 直接 import 它。此前它只被别的测试间接覆盖——间接覆盖的问题是「改坏了但恰好没被
// 那条路径用到」就不会变红。这里把它自己的承诺钉住。
//
// 三类契约：
//   1. 常量不变量（三条线、四个子目录、目录根）
//   2. 枚举闭合（数据类型/物种/领域只许登记过的不许发明）
//   3. 路径安全（sanitizeProjectId 是唯一安全边界，projectRoot 必须 fail-closed）

test('三条线与四个子目录是不变量（少一条或多一条都会让部署脚本错位）', () => {
  assert.deepEqual(LINES, ['line1_bulk', 'line2_scrna', 'line3_spatial']);
  assert.deepEqual(LINE_SUBDIRS, ['raw_data', 'processed', 'results', 'figures']);
  // 目录根必须挂在 SSD_ROOT 之下，不得出现第二个根
  for (const dir of [PROJECTS_ROOT, BIN_ROOT, ENVS_ROOT, SYSTEM_LOGS]) {
    assert.ok(dir.startsWith(SSD_ROOT + '/'), dir + ' 不在 SSD_ROOT 下');
  }
});

test('数据类型枚举闭合：每个 id 都能映射到一条合法线', () => {
  assert.ok(DATA_TYPES.length >= 4, '数据类型少于 4 类');
  for (const dt of DATA_TYPES) {
    assert.ok(LINES.includes(dt.line), dt.id + ' 映射到非法线 ' + dt.line);
    assert.equal(DATATYPE_TO_LINE[dt.id], dt.line, dt.id + ' 映射表与枚举不一致');
    // 反查必须回到自己
    assert.equal(resolveLineFromDataType(dt.id), dt.line, dt.id + ' 反查失败');
  }
  // 未登记的 id 必须解析成空串而不是猜一条线。
  // 约定是 ''（falsy）而不是 null：调用方统一用 || 兜底，两套 falsy 混用会漏判。
  assert.equal(resolveLineFromDataType('not_a_type'), '');
  assert.equal(resolveLineFromDataType(''), '');
  assert.equal(resolveLineFromDataType(null), '');
  assert.equal(DATA_TYPE_IDS.length, DATA_TYPES.length);
});

test('物种与领域枚举拒绝拼写外的一切值', () => {
  assert.ok(SPECIES_ENUM.includes('Homo sapiens'));
  assert.ok(SPECIES_ENUM.includes('Mus musculus'));
  // 大小写与空格变体都不在枚举里（下游靠精确匹配选 OrgDb）
  assert.equal(SPECIES_ENUM.includes('human'), false);
  assert.equal(SPECIES_ENUM.includes('Homo Sapiens'), false);
  assert.ok(DOMAIN_ENUM.length >= 6, '领域枚举条目过少');
});

test('数据源模式/ID 类型/数值刻度：合法值原样返回，非法值回落默认', () => {
  assert.equal(normalizeDataSourceMode('PUBLIC_DB'), 'PUBLIC_DB');
  assert.equal(normalizeDataSourceMode('IN_HOUSE_UPLOAD'), 'IN_HOUSE_UPLOAD');
  // 非法与空值必须回落默认，不得原样透传
  assert.equal(normalizeDataSourceMode('public_db'), 'PUBLIC_DB');
  assert.equal(normalizeDataSourceMode(''), 'PUBLIC_DB');
  assert.equal(normalizeDataSourceMode(null), 'PUBLIC_DB');

  // 非法值一律回落空串（不是 null），由调用方用 || 取默认
  assert.equal(normalizeIdType('unknown_xyz'), '', 'ID 类型非法值必须回落空串');
  assert.equal(normalizeIdType(''), '');
  assert.equal(normalizeIdType(null), '');
  assert.equal(normalizeValueScale('unknown_xyz'), '', '数值刻度非法值必须回落空串');
});

test('公开编号与本地编号的正则只接受两种约定', () => {
  assert.equal(PUBLIC_ACCESSION_RE.test('GSE12345'), true);
  assert.equal(PUBLIC_ACCESSION_RE.test('gse12345'), true, '大小写不敏感');
  assert.equal(PUBLIC_ACCESSION_RE.test('E-MTAB-1234'), true);
  // 常见误填必须被拒
  assert.equal(PUBLIC_ACCESSION_RE.test('GSE 12345'), false, '带空格不得通过');
  assert.equal(PUBLIC_ACCESSION_RE.test('SRP123456'), false, 'SRA 编号不得冒充 GEO');
  assert.equal(PUBLIC_ACCESSION_RE.test('PRJNA123'), false, 'BioProject 编号不得冒充 GEO');

  assert.equal(LOC_ACCESSION_RE.test('LOC_PRJ1_TRAIN'), true);
  assert.equal(LOC_ACCESSION_RE.test('LOC_PRJ1_VAL'), true);
  assert.equal(LOC_ACCESSION_RE.test('LOC_PRJ1_TEST'), false, '只许 TRAIN/VAL 两种角色');
});

test('本地编号构造与解析对称（构造出的必须被自己的正则接受）', () => {
  const acc = buildLocAccession('PRJ_DEMO', 'TRAIN');
  assert.ok(acc.startsWith('LOC_'), '本地编号必须以 LOC_ 开头');
  assert.match(acc, LOC_ACCESSION_RE, '自己构造的编号必须被自己的正则接受');
  // role 大小写与非法 role 的处理
  // 实现里 VAL 角色的入参词是 'validation'（不是 'VAL'），这是既有约定
  const valAcc = buildLocAccession('PRJ_DEMO', 'validation');
  assert.match(valAcc, LOC_ACCESSION_RE);
  assert.notEqual(acc, valAcc, 'TRAIN 与 VAL 必须生成不同编号');
});

test('sample id 校验随数据源模式切换（上传模式不该要求 GEO 编号）', () => {
  // 公开库模式下，样本 id 常来自 GSM/GSM 系列
  assert.equal(typeof isValidSampleId('GSM123456', 'PUBLIC_DB'), 'boolean');
  // 上传模式必须接受非 GEO 形状的样本名（否则真实客户表全被拒）
  assert.equal(isValidSampleId('sample_01', 'IN_HOUSE_UPLOAD'), true,
    '上传模式必须接受 sample_01 这类自造名');
  // 空值与纯空白必须一律拒绝，与模式无关
  assert.equal(isValidSampleId('', 'PUBLIC_DB'), false);
  assert.equal(isValidSampleId('   ', 'IN_HOUSE_UPLOAD'), false);
  assert.equal(isValidSampleId(null, 'PUBLIC_DB'), false);
});

test('数据集归一化：类型与样本数越界时给出可判定的结果', () => {
  assert.equal(normalizeDatasetDataType('scrna'), 'scrna', '合法类型原样保留');
  assert.equal(normalizeDatasetDataType('SCRNASEQ'), '', '未登记写法必须回落空串');
  assert.equal(normalizeDatasetSampleCount(5), 5);
  assert.equal(normalizeDatasetSampleCount('5'), 5, '数字字符串应转成数');
  // 样本数非法时回落 0（不是 null）。这是本模块统一的 falsy 约定：
  // 调用方一律用 || 或 > 0 判定，混入 null 会让 `typeof === 'number'` 之外的分支漏判。
  assert.equal(normalizeDatasetSampleCount(0), 0, '样本数 0 应回落 0');
  assert.equal(normalizeDatasetSampleCount(-1), 0, '负数必须回落 0');
  assert.equal(normalizeDatasetSampleCount('abc'), 0, '非数字必须回落 0');
  assert.equal(normalizeDatasetSampleCount(null), 0);
});

// ── 路径安全是这一层最重要的契约 ──

test('sanitizeProjectId 是唯一安全边界：一切越界写法返回 null 而不是抛错', () => {
  // 合法
  assert.equal(sanitizeProjectId('PRJ_001'), 'PRJ_001');
  assert.equal(sanitizeProjectId('  PRJ_001  '), 'PRJ_001', '前后空白应被裁掉');
  assert.equal(sanitizeProjectId('a.b-c_d'), 'a.b-c_d');
  // 越界：全部必须 null（返回 null 让调用方决定怎么报错，而不是在这里 throw）
  for (const bad of ['', '   ', null, undefined, '.', '..', '.hidden',
    '../etc', 'a/b', 'a\\b', 'C:/Windows', 'PRJ 001', 'PRJ#001']) {
    assert.equal(sanitizeProjectId(bad), null, JSON.stringify(bad) + ' 必须判非法');
  }
  // 长度边界
  assert.equal(sanitizeProjectId('a'.repeat(64)), 'a'.repeat(64), '64 字符是上限内');
  assert.equal(sanitizeProjectId('a'.repeat(65)), null, '65 字符必须拒绝');
});

test('projectRoot 与 projectLineDir 对非法输入 fail-closed 抛错，合法输入拼接正确', () => {
  // 合法拼接：单一根，不得出现双斜杠或多余层级
  assert.equal(projectRoot('PRJ_001'), PROJECTS_ROOT + '/PRJ_001');
  assert.equal(projectLineDir('PRJ_001', 'line2_scrna'),
    PROJECTS_ROOT + '/PRJ_001/line2_scrna');

  // 非法 projectId 必须抛，且错误信息含原文便于定位
  assert.throws(() => projectRoot('../etc'), /项目 ID 非法/, '越界 id 必须抛错');
  assert.throws(() => projectRoot(''), /项目 ID 非法/);
  assert.throws(() => projectLineDir('PRJ_001', 'line9_unknown'), /line_id 非法/);

  // 路径不得逃出 PROJECTS_ROOT：合法结果必须以它开头且不含 ..
  for (const id of ['PRJ_001', 'a.b-c_d']) {
    const root = projectRoot(id);
    assert.ok(root.startsWith(PROJECTS_ROOT + '/'));
    assert.equal(root.includes('..'), false, id + ' 的路径含 ..');
  }
});

test('binDir/envsDir 只接受三条线，且各自挂在对应的全局根下', () => {
  for (const line of LINES) {
    assert.equal(binDir(line), BIN_ROOT + '/' + line);
    assert.equal(envsDir(line), ENVS_ROOT + '/' + line);
  }
  assert.throws(() => binDir('line4_unknown'), /line_id 非法/);
  assert.throws(() => envsDir('line1_bulk_typo'), /line_id 非法/);
  // 代码与环境必须分两个根，混一起部署会互相覆盖
  assert.notEqual(BIN_ROOT, ENVS_ROOT);
});

test('计算面拓扑来自 env 且带可用默认值（改端口不该改代码）', () => {
  assert.equal(typeof COMPUTE_SSH_PORT, 'number');
  assert.ok(Number.isInteger(COMPUTE_SSH_PORT) && COMPUTE_SSH_PORT > 0,
    'SSH 端口必须是正整数，当前 ' + COMPUTE_SSH_PORT);
  assert.equal(typeof COMPUTE_SCP_TARGET, 'string');
  assert.ok(COMPUTE_SCP_TARGET.includes('@'), 'scp 目标必须形如 user@host');
});
