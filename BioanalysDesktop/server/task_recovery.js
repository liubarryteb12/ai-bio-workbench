/**
 * Recover running task status after the desktop service restarts.
 *
 * The recovery input is intentionally ledger based. Local project JSONL and
 * remote system_logs JSON are the existing durable formats; this module does
 * not introduce a second task state file.
 */

import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LINES, SYSTEM_LOGS } from './domain.js';
import { assertAllowedProgram } from './proc.js';

export const REMOTE_LEDGER_FILE = '__BIO_LEDGER_FILE__';
export const REMOTE_LEDGER_READ_ERROR = '__BIO_LEDGER_READ_ERROR__';
export const REMOTE_LEDGER_END = '__BIO_LEDGER_END__';

const TASK_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

function warning(source, file, message) {
  return {
    source,
    file: file || null,
    message,
  };
}

function asObjects(value) {
  if (Array.isArray(value)) return value;
  return value && typeof value === 'object' ? [value] : [];
}

/**
 * Convert one ledger object into the task shape held by runningTasks.
 * Non-running entries return null without a warning. A running entry with
 * missing identity fields returns a warning and is not recovered.
 */
export function normalizeRunningLedgerEntry(raw, options = {}) {
  if (!raw || typeof raw !== 'object') return { entry: null, warning: null };
  if (raw.status !== 'running') return { entry: null, warning: null };

  const source = options.source || 'local';
  const file = options.file || null;
  const taskId = String(raw.task_id ?? raw.taskId ?? '').trim();
  if (!taskId || taskId.includes('..') || !TASK_ID_PATTERN.test(taskId)) {
    return {
      entry: null,
      warning: warning(source, file, `running ledger has invalid task_id: ${JSON.stringify(raw.task_id ?? raw.taskId)}`),
    };
  }

  const projectId = String(
    raw.project_id ?? raw.projectId ?? options.projectId ?? '',
  ).trim();
  if (!projectId) {
    return {
      entry: null,
      warning: warning(source, file, `running task ${taskId} has no project_id`),
    };
  }

  const lineId = String(raw.line_id ?? raw.lineId ?? '').trim();
  if (!LINES.includes(lineId)) {
    return {
      entry: null,
      warning: warning(source, file, `running task ${taskId} has invalid line_id: ${JSON.stringify(lineId)}`),
    };
  }

  const stepName = String(raw.step_name ?? raw.step ?? raw.stepName ?? '').trim();
  if (!stepName) {
    return {
      entry: null,
      warning: warning(source, file, `running task ${taskId} has no step_name`),
    };
  }

  return {
    entry: {
      ...raw,
      task_id: taskId,
      project_id: projectId,
      line_id: lineId,
      step_name: stepName,
      status: 'running',
      start_time: raw.start_time ?? raw.startedAt ?? raw.ts ?? null,
      log_file: raw.log_file ?? raw.logFile ?? `${SYSTEM_LOGS}/${taskId}.log`,
      ledger_path: file,
      recovery_source: source,
    },
    warning: null,
  };
}

function collectJsonValue(value, source, file, projectId) {
  const entries = [];
  const warnings = [];
  for (const item of asObjects(value)) {
    const normalized = normalizeRunningLedgerEntry(item, { source, file, projectId });
    if (normalized.entry) entries.push(normalized.entry);
    if (normalized.warning) warnings.push(normalized.warning);
  }
  return { entries, warnings };
}

function parseLocalFile(file, projectId) {
  const text = fs.readFileSync(file, 'utf8');
  const entries = [];
  const warnings = [];
  const trimmed = text.trim();
  if (!trimmed) return { entries, warnings };

  // JSON arrays are accepted for exported ledgers; .jsonl remains line based.
  if (trimmed.startsWith('[')) {
    try {
      return collectJsonValue(JSON.parse(trimmed), 'local', file, projectId);
    } catch (cause) {
      warnings.push(warning('local', file, `invalid JSON: ${cause.message}`));
      return { entries, warnings };
    }
  }

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      const collected = collectJsonValue(parsed, 'local', file, projectId);
      entries.push(...collected.entries);
      warnings.push(...collected.warnings);
    } catch (cause) {
      warnings.push(warning('local', file, `line ${index + 1} invalid JSON: ${cause.message}`));
    }
  }
  return { entries, warnings };
}

