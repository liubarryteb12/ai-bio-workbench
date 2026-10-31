/**
 * 上传会话（确定性 uploadId + 陈旧会话 GC + 前端续传纯逻辑）测试。
 *
 * 覆盖四块：
 *   A. shared/upload_session.mjs：SHA-256 与 node:crypto 对拍、指纹格式/稳定性/转义、id 派生、安全 id 判定。
 *   B. src/lib/uploadSession.ts：node 直接 import .ts（类型擦除），覆盖指纹、resumeStartIndex 夹取、
 *      localStorage 读写/损坏/异常退化、非浏览器环境返回 null。
 *   C. 陈旧会话 GC：注入临时 root 与假 fs，覆盖删旧留新、TTL 边界、非法目录名不碰、
 *      单目录 stat/rm 失败只记 errors、节流与异常吞掉、resolveUploadId 三条分支。
 *   D. 真 HTTP（in-process 服务 + spawn 垫片）：init 带指纹两次同 id、不同文件不同 id、
 *      size+lastModified 分支、无指纹回落 UUID、非法指纹 400、GC 异常不影响 init。
 *
 * 口径：GC 行为测试一律注入临时 root，绝不对共享的 .uploads 根跑小 TTL 清理。
 *   node --test 各测试文件是并行进程且共用同一个 UPLOAD_ROOT，对真根跑 GC 会误删
 *   别的测试文件正在使用的会话目录。
 */

import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';

import {
  DEFAULT_UPLOAD_QUOTA_BYTES, DEFAULT_UPLOAD_TTL_HOURS, GC_MIN_INTERVAL_MS, UPLOAD_ROOT,
  cleanupUpload, gcStaleUploads, maybeGcStaleUploads, resetUploadGcThrottle,
  resolveUploadId, uploadDir, uploadTtlMs,
} from '../server/upload.js';
import {
  UPLOAD_ID_HEX_LEN, UPLOAD_ID_PREFIX, isSafeUploadId, sha256Hex, uploadFingerprint, uploadIdFromFingerprint,
} from '../../shared/upload_session.mjs';
import {
  UPLOAD_ID_STORE_PREFIX, browserStorage, fileFingerprint, forgetUploadId,
  readStoredUploadId, resumeStartIndex, storeUploadId,
} from '../src/lib/uploadSession.ts';

/** 静默 logger：GC 单测不需要往测试输出里打日志 */
const quiet = { log() {}, warn() {}, error() {} };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** D 段经 HTTP 创建出来的会话目录，after 里统一清理 */
const created = [];

// ============================================================
// A. shared/upload_session.mjs
// ============================================================

test('A: sha256Hex 与 node:crypto 逐条对拍（空串/中文/emoji/补位边界/长串）', () => {
  const cases = ['', 'abc', '中文文件名.h5ad', 'emoji😀代理对', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'y'.repeat(1000)];
  for (const input of cases) {
    const expected = createHash('sha256').update(input, 'utf8').digest('hex');
    assert.equal(sha256Hex(input), expected, '对拍失败，输入长度 ' + input.length);
  }
});

test('A: 指纹格式为 project|lineId|name|size|lastModified，数字分量取整', () => {
  assert.equal(
    uploadFingerprint({ project: 'default', lineId: 'line1_bulk', name: 'a.h5ad', size: 1024, lastModified: 1700000000000 }),
    'default|line1_bulk|a.h5ad|1024|1700000000000',
  );
  assert.equal(uploadFingerprint({ project: 'p', lineId: 'l', name: 'n', size: 1.9, lastModified: 2.7 }), 'p|l|n|1|2');
  assert.equal(uploadFingerprint({}), ['', '', '', '0', '0'].join('|'), '缺字段按空串/0 归一，保证确定性');
});

test('A: 指纹转义 % 与 |，不同字段组合不会撞成同一指纹', () => {
  assert.equal(uploadFingerprint({ project: 'a|b' }), ['a%7Cb', '', '', '0', '0'].join('|'));
  assert.equal(uploadFingerprint({ project: 'a%7Cb' }), ['a%257Cb', '', '', '0', '0'].join('|'));
  assert.notEqual(
    uploadFingerprint({ project: 'a|b', lineId: 'c' }),
    uploadFingerprint({ project: 'a', lineId: 'b|c' }),
    '不转义时这两种组合会撞成同一个指纹',
  );
});

