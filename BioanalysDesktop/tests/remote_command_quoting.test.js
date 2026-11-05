// 远端命令引号化契约（T0-4 及其余震）。
//
// 背景：2026-11 全量审查 SV-01/SV-02 发现 diagnostics 的 dir 直接拼进 `if [ -d '${x}' ]`，
// 一个 ' 就能闭合引号接上任意命令。第一版只修了 diagnostics 三处，第三十二轮余震实测又抓到
// ledger_fetch.js 与 query_views.js 两处裸插值，真 bash 复现 injection_executed=true。
//
// 这条断言不看个别字符串，而是扫源码：凡 runRemote/runRemoteRaw/runRemoteStrict 的模板串，
// 每个插值必须整体过 shellQuote(...)，或属于显式声明的安全标识。这样新增漏网点会当场变红。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server');
const BT = String.fromCharCode(96);
const SERVED_FILES = [
  'ledger_fetch.js', 'query_views.js', 'task_input.js', 'task.js', 'run.js', 'pull.js', 'report.js',
  'routes/diagnostics.routes.js', 'routes/upload.routes.js', 'routes/figures.routes.js',
  'routes/tasks.routes.js', 'routes/report.routes.js', 'routes/projects.routes.js',
];

/** 不需要引号化的插值：要么是本地常量，要么是已被证明不含 shell 元字符的编码串。 */
const SAFE_INTERPOLATIONS = new Map([
  ['SYSTEM_LOGS', 'domain.js 的固定远端路径常量'],
  ['SHA256_REMOTE_ROOT', '固定远端路径常量'],
  ['payload', 'Buffer.toString(base64)，字符集 [A-Za-z0-9+/=]，不含引号与分隔符'],
]);

function remoteTemplates(text) {
  const out = [];
  const re = new RegExp('runRemote(?:Raw|Strict)?\\s*\\(' + BT + '((?:[^' + BT + '\\\\]|\\\\.)*)' + BT, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ line: text.slice(0, m.index).split('\n').length, template: m[1] });
  }
  return out;
}

function unsafeInterpolations(template) {
  const bad = [];
  const re = /\$\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(template)) !== null) {
    const inner = m[1].trim();
    if (/^shellQuote\(/.test(inner)) continue;
    if (SAFE_INTERPOLATIONS.has(inner)) continue;
    bad.push(inner);
  }
  return bad;
}

test('远端命令里凡来自请求的插值都必须过 shellQuote', () => {
  const violations = [];
  for (const rel of SERVED_FILES) {
    const file = path.join(SERVER, rel);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const item of remoteTemplates(text)) {
      const bad = unsafeInterpolations(item.template);
      if (bad.length > 0) violations.push(`${rel}:${item.line} -> ${bad.join(' | ')}`);
    }
  }
  assert.deepEqual(violations, [], `未加引号的远端插值: ${JSON.stringify(violations, null, 2)}`);
});

test('ledger_fetch 与 query_views 的余震点已显式引号化', () => {
  const cases = [
    ['ledger_fetch.js', /shellQuote\(logsDir\)/],
    // 单次往返改造后不再有逐个 remotePath 的拼接：远端用 "$f" 变量遍历，
    // 本地只注入一个已 shellQuote 的目录。断言改成「批量脚本里引号包住了 $f」。
    ['ledger_fetch.js', /\[ -f \\"\$f\\" \]/],
    ['query_views.js', /shellQuote\(guard\.dir\)/],
  ];
  for (const [rel, pattern] of cases) {
    const text = fs.readFileSync(path.join(SERVER, rel), 'utf8');
    assert.match(text, pattern, `${rel} 缺少 ${pattern}：引号化修复被回退了`);
  }
});

test('shellQuote 的转义形态：普通路径原样加引号，含单引号的路径按 POSIX 规则断开', async () => {
  const { shellQuote } = await import('../server/proc.js');

  // 不含单引号的普通路径：成对单引号包住，内容一字不改
  assert.equal(shellQuote('/mnt/ssd/bio_data/system_logs'), "'/mnt/ssd/bio_data/system_logs'");
  assert.equal(shellQuote('/tmp/a b/c.json'), "'/tmp/a b/c.json'");

  // 含单引号：只有 ' 这一处被断成 '\'' 四字符，其余原样保留
  const tricky = "/mnt/x/it's";
  assert.equal(shellQuote(tricky), "'/mnt/x/it'\\''s'");
  assert.equal(shellQuote(tricky).split("'\\''").length - 1, 1, '只断开一次，不能多也不能少');

  // 引号闭合权被没收：载荷里的 ; 与空格都留在同一个词里
  const payload = "/mnt/x'; touch /tmp/pwned; echo '";
  const quoted = shellQuote(payload);
  assert.ok(quoted.indexOf("; touch") > 0, '载荷必须完整留在引号段内部');
  assert.equal(quoted.split("'\\''").length - 1, 2, '载荷里两处单引号各断一次');
});