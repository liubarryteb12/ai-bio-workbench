/**
 * task-8：.uploads 总量配额（phase 2）+ 上传链路错误体统一 测试。
 *
 * 覆盖：
 *   A. uploadQuotaBytes：默认 20GiB、BIO_UPLOAD_QUOTA_BYTES 覆盖、非法值回落默认。
 *   B. gcStaleUploads phase 1（TTL）不回退：删旧留新、边界不删、非法目录名不碰、
 *      单目录 stat/rm 失败只记 errors、报告九键齐备。
 *   C. gcStaleUploads phase 2（配额）：最旧优先淘汰、活跃会话不淘汰且单列 active、
 *      清完仍超配额 overQuota=true、淘汰 rm 失败只记 errors、测量失败按 0 字节记 errors、
 *      真临时 root 按真实文件字节求和、maybeGcStaleUploads 透传 quotaBytes。
 *   D. 真 HTTP：init 在 overQuota 时回 507 + {ok:false,error} 且错误体含字节数；
 *      四个上传端点的 4xx 错误体统一为 {ok:false,error}（非空字符串）；
 *      成功响应体不变（status 200 not_found 仍带 received/ok:false）。
 *
 * 口径：
 *   - phase 2 测试一律注入临时 root / 假 fs，绝不对共享的 .uploads 真根跑小配额清理。
 *   - D 段 childProcess 全部垫片（spawnSync/spawn），断言 childCalls.length === 0 才算离线。
 */
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';

import {
  DEFAULT_UPLOAD_QUOTA_BYTES, GC_MIN_INTERVAL_MS, UPLOAD_ROOT,
  gcStaleUploads, maybeGcStaleUploads, resetUploadGcThrottle, uploadQuotaBytes,
} from '../server/upload.js';
import { isSafeUploadId } from '../../shared/upload_session.mjs';

const quiet = { log() {}, warn() {}, error() {} };

// ============================================================
// A. 配额常量与 env 解析
// ============================================================

test('A: 默认配额 20GiB（20*1024^3 = 21474836480）', () => {
  assert.equal(DEFAULT_UPLOAD_QUOTA_BYTES, 20 * 1024 * 1024 * 1024);
  assert.equal(DEFAULT_UPLOAD_QUOTA_BYTES, 21474836480);
});

test('A: uploadQuotaBytes 无 env 回落默认', () => {
  assert.equal(uploadQuotaBytes({}), DEFAULT_UPLOAD_QUOTA_BYTES);
  assert.equal(uploadQuotaBytes(undefined), DEFAULT_UPLOAD_QUOTA_BYTES);
});

test('A: uploadQuotaBytes 合法 env 覆盖（含小数四舍五入）', () => {
  assert.equal(uploadQuotaBytes({ BIO_UPLOAD_QUOTA_BYTES: '1024' }), 1024);
  assert.equal(uploadQuotaBytes({ BIO_UPLOAD_QUOTA_BYTES: '1073741824' }), 1073741824);
  assert.equal(uploadQuotaBytes({ BIO_UPLOAD_QUOTA_BYTES: '1024.6' }), 1025);
});

test('A: uploadQuotaBytes 非法值回落默认（空串/非数字/负数/NaN/Infinity/超范围）', () => {
  for (const bad of ['', '   ', 'abc', '-1', 'NaN', 'Infinity', '-Infinity', '1e999', null, undefined]) {
    assert.equal(uploadQuotaBytes({ BIO_UPLOAD_QUOTA_BYTES: bad }), DEFAULT_UPLOAD_QUOTA_BYTES, 'bad=' + String(bad));
  }
});

test('A: uploadQuotaBytes 允许 0（一个会话都不收）这是显式配置而非非法值', () => {
  assert.equal(uploadQuotaBytes({ BIO_UPLOAD_QUOTA_BYTES: '0' }), 0);
});

// ============================================================
// B. phase 1（TTL）不回退
// ============================================================

