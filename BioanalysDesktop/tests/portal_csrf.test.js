/**
 * 门户写端点 CSRF 与鉴权契约（T0-2 / T0-3）。
 *
 * 背景（2026-11 全量审查实测）：
 *   - /api/survey/select、/api/survey/request 不在 PROTECTED_API 里，
 *     PORTAL_TOKEN 启用时也不校验令牌，任何人可覆盖任意调研单。
 *   - 全部写端点无 CSRF 防护：客户浏览器开着门户时，任意网页 POST 过来都会被接受。
 *
 * 设计取舍（刻意不砍掉「未配 token 即开放」的历史行为，避免打断现有本地用法）：
 *   - 令牌启用时：三个 survey 端点与原有三个写端点一样要求令牌。
 *   - CSRF：只看浏览器一定会带的 Sec-Fetch-Site 与 Origin。
 *     cross-site / same-site 一律 403；same-origin / none / 缺头（curl、Node 客户端）放行。
 *     缺头放行是刻意的：非浏览器客户端不带这两个头，且它们本来就不受 CSRF 影响。
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
const TOKEN = 'csrf-contract-token';

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
  const inbox = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-csrf-'));
  const port = await freePort();
  const child = spawn(process.execPath, [SERVE], {
    cwd: ROOT,
    env: { ...process.env, PORTAL_PORT: String(port), PORTAL_INBOX: inbox, ...extraEnv },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base + '/health');
      if (res.ok) break;
    } catch {
      /* 等启动 */
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return { child, port, inbox, base };
}

function stopPortal(ctx) {
  return new Promise((resolve) => {
    const cleanup = () => {
      try { fs.rmSync(ctx.inbox, { recursive: true, force: true }); } catch { /* 忽略 */ }
      resolve();
    };
    if (!ctx.child || ctx.child.exitCode !== null) return cleanup();
    ctx.child.once('exit', cleanup);
    ctx.child.kill();
    setTimeout(() => { try { ctx.child.kill('SIGKILL'); } catch { /* 已退 */ } }, 3000).unref();
  });
}

function postJson(url, body, headers = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

test('启用 PORTAL_TOKEN 时 survey 端点同样要求令牌', async () => {
  const ctx = await startPortal({ PORTAL_TOKEN: TOKEN });
  try {
    const body = { ticket_id: 'TSV-20261104-abcdef12', topic_ids: ['T1'] };
    const noToken = await postJson(ctx.base + '/api/survey/select', body);
    assert.equal(noToken.status, 401, '无令牌调用 /api/survey/select 必须 401');

    const badToken = await postJson(ctx.base + '/api/survey/select', body, { Authorization: 'Bearer wrong-token' });
    assert.equal(badToken.status, 401, '错误令牌必须 401');

    // 带对令牌时放行到业务校验（该 ticket 不存在 → 404，而不是 401）
    const good = await postJson(ctx.base + '/api/survey/select', body, { Authorization: `Bearer ${TOKEN}` });
    assert.equal(good.status, 404, '带正确令牌时应进入业务逻辑（找不到调研单 → 404）');
  } finally {
    await stopPortal(ctx);
  }
});

test('survey 写端点拒绝跨站请求（Sec-Fetch-Site: cross-site）', async () => {
  const ctx = await startPortal({ PORTAL_TOKEN: TOKEN });
  try {
    const crossSite = await postJson(
      ctx.base + '/api/survey/request',
      { disease: '肺腺癌', interest: '免疫微环境' },
      { Authorization: `Bearer ${TOKEN}`, 'Sec-Fetch-Site': 'cross-site' },
    );
    assert.equal(crossSite.status, 403, '跨站请求必须 403，即使令牌正确');
  } finally {
    await stopPortal(ctx);
  }
});

test('主提交端点拒绝跨站请求，但同源与非浏览器客户端放行', async () => {
  const ctx = await startPortal({ PORTAL_TOKEN: TOKEN });
  try {
    const auth = { Authorization: `Bearer ${TOKEN}` };

    const crossSite = await postJson(ctx.base + '/api/submit', { projectName: 'X' }, { ...auth, 'Sec-Fetch-Site': 'cross-site' });
    assert.equal(crossSite.status, 403, '/api/submit 跨站必须 403');

    const sameSite = await postJson(ctx.base + '/api/submit', { projectName: 'Y' }, { ...auth, 'Sec-Fetch-Site': 'same-site' });
    assert.equal(sameSite.status, 403, 'same-site（兄弟域）也必须 403');

    const badOrigin = await postJson(
      ctx.base + '/api/submit',
      { projectName: 'Z' },
      { ...auth, 'Sec-Fetch-Site': 'same-origin', Origin: 'https://evil.example.com' },
    );
    assert.equal(badOrigin.status, 403, 'Origin 与自身不同源必须 403');

    // 同源：Origin 是本站 → 不应 403（业务校验失败会是 400/422，那是另一回事）
    const sameOrigin = await postJson(
      ctx.base + '/api/submit',
      { projectName: 'W' },
      { ...auth, 'Sec-Fetch-Site': 'same-origin', Origin: ctx.base },
    );
    assert.notEqual(sameOrigin.status, 403, '同源请求不得被 CSRF 闸拦下');

    // 非浏览器客户端：两个头都不带 → 放行
    const plain = await postJson(ctx.base + '/api/submit', { projectName: 'V' }, auth);
    assert.notEqual(plain.status, 403, '不带 Sec-Fetch-Site 的客户端不得被 CSRF 闸拦下');
  } finally {
    await stopPortal(ctx);
  }
});