test('A: uploadIdFromFingerprint 确定、带前缀、固定长度，空指纹返回空串', () => {
  const fp = uploadFingerprint({ project: 'default', lineId: 'line1_bulk', name: 'a.h5ad', size: 10, lastModified: 20 });
  const id = uploadIdFromFingerprint(fp);
  assert.equal(id, uploadIdFromFingerprint(fp), '同一指纹必须派生出同一个 id');
  assert.equal(id.startsWith(UPLOAD_ID_PREFIX), true);
  assert.equal(id.length, UPLOAD_ID_PREFIX.length + UPLOAD_ID_HEX_LEN);
  assert.match(id, /^up-[0-9a-f]{16}$/);
  assert.notEqual(id, uploadIdFromFingerprint(fp + 'x'), '不同指纹必须派生不同 id');
  assert.equal(uploadIdFromFingerprint(''), '');
  assert.equal(uploadIdFromFingerprint(null), '');
});

test('A: isSafeUploadId 白名单边界（空串/点段/含 .. /隐藏名/非法字符/长度）', () => {
  const ok = ['up-0123456789abcdef', '0b7c9f7e-1a2b-4c3d-8e9f-0123456789ab', 'sess_2026-10-21.v1', 'a'.repeat(128)];
  for (const id of ok) assert.equal(isSafeUploadId(id), true, '应放行: ' + id);
  const bad = ['', '.', '..', 'a..b', '.hidden', 'a/b', 'a b', 'a\\b', '中文', 'a'.repeat(129), null, undefined];
  for (const id of bad) assert.equal(isSafeUploadId(id), false, '应拒绝: ' + String(id));
});

// ============================================================
// B. src/lib/uploadSession.ts（node 直接 import .ts，类型擦除）
// ============================================================

test('B: fileFingerprint 与 shared 的 uploadFingerprint 完全一致', () => {
  const file = { name: '样本信息.xlsx', size: 2048, lastModified: 1699999999999 };
  assert.equal(
    fileFingerprint('default', 'line1_bulk', file),
    uploadFingerprint({ project: 'default', lineId: 'line1_bulk', name: file.name, size: file.size, lastModified: file.lastModified }),
  );
});

test('B: 指纹稳定，且随 size / lastModified / 文件名 / 项目 / 线变化', () => {
  const base = { name: 'a.h5ad', size: 100, lastModified: 1000 };
  const fp = fileFingerprint('p', 'l', base);
  assert.equal(fileFingerprint('p', 'l', { ...base }), fp, '同一文件重复算必须稳定');
  assert.notEqual(fileFingerprint('p', 'l', { ...base, size: 101 }), fp);
  assert.notEqual(fileFingerprint('p', 'l', { ...base, lastModified: 1001 }), fp);
  assert.notEqual(fileFingerprint('p', 'l', { ...base, name: 'b.h5ad' }), fp);
  assert.notEqual(fileFingerprint('other', 'l', base), fp);
  assert.notEqual(fileFingerprint('p', 'line2_deseq', base), fp);
});

test('B: resumeStartIndex 夹取到 [0, total]，异常值一律回 0', () => {
  assert.equal(resumeStartIndex({ nextIndex: 0 }, 10), 0);
  assert.equal(resumeStartIndex({ nextIndex: 2 }, 10), 2);
  assert.equal(resumeStartIndex({ nextIndex: 3.9 }, 10), 3, '小数向下取整');
  assert.equal(resumeStartIndex({ nextIndex: 99 }, 10), 10, '超过 total 夹到 total');
  assert.equal(resumeStartIndex({ nextIndex: -1 }, 10), 0);
  assert.equal(resumeStartIndex({ nextIndex: Number.NaN }, 10), 0);
  assert.equal(resumeStartIndex({ nextIndex: Number.POSITIVE_INFINITY }, 10), 0);
  assert.equal(resumeStartIndex({ nextIndex: '5' }, 10), 0, '字符串不算数字，宁可重传');
  assert.equal(resumeStartIndex(null, 10), 0);
  assert.equal(resumeStartIndex(undefined, 10), 0);
  assert.equal(resumeStartIndex({ nextIndex: 2 }, 0), 0);
  assert.equal(resumeStartIndex({ nextIndex: 2 }, Number.NaN), 0);
});

