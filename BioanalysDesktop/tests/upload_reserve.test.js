/**
 * P4 上传预留额度（reservedBytes）与 chunk 413 硬闸门测试（只增不改既有断言）
 *
 * 覆盖三块：
 *   A. 会话元数据读写：原子落盘（session.json.tmp -> rename）、缺字段归一、
 *      损坏降级、清理；全部在 os.tmpdir() 的临时根里跑，不碰真实 .uploads。
 *   B. 准入判定纯函数 checkReservedBytes / checkChunkAdmission：累计超额 413、
 *      边界（已收 + 本片 == 预留）放行、同序号重传不重复计数、413 优先于 507、
 *      无预留额度（老客户端）行为不变、非法参数 400。
 *   C. 真 HTTP：init 带 fileSize 落盘并回 reservedBytes、chunk 超额度 413 且不写盘、
 *      无 fileSize 时行为与改动前一致、413 优先于 507。
 *   D. complete 的清理语义（目录级）：成功后 cleanupUpload 把会话目录连同 session.json 一起删掉，
 *      且 session.json 不会被当成第 N 片混进拼装。
 *
 * 口径：reservedBytes 缺失或非法一律 null（不硬拦老客户端）；413 只拦「本会话额度不够」，
 * 全局空间不够仍由 507 报；两者同时成立时必须报 413（客户端能自己修的那个先报）。
 *
 * in-process 起真服务的原因同 tests/task_submit_validation.test.js：子进程形态没法替换 ssh。
 * 注意（实测结论）：mock.method(childProcess, ...) 拦不到 server/proc.js，因为 proc.js 用的是
 * 具名导入 `import { spawn, spawnSync } from 'node:child_process'`，具名绑定在导入时就固化，
 * 替换 module.exports 上的属性对它无效。所以本文件刻意只打到 init / chunk / status 三个
 * 不下发远端命令的端点；complete 会真跑 scp + ssh，一律不做 HTTP 级验证，只做目录级单元覆盖。
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';

import {
  CHUNK_SIZE, UPLOAD_ROOT, initUpload, writeChunk, listChunks, assembleChunks, cleanupUpload, uploadDir,
  SESSION_META_NAME, sessionMetaPath, normalizeReservedBytes, writeSessionMeta, readSessionMeta,
  clearSessionMeta, checkReservedBytes, checkChunkAdmission, uploadRootUsageBytes,
} from '../server/upload.js';

let counter = 0;
const created = [];

/** 每次唯一，避免并行测试文件 / 重复运行时互相踩目录 */
function newId(tag) {
  counter += 1;
  return `p4-${tag}-${process.pid}-${Date.now()}-${counter}`;
}

/** 临时上传根：本文件的纯函数测试全在这里跑，与真实 .uploads 完全隔离 */
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'bioanalys-p4-reserve-'));
let tmpSeq = 0;

/** 在临时根里造一个会话目录，返回 {id, dir} */
function tmpSession(tag) {
  tmpSeq += 1;
  const id = `p4-${tag}-${tmpSeq}`;
  const dir = path.join(TMP_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  return { id, dir };
}

const NO_QUOTA = Number.POSITIVE_INFINITY;

// ───────────── A. 会话元数据读写 ─────────────

test('P4: normalizeReservedBytes 只认有限非负数字，其余一律 null', () => {
  assert.equal(normalizeReservedBytes(undefined), null);
  assert.equal(normalizeReservedBytes(null), null);
  assert.equal(normalizeReservedBytes('100'), null, '字符串不是合法声明，降级为无额度');
  assert.equal(normalizeReservedBytes(''), null);
  assert.equal(normalizeReservedBytes(-1), null);
  assert.equal(normalizeReservedBytes(Number.NaN), null);
  assert.equal(normalizeReservedBytes(Number.POSITIVE_INFINITY), null);
  assert.equal(normalizeReservedBytes(true), null);
  assert.equal(normalizeReservedBytes(0), 0, '0 是合法声明（空文件）');
  assert.equal(normalizeReservedBytes(1024), 1024);
  assert.equal(normalizeReservedBytes(1024.9), 1024, '向下取整：额度只能小于等于声明值');
});

test('P4: writeSessionMeta 原子落盘（无 .tmp 残留、JSON 可解析、字段齐全）', () => {
  const { id, dir } = tmpSession('meta');
  const payload = writeSessionMeta(id, {
    name: 'sample.h5ad', project: 'default', lineId: 'line2_scrna', fileSize: 2048, reservedBytes: 2048,
  }, { root: TMP_ROOT });
  assert.equal(payload.reservedBytes, 2048);
  const metaPath = path.join(dir, SESSION_META_NAME);
  assert.equal(fs.existsSync(metaPath), true);
  assert.equal(fs.existsSync(path.join(dir, `${SESSION_META_NAME}.tmp`)), false, '临时文件必须已被 rename 掉');
  const onDisk = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  assert.equal(onDisk.uploadId, id);
  assert.equal(onDisk.name, 'sample.h5ad');
  assert.equal(onDisk.project, 'default');
  assert.equal(onDisk.lineId, 'line2_scrna');
  assert.equal(onDisk.fileSize, 2048);
  assert.equal(onDisk.reservedBytes, 2048);
  assert.match(onDisk.createdAt, /^\d{4}-\d{2}-\d{2}T/, 'createdAt 必须是 ISO 时间串');
  assert.deepEqual(readSessionMeta(id, { root: TMP_ROOT }).meta, onDisk);
});

test('P4: writeSessionMeta 覆盖写（同一会话重新 init 声明新 fileSize 时替换旧值）', () => {
  const { id, dir } = tmpSession('meta-overwrite');
  writeSessionMeta(id, { fileSize: 100, reservedBytes: 100 }, { root: TMP_ROOT });
  writeSessionMeta(id, { fileSize: 200, reservedBytes: 200 }, { root: TMP_ROOT });
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, SESSION_META_NAME), 'utf8'));
  assert.equal(onDisk.reservedBytes, 200);
  assert.equal(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')).length, 0);
});

