import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

test('ADB 执行器默认通道不自动回落 SSH，且每次命令有唯一远端脚本名', () => {
  const helper = fs.readFileSync(path.join(REPO, 'tools', 'ops', 'adb_exec.ps1'), 'utf8');
  assert.match(helper, /\[ValidateSet\('adb', 'ssh'\)\]\[string\]\$Transport = 'adb'/);
  assert.doesNotMatch(helper, /\$used = 'ssh'[\s\S]{0,80}回落/);
  assert.match(helper, /RemoteScriptPath/);
  assert.match(helper, /dsh_adb_cmd_' \+ \$PID/);
  assert.match(helper, /PushLocalPath/);
  assert.match(helper, /PushRemotePath/);
  assert.match(helper, /sha256sum/);
});

test('proc.js 暴露 ADB 分流接缝，主远端入口与文件传输入口使用 ADB', () => {
  const source = fs.readFileSync(path.join(REPO, 'BioanalysDesktop', 'server', 'proc.js'), 'utf8');
  assert.match(source, /function rewriteRemoteArgv/);
  assert.match(source, /resolveComputeAdapter\(\) !== 'adb'\) return null/);
  assert.match(source, /export function adbRaw/);
  assert.match(source, /-Transport', 'adb', '-RequireAdb/);
  const remoteExec = fs.readFileSync(path.join(REPO, 'BioanalysDesktop', 'server', 'remote_exec.js'), 'utf8');
  assert.match(remoteExec, /return adbRaw\(command/);
  const transfer = fs.readFileSync(path.join(REPO, 'BioanalysDesktop', 'server', 'adb_transfer.js'), 'utf8');
  assert.match(transfer, /shouldUseAdbTransfer/);
  assert.match(source, /-Transport', 'adb', '-RequireAdb/);
});

test('ADB 传输模块提供 push/pull，SSH 只在特殊开关下作为传输出口', () => {
  const source = fs.readFileSync(path.join(REPO, 'BioanalysDesktop', 'server', 'adb_transfer.js'), 'utf8');
  assert.match(source, /export function pushFile/);
  assert.match(source, /export function pullFile/);
  assert.match(source, /computeMode\(\)/);
  assert.match(source, /adapter === 'ssh'/);
  assert.match(source, /remoteSha256 === expected/);
  assert.match(source, /sha256 === remoteSha256/);
  assert.match(source, /shouldUseAdbTransfer/);
});

test('通道策略不再声明服务端仍有未迁移 SSH 特殊路径', () => {
  const policy = fs.readFileSync(path.join(REPO, 'docs', 'remote_channel_policy.md'), 'utf8');
  assert.match(policy, /服务端统一分流/);
  assert.match(policy, /新增文件传输入口统一使用/);
  assert.match(policy, /不在总门禁里做一次性 argv 改写/);
  assert.equal(policy.includes('尚未迁移的部分'), false);
});