/** Map 版假 storage：可统计调用次数、可 dump 出全部键值 */
function makeStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    dump: () => Object.fromEntries(map),
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
  };
}

test('B: 会话缓存读写：键为前缀 + 指纹，读回同一个 id', () => {
  const storage = makeStorage();
  const fp = fileFingerprint('p', 'l', { name: 'a.h5ad', size: 1, lastModified: 2 });
  assert.equal(storeUploadId(fp, 'up-0123456789abcdef', storage), true);
  assert.deepEqual(storage.dump(), { [UPLOAD_ID_STORE_PREFIX + fp]: 'up-0123456789abcdef' });
  assert.equal(readStoredUploadId(fp, storage), 'up-0123456789abcdef');
  assert.equal(readStoredUploadId('unknown-fp', storage), null);
  forgetUploadId(fp, storage);
  assert.equal(readStoredUploadId(fp, storage), null);
});

test('B: 缓存损坏（非法 id / 超长值）一律当没有；旧版本 UUID 仍可读', () => {
  const fp = 'fp';
  for (const broken of ['../etc/passwd', 'a/b', '', 'a'.repeat(200)]) {
    const storage = makeStorage({ [UPLOAD_ID_STORE_PREFIX + fp]: broken });
    assert.equal(readStoredUploadId(fp, storage), null, '损坏值应被忽略: ' + broken);
  }
  const legacy = '0b7c9f7e-1a2b-4c3d-8e9f-0123456789ab';
  assert.equal(readStoredUploadId(fp, makeStorage({ [UPLOAD_ID_STORE_PREFIX + fp]: legacy })), legacy);
});

test('B: 存储抛异常（隐私模式）不抛给调用方，只退化为不可续传', () => {
  const throwing = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
  assert.equal(readStoredUploadId('fp', throwing), null);
  assert.equal(storeUploadId('fp', 'up-0123456789abcdef', throwing), false);
  assert.doesNotThrow(() => forgetUploadId('fp', throwing));
});

test('B: storeUploadId 拒绝非法 id 与空指纹，不写任何键', () => {
  const storage = makeStorage();
  assert.equal(storeUploadId('fp', '../evil', storage), false);
  assert.equal(storeUploadId('', 'up-0123456789abcdef', storage), false);
  assert.deepEqual(storage.dump(), {});
});

test('B: 非浏览器环境（node）browserStorage 返回 null，默认参数退化为不续传', () => {
  assert.equal(typeof window, 'undefined');
  assert.equal(browserStorage(), null);
  assert.equal(readStoredUploadId('fp'), null);
  assert.equal(storeUploadId('fp', 'up-0123456789abcdef'), false);
  assert.doesNotThrow(() => forgetUploadId('fp'));
});

// ============================================================
// C. 陈旧会话 GC（注入临时 root / 假 fs，绝不对共享 .uploads 跑清理）
// ============================================================

function dirEntry(name) { return { name, isDirectory: () => true }; }
function fileEntry(name) { return { name, isDirectory: () => false }; }

/** 假 fs：entries/stats/readdirError/statError/rmErrors 全部可注入，便于覆盖失败分支 */
function fakeFs(spec) {
  const removed = [];
  return {
    removed,
    readdirSync() {
      if (spec.readdirError) throw spec.readdirError;
      return spec.entries || [];
    },
    statSync(target) {
      if (spec.statError) throw spec.statError;
      const stat = (spec.stats || {})[target];
      if (!stat) throw new Error('unexpected stat: ' + target);
      if (stat instanceof Error) throw stat;
      return stat;
    },
    rmSync(target) {
      const fail = (spec.rmErrors || []).find((item) => target.endsWith(item.name));
      if (fail) throw fail.error;
      removed.push(target);
    },
  };
}

