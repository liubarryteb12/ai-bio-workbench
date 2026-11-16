/**
 * adb_exec.ps1 的 Windows PowerShell 5.1 兼容契约。
 *
 * 桌面版在干净 Windows 上回落 powershell.exe 执行 ADB 通道。5.1 把无 BOM 的
 * UTF-8 当 ANSI 读，中文注释会破坏解析（实测 parse error）；子进程输出编码
 * 还必须显式钉成 UTF-8，否则 Node 侧按 UTF-8 解码 GBK 字节就是乱码。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(REPO, 'tools', 'ops', 'adb_exec.ps1');

test('adb_exec.ps1 必须是 UTF-8 with BOM（PowerShell 5.1 解析前提）', () => {
  const bytes = fs.readFileSync(SCRIPT);
  assert.ok(bytes.length >= 3, 'script file exists and is non-empty');
  assert.equal(bytes[0], 0xEF, 'first byte of UTF-8 BOM');
  assert.equal(bytes[1], 0xBB, 'second byte of UTF-8 BOM');
  assert.equal(bytes[2], 0xBF, 'third byte of UTF-8 BOM');
});

test('adb_exec.ps1 必须显式强制 UTF-8 输出编码', () => {
  const text = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(text, /\[Console\]::OutputEncoding\s*=\s*\[System\.Text\.UTF8Encoding\]::new\(\$false\)/);
  assert.match(text, /\$OutputEncoding\s*=\s*\[System\.Text\.UTF8Encoding\]::new\(\$false\)/);
  assert.doesNotMatch(text, /\[System\.Text\.Encoding\]::UTF8/, '静态 Encoding.UTF8 自带 BOM 前导，禁止用于管道输出');
});

const ps51 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

if (process.platform === 'win32' && fs.existsSync(ps51)) {
  test('Windows PowerShell 5.1 能解析 adb_exec.ps1 且中文输出为 UTF-8', () => {
  const result = spawnSync(ps51, [
    '-NoProfile', '-File', SCRIPT,
    '-Level', 'container', '-Transport', 'adb', '-RequireAdb',
    '-Command', 'echo 中文测试',
  ], { encoding: 'utf8', timeout: 60000, windowsHide: true });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  assert.equal(result.status, 0, `powershell 5.1 parse/run failed: ${output.slice(0, 400)}`);
  assert.ok(!/[�]/.test(output), `output contains replacement chars: ${JSON.stringify(output.slice(0, 200))}`);
  });
}
