/**
 * S32 上传断点续传测试（只增不改既有断言）
 *
 * 覆盖三块：
 *   A. uploadStatus 纯函数：空会话 / 连续三片 / 空洞 / 脏文件名 / 路径穿越 uploadId / 未创建。
 *   B. GET /api/upload/status 真 HTTP：缺失 400、非法 400、未传过 200 not_found、
 *      已传分片 200 且既有 received 键保留（向后兼容）、nextIndex 计算。
 *   C. 本地端到端：init -> writeChunk 0,1 -> status nextIndex=2 -> 补 2 -> assemble 字节与 md5 一致。
 *
 * 口径（与 server/upload.js 的 uploadStatus 注释一致）：nextIndex 取「从 0 开始第一个缺失的分片序号」，
 * 即最小缺失口径，[0,1,3] -> 2；不用「连续段长度」口径。
 *
 * 前端续传判定（App.tsx 里的 uploadFingerprint / resumeStartIndex / 会话缓存）是 .tsx 内的
 * 模块私有函数，node --test 无法 import .tsx，只能靠 tsc + 人工核对，本文件不假装覆盖
 * （S32_report.md 第 5 节如实记录）。
 *
 * in-process 起真服务的原因同 tests/task_submit_validation.test.js：子进程形态没法替换 ssh，
 * 这里虽然 status 端点不碰 ssh，仍沿用同一垫片范式，保证任何意外下发都被记录而不是真连 K40。
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';

import {
  CHUNK_SIZE, UPLOAD_ROOT, initUpload, writeChunk, listChunks, assembleChunks,
  cleanupUpload, uploadStatus, uploadDir,
} from '../server/upload.js';

let counter = 0;
const created = [];

/** 每次唯一，避免并行测试文件/重复运行时互相踩目录 */
function newId(tag) {
  counter += 1;
  return `s32-${tag}-${process.pid}-${Date.now()}-${counter}`;
}

/** 建一个会话目录并登记，测试结束统一清理 */
function makeSession(tag) {
  const uploadId = newId(tag);
  initUpload(uploadId);
  created.push(uploadId);
  return uploadId;
}

const md5 = (buf) => createHash('md5').update(buf).digest('hex');

// ───────────── A. uploadStatus 纯函数 ─────────────

test('S32: 空会话（init 后未传）-> ok / exists / nextIndex 0', () => {
  const uploadId = makeSession('empty');
  const status = uploadStatus(uploadId);
  assert.equal(status.ok, true);
  assert.equal(status.exists, true);
  assert.deepEqual(status.chunks, []);
  assert.equal(status.nextIndex, 0);
  assert.equal(status.receivedBytes, 0);
  assert.equal(status.chunkSize, CHUNK_SIZE);
});

test('S32: 连续三片 -> chunks [0,1,2]、nextIndex 3、receivedBytes 为各片字节和', () => {
  const uploadId = makeSession('cont');
  writeChunk(uploadId, 0, Buffer.from('aaa'));
  writeChunk(uploadId, 1, Buffer.from('bbbb'));
  writeChunk(uploadId, 2, Buffer.from('ccccc'));
  const status = uploadStatus(uploadId);
  assert.deepEqual(status.chunks, [0, 1, 2]);
  assert.equal(status.nextIndex, 3);
  assert.equal(status.receivedBytes, 3 + 4 + 5);
});

test('S32: 有空洞 [0,1,3] -> nextIndex 按最小缺失算为 2（口径写进注释与断言）', () => {
  const uploadId = makeSession('gap');
  writeChunk(uploadId, 0, Buffer.from('a'));
  writeChunk(uploadId, 1, Buffer.from('b'));
  writeChunk(uploadId, 3, Buffer.from('d'));
  const status = uploadStatus(uploadId);
  assert.deepEqual(status.chunks, [0, 1, 3]);
  assert.equal(status.nextIndex, 2, '最小缺失口径：[0,1,3] 的下一个待传是 2，不是 4');
});

test('S32: 缺第 0 片 [1,2] -> nextIndex 0（必须从头发起，不能跳过 0 直接 assemble）', () => {
  const uploadId = makeSession('nozero');
  writeChunk(uploadId, 1, Buffer.from('b'));
  writeChunk(uploadId, 2, Buffer.from('c'));
  assert.equal(uploadStatus(uploadId).nextIndex, 0);
});