test('C: TTL 边界：age 恰好等于 ttl 保留，多 1ms 删除（假 fs，不受文件系统时间精度影响）', () => {
  const fakeRoot = path.join('/fake', 'root');
  const now = 1700000000000;
  const ttlMs = 24 * 60 * 60 * 1000;
  const fake = fakeFs({
    entries: [dirEntry('up-edge'), dirEntry('up-past')],
    stats: {
      [path.join(fakeRoot, 'up-edge')]: { mtimeMs: now - ttlMs },
      [path.join(fakeRoot, 'up-past')]: { mtimeMs: now - ttlMs - 1 },
    },
  });
  const report = gcStaleUploads({ root: fakeRoot, now, ttlMs, fsImpl: fake, logger: quiet });
  assert.deepEqual(report.removed, ['up-past']);
  assert.deepEqual(report.kept, ['up-edge'], '边界不删：age === ttl 仍算活跃');
  assert.equal(report.scanned, 2);
  assert.deepEqual(report.errors, []);
});

test('C: 真文件系统：只删合法 id 且过期的会话目录，文件/非法名/隐藏目录原样保留', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bio-upload-gc-'));
  try {
    const now = Date.now();
    const ttlMs = 24 * 60 * 60 * 1000;
    const mk = (name, mtimeMs) => {
      const dir = path.join(tempRoot, name);
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, '0.part'), 'x');
      const date = new Date(mtimeMs);
      fs.utimesSync(dir, date, date);
      return dir;
    };
    const staleDir = mk('up-stale-session', now - ttlMs - 60 * 60 * 1000);
    const freshDir = mk('up-active-session', now - 60 * 1000);
    fs.writeFileSync(path.join(tempRoot, 'stray.txt'), 'not a session');
    fs.mkdirSync(path.join(tempRoot, 'bad name'));
    fs.mkdirSync(path.join(tempRoot, '.hidden'));
    const report = gcStaleUploads({ root: tempRoot, now, ttlMs, logger: quiet });
    assert.deepEqual(report.removed, ['up-stale-session']);
    assert.deepEqual(report.kept, ['up-active-session']);
    assert.deepEqual(report.errors, []);
    assert.equal(fs.existsSync(staleDir), false, '过期会话目录必须被删');
    assert.equal(fs.existsSync(freshDir), true, '活跃会话目录不能删');
    assert.equal(fs.existsSync(path.join(tempRoot, 'stray.txt')), true);
    assert.equal(fs.existsSync(path.join(tempRoot, 'bad name')), true, '非法目录名不是本模块建的，不碰');
    assert.equal(fs.existsSync(path.join(tempRoot, '.hidden')), true, '隐藏目录不碰');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('C: UPLOAD_ROOT 不存在（还没传过任何文件）按正常空状态处理', () => {
  const missing = path.join(os.tmpdir(), 'bio-upload-gc-missing-' + process.pid + '-' + Date.now());
  const report = gcStaleUploads({ root: missing, now: Date.now(), ttlMs: 1000, logger: quiet });
  // task-8 给 gcStaleUploads 报告加了配额字段（totalBytes/quotaBytes/overQuota/evicted/active），
  // deepEqual 对键集严格，这里同步期望值：空根下这些字段各自的零值。
  assert.deepEqual(report, {
    scanned: 0, removed: [], kept: [], errors: [],
    evicted: [], totalBytes: 0, quotaBytes: DEFAULT_UPLOAD_QUOTA_BYTES, overQuota: false, active: [],
  });
});

test('C: readdir 失败：ENOENT 不算错，其余错误只记 errors 不抛', () => {
  const enoent = new Error('no such dir');
  enoent.code = 'ENOENT';
  assert.deepEqual(gcStaleUploads({ root: '/fake/root', now: 0, ttlMs: 1000, fsImpl: fakeFs({ readdirError: enoent }), logger: quiet }).errors, []);
  const eacces = new Error('mock EACCES');
  eacces.code = 'EACCES';
  const report = gcStaleUploads({ root: '/fake/root', now: 0, ttlMs: 1000, fsImpl: fakeFs({ readdirError: eacces }), logger: quiet });
  assert.deepEqual(report.removed, []);
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0].message, /EACCES/);
});

