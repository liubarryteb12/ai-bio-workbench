/**
 * P7 回归：单文件出版级 HTML 报告渲染器（ops/render_report_html.py）。
 *
 * 覆盖（aims v2.5 七.3「项目报告双模态交付」）：
 *   1. 正常渲染：退出码 0、产物非空、含 doctype/style/目录锚点；
 *   2. 零外部依赖：无 <link>、无外链 <script src>、无 <img>/<iframe>、无 CSS url()/@import；
 *   3. 安全：Markdown 里的原始 HTML 与事件属性一律转义成文本；非白名单协议降级为纯文本；
 *   4. 白名单语法：表格 / 围栏代码块 / 行内代码 / 粗体 / 斜体 / 有序无序列表 / 引用块；
 *   5. 退出码契约：缺 manifest、缺 md、空白 md、目录不存在一律 exit 2；
 *   6. 其它：--out 自定义路径、--self-test、--version、UTF-8 中文不乱码、产物 LF 换行。
 *
 * 用真实 python 子进程跑脚本，fixture 全是临时目录自造，不依赖远端、不依赖已有交付包。
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'ops', 'render_report_html.py');
const ENV = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
const FENCE = String.fromCharCode(96, 96, 96);

function detectPython() {
  const candidates = process.env.PYTHON ? [process.env.PYTHON] : ['python3', 'python'];
  for (const candidate of candidates) {
    const probe = spawnSync(
      candidate,
      ['-c', 'import sys; sys.stdout.write(str(sys.version_info[0]))'],
      { encoding: 'utf8', env: ENV },
    );
    if (!probe.error && probe.status === 0 && probe.stdout.trim() === '3') return candidate;
  }
  return null;
}

const PY = detectPython();
const SKIP = PY ? false : '本机没有可用的 python3/python，跳过 HTML 渲染器用例';

const TEMP_DIRS = [];
function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TEMP_DIRS.push(dir);
  return dir;
}

function runScript(args, options = {}) {
  const result = spawnSync(PY, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: ENV,
    timeout: 120000,
    ...options,
  });
  return {
    code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error,
  };
}

const DEFAULT_MANIFEST = {
  package_version: '1.0',
  project_id: 'PRJ_P7',
  project_name: 'P7 自检项目',
  generated_at: '2026-10-21 18:00:00',
  sections: ['第一章 数据与方法', '第二章 结果'],
};

const SAMPLE_MD = [
  '# PRJ_P7 · 客户交付解读报告',
  '',
  '> 本报告由脚本自动生成，所有统计量读自磁盘文件。',
  '',
  '## 第一章 数据与方法',
  '',
  '样本量 **12** 例，阈值 ' + String.fromCharCode(96) + 'padj < 0.05' + String.fromCharCode(96) + '，基因 *IL17A* 显著上调。',
  '',
  '| 基因 | logFC | padj |',
  '|---|---|---:|',
  '| IL17A | 2.5 | 0.01 |',
  '| S100A8 | -1.8 | 0.02 |',
  '',
  '### 分析步骤',
  '',
  '- 质控',
  '- 差异分析',
  '',
  '1. 先跑质控',
  '2. 再跑差异分析',
  '',
  FENCE + 'bash',
  'Rscript --vanilla deg_limma.R',
  'echo done',
  FENCE,
  '',
  '外链 [官网](https://example.org/a?x=1&y=2)、[邮件](mailto:bio@example.org)、[坏链](javascript:alert(1))。',
  '',
  '## 第二章 结果',
  '',
  '差异表达基因共 2 个。',
  '',
].join('\n');

function makeDelivery({ md = SAMPLE_MD, manifest = DEFAULT_MANIFEST } = {}) {
  const dir = tmpDir('p7-html-');
  if (manifest !== null) {
    const body = typeof manifest === 'string' ? manifest : JSON.stringify(manifest, null, 2);
    fs.writeFileSync(path.join(dir, 'delivery_manifest.json'), body, 'utf8');
  }
  if (md !== null) fs.writeFileSync(path.join(dir, 'Analysis_Report.md'), md, 'utf8');
  return dir;
}

const RESOURCE_PATTERNS = [
  [/<link\b/i, '<link> 标签'],
  [/<script\b[^>]*\bsrc\s*=/i, '外链 <script src>'],
  [/<img\b/i, '<img> 标签'],
  [/<iframe\b/i, '<iframe> 标签'],
  [/<object\b/i, '<object> 标签'],
  [/<embed\b/i, '<embed> 标签'],
  [/<source\b/i, '<source> 标签'],
  [/@import\b/i, '@import 规则'],
  [/url\(\s*['"]?(?:https?:)?\/\//i, 'CSS url(...) 引用'],
];

after(() => {
  for (const dir of TEMP_DIRS) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 临时目录清不掉不影响结论 */
    }
  }
});

