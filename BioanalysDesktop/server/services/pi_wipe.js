/**
 * 项目沙箱擦除（Wipe-on-Sign）。
 *
 * 只在报告签发且交付包验签通过后调用。失败不阻断本地交付，
 * 而是写入 pending_remote_wipes.json，下一次 ADB 连通时重放。
 */
import fs from 'node:fs';
import path from 'node:path';

const SAFE_PROJECT_ID = /^[A-Za-z0-9._-]{3,64}$/;
const REMOTE_SCRIPT = '/mnt/ssd/bio_data/ops/wipe_project_sandbox.sh';

function pendingFile(dataRoot) {
  return path.join(dataRoot, '.ops_state', 'pending_remote_wipes.json');
}

export function readPendingWipes(dataRoot) {
  try {
    const parsed = JSON.parse(fs.readFileSync(pendingFile(dataRoot), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePendingWipes(dataRoot, items) {
  const file = pendingFile(dataRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(items.slice(-200), null, 2)}\n`, 'utf8');
}

export function enqueuePendingWipe(dataRoot, item) {
  const items = readPendingWipes(dataRoot);
  items.push({
    ...item,
    status: 'PENDING_RETRY',
    attempts: Number(item.attempts || 0),
    queued_at: new Date().toISOString(),
  });
  writePendingWipes(dataRoot, items);
  return items;
}

export function clearPendingWipe(dataRoot, projectId) {
  const items = readPendingWipes(dataRoot).filter((item) => item.project_id !== projectId);
  writePendingWipes(dataRoot, items);
  return items;
}

/**
 * 调用容器侧擦除脚本。成功返回 {ok:true,path,bytes}；
 * 失败时入重试队列并返回 {ok:false,error}，不抛给交付主链。
 */
export function wipeProjectSandbox(projectId, {
  runRemote, dataRoot, token = 'WIPE_ON_SIGN',
} = {}) {
  const id = String(projectId || '').trim();
  if (!SAFE_PROJECT_ID.test(id)) {
    return { ok: false, error: `WIPE_PROJECT_ID_INVALID: ${id}` };
  }
  if (typeof runRemote !== 'function' || !dataRoot) {
    return { ok: false, error: 'WIPE_RUNTIME_MISSING: runRemote/dataRoot' };
  }
  try {
    const command = `bash ${REMOTE_SCRIPT} ${id} ${token}`;
    const output = String(runRemote(command) || '');
    const match = /WIPE_VERIFIED\s+'([^']+)'\s+(\d+)/.exec(output);
    if (!match) {
      throw new Error(`WIPE_RECEIPT_MISSING: ${output.slice(-200)}`);
    }
    clearPendingWipe(dataRoot, id);
    return { ok: true, path: match[1], bytes: Number(match[2]), token };
  } catch (error) {
    enqueuePendingWipe(dataRoot, {
      project_id: id,
      token,
      error: String(error.message || error),
    });
    return { ok: false, error: String(error.message || error) };
  }
}

export function retryPendingWipes({ runRemote, dataRoot } = {}) {
  const items = readPendingWipes(dataRoot);
  const remaining = [];
  for (const item of items) {
    const result = wipeProjectSandbox(item.project_id, {
      runRemote,
      dataRoot,
      token: item.token || 'WIPE_ON_SIGN',
    });
    if (!result.ok) {
      remaining.push({
        ...item,
        attempts: Number(item.attempts || 0) + 1,
        last_error: result.error,
      });
    }
  }
  writePendingWipes(dataRoot, remaining);
  return { retried: items.length, remaining: remaining.length };
}