test('C: 单个目录 stat 失败只记 errors，同批其它目录照常处理', () => {
  const fakeRoot = path.join('/fake', 'root');
  const fake = fakeFs({
    entries: [dirEntry('up-a'), dirEntry('up-b')],
    stats: {
      [path.join(fakeRoot, 'up-a')]: new Error('stat boom'),
      [path.join(fakeRoot, 'up-b')]: { mtimeMs: 0 },
    },
  });
  const report = gcStaleUploads({ root: fakeRoot, now: 10000, ttlMs: 1000, fsImpl: fake, logger: quiet });
  assert.deepEqual(report.removed, ['up-b']);
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0].name, 'up-a');
});

test('C: 单个目录 rm 失败只记 errors，不算进 removed', () => {
  const fakeRoot = path.join('/fake', 'root');
  const fake = fakeFs({
    entries: [dirEntry('up-locked')],
    stats: { [path.join(fakeRoot, 'up-locked')]: { mtimeMs: 0 } },
    rmErrors: [{ name: 'up-locked', error: new Error('EBUSY') }],
  });
  const report = gcStaleUploads({ root: fakeRoot, now: 10000, ttlMs: 1000, fsImpl: fake, logger: quiet });
  assert.deepEqual(report.removed, []);
  assert.equal(report.scanned, 1);
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0].name, 'up-locked');
});

test('C: 普通文件与非法目录名一律跳过（scanned 不计数、不下探）', () => {
  const fake = fakeFs({ entries: [fileEntry('stray.txt'), dirEntry('bad name'), dirEntry('.hidden'), dirEntry('a..b')] });
  const report = gcStaleUploads({ root: '/fake/root', now: 1000, ttlMs: 10, fsImpl: fake, logger: quiet });
  assert.equal(report.scanned, 0);
  assert.deepEqual(report.removed, []);
  assert.deepEqual(report.errors, []);
});

test('C: uploadTtlMs 读 BIO_UPLOAD_TTL_HOURS，非法值回落默认 24h', () => {
  const day = 24 * 60 * 60 * 1000;
  assert.equal(DEFAULT_UPLOAD_TTL_HOURS, 24);
  assert.equal(uploadTtlMs({}), day);
  assert.equal(uploadTtlMs({ BIO_UPLOAD_TTL_HOURS: '1' }), 60 * 60 * 1000);
  assert.equal(uploadTtlMs({ BIO_UPLOAD_TTL_HOURS: '0.5' }), 30 * 60 * 1000);
  assert.equal(uploadTtlMs({ BIO_UPLOAD_TTL_HOURS: '0' }), day);
  assert.equal(uploadTtlMs({ BIO_UPLOAD_TTL_HOURS: '-3' }), day);
  assert.equal(uploadTtlMs({ BIO_UPLOAD_TTL_HOURS: 'abc' }), day);
});

test('C: maybeGcStaleUploads 节流：10 分钟内只扫一次，到点再扫', () => {
  resetUploadGcThrottle();
  let reads = 0;
  const fake = { readdirSync() { reads += 1; return []; }, statSync() { return { mtimeMs: 0 }; }, rmSync() {} };
  const now = 1700000000000;
  assert.notEqual(maybeGcStaleUploads({ now, fsImpl: fake, root: '/fake/root', ttlMs: 1000, logger: quiet }), null);
  assert.equal(reads, 1);
  assert.equal(maybeGcStaleUploads({ now: now + GC_MIN_INTERVAL_MS - 1, fsImpl: fake, root: '/fake/root', ttlMs: 1000, logger: quiet }), null, '间隔内必须跳过');
  assert.equal(reads, 1);
  assert.notEqual(maybeGcStaleUploads({ now: now + GC_MIN_INTERVAL_MS, fsImpl: fake, root: '/fake/root', ttlMs: 1000, logger: quiet }), null);
  assert.equal(reads, 2);
  resetUploadGcThrottle();
});

test('C: maybeGcStaleUploads 吞掉清理过程中的异常并返回 null', () => {
  resetUploadGcThrottle();
  const fakeRoot = path.join('/fake', 'root');
  const fake = fakeFs({ entries: [dirEntry('up-old')], stats: { [path.join(fakeRoot, 'up-old')]: { mtimeMs: 0 } } });
  const loud = { log() { throw new Error('log boom'); }, warn() {} };
  const report = maybeGcStaleUploads({ now: 1700000000000, fsImpl: fake, root: fakeRoot, ttlMs: 1000, logger: loud });
  assert.equal(report, null, '异常必须被吞掉，init handler 不应看到抛出');
  resetUploadGcThrottle();
});

