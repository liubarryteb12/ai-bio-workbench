import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const portalPort = 9321;
const adminPort = 9322;
const portalInbox = path.join(rootDir, '.tmp', 'playwright-portal-inbox');

// 每次 E2E 启动前清空隔离收件箱，避免上一次失败留下的需求单影响限流和提交断言。
fs.rmSync(portalInbox, { recursive: true, force: true });

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL: `http://127.0.0.1:${portalPort}`,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `node portal/serve.mjs`,
      url: `http://127.0.0.1:${portalPort}/health`,
      reuseExistingServer: false,
      cwd: rootDir,
      env: {
        PORTAL_PORT: String(portalPort),
        PORTAL_HOST: '127.0.0.1',
        PORTAL_INBOX: portalInbox,
        PORTAL_CLIENT_TOKEN: 'e2e-client-token',
        SYNC_TOKEN: 'e2e-sync-token',
        NO_PROXY: '127.0.0.1,localhost',
      },
    },
    {
      command: `node server/index.js`,
      url: `http://127.0.0.1:${adminPort}/api/health`,
      reuseExistingServer: false,
      cwd: path.join(rootDir, 'BioanalysDesktop'),
      env: {
        BAD_PORT: String(adminPort),
        // 08 号书 D-29 Fail-Closed 后 admin 面无凭据即 401。e2e 固定测试凭据
        // （仅本地 127.0.0.1 测试端口，非生产口令），spec 侧经 httpCredentials 带上。
        BAD_AUTH_USER: 'e2e-admin',
        BAD_AUTH_PASS: 'e2e-admin-pass',
        BIO_UPLOAD_QUOTA_BYTES: String(64 * 1024 * 1024),
        NO_PROXY: '127.0.0.1,localhost',
      },
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
