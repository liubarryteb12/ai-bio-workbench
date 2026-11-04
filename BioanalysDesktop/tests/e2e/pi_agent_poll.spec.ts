import { expect, test } from '@playwright/test';

const ADMIN_BASE = 'http://127.0.0.1:9322';

test.use({ httpCredentials: { username: 'e2e-admin', password: 'e2e-admin-pass' } });

/**
 * 派发 A2A 任务后的轮询生命周期（外部评审 FE-19 的实测钉子）。
 *
 * 背景：src/views/PiAgentView.tsx:104-137 pollDispatchedTask 用 while + 24 小时 deadline，
 * 没有任何 AbortController 或卸载标记；:155 用 void 起跑不 await。切到别的 tab 之后
 * 这个循环仍然活着，每 5/10/20/30 秒继续打 GetTask 并 setState，最长 24 小时。
 *
 * 这里用真浏览器 + 桩接口数请求次数：切走后请求数必须不再增长。
 * 判据用「切走后再等 13 秒」，覆盖下一次 10 秒档的轮询（首档 5 秒已过）。
 */

test('派发任务后切走 tab，轮询必须停止', async ({ page }) => {
  let pollCount = 0;
  let cancelCount = 0;
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  await page.route('**/api/pi-agent/dispatch', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        http_status: 200,
        task: { id: 'e2e-poll-task', status: { state: 'working' } },
        poll_url: ADMIN_BASE + '/api/pi-agent/task/e2e-poll-task',
      }),
    }),
  );
  // 一直停在 working：只要有人问，就说明轮询还活着
  await page.route('**/api/pi-agent/task/e2e-poll-task', (route) => {
    pollCount += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, task: { id: 'e2e-poll-task', status: { state: 'working' } } }),
    });
  });
  await page.route('**/api/pi-agent/task/cancel', (route) => {
    cancelCount += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, task: { id: 'e2e-poll-task', status: { state: 'canceled' } } }),
    });
  });

  await page.goto(ADMIN_BASE + '/');
  await expect(page.locator('.tab-nav-item').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Pi Agent 监控', exact: true }).click();

  await page.getByRole('button', { name: '派发 A2A 测试任务', exact: true }).click();
  await page.locator('.pi-dispatch-textarea').fill('e2e 轮询生命周期探针');
  await page.getByRole('button', { name: '立即发送', exact: true }).click();

  // 首档 5 秒：等到第一次 GetTask 真的发生，才说明轮询起跑
  await expect.poll(() => pollCount, { timeout: 15_000, intervals: [500] }).toBeGreaterThan(0);
  const pollsBeforeSwitch = pollCount;

  await page.getByRole('button', { name: '新建项目向导', exact: true }).click();
  // 覆盖下一档 10 秒（以及一次 5 秒档的边界余量）
  await page.waitForTimeout(13_000);

  expect(pollCount - pollsBeforeSwitch, '切走 tab 后不得继续轮询 GetTask').toBe(0);
  expect(cancelCount, '切走不等于取消任务，不得偷偷调 cancel').toBe(0);
  expect(pageErrors.join('\n')).not.toContain('Invalid hook call');
});