test('正常渲染：exit 0，产物非空且含 doctype / style / 目录锚点', { skip: SKIP }, () => {
  const dir = makeDelivery();
  const result = runScript(['--delivery-dir', dir]);
  assert.equal(result.code, 0, result.stderr);
  const out = path.join(dir, 'Analysis_Report.html');
  assert.ok(fs.existsSync(out), '默认输出 Analysis_Report.html 应存在');
  const page = fs.readFileSync(out, 'utf8');
  assert.ok(page.length > 2000, '产物应非空，实际 ' + page.length + ' 字符');
  assert.ok(page.startsWith('<!doctype html>'), '应以 doctype 开头');
  assert.ok(page.includes('<style>'), '应内联 <style>');
  assert.ok(page.includes('id="toc"'), '应有目录容器');
  assert.match(result.stdout, /已渲染/);
});

test('零外部依赖：产物不含任何资源引用', { skip: SKIP }, () => {
  const dir = makeDelivery();
  const result = runScript(['--delivery-dir', dir]);
  assert.equal(result.code, 0, result.stderr);
  const page = fs.readFileSync(path.join(dir, 'Analysis_Report.html'), 'utf8');
  for (const [pattern, label] of RESOURCE_PATTERNS) {
    assert.ok(!pattern.test(page), '不应出现 ' + label);
  }
});

test('正文里的 http(s) 超链接保留为可点击，但不被当成资源引用', { skip: SKIP }, () => {
  const dir = makeDelivery();
  assert.equal(runScript(['--delivery-dir', dir]).code, 0);
  const page = fs.readFileSync(path.join(dir, 'Analysis_Report.html'), 'utf8');
  assert.ok(
    page.includes('<a href="https://example.org/a?x=1&amp;y=2"'),
    'https 链接应保留为 <a>，且 & 已转义成 &amp;',
  );
  assert.ok(page.includes('rel="noopener noreferrer"'), '外链应带 rel=noopener noreferrer');
});

test('安全：<script>alert(1)</script> 渲染成文本而非标签', { skip: SKIP }, () => {
  const dir = makeDelivery({
    md: ['## 攻击面', '', '<script>alert(1)</script>', ''].join('\n'),
  });
  assert.equal(runScript(['--delivery-dir', dir]).code, 0);
  const page = fs.readFileSync(path.join(dir, 'Analysis_Report.html'), 'utf8');
  assert.ok(!page.includes('<script>alert(1)</script>'), '不得出现可执行的 script 标签');
  assert.ok(
    page.includes('&lt;script&gt;alert(1)&lt;/script&gt;'),
    '应转义成文本实体',
  );
});

test('安全：事件属性 <img src=x onerror=...> 渲染成文本', { skip: SKIP }, () => {
  const dir = makeDelivery({
    md: ['## 攻击面', '', '<img src=x onerror=alert(1)>', ''].join('\n'),
  });
  assert.equal(runScript(['--delivery-dir', dir]).code, 0);
  const page = fs.readFileSync(path.join(dir, 'Analysis_Report.html'), 'utf8');
  assert.ok(!page.toLowerCase().includes('<img'), '不得出现 img 标签');
  assert.ok(page.includes('&lt;img src=x onerror=alert(1)&gt;'), '应整体转义成文本');
});

test('表格：thead/tbody 齐备且斑马纹样式在 CSS 里', { skip: SKIP }, () => {
  const dir = makeDelivery();
  assert.equal(runScript(['--delivery-dir', dir]).code, 0);
  const page = fs.readFileSync(path.join(dir, 'Analysis_Report.html'), 'utf8');
  assert.ok(page.includes('<div class="table-wrap"><table><thead><tr>'), '表格应有横向滚动容器');
  assert.ok(page.includes('<th>基因</th>'), '表头应渲染');
  assert.ok(page.includes('<td>IL17A</td>'), '表体应渲染');
  assert.ok(page.includes('tbody tr:nth-child(even)'), '斑马纹规则应在内联 CSS 里');
  assert.ok(page.includes('style="text-align:right"'), '右对齐列应带对齐样式');
});