test('P4: readSessionMeta 区分 not_found / corrupt / invalid_id，坏文件不抛出', () => {
  const { id, dir } = tmpSession('meta-read');
  assert.equal(readSessionMeta(id, { root: TMP_ROOT }).reason, 'not_found');
  fs.writeFileSync(path.join(dir, SESSION_META_NAME), '{"reservedBytes": 12');
  const broken = readSessionMeta(id, { root: TMP_ROOT });
  assert.equal(broken.ok, false);
  assert.equal(broken.reason, 'corrupt');
  assert.equal(broken.meta, null);
  fs.writeFileSync(path.join(dir, SESSION_META_NAME), '[1,2,3]');
  assert.equal(readSessionMeta(id, { root: TMP_ROOT }).reason, 'corrupt', 'JSON 数组不是合法元数据');
  const bad = readSessionMeta('../evil', { root: TMP_ROOT });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'invalid_id');
});

test('P4: clearSessionMeta 删得掉且重复调用不抛（不存在视为已清）', () => {
  const { id, dir } = tmpSession('meta-clear');
  writeSessionMeta(id, { fileSize: 10, reservedBytes: 10 }, { root: TMP_ROOT });
  assert.equal(clearSessionMeta(id, { root: TMP_ROOT }), true);
  assert.equal(fs.existsSync(path.join(dir, SESSION_META_NAME)), false);
  assert.equal(clearSessionMeta(id, { root: TMP_ROOT }), true, '文件已不存在也不应抛异常');
  assert.equal(sessionMetaPath('../evil', { root: TMP_ROOT }), null);
});

// ───────────── B. 准入判定 ─────────────

test('P4: checkReservedBytes 无额度放行 / 恰好等于放行 / 超 1 字节 413', () => {
  assert.equal(checkReservedBytes({ reservedBytes: null, receivedBytes: 0, chunkLength: 10 }).ok, true);
  assert.equal(checkReservedBytes({ reservedBytes: 10, receivedBytes: 6, chunkLength: 4 }).ok, true, '恰好等于预留额度必须放行');
  const over = checkReservedBytes({ reservedBytes: 10, receivedBytes: 6, chunkLength: 5 });
  assert.equal(over.ok, false);
  assert.equal(over.status, 413);
  assert.equal(over.reason, 'reserved_exceeded');
  assert.equal(over.error, '超出本次会话预留额度：已收 6 字节 + 本片 5 字节 > 预留 10 字节');
});

test('P4: checkChunkAdmission 无元数据（老会话）放行且 reservedBytes 为 null', () => {
  const { id } = tmpSession('adm-nometa');
  const verdict = checkChunkAdmission({ uploadId: id, index: 0, chunkLength: 4, root: TMP_ROOT, quotaBytes: NO_QUOTA });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.reservedBytes, null);
  assert.equal(verdict.receivedBytes, 0);
});

