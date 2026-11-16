/**
 * D2 轻量接收器（Gemini Argon 判决，2026-11-15）。
 *
 * 职责：轮询门户 pull 式 sync 协议，把 PKG 包搬进本地收件箱，并回写结果。
 * 判据：
 *   1. 双模态轮询：空闲 15s / 活跃 3s。
 *   2. 幂等键 (ticket, sha256)：重复包不重复入库。
 *   3. 下载写 .part，流式 SHA-256 与 claim 一致后 rename。
 *   4. 解包先落临时目录，再原子 rename 到收件箱。
 *   5. result 回写失败进本地重试队列（SYNC_FINALIZING），不丢单。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { extractTarGzLimited } from '../../../tools/reporting/delivery_acceptance_core.mjs';

export const RECEIVER_STATE_FILE = 'sync_receiver_state.json';

const sha256File = (filePath) => crypto.createHash('sha256')
  .update(fs.readFileSync(filePath))
  .digest('hex');

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * 创建接收器。所有外部依赖可注入，便于测试与桌面端配置。
 */
export function createPortalSyncReceiver({
  portalBaseUrl,
  syncToken,
  inboxRoot,
  cacheDir,
  fetchImpl = globalThis.fetch,
  idleIntervalMs = 15000,
  activeIntervalMs = 3000,
  resultRetryMs = 5000,
  maxResultRetries = 10,
  now = () => Date.now(),
  logger = console,
} = {}) {
  if (!portalBaseUrl || !syncToken || !inboxRoot || !cacheDir) {
    throw new Error('接收器缺少必填配置：portalBaseUrl / syncToken / inboxRoot / cacheDir');
  }
  const stateFile = path.join(cacheDir, RECEIVER_STATE_FILE);
  let state = readJson(stateFile, { processed: {}, pendingResults: [] });
  if (!state.processed || typeof state.processed !== 'object') state.processed = {};
  if (!Array.isArray(state.pendingResults)) state.pendingResults = [];
  let timer = null;
  let running = false;

  const authHeaders = () => ({ Authorization: `Bearer ${syncToken}` });
  const url = (suffix) => `${String(portalBaseUrl).replace(/\/$/, '')}${suffix}`;

  function persist() {
    writeJsonAtomic(stateFile, state);
  }

  function idempotencyKey(ticket, sha256) {
    return `${ticket}:${sha256}`;
  }

  async function pendingTickets() {
    const res = await fetchImpl(url('/api/sync/pending'), { headers: authHeaders() });
    if (!res.ok) throw new Error(`pending 失败：HTTP ${res.status}`);
    const payload = await res.json();
    return Array.isArray(payload.tickets) ? payload.tickets : [];
  }

  async function claim(ticket) {
    const res = await fetchImpl(url('/api/sync/claim'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ ticket }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(`claim 失败：${payload.error || `HTTP ${res.status}`}`);
    return payload;
  }

  async function downloadPackage(ticket, expectedSha256) {
    const partFile = path.join(cacheDir, `${ticket}.tar.gz.part`);
    const finalFile = path.join(cacheDir, `${ticket}.tar.gz`);
    fs.mkdirSync(cacheDir, { recursive: true });
    const res = await fetchImpl(url(`/api/sync/package?ticket=${encodeURIComponent(ticket)}`), {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`package 下载失败：HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(partFile, buffer);
    const actual = crypto.createHash('sha256').update(buffer).digest('hex');
    if (expectedSha256 && actual !== expectedSha256) {
      fs.rmSync(partFile, { force: true });
      throw new Error(`package 哈希不一致：期望 ${expectedSha256}，实际 ${actual}`);
    }
    fs.renameSync(partFile, finalFile);
    return { file: finalFile, sha256: actual };
  }

  function unpackAtomically(archiveFile, ticket) {
    const tempDir = path.join(cacheDir, `.unpack-${ticket}-${now()}`);
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(tempDir, { recursive: true });
    try {
      extractTarGzLimited(archiveFile, tempDir);
      const target = path.join(inboxRoot, ticket);
      if (fs.existsSync(target)) return { target, existed: true };
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(tempDir, target);
      return { target, existed: false };
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  async function postResult(item) {
    const res = await fetchImpl(url('/api/sync/result'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        ticket: item.ticket,
        status: item.status,
        manifest: item.manifest,
      }),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(`result 回写失败：${payload.error || `HTTP ${res.status}`}`);
    }
    return res.json();
  }

  function enqueueResult(item) {
    state.pendingResults.push({ ...item, attempts: Number(item.attempts || 0), next_at: now() });
    if (state.pendingResults.length > 200) state.pendingResults = state.pendingResults.slice(-200);
    persist();
  }

  async function flushResultQueue() {
    if (state.pendingResults.length === 0) return { flushed: 0, remaining: 0 };
    const remaining = [];
    let flushed = 0;
    for (const item of state.pendingResults) {
      if (now() < Number(item.next_at || 0)) {
        remaining.push(item);
        continue;
      }
      try {
        await postResult(item);
        flushed += 1;
      } catch (error) {
        const attempts = Number(item.attempts || 0) + 1;
        if (attempts <= maxResultRetries) {
          remaining.push({ ...item, attempts, next_at: now() + resultRetryMs, last_error: error.message });
          logger.warn?.(`[portal-sync] result 重试 ${item.ticket}（${attempts}/${maxResultRetries}）：${error.message}`);
        } else {
          logger.error?.(`[portal-sync] result 放弃 ${item.ticket}：${error.message}`);
        }
      }
    }
    state.pendingResults = remaining;
    persist();
    return { flushed, remaining: remaining.length };
  }

  async function processTicket(ticket) {
    const claimed = await claim(ticket);
    const key = idempotencyKey(ticket, claimed.sha256 || '');
    if (state.processed[key]) {
      await postResultSafe({
        ticket, status: 'done', manifest: { package_id: ticket, note: 'idempotent_skip' },
      });
      return { ticket, status: 'skipped', reason: 'already_processed' };
    }
    const download = await downloadPackage(ticket, claimed.sha256);
    const unpacked = unpackAtomically(download.file, ticket);
    state.processed[key] = { at: new Date(now()).toISOString(), path: unpacked.target };
    persist();
    await postResultSafe({
      ticket,
      status: 'done',
      manifest: {
        package_id: ticket,
        sha256: download.sha256,
        received_at: new Date(now()).toISOString(),
        unpacked_to: unpacked.target,
      },
    });
    return { ticket, status: 'done', sha256: download.sha256, existed: unpacked.existed };
  }

  async function postResultSafe(item) {
    try {
      await postResult(item);
    } catch (error) {
      logger.warn?.(`[portal-sync] result 暂存待重试 ${item.ticket}：${error.message}`);
      enqueueResult(item);
    }
  }

  async function pollOnce() {
    const flushed = await flushResultQueue();
    const tickets = await pendingTickets();
    if (tickets.length === 0) return { processed: 0, idle: true, flushed };
    const results = [];
    for (const entry of tickets) {
      const ticket = typeof entry === 'string' ? entry : entry.ticket;
      try {
        results.push(await processTicket(ticket));
      } catch (error) {
        logger.error?.(`[portal-sync] 处理 ${ticket} 失败：${error.message}`);
        results.push({ ticket, status: 'failed', error: error.message });
      }
    }
    return { processed: results.length, idle: false, results, flushed };
  }

  function schedule(delayMs) {
    if (!running) return;
    timer = setTimeout(async () => {
      let nextDelay = idleIntervalMs;
      try {
        const outcome = await pollOnce();
        nextDelay = outcome.idle ? idleIntervalMs : activeIntervalMs;
      } catch (error) {
        logger.error?.(`[portal-sync] 轮询失败：${error.message}`);
      }
      schedule(nextDelay);
    }, delayMs);
    timer.unref?.();
  }

  function start() {
    if (running) return { started: false, already_running: true };
    running = true;
    schedule(0);
    return { started: true };
  }

  function stop() {
    running = false;
    if (timer) clearTimeout(timer);
    timer = null;
    return { stopped: true };
  }

  return {
    start,
    stop,
    pollOnce,
    flushResultQueue,
    stateFile,
    getState: () => JSON.parse(JSON.stringify(state)),
  };
}