test('S32: 脏文件名被忽略且不影响判定（非 .part / 解析不出序号 / 负序号）', () => {
  const uploadId = makeSession('dirty');
  writeChunk(uploadId, 0, Buffer.from('ok'));
  const dir = uploadDir(uploadId);
  fs.writeFileSync(path.join(dir, 'abc.part'), 'x');        // 解析不出序号
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');       // 非 .part
  fs.writeFileSync(path.join(dir, '1.part.part'), 'x');     // 双后缀解析不出序号
  fs.writeFileSync(path.join(dir, '-1.part'), 'x');         // 负序号
  const status = uploadStatus(uploadId);
  assert.deepEqual(status.chunks, [0]);
  assert.equal(status.nextIndex, 1);
  assert.equal(status.receivedBytes, 2);
});

test('S32: uploadId 路径穿越一律 invalid_id（不落到文件系统）', () => {
  for (const bad of ['..', '../evil', 'a/b', 'a\\b', '.hidden', '']) {
    const status = uploadStatus(bad);
    assert.equal(status.ok, false, `${JSON.stringify(bad)} 必须被拒`);
    assert.equal(status.reason, 'invalid_id', `${JSON.stringify(bad)} 原因必须是 invalid_id`);
    assert.equal(status.exists, false);
    assert.deepEqual(status.chunks, []);
    assert.equal(status.nextIndex, 0);
  }
});

test('S32: 合法但从未创建的 uploadId -> not_found，exists false、chunks 空', () => {
  const status = uploadStatus('s32-never-existed-' + Date.now());
  assert.equal(status.ok, false);
  assert.equal(status.reason, 'not_found');
  assert.equal(status.exists, false);
  assert.deepEqual(status.chunks, []);
  assert.equal(status.receivedBytes, 0);
  assert.equal(status.chunkSize, CHUNK_SIZE);
});

test('S32: CHUNK_SIZE 语义保持 4MB（不为迁就文档改 5MB）', () => {
  assert.equal(CHUNK_SIZE, 4 * 1024 * 1024);
  assert.equal(uploadStatus(makeSession('chunk')).chunkSize, 4 * 1024 * 1024);
});

// ───────────── B. GET /api/upload/status 真 HTTP ─────────────

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
});

async function getStatus(uploadId) {
  const qs = uploadId === undefined ? '' : `?uploadId=${encodeURIComponent(uploadId)}`;
  const response = await fetch(`${BASE}/api/upload/status${qs}`, { signal: AbortSignal.timeout(5000) });
  return { response, body: await response.json() };
}

test('S32 HTTP: 缺 uploadId -> 400 且 ok=false', async () => {
  const { response, body } = await getStatus();
  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.match(body.error, /uploadId/);
});

test('S32 HTTP: 非法 uploadId（路径穿越）-> 400，不下探文件系统', async () => {
  const { response, body } = await getStatus('../etc');
  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.match(body.error, /uploadId/);
});

test('S32 HTTP: 未传过 -> 200 + not_found（不是 404，前端据此从 0 开始）', async () => {
  const { response, body } = await getStatus('s32-http-never-' + Date.now());
  assert.equal(response.status, 200);
  assert.equal(body.ok, false);
  assert.equal(body.reason, 'not_found');
  assert.equal(body.exists, false);
  assert.deepEqual(body.received, [], '既有 received 键必须保留');
  assert.deepEqual(body.chunks, []);
  assert.equal(body.nextIndex, 0);
  assert.equal(body.receivedBytes, 0);
  assert.equal(body.chunkSize, CHUNK_SIZE);
});

test('S32 HTTP: 已传 0,1 -> 200 + nextIndex 2，received 与 chunks 同内容（向后兼容）', async () => {
  const uploadId = makeSession('http');
  writeChunk(uploadId, 0, Buffer.from('hello '));
  writeChunk(uploadId, 1, Buffer.from('world'));
  const { response, body } = await getStatus(uploadId);
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.exists, true);
  assert.deepEqual(body.chunks, [0, 1]);
  assert.deepEqual(body.received, [0, 1], '既有 received 键保持与 chunks 一致');
  assert.equal(body.nextIndex, 2);
  assert.equal(body.receivedBytes, 11);
  assert.equal(body.chunkSize, CHUNK_SIZE);
});

test('S32 HTTP: status 端点不触发任何 ssh/scp（垫片计数为 0）', async () => {
  sshCalls.length = 0;
  await getStatus('s32-http-noop-' + Date.now());
  assert.equal(sshCalls.length, 0, `status 不应下发远端命令: ${JSON.stringify(sshCalls)}`);
});