/** 会话规格：{ name, mtimeMs, bytes }，bytes=0 时不给它造任何文件 */
function specFs(items, options = {}) {
  const root = options.root || '/fake/root';
  const statErrors = options.statErrors || {};
  const rmErrors = options.rmErrors || {};
  const sessionReadErrors = options.sessionReadErrors || {};
  const removed = [];
  return {
    root,
    removed,
    readdirSync(dir, opts) {
      if (String(dir) === root) {
        if (options.readdirError) throw options.readdirError;
        return items.map((item) => ({
          name: item.name,
          isDirectory: () => true,
          isFile: () => false,
        }));
      }
      const name = path.basename(String(dir));
      if (sessionReadErrors[name]) throw sessionReadErrors[name];
      const item = items.find((entry) => entry.name === name);
      const size = Number(item?.bytes || 0);
      if (size <= 0) return [];
      return [{ name: '0.part', isDirectory: () => false, isFile: () => true, size }];
    },
    statSync(target) {
      const str = String(target);
      const hit = statErrors[str];
      if (hit) throw hit;
      const name = path.basename(str);
      const item = items.find((entry) => entry.name === name);
      if (item) return { mtimeMs: item.mtimeMs, size: Number(item.bytes || 0), isDirectory: () => true };
      // 会话内文件
      for (const entry of items) {
        if (str === path.join(root, entry.name, '0.part')) {
          return { size: Number(entry.bytes || 0), isDirectory: () => false, isFile: () => true };
        }
      }
      throw new Error('unexpected stat: ' + str);
    },
    rmSync(target) {
      const str = String(target);
      for (const [suffix, err] of Object.entries(rmErrors)) {
        if (str.endsWith(suffix)) throw err;
      }
      removed.push(str);
    },
  };
}

test('B: TTL 语义不变：超过 ttl 删、age===ttl 留、点段/含分隔符/非目录不碰', () => {
  const now = 1000000;
  const impl = specFs([
    { name: 'up-old', mtimeMs: now - 1001, bytes: 0 },
    { name: 'up-boundary', mtimeMs: now - 1000, bytes: 0 },
    { name: 'up-fresh', mtimeMs: now - 10, bytes: 0 },
  ]);
  // 追加不可扫的项：用另一个 fs 的 entries 顺序不便注入，这里改用原始 readdir 覆盖太难，
  // 所以非法名与 stray 文件在本用例里靠 isSafeUploadId 单测 + 下面的专项用例覆盖。
  const report = gcStaleUploads({ root: impl.root, now, ttlMs: 1000, quotaBytes: DEFAULT_UPLOAD_QUOTA_BYTES, fsImpl: impl, logger: quiet });
  assert.deepEqual(report.removed, ['up-old']);
  assert.deepEqual([...report.kept].sort(), ['up-boundary', 'up-fresh']);
  assert.equal(report.kept.length, 2);
  assert.equal(report.scanned, 3);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.evicted, []);
  assert.equal(report.totalBytes, 0);
  assert.equal(report.overQuota, false);
  assert.equal(report.quotaBytes, DEFAULT_UPLOAD_QUOTA_BYTES);
  assert.deepEqual([...report.active].sort(), ['up-boundary', 'up-fresh'],
    '两个幸存会话的 mtime 都在 GC_MIN_INTERVAL_MS 之内 => 视为活跃，active 与 kept 一致');
});

test('B: 非法目录名（点段/含分隔符/隐藏名）与散落文件一律不碰', () => {
  const now = 1000000;
  const root = '/fake/root';
  const entries = [
    { name: 'up-keep', isDirectory: () => true, isFile: () => false },
    { name: '..', isDirectory: () => true, isFile: () => false },
    { name: 'a/b', isDirectory: () => true, isFile: () => false },
    { name: '.hidden', isDirectory: () => true, isFile: () => false },
    { name: 'stray.txt', isDirectory: () => false, isFile: () => true },
  ];
  const impl = {
    removed: [],
    readdirSync: (dir) => (String(dir) === root ? entries : []),
    statSync: (target) => {
      if (String(target) === path.join(root, 'up-keep')) return { mtimeMs: now - 10, size: 0 };
      if (String(target) === path.join(root, 'stray.txt')) return { mtimeMs: now - 99999, size: 5 };
      throw new Error('unexpected stat: ' + target);
    },
    rmSync(target) { this.removed.push(String(target)); },
  };
  const report = gcStaleUploads({ root, now, ttlMs: 1000, fsImpl: impl, logger: quiet });
  assert.equal(report.scanned, 1, '只有合法会话名计入 scanned');
  assert.deepEqual(report.removed, []);
  assert.deepEqual(report.kept, ['up-keep']);
  assert.equal(impl.removed.length, 0, '非法名/散落文件绝不删');
});

