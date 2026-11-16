/**
 * PowerShell 执行器解析：pwsh 缺失时回落系统自带 Windows PowerShell。
 *
 * 干净 Windows 只保证 powershell.exe 存在，adb_exec.ps1 必须仍能启动。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolvePwshExec } from '../server/proc.js';

test('解析出的 PowerShell 执行器在 Windows 上必须真实存在', () => {
  const resolved = resolvePwshExec();
  assert.equal(typeof resolved, 'string');
  assert.ok(resolved.length > 0);
  if (process.platform === 'win32') {
    assert.match(resolved.toLowerCase(), /^pwsh$|pwsh\.exe$|powershell\.exe$/);
    if (resolved !== 'pwsh') {
      assert.ok(fs.existsSync(resolved), `PowerShell 执行器不存在: ${resolved}`);
    }
  }
});
