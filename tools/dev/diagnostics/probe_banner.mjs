
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = 'D:/00.AIagent/codespace/AI辅助生信分析流程工作台';
const BD = path.join(ROOT, 'BioanalysDesktop');
const env = {
  ...process.env,
  BIO_COMPUTE_ADAPTER: 'mock', BAD_PORT: '18999',
  BAD_AUTH_USER: 'probe', BAD_AUTH_PASS: 'probe-pass-123',
  SystemRoot: process.env.SystemRoot || 'C:\\Windows',
};
const srv = spawn(process.execPath, ['server/index.js'], { cwd: BD, env, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 3000));

const browser = await chromium.launch();
const ctx = await browser.newContext({ httpCredentials: { username: 'probe', password: 'probe-pass-123' } });
const page = await ctx.newPage();
const errors = [];
const reqs = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
page.on('request', (r) => { if (r.url().includes('/api/selfcheck')) reqs.push(1); });

await page.goto('http://127.0.0.1:18999/', { waitUntil: 'load', timeout: 20000 });
await page.waitForTimeout(3000);

const banner1 = await page.locator('.mock-banner').count();
const title = await page.title();
const tabs = await page.locator('.tab-nav-item').allInnerTexts();
const modeText = banner1 ? (await page.locator('.mock-banner').innerText()).replace(/\n+/g, ' | ') : null;
let clickErr = null;
try { await page.getByRole('button', { name: '五维自检' }).click({ timeout: 5000 }); }
catch (e) { clickErr = String(e).slice(0, 200); }
await page.waitForTimeout(2000);
const banner2 = await page.locator('.mock-banner').count();
await page.screenshot({ path: path.join(ROOT, '.tmp', 'app_banner_probe.png') });

console.log(JSON.stringify({ title, tabs, banner_before_nav: banner1, banner_after_nav: banner2, modeText, selfcheck_reqs: reqs.length, clickErr, errors: errors.slice(0, 10) }, null, 1));
await browser.close();
srv.kill();