test('B: UPLOAD_ROOT 不存在：正常空状态，且报告九键齐备', () => {
  const missing = path.join(os.tmpdir(), 'bio-upload-quota-missing-' + process.pid + '-' + Date.now());
  const report = gcStaleUploads({ root: missing, now: Date.now(), ttlMs: 1000, quotaBytes: 1024, logger: quiet });
  assert.deepEqual(report, {
    scanned: 0, removed: [], kept: [], errors: [],
    evicted: [], totalBytes: 0, quotaBytes: 1024, overQuota: false, active: [],
  });
});

test('B: readdir 非 ENOENT 失败：只记 errors 不抛，报告九键齐备', () => {
  const eacces = new Error('mock EACCES');
  eacces.code = 'EACCES';
  const impl = specFs([], { readdirError: eacces });
  const report = gcStaleUploads({ root: impl.root, now: 0, ttlMs: 1000, fsImpl: impl, logger: quiet });
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0].message, 'mock EACCES');
  assert.deepEqual(report.removed, []);
  assert.deepEqual(report.kept, []);
  assert.equal(report.totalBytes, 0);
  assert.equal(report.overQuota, false);
  assert.equal(report.quotaBytes, DEFAULT_UPLOAD_QUOTA_BYTES);
});

test('B: 单会话 stat 失败只记 errors，不影响其余会话', () => {
  const now = 1000000;
  const statErr = new Error('stat boom');
  const impl = specFs(
    [
      { name: 'up-a', mtimeMs: now - 10, bytes: 0 },
      { name: 'up-b', mtimeMs: now - 5000, bytes: 0 },
    ],
    { statErrors: { [path.join(impl_root(), 'up-a')]: statErr } }
  );
  const report = gcStaleUploads({ root: impl.root, now, ttlMs: 1000, fsImpl: impl, logger: quiet });
  assert.deepEqual(report.removed, ['up-b']);
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0].name, 'up-a');
  assert.equal(report.errors[0].message, 'stat boom');
  function impl_root() { return '/fake/root'; }
});

test('B: 单会话 rm 失败只记 errors，其余会话照常处理', () => {
  const now = 1000000;
  const boom = new Error('rm boom');
  const impl = specFs(
    [
      { name: 'up-a', mtimeMs: now - 5000, bytes: 0 },
      { name: 'up-b', mtimeMs: now - 5000, bytes: 0 },
    ],
    { rmErrors: { 'up-a': boom } }
  );
  const report = gcStaleUploads({ root: impl.root, now, ttlMs: 1000, fsImpl: impl, logger: quiet });
  assert.deepEqual(report.removed, ['up-b']);
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0].name, 'up-a');
  assert.equal(report.errors[0].message, 'rm boom');
});

// ============================================================
// C. phase 2（配额）
// ============================================================

test('C: 超配额按 mtime 最旧优先淘汰，直到降到配额内', () => {
  const now = 10 * 24 * 3600 * 1000; // 足够老，全部可淘汰
  const impl = specFs([
    { name: 'up-newest', mtimeMs: now - 10 * 60 * 1000, bytes: 40 },
    { name: 'up-mid', mtimeMs: now - 20 * 60 * 1000, bytes: 40 },
    { name: 'up-oldest', mtimeMs: now - 30 * 60 * 1000, bytes: 40 },
  ]);
  const report = gcStaleUploads({ root: impl.root, now, ttlMs: 24 * 3600 * 1000, quotaBytes: 80, fsImpl: impl, logger: quiet });
  assert.equal(report.totalBytes, 80, '淘汰前 120，淘汰最旧 40 后 80');
  assert.deepEqual(report.evicted, ['up-oldest'], 'mtime 最小的 up-oldest 先淘汰');
  assert.deepEqual([...report.kept].sort(), ['up-mid', 'up-newest']);
  assert.deepEqual(report.removed, [], 'evicted 与 removed 互斥');
  assert.equal(report.overQuota, false, '淘汰后已降到配额内');
  assert.equal(impl.removed.length, 1);
  assert.ok(impl.removed[0].endsWith('up-oldest'));
});

