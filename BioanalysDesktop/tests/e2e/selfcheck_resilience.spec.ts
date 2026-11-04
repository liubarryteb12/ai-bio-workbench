import { expect, test } from '@playwright/test';

const ADMIN_BASE = 'http://127.0.0.1:9322';

test.use({ httpCredentials: { username: 'e2e-admin', password: 'e2e-admin-pass' } });

/**
 * 五维自检页面对服务端异常响应的鲁棒性（T0-5 后半）。
 *
 * 背景：src/views/SelfCheckAdminView.tsx 原先不判 res.ok，非 200 时把
 * {error} 直接当 SelfCheckResponse 存进 state，渲染时 result.checks.map 抛
 * TypeError，整页白屏。全站没有 ErrorBoundary，一次 500 就能把用户挡在门外。
 */

test('自检接口 500 时不许白屏，必须给出错误卡与重试按钮', async ({ page }) => {
  const pageErrors: string[] = [];
  let selfcheckRequests = 0;
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  await page.route('**/api/selfcheck', (route) => {
    selfcheckRequests += 1;
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'selfcheck 暂时不可用' }),
    });
  });

  await page.goto(ADMIN_BASE + '/');
  await expect(page.locator('.tab-nav-item').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '五维自检', exact: true }).click();

  await expect(page.locator('.view-container')).toBeVisible({ timeout: 10_000 });
  // 白屏判据：外壳还在，但视图里一个字都没有
  await expect(page.locator('.view-container .card')).toHaveCount(1);
  // 失败态必须是一块能看懂、能重试的错误卡，不是一行裸文字
  await expect(page.locator('.error-card')).toBeVisible();
  await expect(page.locator('.error-card')).toContainText('检测失败');
  await expect(page.locator('.error-card')).toContainText('HTTP 500');
  // 服务端的 error 文案要透传，用户才知道是服务端拒绝而不是网络断了
  await expect(page.locator('.error-card')).toContainText('selfcheck 暂时不可用');
  await expect(page.locator('.error-card').getByRole('button', { name: '重试' })).toBeVisible();
  // 自检项网格不该出现在失败态
  await expect(page.locator('.selfcheck-grid')).toHaveCount(0);
  expect(pageErrors.join('\n'), '500 不得变成渲染期异常').not.toMatch(/TypeError|is not a function/);

  const before = selfcheckRequests;
  await page.locator('.error-card').getByRole('button', { name: '重试' }).click();
  await expect.poll(() => selfcheckRequests, { timeout: 10_000 }).toBeGreaterThan(before);
  await expect(page.locator('.error-card')).toBeVisible();
});

test('自检页文案不出现内部端点名等实现细节', async ({ page }) => {
  await page.route('**/api/selfcheck', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'boom' }),
    }),
  );

  await page.goto(ADMIN_BASE + '/');
  await expect(page.locator('.tab-nav-item').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '五维自检', exact: true }).click();
  await expect(page.locator('.view-container')).toBeVisible();

  const text = await page.locator('.view-container').innerText();
  expect(text).not.toContain('/api/selfcheck');
  expect(text).not.toContain('GET ');
});

/**
 * ErrorBoundary 兜底（T0-5 第三项：全站无 ErrorBoundary）。
 *
 * 触发面刻意选「接口 200 但结构漂移」：checks 数组里混进 null 项。
 * 这不是编造的极端值，正是「服务端改了字段形状、前端按旧契约取值」的日常形态，
 * 而且无论后端契约怎么收紧，这个用例都不会自己变绿（它本来就不该靠后端修）。
 */
test('自检返回的 checks 结构漂移时，ErrorBoundary 必须给出降级卡而不是整页白屏', async ({ page }) => {
  await page.route('**/api/selfcheck', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ all_pass: true, checks: [null] }),
    }),
  );

  await page.goto(ADMIN_BASE + '/');
  await expect(page.locator('.tab-nav-item').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '五维自检', exact: true }).click();

  // 外壳必须活着：tab 还在，用户能切走
  await expect(page.locator('.app-root')).toBeVisible();
  await expect(page.locator('.tab-nav-item')).toHaveCount(6);
  // 降级卡要说明是哪块视图坏了、给出错误原文、并给重试入口
  await expect(page.locator('.view-error-card')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.view-error-card')).toHaveAttribute('role', 'alert');
  await expect(page.locator('.view-error-card')).toContainText('五维自检');
  await expect(page.locator('.view-error-card .error-text')).not.toHaveText('');
  await expect(page.locator('.view-error-card').getByRole('button', { name: '重试' })).toBeVisible();

  // 重试要真的重新挂载这块视图，而不是把错误卡留在原地
  await page.locator('.view-error-card').getByRole('button', { name: '重试' }).click();
  await expect(page.locator('.view-error-card')).toBeVisible();
  await expect(page.locator('.tab-nav-item')).toHaveCount(6);
});

test('一个视图崩了不影响其他视图：切走后其他 tab 正常渲染', async ({ page }) => {
  await page.route('**/api/selfcheck', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ all_pass: true, checks: [null] }),
    }),
  );

  await page.goto(ADMIN_BASE + '/');
  await expect(page.locator('.tab-nav-item').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '五维自检', exact: true }).click();
  await expect(page.locator('.view-error-card')).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: '新建项目向导', exact: true }).click();
  await expect(page.locator('.view-error-card')).toHaveCount(0);
  await expect(page.locator('.module-card').first()).toBeVisible({ timeout: 10_000 });
});
