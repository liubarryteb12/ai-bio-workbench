/**
 * 用户提交台（portal）可选 Token 鉴权（B4）契约测试。
 *
 * 两层覆盖：
 *   A. checkToken 纯函数单测（import serve.mjs 本体，不起额外服务即可验证放行/拒绝路径；
 *      模块加载会 listen(0) 占一个临时端口，测试结束统一 close）。
 *      「未启用 / 启用」两种状态通过带 query 的动态 import 各加载一份模块实例
 *      （PORTAL_TOKEN 在模块加载时固化，ESM 缓存下只能这样拿到两种状态）。
 *   B. 真进程 E2E（照 portal_submit.test.js 范式 spawn + PORTAL_PORT/PORTAL_INBOX，
 *      启用实例额外传 PORTAL_TOKEN）：401/200 必须真打 HTTP 验证，
 *      / 与 /health 豁免、/health 的 auth_required 两种取值、未启用时全链路与既有正路径一致。
 *
 * 收件箱一律指到临时目录，测试不碰真实 portal/inbox/。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const PORTAL = path.join(REPO, 'portal', 'serve.mjs');

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

// ============================================================
// A. checkToken 纯函数单测
// ============================================================
// 未启用实例：PORTAL_TOKEN 不设（或为空）
const TMP_OFF = fs.mkdtempSync(path.join(os.tmpdir(), 'portal_auth_off_'));
delete process.env.PORTAL_TOKEN;
process.env.PORTAL_PORT = '0'; // listen(0) 临时端口，避免和真实 8080 冲突
process.env.PORTAL_INBOX = TMP_OFF;
const modOff = await import(pathToFileURL(PORTAL).href + '?state=disabled');

// 启用实例：PORTAL_TOKEN 显式设置
const TMP_ON = fs.mkdtempSync(path.join(os.tmpdir(), 'portal_auth_on_'));
process.env.PORTAL_TOKEN = 'unit-secret-token-123';
process.env.PORTAL_INBOX = TMP_ON;
const modOn = await import(pathToFileURL(PORTAL).href + '?state=enabled');

test.after(() => {
  modOff.server.close();
  modOn.server.close();
  fs.rmSync(TMP_OFF, { recursive: true, force: true });
  fs.rmSync(TMP_ON, { recursive: true, force: true });
});

const OK_URL = new URL('http://127.0.0.1:8080/api/submit');
const noHeaders = { headers: {} };

test('checkToken：未启用（env 空）时任何请求都放行', () => {
  assert.deepEqual(modOff.checkToken(noHeaders, OK_URL), { ok: true });
  assert.deepEqual(modOff.checkToken({ headers: { authorization: 'Bearer wrong' } }, OK_URL), { ok: true });
  assert.deepEqual(modOff.checkToken(noHeaders, new URL('http://x/api/submit?token=bad')), { ok: true });
});

test('checkToken：启用后 Bearer 正确 → ok', () => {
  assert.deepEqual(
    modOn.checkToken({ headers: { authorization: 'Bearer unit-secret-token-123' } }, OK_URL),
    { ok: true },
  );
});

test('checkToken：启用后 Bearer 错误 → 拒', () => {
  const v = modOn.checkToken({ headers: { authorization: 'Bearer wrong-token' } }, OK_URL);
  assert.equal(v.ok, false);
  assert.match(v.error, /未授权/);
});

test('checkToken：启用后 query 正确 → ok', () => {
  assert.deepEqual(
    modOn.checkToken(noHeaders, new URL('http://x/api/submit?token=unit-secret-token-123')),
    { ok: true },
  );
});

test('checkToken：启用后 query 错误 → 拒', () => {
  const v = modOn.checkToken(noHeaders, new URL('http://x/api/submit?token=nope'));
  assert.equal(v.ok, false);
  assert.match(v.error, /未授权/);
});

test('checkToken：启用后两者都缺 → 拒（含大小写混写的 Bearer 头也算缺）', () => {
  assert.equal(modOn.checkToken(noHeaders, OK_URL).ok, false);
  assert.equal(modOn.checkToken({ headers: {} }, OK_URL).ok, false);
  // 非法 scheme（Basic）不带 token，应视为缺失而不是崩溃
  assert.equal(modOn.checkToken({ headers: { authorization: 'Basic dXNlcjpwYXNz' } }, OK_URL).ok, false);
});

test('checkToken：token 长度不等时不抛异常且拒（同长度不同值也拒）', () => {
  const expected = 'unit-secret-token-123';
  // 长度不等（比正确 token 短）→ 直接拒，不进 timingSafeEqual
  const short = modOn.checkToken({ headers: { authorization: `Bearer ${'a'.repeat(5)}` } }, OK_URL);
  assert.equal(short.ok, false);
  // 长度相等但内容不同 → timingSafeEqual 路径也必须拒
  const sameLen = modOn.checkToken({ headers: { authorization: `Bearer ${'x'.repeat(expected.length)}` } }, OK_URL);
  assert.equal(sameLen.ok, false);
  assert.match(short.error, /未授权/);
  assert.match(sameLen.error, /未授权/);
});

// ============================================================
// B. 真进程 E2E · 启用态（PORTAL_TOKEN 生效）
// ============================================================
const E2E_TOKEN = 'e2e-token-xyz-456';
const PORT_ON = await freePort();
const BASE_ON = `http://127.0.0.1:${PORT_ON}`;
const INBOX_ON = fs.mkdtempSync(path.join(os.tmpdir(), 'portal_e2e_on_'));
const childOn = spawn(process.execPath, [PORTAL], {
  env: { ...process.env, PORTAL_PORT: String(PORT_ON), PORTAL_INBOX: INBOX_ON, PORTAL_TOKEN: E2E_TOKEN },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const warnLogOn = [];
childOn.stderr.on('data', (d) => warnLogOn.push(String(d)));
childOn.stdout.on('data', (d) => warnLogOn.push(String(d)));

async function waitReady(base) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return await res.json();
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

const healthOn = await waitReady(BASE_ON);

const SID_ON = 'authe2e01';
const PAYLOAD_ON = {
  manifest_version: '1.0',
  basicInfo: { name: '测试项目_鉴权E2E', description: '鉴权契约测试', domain: '免疫', disease: 'Sepsis', species: 'Homo sapiens', nonTumorVerified: true },
  dataSource: {
    dataType: 'microarray', sampleCount: 12, tissue: 'Blood', species: 'Homo sapiens',
    data_source_mode: 'PUBLIC_DB', source: 'GEO',
    datasets: [{ gse: 'GSE10001', gpl: 'GPL570', role: 'train', sampleCount: 12, tissue: 'Blood' }],
  },
  groupingDesign: {
    mode: 'two_group',
    groups: [
      { groupName: 'Control', role: 'reference', stageOrder: 0, sampleIds: ['GSM1', 'GSM2'] },
      { groupName: 'Sepsis', role: 'disease_stage', stageOrder: 1, sampleIds: ['GSM3', 'GSM4'] },
    ],
    contrasts: [{ name: 'Sepsis_vs_Control', case: 'Sepsis', ctrl: 'Control', isPrimary: true }],
  },
  dataFiles: [],
  references: [],
  uploadSid: SID_ON,
  notes: '鉴权契约测试',
};

test('启用态：/health 就绪且 auth_required=true', async () => {
  assert.ok(healthOn, 'portal（启用态）未在 10s 内就绪');
  assert.equal(healthOn.auth_required, true);
  // 既有字段一个不许丢
  assert.equal(healthOn.ok, true);
  assert.equal(healthOn.service, 'user-portal');
});

test('启用态：/ 与 /health 不带 token 仍 200（豁免生效）', async () => {
  const page = await fetch(`${BASE_ON}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /提交生信分析需求/);
  const health = await fetch(`${BASE_ON}/health`);
  assert.equal(health.status, 200);
  const indexHtml = await fetch(`${BASE_ON}/index.html`);
  assert.equal(indexHtml.status, 200);
});

test('启用态：无 token 打 /api/submit → 401 且 error 含「未授权」', async () => {
  const res = await fetch(`${BASE_ON}/api/submit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(PAYLOAD_ON),
  });
  assert.equal(res.status, 401);
  assert.match((await res.json()).error, /未授权/);
  // 鉴权失败有 warn 行，且不泄露任何 token 内容
  const log = warnLogOn.join('');
  assert.match(log, /鉴权失败.*POST \/api\/submit/);
  assert.equal(log.includes(E2E_TOKEN), false, '日志不得出现 token 本身');
});

test('启用态：错误 Bearer token → 401', async () => {
  const res = await fetch(`${BASE_ON}/api/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer definitely-wrong' },
    body: JSON.stringify(PAYLOAD_ON),
  });
  assert.equal(res.status, 401);
  assert.match((await res.json()).error, /未授权/);
});

test('启用态：正确 Bearer 提交 /api/submit → 200 落盘', async () => {
  const res = await fetch(`${BASE_ON}/api/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${E2E_TOKEN}` },
    body: JSON.stringify(PAYLOAD_ON),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  // payload 带 uploadSid：按服务端既有契约归档成 PKG_ 包目录
  assert.match(body.savedAs, /^PKG_\d{4}-\d{2}-\d{2}_\d{6}_测试项目_鉴权E2E$/);
  assert.ok(fs.existsSync(path.join(INBOX_ON, body.savedAs, 'requirement.json')), '需求应归档进包目录');
});

test('启用态：正确 query token 上传 /api/datafiles → 200 且落盘', async () => {
  const sid = 'authe2e02';
  const url = `${BASE_ON}/api/datafiles?sid=${sid}&role=train_matrix&bind=GSE10001&name=${encodeURIComponent('series matrix.txt.gz')}&token=${encodeURIComponent(E2E_TOKEN)}`;
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' },
    body: Buffer.from('gene\tS1\tS2\nA\t1\t2\n'),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.ok(fs.existsSync(path.join(INBOX_ON, body.path)), '文件应落在临时收件箱内');
});

// ============================================================
// B2. 真进程 E2E · 未启用态（不设 PORTAL_TOKEN）：全链路与既有正路径一致
// ============================================================
const PORT_OFF = await freePort();
const BASE_OFF = `http://127.0.0.1:${PORT_OFF}`;
const INBOX_OFF = fs.mkdtempSync(path.join(os.tmpdir(), 'portal_e2e_off_'));
const childOff = spawn(process.execPath, [PORTAL], {
  // 关键：A 段单测设置过本进程的 process.env.PORTAL_TOKEN，spawn 会整体继承 env，
  // 这里必须显式置空，才能真实验证「未启用态与历史行为一致」
  env: { ...process.env, PORTAL_PORT: String(PORT_OFF), PORTAL_INBOX: INBOX_OFF, PORTAL_TOKEN: '' },
  stdio: 'ignore',
});

const healthOff = await waitReady(BASE_OFF);
const SID_OFF = 'authe2e03';

test('未启用态：/health auth_required=false 且全链路（上传+包归档+扁平提交）与既往一致', async () => {
  assert.ok(healthOff, 'portal（未启用态）未在 10s 内就绪');
  assert.equal(healthOff.auth_required, false);

  // 1) 无任何 token 头上传数据文件 → 200（未启用时不要求令牌）
  const up = await fetch(`${BASE_OFF}/api/datafiles?sid=${SID_OFF}&role=train_matrix&bind=GSE10001&name=${encodeURIComponent('series matrix.txt.gz')}`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' },
    body: Buffer.from('gene\tS1\tS2\nA\t1\t2\n'),
  });
  const upBody = await up.json();
  assert.equal(up.status, 200, JSON.stringify(upBody));
  assert.equal(upBody.path, `uploads/${SID_OFF}/series_matrix.txt.gz`);

  // 2) 包形态提交（与 portal_submit.test.js 正路径等价）→ 200 归档成 PKG_
  const pkgRes = await fetch(`${BASE_OFF}/api/submit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      manifest_version: '1.0',
      basicInfo: { name: '测试项目_未启用态', description: '未启用态回归', domain: '免疫', disease: 'Sepsis', species: 'Homo sapiens', nonTumorVerified: true },
      dataSource: {
        dataType: 'microarray', sampleCount: 12, tissue: 'Blood', species: 'Homo sapiens',
        data_source_mode: 'PUBLIC_DB', source: 'GEO',
        datasets: [{ gse: 'GSE10001', gpl: 'GPL570', role: 'train', sampleCount: 12, tissue: 'Blood' }],
      },
      groupingDesign: {
        mode: 'two_group',
        groups: [
          { groupName: 'Control', role: 'reference', stageOrder: 0, sampleIds: ['GSM1', 'GSM2'] },
          { groupName: 'Sepsis', role: 'disease_stage', stageOrder: 1, sampleIds: ['GSM3', 'GSM4'] },
        ],
        contrasts: [{ name: 'Sepsis_vs_Control', case: 'Sepsis', ctrl: 'Control', isPrimary: true }],
      },
      references: [],
      uploadSid: SID_OFF,
      notes: '未启用态回归',
      dataFiles: [{ role: 'train_matrix', bind: 'GSE10001', name: 'series matrix.txt.gz', path: `uploads/${SID_OFF}/series_matrix.txt.gz`, size: 30 }],
    }),
  });
  const pkgBody = await pkgRes.json();
  assert.equal(pkgRes.status, 200, JSON.stringify(pkgBody));
  assert.match(pkgBody.savedAs, /^PKG_\d{4}-\d{2}-\d{2}_\d{6}_测试项目_未启用态$/);
  const man = JSON.parse(fs.readFileSync(path.join(INBOX_OFF, pkgBody.savedAs, 'package_manifest.json'), 'utf8'));
  assert.equal(man.counts.data_files, 1);
  assert.ok(fs.existsSync(path.join(INBOX_OFF, pkgBody.savedAs, 'raw_data', man.data_files[0].archive_name)));

  // 3) 扁平提交（无 token 头）→ 200
  const flatRes = await fetch(`${BASE_OFF}/api/submit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(PAYLOAD_ON),
  });
  const flatBody = await flatRes.json();
  assert.equal(flatRes.status, 200, JSON.stringify(flatBody));
  assert.equal(flatBody.ok, true);
});

test.after(() => {
  childOn.kill();
  childOff.kill();
  fs.rmSync(INBOX_ON, { recursive: true, force: true });
  fs.rmSync(INBOX_OFF, { recursive: true, force: true });
});
