/**
 * 门户进程韧性契约（T0-1）：
 * 一条畸形请求不得打死整个门户进程。
 *
 * 背景：2026-11 全量审查实测，向在跑的 8080 发 `GET http://[bad HTTP/1.1`，
 * portal/serve.mjs 的 `new URL(req.url, ...)` 抛异常且全文件无兜底，
 * 进程当场退出，随后 /health 连不上，所有在线客户一起掉线。
 *
 * 本用例自带服务生命周期（spawn 本仓库 portal/serve.mjs），不依赖外部已启动实例。
 * 只断言可观测行为：畸形请求后进程仍活、/health 仍 200、正常请求仍可用。
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

async function startPortal() {
  const inbox = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-resilience-'));
  const port = await freePort();
  const child = spawn(process.execPath, [SERVE], {
    cwd: ROOT,
    env: { ...process.env, PORTAL_PORT: String(port), PORTAL_INBOX: inbox },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base + '/health');
      if (res.ok) break;
    } catch {
      /* 还没起来，继续等 */
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return { child, port, inbox, base };
}

function stopPortal(ctx) {
  return new Promise((resolve) => {
    if (!ctx.child || ctx.child.exitCode !== null) {
      try { fs.rmSync(ctx.inbox, { recursive: true, force: true }); } catch { /* 忽略 */ }
      resolve();
      return;
    }
    ctx.child.once('exit', () => {
      try { fs.rmSync(ctx.inbox, { recursive: true, force: true }); } catch { /* 忽略 */ }
      resolve();
    });
    ctx.child.kill();
    setTimeout(() => {
      try { ctx.child.kill('SIGKILL'); } catch { /* 已退出 */ }
    }, 3000).unref();
  });
}

/** 往原始 socket 里写一段不是合法 HTTP 请求行的字节，然后读回对端反应。 */
function sendMalformed(port, payload) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    let closed = false;
    const done = (reason) => {
      if (closed) return;
      closed = true;
      try { sock.destroy(); } catch { /* 已断 */ }
      resolve(reason);
    };
    sock.on('connect', () => sock.write(payload));
    sock.on('data', () => done('responded'));
    sock.on('error', () => done('error'));
    sock.on('close', () => done('closed'));
    setTimeout(() => done('timeout'), 4000).unref();
  });
}

test('畸形请求目标打不死门户进程，/health 仍 200', async () => {
  const ctx = await startPortal();
  try {
    const before = await fetch(ctx.base + '/health');
    assert.equal(before.status, 200, '前置：实例应已就绪');

    // 非法 IPv6 字面量，new URL 必抛
    const outcome = await sendMalformed(ctx.port, 'GET http://[bad HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
    // 必须真的回一个响应，不能让客户端挂到超时：只靠进程级兜底等于连接泄漏
    assert.equal(outcome, 'responded', '畸形请求必须收到明确响应（400），不能只做到进程存活');
    await new Promise((r) => setTimeout(r, 300));

    assert.equal(ctx.child.exitCode, null, '畸形请求后进程必须仍存活，不得退出');

    const after = await fetch(ctx.base + '/health');
    assert.equal(after.status, 200, '畸形请求后 /health 必须仍 200');
    const payload = await after.json();
    assert.equal(payload.ok, true, '/health 必须仍报告 ok');
  } finally {
    await stopPortal(ctx);
  }
});

test('畸形请求后正常请求仍可用（不只是探活）', async () => {
  const ctx = await startPortal();
  try {
    await sendMalformed(ctx.port, 'GET http://[bad HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
    await sendMalformed(ctx.port, 'GET // HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
    await new Promise((r) => setTimeout(r, 300));

    const index = await fetch(ctx.base + '/');
    assert.equal(index.status, 200, '畸形请求后首页必须仍 200');
    const html = await index.text();
    assert.ok(html.includes('提交分析需求') || html.includes('<html'), '首页应返回真实 HTML');
  } finally {
    await stopPortal(ctx);
  }
});