/**
 * Scan local_projects/<project>/ledger/*.jsonl and *.json for running tasks.
 * A malformed file is reported as a warning and contributes no recovered task.
 */
export function scanLocalProjectLedgers(options = {}) {
  const root = path.resolve(options.localProjectsRoot || path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'local_projects',
  ));
  if (!fs.existsSync(root)) {
    return { ok: true, entries: [], warnings: [] };
  }

  const entries = [];
  const warnings = [];
  const projectDirs = fs.readdirSync(root, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const projectDir of projectDirs) {
    const ledgerDir = path.join(root, projectDir.name, 'ledger');
    if (!fs.existsSync(ledgerDir) || !fs.statSync(ledgerDir).isDirectory()) continue;
    const files = fs.readdirSync(ledgerDir, { withFileTypes: true })
      .filter((item) => item.isFile() && /\.(json|jsonl)$/i.test(item.name))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const file of files) {
      const fullPath = path.join(ledgerDir, file.name);
      try {
        const parsed = parseLocalFile(fullPath, projectDir.name);
        entries.push(...parsed.entries);
        warnings.push(...parsed.warnings);
      } catch (cause) {
        warnings.push(warning('local', fullPath, `read failed: ${cause.message}`));
      }
    }
  }

  return { ok: warnings.length === 0, entries, warnings };
}

function shellQuote(text) {
  return `'${String(text).replace(/'/g, String.raw`'\''`)}'`;
}

function buildRemoteScanCommand(logsDir) {
  const root = shellQuote(logsDir);
  return [
    `for f in ${root}/*_ledger.json ${root}/_running/*.json; do`,
    '  [ -f "$f" ] || continue',
    `  printf '${REMOTE_LEDGER_FILE}%s\\n' "$f"`,
    '  if base64 -w0 "$f" 2>/dev/null; then',
    '    printf "\\n"',
    '  else',
    `    printf '${REMOTE_LEDGER_READ_ERROR}%s\\n' "$f"`,
    '  fi',
    'done',
    `printf '${REMOTE_LEDGER_END}\\n'`,
  ].join('\n');
}