test('代码块：<pre class="code-block"> + language 类 + 原文不被改写', { skip: SKIP }, () => {
  const dir = makeDelivery();
  assert.equal(runScript(['--delivery-dir', dir]).code, 0);
  const page = fs.readFileSync(path.join(dir, 'Analysis_Report.html'), 'utf8');
  assert.ok(
    page.includes('<pre class="code-block"><code class="language-bash">Rscript --vanilla deg_limma.R'),
    '围栏代码块应带语言类且保留原文',
  );
  assert.ok(page.includes('echo done'), '代码块第二行应保留');
});

test('行内语法：行内代码 / 粗体 / 斜体', { skip: SKIP }, () => {
  const dir = makeDelivery();
  assert.equal(runScript(['--delivery-dir', dir]).code, 0);
  const page = fs.readFileSync(path.join(dir, 'Analysis_Report.html'), 'utf8');
  assert.ok(page.includes('<code>padj &lt; 0.05</code>'), '行内代码应转义并渲染');
  assert.ok(page.includes('<strong>12</strong>'), '粗体应渲染');
  assert.ok(page.includes('<em>IL17A</em>'), '斜体应渲染');
});

test('退出码：缺 delivery_manifest.json 时 exit 2 且不写产物', { skip: SKIP }, () => {
  const dir = makeDelivery({ manifest: null });
  const result = runScript(['--delivery-dir', dir]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /缺少交付清单/);
  assert.ok(!fs.existsSync(path.join(dir, 'Analysis_Report.html')), '失败时不应落盘');
});

test('退出码：缺 Analysis_Report.md 时 exit 2', { skip: SKIP }, () => {
  const dir = makeDelivery({ md: null });
  const result = runScript(['--delivery-dir', dir]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /缺少报告正文/);
});

test('退出码：md 只有空白时 exit 2', { skip: SKIP }, () => {
  const dir = makeDelivery({ md: '   \n\n\t\n' });
  const result = runScript(['--delivery-dir', dir]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /报告正文为空/);
});

test('退出码：交付目录不存在时 exit 2', { skip: SKIP }, () => {
  const missing = path.join(os.tmpdir(), 'p7-no-such-dir-' + Date.now());
  const result = runScript(['--delivery-dir', missing]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /交付目录不存在/);
});

test('--out 自定义路径生效，默认路径不生成', { skip: SKIP }, () => {
  const dir = makeDelivery();
  const outDir = tmpDir('p7-html-out-');
  const custom = path.join(outDir, 'nested', 'report.html');
  const result = runScript(['--delivery-dir', dir, '--out', custom]);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(fs.existsSync(custom), '自定义输出应存在');
  assert.ok(fs.statSync(custom).size > 2000, '自定义输出应非空');
  assert.ok(!fs.existsSync(path.join(dir, 'Analysis_Report.html')), '不应再写默认路径');
});

test('--self-test 内建用例全过（exit 0）', { skip: SKIP }, () => {
  const result = runScript(['--self-test']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /全部符合预期/);
  assert.ok(!/FAIL \|/.test(result.stdout), '自检不应出现 FAIL 行');
});

test('--version 打印脚本版本且 exit 0', { skip: SKIP }, () => {
  const result = runScript(['--version']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /render_report_html\.py 1\.0\.0/);
});

test('中文不乱码且产物为 LF 换行（UTF-8 声明齐备）', { skip: SKIP }, () => {
  const dir = makeDelivery();
  assert.equal(runScript(['--delivery-dir', dir]).code, 0);
  const buffer = fs.readFileSync(path.join(dir, 'Analysis_Report.html'));
  assert.ok(buffer.includes(Buffer.from('<meta charset="utf-8">', 'utf8')), '应有 UTF-8 声明');
  assert.equal(buffer.indexOf(13), -1, '产物不应含 CR，必须 LF');
  const page = buffer.toString('utf8');
  assert.ok(page.includes('第一章 数据与方法'), '中文标题应原样保留');
  assert.ok(page.includes('差异表达基因共 2 个'), '中文正文应原样保留');
  assert.ok(page.includes('客户交付解读报告'), '中文报告名应原样保留');
});

