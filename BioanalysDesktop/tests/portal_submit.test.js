/**
 * 用户提交台（portal）HTTP 行为契约测试。
 *
 * 覆盖真实链路（起真进程、打真 HTTP）：
 *   POST /api/datafiles  上传数据文件（二进制流）→ 落 inbox/uploads/<sid>/
 *   POST /api/submit     带数据文件 → 归档成 PKG_ 包目录；
 *                        不带 → 按老客户端形态落平铺 JSON
 *   校验失败必须 400 且点名问题（文件名与填写不一致 / 扩展名不在白名单）
 *
 * 收件箱用 PORTAL_INBOX 指到临时目录，测试不碰真实 portal/inbox/。
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
const INBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'portal_inbox_'));

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

// 等服务就绪（最多 10s）
const healthDeadline = Date.now() + 10000;
let up = false;
while (Date.now() < healthDeadline) {
  try {
    const res = await fetch(`${BASE}/health`);
    if (res.ok) { up = true; break; }
  } catch { /* 还没起来 */ }
  await new Promise((r) => setTimeout(r, 150));
}

test.after(() => {
  child.kill();
  fs.rmSync(INBOX, { recursive: true, force: true });
});

const SID = 'test' + 'a1b2c3';
const PAYLOAD = {
  manifest_version: '1.0',
  basicInfo: { name: '测试项目_白细胞', description: '契约测试', domain: '免疫', disease: 'Sepsis', species: 'Homo sapiens', nonTumorVerified: true },
  dataSource: {
    dataType: 'microarray', sampleCount: 12, tissue: 'Blood', species: 'Homo sapiens',
    data_source_mode: 'PUBLIC_DB', source: 'GEO',
    datasets: [{ gse: 'GSE10001', gpl: 'GPL570', role: 'train' }],
  },
  groupingDesign: { mode: 'two_group', groups: [], contrasts: [] },
  dataFiles: [],
  references: [],
  uploadSid: SID,
  notes: '契约测试',
};

test('用户端起真进程并暴露 /health', () => {
  assert.equal(up, true, 'portal 未在 10s 内就绪');
});

test('上传数据文件：二进制流落 uploads/<sid>/，返回相对路径', async () => {
  const url = `${BASE}/api/datafiles?sid=${SID}&role=train_matrix&bind=GSE10001&name=${encodeURIComponent('series matrix.txt.gz')}`;
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' },
    body: Buffer.from('gene\tS1\tS2\nA\t1\t2\n'),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(body.path, `uploads/${SID}/series_matrix.txt.gz`);
  assert.ok(fs.existsSync(path.join(INBOX, body.path)), '文件应落在临时收件箱内');
});

test('上传非法扩展名被拒（不落盘）', async () => {
  const url = `${BASE}/api/datafiles?sid=${SID}&role=other&name=${encodeURIComponent('evil.exe')}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from('x') });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /evil\.exe/);
});

test('提交带数据文件：归档成 PKG_ 包，manifest 计数与磁盘一致', async () => {
  const res = await fetch(`${BASE}/api/submit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...PAYLOAD,
      dataFiles: [{ role: 'train_matrix', bind: 'GSE10001', name: 'series matrix.txt.gz', path: `uploads/${SID}/series_matrix.txt.gz`, size: 30 }],
    }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.match(body.savedAs, /^PKG_\d{4}-\d{2}-\d{2}_\d{6}_测试项目_白细胞$/);

  const pkg = path.join(INBOX, body.savedAs);
  const req = JSON.parse(fs.readFileSync(path.join(pkg, 'requirement.json'), 'utf8'));
  const man = JSON.parse(fs.readFileSync(path.join(pkg, 'package_manifest.json'), 'utf8'));
  // 需求原样保留：选线依据与配对设计不能在被归档时丢掉
  assert.equal(req.dataSource.dataType, 'microarray');
  assert.equal(req.dataSource.datasets[0].gse, 'GSE10001');
  assert.equal(man.counts.data_files, 1);
  assert.equal(man.data_files[0].archive_name, 'train_matrix__GSE10001__series_matrix.txt.gz');
  assert.ok(fs.existsSync(path.join(pkg, 'raw_data', man.data_files[0].archive_name)), '数据文件应搬进 raw_data/');
  // 上传会话目录应被清空（uploads 不无限堆积）
  assert.equal(fs.existsSync(path.join(INBOX, 'uploads', SID)), false);
});

test('提交时数据文件名与需求填写不一致 → 400 点名问题', async () => {
  const res = await fetch(`${BASE}/api/submit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...PAYLOAD,
      uploadSid: 'test' + 'd4e5f6',
      basicInfo: { ...PAYLOAD.basicInfo, name: '测试项目_非法文件名' },
      dataSource: { ...PAYLOAD.dataSource, data_source_mode: 'IN_HOUSE_UPLOAD',
        uploaded_files: { train_matrix: 'raw_data/mouse_cortex.tsv', val_matrix: null } },
      dataFiles: [{ role: 'train_matrix', bind: '', name: 'mouse_cortex_v2.tsv', path: 'uploads/x/mouse_cortex_v2.tsv', size: 10 }],
    }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /与填写的矩阵文件名 .* 不一致/);
});

test('老客户端（无数据文件）仍落平铺 JSON，工作台两种形态都认', async () => {
  const res = await fetch(`${BASE}/api/submit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      manifest_version: '1.0',
      submitted_at: '2026-10-19_120000',
      basicInfo: { name: '测试项目_旧格式', disease: 'Flu', domain: '呼吸', species: 'Homo sapiens' },
      dataSource: { source: 'GEO', dataType: 'microarray', trainGse: 'GSE10001', valGse: '', gpl: 'GPL570', sampleCount: 6, tissue: 'Blood', datasets: [{ gse: 'GSE10001', gpl: 'GPL570', role: 'train' }] },
      groupingDesign: { mode: 'two_group', groups: [] },
    }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.match(body.savedAs, /^\d{4}-\d{2}-\d{2}_\d{6}_requirement_[A-Za-z0-9_-]+\.json$/);
  assert.ok(fs.existsSync(path.join(INBOX, body.savedAs)), '扁平 JSON 应直接落在 inbox 根');
});

test('缺数据类型 / 缺数据集：提交即 400，不落盘', async () => {
  const noType = await fetch(`${BASE}/api/submit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ basicInfo: { name: 'x' }, dataSource: { dataType: 'nope' } }),
  });
  assert.equal(noType.status, 400);
  assert.match((await noType.json()).error, /数据类型缺失或非法/);

  const noDataset = await fetch(`${BASE}/api/submit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ basicInfo: { name: 'x' }, dataSource: { dataType: 'microarray', datasets: [] } }),
  });
  assert.equal(noDataset.status, 400);
  assert.match((await noDataset.json()).error, /数据集缺失/);
});
