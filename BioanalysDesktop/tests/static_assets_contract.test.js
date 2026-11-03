import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { serveStatic } from '../server/static_assets.js';

// ── static_assets.js 契约面测试（2026-11-03，4 Argon 第十八轮第二梯队 P1）──
//
// 它直接暴露在 18787 管理台的 HTTP 文件服务边界上，核心承诺是
// 「只服务 dist/ 内的文件」。本轮先探针实测，发现只查字面 '..' 是不够的：
// WHATWG URL 会把 %2E%2E 规范化成真实上跳段，/%2E%2E/package.json 实测
// 读到了 dist 之外的文件内容。修复后本文件同时钉住攻击面与合法面。
//
// mock 必须是真 Writable：res 不是流时 pipe() 会同步抛错，被实现里的
// catch 吞掉后走到 404 分支，造成「合法文件也 404」的假象（实测踩过）。

function makeRes() {
  const cap = { status: null, headers: null, chunks: [], ended: false };
  const w = new Writable({
    write(chunk, enc, cb) { cap.chunks.push(Buffer.from(chunk)); cb(); },
    final(cb) { cap.ended = true; cb(); },
  });
  w.writeHead = (status, headers) => { cap.status = status; cap.headers = headers; return w; };
  w.end = (b) => {
    if (b) cap.chunks.push(Buffer.from(String(b)));
    cap.ended = true;
    return w;
  };
  return { w, cap };
}

async function serve(pathname) {
  const { w, cap } = makeRes();
  serveStatic(w, pathname);
  // createReadStream 是异步的，等一拍让 pipe 落数据
  await new Promise((resolve) => setTimeout(resolve, 250));
  return cap;
}

const bodyOf = (cap) => Buffer.concat(cap.chunks).toString('utf8');

test('目录穿越攻击面全部拒绝：字面、编码、混合、深层写法一律 400 且不泄漏文件', async () => {
  const attacks = [
    '/../package.json',
    '/%2E%2E/package.json',
    '/%2e%2e/package.json',
    '/..%2fpackage.json',
    '/a/../../package.json',
    '/%2E%2E/%2E%2E/package.json',
  ];
  for (const pathname of attacks) {
    const cap = await serve(pathname);
    assert.equal(cap.status, 400, pathname + ' 必须 400，实际 ' + cap.status);
    assert.match(bodyOf(cap), /非法路径/, pathname + ' 必须回非法路径错误');
    assert.equal(bodyOf(cap).includes('"name"'), false,
      pathname + ' 泄漏了 dist 之外的文件内容');
  }
});

test('空字节注入拒绝', async () => {
  const cap = await serve('/index.html%00.png');
  assert.equal(cap.status, 400, '空字节必须 400，实际 ' + cap.status);
});

test('合法服务：index.html 返回 200 且 Content-Type 是 text/html', async () => {
  const cap = await serve('/index.html');
  assert.equal(cap.status, 200, 'body=' + bodyOf(cap).slice(0, 80));
  assert.equal(cap.headers['Content-Type'], 'text/html; charset=utf-8');
  assert.ok(bodyOf(cap).length > 0, '必须读到非空内容');
});

test('安全响应头齐备：nosniff 与 no-cache 不得缺席', async () => {
  const cap = await serve('/index.html');
  assert.equal(cap.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(cap.headers['Cache-Control'], 'no-cache');
});

test('根路径落到 index.html（空 pathname 语义）', async () => {
  const cap = await serve('/');
  assert.equal(cap.status, 200);
  assert.match(bodyOf(cap), /<!doctype html>/i);
});

test('未知文件 404 且错误信息带原路径便于排查', async () => {
  const cap = await serve('/no_such_file_zzz.png');
  assert.equal(cap.status, 404);
  assert.match(bodyOf(cap), /静态资源未找到/);
  assert.match(bodyOf(cap), /no_such_file_zzz/);
});

test('未知扩展名不猜 MIME，落到 octet-stream 防误渲染', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const dist = path.join(fileURLToPath(new URL('../dist/', import.meta.url)), 'zz_probe.unknownext');
  fs.writeFileSync(dist, 'probe-payload');
  try {
    const cap = await serve('/zz_probe.unknownext');
    assert.equal(cap.status, 200);
    assert.equal(cap.headers['Content-Type'], 'application/octet-stream');
  } finally {
    fs.rmSync(dist, { force: true });
  }
});

// ── 兜底包含性校验的结构断言 ──
//
// 这条是纵深防御的第二层：先解码查 '..' 与 NUL，再对 resolve 结果做 dist 根包含性检查。
// 当前没有输入能只绕过第一层而撞上第二层（编码上跳段在解码后必然含 '..'），
// 所以删掉第二层时行为测试仍全绿——这是诚实的结论，不是测试漏了。
// 因此这里用结构断言钉住它存在：将来若有人削弱第一层（比如改成只查字面串），
// 第二层仍在，越界路径会被 continue 掉而不是直接读盘。
test('解析结果必须做 dist 根包含性校验（纵深防御第二层不得缺席）', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const src = fs.readFileSync(
    new URL('../server/static_assets.js', import.meta.url),
    'utf8',
  );
  // 用字符串包含而不是正则：这些片段里全是括号与点号，正则转义极易写错
  // （实测 /path.resolve(filePath)/ 因括号未转义恒为 false，把对的代码判成缺防护）。
  assert.ok(src.includes('path.resolve(filePath)'), '必须对解析结果做 path.resolve');
  assert.ok(src.includes('distRoot + path.sep'), '必须校验路径仍在 dist 根内');
  assert.ok(src.includes('continue;'), '越界候选必须跳过而不是读盘');
  // 第一层：解码后检查，而不是只查原始串
  assert.ok(src.includes('decodeURIComponent(rel)'), '必须先解码再检查');
  assert.ok(src.includes("decoded.includes('..')"), '解码结果必须查 ..');
  assert.ok(src.includes("'\\0'"), '必须拒绝空字节');
});

