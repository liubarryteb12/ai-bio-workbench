#!/usr/bin/env node
/**
 * 便携包 Pi CLI 启动器。
 *
 * 解析顺序：
 *   1. BIO_PI_CLI_BIN 显式覆盖；
 *   2. 包内 runtime/picli/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js；
 *   3. 仓库开发态 desktop/runtime/picli/...。
 *
 * 只用当前 node 可执行体拉起，不依赖全局 pi 或全局 node（REJ-004 / REJ-007）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, '..', '..');
const REL_CLI = path.join(
  'node_modules',
  '@earendil-works',
  'pi-coding-agent',
  'dist',
  'bundle',
  'cli.js',
);

export function resolvePiCli({ env = process.env, packageRoot = PACKAGE_ROOT } = {}) {
  if (env.BIO_PI_CLI_BIN && fs.existsSync(env.BIO_PI_CLI_BIN)) {
    return { cli: env.BIO_PI_CLI_BIN, agentDir: env.PI_CODING_AGENT_DIR || null };
  }
  const candidates = [
    path.join(packageRoot, 'picli', REL_CLI),
    path.join(packageRoot, 'runtime', 'picli', REL_CLI),
    path.join(packageRoot, 'desktop', 'runtime', 'picli', REL_CLI),
  ];
  for (const cli of candidates) {
    if (!fs.existsSync(cli)) continue;
    const agentDir = path.join(path.dirname(cli), '..', '..', '..', '..', '..', 'agent');
    return {
      cli,
      agentDir: env.PI_CODING_AGENT_DIR || (fs.existsSync(agentDir) ? agentDir : null),
    };
  }
  return null;
}

export function main(argv = process.argv.slice(2), options = {}) {
  const resolved = resolvePiCli(options);
  if (!resolved) {
    console.error('PI_CLI_NOT_FOUND: 未找到 Pi CLI，请检查 runtime/picli 或 BIO_PI_CLI_BIN');
    return 2;
  }
  const env = { ...process.env, ...(options.env || {}) };
  if (resolved.agentDir && !env.PI_CODING_AGENT_DIR) {
    env.PI_CODING_AGENT_DIR = resolved.agentDir;
  }
  const child = spawn(process.execPath, [resolved.cli, ...argv], {
    stdio: 'inherit',
    env,
    windowsHide: true,
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
  return null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = main();
  if (typeof result === 'number') process.exit(result);
}
