/**
 * 缺设备 Mock 模式透出（Ticket 1，4 Argon 第二十二轮 Q5【计划做】）。
 *
 * 最小切块契约：
 *   后端 compute_mode() 只读、不抛错，'mock'/'ssh' 二选一；
 *   /api/selfcheck 显式返回 compute_mode 与 mock_mode；
 *   前端 App.tsx 据此渲染顶部横幅，且横幅文案必须说清「演示数据不代表真机」。
 * 不 mock 真机：这些判据全是纯函数与静态结构，天然离线可断言。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { computeMode } from '../server/proc.js';

const BIOANALYS_DIR = path.resolve(import.meta.dirname, '..');
const REPO = path.resolve(BIOANALYS_DIR, '..');
const APP = path.join(BIOANALYS_DIR, 'src', 'App.tsx');
const CSS = path.join(BIOANALYS_DIR, 'src', 'app.css');
const DIAG = path.join(BIOANALYS_DIR, 'server', 'routes', 'diagnostics.routes.js');

test('computeMode：默认 ssh，明确 mock 才是 mock，非法值不抛错按 ssh 处理', () => {
  const saved = process.env.BIO_COMPUTE_ADAPTER;
  try {
    delete process.env.BIO_COMPUTE_ADAPTER;
    assert.equal(computeMode(), 'ssh', '未设置时默认真机');
    process.env.BIO_COMPUTE_ADAPTER = 'mock';
    assert.equal(computeMode(), 'mock');
    process.env.BIO_COMPUTE_ADAPTER = 'ssh';
    assert.equal(computeMode(), 'ssh');
    // 只读透出：非法值不在这里抛（真正执行时由 resolveComputeAdapter fail-closed）
    process.env.BIO_COMPUTE_ADAPTER = 'bogus';
    assert.equal(computeMode(), 'ssh', '非法值按真机保守处理，且不抛错');
  } finally {
    if (saved === undefined) delete process.env.BIO_COMPUTE_ADAPTER;
    else process.env.BIO_COMPUTE_ADAPTER = saved;
  }
});

test('自检路由透出 compute_mode 与 mock_mode（两个字段同源，不得分裂）', () => {
  const src = fs.readFileSync(DIAG, 'utf8');
  assert.ok(src.includes("../proc.js"), '路由必须从 proc.js 取模式真源');
  // 单行 import { computeMode } 与多行 import 都要认（首版只认逗号形态，误报）
  assert.ok(src.includes('import { computeMode } from'), '必须 import computeMode（单行形态）');
  assert.ok(src.includes('compute_mode: computeModeValue'), '响应必须带 compute_mode');
  assert.ok(src.includes('mock_mode: computeModeValue === ') || src.includes("mock_mode: computeModeValue === 'mock'"),
    '响应必须带 mock_mode 布尔位');
  // 同源：只算一次，两个字段都由它派生（防两个字段各算一遍后漂移）
  assert.equal((src.match(/const computeModeValue = computeMode\(\)/g) || []).length, 1);
});

test('前端横幅：只在 mock 时渲染，且文案写明演示数据不代表真机', () => {
  const app = fs.readFileSync(APP, 'utf8');
  assert.ok(app.includes("setComputeMode(payload.compute_mode === 'mock' ? 'mock' : 'ssh')"),
    '必须按后端字段决定状态');
  assert.ok(app.includes("{computeMode === 'mock' && ("), '横幅必须只在 mock 时出现');
  assert.ok(app.includes('role="status"'), '横幅应是 status 角色（可被读屏念出）');
  assert.ok(app.includes('离线演示模式'), '必须点名模式');
  assert.ok(app.includes('不代表真机运行'), '必须写明「不代表真机」（这是横幅存在的全部理由）');
  // 不得阻塞交互：横幅只渲染文案，不含 disabled 或遮罩
  const banner = app.slice(app.indexOf("computeMode === 'mock'"), app.indexOf('</div>', app.indexOf("computeMode === 'mock'")));
  assert.equal(/disabled|position:\s*fixed|onClick/.test(banner), false, '横幅不得阻塞或接管交互');
});

test('横幅样式存在且不遮挡内容（左侧色条 + 柔和底色）', () => {
  const css = fs.readFileSync(CSS, 'utf8');
  assert.ok(css.includes('.mock-banner'), '缺 .mock-banner 样式');
  const block = css.slice(css.indexOf('.mock-banner'), css.indexOf('.mock-banner strong'));
  assert.ok(block.includes('border-left'), '要有左侧色条做视觉锚点');
  assert.equal(/position:\s*fixed|z-index:\s*9/.test(block), false, '不得用浮层遮挡页面');
});

test('模式读取失败静默降级：catch 分支不得抛错或变成新错误源', () => {
  const app = fs.readFileSync(APP, 'utf8');
  const start = app.indexOf('const loadMode = async () => {');
  const end = app.indexOf('void loadMode();');
  assert.ok(start > 0 && end > start, '找不到模式读取函数');
  const body = app.slice(start, end);
  assert.ok(body.includes('if (!response.ok) return;'), '非 200 要静默返回');
  assert.ok(body.includes('} catch {'), '必须有 catch');
  assert.equal(/setProjectError|catch \(cause\)/.test(body), false, '失败不得写进全局错误状态');
});

test('真机态默认不骚扰：compute_mode 缺失或为 ssh 时都不显示', () => {
  const app = fs.readFileSync(APP, 'utf8');
  assert.ok(app.includes("useState<'ssh' | 'mock'>('ssh')"), '初始态必须是 ssh（不惊吓用户）');
  assert.ok(app.includes("payload.compute_mode === 'mock' ? 'mock' : 'ssh'"),
    '只有明确 mock 才切到 mock，其余一律 ssh');
});
