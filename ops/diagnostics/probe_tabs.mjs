import { chromium } from 'playwright';
const base = 'http://127.0.0.1:' + (process.env.PROBE_PORT || '18994');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, httpCredentials: { username: 'admin', password: process.env.PROBE_PASS } });
const page = await ctx.newPage();
const rec = [];
page.on('response', async res => {
  const u = new URL(res.url());
  if (u.pathname.startsWith('/api/')) rec.push(res.status() + ' ' + u.pathname + (u.search || ''));
});
await page.goto(base + '/', { waitUntil: 'networkidle' });
const names = await page.$$eval('.tab-nav-item', e => e.map(x => x.textContent.trim()));
for (let i = 0; i < names.length; i++) {
  rec.length = 0;
  const tabs = await page.$$('.tab-nav-item');
  await tabs[i].click().catch(() => {});
  await page.waitForTimeout(2500);
  console.log('### ' + names[i] + ' -> ' + JSON.stringify(rec));
}
await browser.close();