test('C: 活跃会话（now - mtime < GC_MIN_INTERVAL_MS）不淘汰，计入 kept 并单列 active', () => {
  const now = 10 * 24 * 3600 * 1000;
  const impl = specFs([
    { name: 'up-active', mtimeMs: now - 60 * 1000, bytes: 60 },      // 1 分钟前：活跃
    { name: 'up-stale', mtimeMs: now - 60 * 60 * 1000, bytes: 60 },  // 1 小时前：可淘汰
  ]);
  const report = gcStaleUploads({ root: impl.root, now, ttlMs: 24 * 3600 * 1000, quotaBytes: 80, fsImpl: impl, logger: quiet });
  assert.deepEqual(report.evicted, ['up-stale']);
  assert.deepEqual(report.kept, ['up-active']);
  assert.deepEqual(report.active, ['up-active']);
  assert.equal(report.totalBytes, 60);
  assert.equal(report.overQuota, false, '淘汰后 60 <= 80');
});

test('C: 全是活跃会话：宁可超配额也不删，overQuota=true 且 active 列出全部', () => {
  const now = 10 * 24 * 3600 * 1000;
  const impl = specFs([
    { name: 'up-a', mtimeMs: now - 1000, bytes: 100 },
    { name: 'up-b', mtimeMs: now - 2000, bytes: 100 },
  ]);
  const report = gcStaleUploads({ root: impl.root, now, ttlMs: 24 * 3600 * 1000, quotaBytes: 50, fsImpl: impl, logger: quiet });
  assert.equal(report.totalBytes, 200);
  assert.deepEqual(report.evicted, []);
  assert.deepEqual([...report.kept].sort(), ['up-a', 'up-b']);
  assert.deepEqual([...report.active].sort(), ['up-a', 'up-b']);
  assert.equal(report.overQuota, true, '没有可淘汰对象 => 仍然超配额');
  assert.equal(impl.removed.length, 0, '绝不删除正在上传的会话');
});

test('C: 可淘汰对象清完仍超配额：overQuota=true，剩余全为活跃会话', () => {
  const now = 10 * 24 * 3600 * 1000;
  const impl = specFs([
    { name: 'up-old', mtimeMs: now - 40 * 60 * 1000, bytes: 40 },
    { name: 'up-mid', mtimeMs: now - 50 * 60 * 1000, bytes: 40 },
    { name: 'up-active', mtimeMs: now - 30 * 1000, bytes: 100 },
  ]);
  const report = gcStaleUploads({ root: impl.root, now, ttlMs: 24 * 3600 * 1000, quotaBytes: 60, fsImpl: impl, logger: quiet });
  assert.deepEqual([...report.evicted].sort(), ['up-mid', 'up-old']);
  assert.deepEqual(report.kept, ['up-active']);
  assert.equal(report.totalBytes, 100);
  assert.equal(report.overQuota, true, '100 > 60，且剩下的删不得');
});

test('C: 淘汰 rm 失败只记 errors 并继续尝试下一个', () => {
  const now = 10 * 24 * 3600 * 1000;
  const boom = new Error('rm boom');
  const impl = specFs(
    [
      { name: 'up-old', mtimeMs: now - 60 * 60 * 1000, bytes: 40 },
      { name: 'up-mid', mtimeMs: now - 50 * 60 * 1000, bytes: 40 },
    ],
    { rmErrors: { 'up-old': boom } }
  );
  const report = gcStaleUploads({ root: impl.root, now, ttlMs: 24 * 3600 * 1000, quotaBytes: 40, fsImpl: impl, logger: quiet });
  assert.deepEqual(report.evicted, ['up-mid'], '最旧的删失败也不能阻断下一个');
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0].name, 'up-old');
  assert.equal(report.errors[0].message, 'rm boom');
  assert.equal(report.totalBytes, 40);
  assert.equal(report.overQuota, false);
});

