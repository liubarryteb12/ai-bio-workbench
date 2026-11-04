import { SYSTEM_LOGS } from './domain.js';
import { runRemote } from './remote_exec.js';
import { shellQuote } from './proc.js';

/**
 * 拉取远端台账。
 *
 * logsDir 来自 URL 参数（diagnostics.routes.js 的 /api/ledger/check），
 * 裸插进单引号串等于把引号闭合权交给调用方（第三十二轮 T0-4 余震实测：
 * 载荷 /mnt/ssd/bio_data/system_logs'; echo PWNED; echo ' 在未修版本上真的执行了）。
 * 两处拼接都必须过 shellQuote。
 */
export async function fetchLedgerFromServer(logsDir = SYSTEM_LOGS) {
  const listing = runRemote(`ls -1 ${shellQuote(logsDir)}/*.json 2>/dev/null || true`);
  const names = listing
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.json'));

  const entries = [];
  for (const remotePath of names) {
    const encoded = runRemote(`base64 -w0 ${shellQuote(remotePath)} 2>/dev/null || true`);
    if (!encoded.trim()) continue;
    const text = Buffer.from(encoded.trim(), 'base64').toString('utf8');
    entries.push({
      file: remotePath.split('/').pop(),
      path: remotePath,
      data: JSON.parse(text),
    });
  }
  return { names: entries.map((entry) => entry.file), entries };
}
