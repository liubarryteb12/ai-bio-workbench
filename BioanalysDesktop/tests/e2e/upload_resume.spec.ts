import { expect, test, type Page, type Request } from '@playwright/test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ADMIN_BASE = 'http://127.0.0.1:9322';

// admin 面（9322）在 D-29 Fail-Closed 下强制 Basic 鉴权；凭据与 playwright.config.ts 同源。
test.use({ httpCredentials: { username: 'e2e-admin', password: 'e2e-admin-pass' } });

/**
 * 上传断点续传 e2e（T2.4 判据：断网中断 → 重连续传 → 完成后与上传回执哈希一致）。
 *
 * 判据文件恰好 10 MiB（3 片），与 playwright.config.ts 的 BIO_COMPUTE_MOCK_STDOUT
 * 一致：complete 端点的远端 stat 走 mock 算力面回填这个字节数，sizeMatch 才为 true。
 * 文件名带时间戳：指纹确定性派生 uploadId，每次运行都是干净会话，不依赖清理。
 */
const FILE_SIZE = 10 * 1024 * 1024;

function buildUploadFile(): { filePath: string; sha256: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-resume-e2e-'));
  const filePath = path.join(dir, `resume-e2e-${Date.now()}.txt`);
  const buffer = Buffer.alloc(FILE_SIZE);
  const line = 'bio-analys upload resume e2e payload line.\n';
  for (let offset = 0; offset < FILE_SIZE; offset += line.length) {
    buffer.write(line, offset);
  }
  fs.writeFileSync(filePath, buffer);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  return { filePath, sha256 };
}

function uploadCard(page: Page) {
  return page.locator('.card', { hasText: '数据导入' });
}

test('上传断点续传：中断后重连续传，回执哈希与本地文件一致', async ({ page }) => {
  const { filePath, sha256 } = buildUploadFile();

  await page.goto(ADMIN_BASE + '/');
  await expect(page.locator('.tab-nav-item').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '分析输入控制台', exact: true }).click();
  await page.getByRole('button', { name: '数据导入', exact: true }).click();
  const card = uploadCard(page);
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: '线1 / GEO bulk' }).click();
  await card.locator('input[type="file"]').setInputFiles(filePath);

  // 第一段：断网中断。第 0 片放行落盘，之后所有分片连接重置，前端必须保留断点。
  await page.route('**/api/upload/chunk*', (route) => {
    const index = Number(new URL(route.request().url()).searchParams.get('index'));
    if (index >= 1) void route.abort('connectionreset');
    else void route.continue();
  });
  await card.getByRole('button', { name: '开始上传' }).click();
  await expect(card.locator('.subtle', { hasText: '失败' })).toBeVisible({ timeout: 15_000 });
  await expect(card.getByRole('button', { name: '继续上传' })).toBeVisible();

  // 第二段：恢复网络重连。续传首片请求必须是 index=1，证明第 0 片已在服务端保留。
  await page.unroute('**/api/upload/chunk*');
  const resumedIndexes: string[] = [];
  const onChunkRequest = (request: Request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/upload/chunk') resumedIndexes.push(url.searchParams.get('index') || '');
  };
  page.on('request', onChunkRequest);
  const completeResponsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/upload/complete',
  );
  await card.getByRole('button', { name: '继续上传' }).click();
  const completeResponse = await completeResponsePromise;
  expect(resumedIndexes[0], '续传必须从第 1 片开始（第 0 片已在服务端落盘）').toBe('1');
  expect(resumedIndexes, '10 MiB 共 3 片，续传只需补第 1、2 片').toEqual(['1', '2']);

  const payload = (await completeResponse.json()) as {
    ok?: boolean; sizeMatch?: boolean; sha256?: string;
  };
  expect(payload.ok, JSON.stringify(payload)).toBe(true);
  expect(payload.sizeMatch).toBe(true);
  expect(payload.sha256, '上传回执哈希必须与本地文件一致').toBe(sha256);
  await expect(card.locator('.subtle', { hasText: '上传完成，字节校验通过' })).toBeVisible({ timeout: 10_000 });
  page.off('request', onChunkRequest);
});