test('C: 会话内 readdir 失败：占用按 0 计并记 errors，不会误删', () => {
  const now = 10 * 24 * 3600 * 1000;
  const eacces = new Error('session EACCES');
  const impl = specFs(
    [
      { name: 'up-a', mtimeMs: now - 40 * 60 * 1000, bytes: 999 },
      { name: 'up-b', mtimeMs: now - 50 * 60 * 1000, bytes: 40 },
    ],
    { sessionReadErrors: { 'up-a': eacces } }
  );
  // 配额 60 大于 up-b 的 40，本就不触发淘汰；这里专测「测量失败按 0 计且不被淘汰」
  const report = gcStaleUploads({ root: impl.root, now, ttlMs: 24 * 3600 * 1000, quotaBytes: 60, fsImpl: impl, logger: quiet });
  assert.equal(report.totalBytes, 40, '测量失败的 up-a 按 0 计（宁可低估，不高估误删）');
  assert.equal(report.errors.some((e) => e.name === 'up-a' && e.message === 'session EACCES'), true);
  assert.deepEqual(report.evicted, [], '没有任何会话因配额被淘汰');
  assert.deepEqual([...report.kept].sort(), ['up-a', 'up-b']);
  assert.equal(report.overQuota, false);
});

test('C: 真临时 root：写真文件，占用按真实文件字节求和', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bio-upload-quota-'));
  try {
    const now = 10 * 24 * 3600 * 1000;
    const dirs = [
      { name: 'up-old', mtime: now - 60 * 60 * 1000 },
      { name: 'up-mid', mtime: now - 50 * 60 * 1000 },
      { name: 'up-new', mtime: now - 40 * 60 * 1000 },
    ];
    for (const item of dirs) {
      const dir = path.join(tmp, item.name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, '0.part'), Buffer.alloc(30));
      const when = new Date(item.mtime);
      fs.utimesSync(dir, when, when);
    }
    const report = gcStaleUploads({ root: tmp, now, ttlMs: 24 * 3600 * 1000, quotaBytes: 60, logger: quiet });
    assert.equal(report.scanned, 3);
    assert.equal(report.totalBytes, 60, '清理后仍存活的总占用：3 x 30 = 90 超配额 60，淘汰最旧 up-old 后剩 2 x 30 = 60');
    assert.deepEqual(report.evicted, ['up-old']);
    assert.deepEqual([...report.kept].sort(), ['up-mid', 'up-new']);
    assert.equal(report.overQuota, false);
    assert.equal(fs.existsSync(path.join(tmp, 'up-old')), false, '被淘汰目录真的删掉了');
    assert.equal(fs.existsSync(path.join(tmp, 'up-mid')), true);
    assert.equal(fs.existsSync(path.join(tmp, 'up-new')), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('C: maybeGcStaleUploads 把 quotaBytes 透传给 gcStaleUploads', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bio-upload-quota-maybe-'));
  try {
    const now = 10 * 24 * 3600 * 1000;
    const dir = path.join(tmp, 'up-only');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '0.part'), Buffer.alloc(30));
    const when = new Date(now - 60 * 60 * 1000);
    fs.utimesSync(dir, when, when);
    resetUploadGcThrottle();
    const report = maybeGcStaleUploads({ root: tmp, now, ttlMs: 24 * 3600 * 1000, quotaBytes: 10, minIntervalMs: 0, logger: quiet });
    assert.ok(report, '未被节流');
    assert.equal(report.quotaBytes, 10);
    assert.equal(report.totalBytes, 0, '唯一会话已被淘汰，存活占用归 0');
    assert.deepEqual(report.evicted, ['up-only']);
    assert.equal(report.overQuota, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    resetUploadGcThrottle();
  }
});

test('C: GC_MIN_INTERVAL_MS 与 isSafeUploadId 常量仍可导入（回归）', () => {
  assert.equal(GC_MIN_INTERVAL_MS, 10 * 60 * 1000);
  assert.equal(isSafeUploadId('up-0123456789abcdef'), true);
  assert.equal(isSafeUploadId('..'), false);
  assert.equal(isSafeUploadId('a/b'), false);
  assert.equal(isSafeUploadId('.hidden'), false);
});

// ============================================================
// D. 真 HTTP：507 配额拒绝 + 四端点错误体统一
// ============================================================

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const PORT = await freePort();
const BASE = 'http://127.0.0.1:' + PORT;
const childCalls = [];

