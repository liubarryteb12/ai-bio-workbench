/**
 * 用户需求专栏契约测试（2026-11-12）：
 *   - 门户页能打开，且正式需求页有入口；
 *   - 10 类方向的空字段提交能落盘；
 *   - 空提交、非法邮箱、肿瘤词命中分别被拒；
 *   - 文件落在 feature_requests/ 子目录，不污染正式收件箱。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVE = path.join(ROOT, 'portal', 'serve.mjs');

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

async function startPortal(extraEnv = {}) {
  const inbox = fs.mkdtempSync(path.join(os.tmpdir(), 'feature-request-test-'));
  const port = await freePort();
  const child = spawn(process.execPath, [SERVE], {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv, PORTAL_PORT: String(port), PORTAL_INBOX: inbox },
    stdio: 'ignore',
  });
  return { child, port, inbox, base: `http://127.0.0.1:${port}` };
}

async function waitHealthy(base, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return true;
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function stopPortal(ctx) {
  try { ctx.child.kill(); } catch { /* 已退出 */ }
  try { fs.rmSync(ctx.inbox, { recursive: true, force: true }); } catch { /* 忽略 */ }
}

async function postFeature(base, payload) {
  return fetch(`${base}/api/feature-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

test('用户需求专栏页面能打开，正式需求页有入口', async () => {
  const ctx = await startPortal();
  try {
    assert.equal(await waitHealthy(ctx.base), true, 'portal 应能起来');

    const page = await fetch(`${ctx.base}/feature_request.html`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /用户需求专栏/);
    assert.match(html, /功能需求/);
    assert.match(html, /其他想法/);
    for (const category of [
      'function', 'figure_new', 'figure_style', 'report_content', 'data_source',
      'report_style', 'portal_ux', 'delivery', 'performance', 'other',
    ]) {
      assert.match(html, new RegExp(`value="${category}"`), `应包含 ${category} 类`);
    }

    const index = await fetch(`${ctx.base}/index.html`);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /feature_request\.html/);
  } finally { stopPortal(ctx); }
});

test('只写标题也能提交，默认归到 other 并落到子目录', async () => {
  const ctx = await startPortal();
  try {
    assert.equal(await waitHealthy(ctx.base), true);
    const response = await postFeature(ctx.base, { title: '希望出图能更方便一点' });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.ticket_id, /^FR-\d{8}-[0-9a-f]{8}$/);

    const file = path.join(ctx.inbox, 'feature_requests', `${body.ticket_id}.json`);
    assert.equal(fs.existsSync(file), true, '需求应落盘到 feature_requests/ 子目录');
    assert.equal(fs.existsSync(path.join(ctx.inbox, `${body.ticket_id}.json`)), false, '不应污染正式收件箱根目录');

    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(record.kind, 'feature_request');
    assert.equal(record.category, 'other');
    assert.equal(record.status, 'pending');
    assert.equal(record.title, '希望出图能更方便一点');
    assert.deepEqual(record.details, {});
  } finally { stopPortal(ctx); }
});

test('带分类、细节和邮箱的提交原样保留可选字段', async () => {
  const ctx = await startPortal();
  try {
    assert.equal(await waitHealthy(ctx.base), true);
    const response = await postFeature(ctx.base, {
      category: 'figure_style',
      title: '火山图标注前 20 个基因',
      description: '希望标注 log2FC 最高且 padj 最低的基因',
      details: {
        'fs-target': '火山图',
        'fs-aspect': ['label', 'color'],
        'fs-ref': 'https://example.org/figure.png',
      },
      contact: { email: 'client@example.com' },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    const file = path.join(ctx.inbox, 'feature_requests', `${body.ticket_id}.json`);
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(record.category, 'figure_style');
    assert.equal(record.details['fs-target'], '火山图');
    assert.deepEqual(record.details['fs-aspect'], ['label', 'color']);
    assert.equal(record.contact.email, 'client@example.com');
  } finally { stopPortal(ctx); }
});

test('全空提交被拒（422）', async () => {
  const ctx = await startPortal();
  try {
    assert.equal(await waitHealthy(ctx.base), true);
    const response = await postFeature(ctx.base, { category: 'other' });
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.match(body.error, /至少写一句话/);
  } finally { stopPortal(ctx); }
});

test('邮箱格式非法被拒（422）', async () => {
  const ctx = await startPortal();
  try {
    assert.equal(await waitHealthy(ctx.base), true);
    const response = await postFeature(ctx.base, {
      title: '一个想法',
      contact: { email: 'not-an-email' },
    });
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /邮箱格式/);
  } finally { stopPortal(ctx); }
});

test('肿瘤词命中权威黑名单时被拦（422）', async () => {
  const ctx = await startPortal();
  try {
    assert.equal(await waitHealthy(ctx.base), true);
    const response = await postFeature(ctx.base, {
      category: 'function',
      title: 'lung adenocarcinoma 单细胞分析',
    });
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.ok(body.matched && body.matched.length > 0, '应回带命中词');
  } finally { stopPortal(ctx); }
});

test('启用 PORTAL_TOKEN 时专栏写端点要求令牌', async () => {
  const testToken = 'feature-portal-token';
  const ctx = await startPortal({ PORTAL_TOKEN: testToken });
  try {
    assert.equal(await waitHealthy(ctx.base), true);

    const page = await fetch(`${ctx.base}/feature_request.html`);
    assert.equal(page.status, 200, '静态页不鉴权，保证客户能打开');

    const denied = await postFeature(ctx.base, { title: '一个想法' });
    assert.equal(denied.status, 401);

    const allowed = await fetch(`${ctx.base}/api/feature-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testToken}` },
      body: JSON.stringify({ title: '一个想法' }),
    });
    assert.equal(allowed.status, 200);
    assert.match((await allowed.json()).ticket_id, /^FR-\d{8}-[0-9a-f]{8}$/);
  } finally { stopPortal(ctx); }
});

test('专栏写端点拒绝跨站请求（403）', async () => {
  const ctx = await startPortal();
  try {
    assert.equal(await waitHealthy(ctx.base), true);
    const response = await fetch(`${ctx.base}/api/feature-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Sec-Fetch-Site': 'cross-site',
      },
      body: JSON.stringify({ title: '一个想法' }),
    });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /跨站请求/);
  } finally { stopPortal(ctx); }
});
