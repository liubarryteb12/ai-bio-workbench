import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, renderFiguresPreview } from '../server/portal_page.js';

// ── portal_page.js 契约面测试（2026-11-03，4 Argon 第十八轮 P2 收尾）──
//
// 这是 8080 客户门户里唯一「服务端直接拼 HTML」的页面（出图预览），
// 输入全部来自客户项目数据（项目名、文件名、图注），所以它的核心承诺是：
// 任何字段进 HTML 之前都必须先过 escapeHtml，URL 参数必须 encodeURIComponent。
//
// 三条边界按实现写死（不是按我的想象）：
// 1. escapeHtml 只转义 & < > " 四个；单引号不转义，因为所有属性都用双引号包裹。
// 2. & 必须第一个替换，否则后面会把自己的转义结果再转一次。
// 3. 非字符串走 String()，null/undefined 变成字面量 "null"/"undefined"。

const section = (over) => ({ lineId: 'line1_bulk', blocked: false, figures: [], ...over });

test('escapeHtml 只转义四个字符，且 & 先替换（二次转义会被抓出来）', () => {
  assert.equal(escapeHtml('&'), '&amp;');
  assert.equal(escapeHtml('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;');
  assert.equal(escapeHtml('a&b<c>d"e'), 'a&amp;b&lt;c&gt;d&quot;e');
  assert.equal(escapeHtml("it's"), "it's");
  assert.equal(escapeHtml(0), '0');
  assert.equal(escapeHtml(null), 'null');
  assert.equal(escapeHtml(undefined), 'undefined');
});

test('页面骨架：doctype、语言、标题、项目名与总张数都在头部', () => {
  const html = renderFiguresPreview([
    section({ figures: [{ name: 'a.png', sizeLabel: '1 MB' }, { name: 'b.png' }] }),
    section({ lineId: 'line2_scrna', figures: [{ name: 'c.png' }] }),
  ], 'PRJ_X');
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.match(html, /<html lang="zh">/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<title>BioanalysDesktop · 出图预览<\/title>/);
  assert.match(html, /项目 PRJ_X · 共 3 张/);
});

test('三条线的中文标签齐全，未登记的 lineId 原样回退而不是显示 undefined', () => {
  const html = renderFiguresPreview([
    section({ lineId: 'line1_bulk', figures: [{ name: 'a.png' }] }),
    section({ lineId: 'line2_scrna', figures: [{ name: 'b.png' }] }),
    section({ lineId: 'line3_spatial', figures: [{ name: 'c.png' }] }),
    section({ lineId: 'line9_mystery', figures: [{ name: 'd.png' }] }),
  ], 'PRJ_X');
  assert.match(html, /线1 \/ GEO bulk/);
  assert.match(html, /线2 \/ 单细胞转录组/);
  assert.match(html, /线3 \/ 空间转录组/);
  assert.match(html, /line9_mystery/);
  assert.equal(html.includes('undefined'), false);
});

test('图卡 URL 三段参数都 encodeURIComponent，文件名里的空格与 & 不会截断查询串', () => {
  const name = 'deg sig&v2.png';
  const html = renderFiguresPreview([section({ figures: [{ name }] })], 'PRJ X');
  const encodedName = encodeURIComponent(name);
  const encodedProject = encodeURIComponent('PRJ X');
  assert.equal(encodedName, 'deg%20sig%26v2.png');
  assert.ok(html.includes('/api/figures/image?project=' + encodedProject + '&line=line1_bulk&name=' + encodedName));
  assert.equal(html.split(name).length - 1, 0, '原始文件名不得直接出现在 HTML 里');
});

test('图注与体积是可选字段：缺省时不产出空标签', () => {
  const withAll = renderFiguresPreview([section({ figures: [{ name: 'a.png', caption: '火山图', sizeLabel: '2 MB' }] })], 'PRJ_X');
  assert.match(withAll, /<div class="cap">火山图<\/div>/);
  assert.match(withAll, /<span class="sz">2 MB<\/span>/);

  const min = renderFiguresPreview([section({ figures: [{ name: 'a.png' }] })], 'PRJ_X');
  assert.equal(min.includes('class="cap"'), false);
  assert.match(min, /<span class="sz"><\/span>/);
});

test('阻塞段与空段给出各自的可读原因，都不渲染 grid', () => {
  const blocked = renderFiguresPreview([
    section({ blocked: true, reason: 'SSD 未挂载', figures: null }),
    section({ lineId: 'line2_scrna', figures: [] }),
  ], 'PRJ_X');
  assert.match(blocked, /<p class="empty">SSD 未挂载<\/p>/);
  assert.match(blocked, /<p class="empty">该线 figures\/ 暂无图件<\/p>/);
  assert.equal(blocked.includes('class="grid"'), false);
  assert.match(blocked, /共 0 张/);
});

test('source 标签只在 local/remote 时出现，未回搬时要明确告知客户', () => {
  const local = renderFiguresPreview([section({ source: 'local', figures: [{ name: 'a.png' }] })], 'PRJ_X');
  assert.match(local, /（1 张 · 本地副本）/);

  const remote = renderFiguresPreview([section({ source: 'remote', figures: [{ name: 'a.png' }] })], 'PRJ_X');
  assert.match(remote, /（1 张 · 远端实时（尚未回搬））/);

  const plain = renderFiguresPreview([section({ figures: [{ name: 'a.png' }] })], 'PRJ_X');
  assert.match(plain, /（1 张）/);
  assert.equal(plain.includes('本地副本'), false);
});

test('XSS 面：文件名与项目名里的标签一律转义成文本，不产生可执行节点', () => {
  const name = '<script>alert(1)</script>.png';
  const html = renderFiguresPreview([section({ figures: [{ name, caption: '<img src=x onerror=alert(1)>' }] })], '<b>PRJ</b>');
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<img src=x'), false);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;.png'));
  assert.match(html, /项目 &lt;b&gt;PRJ&lt;\/b&gt;/);
  assert.ok(html.includes('alt="&lt;script&gt;alert(1)&lt;/script&gt;.png"'));
});
