import { test, expect } from '@playwright/test';

const ADMIN_BASE = 'http://127.0.0.1:9322';

test('pi chat renders artifact replies, dedupes after reload and recovers from cancel failure', async ({ page }) => {
  test.setTimeout(45_000);
  let overviewCalls = 0;
  await page.route('**/api/pi-agent/overview', async (route) => {
    overviewCalls += 1;
    await route.fulfill({
      json: {
        ok: true,
        online: true,
        current_model: { provider: 'zai', model: 'glm-5.3-flash' },
        a2a_card: { name: 'pi-termux-executor', version: '1.0.0', url: 'http://127.0.0.1:9910' },
      },
    });
  });
  await page.route('**/api/pi-agent/dispatch', async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        task: { id: 'task-fix-e2e', status: { state: 'TASK_STATE_WORKING' } },
        poll_url: '/api/pi-agent/task?id=task-fix-e2e',
      },
    });
  });
  let taskCalls = 0;
  await page.route(/\/api\/pi-agent\/task\?id=task-fix-e2e$/, async (route) => {
    taskCalls += 1;
    await route.fulfill({
      json: {
        ok: true,
        task: {
          id: 'task-fix-e2e',
          status: { state: taskCalls >= 2 ? 'TASK_STATE_COMPLETED' : 'TASK_STATE_WORKING' },
          artifacts: taskCalls >= 2
            ? [{ artifactId: 'reply', parts: [{ text: 'PI_CHAT_FIX_OK' }] }]
            : [],
        },
      },
    });
  });
  await page.route('**/api/pi-agent/calls?limit=50', async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        calls: [{ task_id: 'fix-e2e', last_text: 'calls should not win' }],
      },
    });
  });
  await page.route('**/api/pi-agent/task/cancel', async (route) => {
    await route.fulfill({ status: 502, json: { ok: false, error: 'ERR_CANCEL_REJECTED' } });
  });

  await page.addInitScript(() => {
    window.localStorage.setItem('bioanalys-desktop:pi-agent-chat-history', JSON.stringify([
      { id: 'user-pending', role: 'user', text: '验证 Pi 回复', ts: 1, taskId: 'task-fix-e2e', status: 'working' },
    ]));
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(ADMIN_BASE);
  await page.locator('.tab-nav-item', { hasText: 'Pi Agent 对话' }).click();
  await expect(page.getByTestId('pi-chat-status')).toContainText('在线');
  await expect(page.getByTestId('pi-chat-status')).toContainText('glm-5.3-flash');

  await expect(page.getByTestId('pi-chat-message-assistant')).toHaveCount(1, { timeout: 20_000 });
  await expect(page.getByTestId('pi-chat-message-assistant')).toContainText('PI_CHAT_FIX_OK');
  await expect(page.getByTestId('pi-chat-message-user')).toHaveCount(1);
  await expect(page.getByTestId('pi-chat-message-system')).toHaveCount(0);

  await page.reload();
  await page.locator('.tab-nav-item', { hasText: 'Pi Agent 对话' }).click();
  await expect(page.getByTestId('pi-chat-message-assistant')).toHaveCount(1, { timeout: 20_000 });
  await expect(page.getByTestId('pi-chat-message-user')).toHaveCount(1);
  await expect(page.getByTestId('pi-chat-message-system')).toHaveCount(0);

  await page.getByTestId('pi-chat-input').fill('再问一次');
  await page.getByTestId('pi-chat-input').press('Enter');
  await expect(page.getByTestId('pi-chat-message-user')).toHaveCount(2);
  await page.getByLabel('取消当前任务').click();
  await expect(page.getByText('取消失败：ERR_CANCEL_REJECTED')).toBeVisible();
  await expect(page.getByLabel('取消当前任务')).toBeEnabled();
  await expect(page.getByTestId('pi-chat-status')).not.toContainText('completed');
  await page.getByLabel('清空本地对话历史').click();
  await expect(page.getByTestId('pi-chat-empty')).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'artifacts/agent_tasks/pi_chat_fix/pi_chat_mobile_390x844.png', fullPage: true });
});

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 768, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`pi chat responsive layout at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.route('**/api/pi-agent/overview', async (route) => {
      await route.fulfill({
        json: {
          ok: true,
          online: true,
          current_model: { provider: 'zai', model: 'glm-5.3-flash' },
          a2a_card: { name: 'pi-termux-executor', version: '1.0.0', url: 'http://127.0.0.1:9910' },
        },
      });
    });
    await page.setViewportSize(viewport);
    await page.goto(ADMIN_BASE);
    await page.locator('.tab-nav-item', { hasText: 'Pi Agent 对话' }).click();
    await expect(page.getByTestId('pi-chat-status')).toContainText('在线');

    const tabLabels = ['新建项目向导', '分析输入控制台', '五维自检', '结果预览 Studio', 'Pi Agent 监控', 'Pi Agent 对话'];
    for (const label of tabLabels) {
      const tab = page.locator('.tab-nav-item', { hasText: label });
      await expect(tab).toBeVisible();
      await expect(tab).toBeInViewport({ ratio: 1 });
    }
    await expect(page.locator('.project-selector-label')).toContainText('当前项目');
    await expect(page.locator('.project-selector')).toBeInViewport({ ratio: 1 });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    const composer = await page.locator('.pi-chat-composer').evaluate((element) => {
      const input = element.querySelector<HTMLTextAreaElement>('#pi-chat-input');
      const button = element.querySelector<HTMLButtonElement>('.pi-chat-send');
      if (!input || !button) return null;
      const a = input.getBoundingClientRect();
      const b = button.getBoundingClientRect();
      return {
        overlap: !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top),
        inputVisible: a.width > 0 && a.height > 0,
        buttonVisible: b.width > 0 && b.height > 0,
      };
    });
    expect(composer).not.toBeNull();
    expect(composer?.overlap).toBe(false);
    expect(composer?.inputVisible).toBe(true);
    expect(composer?.buttonVisible).toBe(true);

    await page.screenshot({
      path: `artifacts/agent_tasks/pi_chat_fix/pi_chat_${viewport.width}x${viewport.height}.png`,
      fullPage: true,
    });
  });
}
