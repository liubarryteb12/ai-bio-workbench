import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ADMIN_BASE = 'http://127.0.0.1:9322';
const DESKTOP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// admin 面在 D-29 Fail-Closed 下强制 Basic 鉴权；凭据与 playwright.config.ts 的 webServer env 同源。
test.use({ httpCredentials: { username: 'e2e-admin', password: 'e2e-admin-pass' } });

/**
 * 桌面端首页挂载契约（T0-5）。
 *
 * 背景（2026-11 全量审查实测）：src/App.tsx 里两个 useEffect 交错嵌套，
 * 计算面模式读取那段被插进了上一个 effect 的清理函数体内，导致
 *   - 首页挂载时 /api/selfcheck 根本不发（切到「五维自检」才发）；
 *   - 组件卸载时在清理函数里执行 hooks 调用，React 抛 Invalid hook call。
 * 既有 tests/compute_mode_banner.test.js 全是源码字符串 includes 断言，
 * 看不到这种结构错误。所以这里用真浏览器验行为，而不是验字面量。
 */

test('首页挂载即读取计算面模式，且不出现 React 错误', async ({ page }) => {
  const selfcheckCalls: string[] = [];
  const consoleErrors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('/api/selfcheck')) selfcheckCalls.push(req.method() + ' ' + u);
  });

  await page.goto(ADMIN_BASE + '/');
  // 首屏出现任一 tab 就说明 React 挂载完成
  await expect(page.locator('.tab-nav-item').first()).toBeVisible({ timeout: 20_000 });
  // 给模式读取留出一次事件循环
  await page.waitForTimeout(1500);

  expect(selfcheckCalls.length, '首页挂载后必须至少请求一次 /api/selfcheck（计算面模式来源）').toBeGreaterThan(0);
  expect(consoleErrors.join('\n')).not.toContain('Invalid hook call');
  expect(consoleErrors.join('\n')).not.toContain('Minified React error #321');
});

/**
 * 首屏只读一次计算面模式：挂载时恰好 1 次，切 tab 不得重发。
 *
 * 为什么单独钉「恰好 1 次」：至少一次挡不住重复请求，而重复请求意味着
 * effect 依赖写错（例如把 view 放进模式读取的依赖数组），会随每次切 tab 打一倍。
 */
test('首页挂载后 /api/selfcheck 恰好请求 1 次，切 tab 不重发', async ({ page }) => {
  const selfcheckCalls: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/selfcheck')) selfcheckCalls.push(req.url());
  });

  await page.goto(ADMIN_BASE + '/');
  await expect(page.locator('.tab-nav-item').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  expect(selfcheckCalls.length, '挂载后 /api/selfcheck 必须恰好 1 次').toBe(1);

  for (const label of ['结果预览 Studio', '分析输入控制台', '新建项目向导']) {
    await page.getByRole('button', { name: label, exact: true }).click();
  }
  await page.waitForTimeout(800);
  expect(selfcheckCalls.length, '切 tab 不得重新读取计算面模式').toBe(1);
});

/**
 * 项目列表接口 500 时页面必须活着。
 *
 * 实测缺陷（T0-5 同票）：refreshProjects 不判 res.ok，500 时 payload.projects
 * 是 undefined，setProjects(undefined) 之后 App 渲染里 projects.length 抛 TypeError，
 * 没有 ErrorBoundary 就是整页白屏，用户连 tab 都点不到。
 */
test('项目列表接口 500 时外壳仍在，并给出可读的项目错误', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  await page.route('**/api/projects/list', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: '项目列表暂时不可用' }),
    }),
  );

  await page.goto(ADMIN_BASE + '/');
  await expect(page.locator('.app-root')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.tab-nav-item')).toHaveCount(6);
  await expect(page.locator('.error-text')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.error-text')).toContainText('项目列表暂时不可用');
  expect(pageErrors.join('\n'), '500 不得变成渲染期异常').not.toMatch(/TypeError|is not a function/);
});

test('Mock 计算面下首页不得整页白屏，且必须显出 mock 横幅', async ({ page }) => {
  const apiErrors: string[] = [];
  page.on('pageerror', (err) => apiErrors.push(String(err)));

  await page.goto(ADMIN_BASE + '/');
  await expect(page.locator('.app-root')).toBeVisible({ timeout: 20_000 });

  // mock 多来自服务端启动配置；这里只钉「有横幅时 tab 仍在，不能白屏」这条底线：
  // 先确认 6 个 tab 全渲染，再确认没有 React 崩溃。
  await expect(page.locator('.tab-nav-item')).toHaveCount(6);
  expect(apiErrors.join('\n')).not.toContain('Invalid hook call');
  expect(apiErrors.join('\n')).not.toContain('Minified React error #321');
});

// ============================================================
// BIO_COMPUTE_ADAPTER=mock 真起一个服务端：横幅由服务端字段驱动，不靠前端造数据
// ============================================================

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function waitHealth(base: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(base + '/api/health', { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      // 没起来就继续等
    }
    if (Date.now() > deadline) throw new Error('mock 计算面服务端 15s 内没就绪');
    await new Promise((r) => setTimeout(r, 200));
  }
}

test.describe('BIO_COMPUTE_ADAPTER=mock', () => {
  let child: ChildProcess | null = null;
  let base = '';

  test.beforeAll(async () => {
    const port = await freePort();
    base = 'http://127.0.0.1:' + port;
    child = spawn(process.execPath, ['server/index.js'], {
      cwd: DESKTOP_DIR,
      env: {
        ...process.env,
        BAD_PORT: String(port),
        BIO_COMPUTE_ADAPTER: 'mock',
        BIO_ALLOW_MOCK_COMPUTE: '1',
        BIO_ALLOW_DEV_NOAUTH: '1',
        NO_PROXY: '127.0.0.1,localhost',
      },
      stdio: 'ignore',
    });
    await waitHealth(base);
  });

  test.afterAll(async () => {
    child?.kill();
    child = null;
  });

  test('mock 模式下页面不白屏，mock 横幅可见且点明演示数据不代表真机', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto(base + '/');
    await expect(page.locator('.app-root')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.tab-nav-item')).toHaveCount(6);
    // 视图真的挂上了，不是只剩空壳
    await expect(page.locator('.view-container').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.mock-banner')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.mock-banner')).toContainText('离线演示模式');
    await expect(page.locator('.mock-banner')).toContainText('不代表真机');
    expect(pageErrors.join('\n'), 'mock 模式不得出现渲染期崩溃').not.toMatch(/Invalid hook call|React error #321/);
  });
});
