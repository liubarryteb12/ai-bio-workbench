/**
 * 数据格式白名单两端一致性测试（S30 / 架构评审 2.3 A8）。
 *
 * 背景：同一份数据有两个入口，18787 工作台（BioanalysDesktop/server/upload.js 的
 * ALLOWED_EXT，14 项）与 8080 用户提交台（portal/lib/archive.mjs 的 DATA_EXT，9 项）。
 * 两边原来各持一份字面量，同一份数据走不同入口会得到不同校验结论。
 *
 * S30 把权威收敛到仓库根 shared/data_formats.mjs。v3.0 起 portal/index.html
 * 不再保留白名单字面量副本，由 portal/serve.mjs 在响应期注入。本文件钉死三件事：
 *   1. 权威列表本身是两端并集 14 项（顺序固定）；
 *   2. index.html 不重新长出硬编码副本；
 *   3. 两端对同一批文件名给出相同判定（upload.extAllowed vs archive.validateDataFiles）。
 *
 * 改动白名单时：先改 shared/data_formats.mjs，再同步 portal/index.html 的字面量、
 * accept 属性与提示文案，否则本测试会红。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DATA_EXT, MAX_DATA_BYTES, extOf, isAllowedDataFile } from '../../shared/data_formats.mjs';
import { ALLOWED_EXT, extAllowed } from '../server/upload.js';
import {
  DATA_EXT as PORTAL_DATA_EXT,
  MAX_DATA_BYTES as PORTAL_MAX_DATA_BYTES,
  validateDataFiles,
} from '../../portal/lib/archive.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = path.join(HERE, '..', '..', 'portal', 'index.html');
const HTML = fs.readFileSync(INDEX_HTML, 'utf8');

/** 权威列表写死在测试里：防止"改小权威 + 改小副本"这种成对漂移。 */
const EXPECTED = [
  '.h5ad', '.h5', '.loom', '.mtx', '.tar', '.gz', '.zip',
  '.txt', '.tsv', '.csv', '.soft', '.xlsx', '.rds', '.rdata',
];

/** 合法文件名：14 项各一个（含双扩展名与中文名） */
const VALID_NAMES = [
  'counts.h5ad',
  'filtered_feature_bc_matrix.h5',
  'adata.loom',
  'matrix.mtx',
  'raw_bundle.tar',
  'GSE277173_series_matrix.txt.gz',
  'supplementary.zip',
  'GPL11532-32230.txt',
  'mouse_cortex.tsv',
  'sample_sheet.csv',
  'GPL11532_family.soft',
  '样本信息.xlsx',
  'seurat_obj.rds',
  'workspace.rdata',
  'matrix.mtx.gz',
  '分组 情况.txt',
];

/** 非法文件名：脚本 / 可执行 / 无扩展名 / 伪装成合法后缀 */
const INVALID_NAMES = [
  'evil.sh',
  'run.exe',
  'script.bat',
  'app.js',
  'notes.py',
  'noext',
  'x.h5ad.bak',
  'x.tar.gz.exe',
];

// ---------- 1. 权威模块本身 ----------

test('shared：DATA_EXT 是两端并集 14 项且顺序固定', () => {
  assert.deepEqual(DATA_EXT, EXPECTED);
  assert.equal(DATA_EXT.length, 14);
  assert.equal(new Set(DATA_EXT).size, 14, 'DATA_EXT 有重复项');
  for (const e of DATA_EXT) assert.ok(e.startsWith('.'), e);
});

test('shared：extOf 取最后一段小写扩展名，路径只取 basename', () => {
  assert.equal(extOf('a/b/c.H5AD'), '.h5ad');
  assert.equal(extOf('x.tar.gz'), '.gz');
  assert.equal(extOf('分组 情况.TXT'), '.txt');
  assert.equal(extOf('noext'), '');
  assert.equal(extOf('../../etc/passwd'), '');
  assert.equal(extOf(''), '');
  assert.equal(extOf(null), '');
});

test('shared：isAllowedDataFile 14 项全通过，脚本/可执行/伪装后缀全拒', () => {
  for (const e of EXPECTED) {
    assert.equal(isAllowedDataFile('sample' + e), true, e);
    assert.equal(isAllowedDataFile('SAMPLE' + e.toUpperCase()), true, e);
  }
  for (const name of INVALID_NAMES) {
    assert.equal(isAllowedDataFile(name), false, name);
  }
  assert.equal(isAllowedDataFile('x.'), false);
});

// ---------- 2. index.html 副本防漂移 ----------

test('index.html：不保存 DATA_EXT / MAX_DATA_BYTES 字面量副本', () => {
  assert.doesNotMatch(HTML, /var DATA_EXT\s*=\s*\[\s*['"]\./);
  assert.doesNotMatch(HTML, /var MAX_DATA_BYTES\s*=\s*5\s*\*\s*1024/);
  assert.match(HTML, /__INJECT_SHARED_CONTRACTS__/);
});

// ---------- 3. 两端都引用同一权威 ----------

test('工作台 upload.js：ALLOWED_EXT 与权威同引用同内容', () => {
  assert.equal(ALLOWED_EXT, DATA_EXT, 'ALLOWED_EXT 不是 shared DATA_EXT 的同一引用');
  assert.deepEqual(ALLOWED_EXT, DATA_EXT);
});

test('提交台 archive.mjs：DATA_EXT 与权威同引用同内容', () => {
  assert.equal(PORTAL_DATA_EXT, DATA_EXT, 'portal DATA_EXT 不是 shared DATA_EXT 的同一引用');
  assert.deepEqual(PORTAL_DATA_EXT, DATA_EXT);
});

test('提交台 archive.mjs：MAX_DATA_BYTES 默认值同权威，env 覆盖语义不变', () => {
  assert.equal(MAX_DATA_BYTES, 5 * 1024 * 1024 * 1024);
  const override = Number(process.env.PORTAL_MAX_DATA_BYTES);
  if (override > 0) {
    assert.equal(PORTAL_MAX_DATA_BYTES, override);
  } else {
    assert.equal(PORTAL_MAX_DATA_BYTES, MAX_DATA_BYTES);
  }
});

// ---------- 4. 两端同判定（核心验收） ----------

test('两端同判定：14 项合法文件名两端都放行', () => {
  for (const name of VALID_NAMES) {
    assert.equal(extAllowed(name), true, '工作台拒绝: ' + name);
    const r = validateDataFiles([{ role: 'other', bind: '', name, size: 10 }], {});
    assert.equal(r.ok, true, '提交台拒绝: ' + name + ' → ' + r.errors.join('; '));
  }
});

test('两端同判定：非法扩展名两端都拒绝', () => {
  for (const name of INVALID_NAMES) {
    assert.equal(extAllowed(name), false, '工作台放行了: ' + name);
    const r = validateDataFiles([{ role: 'other', bind: '', name, size: 10 }], {});
    assert.equal(r.ok, false, '提交台放行了: ' + name);
    assert.match(r.errors.join('; '), /扩展名不在白名单/);
  }
});
