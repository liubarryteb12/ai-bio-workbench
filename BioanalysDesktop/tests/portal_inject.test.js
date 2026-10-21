/**
 * P5：portal 页面共享契约注入测试。
 *
 * 背景：portal/index.html 是浏览器单文件页，不能 import，白名单/上限/黑名单只能留字面量副本；
 * portal/serve.mjs 在返回页面时把唯一权威（shared/data_formats.mjs 与
 * BioanalysDesktop/server/tumor_blacklist.js）注入成 window.__SHARED_CONTRACTS__。
 * 本测试起真实 portal 服务，断言：注入内容与权威逐项相等、注入脚本安全、
 * 页面仍保留离线回落字面量、前端 #region P5 段在有/无注入时行为正确。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { DATA_EXT as SHARED_EXT, MAX_DATA_BYTES as SHARED_MAX } from '../../shared/data_formats.mjs';
import { BLACKLIST_PATTERNS, checkTumorBlacklist } from '../server/tumor_blacklist.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const INDEX_HTML = path.join(ROOT, 'portal', 'index.html');
const ANCHOR = '<!-- __INJECT_SHARED_CONTRACTS__ -->';

let PORT = 0;
let BASE = '';
let INBOX = '';
let mod = null;
let pageHtml = '';

async function waitReady(base) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return await res.json();
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

before(async () => {
  INBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'portal_p5_inject_'));
  // 端口交给内核分配（PORTAL_PORT=0），import 后从 server.address() 读实际端口，避免抢端口竞态
  process.env.PORTAL_PORT = '0';
  process.env.PORTAL_HOST = '127.0.0.1';
  process.env.PORTAL_INBOX = INBOX;
  mod = await import('../../portal/serve.mjs');
  if (!mod.server.listening) {
    await new Promise((resolve, reject) => {
      mod.server.once('listening', resolve);
      mod.server.once('error', reject);
    });
  }
  PORT = mod.server.address().port;
  BASE = `http://127.0.0.1:${PORT}`;
  const health = await waitReady(BASE);
  assert.ok(health, 'portal 未在 10s 内就绪');
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200);
  pageHtml = await res.text();
});

after(async () => {
  if (mod && mod.server) {
    mod.server.closeAllConnections?.();
    await new Promise((resolve) => mod.server.close(resolve));
  }
  if (INBOX) fs.rmSync(INBOX, { recursive: true, force: true });
});

/** 从页面里抠出注入的 JSON 文本 */
function injectedJsonText(html) {
  const m = html.match(/<script>window\.__SHARED_CONTRACTS__ = ([\s\S]*?);<\/script>/);
  assert.ok(m, '页面里找不到 window.__SHARED_CONTRACTS__ 注入脚本');
  return m[1];
}

/** 解析字面量副本（与 parity 测试同一套正则，确保测的是同一处文本） */
function parseLiteralExt(html) {
  const m = html.match(/var DATA_EXT\s*=\s*\[([^\]]*)\]\s*;/);
  assert.ok(m, '页面里找不到 var DATA_EXT = [...]; 字面量');
  return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
}

function parseLiteralMax(html) {
  const m = html.match(/var MAX_DATA_BYTES\s*=\s*([0-9*\s]+);/);
  assert.ok(m, '页面里找不到 var MAX_DATA_BYTES = ...; 字面量');
  return m[1].split('*').map((s) => Number(s.trim())).reduce((a, b) => a * b, 1);
}

