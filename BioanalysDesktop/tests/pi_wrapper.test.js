import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolvePiCli } from '../../tools/bin/pi-wrapper.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('开发态能解析到 desktop/runtime/picli 与 agent 目录', (t) => {
  const resolved = resolvePiCli({ env: {}, packageRoot: REPO });
  if (!resolved) {
    t.skip('HOST_MISSING_LOCAL_DATA: 开发仓未安装 runtime/picli 运行资产');
    return;
  }
  assert.ok(fs.existsSync(resolved.cli));
  assert.match(resolved.cli.replace(/\\/g, '/'), /desktop\/runtime\/picli\/node_modules/);
  assert.match(resolved.agentDir.replace(/\\/g, '/'), /desktop\/runtime\/picli\/agent$/);
});

test('显式 BIO_PI_CLI_BIN 优先', () => {
  const resolved = resolvePiCli({
    env: { BIO_PI_CLI_BIN: path.join(REPO, 'desktop', 'runtime', 'picli', 'pi.cmd') },
    packageRoot: REPO,
  });
  assert.match(resolved.cli.replace(/\\/g, '/'), /pi\.cmd$/);
});

test('找不到 CLI 时返回 null', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'pi_wrapper_empty_'));
  try {
    assert.equal(resolvePiCli({ env: {}, packageRoot: empty }), null);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('便携包布局：runtime 根下的 picli 能被解析（不依赖全局 pi）', () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi_wrapper_packaged_'));
  const cli = path.join(
    runtimeRoot, 'picli', 'node_modules', '@earendil-works', 'pi-coding-agent',
    'dist', 'bundle', 'cli.js',
  );
  try {
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.writeFileSync(cli, '// fake cli\n');
    fs.mkdirSync(path.join(runtimeRoot, 'picli', 'agent'), { recursive: true });
    const resolved = resolvePiCli({ env: {}, packageRoot: runtimeRoot });
    assert.ok(resolved, '包内 runtime/picli 必须能被解析');
    assert.equal(path.resolve(resolved.cli), path.resolve(cli));
    assert.match(resolved.agentDir.replace(/\\/g, '/'), /picli\/agent$/);
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('Pi CLI 是运行时资产，不进 Electron 生产依赖（否则 electron-builder 收集失败）', () => {
  const desktopPkg = JSON.parse(fs.readFileSync(path.join(REPO, 'desktop', 'package.json'), 'utf8'));
  const prodDeps = { ...(desktopPkg.dependencies || {}), ...(desktopPkg.optionalDependencies || {}) };
  assert.equal(prodDeps['@earendil-works/pi-coding-agent'], undefined);
});

test('运行时清单锁定的版本与随包 node_modules 实际版本一致', (t) => {
  const manifest = path.join(REPO, 'desktop', 'runtime', 'picli', 'package.json');
  const installedPkg = path.join(REPO, 'desktop', 'runtime', 'picli', 'node_modules', '@earendil-works', 'pi-coding-agent', 'package.json');
  if (!fs.existsSync(manifest) || !fs.existsSync(installedPkg)) {
    t.skip('HOST_MISSING_LOCAL_DATA: runtime/picli 依赖未安装，版本一致性不可校验');
    return;
  }
  const runtimePkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  const pinned = runtimePkg.dependencies['@earendil-works/pi-coding-agent'];
  const installed = JSON.parse(fs.readFileSync(installedPkg, 'utf8'));
  assert.equal(installed.version, pinned);
});
