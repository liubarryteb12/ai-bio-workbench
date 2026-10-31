/**
 * index.js 本体冒烟测试（子进程方式）
 *
 * 背景：T06 曾把审计前置到 /api/tasks/submit，但漏了 import buildTaskScript，
 * 结果跨线请求进来服务直接 ReferenceError 崩掉。模块单测各测各的，拦不住这类
 * "入口文件自身" 的错误，所以这里把真实入口当子进程拉起来打 HTTP 兜底。
 *
 * 用子进程而不是 in-process import：handler 抛异常时的行为（崩不崩、挂不挂）
 * 必须按真实部署形态观测，in-process 会被 node:test 的兜底 handler 掩盖。
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';

import { resolveLineFromDataType, normalizeDatasets } from '../server/domain.js';

/**
 * 端口动态化（回归 2026-10-20）：曾硬编码 PORT = 18787，与本机无关进程相撞
 * （EADDRINUSE）导致 8 条测试全 FAIL。照 portal_submit.test.js 的 freePort 先例，
 * 先取空闲端口再起服务。18787 是否被占与本套测试再无关系。
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

let child;
/** 子进程退出记录：null 表示还活着。崩没崩是核心回归点，不能抛在事件回调里 */
let childExit = null;

before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, BAD_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderrText = '';
  child.stderr.on('data', (chunk) => { stderrText += chunk.toString(); });
  child.on('exit', (code) => { childExit = { code, stderr: stderrText.slice(-2000) }; });

  // 等 health 就绪，最多 10s
  const deadline = Date.now() + 25000;
  for (;;) {
    if (childExit) throw new Error(`服务进程提前退出 (code ${childExit.code}): ${childExit.stderr}`);
    try {
      const response = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // 没起来就继续等
    }
    if (Date.now() > deadline) throw new Error(`服务 25s 内没就绪: ${stderrText.slice(-2000)}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
});

after(() => {
  child?.kill();
});

/** 带超时的 fetch，避免服务挂起时测试无限等 */
async function api(path, options = {}) {
  return fetch(`${BASE}${path}`, { ...options, signal: AbortSignal.timeout(5000) });
}

test('health 接口通', async () => {
  const response = await api('/api/health');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
});

test('跨线任务提交：接口返回 400 且服务不崩', async () => {
  const response = await api('/api/tasks/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lineId: 'line1_bulk',
      step: 'deg',
      // 跨线越界的真实形态：inputs 里引用别线路径，脚本拼出来审计能抓到
      inputs: ['/mnt/ssd/bio_data/line2_scrna/results/ref.tsv'],
      outputs: [],
      seed: 42,
    }),
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /跨线/);

  // 关键回归：服务还活着，且任务表里不留下任何痕迹
  assert.equal(childExit, null, `服务被跨线请求打崩了: ${childExit?.stderr}`);
  const health = await api('/api/health');
  assert.equal(health.status, 200);
  const tasks = await (await api('/api/tasks')).json();
  assert.equal(tasks.tasks.length, 0);
});

test('submit 参数缺失：lineId 非法返回 400 而不是崩', async () => {
  const response = await api('/api/tasks/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step: 'x' }),
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /lineId/);
});

// 回归 2026-10-13 崩溃事故：step 名含空格 -> 台账文件名带空格 ->
// 落盘命令重定向被拆断 -> persistEntry rejection 被 void 丢弃 -> 服务被杀。
// 现在提交接口提前拒绝，服务必须活着。
test('step 含空格：提交即 400 拒绝且服务不崩', async () => {
  const response = await api('/api/tasks/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lineId: 'line1_bulk',
      step: 'echo data_plane_ok',
      inputs: [],
      outputs: [],
      seed: 42,
    }),
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /step/);

  assert.equal(childExit, null, `服务被含空格 step 打崩了: ${childExit?.stderr}`);
  const health = await api('/api/health');
  assert.equal(health.status, 200);
  const tasks = await (await api('/api/tasks')).json();
  assert.equal(tasks.tasks.length, 0);
});

// 客户需求收件箱（portal/inbox）：只读本地目录，替代"手工抄 JSON"。
test('收件箱列表接口：200 且返回 items 数组（摘要含 dataType / suggestedLine / datasets）', async () => {
  const response = await api('/api/portal/inbox');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.blocked, false);
  assert.ok(Array.isArray(body.items));
  for (const item of body.items) {
    if (!item.summary) continue;
    assert.equal(typeof item.summary.dataType, 'string', '摘要须带 dataType 字段');
    assert.equal(typeof item.summary.suggestedLine, 'string', '摘要须带 suggestedLine 字段');
    assert.ok(Array.isArray(item.summary.datasets), '摘要须带 datasets 配对表');
    assert.equal(typeof item.summary.datasetsInferred, 'boolean', '摘要须带 datasetsInferred 标记');
    for (const d of item.summary.datasets) {
      assert.equal(typeof d.gse, 'string');
      assert.equal(typeof d.gpl, 'string');
      assert.ok(d.role === 'train' || d.role === 'validation', `role 非法: ${d.role}`);
      // 行级三元组：未填时归一化为空串 / 0，不能是 undefined
      assert.equal(typeof d.dataType, 'string', '每行须带 dataType');
      assert.equal(typeof d.sampleCount, 'number', '每行须带 sampleCount');
      assert.equal(typeof d.tissue, 'string', '每行须带 tissue');
    }
  }
});

test('收件箱单文件接口：合法文件名能读到 manifest，且返回 dataType / suggestedLine / datasets', async () => {
  // 先用列表拿一个真实存在的文件名，避免测试依赖写死的样例
  const listing = await (await api('/api/portal/inbox')).json();
  if (listing.items.length === 0) return; // 收件箱可能为空，空则跳过
  const name = listing.items[0].file;
  const response = await api(`/api/portal/inbox/item?name=${encodeURIComponent(name)}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.file, name);
  assert.ok(body.manifest && typeof body.manifest === 'object');
  // 返回值必须与 domain.js 的判定一致：填了 dataType 就给出对应线，没填就是空串
  const dt = body.manifest?.dataSource?.dataType || '';
  assert.equal(body.dataType, dt);
  assert.equal(body.suggestedLine, resolveLineFromDataType(dt));
  // 配对表与 domain.js 的归一化结果一致（新格式透传 / 旧格式按位置推断）
  assert.deepEqual(body.datasets, normalizeDatasets(body.manifest?.dataSource).datasets);
  assert.equal(body.datasetsInferred, normalizeDatasets(body.manifest?.dataSource).inferred);
});

// 安全回归：文件名不得越界。穿越字符与非 .json 一律 400，不落盘、不读盘。
test('收件箱单文件接口：穿越与非 json 文件名一律 400', async () => {
  for (const bad of ['../serve.mjs', '..\\serve.mjs', 'serve.mjs', 'sub/dir.json', '']) {
    const response = await api(`/api/portal/inbox/item?name=${encodeURIComponent(bad)}`);
    assert.equal(response.status, 400, `应拒绝文件名: ${bad}`);
  }
  assert.equal(childExit, null, `服务被越界文件名打崩了: ${childExit?.stderr}`);
});

test('收件箱单文件接口：文件不存在返回 404', async () => {
  const response = await api('/api/portal/inbox/item?name=__not_exist__.json');
  assert.equal(response.status, 404);
});
