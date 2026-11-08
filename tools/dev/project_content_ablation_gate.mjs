#!/usr/bin/env node
/**
 * project_content_ablation_gate.mjs - 项目内容消融门禁包装器。
 *
 * 只做三件事：spawn 消融脚本、原样转发输出、要求成功哨兵。
 * 零外部依赖，避免门禁因包装层自身引入新变量。
 *
 * 判据：
 *   1. 子进程退出码必须为 0；
 *   2. 输出必须包含 PROJECT_CONTENT_ABLATION_OK。
 *
 * 用法：node tools/dev/project_content_ablation_gate.mjs
 * 退出码：0 通过，1 失败。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(REPO, 'tools', 'dev', 'project_content_ablation.mjs');
const OK = 'PROJECT_CONTENT_ABLATION_OK';

const result = spawnSync(process.execPath, [SCRIPT], {
  cwd: REPO,
  encoding: 'utf8',
  timeout: 180000,
  maxBuffer: 16 * 1024 * 1024,
  windowsHide: true,
});

const output = (result.stdout || '') + (result.stderr || '');
if (output) process.stdout.write(output);

if (result.status !== 0) {
  console.error('PROJECT_CONTENT_ABLATION_GATE_FAILED 子进程退出码 ' + result.status);
  process.exit(1);
}
if (!output.includes(OK)) {
  console.error('PROJECT_CONTENT_ABLATION_GATE_FAILED 缺少哨兵 ' + OK);
  process.exit(1);
}
console.log('PROJECT_CONTENT_ABLATION_GATE_OK');