test('P4: 累计超额 413，且该分片一个字节都没写', () => {
  const { id, dir } = tmpSession('adm-over');
  writeSessionMeta(id, { fileSize: 10, reservedBytes: 10 }, { root: TMP_ROOT });
  fs.writeFileSync(path.join(dir, '0.part'), Buffer.from('AAAAAA'));   // 已收 6
  const verdict = checkChunkAdmission({ uploadId: id, index: 1, chunkLength: 5, root: TMP_ROOT, quotaBytes: NO_QUOTA });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.status, 413);
  assert.equal(verdict.receivedBytes, 6);
  assert.match(verdict.error, /超出本次会话预留额度：已收 6 字节 \+ 本片 5 字节 > 预留 10 字节/);
  assert.equal(fs.existsSync(path.join(dir, '1.part')), false, '被 413 拦下的分片不能落盘');
});

test('P4: 边界 已收 + 本片 == 预留额度 放行（最后一片顶到额度是正常收尾）', () => {
  const { id, dir } = tmpSession('adm-edge');
  writeSessionMeta(id, { fileSize: 10, reservedBytes: 10 }, { root: TMP_ROOT });
  fs.writeFileSync(path.join(dir, '0.part'), Buffer.from('AAAAAA'));
  const verdict = checkChunkAdmission({ uploadId: id, index: 1, chunkLength: 4, root: TMP_ROOT, quotaBytes: NO_QUOTA });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.receivedBytes, 6);
});

test('P4: 同序号重传按替换计，不被误判成超额（续传重发一片是常态）', () => {
  const { id, dir } = tmpSession('adm-rewrite');
  writeSessionMeta(id, { fileSize: 10, reservedBytes: 10 }, { root: TMP_ROOT });
  fs.writeFileSync(path.join(dir, '0.part'), Buffer.from('A'.repeat(10)));
  const verdict = checkChunkAdmission({ uploadId: id, index: 0, chunkLength: 10, root: TMP_ROOT, quotaBytes: NO_QUOTA });
  assert.equal(verdict.ok, true, '重写第 0 片不应把已收 10 字节重复计入');
  assert.equal(verdict.receivedBytes, 0, 'receivedBytes 只统计其他分片');
});

test('P4: session.json 损坏时降级为无预留额度，上传不被一个坏文件打死', () => {
  const { id, dir } = tmpSession('adm-corrupt');
  fs.writeFileSync(path.join(dir, SESSION_META_NAME), '{ this is not json');
  const verdict = checkChunkAdmission({ uploadId: id, index: 0, chunkLength: 4, root: TMP_ROOT, quotaBytes: NO_QUOTA });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.reservedBytes, null);
});

test('P4: 413 优先于 507（本会话额度不够且全局也满时，先报客户端能自己修的 413）', () => {
  const { id, dir } = tmpSession('adm-priority');
  writeSessionMeta(id, { fileSize: 2, reservedBytes: 2 }, { root: TMP_ROOT });
  fs.writeFileSync(path.join(dir, '0.part'), Buffer.from('AA'));
  const verdict = checkChunkAdmission({ uploadId: id, index: 1, chunkLength: 4, root: TMP_ROOT, quotaBytes: 0 });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.status, 413, '两个闸门同时触发时必须报 413，不能报 507');
  assert.equal(verdict.reason, 'reserved_exceeded');
});

test('P4: 无预留额度但超过总量配额 -> 507（全局空间满）', () => {
  const { id, dir } = tmpSession('adm-quota');
  fs.writeFileSync(path.join(dir, '0.part'), Buffer.from('AAAA'));
  const verdict = checkChunkAdmission({ uploadId: id, index: 1, chunkLength: 4, root: TMP_ROOT, quotaBytes: 1 });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.status, 507);
  assert.equal(verdict.reason, 'quota_exceeded');
  assert.match(verdict.error, /上传暂存空间已满/);
});

test('P4: 非法 uploadId / 非法序号 / 非法长度一律 400（不下探文件系统）', () => {
  const badId = checkChunkAdmission({ uploadId: '../evil', index: 0, chunkLength: 1, root: TMP_ROOT, quotaBytes: NO_QUOTA });
  assert.equal(badId.status, 400);
  assert.equal(badId.reason, 'invalid_id');
  const { id } = tmpSession('adm-bad');
  const badIndex = checkChunkAdmission({ uploadId: id, index: 'abc', chunkLength: 1, root: TMP_ROOT, quotaBytes: NO_QUOTA });
  assert.equal(badIndex.status, 400);
  assert.equal(badIndex.reason, 'invalid_index');
  const badLen = checkChunkAdmission({ uploadId: id, index: 0, chunkLength: -1, root: TMP_ROOT, quotaBytes: NO_QUOTA });
  assert.equal(badLen.status, 400);
  assert.equal(badLen.reason, 'invalid_length');
});