function fakeChild(exitCode) {
  const child = new EventEmitter();
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.stdin = new Writable({ write(_chunk, _enc, cb) { cb(); } });
  child.kill = () => child.emit('exit', exitCode, null);
  setImmediate(() => {
    child.stdout.push(null);
    child.stderr.push(null);
    setImmediate(() => child.emit('exit', exitCode, null));
  });
  return child;
}

/** 往 UPLOAD_ROOT 造一个「活跃」会话目录，供配额闸门判定超限 */
const planted = [];
function plantSession(bytes) {
  const uploadId = 'up-' + String(Date.now()) + String(process.pid).slice(-6) + String(planted.length);
  const dir = path.join(UPLOAD_ROOT, uploadId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '0.part'), Buffer.alloc(bytes));
  const now = new Date();
  fs.utimesSync(dir, now, now);
  planted.push(uploadId);
  return uploadId;
}

before(async () => {
  process.env.BAD_PORT = String(PORT);
  mock.method(childProcess, 'spawnSync', (cmd, args) => {
    childCalls.push({ kind: 'spawnSync', cmd, joined: (args || []).join(' ') });
    return { status: 0, stdout: '', stderr: '' };
  });
  mock.method(childProcess, 'spawn', (cmd, args) => {
    childCalls.push({ kind: 'spawn', cmd, joined: (args || []).join(' ') });
    return fakeChild(1);
  });
  await import('../server/index.js');
  const deadline = Date.now() + 10000;
  for (;;) {
    try {
      const response = await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(1000) });
      if (response.ok) break;
    } catch { /* 没起来就继续等 */ }
    if (Date.now() > deadline) throw new Error('服务 10s 内没就绪（端口 ' + PORT + '）');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  childCalls.length = 0;
});

after(async () => {
  const mod = await import('../server/index.js');
  mod.server.closeAllConnections?.();
  await new Promise((resolve) => mod.server.close(resolve));
  for (const uploadId of planted) {
    try { fs.rmSync(path.join(UPLOAD_ROOT, uploadId), { recursive: true, force: true }); } catch { /* 已清理 */ }
  }
  mock.restoreAll();
  resetUploadGcThrottle();
});

async function postJson(pathname, body) {
  const response = await fetch(BASE + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, body: await response.json() };
}

test('D: init 配额超限（活跃会话占满）=> 507 + {ok:false,error}，错误体含占用与配额字节数', async () => {
  const previous = process.env.BIO_UPLOAD_QUOTA_BYTES;
  process.env.BIO_UPLOAD_QUOTA_BYTES = '32';
  childCalls.length = 0;
  try {
    plantSession(64);
    resetUploadGcThrottle();
    const res = await postJson('/api/upload/init', {
      projectId: 'default',
      lineId: 'line1_bulk',
      filename: 'quota_probe_' + String(Date.now()) + '.h5ad',
    });
    assert.equal(res.status, 507, '配额耗尽必须是 507，不是 400/500');
    assert.equal(res.body.ok, false, '错误体统一形状');
    assert.equal(typeof res.body.error, 'string');
    assert.ok(res.body.error.length > 0);
    assert.match(res.body.error, /上传暂存空间已满/);
    // 占用数字不写死：全量 npm test 下其它测试文件也会在 .uploads 里留下会话，
    // 总数只保证 >= 本用例种下的 64 字节；配额字节数则必须是本次注入的 32。
    assert.match(res.body.error, /当前占用 \d+ 字节，超过配额 32 字节/);
    const usage = Number(res.body.error.match(/当前占用 (\d+) 字节/)[1]);
    assert.ok(usage >= 64, '当前占用至少包含本用例种下的 64 字节（实测 ' + usage + '）');
    assert.equal(res.body.uploadId, undefined, '失败不返回 uploadId');
    assert.equal(childCalls.length, 0, '全程无 ssh/子进程调用');
  } finally {
    if (previous === undefined) delete process.env.BIO_UPLOAD_QUOTA_BYTES;
    else process.env.BIO_UPLOAD_QUOTA_BYTES = previous;
    resetUploadGcThrottle();
  }
});

