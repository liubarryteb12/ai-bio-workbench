import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SCRIPT = path.join(REPO, 'ops', 'port_preflight.ps1');

// pwsh 在多数 Windows 机器上不存在（PowerShell 7 不是系统自带），净化 PATH 下
// spawnSync('pwsh') 直接 ENOENT。走工具链解析器：pwsh 7 优先，退回 Windows PowerShell。
import { resolveTool } from '../../tools/dev/toolchain.mjs';
const POWERSHELL = resolveTool('pwsh').path;

function needShell(testContext) {
  if (!POWERSHELL) { testContext.skip('HOST_MISSING_SHELL: 本机无可解析的 PowerShell（pwsh/5.1 都没找到）'); return false; }
  return true;
}

function runPreflight(port, expectedPattern, connections, processes) {
  const result = childProcess.spawnSync(
    POWERSHELL,
    [
      // 便携包路径不在受信任位置时，5.1 默认执行策略会直接拒绝 -File 脚本
      // （实测 UnauthorizedAccess）；预检脚本只读，Bypass 安全。
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT,
      '-Port', String(port),
      '-ExpectedPattern', expectedPattern,
      '-ConnectionsJson', JSON.stringify(connections),
      '-ProcessesJson', JSON.stringify(processes),
    ],
    { encoding: 'utf8', timeout: 30000, windowsHide: true },
  );
  assert.equal(result.error, undefined);
  assert.ok([0, 10, 20].includes(result.status), result.stderr || `exit=${result.status}`);
  return JSON.parse(result.stdout.trim());
}

test('port preflight distinguishes a Bound foreign owner from a free port', (testContext) => {
  if (!needShell(testContext)) return;
  const bound = runPreflight(
    18787,
    'server[\\\\/]index\\.js',
    [{ LocalAddress: '0.0.0.0', LocalPort: 18787, State: 100, OwningProcess: 4242 }],
    [{ ProcessId: 4242, Name: 'verge-mihomo.exe', CommandLine: 'verge-mihomo.exe -d config' }],
  );
  assert.equal(bound.port, 18787);
  assert.equal(bound.status, 'foreign');
  assert.equal(bound.safe_to_stop, false);
  assert.equal(bound.owners[0].process_name, 'verge-mihomo.exe');

  const free = runPreflight(18788, 'server[\\\\/]index\\.js', [], []);
  assert.equal(free.port, 18788);
  assert.equal(free.status, 'free');
  assert.equal(free.safe_to_stop, true);

  const expected = runPreflight(
    18787,
    'server[\\\\/]index\\.js',
    [{ LocalAddress: '127.0.0.1', LocalPort: 18787, State: 'Listen', OwningProcess: 5151 }],
    [{ ProcessId: 5151, Name: 'node.exe', CommandLine: 'node server/index.js' }],
  );
  assert.equal(expected.status, 'expected');
  assert.equal(expected.safe_to_stop, true);
});

test('guard refuses to kill foreign owners and launchers detect all TCP states', (testContext) => {
  if (!needShell(testContext)) return;
  const guard = fs.readFileSync(path.join(REPO, 'ops', 'serve_guard.ps1'), 'utf8');
  assert.match(guard, /port_preflight\.ps1/);
  assert.match(guard, /status\s+-eq\s+'foreign'/);
  assert.match(guard, /拒绝清理外部进程/);

  for (const name of ['start_workbench.bat', 'start_portal.bat']) {
    const text = fs.readFileSync(path.join(REPO, name), 'utf8');
    assert.match(text, /port_preflight\.ps1/);
    assert.doesNotMatch(text, /findstr\s+"LISTENING"/i);
  }
});