test('S32 HTTP E2E: init -> POST chunk 0,1 -> status nextIndex=2 -> 补 2 -> assemble 字节正确', async () => {
  const initRes = await fetch(`${BASE}/api/upload/init`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 'default', lineId: 'line1_bulk', filename: 'resume_e2e.bin' }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(initRes.status, 200);
  const init = await initRes.json();
  assert.equal(init.chunkSize, CHUNK_SIZE);
  const uploadId = init.uploadId;
  created.push(uploadId);
  const parts = [Buffer.from('AAAA'), Buffer.from('BBBB'), Buffer.from('CCCC')];
  for (const i of [0, 1]) {
    const r = await fetch(
      `${BASE}/api/upload/chunk?uploadId=${encodeURIComponent(uploadId)}&index=${i}`,
      { method: 'POST', body: parts[i], signal: AbortSignal.timeout(5000) },
    );
    assert.equal(r.status, 200);
  }
  const mid = await getStatus(uploadId);
  assert.equal(mid.body.ok, true);
  assert.equal(mid.body.nextIndex, 2, '两片已落盘，前端应从第 2 片续传');
  assert.equal(mid.body.receivedBytes, 8);
  for (let i = mid.body.nextIndex; i < parts.length; i += 1) {
    const r = await fetch(
      `${BASE}/api/upload/chunk?uploadId=${encodeURIComponent(uploadId)}&index=${i}`,
      { method: 'POST', body: parts[i], signal: AbortSignal.timeout(5000) },
    );
    assert.equal(r.status, 200);
  }
  const done = await getStatus(uploadId);
  assert.equal(done.body.nextIndex, 3);
  assert.equal(done.body.receivedBytes, 12);
  const out = assembleChunks(uploadId, 'resume_e2e.bin');
  assert.equal(fs.readFileSync(out).toString(), 'AAAABBBBCCCC');
});

// ───────────── C. 本地端到端续传 ─────────────

test('S32 E2E: init -> 0,1 -> status nextIndex=2 -> 补 2 -> assemble 字节与 md5 一致', () => {
  const uploadId = makeSession('e2e');
  const part = Buffer.from('0123456789');
  const original = Buffer.concat([part, part, part]);   // 3 片，模拟 3 个分片
  writeChunk(uploadId, 0, part);
  writeChunk(uploadId, 1, part);
  const status = uploadStatus(uploadId);
  assert.equal(status.nextIndex, 2, '已收 2 片，应从第 2 片续传');
  assert.equal(status.receivedBytes, part.length * 2);
  // 模拟前端：从 nextIndex 起补传剩余分片
  const total = 3;
  for (let i = status.nextIndex; i < total; i += 1) writeChunk(uploadId, i, part);
  const out = assembleChunks(uploadId, 'merged_resume.bin');
  const merged = fs.readFileSync(out);
  assert.equal(merged.length, original.length);
  assert.equal(md5(merged), md5(original), '续传合并后的 md5 必须与完整文件一致');
});

test('S32 E2E: 续传只补缺失片，已收分片不重传（写入次数 = total - nextIndex）', () => {
  const uploadId = makeSession('e2e-skip');
  const chunk = Buffer.from('x'.repeat(16));
  const total = 5;
  // 先传 0,1，再模拟中断（第 2 片失败，3、4 未传）
  writeChunk(uploadId, 0, chunk);
  writeChunk(uploadId, 1, chunk);
  const status = uploadStatus(uploadId);
  let writes = 0;
  for (let i = status.nextIndex; i < total; i += 1) { writeChunk(uploadId, i, chunk); writes += 1; }
  assert.equal(writes, total - status.nextIndex);
  assert.deepEqual(listChunks(uploadId), [0, 1, 2, 3, 4]);
  const out = assembleChunks(uploadId, 'merged_skip.bin');
  assert.equal(fs.statSync(out).size, chunk.length * total);
});

test('S32 E2E: 续传时重写同一分片是幂等的（覆盖写，不追加）', () => {
  const uploadId = makeSession('e2e-idem');
  const a = Buffer.from('AAAA');
  const b = Buffer.from('BBBB');
  writeChunk(uploadId, 0, a);
  writeChunk(uploadId, 1, b);
  writeChunk(uploadId, 1, b);   // 前端从 nextIndex 起传时可能重发一片
  assert.equal(uploadStatus(uploadId).receivedBytes, a.length + b.length);
  const out = assembleChunks(uploadId, 'merged_idem.bin');
  assert.equal(fs.readFileSync(out).toString(), 'AAAABBBB');
});

test('S32 E2E: 空目录 assemble 仍报「没有任何分片」（既有行为不变）', () => {
  const uploadId = makeSession('e2e-empty');
  assert.throws(() => assembleChunks(uploadId, 'x.bin'), /没有任何分片/);
});

test('S32: 测试结束后 .uploads 根目录存在且本文件会话可清理', () => {
  assert.equal(fs.existsSync(UPLOAD_ROOT), true);
  const uploadId = makeSession('cleanup');
  cleanupUpload(uploadId);
  assert.equal(fs.existsSync(path.join(UPLOAD_ROOT, uploadId)), false);
});
