import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SCRIPT = path.join(REPO, 'ops', 'a2a_preflight.ps1');

test('a2a preflight returns non-zero when any check reports FAIL', () => {
  const text = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(
    text,
    /if \(\$fails\.Count -gt 0\) \{ exit 1 \}/,
    'preflight 必须在 FAIL 存在时显式 exit 1，否则报告门禁会被假绿绕过',
  );
});

test('a2a preflight keeps WARN non-fatal when no FAIL exists', () => {
  const text = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(
    text,
    /\$verdict = if \(\$fails\.Count -gt 0\) \{ 'FAIL' \} else \{ 'PASS_WITH_WARNINGS' \}/,
    '非 strict 模式下 WARN 只降级 verdict，不触发 FAIL 分支',
  );
  const failBranchIndex = text.indexOf("if ($fails.Count -gt 0) { exit 1 }");
  const exitZeroIndex = text.lastIndexOf('exit 0');
  assert.ok(failBranchIndex > -1, 'FAIL 退出分支存在');
  assert.ok(exitZeroIndex > failBranchIndex, 'exit 0 必须排在 FAIL 分支之后，否则会短路非零退出');
});
