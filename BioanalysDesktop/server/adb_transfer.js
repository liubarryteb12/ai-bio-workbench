import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import childProcess from 'node:child_process';

import { ADB_EXEC_SCRIPT, REPO_ROOT, childEnv, computeMode } from './proc.js';

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function runResultText(result) {
  return [result.stdout, result.stderr, result.error ? String(result.error.message || result.error) : null]
    .filter(Boolean).join('\n').trim();
}

function commandResult(result) {
  const text = runResultText(result);
  const hashes = text.match(/[0-9a-f]{64}/g) || [];
  return {
    code: result.status ?? -1,
    text,
    remoteSha256: hashes.at(-1) || null,
  };
}

function adapterArgs(extra = {}) {
  const adapter = computeMode();
  if (adapter === 'mock') throw new Error('mock 计算面不提供真实文件传输');
  if (adapter === 'ssh') {
    return { mode: 'ssh', target: process.env.BIO_SSH_TARGET || 'k40-ubuntu' };
  }
  return { mode: 'adb', ...extra };
}

function adbExec(args) {
  return childProcess.spawnSync('pwsh', [
    '-NoProfile', '-File', ADB_EXEC_SCRIPT,
    '-Level', 'ubuntu', '-Transport', 'adb', '-RequireAdb',
    ...args,
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 900000,
    windowsHide: true,
    env: childEnv(),
  });
}

export function pushFile(localPath, remotePath, options = {}) {
  const channel = adapterArgs();
  if (!fs.existsSync(localPath)) throw new Error(`本地文件不存在: ${localPath}`);
  const bytes = fs.readFileSync(localPath);
  const expected = sha256Hex(bytes);
  if (channel.mode === 'ssh') {
    const scp = childProcess.spawnSync('scp', [
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', localPath, `${channel.target}:${remotePath}`,
    ], { encoding: 'utf8', timeout: 900000, windowsHide: true, env: childEnv(options.env) });
    const code = scp.status ?? -1;
    return { ok: code === 0, code, sha256: expected, remoteSha256: code === 0 ? expected : null, text: runResultText(scp) };
  }
  const result = adbExec([
    '-RemoteScriptPath', `/tmp/dsh_adb_push_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.sh`,
    '-PushLocalPath', localPath,
    '-PushRemotePath', remotePath,
  ]);
  const normalized = commandResult(result);
  const ok = normalized.code === 0 && normalized.remoteSha256 === expected;
  return {
    ok,
    code: normalized.code,
    sha256: expected,
    remoteSha256: normalized.remoteSha256,
    text: normalized.text,
  };
}

export function pullFile(remotePath, localPath, options = {}) {
  const channel = adapterArgs();
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  if (channel.mode === 'ssh') {
    const scp = childProcess.spawnSync('scp', [
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', `${channel.target}:${remotePath}`, localPath,
    ], { encoding: 'utf8', timeout: 900000, windowsHide: true, env: childEnv(options.env) });
    const code = scp.status ?? -1;
    const sha256 = code === 0 && fs.existsSync(localPath) ? sha256Hex(fs.readFileSync(localPath)) : null;
    return { ok: code === 0 && Boolean(sha256), code, sha256, text: runResultText(scp) };
  }
  const hashCommand = `sha256sum ${JSON.stringify(remotePath)} | cut -d' ' -f1; printf '\\n__B64__\\n'; base64 -w0 ${JSON.stringify(remotePath)}`;
  const result = adbExec([
    '-RemoteScriptPath', `/tmp/dsh_adb_pull_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.sh`,
    '-Command', hashCommand,
  ]);
  const text = runResultText(result);
  const marker = text.lastIndexOf('__B64__');
  const remoteSha256 = (text.match(/[0-9a-f]{64}/) || [])[0] || null;
  const encoded = marker >= 0 ? text.slice(marker + '__B64__'.length).replace(/\s+/g, '') : '';
  if ((result.status ?? -1) !== 0 || !encoded || !remoteSha256) {
    return { ok: false, code: result.status ?? -1, sha256: null, remoteSha256, text };
  }
  const buffer = Buffer.from(encoded, 'base64');
  const sha256 = sha256Hex(buffer);
  const ok = sha256 === remoteSha256;
  if (ok) fs.writeFileSync(localPath, buffer);
  return { ok, code: ok ? 0 : 1, sha256, remoteSha256, text };
}

export function computeAdapter() {
  return computeMode();
}

export function shouldUseAdbTransfer() {
  return computeMode() === 'adb';
}
