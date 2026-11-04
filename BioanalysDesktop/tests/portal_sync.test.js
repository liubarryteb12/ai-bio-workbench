/**
 * WP-2.4 portal sync 契约测试。
 *
 * 用真实 HTTP 打临时 inbox，验证 pending -> running -> done 的最小闭环，
 * 以及 legacy 单子、两套 token、触发限流与结果终态。不碰真实 portal/inbox/。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORTAL = path.join(ROOT, 'portal', 'serve.mjs');
const SYNC_TOKEN = 'sync-token-e2e-123';
const CLIENT_TOKEN = 'client-token-e2e-123';

const TMP_INBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'portal_sync_inbox_'));
delete process.env.PORTAL_TOKEN;
process.env.PORTAL_PORT = '0';
process.env.PORTAL_INBOX = TMP_INBOX;
process.env.SYNC_TOKEN = SYNC_TOKEN;
process.env.PORTAL_CLIENT_TOKEN = CLIENT_TOKEN;

const mod = await import(pathToFileURL(PORTAL).href + '?state=sync');

function readyPort() {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      const address = mod.server.address();
      if (address) return resolve(address.port);
      attempts += 1;
      if (attempts > 80) reject(new Error('portal 未在 10s 内监听临时端口'));
      else setTimeout(check, 125);
    };
    check();
  });
}

const PORT = await readyPort();
const BASE = `http://127.0.0.1:${PORT}`;

test.after(() => {
  mod.server.close();
  fs.rmSync(TMP_INBOX, { recursive: true, force: true });
});

function createPackageTicket(ticket, urgent = false) {
  fs.mkdirSync(path.join(TMP_INBOX, ticket, 'raw_data'), { recursive: true });
  const record = {
    ticket,
    basicInfo: { name: ticket },
    sync_status: 'pending',
    sync_urgent: urgent,
  };
  fs.writeFileSync(path.join(TMP_INBOX, ticket, 'requirement.json'),
    `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(TMP_INBOX, ticket, 'package_manifest.json'),
    JSON.stringify({ package_dir: ticket, counts: { data_files: 1 } }), 'utf8');
  fs.writeFileSync(path.join(TMP_INBOX, ticket, 'raw_data', 'input.txt'), 'bio input\n', 'utf8');
  return record;
}

function readRecord(ticket) {
  return JSON.parse(fs.readFileSync(path.join(TMP_INBOX, ticket, 'requirement.json'), 'utf8'));
}

async function json(pathname, options = {}) {
  const res = await fetch(BASE + pathname, options);
  let body;
  try { body = await res.json(); }
  catch { body = null; }
  return { res, body };
}

function syncAuth() { return { Authorization: `Bearer ${SYNC_TOKEN}` }; }
function clientAuth() { return { Authorization: `Bearer ${CLIENT_TOKEN}` }; }

test('提交请求落盘时初始化 sync_status=pending', async () => {
  const res = await fetch(`${BASE}/api/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      basicInfo: { name: 'sync_flat' },
      dataSource: {
        dataType: 'microarray', sampleCount: 2, tissue: 'Blood', species: 'Homo sapiens',
        data_source_mode: 'PUBLIC_DB', source: 'GEO',
        datasets: [{ gse: 'GSE10001', gpl: 'GPL570', role: 'train', sampleCount: 2, tissue: 'Blood' }],
      },
      groupingDesign: {
        mode: 'two_group',
        groups: [
          { groupName: 'Control', role: 'reference' },
          { groupName: 'Sepsis', role: 'disease_stage' },
        ],
        contrasts: [{ name: 'Sepsis_vs_Control', case: 'Sepsis', ctrl: 'Control', isPrimary: true }],
      },
      dataFiles: [],
      references: [],
      notes: 'WP-2.4',
    }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  const saved = JSON.parse(fs.readFileSync(path.join(TMP_INBOX, body.savedAs), 'utf8'));
  assert.equal(saved.sync_status, 'pending');
  assert.equal(saved.sync_urgent, false);
});

test('legacy 单子不进入 pending 清单', async () => {
  fs.writeFileSync(path.join(TMP_INBOX, 'legacy_ticket.json'),
    JSON.stringify({ ticket_id: 'legacy_ticket' }), 'utf8');
  const { res, body } = await json('/api/sync/pending', { headers: syncAuth() });
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.tickets.some((item) => item.ticket === 'legacy_ticket'), false);
});

test('pending 接口要求 SYNC_TOKEN 且 urgent 排前', async () => {
  createPackageTicket('PKG_20261026_sync_normal');
  createPackageTicket('PKG_20261026_sync_urgent', true);
  const denied = await fetch(`${BASE}/api/sync/pending`);
  assert.equal(denied.status, 401);

  const { res, body } = await json('/api/sync/pending', { headers: syncAuth() });
  assert.equal(res.status, 200);
  const ids = body.tickets.map((item) => item.ticket);
  assert.equal(ids.indexOf('PKG_20261026_sync_urgent'),
    Math.min(...ids.map((id, index) => (id === 'PKG_20261026_sync_urgent' ? index : 999))));
  assert.equal(ids.includes('legacy_ticket'), false);
});

test('claim 幂等标记 running 并返回可下载包', async () => {
  const ticket = 'PKG_20261026_sync_claim';
  createPackageTicket(ticket);
  const first = await json('/api/sync/claim', {
    method: 'POST',
    headers: { ...syncAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket }),
  });
  assert.equal(first.res.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.ok, true);
  assert.equal(first.body.status, 'running');
  assert.match(first.body.sha256, /^[0-9a-f]{64}$/);
  assert.equal(new URL(first.body.download_url).pathname, '/api/sync/package');
  const record = readRecord(ticket);
  assert.equal(record.sync_status, 'running');

  const second = await json('/api/sync/claim', {
    method: 'POST',
    headers: { ...syncAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket }),
  });
  assert.equal(second.body.ok, true);
  assert.equal(second.body.sha256, first.body.sha256);
  assert.equal(second.body.download_url, first.body.download_url);
  assert.equal(readRecord(ticket).sync_status, 'running');
});

test('package 只给已 claim 的单子并返回同一 sha256', async () => {
  const ticket = 'PKG_20261026_sync_package';
  createPackageTicket(ticket);
  const notClaimed = await fetch(`${BASE}/api/sync/package?ticket=${encodeURIComponent(ticket)}`, { headers: syncAuth() });
  assert.equal(notClaimed.status, 409);

  const claim = await json('/api/sync/claim', {
    method: 'POST',
    headers: { ...syncAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket }),
  });
  const archive = await fetch(`${BASE}/api/sync/package?ticket=${encodeURIComponent(ticket)}`, { headers: syncAuth() });
  const bytes = Buffer.from(await archive.arrayBuffer());
  const actual = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
  assert.equal(archive.status, 200);
  assert.equal(actual, claim.body.sha256);
  assert.equal(bytes.subarray(0, 2).readInt16BE(0), 0x1f8b);
  assert.equal(bytes.toString('utf8').includes('requirement.json'), false);
});

test('扁平 ticket 的同步包只包含本单 JSON，不带 inbox 其它文件', async () => {
  for (const name of ['flat_other.json', 'flat_target.json']) {
    fs.writeFileSync(path.join(TMP_INBOX, name), JSON.stringify({
      basicInfo: { name },
      sync_status: 'pending',
      sync_urgent: false,
    }), 'utf8');
  }
  const ticket = 'flat_target';
  const claim = await json('/api/sync/claim', {
    method: 'POST',
    headers: { ...syncAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket }),
  });
  assert.equal(claim.res.status, 200, JSON.stringify(claim.body));
  const archive = await fetch(`${BASE}/api/sync/package?ticket=${ticket}`, { headers: syncAuth() });
  const tar = zlib.gunzipSync(Buffer.from(await archive.arrayBuffer())).toString('utf8');
  assert.match(tar, /flat_target\.json/);
  assert.doesNotMatch(tar, /flat_other\.json/);
});

test('result 写入终态清单和文件，status 客户鉴权后可读', async () => {
  const ticket = 'PKG_20261026_sync_result';
  createPackageTicket(ticket);
  await json('/api/sync/claim', {
    method: 'POST',
    headers: { ...syncAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket }),
  });
  const content = Buffer.from('result artifact\n');
  const result = await json('/api/sync/result', {
    method: 'POST',
    headers: { ...syncAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ticket,
      status: 'done',
      manifest: { project: 'sync_result', files: [{ path: 'figures/figure.png', sha256: 'a'.repeat(64), size: content.length }] },
      files: [{ path: 'figures/figure.png', content_base64: content.toString('base64') }],
    }),
  });
  assert.equal(result.res.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.ok, true);
  assert.equal(readRecord(ticket).sync_status, 'done');
  assert.ok(fs.existsSync(path.join(TMP_INBOX, ticket, 'sync_results', 'figures', 'figure.png')));

  const denied = await fetch(`${BASE}/api/sync/status?ticket=${encodeURIComponent(ticket)}`);
  assert.equal(denied.status, 401);
  const wrong = await fetch(`${BASE}/api/sync/status?ticket=${encodeURIComponent(ticket)}`, { headers: { Authorization: 'Bearer wrong' } });
  assert.equal(wrong.status, 401);
  const status = await json(`/api/sync/status?ticket=${encodeURIComponent(ticket)}`, { headers: clientAuth() });
  assert.equal(status.res.status, 200);
  assert.equal(status.body.ticket, ticket);
  assert.equal(status.body.sync_status, 'done');
  assert.deepEqual(status.body.manifest, { project: 'sync_result', files: [{ path: 'figures/figure.png', sha256: 'a'.repeat(64), size: content.length }] });
});

test('扁平 ticket 的 results/file 能按 ticket 目录取回真实图片', async () => {
  const ticket = 'flat_result_image';
  fs.writeFileSync(path.join(TMP_INBOX, `${ticket}.json`), JSON.stringify({
    basicInfo: { name: ticket },
    sync_status: 'pending',
  }), 'utf8');
  await json('/api/sync/claim', {
    method: 'POST',
    headers: { ...syncAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket }),
  });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
  const result = await json('/api/sync/result', {
    method: 'POST',
    headers: { ...syncAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ticket,
      status: 'done',
      manifest: { files: [{ path: 'figures/line1_bulk/real.png', size: png.length }] },
      files: [{
        path: 'figures/line1_bulk/real.png',
        content_base64: png.toString('base64'),
      }],
    }),
  });
  assert.equal(result.res.status, 200, JSON.stringify(result.body));
  const res = await fetch(
    `${BASE}/api/sync/results/file?ticket=${ticket}&path=${encodeURIComponent('figures/line1_bulk/real.png')}`,
    { headers: clientAuth() },
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), png);
});

test('trigger 打 urgent 标记，同一单子 60 秒内限流', async () => {
  const ticket = 'PKG_20261026_sync_trigger';
  createPackageTicket(ticket);
  const first = await json('/api/sync/trigger', {
    method: 'POST',
    headers: { ...clientAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket }),
  });
  assert.equal(first.res.status, 200);
  assert.equal(first.body.ok, true);
  assert.equal(readRecord(ticket).sync_urgent, true);

  const second = await json('/api/sync/trigger', {
    method: 'POST',
    headers: { ...clientAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket }),
  });
  assert.equal(second.res.status, 429);
  assert.equal(second.body.ok, false);
  assert.ok(second.body.retry_after > 0 && second.body.retry_after <= 60);
  assert.match(second.body.error || '', /稍后重试/);
});

test('非法 ticket 和非法终态被拒绝', async () => {
  const bad = await json('/api/sync/status?ticket=..%2Foutside', { headers: clientAuth() });
  assert.equal(bad.res.status, 400);
  const wrongStatus = await json('/api/sync/result', {
    method: 'POST',
    headers: { ...syncAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket: 'PKG_20261026_sync_normal', status: 'running' }),
  });
  assert.equal(wrongStatus.res.status, 400);
});

test('sync daemon 脚本保留环回豁免、安全解包与退避契约', () => {
  const daemonPath = path.join(ROOT, 'ops', 'sync_daemon.ps1');
  const text = fs.readFileSync(daemonPath, 'utf8');
  assert.equal(text.includes('\r\n'), false, 'sync daemon 出现 CRLF');
  assert.ok(text.includes("$env:NO_PROXY = '127.0.0.1,localhost'"));
  assert.ok(text.includes('sha256'));
  assert.ok(text.includes('zip-slip'));
  assert.ok(text.includes('actions.jsonl'));
  assert.ok(text.includes('for ($attempt = 1'));
  assert.ok(text.includes('Invoke-ImportStub'));
  assert.ok(text.includes('Invoke-DispatchStub'));
});

test('sync verifier 对 src 与 bin 落点都做 -FailOnDrift 判定', () => {
  const verifierPath = path.join(ROOT, 'ops', 'sync_and_verify_remote.ps1');
  const text = fs.readFileSync(verifierPath, 'utf8');
  assert.ok(text.includes('$deployDrift'));
  assert.ok(text.includes('$deployPairs'));
  assert.ok(text.includes("if ($FailOnDrift)"));
  assert.ok(text.includes('（仓库 {1} != bin {2}）'));
});
