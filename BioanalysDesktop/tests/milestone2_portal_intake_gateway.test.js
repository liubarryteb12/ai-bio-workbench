/**
 * Milestone 2 Contract Test:
 * 客户填单前端与前置强校验网关（双模式分流、Excel 日期拦截、R make.names 防护、生物学重复门槛、原子落盘）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const PORTAL = path.join(REPO, 'portal', 'serve.mjs');
const INBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'm2_intake_'));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const PORT = await freePort();
const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, [PORTAL], {
  env: { ...process.env, PORTAL_PORT: String(PORT), PORTAL_INBOX: INBOX },
  stdio: 'ignore',
});

const deadline = Date.now() + 10000;
let up = false;
while (Date.now() < deadline) {
  try {
    const res = await fetch(`${BASE}/health`);
    if (res.ok) { up = true; break; }
  } catch { /* wait */ }
  await new Promise((r) => setTimeout(r, 150));
}

test.after(() => {
  child.kill();
  fs.rmSync(INBOX, { recursive: true, force: true });
});

function validGroups(prefix = 'S_') {
  return [
    { sample_id: `${prefix}C1`, group: 'Control' },
    { sample_id: `${prefix}C2`, group: 'Control' },
    { sample_id: `${prefix}C3`, group: 'Control' },
    { sample_id: `${prefix}T1`, group: 'Treat' },
    { sample_id: `${prefix}T2`, group: 'Treat' },
    { sample_id: `${prefix}T3`, group: 'Treat' },
  ];
}

test('Portal process is ready for Milestone 2 tests', () => {
  assert.equal(up, true, 'portal did not become ready within 10s');
});

test('1. 拦截 Excel 日期转换污染基因名 (1-Mar, 44256) 并返回 HTTP 422 且无残留 .staging_', async () => {
  const matrixBadDate = [
    'Gene\tS_C1\tS_C2\tS_C3\tS_T1\tS_T2\tS_T3',
    'TP53\t10\t12\t11\t20\t22\t21',
    '1-Mar\t5\t6\t7\t8\t9\t10',
    '44256\t1\t2\t3\t4\t5\t6',
  ].join('\n');

  const res = await fetch(`${BASE}/api/intake/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      submission_mode: 'own_matrix',
      pipeline: 'line1_bulk',
      groups: validGroups('S_'),
      matrix_snippet: matrixBadDate,
    }),
  });
  const body = await res.json();
  assert.equal(res.status, 422);
  assert.equal(body.ok, false);
  assert.ok(Array.isArray(body.errors) && body.errors.length >= 1);
  assert.ok(body.errors.some((e) => e.includes('1-Mar') || e.includes('Excel')));

  const entries = fs.readdirSync(INBOX);
  assert.equal(entries.filter((n) => n.startsWith('.staging_')).length, 0, '失败时不得残留 .staging_ 目录');
});

test('2. 拦截数字开头的样本列名 (1_Tumor) 防 R make.names 偏移', async () => {
  const matrixBadSample = [
    'Gene\t1_Tumor\tS_C2\tS_C3\tS_T1\tS_T2\tS_T3',
    'HLA-DRA\t10\t12\t11\t20\t22\t21',
  ].join('\n');

  const res = await fetch(`${BASE}/api/intake/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      submission_mode: 'own_matrix',
      pipeline: 'line1_bulk',
      groups: [
        { sample_id: '1_Tumor', group: 'Control' },
        ...validGroups('S_').slice(1),
      ],
      matrix_snippet: matrixBadSample,
    }),
  });
  const body = await res.json();
  assert.equal(res.status, 422);
  assert.equal(body.ok, false);
  assert.ok(body.errors.some((e) => e.includes('1_Tumor') && e.includes('数字开头')));
});

test('3. 拦截 Bulk 线生物学重复数不足 3 例的提单', async () => {
  const res = await fetch(`${BASE}/api/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      submission_mode: 'own_matrix',
      pipeline: 'line1_bulk',
      groups: [
        { sample_id: 'S_C1', group: 'Control' },
        { sample_id: 'S_C2', group: 'Control' },
        { sample_id: 'S_T1', group: 'Treat' },
        { sample_id: 'S_T2', group: 'Treat' },
      ],
    }),
  });
  const body = await res.json();
  assert.equal(res.status, 422);
  assert.equal(body.ok, false);
  assert.ok(body.errors.some((e) => e.includes('至少需要 3 例')));
});

test('4. 放行纯 GEO 编号提单 (模式 B)，无需本地矩阵且标记 requires_external_download: true', async () => {
  const res = await fetch(`${BASE}/api/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      submission_mode: 'geo_accession',
      gse: 'GSE277173',
      gpl: 'GPL570',
      pipeline: 'line1_bulk',
      groups: [
        { sample_id: 'GSM10001', group: 'Control' },
        { sample_id: 'GSM10002', group: 'Control' },
        { sample_id: 'GSM10003', group: 'Control' },
        { sample_id: 'GSM10004', group: 'Disease' },
        { sample_id: 'GSM10005', group: 'Disease' },
        { sample_id: 'GSM10006', group: 'Disease' },
      ],
    }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(body.requires_external_download, true);
  assert.ok(body.savedAs.startsWith('sub_'));

  const manifestPath = path.join(INBOX, body.savedAs, 'intake_manifest.json');
  assert.ok(fs.existsSync(manifestPath));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.submission_mode, 'geo_accession');
  assert.equal(manifest.requires_external_download, true);
});

test('5. 验证模式 A 文件上传 -> .staging_ 校验 -> sub_ 原子落盘与 SHA-256 登记', async () => {
  const sid = 'm2test_' + Date.now();
  const matrixContent = [
    'Gene\tS_C1\tS_C2\tS_C3\tS_T1\tS_T2\tS_T3',
    'HLA-DRA\t10.5\t11.2\t12.1\t20.4\t21.0\t19.8',
    'RP11-34P13.7\t5.1\t4.9\t5.3\t9.8\t10.1\t9.5',
  ].join('\n');

  const upRes = await fetch(`${BASE}/api/datafiles?sid=${sid}&role=train_matrix&bind=GSE10001&name=expr_matrix.tsv`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: Buffer.from(matrixContent, 'utf8'),
  });
  const upBody = await upRes.json();
  assert.equal(upRes.status, 200, JSON.stringify(upBody));

  const subRes = await fetch(`${BASE}/api/intake/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      submission_mode: 'own_matrix',
      pipeline: 'line1_bulk',
      uploadSid: sid,
      groups: validGroups('S_'),
      dataFiles: [{ name: 'expr_matrix.tsv', path: upBody.path, role: 'train_matrix' }],
    }),
  });
  const subBody = await subRes.json();
  assert.equal(subRes.status, 200, JSON.stringify(subBody));
  assert.equal(subBody.ok, true);
  assert.equal(subBody.requires_external_download, false);
  assert.ok(subBody.savedAs.startsWith('sub_'));

  const entries = fs.readdirSync(INBOX);
  assert.equal(entries.filter((n) => n.startsWith('.staging_')).length, 0, '成功后不得残留 .staging_ 目录');

  const manifestPath = path.join(INBOX, subBody.savedAs, 'intake_manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.submission_mode, 'own_matrix');
  assert.equal(manifest.files.length, 1);
  assert.match(manifest.files[0].sha256, /^[a-f0-9]{64}$/);
});
