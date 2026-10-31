/**
 * 工作台口令（HTTP Basic）回归测试。
 *
 * 背景：18787 经 frp 暴露到公网，frp 从 127.0.0.1 回连，服务端无法按来源区分内外，
 * 只能整站鉴权。这条防线一旦被改坏，工作台就是公网免密可写（能下发服务器任务），
 * 所以单独用子进程按真实部署形态验一遍，而不是在模块单测里打桩。
 *
 * 口径：
 *   - 给了 BAD_AUTH_USER + BAD_AUTH_PASS 才强制鉴权；没给保持免密（本地开发/测试）。
 *   - /api/health 免鉴权，供守护与探活使用。
 *   - 其余一切（含静态页）无凭证或凭证错误一律 401。
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/**
 * 端口动态化（S26 顺带修，主 Agent 追加授权）：曾硬编码 PORT = 18788，与本机
 * 无关进程相撞（EADDRINUSE，2026-10-20 实测 PID 6104 占用）导致 7 条全 FAIL。
 * 照 portal_submit.test.js 的 freePort 先例取空闲端口，鉴权回归逻辑不变。
 */
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
const USER = 'admin';
const PASS = 'test-pass-123';

let child;
let childExit = null;

function basic(user, pass) {
  return 'Basic ' + Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
}

before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, BAD_PORT: String(PORT), BAD_AUTH_USER: USER, BAD_AUTH_PASS: PASS },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderrText = '';
  child.stderr.on('data', (chunk) => { stderrText += chunk.toString(); });
  child.on('exit', (code) => { childExit = { code, stderr: stderrText.slice(-2000) }; });

  const deadline = Date.now() + 10000;
  for (;;) {
    if (childExit) throw new Error(`服务进程提前退出 (code ${childExit.code}): ${childExit.stderr}`);
    try {
      const response = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // 没起来就继续等
    }
    if (Date.now() > deadline) throw new Error(`服务 10s 内没就绪: ${stderrText.slice(-2000)}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
});

after(() => {
  child?.kill();
});

async function api(path, headers = {}) {
  return fetch(`${BASE}${path}`, { headers, signal: AbortSignal.timeout(5000) });
}

test('health 免鉴权：守护与探活不能依赖口令', async () => {
  const response = await api('/api/health');
  assert.equal(response.status, 200);
});

test('无凭证访问业务接口被拒 401，并带 WWW-Authenticate', async () => {
  const response = await api('/api/projects/list');
  assert.equal(response.status, 401);
  assert.match(response.headers.get('www-authenticate') || '', /^Basic realm=/);
});

test('口令错误被拒 401', async () => {
  const response = await api('/api/projects/list', { Authorization: basic(USER, 'wrong-pass') });
  assert.equal(response.status, 401);
});

test('用户名错误被拒 401', async () => {
  const response = await api('/api/projects/list', { Authorization: basic('root', PASS) });
  assert.equal(response.status, 401);
});

test('格式非法的 Authorization 头被拒 401（不崩）', async () => {
  const response = await api('/api/projects/list', { Authorization: 'Basic !!!not-base64' });
  assert.equal(response.status, 401);
  const noColon = await api('/api/projects/list', {
    Authorization: 'Basic ' + Buffer.from('nocolon', 'utf8').toString('base64'),
  });
  assert.equal(noColon.status, 401);
});

test('正确凭证放行 200', async () => {
  const response = await api('/api/projects/list', { Authorization: basic(USER, PASS) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.projects));
});

test('静态页同样受口令保护（不能靠改路径绕过）', async () => {
  const response = await api('/');
  assert.equal(response.status, 401);
});

/**
 * D-29 Fail-Closed 负路径（v3.3 审查返工）：
 * 剥离测试豁免（BIO_TEST_FORCE_FAIL_CLOSED=1 压过 NODE_TEST_CONTEXT），
 * 无 BAD_AUTH_* 时必须自动生成随机凭证并强制 401；凭据经 BIO_AUTH_RUNTIME_FILE
 * 回读验证，杜绝"生成了密码但 isAuthorized 恒放行"的假修复。
 */
test('Fail-Closed：无凭证配置时自动生成随机凭证并强制 401/200', async () => {
  const port2 = await freePort();
  const runtimeFile = path.join(os.tmpdir(), `auth-runtime-${port2}.json`);
  const child2 = spawn(process.execPath, ['server/index.js'], {
    env: {
      ...process.env,
      BAD_PORT: String(port2),
      BAD_AUTH_USER: '',
      BAD_AUTH_PASS: '',
      NODE_TEST_CONTEXT: '', // 显式压过测试豁免
      BIO_TEST_FORCE_FAIL_CLOSED: '1',
      BIO_AUTH_RUNTIME_FILE: runtimeFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr2 = '';
  child2.stderr.on('data', (c) => { stderr2 += c.toString(); });
  child2.on('exit', (code) => { if (code !== 0 && code !== null) stderr2 += `\nexit=${code}`; });
  try {
    const base2 = `http://127.0.0.1:${port2}`;
    const deadline2 = Date.now() + 10000;
    for (;;) {
      try {
        const r = await fetch(`${base2}/api/health`, { signal: AbortSignal.timeout(1000) });
        if (r.ok) break;
      } catch { /* 等启动 */ }
      if (Date.now() > deadline2) throw new Error(`Fail-Closed 服务 10s 未就绪: ${stderr2.slice(-500)}`);
      await new Promise((r) => setTimeout(r, 200));
    }

    // 1) 无凭证 → 401（若此处放行，说明 AUTH_ENABLED 未置 true 的假修复复发）
    const noAuth = await fetch(`${base2}/api/projects/list`, { signal: AbortSignal.timeout(5000) });
    assert.equal(noAuth.status, 401, 'Fail-Closed 下无凭证必须 401');

    // 2) 运行时文件回读凭证 → 200
    const runtime = JSON.parse(fs.readFileSync(runtimeFile, 'utf8'));
    assert.ok(runtime.user && runtime.pass, 'BIO_AUTH_RUNTIME_FILE 必须写出生成凭证');
    const withAuth = await fetch(`${base2}/api/projects/list`, {
      headers: { Authorization: basic(runtime.user, runtime.pass) },
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(withAuth.status, 200, '自动生成的凭证必须放行');
  } finally {
    child2.kill();
    fs.rmSync(runtimeFile, { force: true });
  }
});
