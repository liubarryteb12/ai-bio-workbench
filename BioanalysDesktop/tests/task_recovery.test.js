import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createTaskRecovery,
  scanLocalProjectLedgers,
  scanRemoteRunningLedgers,
} from '../server/task_recovery.js';

function runningEntry(overrides = {}) {
  return {
    task_id: 'task_20261030_abcdef12',
    project_id: 'PRJ_RECOVERY',
    line_id: 'line1_bulk',
    step_name: 'deg_limma',
    status: 'running',
    start_time: '2026-10-30T01:02:03Z',
    log_file: '/mnt/ssd/bio_data/system_logs/task_20261030_abcdef12.log',
    ...overrides,
  };
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bioanalys-task-recovery-'));
}

test('scanLocalProjectLedgers recovers a real JSONL running entry', () => {
  const root = tempRoot();
  const ledgerDir = path.join(root, 'PRJ_RECOVERY', 'ledger');
  fs.mkdirSync(ledgerDir, { recursive: true });
  fs.writeFileSync(
    path.join(ledgerDir, 'actions.jsonl'),
    `${JSON.stringify(runningEntry())}\n${JSON.stringify({ ...runningEntry(), task_id: 'done', status: 'completed' })}\n`,
    'utf8',
  );

  const scan = scanLocalProjectLedgers({ localProjectsRoot: root });

  assert.equal(scan.entries.length, 1);
  assert.equal(scan.entries[0].task_id, 'task_20261030_abcdef12');
  assert.equal(scan.entries[0].project_id, 'PRJ_RECOVERY');
  assert.equal(scan.entries[0].recovery_source, 'local');
  assert.deepEqual(scan.warnings, []);
});

test('scanRemoteRunningLedgers reads running ledger files through the SSH seam', async () => {
  const payload = Buffer.from(JSON.stringify(runningEntry())).toString('base64');
  const calls = [];
  const scan = await scanRemoteRunningLedgers({
    sshTarget: 'k40-ubuntu',
    execFileImpl: (_program, args, options, callback) => {
      calls.push({ args, options });
      callback(
        null,
        `__BIO_LEDGER_FILE__/mnt/ssd/bio_data/system_logs/task_20261030_abcdef12_ledger.json\n`
          + `${payload}\n__BIO_LEDGER_END__\n`,
        '',
      );
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.at(-2), 'k40-ubuntu');
  assert.equal(scan.entries.length, 1);
  assert.equal(scan.entries[0].task_id, 'task_20261030_abcdef12');
  assert.equal(scan.entries[0].recovery_source, 'remote');
  assert.deepEqual(scan.warnings, []);
});

test('remote unreachable and malformed JSON are explicit warnings, never recovered', async () => {
  const unreachable = await scanRemoteRunningLedgers({
    execFileImpl: (_program, _args, _options, callback) => {
      const error = new Error('ssh unavailable');
      error.code = 255;
      callback(error, '', 'ssh unavailable');
    },
  });
  assert.equal(unreachable.entries.length, 0);
  assert.equal(unreachable.ok, false);
  assert.match(unreachable.warnings[0].message, /unreachable|ssh unavailable/i);

  const malformed = await scanRemoteRunningLedgers({
    execFileImpl: (_program, _args, _options, callback) => {
      callback(
        null,
        '__BIO_LEDGER_FILE__/mnt/ssd/bio_data/system_logs/bad_ledger.json\n'
          + `${Buffer.from('{not-json').toString('base64')}\n__BIO_LEDGER_END__\n`,
        '',
      );
    },
  });
  assert.equal(malformed.entries.length, 0);
  assert.equal(malformed.ok, false);
  assert.match(malformed.warnings[0].message, /JSON/i);
});

test('recovery ignores non-running entries and is idempotent across repeated calls', async () => {
  const runningTasks = new Map();
  let attachCount = 0;
  const warnings = [];
  const recovery = createTaskRecovery({
    runningTasks,
    scanLocal: () => ({
      ok: true,
      entries: [
        runningEntry(),
        runningEntry({ task_id: 'completed-task', status: 'completed' }),
      ],
      warnings: [],
    }),
    scanRemote: async () => ({ ok: true, entries: [], warnings: [] }),
    attachLogStream: () => {
      attachCount += 1;
      return () => {};
    },
    warn: (warning) => warnings.push(warning),
  });

  const first = await recovery();
  const second = await recovery();

  assert.equal(first.recovered.length, 1);
  assert.equal(second.recovered.length, 0);
  assert.equal(runningTasks.size, 1);
  assert.equal(runningTasks.get('task_20261030_abcdef12').recovered, true);
  assert.equal(attachCount, 1);
  assert.deepEqual(warnings, []);
});

test('recovery reports a failed remote scan without pretending tasks were recovered', async () => {
  const runningTasks = new Map();
  const warnings = [];
  const recovery = createTaskRecovery({
    runningTasks,
    scanLocal: () => ({ ok: true, entries: [], warnings: [] }),
    scanRemote: async () => ({
      ok: false,
      entries: [],
      warnings: [{ source: 'remote', message: 'ssh unreachable' }],
    }),
    warn: (warning) => warnings.push(warning),
  });

  const result = await recovery();

  assert.equal(result.ok, false);
  assert.equal(result.recovered.length, 0);
  assert.equal(runningTasks.size, 0);
  assert.equal(result.warnings.length, 1);
  assert.equal(warnings.length, 1);
});
