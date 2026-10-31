import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'ops', 'init_project_scaffold.py');
const TEST_ROOT = path.join(REPO_ROOT, 'artifacts', 'project_scaffold_tests');
const LINES = ['line1_bulk', 'line2_scrna', 'line3_spatial'];
const LEDGER_NAMES = ['actions', 'changes', 'errors', 'fixes', 'pitfalls'];

function findPythonLauncher() {
  const candidates = [
    ...(process.env.PYTHON ? [{ command: process.env.PYTHON, prefix: [] }] : []),
    { command: 'python3', prefix: [] },
    { command: 'python', prefix: [] },
    { command: 'py', prefix: ['-3'] },
  ];
  return candidates.find(({ command, prefix }) => {
    const probe = spawnSync(command, [...prefix, '--version'], { encoding: 'utf8' });
    return probe.status === 0;
  }) || null;
}

const PYTHON = findPythonLauncher();
const PYTHON_SKIP = PYTHON ? false : 'host Python interpreter not found';

test.after(() => {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
});

function makeRoot() {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(TEST_ROOT, 'case-'));
}

function runScaffold(root, args) {
  const proc = spawnSync(PYTHON.command, [...PYTHON.prefix, SCRIPT, '--root', root, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  const output = proc.stdout.trim();
  return {
    status: proc.status,
    stdout: proc.stdout,
    stderr: proc.stderr,
    payload: output ? JSON.parse(output) : null,
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('scaffold creates the self-contained project, init action, and global sync state', { skip: PYTHON_SKIP }, () => {
  const root = makeRoot();
  const result = runScaffold(root, [
    '--project', 'PRJ_20261026_DEMO',
    '--line', 'line1_bulk',
    '--ticket', 'TICKET-001',
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.payload.ok, true);

  const projectRoot = path.join(root, 'local_projects', 'PRJ_20261026_DEMO');
  for (const name of ['project.json', 'handoff.md', 'README.md', 'INDEX.json']) {
    assert.ok(fs.statSync(path.join(projectRoot, name)).isFile(), name);
  }
  for (const name of ['data', 'figures', 'deliverables', 'debug', 'ledger']) {
    assert.ok(fs.statSync(path.join(projectRoot, name)).isDirectory(), name);
  }
  for (const line of LINES) {
    assert.ok(fs.statSync(path.join(projectRoot, 'data', line, 'processed')).isDirectory());
    assert.ok(fs.statSync(path.join(projectRoot, 'data', line, 'results')).isDirectory());
    assert.ok(fs.statSync(path.join(projectRoot, 'figures', line)).isDirectory());
  }
  assert.ok(fs.statSync(path.join(projectRoot, 'figures', 'adapt')).isDirectory());

  const projectMeta = readJson(path.join(projectRoot, 'project.json'));
  assert.equal(projectMeta.project_id, 'PRJ_20261026_DEMO');
  assert.equal(projectMeta.ticket_id, 'TICKET-001');
  assert.equal(projectMeta.line, 'line1_bulk');
  assert.ok(projectMeta.created_at);

  for (const name of LEDGER_NAMES) {
    assert.ok(fs.statSync(path.join(projectRoot, 'ledger', `${name}.jsonl`)).isFile());
  }
  const actionLines = fs.readFileSync(path.join(projectRoot, 'ledger', 'actions.jsonl'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  assert.equal(actionLines.length, 1);
  const initAction = JSON.parse(actionLines[0]);
  assert.equal(initAction.type, 'action');
  assert.equal(initAction.kind, 'init');
  assert.equal(initAction.project, 'PRJ_20261026_DEMO');
  assert.equal(initAction.line, 'line1_bulk');
  assert.equal(initAction.step, null);
  assert.ok(initAction.id);
  assert.ok(initAction.ts);
  assert.ok(initAction.title);
  assert.ok(Array.isArray(initAction.evidence));
  assert.ok(Array.isArray(initAction.refs));
  assert.equal(Object.hasOwn(initAction, 'status'), false);

  const globalLedger = path.join(root, 'con_hf', 'ledger');
  for (const name of LEDGER_NAMES) {
    assert.ok(fs.statSync(path.join(globalLedger, `${name}.jsonl`)).isFile());
  }
  assert.ok(fs.statSync(path.join(root, 'con_hf', 'sync', 'inbox')).isDirectory());
  assert.ok(fs.statSync(path.join(root, 'con_hf', 'sync', 'outbox')).isDirectory());
  assert.ok(fs.statSync(path.join(root, 'con_hf', 'sync', 'daemon.log')).isFile());
});

test('scaffold is idempotent and preserves user content', { skip: PYTHON_SKIP }, () => {
  const root = makeRoot();
  const args = ['--project', 'PRJ_IDEMPOTENT', '--line', 'line2_scrna'];
  assert.equal(runScaffold(root, args).status, 0);

  const projectRoot = path.join(root, 'local_projects', 'PRJ_IDEMPOTENT');
  fs.writeFileSync(path.join(projectRoot, 'README.md'), 'KEEP_ME\n', 'utf8');
  const second = runScaffold(root, args);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8'), 'KEEP_ME\n');

  const actions = fs.readFileSync(path.join(projectRoot, 'ledger', 'actions.jsonl'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  assert.equal(actions.length, 1);
});

test('scaffold appends init after a preexisting action without a trailing newline', { skip: PYTHON_SKIP }, () => {
  const root = makeRoot();
  const projectLedger = path.join(root, 'local_projects', 'PRJ_NO_NEWLINE', 'ledger');
  fs.mkdirSync(projectLedger, { recursive: true });
  const existing = '{"id":"ACT-EXISTING","type":"action","kind":"run"}';
  fs.writeFileSync(path.join(projectLedger, 'actions.jsonl'), existing, 'utf8');

  const result = runScaffold(root, ['--project', 'PRJ_NO_NEWLINE', '--line', 'line3_spatial']);
  assert.equal(result.status, 0, result.stderr);

  const lines = fs.readFileSync(path.join(projectLedger, 'actions.jsonl'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).id, 'ACT-EXISTING');
  assert.equal(JSON.parse(lines[1]).kind, 'init');
});

test('scaffold rejects invalid project identifiers and line names', { skip: PYTHON_SKIP }, () => {
  const root = makeRoot();
  for (const args of [
    ['--project', '../escape', '--line', 'line1_bulk'],
    ['--project', 'safe_project', '--line', 'line4_bad'],
  ]) {
    const result = runScaffold(root, args);
    assert.equal(result.status, 2);
    assert.equal(result.payload.ok, false);
  }
  assert.equal(fs.existsSync(path.join(root, 'local_projects', 'safe_project')), false);
});

test('scaffold rejects roots outside the workspace or outside its QA root', { skip: PYTHON_SKIP }, () => {
  for (const root of [os.tmpdir(), path.join(REPO_ROOT, 'BioanalysDesktop')]) {
    const result = runScaffold(root, ['--project', 'SAFE_PROJECT', '--line', 'line1_bulk']);
    assert.equal(result.status, 2);
    assert.equal(result.payload.ok, false);
    assert.match(result.payload.error, /outside allowed workspace roots/);
    assert.equal(fs.existsSync(path.join(root, 'local_projects', 'SAFE_PROJECT')), false);
  }
});
