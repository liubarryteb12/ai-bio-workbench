import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'tools', 'ops', 'ledger_indexer.py');
const TEST_ROOT = path.join(REPO_ROOT, 'artifacts', 'local_project_workspace_tests', 'jsonl_ledger_index_tests_' + process.pid + '_' + Math.random().toString(36).slice(2, 8));

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
const PYTHON_SKIP = PYTHON ? false : 'HOST_MISSING_PYTHON: host Python interpreter not found';

test.after(() => {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
});

function makeRoot() {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(TEST_ROOT, 'case-'));
}

function runIndexer(root, args) {
  const proc = spawnSync(PYTHON.command, [...PYTHON.prefix, SCRIPT, '--root', root, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  const output = proc.stdout.trim();
  return {
    status: proc.status,
    stdout: proc.stdout,
    stderr: proc.stderr,
    payload: output ? JSON.parse(output) : null,
  };
}

function writeJsonl(file, records) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, records.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
}

function writeMachineLog(root, file, task, project) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), JSON.stringify({
    task_id: task,
    project_id: project,
    line_id: 'line1_bulk',
    step_name: 'example_step',
    status: 'completed',
  }), 'utf8');
}

function scaffoldProject(root, projectId) {
  const workspaceScript = path.join(REPO_ROOT, 'tools', 'ops', 'local_project_workspace.py');
  return spawnSync(PYTHON.command, [...PYTHON.prefix, workspaceScript, '--root', root, 'scaffold', '--project-id', projectId], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
}

test('JSONL ledger index covers append overwrite, refs, artifacts, and machine logs', { skip: PYTHON_SKIP }, () => {
  const root = makeRoot();
  const result = scaffoldProject(root, 'PRJ_JS_LEDGER');
  assert.equal(result.status, 0, result.stderr);
  const projectRoot = path.join(root, 'workspace/projects', 'PRJ_JS_LEDGER');
  const ledger = path.join(projectRoot, 'ledger');

  writeJsonl(path.join(ledger, 'actions.jsonl'), [
    { id: 'ACT-1', kind: 'init', title: 'first' },
    { id: 'ACT-1', kind: 'run', title: 'second' },
  ]);
  writeJsonl(path.join(ledger, 'errors.jsonl'), [
    { id: 'ERR-1', status: 'open', title: 'first error' },
    { id: 'ERR-2', status: 'open', title: 'second error' },
  ]);
  writeJsonl(path.join(ledger, 'fixes.jsonl'), [
    { id: 'FIX-1', status: 'resolved', title: 'first fix', refs: ['ERR-1', 'ERR-2'] },
    { id: 'FIX-2', status: 'resolved', title: 'second fix', refs: ['ERR-2'] },
  ]);
  fs.writeFileSync(path.join(projectRoot, 'figures', 'line1_bulk', 'a.png'), 'png-a\n', 'utf8');
  fs.writeFileSync(path.join(projectRoot, 'figures', 'line2_scrna', 'b.png'), 'png-b\n', 'utf8');
  writeMachineLog(root, 'outputs/system_logs/js_a.json', 'task-js-a', 'PRJ_JS_LEDGER');
  writeMachineLog(root, 'outputs/system_logs/js_b.json', 'task-js-b', 'PRJ_JS_LEDGER');
  writeMachineLog(root, 'outputs/system_logs/js_other.json', 'task-js-other', 'OTHER');

  const result2 = runIndexer(root, ['index', '--project-id', 'PRJ_JS_LEDGER']);
  assert.equal(result2.status, 0, result2.stderr);
  const index = JSON.parse(fs.readFileSync(path.join(projectRoot, 'INDEX.json'), 'utf8'));
  assert.equal(index.ledger_summary.actions.aggregated[0].title, 'second');
  assert.equal(index.ledger_summary.errors.aggregated[0].status, 'open');
  const issues = Object.fromEntries(index.issues.map((issue) => [issue.id, issue]));
  assert.deepEqual(issues['ERR-1'].related_fixes.map((item) => item.id), ['FIX-1']);
  assert.deepEqual(issues['ERR-2'].related_fixes.map((item) => item.id), ['FIX-1', 'FIX-2']);
  assert.equal(index.artifact_counts.figures, 2);
  assert.equal(index.machine_logs.count, 2);
  const globalIndex = fs.readFileSync(path.join(root, 'workspace/projects', 'INDEX.md'), 'utf8');
  assert.match(globalIndex, /\| PRJ_JS_LEDGER \| 0 \| 2 \| 0 \| 0 \| 5 \| 2 \|/);
});
