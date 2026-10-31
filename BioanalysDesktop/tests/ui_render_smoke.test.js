/**
 * 桌面 UI 渲染冒烟测试（P3-02 收口项）。
 *
 * 补的既有缺口：拆分前桌面 UI 一条渲染级测试都没有，视图搬动只能靠 DOM 指纹静态比对，
 * 「模块加载期就崩」这类问题（例如暂时性死区、循环 import、少一个 export）
 * 只有真渲染才拦得住。
 *
 * 为什么用 esbuild + renderToStaticMarkup：宿主没有 jsdom，而 node:test 也直吃不了 .tsx。
 * esbuild 把视图打成一个 ESM 产物再由本测试 import，走 react-dom/server 静态渲染。
 * SSR 不跑 useEffect，所以首轮渲染不会真的发 fetch，正好只考察「首次渲染是否安全」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT_DIR = path.join(ROOT, '.tmp', 'render-smoke');
const ENTRY = path.join(OUT_DIR, 'entry.mjs');
const BUNDLE = path.join(OUT_DIR, 'bundle.mjs');

const ENTRY_SOURCE = [
  "import { createElement } from 'react';",
  "import { renderToStaticMarkup } from 'react-dom/server';",
  "import { App } from '../../src/App';",
  "import { OnboardingPortal, CustomerInputConsole } from '../../src/views/OnboardingView';",
  "import { PreFlightDashboard } from '../../src/views/SelfCheckAdminView';",
  "import { ResultPreviewStudio, FilesPanel } from '../../src/views/ResultStudioView';",
  '',
  'export function renderAll() {',
  '  const noop = () => Promise.resolve();',
  '  const cases = [',
  "    ['App', createElement(App)],",
  "    ['OnboardingPortal', createElement(OnboardingPortal, { onCreated: noop, onProjectSet: noop })],",
  "    ['CustomerInputConsole', createElement(CustomerInputConsole, { project: 'proj_smoke' })],",
  "    ['PreFlightDashboard', createElement(PreFlightDashboard)],",
  "    ['ResultPreviewStudio', createElement(ResultPreviewStudio, { project: 'proj_smoke' })],",
  "    ['FilesPanel', createElement(FilesPanel, { project: 'proj_smoke' })],",
  '  ];',
  '  return cases.map(([name, el]) => ({ name, html: renderToStaticMarkup(el) }));',
  '}',
  '',
].join('\n');

let rendered = null;
let buildError = null;

async function ensureBundle() {
  if (rendered) return rendered;
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(ENTRY, ENTRY_SOURCE, 'utf8');
    await build({
      entryPoints: [ENTRY],
      outfile: BUNDLE,
      bundle: true,
      platform: 'node',
      format: 'esm',
      jsx: 'automatic',
      // App.tsx 里 import './app.css'，打包时样式整体丢弃，冒烟只关心组件能否成型
      loader: { '.css': 'empty' },
      // react-dom/server 是 CJS，打成 ESM 后里面的 require('stream') 会变成
      // "Dynamic require of stream is not supported"。补一个 ESM 下的 require 是 esbuild 的既定解法。
      banner: {
        js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
      },
      logLevel: 'silent',
    });
    const mod = await import(pathToFileURL(BUNDLE).href);
    rendered = mod.renderAll();
  } catch (error) {
    buildError = error;
  }
  return rendered;
}

test('视图打包与首轮静态渲染不抛错', async () => {
  const rows = await ensureBundle();
  assert.equal(buildError, null, `渲染冒烟打包/渲染失败：${buildError?.message}`);
  assert.ok(Array.isArray(rows), 'renderAll 必须返回数组');
  assert.equal(rows.length, 6, `应覆盖 6 个视图，实际 ${rows.length}`);
  for (const row of rows) {
    assert.ok(row.html.length > 200, `${row.name} 渲染产物过短（${row.html.length} 字符），疑似渲染成空壳`);
  }
});

test('外壳渲染出四条视图导航与真实文案', async () => {
  const rows = await ensureBundle();
  const app = rows.find((r) => r.name === 'App');
  for (const label of ['新建项目向导', '分析输入控制台', '五维自检', '结果预览 Studio']) {
    assert.ok(app.html.includes(label), `App 外壳缺导航文案：${label}`);
  }
});

test('向导页渲染出随视图搬走的 WGCNA 参数区', async () => {
  const rows = await ensureBundle();
  const portal = rows.find((r) => r.name === 'OnboardingPortal');
  // 期望值取自实跑渲染产物，不是猜的：首屏只渲染基本信息模块，
  // 数据来源双模态 chip 在后续步骤里，首轮静态渲染里并没有它，故不在此断言。
  assert.ok(portal.html.includes('Top N 高变基因'),
    'WGCNA 参数区要出现（其数据源 WGCNA_PARAM_FIELDS 是随本视图搬走的模块级常量）');
  for (const cls of ['module-card', 'module-title', 'form-grid-2', 'chip chip-active']) {
    assert.ok(portal.html.includes(cls), `向导页缺少 CSS 类：${cls}`);
  }
});

test('各视图渲染出各自的真实骨架类名，防止搬成空壳或搬错模块', async () => {
  const rows = await ensureBundle();
  const expect = {
    App: ['app-root', 'app-header', 'tab-nav', 'tab-nav-item tab-nav-item-active'],
    OnboardingPortal: ['view-container', 'module-card', 'module-title'],
    CustomerInputConsole: ['view-container', 'sub-tab-row', 'sub-tab sub-tab-active'],
    PreFlightDashboard: ['view-container', 'card', 'card-head'],
    ResultPreviewStudio: ['view-container', 'card', 'badge badge-unknown'],
    FilesPanel: ['card', 'chip-row', 'chip chip-active'],
  };
  for (const [name, markers] of Object.entries(expect)) {
    const row = rows.find((r) => r.name === name);
    for (const marker of markers) {
      assert.ok(row.html.includes(marker), `${name} 首轮渲染缺类名：${marker}`);
    }
  }
});

test('六个视图各自都渲染出实际结构，不是空壳', async () => {
  const rows = await ensureBundle();
  const names = rows.map((r) => r.name);
  for (const want of ['App', 'OnboardingPortal', 'CustomerInputConsole', 'PreFlightDashboard',
    'ResultPreviewStudio', 'FilesPanel']) {
    assert.ok(names.includes(want), `未渲染 ${want}`);
  }
  for (const row of rows) {
    assert.ok(row.html.includes('class='), `${row.name} 渲染结果里没有任何 CSS 类名`);
  }
});
