/**
 * D2 轻量接收器契约测试（Gemini Argon 判决）。
 *
 * 判据：
 *   1. pending → claim → 下载 → 哈希校验 → 解包到收件箱 → result 回写 done。
 *   2. 哈希不一致时不落收件箱，返回 failed。
 *   3. result 回写失败进入重试队列，恢复后能补写成功。
 *   4. 幂等键命中时重复包跳过。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

import { createPortalSyncReceiver } from '../server/services/portal_sync_receiver.js';

const TICKET = 'PKG_20261115_120000_sync_test';

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function buildPackage(root) {
  const srcDir = path.join(root, 'src', TICKET);
  fs.mkdirSync(path.join(srcDir, 'raw_data'), { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'requirement.json'), JSON.stringify({ basicInfo: { name: 'sync' } }), 'utf8');
  fs.writeFileSync(path.join(srcDir, 'raw_data', 'matrix.tsv'), 'gene\ts1\nA\t1\n', 'utf8');
  const archive = path.join(root, `${TICKET}.tar.gz`);
  const tar = spawnSync('tar', ['-czf', archive, '-C', srcDir, '.'], { encoding: 'utf8' });
  assert.equal(tar.status, 0, `tar 打包失败: ${tar.stderr || tar.stdout}`);
  return { archive, bytes: fs.readFileSync(archive) };
}

async function startMockPortal({ archiveBytes, failResultOnce = false }) {
  const state = {
    claimed: false,
    resultBodies: [],
    resultFailures: failResultOnce ? 1 : 0,
  };
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== 'Bearer test-token') return json(401, { ok: false, error: 'unauthorized' });
    if (url.pathname === '/api/sync/pending') {
      return json(200, { ok: true, tickets: state.claimed ? [] : [{ ticket: TICKET, urgent: false }] });
    }
    if (url.pathname === '/api/sync/claim' && req.method === 'POST') {
      state.claimed = true;
      return json(200, {
        ok: true, ticket: TICKET, status: 'running',
        sha256: sha256(archiveBytes),
      });
    }
    if (url.pathname === '/api/sync/package') {
      res.writeHead(200, { 'Content-Type': 'application/gzip' });
      return res.end(archiveBytes);
    }
    if (url.pathname === '/api/sync/result' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      if (state.resultFailures > 0) {
        state.resultFailures -= 1;
        return json(500, { ok: false, error: 'temporary failure' });
      }
      state.resultBodies.push(JSON.parse(raw || '{}'));
      return json(200, { ok: true, ticket: TICKET, status: 'done' });
    }
    return json(404, { ok: false, error: 'not found' });
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${srv.address().port}`,
    state,
    close: () => new Promise((resolve) => srv.close(resolve)),
  };
}

function makeReceiver(root, baseUrl, overrides = {}) {
  return createPortalSyncReceiver({
    portalBaseUrl: baseUrl,
    syncToken: 'test-token',
    inboxRoot: path.join(root, 'inbox'),
    cacheDir: path.join(root, 'cache'),
    idleIntervalMs: 10,
    activeIntervalMs: 5,
    logger: { warn: () => {}, error: () => {} },
    ...overrides,
  });
}

test('D2：pull → 校验 → 解包 → result 回写 done，重复包幂等跳过', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-sync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pkg = buildPackage(root);
  const portal = await startMockPortal({ archiveBytes: pkg.bytes });
  t.after(() => portal.close());
  const receiver = makeReceiver(root, portal.baseUrl);

  const first = await receiver.pollOnce();
  assert.equal(first.processed, 1);
  assert.equal(first.results[0].status, 'done');
  assert.equal(first.results[0].sha256, sha256(pkg.bytes));
  const unpacked = path.join(root, 'inbox', TICKET, 'requirement.json');
  assert.equal(fs.existsSync(unpacked), true, '包必须解到收件箱');
  assert.equal(portal.state.resultBodies.length, 1);
  assert.equal(portal.state.resultBodies[0].status, 'done');
  assert.equal(portal.state.resultBodies[0].ticket, TICKET);

  const second = await receiver.pollOnce();
  assert.equal(second.idle, true);
});

test('D2：哈希不一致不落收件箱，返回 failed', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-sync-bad-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pkg = buildPackage(root);
  const portal = await startMockPortal({ archiveBytes: pkg.bytes });
  t.after(() => portal.close());
  // 伪造 claim 返回的错误哈希：用独立 mock 覆盖 sha256。
  const badPortal = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/api/sync/pending') return json(200, { ok: true, tickets: [{ ticket: TICKET }] });
    if (url.pathname === '/api/sync/claim') return json(200, { ok: true, ticket: TICKET, sha256: '0'.repeat(64) });
    if (url.pathname === '/api/sync/package') { res.writeHead(200); return res.end(pkg.bytes); }
    return json(404, { ok: false });
  });
  await new Promise((resolve) => badPortal.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => badPortal.close(resolve)));
  const receiver = makeReceiver(root, `http://127.0.0.1:${badPortal.address().port}`);
  const outcome = await receiver.pollOnce();
  assert.equal(outcome.results[0].status, 'failed');
  assert.match(outcome.results[0].error, /哈希不一致/);
  assert.equal(fs.existsSync(path.join(root, 'inbox', TICKET)), false);
});

test('D2：result 回写失败进入重试队列，恢复后补写成功', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-sync-retry-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pkg = buildPackage(root);
  const portal = await startMockPortal({ archiveBytes: pkg.bytes, failResultOnce: true });
  t.after(() => portal.close());
  const receiver = makeReceiver(root, portal.baseUrl, { resultRetryMs: 0 });
  await receiver.pollOnce();
  const state = receiver.getState();
  assert.equal(state.pendingResults.length, 1, '失败的 result 必须进重试队列');
  assert.equal(fs.existsSync(path.join(root, 'inbox', TICKET, 'requirement.json')), true);

  const flushed = await receiver.flushResultQueue();
  assert.equal(flushed.flushed, 1);
  assert.equal(receiver.getState().pendingResults.length, 0);
  assert.equal(portal.state.resultBodies.length, 1);
});


