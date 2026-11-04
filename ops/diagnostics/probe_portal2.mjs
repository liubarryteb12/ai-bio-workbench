import { chromium } from 'playwright';
const base = 'http://127.0.0.1:8080';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
const page = await ctx.newPage();
await page.goto(base + '/', { waitUntil: 'networkidle' });
// 直接跳到第5步提交页看全貌，先看第3步分组设计
await page.click('text=下一步').catch(()=>{});
await page.waitForTimeout(600);
await page.screenshot({ path: '.tmp_portal_02.png', fullPage: true });
console.log('step2 ok');
await browser.close();
