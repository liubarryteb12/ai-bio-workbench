import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  sanitizeFilename, extAllowed, detectMagic, suggestModality, validateUpload,
  initUpload, writeChunk, listChunks, assembleChunks, cleanupUpload,
  remoteRawPath, deployedRawName, uploadDir, UPLOAD_ROOT,
} from '../server/upload.js';

test('sanitizeFilename：正常文件名通过', () => {
  assert.equal(sanitizeFilename('GSE277173_series_matrix.txt.gz'), 'GSE277173_series_matrix.txt.gz');
  assert.equal(sanitizeFilename('a b(c).h5ad'), 'a b(c).h5ad');
});

test('sanitizeFilename：路径穿越与隐藏文件被拒', () => {
  assert.equal(sanitizeFilename('../../etc/passwd'), null);
  assert.equal(sanitizeFilename('a/../b.h5ad'), null);
  assert.equal(sanitizeFilename('.hidden'), null);
  assert.equal(sanitizeFilename('dir\\file.h5ad'), null);  // 含分隔符严格拒
  assert.equal(sanitizeFilename('a/b.h5ad'), null);
  assert.equal(sanitizeFilename(''), null);
  assert.equal(sanitizeFilename(null), null);
});

test('extAllowed：白名单内外', () => {
  assert.equal(extAllowed('x.h5ad'), true);
  assert.equal(extAllowed('x.mtx.gz'), true);
  assert.equal(extAllowed('x.soft.gz'), true);
  assert.equal(extAllowed('x.exe'), false);
  assert.equal(extAllowed('x.sh'), false);
});

test('detectMagic：识别 hdf5 / gzip / zip / tar / text / binary', () => {
  assert.equal(detectMagic(Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a])), 'hdf5');
  assert.equal(detectMagic(Buffer.from([0x1f, 0x8b, 0x08, 0x00])), 'gzip');
  assert.equal(detectMagic(Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'zip');
  const tarBuf = Buffer.alloc(300, 0);
  tarBuf.write('ustar', 257, 'latin1');
  assert.equal(detectMagic(tarBuf), 'tar');
  assert.equal(detectMagic(Buffer.from('gene\ts1\ts2\nA\t1\t2\n')), 'text');
  assert.equal(detectMagic(Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff])), 'binary');
});

test('suggestModality：区分 bulk / scrna / spatial', () => {
  assert.equal(suggestModality('GSE_x_series_matrix.txt.gz', 'gzip'), 'bulk');
  assert.equal(suggestModality('GPL11532_family.soft.gz', 'gzip'), 'bulk');
  assert.equal(suggestModality('matrix.mtx.gz', 'gzip'), 'scrna');
  assert.equal(suggestModality('x.loom', 'hdf5'), 'scrna');
  assert.equal(suggestModality('filtered_feature_bc_matrix.h5', 'hdf5'), 'spatial');
  assert.equal(suggestModality('counts.h5ad', 'hdf5'), 'scrna');
});

test('validateUpload：合法 h5ad 通过', () => {
  const header = Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
  const r = validateUpload('data.h5ad', header);
  assert.equal(r.ok, true, r.reasons.join(';'));
  assert.equal(r.magic, 'hdf5');
});

test('validateUpload：扩展名不在白名单被拒', () => {
  const r = validateUpload('evil.sh', Buffer.from('#!/bin/sh'));
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(';'), /扩展名/);
});

test('validateUpload：.h5ad 但 magic 不是 HDF5 被拒', () => {
  const r = validateUpload('fake.h5ad', Buffer.from('just text'));
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(';'), /HDF5/);
});

test('validateUpload：路径穿越文件名被拒', () => {
  const r = validateUpload('../../x.h5ad', Buffer.from([0x89, 0x48, 0x44, 0x46]));
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(';'), /路径穿越|非法/);
});

test('remoteRawPath：拼到本项目本线 raw_data，非法线/项目被拒', () => {
  const p = remoteRawPath('default', 'line1_bulk', 'a.txt');
  assert.match(p, /projects\/default\/line1_bulk\/raw_data\/a\.txt$/);
  assert.throws(() => remoteRawPath('default', 'line9_x', 'a.txt'));
  assert.throws(() => remoteRawPath('../x', 'line1_bulk', 'a.txt'));
  assert.throws(() => remoteRawPath('default', 'line1_bulk', '../a.txt'));
});

test('分片上传全流程：init -> chunk -> assemble -> cleanup', () => {
  const uploadId = 'test-' + Date.now();
  try {
    initUpload(uploadId);
    writeChunk(uploadId, 0, Buffer.from('hello '));
    writeChunk(uploadId, 1, Buffer.from('world'));
    assert.deepEqual(listChunks(uploadId), [0, 1]);
    const out = assembleChunks(uploadId, 'merged.txt');
    assert.equal(fs.readFileSync(out, 'utf8'), 'hello world');
    assert.equal(fs.existsSync(out), true);
  } finally {
    cleanupUpload(uploadId);
    assert.equal(fs.existsSync(path.join(UPLOAD_ROOT, uploadId)), false);
  }
});

test('分片不连续时 assemble 报错', () => {
  const uploadId = 'test-gap-' + Date.now();
  try {
    initUpload(uploadId);
    writeChunk(uploadId, 0, Buffer.from('a'));
    writeChunk(uploadId, 2, Buffer.from('c'));
    assert.throws(() => assembleChunks(uploadId, 'x.txt'), /不连续/);
  } finally {
    cleanupUpload(uploadId);
  }
});

test('uploadDir：点段 uploadId 被拒（消毒后点号仍存活，会跳出上传根）', () => {
  // 历史行为：只剥非 [A-Za-z0-9._-] 字符，'..' 原样存活，path.join(UPLOAD_ROOT,'..') 指到 .uploads 的父目录
  assert.equal(uploadDir('..'), null);
  assert.equal(uploadDir('.'), null);
  assert.equal(uploadDir('a..b'), null);
  assert.equal(uploadDir(''), null);
  // 正常 randomUUID 与带点/下划线的 id 仍然可用，且一定落在 UPLOAD_ROOT 之内
  const ok = uploadDir('0b7c9f7e-1a2b-4c3d-8e9f-0123456789ab');
  assert.equal(path.dirname(ok), UPLOAD_ROOT);
  assert.equal(path.dirname(uploadDir('sess_2026-10-21.v1')), UPLOAD_ROOT);
});

test('deployedRawName：group_map 归一为母版契约名 grouping.txt', () => {
  // 母版 prep_matrix 按 *grouping* 识别分组表，客户上传的中文名不匹配会 exit 2
  assert.equal(deployedRawName({ role: 'group_map', name: '分组情况.txt' }), 'grouping.txt');
  assert.equal(deployedRawName({ role: 'group_map', name: 'GSE1_grouping.txt' }), 'GSE1_grouping.txt');
});

test('deployedRawName：其余角色保留原名（文件名一致性校验依赖原名）', () => {
  assert.equal(
    deployedRawName({ role: 'train_matrix', name: 'GSE277173_series_matrix.txt.gz' }),
    'GSE277173_series_matrix.txt.gz'
  );
  assert.equal(deployedRawName({ role: 'platform_annotation', name: 'GPL11532-32230.txt' }), 'GPL11532-32230.txt');
  assert.equal(deployedRawName({ role: 'sample_sheet', name: '样本信息.xlsx' }), '样本信息.xlsx');
  assert.equal(deployedRawName(undefined), '');
});
