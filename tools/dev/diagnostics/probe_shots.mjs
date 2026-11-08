import { chromium } from 'playwright';
const PORT = process.env.PROBE_PORT || '18994';
const base = 'http://127.0.0.1:' + PORT;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, httpCredentials: { username: 'admin', password: process.env.PROBE_PASS } });
const page = await ctx.newPage();
await page.goto(base + '/', { waitUntil: 'networkidle', timeout: 30000 });
const tabs = await page.$$('.tab-nav-item');
const names = await page.$$eval('.tab-nav-item', els => els.map(e => e.textContent.trim()));
for (let i = 0; i < tabs.length; i++) {
  const t = (await page.$$('.tab-nav-item'))[i];
  if (!t) continue;
  await t.click().catch(() => {});
  await page.waitForTimeout(900);
  const fname = '.tmp_ui_tab' + (i + 1) + '.png';
  await page.screenshot({ path: fname, fullPage: false });
  console.log(fname + ' <- ' + names[i]);
}
await browser.close();
