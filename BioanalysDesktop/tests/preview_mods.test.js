/**
 * 回归守卫：M4 按 mod 分组的产物预览（GET /api/preview/mods）。
 *
 * 背景（2026-10-23 mod 化改造 M4）：原来的 /api/figures/list 把 figures/ 全量倒出，
 * 客户会看到没勾选的分析产物。新端点按客户勾选的 mod 分组，且能区分
 * "该 mod 没跑"（missing）与"文件丢失"——这是交付体验的关键差别。
 *
 * 远端依赖：需要 k40-ubuntu 可达（default 项目在远端数据面）。
 * 链路不通时 skip，不 fail（与 link.test.js 的环境类失败区分开）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../server/index.js', import.meta.url));
const FIGURES_ROUTES = fileURLToPath(new URL('../server/routes/figures.routes.js', import.meta.url));
// processed 列目录辅助搬进 remote_exec.js，守卫扫并集，断言口径不动。
const REMOTE_EXEC = fileURLToPath(new URL('../server/remote_exec.js', import.meta.url));

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

async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, BAD_PORT: String(port) },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(800) });
      if (r.ok) return { child, base };
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  child.kill();
  throw new Error('工作台测试实例启动失败');
}

/**
 * 远端是否真可达。
 *
 * 不能只看 HTTP 200：沙箱内 ssh 出不去时，listRemoteProcessed 返回空集，
 * 端点照样回 200 但所有产物判 missing。所以这里必须真的探一次 ssh，
 * 不可达就 skip（环境类，与 link.test.js 的 5 条同类）。
 */
async function remoteReachable() {
  try {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync('ssh', [
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40-ubuntu', 'echo PROBE_OK',
    ], { encoding: 'utf8', timeout: 20000 });
    return r.status === 0 && /PROBE_OK/.test(r.stdout || '');
  } catch {
    return false;
  }
}

test('按 mod 分组：只返回勾选的 mod，未勾选的不出现', async (t) => {
  const { child, base } = await startServer();
  t.after(() => child.kill());
  if (!(await remoteReachable())) { t.skip('远端 k40-ubuntu 不可达'); return; }

  const picked = 'l2_ingest_counts,l2_qc_cells';
  const body = await (await fetch(`${base}/api/preview/mods?project=default&line=line2_scrna&modIds=${picked}`, {
    signal: AbortSignal.timeout(30000),
  })).json();

  assert.equal(body.mod_count, 2, '只应返回勾选的 2 个 mod');
  const ids = body.groups.map((g) => g.mod_id);
  assert.deepEqual(ids.sort(), ['l2_ingest_counts', 'l2_qc_cells']);
  // 没勾的必须不出现（客户不该看到没买的分析）
  assert.ok(!ids.includes('l2_tf_scenic'));
});

test('每个 mod 带产物清单与完整性状态', async (t) => {
  const { child, base } = await startServer();
  t.after(() => child.kill());
  if (!(await remoteReachable())) { t.skip('远端 k40-ubuntu 不可达'); return; }

  const body = await (await fetch(`${base}/api/preview/mods?project=default&line=line2_scrna&modIds=l2_ingest_counts,l2_tf_scenic`, {
    signal: AbortSignal.timeout(30000),
  })).json();

  for (const g of body.groups) {
    assert.ok(g.mod_id && g.name, 'mod 基本信息必须全');
    assert.ok(Array.isArray(g.products) && g.products.length > 0, `${g.mod_id} 应有产物清单`);
    assert.ok(['complete', 'partial', 'missing', 'unknown'].includes(g.status),
      `${g.mod_id} 状态取值非法: ${g.status}`);
    // present_count 必须与 products 里 present=true 的条数一致（不许口径不一）
    const actual = g.products.filter((p) => p.present).length;
    assert.equal(g.present_count, actual, `${g.mod_id} 的 present_count 与清单不符`);
    assert.equal(g.total_count, g.products.length);
  }
});

test('missing 与 complete 要能区分（不是所有缺失都叫文件丢失）', async (t) => {
  const { child, base } = await startServer();
  t.after(() => child.kill());
  if (!(await remoteReachable())) { t.skip('远端 k40-ubuntu 不可达'); return; }

  const project = `preview_mods_test_${process.pid}`;
  const remoteDir = `/mnt/ssd/bio_data/projects/${project}/line3_spatial`;
  const setup = spawnSync('ssh', [
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40-ubuntu',
    `mkdir -p ${remoteDir}/processed && touch ${remoteDir}/processed/spatial_counts_mouse.h5ad ${remoteDir}/processed/spatial_counts_human.h5ad ${remoteDir}/processed/samples_meta.tsv ${remoteDir}/processed/ingest_report.txt`,
  ], { encoding: 'utf8', timeout: 20000 });
  assert.equal(setup.status, 0, setup.stderr);
  t.after(() => {
    spawnSync('ssh', [
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40-ubuntu',
      `rm -rf /mnt/ssd/bio_data/projects/${project}`,
    ], { encoding: 'utf8', timeout: 20000 });
  });

  const body = await (await fetch(`${base}/api/preview/mods?project=${project}&line=line3_spatial&modIds=l3_ingest_spatial,l3_figures_spatial`, {
    signal: AbortSignal.timeout(30000),
  })).json();
  const byId = Object.fromEntries(body.groups.map((g) => [g.mod_id, g]));
  assert.equal(byId.l3_ingest_spatial.status, 'complete', 'ingest 产物应齐全');
  assert.equal(byId.l3_figures_spatial.status, 'missing', '未跑的图件步骤应判 missing');
});

test('未知系列 404，非法 project 400', async (t) => {
  const { child, base } = await startServer();
  t.after(() => child.kill());
  if (!(await remoteReachable())) { t.skip('远端 k40-ubuntu 不可达'); return; }

  const bad = await fetch(`${base}/api/preview/mods?project=default&line=no_such_line`, {
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(bad.status, 404);
  const badProj = await fetch(`${base}/api/preview/mods?project=..%2Fetc&line=line2_scrna`, {
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(badProj.status, 400);
});

test('静态守卫：端点必须基于勾选的 modIds 过滤，不透出 requires/produces 内部结构', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = [
    await readFile(SERVER, 'utf8'),
    await readFile(FIGURES_ROUTES, 'utf8'),
    await readFile(REMOTE_EXEC, 'utf8'),
  ].join('\n');
  assert.match(src, /url\.pathname === '\/api\/preview\/mods'/, '必须存在 /api/preview/mods 路由');
  assert.match(src, /const picked = modIds\.length/, '必须按 modIds 过滤');
  assert.match(src, /function listRemoteProcessed\(/, '必须有 processed 列目录辅助');
  // 列目录必须单层不递归：容器内递归会触发 P-23 的 proot abort
  assert.match(src, /ls -1 \$\{dir\} 2>\/dev\/null \|\| true/,
    'processed 列目录必须单层 ls，不得递归');
  assert.ok(!/find .*processed/.test(src), '不得对 processed 用 find（P-23）');
});