test('D: init 配额正常时可以创建会话（不误伤）', async () => {
  const previous = process.env.BIO_UPLOAD_QUOTA_BYTES;
  process.env.BIO_UPLOAD_QUOTA_BYTES = String(DEFAULT_UPLOAD_QUOTA_BYTES);
  try {
    resetUploadGcThrottle();
    const res = await postJson('/api/upload/init', {
      projectId: 'default',
      lineId: 'line1_bulk',
      filename: 'quota_ok_' + String(Date.now()) + '.h5ad',
    });
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.uploadId, 'string');
    assert.equal(res.body.ok, undefined, '成功体不新增 ok 字段（保持既有契约）');
    planted.push(res.body.uploadId);
  } finally {
    if (previous === undefined) delete process.env.BIO_UPLOAD_QUOTA_BYTES;
    else process.env.BIO_UPLOAD_QUOTA_BYTES = previous;
    resetUploadGcThrottle();
  }
});

test('D: 四端点错误体统一为 {ok:false,error}（init / chunk / status / complete 各至少一条）', async () => {
  const previous = process.env.BIO_UPLOAD_QUOTA_BYTES;
  process.env.BIO_UPLOAD_QUOTA_BYTES = String(DEFAULT_UPLOAD_QUOTA_BYTES);
  childCalls.length = 0;
  try {
    resetUploadGcThrottle();

    const initBadJson = await fetch(BASE + '/api/upload/init', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: '{not json', signal: AbortSignal.timeout(5000),
    });
    const initJsonBody = await initBadJson.json();
    assert.equal(initBadJson.status, 400);
    assert.equal(initJsonBody.ok, false);
    assert.ok(typeof initJsonBody.error === 'string' && initJsonBody.error.length > 0);

    const initBadLine = await postJson('/api/upload/init', { projectId: 'default', lineId: 'nope', filename: 'x.h5ad' });
    assert.equal(initBadLine.status, 400);
    assert.equal(initBadLine.body.ok, false);
    assert.ok(typeof initBadLine.body.error === 'string' && initBadLine.body.error.length > 0);

    const initBadFp = await postJson('/api/upload/init', {
      projectId: 'default', lineId: 'line1_bulk', filename: 'x.h5ad', fingerprint: 'bad\u0000fp',
    });
    assert.equal(initBadFp.status, 400);
    assert.equal(initBadFp.body.ok, false);
    assert.match(initBadFp.body.error, /fingerprint 非法/);

    const chunkRes = await fetch(BASE + '/api/upload/chunk?uploadId=..&index=0', {
      method: 'POST', body: 'x', signal: AbortSignal.timeout(5000),
    });
    const chunkBody = await chunkRes.json();
    assert.equal(chunkRes.status, 400);
    assert.equal(chunkBody.ok, false);
    assert.ok(typeof chunkBody.error === 'string' && chunkBody.error.length > 0);

    const statusRes = await fetch(BASE + '/api/upload/status?uploadId=..', { signal: AbortSignal.timeout(5000) });
    const statusBody = await statusRes.json();
    assert.equal(statusRes.status, 400);
    assert.equal(statusBody.ok, false);
    assert.ok(typeof statusBody.error === 'string' && statusBody.error.length > 0);

    const completeBadJson = await fetch(BASE + '/api/upload/complete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: '{nope', signal: AbortSignal.timeout(5000),
    });
    const completeBody = await completeBadJson.json();
    assert.equal(completeBadJson.status, 400);
    assert.equal(completeBody.ok, false);
    assert.ok(typeof completeBody.error === 'string' && completeBody.error.length > 0);

    assert.equal(childCalls.length, 0, '错误路径不触发任何子进程');
  } finally {
    if (previous === undefined) delete process.env.BIO_UPLOAD_QUOTA_BYTES;
    else process.env.BIO_UPLOAD_QUOTA_BYTES = previous;
    resetUploadGcThrottle();
  }
});

test('D: 成功响应体不变（status 200 not_found 仍带 received 与 ok:false）', async () => {
  const statusRes = await fetch(BASE + '/api/upload/status?uploadId=up-does-not-exist', { signal: AbortSignal.timeout(5000) });
  const statusBody = await statusRes.json();
  assert.equal(statusRes.status, 200);
  assert.equal(statusBody.ok, false, 'not_found 语义保持 200 + ok:false');
  assert.deepEqual(statusBody.received, []);
  assert.equal(statusBody.reason, 'not_found');
});