function parseLiteralBlacklist(html) {
  const block = html.match(/var BL_PATTERNS\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(block, '页面里找不到 var BL_PATTERNS = [...]; 字面量');
  return [...block[1].matchAll(/\/((?:[^\/\\\n]|\\.)+)\/([gimsuy]*)/g)]
    .map((m) => ({ source: m[1], flags: m[2] }));
}

/** 取页面里的 #region P5 shared contracts 段（运行时覆盖逻辑） */
function sharedContractsRegion(html) {
  const m = html.match(/\/\/ #region P5 shared contracts[\s\S]*?\/\/ #endregion P5 shared contracts/);
  assert.ok(m, '页面里找不到 P5 shared contracts 标记段');
  return m[0];
}

/** 造一个最小 DOM 桩，供 #region 段在 vm 里跑 */
function makeStubDom() {
  const input = {
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = value; },
    getAttribute(name) { return this.attrs[name]; },
  };
  const hint = { textContent: 'STATIC_HINT' };
  const guideText = { nodeType: 3, nodeValue: '前缀说明支持 .h5ad .rdata，单文件上限 5 GiB。后置说明' };
  const guide = { childNodes: [{ nodeType: 1, nodeValue: null }, guideText] };
  const byId = { 'f-df-file': input, 'h-df-file': hint, 'df-upload-guide': guide };
  return { document: { getElementById: (id) => byId[id] || null }, byId, guideText };
}

/** 在 vm 里跑页面真实的 #region 段，返回运行后的变量与 DOM 状态 */
function runRegion(region, injection) {
  const dom = makeStubDom();
  const sandbox = {
    window: injection ? { __SHARED_CONTRACTS__: injection } : {},
    document: dom.document,
    RegExp, Math, Array, JSON,
  };
  const prefix = [
    "var DATA_EXT = ['.h5ad', '.rdata'];",
    'var MAX_DATA_BYTES = 5 * 1024 * 1024 * 1024;',
    'var BL_PATTERNS = [/cancer/i];',
  ].join('\n');
  const suffix = '\n;({ DATA_EXT: DATA_EXT, MAX_DATA_BYTES: MAX_DATA_BYTES, BL_PATTERNS: BL_PATTERNS });';
  const out = vm.runInNewContext(prefix + '\n' + region + suffix, sandbox, { filename: 'index.html#P5' });
  return { out, dom };
}

// ---------- 1. 注入内容与权威值逐项相等 ----------

test('GET / 200，锚点已被替换，页面含注入脚本', async () => {
  assert.equal(pageHtml.includes(ANCHOR), false, '返回的页面里不该残留注入锚点注释');
  assert.ok(pageHtml.includes('window.__SHARED_CONTRACTS__'), '页面里没有注入脚本');
  assert.match(pageHtml, /提交生信分析需求/, '页面关键文案不能丢');
});

test('注入 JSON 可解析，且与 sharedContractsPayload 逐字段相等', () => {
  const parsed = JSON.parse(injectedJsonText(pageHtml));
  assert.deepEqual(parsed, mod.sharedContractsPayload());
});

test('注入的 DATA_EXT 与 shared 权威逐项同序相等（14 项）', () => {
  const parsed = JSON.parse(injectedJsonText(pageHtml));
  assert.equal(parsed.DATA_EXT.length, 14);
  assert.deepEqual(parsed.DATA_EXT, SHARED_EXT);
});

test('注入的 MAX_DATA_BYTES 等于 shared 权威（5 GiB）', () => {
  const parsed = JSON.parse(injectedJsonText(pageHtml));
  assert.equal(parsed.MAX_DATA_BYTES, SHARED_MAX);
  assert.equal(SHARED_MAX, 5 * 1024 * 1024 * 1024);
});

test('注入的 BL_PATTERNS 与权威 8 条同序同源（source + flags）', () => {
  const parsed = JSON.parse(injectedJsonText(pageHtml));
  const expected = BLACKLIST_PATTERNS.map((re) => ({ source: re.source, flags: re.flags }));
  assert.equal(parsed.BL_PATTERNS.length, 8);
  assert.deepEqual(parsed.BL_PATTERNS, expected);
});

test('注入脚本是安全 JSON：不含裸 <、不提前闭合 script、页面只有一个注入点', () => {
  const jsonText = injectedJsonText(pageHtml);
  assert.equal(jsonText.includes('<'), false, 'JSON 里不该有裸 <');
  assert.equal(jsonText.includes('</script'), false, 'JSON 里不该出现 </script');
  assert.equal(pageHtml.split('<script>window.__SHARED_CONTRACTS__ = ').length - 1, 1, '注入脚本应当只有一个');
});

test('注入脚本重建的正则与 checkTumorBlacklist 判定矩阵一致', () => {
  const parsed = JSON.parse(injectedJsonText(pageHtml));
  const rebuilt = parsed.BL_PATTERNS.map((p) => new RegExp(p.source, p.flags || ''));
  const texts = ['breast cancer', 'glioma sample', 'immune infiltration', '肿瘤样本', '癌', '免疫浸润', 'normal tissue', '炎症反应'];
  for (const text of texts) {
    const serverHit = checkTumorBlacklist(text).hit;
    const pageHit = rebuilt.some((re) => re.test(text));
    assert.equal(pageHit, serverHit, `判定不一致: ${text}`);
  }
});

// ---------- 2. 离线回落：字面量副本仍在且与权威一致 ----------

test('served 页面仍保留三处离线字面量副本（服务端注入不删副本）', () => {
  assert.deepEqual(parseLiteralExt(pageHtml), SHARED_EXT);
  assert.equal(parseLiteralMax(pageHtml), SHARED_MAX);
  assert.equal(parseLiteralBlacklist(pageHtml).length, 8);
});

test('剥掉注入后，页面仍能读到与权威一致的字面量（离线双击场景）', () => {
  const stripped = pageHtml.replace(
    /<script>window\.__SHARED_CONTRACTS__ = [\s\S]*?;<\/script>/,
    ANCHOR
  );
  assert.equal(stripped.includes('<script>window.__SHARED_CONTRACTS__ = '), false);
  assert.ok(stripped.includes(ANCHOR));
  assert.deepEqual(parseLiteralExt(stripped), SHARED_EXT);
  assert.equal(parseLiteralMax(stripped), SHARED_MAX);
  const literalBl = parseLiteralBlacklist(stripped).map((p) => new RegExp(p.source, p.flags || ''));
  const expected = BLACKLIST_PATTERNS.map((re) => new RegExp(re.source, re.flags));
  for (const text of ['cancer', '肿瘤', '免疫浸润', 'normal']) {
    assert.equal(literalBl.some((re) => re.test(text)), expected.some((re) => re.test(text)), text);
  }
});

// ---------- 3. 纯函数注入行为 ----------

test('injectSharedContracts：无锚点时原样返回，不注入', () => {
  const html = '<html><body>no anchor</body></html>';
  assert.equal(mod.injectSharedContracts(html), html);
});

test('injectSharedContracts：有锚点时只替换锚点，前后内容保留', () => {
  const out = mod.injectSharedContracts('AAA' + ANCHOR + 'BBB');
  assert.ok(out.startsWith('AAA<script>window.__SHARED_CONTRACTS__ = '));
  assert.ok(out.endsWith(';</script>BBB'));
  assert.equal(out.includes(ANCHOR), false);
  const jsonText = out.match(/<script>window\.__SHARED_CONTRACTS__ = ([\s\S]*?);<\/script>/)[1];
  assert.deepEqual(JSON.parse(jsonText), mod.sharedContractsPayload());
});

// ---------- 4. 前端 #region 段：有注入走注入，无注入走副本 ----------

test('前端 #region 段：有注入时覆盖三份副本，并同步 accept 与提示文案', () => {
  const region = sharedContractsRegion(pageHtml);
  const injection = {
    DATA_EXT: ['.sentinel', '.foo'],
    MAX_DATA_BYTES: 123 * 1024 * 1024,
    BL_PATTERNS: [{ source: 'zzz', flags: 'i' }],
  };
  const { out, dom } = runRegion(region, injection);
  assert.deepEqual(out.DATA_EXT, ['.sentinel', '.foo']);
  assert.equal(out.MAX_DATA_BYTES, 123 * 1024 * 1024);
  assert.equal(out.BL_PATTERNS.length, 1);
  assert.equal(out.BL_PATTERNS[0].source, 'zzz');
  assert.equal(out.BL_PATTERNS[0].flags, 'i');
  assert.equal(dom.byId['f-df-file'].attrs.accept, '.sentinel,.foo');
  assert.match(dom.byId['h-df-file'].textContent, /支持 \.sentinel \.foo；单文件上限 123MiB。/);
  assert.match(dom.guideText.nodeValue, /支持 \.sentinel \.foo，单文件上限 123MiB。/);
  assert.equal(dom.guideText.nodeValue.includes('.h5ad'), false, '旧扩展名应被替换掉');
});

test('前端 #region 段：无注入时保留字面量副本，不改写 DOM', () => {
  const region = sharedContractsRegion(pageHtml);
  const { out, dom } = runRegion(region, null);
  assert.deepEqual([...out.DATA_EXT], ['.h5ad', '.rdata']);
  assert.equal(out.MAX_DATA_BYTES, 5 * 1024 * 1024 * 1024);
  assert.equal(out.BL_PATTERNS.length, 1);
  assert.equal(dom.byId['f-df-file'].attrs.accept, undefined);
  assert.equal(dom.byId['h-df-file'].textContent, 'STATIC_HINT');
  assert.match(dom.guideText.nodeValue, /支持 \.h5ad \.rdata，单文件上限 5 GiB。/);
});

// ---------- 5. 其他端点不受注入影响 ----------

test('/health 仍 200 且字段不变', async () => {
  const res = await fetch(`${BASE}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, 'user-portal');
  assert.equal(body.auth_required, false);
});

test('/index.html 与 / 一样带注入，未知路径仍 404', async () => {
  const res = await fetch(`${BASE}/index.html`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.equal(html.includes(ANCHOR), false);
  assert.ok(html.includes('window.__SHARED_CONTRACTS__'));
  const missing = await fetch(`${BASE}/no-such-page`);
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), 'Not Found');
});

test('磁盘上的 index.html 仍保留注入锚点（服务端靠它工作）', () => {
  const disk = fs.readFileSync(INDEX_HTML, 'utf8');
  assert.ok(disk.includes(ANCHOR), 'index.html 缺少注入锚点注释');
  assert.ok(disk.includes('// #region P5 shared contracts'));
});
