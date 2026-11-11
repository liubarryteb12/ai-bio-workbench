import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeBridgeOutput } from '../server/remote_exec.js';

// ── remote_exec.js 契约面测试（2026-11-02）──
//
// 这个模块是「本地零算力红线的唯一出口」，四件事值得单测：
//   1. 目标绑定：默认走 adbRaw，ssh 特殊开关也必须打到 k40-ubuntu，不能打到宿主 Termux(k40)
//   2. 列目录口径：单层 ls 不递归（递归在容器里触发 P-23 abort）
//   3. 桥接噪声过滤：只删已知 ssh 提示，其余一律保留，且两通道同文只留一份
//   4. 通道默认：adb 是默认，ssh 只在显式 BIO_COMPUTE_ADAPTER=ssh 时启用
//
// 2 与 3 都能纯离线测。1 用源码静态断言钉住——真发 ssh 的测试已在
// proc.test.js 里有一条，这里不重复消耗链路。

test('桥接输出过滤：只删 ssh 客户端提示，引擎原文一字不丢', () => {
  const stdout = [
    'Warning: Permanently added \'[127.0.0.1]:10022\' (ED25519) to the list of known hosts.',
    '[BRIDGE FAIL] rscript 未找到',
    'normal line kept',
  ].join('\n');
  const stderr = 'Warning: something about known hosts\nsecond kept line';
  const out = sanitizeBridgeOutput(stdout, stderr);
  assert.ok(out.includes('[BRIDGE FAIL] rscript 未找到'), '引擎失败原文必须保留');
  assert.ok(out.includes('normal line kept'));
  assert.ok(out.includes('second kept line'));
  assert.equal(out.includes('Permanently added'), false, 'ssh 噪声必须删掉');
  assert.equal(out.includes('known hosts'), false, 'known_hosts 提示必须删掉');
});

test('桥接输出过滤：两通道同文只留一份（2>&1 后不重复刷屏）', () => {
  const same = '[BRIDGE FAIL] 同一条错误';
  const out = sanitizeBridgeOutput(same, same);
  const occurrences = out.split(same).length - 1;
  assert.equal(occurrences, 1, '同文应只出现一次，实际 ' + occurrences);
});

test('桥接输出过滤：空输入不产生残留空行，且不把空串当内容', () => {
  assert.equal(sanitizeBridgeOutput(), '');
  assert.equal(sanitizeBridgeOutput('', ''), '');
  assert.equal(sanitizeBridgeOutput('\n\n\n', '   '), '');
  assert.equal(sanitizeBridgeOutput(null, undefined), '', 'null/undefined 不得抛错');
});

test('桥接输出过滤：纯空白行被丢弃，但行内空白保留', () => {
  const out = sanitizeBridgeOutput('a  b\n\n\nc   d', '');
  assert.equal(out, 'a  b\nc   d', '行间空行应合并，行内空格保留');
});

test('桥接输出过滤：噪声匹配是行首锚定，句中出现的同类词不误删', () => {
  // 只删"以 Warning: Permanently added 开头"的行；引擎自己在句中提到这些词时要保留
  const kept = 'note: Warning: Permanently added is an ssh quirk we strip';
  const out = sanitizeBridgeOutput(kept, '');
  assert.equal(out.includes('note:'), true, '行首不是 Warning 的行必须保留');
});

test('目标绑定：固定 adbRaw，SSH 特殊开关已封存', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = await readFile(path.join(here, '..', 'server', 'remote_exec.js'), 'utf8');
  assert.match(src, /return adbRaw\(command/, '默认出口必须调用 adbRaw');
  assert.match(src, /固定经 ADB/, '头部注释必须写明固定 ADB');
  assert.equal(/BIO_COMPUTE_ADAPTER === 'ssh'/.test(src), false, '不得保留 SSH 特殊开关');
  assert.equal(/runSshRaw|runSshStrict/.test(src), false, '不得保留任何 SSH 调用点');
});

test('列目录口径：processed 必须单层 ls，不得递归（递归在容器触发 P-23 abort）', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = await readFile(path.join(here, '..', 'server', 'remote_exec.js'), 'utf8');
  assert.match(src, /ls -1 \$\{dir\} 2>\/dev\/null \|\| true/,
    'processed 列目录必须 ls -1 单层且带 || true');
  assert.equal(/find .*processed/.test(src), false,
    '不得对 processed 用 find（P-23）');
});