test('C: resolveUploadId：fingerprint 优先，size+lastModified 次之，都没有回落 UUID', () => {
  const fingerprint = uploadFingerprint({ project: 'default', lineId: 'line1_bulk', name: 'a.h5ad', size: 10, lastModified: 20 });
  const byFingerprint = resolveUploadId({ fingerprint });
  assert.equal(byFingerprint.uploadId, uploadIdFromFingerprint(fingerprint));
  assert.equal(byFingerprint.deterministic, true);
  const byFacts = resolveUploadId({ projectId: 'default', lineId: 'line1_bulk', filename: 'a.h5ad', size: 10, lastModified: 20 });
  assert.equal(byFacts.uploadId, byFingerprint.uploadId, '两条路径必须派生出同一个 id');
  const fallback = resolveUploadId({});
  assert.equal(fallback.deterministic, false);
  assert.match(fallback.uploadId, UUID_RE);
  const invalid = resolveUploadId({ fingerprint: 123 });
  assert.equal(invalid.uploadId, '');
  assert.equal(invalid.reason, 'invalid_fingerprint');
  assert.equal(resolveUploadId({ fingerprint: 'a' + String.fromCharCode(0) + 'b' }).reason, 'invalid_fingerprint');
  // 显式给 null / 空串同样算非法：客户端算错指纹时必须报错，不能悄悄回落 UUID
  assert.equal(resolveUploadId({ fingerprint: null }).reason, 'invalid_fingerprint');
  assert.equal(resolveUploadId({ fingerprint: '' }).reason, 'invalid_fingerprint');
  assert.equal(resolveUploadId({ fingerprint: 'x'.repeat(1025) }).reason, 'invalid_fingerprint');
});

test('C: uploadDir 严格白名单：非法字符不再被静默剥掉', () => {
  assert.equal(uploadDir('a/b'), null, '旧实现会把 a/b 剥成 ab 指向另一个会话目录');
  assert.equal(uploadDir('a b'), null);
  assert.equal(uploadDir('..'), null);
  assert.equal(path.dirname(uploadDir('up-0123456789abcdef')), UPLOAD_ROOT);
});

// ============================================================
// D. 真 HTTP：确定性 uploadId 契约 + GC 失败不影响上传请求
//    in-process 起真服务，childProcess 全部垫片，绝不真连 K40。
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
});