function execFileAsync(execFileImpl, program, args, options) {
  return new Promise((resolve) => {
    execFileImpl(program, args, options, (error, stdout, stderr) => {
      resolve({ error, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

function parseRemoteOutput(stdout) {
  const lines = String(stdout ?? '').split(/\r?\n/);
  const entries = [];
  const warnings = [];
  let sawEnd = false;
  let currentFile = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === REMOTE_LEDGER_END) {
      sawEnd = true;
      break;
    }
    if (line.startsWith(REMOTE_LEDGER_FILE)) {
      currentFile = line.slice(REMOTE_LEDGER_FILE.length).trim() || null;
      const encoded = String(lines[index + 1] ?? '').trim();
      index += 1;
      if (!encoded) {
        warnings.push(warning('remote', currentFile, 'ledger file is empty or unreadable'));
        continue;
      }
      try {
        const parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
        const normalized = collectJsonValue(parsed, 'remote', currentFile, null);
        entries.push(...normalized.entries);
        warnings.push(...normalized.warnings);
      } catch (cause) {
        warnings.push(warning('remote', currentFile, `invalid JSON: ${cause.message}`));
      }
      continue;
    }
    if (line.startsWith(REMOTE_LEDGER_READ_ERROR)) {
      const file = line.slice(REMOTE_LEDGER_READ_ERROR.length).trim() || null;
      warnings.push(warning('remote', file, 'ledger file read failed'));
    }
  }

  if (!sawEnd) {
    warnings.push(warning('remote', null, 'ledger scan output is missing the completion sentinel'));
  }
  return { entries, warnings };
}

/**
 * Read remote ledger and _running marker JSON through one read-only SSH call.
 * The caller supplies execFileImpl in tests, so no test reaches the phone.
 */
export async function scanRemoteRunningLedgers(options = {}) {
  const execFileImpl = options.execFileImpl || childProcess.execFile;
  const sshTarget = options.sshTarget || 'k40-ubuntu';
  const logsDir = options.logsDir || SYSTEM_LOGS;
  const timeoutMs = options.timeoutMs || 8000;

  assertAllowedProgram(['ssh']);
  const result = await execFileAsync(
    execFileImpl,
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=3', sshTarget, buildRemoteScanCommand(logsDir)],
    { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
  );

  if (result.error) {
    return {
      ok: false,
      entries: [],
      warnings: [warning('remote', null, `unreachable or failed: ${result.error.message || result.stderr || 'ssh failed'}`)],
    };
  }

  const parsed = parseRemoteOutput(result.stdout);
  return {
    ok: parsed.warnings.length === 0,
    entries: parsed.entries,
    warnings: parsed.warnings,
  };
}

function normalizeScanResult(result, source) {
  if (result instanceof Error) {
    return {
      ok: false,
      entries: [],
      warnings: [warning(source, null, result.message)],
    };
  }
  return {
    ok: result?.ok !== false,
    entries: Array.isArray(result?.entries) ? result.entries : [],
    warnings: Array.isArray(result?.warnings) ? result.warnings : [],
  };
}

/**
 * Build the idempotent recovery operation used by HTTP routes and startup.
 */
export function createTaskRecovery(options = {}) {
  const runningTasks = options.runningTasks || new Map();
  const scanLocal = options.scanLocal || (() => ({ ok: true, entries: [], warnings: [] }));
  const scanRemote = options.scanRemote || (async () => ({ ok: true, entries: [], warnings: [] }));
  const attachLogStream = options.attachLogStream || (() => () => {});
  const warn = options.warn || ((item) => console.warn(`[task-recovery] ${item.message}`));
  const recoveredTaskIds = new Set();
  let inFlight = null;

  const recover = async () => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const warnings = [];
      const recovered = [];
      const [localResult, remoteResult] = await Promise.all([
        Promise.resolve().then(scanLocal).catch((cause) => cause),
        Promise.resolve().then(scanRemote).catch((cause) => cause),
      ]);
      const scans = [
        normalizeScanResult(localResult, 'local'),
        normalizeScanResult(remoteResult, 'remote'),
      ];
      for (const scan of scans) {
        warnings.push(...scan.warnings);
      }

      const seen = new Set();
      for (const raw of scans.flatMap((scan) => scan.entries)) {
        const normalized = normalizeRunningLedgerEntry(raw, {
          source: raw?.recovery_source || 'local',
          file: raw?.ledger_path || null,
          projectId: raw?.project_id,
        });
        if (normalized.warning) warnings.push(normalized.warning);
        const entry = normalized.entry;
        if (!entry) continue;
        const taskId = entry.task_id;
        if (seen.has(taskId) || recoveredTaskIds.has(taskId) || runningTasks.has(taskId)) continue;
        seen.add(taskId);

        const task = {
          kill: null,
          projectId: entry.project_id,
          lineId: entry.line_id,
          step: entry.step_name,
          startedAt: entry.start_time || new Date().toISOString(),
          status: 'running',
          recovered: true,
          recoverySource: entry.recovery_source,
          ledgerPath: entry.ledger_path,
          logFile: entry.log_file,
          detachLogStream: null,
        };
        task.kill = () => options.killRecoveredTask?.(taskId, task, entry);
        runningTasks.set(taskId, task);
        try {
          task.detachLogStream = attachLogStream({ taskId, ...task, entry }) || null;
        } catch (cause) {
          runningTasks.delete(taskId);
          warnings.push(warning(entry.recovery_source, entry.ledger_path, `log reattach failed: ${cause.message}`));
          continue;
        }
        recoveredTaskIds.add(taskId);
        recovered.push({ taskId, ...task });
      }

      for (const item of warnings) warn(item);
      return {
        ok: scans.every((scan) => scan.ok) && warnings.length === 0,
        recovered,
        warnings,
        scanned: scans.reduce((total, scan) => total + scan.entries.length, 0),
      };
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  return recover;
}
