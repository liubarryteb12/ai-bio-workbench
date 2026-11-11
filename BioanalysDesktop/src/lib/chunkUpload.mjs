/**
 * 分片上传传输层：把「init -> status -> chunk... -> complete」这条链收成一个纯函数，
 * 供上传 UI（含 Uppy 插件）与 node 契约测试共用同一份实现。
 *
 * 会话 id 由「项目 + 归属线 + 文件名 + 大小 + 修改时间」确定性派生，
 * 刷新、换浏览器、换设备都会先查 status，从已落盘分片之后继续。
 */
import { uploadFingerprint, uploadIdFromFingerprint } from '../../../shared/upload_session.mjs';

export const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;

function abortError() {
  const cause = new Error('上传已中止');
  cause.name = 'AbortError';
  return cause;
}

async function readJson(response, what) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${what} 返回的不是 JSON`);
  }
  if (payload && payload.error) throw new Error(String(payload.error));
  return payload || {};
}

async function fetchStatus(uploadId, fetchImpl) {
  const response = await fetchImpl(`/api/upload/status?uploadId=${encodeURIComponent(uploadId)}`);
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  return payload && payload.exists ? payload : null;
}

/**
 * 上传一个文件并从断点续传。
 *
 * @param {object} options
 * @param {{name: string, size: number, lastModified: number, slice: Function}} options.file
 * @param {string} options.project
 * @param {string} options.lineId
 * @param {Function} [options.fetchImpl]
 * @param {(percent: number, detail: {sentChunks: number, totalChunks: number, resumedFrom: number}) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 */
export async function uploadInChunks({
  file,
  project,
  lineId,
  fetchImpl = globalThis.fetch,
  onProgress = () => {},
  signal = null,
} = {}) {
  if (!file || typeof file.slice !== 'function') throw new Error('缺少可切片的文件对象');
  if (!project) throw new Error('缺少项目 id');
  if (!lineId) throw new Error('缺少归属线');
  if (typeof fetchImpl !== 'function') throw new Error('缺少 fetch 实现');

  const fingerprint = uploadFingerprint({
    project,
    lineId,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
  });
  let uploadId = uploadIdFromFingerprint(fingerprint) || null;
  let chunkSize = 0;
  let nextIndex = 0;

  if (uploadId) {
    const previous = await fetchStatus(uploadId, fetchImpl);
    if (previous && typeof previous.chunkSize === 'number') {
      chunkSize = previous.chunkSize;
      nextIndex = typeof previous.nextIndex === 'number' ? previous.nextIndex : 0;
    } else {
      uploadId = null;
    }
  }

  if (!uploadId) {
    const initRes = await fetchImpl('/api/upload/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: project, lineId, filename: file.name, fingerprint }),
    });
    const init = await readJson(initRes, 'init');
    uploadId = String(init.uploadId || '');
    chunkSize = Number(init.chunkSize) || 0;
    if (!uploadId) throw new Error('init 未返回 uploadId');
    const initial = await fetchStatus(uploadId, fetchImpl);
    if (initial) {
      if (typeof initial.nextIndex === 'number') nextIndex = initial.nextIndex;
      if (typeof initial.chunkSize === 'number') chunkSize = initial.chunkSize;
    }
  }

  if (!chunkSize || chunkSize <= 0) chunkSize = DEFAULT_CHUNK_SIZE;
  const total = Math.max(1, Math.ceil(file.size / chunkSize));
  const startIndex = Math.min(Math.max(0, nextIndex), total);

  for (let index = startIndex; index < total; index += 1) {
    if (signal?.aborted) throw abortError();
    const blob = file.slice(index * chunkSize, (index + 1) * chunkSize);
    const response = await fetchImpl(
      `/api/upload/chunk?uploadId=${encodeURIComponent(uploadId)}&index=${index}`,
      { method: 'POST', body: blob, signal },
    );
    if (!response.ok) throw new Error(`分片 ${index} 上传失败（HTTP ${response.status}）`);
    onProgress(Math.round(((index + 1) / total) * 100), {
      sentChunks: index + 1,
      totalChunks: total,
      resumedFrom: startIndex,
    });
  }

  if (signal?.aborted) throw abortError();
  const completeRes = await fetchImpl('/api/upload/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: project, uploadId, lineId, filename: file.name }),
  });
  const result = await readJson(completeRes, 'complete');
  onProgress(100, { sentChunks: total, totalChunks: total, resumedFrom: startIndex });
  return { uploadId, resumedFrom: startIndex, totalChunks: total, result };
}