test('P4: uploadRootUsageBytes 只统计合法会话目录里的扁平文件', () => {
  const root = path.join(TMP_ROOT, 'usage-root');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, 'p4-a'), { recursive: true });
  fs.writeFileSync(path.join(root, 'p4-a', '0.part'), Buffer.alloc(3));
  fs.writeFileSync(path.join(root, 'p4-a', '1.part'), Buffer.alloc(4));
  fs.mkdirSync(path.join(root, 'p4-b'), { recursive: true });
  fs.writeFileSync(path.join(root, 'p4-b', '0.part'), Buffer.alloc(5));
  fs.writeFileSync(path.join(root, 'loose.txt'), Buffer.alloc(9));       // 根下裸文件不计
  fs.mkdirSync(path.join(root, '.hidden'), { recursive: true });         // 隐藏名不是合法会话
  fs.writeFileSync(path.join(root, '.hidden', '0.part'), Buffer.alloc(2));
  assert.equal(uploadRootUsageBytes({ root }), 12);
  assert.equal(uploadRootUsageBytes({ root: path.join(TMP_ROOT, 'not-exist') }), 0, '根不存在按 0 计');
});

// ───────────── C. 真 HTTP ─────────────

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
const BASE = `http://127.0.0.1:${PORT}`;
const sshCalls = [];

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
  const { mock } = await import('node:test');
  mock.method(childProcess, 'spawnSync', (cmd, args) => {
    sshCalls.push({ kind: 'spawnSync', cmd, joined: (args || []).join(' ') });
    return { status: 0, stdout: '', stderr: '' };
  });
  mock.method(childProcess, 'spawn', (cmd, args) => {
    sshCalls.push({ kind: 'spawn', cmd, joined: (args || []).join(' ') });
    return fakeChild(1);
  });
  await import('../server/index.js');
  const deadline = Date.now() + 25000;
  for (;;) {
    try {
      const response = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) break;
    } catch { /* 没起来就继续等 */ }
    if (Date.now() > deadline) throw new Error(`服务 25s 内没就绪（端口 ${PORT}）`);
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
  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch { /* 临时目录清理失败不影响结论 */ }
});

