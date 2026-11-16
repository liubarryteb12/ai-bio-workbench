/**
 * K40 算力面开机自检（TICKET-OPS-01）。
 *
 * 真机冒烟暴露过两类断层：包装器停留旧版、R site-library 断链。
 * 这里用一条 1 秒级 ADB 探针同时核对脚本哈希与 limma 可加载性。
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const K40_FILES = Object.freeze([
  { remote: '/mnt/ssd/bio_data/ops/run_throttled_task.sh', local: 'tools/ops/run_throttled_task.sh' },
  { remote: '/mnt/ssd/bio_data/core/mem_guard.py', local: 'core/mem_guard.py' },
]);

export function localFileSha256(relPath, repoRoot = REPO) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(repoRoot, relPath))).digest('hex');
}

export function buildPreflightCommand(files = K40_FILES) {
  const hashArgs = files.map((item) => item.remote).join(' ');
  return [
    `sha256sum ${hashArgs}`,
    "/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript -e 'suppressMessages(library(limma)); cat(\"LIMMA_OK\\n\")'",
  ].join(' ; ');
}

export function checkK40Preflight({ runRemote, files = K40_FILES, repoRoot = REPO } = {}) {
  if (typeof runRemote !== 'function') {
    return { ok: false, error: 'PREFLIGHT_RUNTIME_MISSING' };
  }
  let output = '';
  try {
    output = String(runRemote(buildPreflightCommand(files)) || '');
  } catch (error) {
    return { ok: false, error: String(error.message || error), checks: [] };
  }
  if (!output.trim()) {
    // ADB/Termux 尚未就绪时不能把空输出误判成所有文件哈希漂移。
    return { ok: false, error: 'PREFLIGHT_ADB_UNAVAILABLE', checks: [], mismatches: [] };
  }
  const checks = [];
  const mismatches = [];
  const lines = output.split(/\r?\n/);
  for (const item of files) {
    const line = lines.find((entry) => entry.trim().endsWith(` ${item.remote}`));
    const remote = line ? line.trim().split(/\s+/)[0] : null;
    const local = localFileSha256(item.local, repoRoot);
    const same = Boolean(remote) && remote === local;
    checks.push({ file: item.remote, local, remote, same });
    if (!same) mismatches.push(item.remote);
  }
  const limmaOk = /LIMMA_OK/.test(output);
  return {
    ok: mismatches.length === 0 && limmaOk,
    limma_ok: limmaOk,
    mismatches,
    checks,
  };
}