test('链接白名单：javascript: 降级为纯文本，mailto 保留', { skip: SKIP }, () => {
  const dir = makeDelivery();
  assert.equal(runScript(['--delivery-dir', dir]).code, 0);
  const page = fs.readFileSync(path.join(dir, 'Analysis_Report.html'), 'utf8');
  assert.ok(!page.includes('href="javascript:'), '不得输出 javascript: href');
  assert.ok(page.includes('<a href="mailto:bio@example.org"'), 'mailto 应保留');
});

test('打印友好：@media print 存在，页脚写生成时间与脚本版本', { skip: SKIP }, () => {
  const dir = makeDelivery();
  assert.equal(runScript(['--delivery-dir', dir]).code, 0);
  const page = fs.readFileSync(path.join(dir, 'Analysis_Report.html'), 'utf8');
  assert.ok(page.includes('@media print'), '应有打印样式');
  assert.ok(page.includes('break-inside:avoid'), '打印时应避免表格/代码块跨页断裂');
  assert.ok(page.includes('生成时间：'), '页脚应有生成时间');
  assert.ok(page.includes('render_report_html.py v1.0.0'), '页脚应有脚本版本');
});

test('清单字段进页头：项目 ID / 项目名 / 报告生成时间', { skip: SKIP }, () => {
  const dir = makeDelivery();
  assert.equal(runScript(['--delivery-dir', dir]).code, 0);
  const page = fs.readFileSync(path.join(dir, 'Analysis_Report.html'), 'utf8');
  assert.ok(page.includes('<h1>P7 自检项目</h1>'), '标题应取清单 project_name');
  assert.ok(page.includes('项目 ID：PRJ_P7'), '页头应写项目 ID');
  assert.ok(page.includes('报告生成时间：2026-10-21 18:00:00'), '页头应写清单生成时间');
  assert.ok(page.includes('清单版本：1.0'), '页头应写清单版本');
});

test('目录锚点与正文 h2 id 一一对应', { skip: SKIP }, () => {
  const dir = makeDelivery();
  assert.equal(runScript(['--delivery-dir', dir]).code, 0);
  const page = fs.readFileSync(path.join(dir, 'Analysis_Report.html'), 'utf8');
  const tocHrefs = [...page.matchAll(/<li><a href="#(sec-[^"]+)"/g)].map((m) => m[1]);
  const h2Ids = [...page.matchAll(/<h2 id="(sec-[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tocHrefs, h2Ids, '目录链接应与 h2 id 完全一致');
  assert.equal(h2Ids.length, 2, '样例有两个二级标题');
});

test('Markdown 自带的目录段被丢弃，不产生死锚点', { skip: SKIP }, () => {
  const md = [
    '## 目录',
    '',
    '1. [第一章 数据与方法](#第一章-数据与方法)',
    '2. [第二章 结果](#第二章-结果)',
    '',
    '## 第一章 数据与方法',
    '',
    '正文一。',
    '',
    '## 第二章 结果',
    '',
    '正文二。',
    '',
  ].join('\n');
  const dir = makeDelivery({ md });
  assert.equal(runScript(['--delivery-dir', dir]).code, 0);
  const page = fs.readFileSync(path.join(dir, 'Analysis_Report.html'), 'utf8');
  const bodyH2 = [...page.matchAll(/<h2 id="(sec-[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(bodyH2, ['sec-第一章-数据与方法', 'sec-第二章-结果'], '正文只留两章，原文目录标题被丢弃');
  assert.ok(!page.includes('href="#第'), '原文目录指向旧锚点的死链不应出现');
  assert.ok(page.includes('正文一。') && page.includes('正文二。'), '正文内容不受影响');
});

test('文内锚点链接降级为纯文本（锚点由渲染器统一生成）', { skip: SKIP }, () => {
  const md = ['# 报告', '', '见 [第三章](#第三章-结论) 一节。', ''].join('\n');
  const dir = makeDelivery({ md });
  assert.equal(runScript(['--delivery-dir', dir]).code, 0);
  const page = fs.readFileSync(path.join(dir, 'Analysis_Report.html'), 'utf8');
  assert.ok(!page.includes('href="#第三章'), '原文锚点不应保留成死链');
  assert.ok(page.includes('见 第三章 一节。'), '链接文字降级为纯文本');
});

test('清单不是合法 JSON 时 exit 2', { skip: SKIP }, () => {
  const dir = makeDelivery({ manifest: '{ not json' });
  const result = runScript(['--delivery-dir', dir]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /不是合法 JSON/);
});
