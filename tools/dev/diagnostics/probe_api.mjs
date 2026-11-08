
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = 'D:/00.AIagent/codespace/AI辅助生信分析流程工作台';
const BD = path.join(ROOT, 'BioanalysDesktop');
const env = { ...process.env, BAD_PORT: '18996',
  BAD_AUTH_USER: 'probe', BAD_AUTH_PASS: 'probe-pass-123', SystemRoot: process.env.SystemRoot || 'C:\\Windows' };
const srv = spawn(process.execPath, ['server/index.js'], { cwd: BD, env, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 3000));
const browser = await chromium.launch();
const ctx = await browser.newContext({ httpCredentials: { username: 'probe', password: 'probe-pass-123' } });
const page = await ctx.newPage();
const calls = [];
const errs = [];
page.on('request', (r) => { const u = r.url(); if (u.includes('/api/')) calls.push(u.split('/api/')[1]); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
await page.goto('http://127.0.0.1:18996/', { waitUntil: 'load' });
await page.waitForTimeout(3500);
const tabs = await page.locator('.tab-nav-item').allInnerTexts();
const banner = await page.locator('.mock-banner').count();
const selfcheckCalls = calls.filter((c) => c.startsWith('selfcheck')).length;
console.log(JSON.stringify({ api_calls: calls, selfcheck_calls: selfcheckCalls, banner, tabs_count: tabs.length, tabs: tabs.slice(0,8), errs: errs.slice(0,6) }, null, 1));
await browser.close(); srv.kill();
