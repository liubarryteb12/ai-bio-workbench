/**
 * T3-1 第一刀：OnboardingDisplayParts 三个纯展示受控子组件的契约测试。
 *
 * 判据（约定 seam）：给定 props，react-dom/server 静态渲染产物必须带对应结构类名与文案。
 * 组件只接 props、不读写 state；改坏渲染分支（或 props 传错）本测试必须红。
 *
 * 走 ui_render_smoke.test.js 的 esbuild + renderToStaticMarkup 既有设施，零新依赖。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const COMPONENT = path.join(ROOT, 'src', 'components', 'onboarding', 'OnboardingDisplayParts.tsx');
const OUT_DIR = path.join(ROOT, '.tmp', 'onboarding-display-contract');
const ENTRY = path.join(OUT_DIR, 'entry.mjs');
const BUNDLE = path.join(OUT_DIR, 'bundle.mjs');

const ENTRY_SOURCE = [
  "import { createElement, Fragment } from 'react';",
  "import { renderToStaticMarkup } from 'react-dom/server';",
  "import { ModuleHeading, ComputeShieldCard, SelectedStepsIndicator } from '../../src/components/onboarding/OnboardingDisplayParts';",
  '',
  'export function renderParts(props) {',
  '  const heading = createElement(ModuleHeading, {',
  '    title: props.title,',
  "    description: createElement(Fragment, null, '读取 ', createElement('code', null, props.codeText), ' 导出的需求文件'),",
  '  });',
  '  const shield = createElement(ComputeShieldCard, { title: props.shieldTitle, items: props.items });',
  '  const indicator = createElement(SelectedStepsIndicator, { count: props.count });',
  '  return {',
  '    heading: renderToStaticMarkup(heading),',
  '    shield: renderToStaticMarkup(shield),',
  '    indicator: renderToStaticMarkup(indicator),',
  '  };',
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
      loader: { '.css': 'empty' },
      banner: {
        js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
      },
      logLevel: 'silent',
    });
    rendered = await import(pathToFileURL(BUNDLE).href);
  } catch (error) {
    buildError = error;
  }
  return rendered;
}

const PROPS = {
  title: '模块 A · 契约标题',
  codeText: 'portal/inbox/',
  shieldTitle: '子项 2 · 长任务稳定运行与断点恢复',
  items: ['算力节点降权执行 + 3 线程封顶', '7.5GB 内存软熔断与检查点续跑', '每步 exit 0 后落盘台账'],
  count: 3,
};

test('契约打包成功：组件存在且可经 esbuild 加载', async () => {
  const mod = await ensureBundle();
  assert.equal(buildError, null, `组件打包/加载失败：${buildError?.message}`);
  assert.equal(typeof mod.renderParts, 'function');
});

test('ModuleHeading：给定 title/description 渲染 module-title + module-desc（含内联 code）', async () => {
  const mod = await ensureBundle();
  assert.ok(mod, `组件未就绪：${buildError?.message}`);
  const html = mod.renderParts(PROPS).heading;
  assert.ok(html.includes('class="module-title"'), '缺少 module-title 结构类名');
  assert.ok(html.includes(PROPS.title), '标题未随 props 渲染');
  assert.ok(html.includes('class="module-desc"'), '缺少 module-desc 结构类名');
  assert.ok(html.includes('读取 '), 'description 文本未渲染');
  assert.ok(html.includes('<code>' + PROPS.codeText + '</code>'), 'description 的 ReactNode（内联 code）未原样渲染');
});

test('ComputeShieldCard：给定 title/items 渲染提示卡片结构与逐项文案', async () => {
  const mod = await ensureBundle();
  assert.ok(mod, `组件未就绪：${buildError?.message}`);
  const html = mod.renderParts(PROPS).shield;
  for (const cls of ['form-group', 'form-label', 'compute-shield-card', 'compute-shield-icon', 'compute-shield-list']) {
    assert.ok(html.includes('class="' + cls + '"'), '缺结构类名：' + cls);
  }
  assert.ok(html.includes(PROPS.shieldTitle), '卡片标题未随 props 渲染');
  const lis = html.match(/<li[^>]*>[\s\S]*?<\/li>/g) || [];
  assert.equal(lis.length, PROPS.items.length, 'li 数量应与 items 长度一致');
  for (const item of PROPS.items) {
    assert.ok(html.includes(item), '缺列表项文案：' + item);
  }
});

test('SelectedStepsIndicator：给定 count 渲染 subtle 文案与 margin-top', async () => {
  const mod = await ensureBundle();
  assert.ok(mod, `组件未就绪：${buildError?.message}`);
  const html = mod.renderParts(PROPS).indicator;
  assert.ok(html.includes('class="subtle"'), '缺 subtle 类名');
  assert.ok(html.includes('已选 ' + PROPS.count + ' 个步骤'), '步骤数未随 props 渲染');
  assert.ok(html.includes('margin-top:8px'), '缺 margin-top:8px 内联样式');
});

test('props 变化会改变渲染产物：受控而非硬编码', async () => {
  const mod = await ensureBundle();
  assert.ok(mod, `组件未就绪：${buildError?.message}`);
  const other = { ...PROPS, title: '另一个标题', codeText: 'other/path/', shieldTitle: '另一张卡片', items: ['唯一一项'], count: 7 };
  const a = mod.renderParts(PROPS);
  const b = mod.renderParts(other);
  assert.ok(b.heading.includes('另一个标题') && b.heading.includes('<code>other/path/</code>'), 'heading 未随 props 变化');
  assert.ok(!b.heading.includes('模块 A · 契约标题'), '旧标题仍残留');
  assert.ok(b.indicator.includes('已选 7 个步骤') && !b.indicator.includes('已选 3 个步骤'), 'indicator 未随 count 变化');
  const lis = b.shield.match(/<li[^>]*>[\s\S]*?<\/li>/g) || [];
  assert.equal(lis.length, 1, 'items 长度变化未生效');
  assert.ok(b.shield.includes('唯一一项'), '卡片列表项未随 items 变化');
  assert.notEqual(a.heading, b.heading);
});

test('受控子组件硬约束：零状态机 / 零 store / 零 hook / 零 fetch，只接 props', () => {
  assert.ok(fs.existsSync(COMPONENT), '组件文件缺失：' + COMPONENT);
  const src = fs.readFileSync(COMPONENT, 'utf8');
  assert.equal(src.includes('\r\n'), false, '出现 CRLF（坑 #103）');
  for (const banned of ['useState', 'useEffect', 'useCallback', 'useRef', 'useContext', 'useReducer', 'useMemo', 'fetch(', 'createContext', 'useStore']) {
    assert.equal(src.includes(banned), false, '受控展示组件不得出现：' + banned);
  }
  assert.ok(src.includes("import type { ReactNode } from 'react'"), '应只从 react 引入类型 ReactNode');
  for (const name of ['ModuleHeading', 'ComputeShieldCard', 'SelectedStepsIndicator']) {
    assert.ok(src.includes('export function ' + name), '缺 ' + name + ' 导出');
  }
});
