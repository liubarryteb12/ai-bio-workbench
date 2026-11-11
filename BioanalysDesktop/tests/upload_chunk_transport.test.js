/**
 * 分片上传传输层契约：init -> status -> chunk -> complete，含断点续传与中止。
 * 用假 fetch 记录调用序列，不碰真实服务。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadInChunks } from '../src/lib/chunkUpload.mjs';

function makeFile(bytes = 10, name = 'expr.csv') {
  return new File([new Uint8Array(bytes).fill(1)], name, { lastModified: 1762260000000 });
}

function recorder(handlers) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body });
    const handler = Object.entries(handlers).find(([prefix]) => String(url).startsWith(prefix));
    if (!handler) throw new Error(`未预期的请求: ${url}`);
    return handler[1](url, options);
  };
  return { fetchImpl, calls };
}

function json(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

test('全新上传：init 后逐片上传，最后 complete，进度到 100', async () => {
  const file = makeFile(10);
  const progress = [];
  const { fetchImpl, calls } = recorder({
    '/api/upload/init': () => json({ uploadId: 'up-abc', chunkSize: 4 }),
    '/api/upload/status': () => json({ exists: false }),
    '/api/upload/chunk': () => json({ ok: true }),
    '/api/upload/complete': () => json({ ok: true, validation: { ok: true } }),
  });

  const out = await uploadInChunks({
    file, project: 'PRJ_1', lineId: 'line1_bulk', fetchImpl,
    onProgress: (percent) => progress.push(percent),
  });

  assert.equal(out.uploadId, 'up-abc');
  assert.equal(out.totalChunks, 3, '10 字节按 4 字节切片应为 3 片');
  assert.equal(progress.at(-1), 100);
  assert.equal(calls.filter((c) => c.url.startsWith('/api/upload/chunk')).length, 3);
  assert.equal(calls.at(-1).url, '/api/upload/complete');
});

test('断点续传：status 给出 nextIndex 时只补剩余分片', async () => {
  const file = makeFile(10);
  let statusQueries = 0;
  const { fetchImpl, calls } = recorder({
    '/api/upload/status': () => {
      statusQueries += 1;
      return json({ exists: true, chunkSize: 4, nextIndex: 2 });
    },
    '/api/upload/chunk': () => json({ ok: true }),
    '/api/upload/complete': () => json({ ok: true }),
  });

  const out = await uploadInChunks({ file, project: 'PRJ_1', lineId: 'line1_bulk', fetchImpl });

  assert.equal(statusQueries, 1);
  assert.equal(out.resumedFrom, 2);
  const chunkUrls = calls.filter((c) => c.url.startsWith('/api/upload/chunk')).map((c) => c.url);
  assert.equal(chunkUrls.length, 1, '只应补传第 3 片');
  assert.match(chunkUrls[0], /index=2/);
});

test('中止：signal 触发后不再发分片，也不发 complete', async () => {
  const file = makeFile(100);
  const controller = new AbortController();
  const { fetchImpl, calls } = recorder({
    '/api/upload/init': () => json({ uploadId: 'up-abc', chunkSize: 10 }),
    '/api/upload/status': () => json({ exists: false }),
    '/api/upload/chunk': () => {
      controller.abort();
      return json({ ok: true });
    },
    '/api/upload/complete': () => json({ ok: true }),
  });

  await assert.rejects(
    uploadInChunks({
      file, project: 'PRJ_1', lineId: 'line1_bulk', fetchImpl, signal: controller.signal,
    }),
    (cause) => cause.name === 'AbortError',
  );
  assert.equal(calls.filter((c) => c.url.startsWith('/api/upload/complete')).length, 0);
});

test('分片失败：错误信息带分片序号，便于定位', async () => {
  const file = makeFile(20);
  const { fetchImpl } = recorder({
    '/api/upload/init': () => json({ uploadId: 'up-abc', chunkSize: 5 }),
    '/api/upload/status': () => json({ exists: false }),
    '/api/upload/chunk': (url) => (url.includes('index=1') ? json({ error: 'x' }, 500) : json({ ok: true })),
    '/api/upload/complete': () => json({ ok: true }),
  });

  await assert.rejects(
    uploadInChunks({ file, project: 'PRJ_1', lineId: 'line1_bulk', fetchImpl }),
    /分片 1 上传失败/,
  );
});
