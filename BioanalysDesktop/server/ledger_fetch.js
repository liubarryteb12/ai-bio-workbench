import { SYSTEM_LOGS } from './domain.js';
import { runRemote } from './remote_exec.js';

export async function fetchLedgerFromServer(logsDir = SYSTEM_LOGS) {
  const listing = runRemote(`ls -1 '${logsDir}'/*.json 2>/dev/null || true`);
  const names = listing
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.json'));

  const entries = [];
  for (const remotePath of names) {
    const encoded = runRemote(`base64 -w0 '${remotePath}' 2>/dev/null || true`);
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
