import { chromium } from 'playwright';
const base = 'http://127.0.0.1:8080';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + String(e).slice(0, 160)));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
await page.goto(base + '/', { waitUntil: 'networkidle', timeout: 30000 }).catch(e => errs.push('GOTO ' + e.message.slice(0,100)));
console.log('title=' + await page.title());
const steps = await page.$$eval('.step, .step-item, [data-step]', els => els.map(e => e.textContent.trim()).slice(0, 12)).catch(() => []);
console.log('steps=' + JSON.stringify(steps));
await page.screenshot({ path: '.tmp_portal_01.png', fullPage: false });
// 找到数据集卡片区域
const counts = await page.$$eval('input[id^="d-count-"]', els => els.map(e => e.id));
const tissues = await page.$$eval('input[id^="d-tissue-"]', els => els.map(e => e.id));
console.log('d-count=' + JSON.stringify(counts) + ' d-tissue=' + JSON.stringify(tissues));
console.log('errors=' + JSON.stringify(errs.slice(0,6)));
await browser.close();
