/**
 * 回归守卫：工作流 API 的三个公开端点与路由匹配顺序。
 *
 * 路由坑：/api/workflows/resolve 曾被 /api/workflows/:seriesId 的前缀匹配吞掉。
 * 本文件同时从 HTTP 行为和源码分支顺序两侧钉住该回归。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import net from 'node:net';

// 端口改为测试自有：自己起服务，避免连到外部早已启动的旧版本服务而假绿
// （2026-10-23 实测踩坑：HTTP 用例连外部服务时，即使刚改坏的代码也能全绿）。
let activeBaseUrl = '';
let lastSpawnStderr = '';

const L2_MIN = [
  'l2_ingest_counts', 'l2_qc_cells', 'l2_qc_normalize',
  'l2_integrate_harmony', 'l2_integrate_cluster', 'l2_integrate_annotate',
  'l2_profile_composition', 'l2_profile_deg',
];

/** 起一个属于本次测试的服务实例，返回 spawn 句柄；失败返回 null（此时用例 skip）。 */
async function findFreePort() {
  if (process.env.WORKFLOW_API_PORT) return Number(process.env.WORKFLOW_API_PORT);
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function spawnServer(port) {
  const { spawn } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const entry = fileURLToPath(new URL('../server/index.js', import.meta.url));
  activeBaseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, BAD_PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderrText = '';
  child.stderr.on('data', (chunk) => { stderrText += chunk.toString(); });
  // 启动预算 30s：本仓库的测试常与远端设备操作并发跑（8GB 机器上还要起 ssh/scp）。
  // 10s 预算在并发负载下会假红（实测出现 10.1s 超时、单跑 0 失败的抖动）。
  // 放宽的是「等服务起来」的等待，不是断言标准：起不来仍然 fail 而不是 skip。
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return null;
    try {
      const r = await fetch(`${activeBaseUrl}/api/health`, { signal: AbortSignal.timeout(800) });
      if (r.ok) return child;
    } catch { /* 还没起来，继续等 */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill();
  lastSpawnStderr = stderrText;
  return null;
}

async function jsonRequest(path, { method = 'GET', body } = {}) {
  const options = {
    method,
    headers: {},
    // 5s 在并发负载下同样会假红；/api/workflows 要汇总注册表健康，留 20s。
    signal: AbortSignal.timeout(20000),
  };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${activeBaseUrl}${path}`, options);
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    assert.fail(`${method} ${path} 返回了非 JSON 响应（HTTP ${response.status}）：${text.slice(0, 500)}`);
  }
  return { status: response.status, body: parsed };
}

function networkTest(name, fn) {
  test(name, async (t) => {
    const port = await findFreePort();
    const child = await spawnServer(port);
    if (!child) {
      // 08 号书第 7 项：启动失败转 skip 等于把「服务起不来」伪装成「本机不跑这条用例」，
      // 超时回退到 30s 后必须让启动失败直接变红，并带上子进程 stderr 便于定位。
      assert.fail(`无法在 30s 内启动本地服务 ${activeBaseUrl}；stderr=${lastSpawnStderr.slice(-800) || '（空）'}`);
    }
    t.after(() => { child.kill(); });
    await fn(t);
  });
}

test('静态路由顺序：resolve 精确匹配必须先于 workflows 前缀匹配', async () => {
  // workflows 路由搬进 routes/projects.routes.js 后，守卫扫「入口 + 归属模块」并集；
  // 相对先后关系在并集里仍成立（两段分支同在一个文件里，顺序未变）。
  const source = [
    await readFile(new URL('../server/index.js', import.meta.url), 'utf8'),
    await readFile(new URL('../server/routes/projects.routes.js', import.meta.url), 'utf8'),
  ].join('\n');
  const exactResolveAt = source.search(
    /url\.pathname\s*===\s*['"]\/api\/workflows\/resolve['"]/,
  );
  const prefixRouteAt = source.search(
    /url\.pathname\.startsWith\(\s*['"]\/api\/workflows\/['"]\s*\)/,
  );

  assert.notEqual(exactResolveAt, -1, '未找到 /api/workflows/resolve 的精确匹配分支');
  assert.notEqual(prefixRouteAt, -1, '未找到 /api/workflows/ 的前缀匹配分支');
  assert.ok(
    exactResolveAt < prefixRouteAt,
    '/api/workflows/resolve 的精确匹配分支必须位于 startsWith(\'/api/workflows/\') 之前',
  );
});

networkTest('a) GET /api/workflows 返回三个系列、注册表健康与内存约束', async () => {
  const { status, body } = await jsonRequest('/api/workflows');

  assert.equal(status, 200);
  assert.equal(body.series.length, 3);
  assert.equal(body.registry_ok, true);
  assert.equal(typeof body.constraints.mem_quota_mb, 'number');
  assert.ok(body.constraints.mem_quota_mb > 0);
});

networkTest('b) POST /api/workflows/resolve 接受 line2 最小合法组合', async () => {
  const { status, body } = await jsonRequest('/api/workflows/resolve', {
    method: 'POST',
    body: { seriesId: 'line2_scrna', modIds: L2_MIN },
  });

  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.ordered), '响应必须含 ordered 数组');
  assert.equal(body.ordered.length, 8);
  assert.equal(body.ordered[0], 'l2_ingest_counts');
  assert.ok(body.estMinutes > 0);
});

networkTest('c) 跨线选择 l3_ko_spatial 返回 422 并点名 line3_spatial', async () => {
  const { status, body } = await jsonRequest('/api/workflows/resolve', {
    method: 'POST',
    body: {
      seriesId: 'line2_scrna',
      modIds: [...L2_MIN, 'l3_ko_spatial'],
    },
  });

  assert.equal(status, 422);
  assert.equal(body.ok, false);
  assert.ok(body.errors.some((error) => error.includes('line3_spatial')));
});

networkTest('d) 只传 l2_profile_deg 返回 422 并报告必经阶段缺失', async () => {
  const { status, body } = await jsonRequest('/api/workflows/resolve', {
    method: 'POST',
    body: { seriesId: 'line2_scrna', modIds: ['l2_profile_deg'] },
  });

  assert.equal(status, 422);
  assert.equal(body.ok, false);
  assert.ok(body.errors.some((error) => error.includes('必经阶段')));
});

networkTest('e) 虚拟敲除缺 koGene 返回 422，补 TNF 后返回 200', async () => {
  const modIds = [...L2_MIN, 'l2_ko_virtual'];
  const missingGene = await jsonRequest('/api/workflows/resolve', {
    method: 'POST',
    body: { seriesId: 'line2_scrna', modIds },
  });

  assert.equal(missingGene.status, 422);
  assert.equal(missingGene.body.ok, false);
  assert.ok(missingGene.body.errors.some((error) => error.includes('靶基因')));

  const withGene = await jsonRequest('/api/workflows/resolve', {
    method: 'POST',
    body: { seriesId: 'line2_scrna', modIds, koGene: 'TNF' },
  });

  assert.equal(withGene.status, 200);
  assert.equal(withGene.body.ok, true);
});

networkTest('f) GET /api/workflows/line2_scrna 返回八个阶段', async () => {
  const { status, body } = await jsonRequest('/api/workflows/line2_scrna');

  assert.equal(status, 200);
  assert.equal(body.id, 'line2_scrna');
  assert.equal(body.stages.length, 8);
});

networkTest('g) GET /api/workflows/not_a_series 返回 404', async () => {
  const { status } = await jsonRequest('/api/workflows/not_a_series');
  assert.equal(status, 404);
});

networkTest('h) POST /api/workflows/resolve 缺 seriesId 返回 400', async () => {
  const { status } = await jsonRequest('/api/workflows/resolve', {
    method: 'POST',
    body: { modIds: L2_MIN },
  });
  assert.equal(status, 400);
});

networkTest('路由坑：GET /api/workflows/resolve 不得返回 200 系列详情', async () => {
  const { status, body } = await jsonRequest('/api/workflows/resolve');

  assert.notEqual(status, 200, 'GET /resolve 不能被前缀路由当成合法系列查询');
  assert.ok(!Array.isArray(body?.stages), 'GET /resolve 不应返回系列 stages');
});
