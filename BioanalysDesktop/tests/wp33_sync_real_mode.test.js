import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const DAEMON = path.join(REPO, 'tools', 'ops', 'sync_daemon.ps1');

test('sync daemon keeps stub mode as the default for CI', () => {
  const text = fs.readFileSync(DAEMON, 'utf8');
  assert.equal(text.includes('\r\n'), false, 'sync daemon must use LF');
  assert.match(text, /\[string\]\$Mode = 'stub'/);
  assert.ok(text.includes('Invoke-ImportStub'));
  assert.ok(text.includes('Invoke-DispatchStub'));
  assert.ok(text.includes('Invoke-PullStub'));
  assert.ok(text.includes('Invoke-PackStub'));
});

test('real mode exposes the four hard workbench seams', () => {
  const text = fs.readFileSync(DAEMON, 'utf8');
  for (const seam of [
    'function Invoke-ProjectCreateReal',
    'function Invoke-TaskDispatchReal',
    'function Invoke-PullOutputsReal',
    'function Invoke-ReportBuildReal',
  ]) {
    assert.ok(text.includes(seam), `missing hard seam: ${seam}`);
  }
  assert.ok(text.includes('/api/projects/create'));
  assert.ok(text.includes('/api/projects/list'));
  assert.ok(text.includes('/api/tasks/submit'));
  assert.ok(text.includes('tools/ops/07_pull_outputs.ps1'));
  assert.ok(text.includes('/api/report/build'));
  assert.ok(text.includes('/api/sync/result'));
  assert.ok(text.includes("Join-Path $RepoRoot 'workspace/projects'"));
  assert.match(text, /files\s*=\s*@\(\$resultFiles\)/);
  assert.match(text, /figureRoot/);
  assert.match(text, /png\|jpg\|jpeg\|webp/);
  assert.match(text, /\[int\]\$_\.Exception\.Response\.StatusCode/);
  assert.match(text, /\$statusCode\s*-eq\s*409/);
  assert.match(text, /existing\s*=\s*\$true/);
  assert.match(text, /SYNC_REUSE_EXISTING/);
  assert.match(text, /Get-ChildItem \$unpacked -File -Filter '\*\.json'/);
});

test('real mode preserves proxy isolation and bounded serial dispatch', () => {
  const text = fs.readFileSync(DAEMON, 'utf8');
  assert.ok(text.includes("$env:NO_PROXY = '127.0.0.1,localhost'"));
  assert.ok(text.includes('Invoke-ProjectCreateReal'));
  assert.ok(text.includes('Invoke-TaskDispatchReal'));
  assert.ok(text.includes('Start-Sleep -Seconds 60'));
  assert.ok(text.includes('BIO_WORKBENCH_USER'));
  assert.ok(text.includes('BIO_WORKBENCH_PASS'));
  assert.match(text, /\[string\]\$WorkbenchUser\s*=\s*\$env:BIO_WORKBENCH_USER/);
  assert.match(text, /\[string\]\$WorkbenchPass\s*=\s*\$env:BIO_WORKBENCH_PASS/);
});

test('real mode resolves lineId with PowerShell-safe fallback and uses sync outbox', () => {
  const text = fs.readFileSync(DAEMON, 'utf8');
  assert.doesNotMatch(text, /\$Requirement\.lineId\s*\|\|\s*\$Requirement\.seriesId/);
  assert.match(
    text,
    /\$lineId\s*=\s*if\s*\(\s*-not\s*\[string\]::IsNullOrWhiteSpace\(\$Requirement\.lineId\)\s*\)\s*\{\s*\[string\]\$Requirement\.lineId\s*\}\s*else\s*\{\s*\[string\]\$Requirement\.seriesId\s*\}/s,
  );
  assert.match(text, /\[string\]\$SpoolRoot\s*=\s*'ledger\/sync\/outbox'/);
  assert.ok(!text.includes('ledger/sync/spool'));
});

test('real mode consumes the server execution plan and dispatches adapted figure tasks', () => {
  const text = fs.readFileSync(DAEMON, 'utf8');
  assert.match(text, /\/api\/projects\/execution-plan/);
  assert.match(text, /\/api\/projects\/figures\/apply/);
  assert.match(text, /function Invoke-FigureApplyReal/);
  assert.match(text, /\$executionPlan\.tasks/);
  assert.match(text, /adapted\s*=\s*\[bool\]\$task\.adapted/);
  assert.match(text, /scriptPath\s*=\s*\[string\]\$task\.scriptPath/);
  assert.match(text, /canonicalOutput\s*=\s*\[string\]\$task\.canonicalOutput/);
  assert.match(text, /depends_on_step|dependsOnStep/);
});