after(async () => {
  const mod = await import('../server/index.js');
  mod.server.closeAllConnections?.();
  await new Promise((resolve) => mod.server.close(resolve));
  for (const uploadId of created) {
    try { cleanupUpload(uploadId); } catch { /* 已清理 */ }
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

/** 每次运行唯一，避免上一轮遗留的确定性会话目录影响断言 */
const RUN_TAG = String(Date.now()) + '-' + process.pid;
function initBody(extra) {
  return { projectId: 'default', lineId: 'line1_bulk', filename: 'session_det_' + RUN_TAG + '.h5ad', ...(extra || {}) };
}

test('D: init 带同一 fingerprint 两次 -> 同一 uploadId，deterministic=true，status 可查到', async () => {
  const body = initBody({ size: 1024, lastModified: 1700000000000 });
  const fingerprint = uploadFingerprint({
    project: body.projectId, lineId: body.lineId, name: body.filename, size: body.size, lastModified: body.lastModified,
  });
  const first = await postJson('/api/upload/init', { ...body, fingerprint });
  assert.equal(first.status, 200);
  assert.equal(first.body.deterministic, true, '带指纹必须走确定性派生');
  assert.equal(first.body.uploadId, uploadIdFromFingerprint(fingerprint));
  created.push(first.body.uploadId);
  const second = await postJson('/api/upload/init', { ...body, fingerprint });
  assert.equal(second.status, 200);
  assert.equal(second.body.uploadId, first.body.uploadId, '刷新/换浏览器重发 init 必须拿到同一个会话');
  const status = await fetch(BASE + '/api/upload/status?uploadId=' + encodeURIComponent(first.body.uploadId), { signal: AbortSignal.timeout(5000) });
  const statusBody = await status.json();
  assert.equal(statusBody.ok, true);
  assert.equal(statusBody.exists, true);
  assert.equal(statusBody.nextIndex, 0);
  assert.equal(childCalls.length, 0, 'init/status 不应下发任何 ssh 命令');
});

test('D: 文件变了（size 或 lastModified）-> 不同 uploadId，不会误续传旧会话', async () => {
  const base = initBody({ size: 100, lastModified: 1700000000000 });
  const fpOf = (b) => uploadFingerprint({ project: b.projectId, lineId: b.lineId, name: b.filename, size: b.size, lastModified: b.lastModified });
  const a = await postJson('/api/upload/init', { ...base, fingerprint: fpOf(base) });
  const sizeChanged = { ...base, size: 101 };
  const b = await postJson('/api/upload/init', { ...sizeChanged, fingerprint: fpOf(sizeChanged) });
  const timeChanged = { ...base, lastModified: 1700000000001 };
  const c = await postJson('/api/upload/init', { ...timeChanged, fingerprint: fpOf(timeChanged) });
  created.push(a.body.uploadId, b.body.uploadId, c.body.uploadId);
  assert.notEqual(a.body.uploadId, b.body.uploadId);
  assert.notEqual(a.body.uploadId, c.body.uploadId);
  assert.notEqual(b.body.uploadId, c.body.uploadId);
});

test('D: 只给 size+lastModified 不给 fingerprint -> 服务端自己算指纹，派生同一个 id', async () => {
  const base = initBody({ size: 4096, lastModified: 1690000000000 });
  const fingerprint = uploadFingerprint({
    project: base.projectId, lineId: base.lineId, name: base.filename, size: base.size, lastModified: base.lastModified,
  });
  const withFp = await postJson('/api/upload/init', { ...base, fingerprint });
  const factsOnly = await postJson('/api/upload/init', base);
  created.push(withFp.body.uploadId);
  assert.equal(factsOnly.body.deterministic, true);
  assert.equal(factsOnly.body.uploadId, withFp.body.uploadId);
});

test('D: 既无 fingerprint 也无 size/lastModified -> 回落随机 UUID 且 deterministic=false（旧客户端兼容）', async () => {
  const res = await postJson('/api/upload/init', initBody({}));
  assert.equal(res.status, 200);
  assert.equal(res.body.deterministic, false);
  assert.match(res.body.uploadId, UUID_RE);
  created.push(res.body.uploadId);
});

test('D: 非法 fingerprint（数字 / 含 NUL / 超长）-> 400，不建任何会话目录', async () => {
  const base = initBody({ size: 10, lastModified: 20 });
  const bads = [123, null, 'a' + String.fromCharCode(0) + 'b', 'x'.repeat(1025)];
  for (const fingerprint of bads) {
    const res = await postJson('/api/upload/init', { ...base, fingerprint });
    assert.equal(res.status, 400, '非法 fingerprint 必须 400: ' + JSON.stringify(fingerprint));
    // 既有 upload 端点的错误体就是 { error }（没有 ok 字段），这里只钉住文案与状态码
    assert.match(res.body.error, /fingerprint/);
    assert.equal(res.body.uploadId, undefined, '400 时不能返回任何 uploadId');
  }
});

test('D: GC 抛异常（readdir 失败）不影响 init 成功', async () => {
  resetUploadGcThrottle();
  let readdirCalls = 0;
  const eacces = new Error('mock EACCES: /root/.uploads');
  eacces.code = 'EACCES';
  const fsMock = mock.method(fs, 'readdirSync', () => {
    readdirCalls += 1;
    throw eacces;
  });
  try {
    const res = await postJson('/api/upload/init', initBody({ size: 7, lastModified: 8 }));
    assert.equal(res.status, 200, 'GC 失败绝不能让上传请求失败');
    assert.equal(res.body.deterministic, true);
    created.push(res.body.uploadId);
    assert.ok(readdirCalls > 0, 'init 应惰性触发过 GC');
  } finally {
    fsMock.mock.restore();
    resetUploadGcThrottle();
  }
});