async function postJson(pathname, body) {
  const response = await fetch(BASE + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { response, body: await response.json() };
}

async function postChunk(uploadId, index, buf) {
  const response = await fetch(
    `${BASE}/api/upload/chunk?uploadId=${encodeURIComponent(uploadId)}&index=${index}`,
    { method: 'POST', body: buf, signal: AbortSignal.timeout(5000) },
  );
  return { response, body: await response.json() };
}

async function initUploadHttp(extra) {
  const { response, body } = await postJson('/api/upload/init', {
    projectId: 'default', lineId: 'line1_bulk', filename: 'reserve_http.txt', ...extra,
  });
  if (body && body.uploadId) created.push(body.uploadId);
  return { response, body };
}

test('P4 HTTP: init 带 fileSize -> 200 + reservedBytes 数字 + session.json 与响应一致', async () => {
  const { response, body } = await initUploadHttp({ fileSize: 8192 });
  assert.equal(response.status, 200);
  assert.equal(body.reservedBytes, 8192);
  assert.equal(body.ok, undefined, 'init 成功体不新增 ok 字段（保持既有契约）');
  assert.equal(body.chunkSize, CHUNK_SIZE);
  const metaPath = sessionMetaPath(body.uploadId);
  assert.ok(metaPath && fs.existsSync(metaPath), 'session.json 必须已落盘');
  const onDisk = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  assert.equal(onDisk.reservedBytes, 8192);
  assert.equal(onDisk.fileSize, 8192);
  assert.equal(onDisk.name, 'reserve_http.txt');
  assert.equal(onDisk.lineId, 'line1_bulk');
});

test('P4 HTTP: init 不带 fileSize -> reservedBytes 为 null，元数据落盘但无额度', async () => {
  const { response, body } = await initUploadHttp({});
  assert.equal(response.status, 200);
  assert.equal(body.reservedBytes, null);
  const onDisk = JSON.parse(fs.readFileSync(sessionMetaPath(body.uploadId), 'utf8'));
  assert.equal(onDisk.reservedBytes, null);
});

test('P4 HTTP: init fileSize 非法（字符串 / 负数）-> reservedBytes 为 null，不硬拦', async () => {
  const asString = await initUploadHttp({ fileSize: '100' });
  assert.equal(asString.response.status, 200, '非法 fileSize 不能把 init 打成 400');
  assert.equal(asString.body.reservedBytes, null);
  const negative = await initUploadHttp({ fileSize: -5 });
  assert.equal(negative.response.status, 200);
  assert.equal(negative.body.reservedBytes, null);
});

test('P4 HTTP: chunk 超预留额度 -> 413 + 错误文案 + 未写盘 + 合法分片仍可传', async () => {
  const { body: init } = await initUploadHttp({ fileSize: 8, filename: 'reserve_gate.txt' });
  const uploadId = init.uploadId;
  const first = await postChunk(uploadId, 0, Buffer.from('AAAABBBB'));
  assert.equal(first.response.status, 200, '恰好 8 字节必须放行');
  const over = await postChunk(uploadId, 1, Buffer.from('CCCC'));
  assert.equal(over.response.status, 413);
  assert.equal(over.body.ok, false);
  assert.match(over.body.error, /超出本次会话预留额度：已收 8 字节 \+ 本片 4 字节 > 预留 8 字节/);
  assert.deepEqual(listChunks(uploadId), [0], '被 413 拦下的分片不能落盘');
  // 幂等重传第 0 片仍应放行（替换计，不重复累加）
  const rewrite = await postChunk(uploadId, 0, Buffer.from('AAAABBBB'));
  assert.equal(rewrite.response.status, 200);
  assert.deepEqual(rewrite.body.received, [0]);
});

test('P4 HTTP: 无 fileSize 的会话 chunk 行为与改动前一致（不触发 413）', async () => {
  const { body: init } = await initUploadHttp({ filename: 'reserve_legacy.txt' });
  const uploadId = init.uploadId;
  const part = Buffer.from('0123456789');
  for (const i of [0, 1, 2]) {
    const res = await postChunk(uploadId, i, part);
    assert.equal(res.response.status, 200, `第 ${i} 片应放行`);
    assert.equal(res.body.ok, true);
  }
  assert.deepEqual(listChunks(uploadId), [0, 1, 2]);
});

test('P4 HTTP: 413 优先于 507（全局配额压到 1 字节时仍报 413）', async () => {
  const { body: init } = await initUploadHttp({ fileSize: 2, filename: 'reserve_priority.txt' });
  const uploadId = init.uploadId;
  const ok = await postChunk(uploadId, 0, Buffer.from('AA'));
  assert.equal(ok.response.status, 200);
  const previous = process.env.BIO_UPLOAD_QUOTA_BYTES;
  process.env.BIO_UPLOAD_QUOTA_BYTES = '1';
  try {
    const over = await postChunk(uploadId, 1, Buffer.from('BBBB'));
    assert.equal(over.response.status, 413, '本会话额度不够 + 全局也满时，必须报客户端能自己修的 413');
    assert.match(over.body.error, /超出本次会话预留额度/);
  } finally {
    if (previous === undefined) delete process.env.BIO_UPLOAD_QUOTA_BYTES;
    else process.env.BIO_UPLOAD_QUOTA_BYTES = previous;
  }
});

// ───────────── D. complete 的清理语义（目录级） ─────────────
// complete 会真下发 scp + ssh（proc.js 的具名导入拦不住，见文件头注释），
// 因此这里只验证它依赖的目录语义：会话目录删掉 = session.json 一并没了。

test('P4: cleanupUpload 把会话目录连 session.json 一起清掉（complete 成功路径依赖它）', () => {
  const uploadId = newId('cleanup-meta');
  created.push(uploadId);
  writeSessionMeta(uploadId, { name: 'cleanup_meta.txt', project: 'default', lineId: 'line1_bulk', fileSize: 5 });
  writeChunk(uploadId, 0, Buffer.from('hello'));
  const dir = uploadDir(uploadId);
  assert.equal(fs.existsSync(sessionMetaPath(uploadId)), true, '前置：元数据已落盘');
  cleanupUpload(uploadId);
  assert.equal(fs.existsSync(dir), false, '会话目录必须整体删掉，session.json 不能残留');
  assert.equal(readSessionMeta(uploadId).ok, false, '清理后再读元数据只能是 not_found');
  assert.equal(readSessionMeta(uploadId).reason, 'not_found');
});

test('P4: session.json 不参与分片拼装（元数据文件不会被当成第 N 片）', () => {
  const uploadId = newId('meta-not-chunk');
  created.push(uploadId);
  writeChunk(uploadId, 0, Buffer.from('hello '));
  writeSessionMeta(uploadId, { name: 'meta_not_chunk.txt', fileSize: 11 });
  writeChunk(uploadId, 1, Buffer.from('world'));
  assert.deepEqual(listChunks(uploadId), [0, 1], 'listChunks 只认 <idx>.part，session.json 不算分片');
  const outPath = assembleChunks(uploadId, 'meta_not_chunk.txt');
  assert.equal(fs.readFileSync(outPath, 'utf8'), 'hello world');
});
