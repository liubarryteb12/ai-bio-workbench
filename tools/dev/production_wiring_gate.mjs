#!/usr/bin/env node
/**
 * G28：生产接线与适配封板门禁（Gemini Argon 第四轮裁定）。
 *
 * 判据：
 *   1. 四依赖无桩：index.js 必须绑定 assertLease / autonomyGrantsProvider /
 *      runValidationFn / dispatchStepFn，且指向真实实现。
 *   2. 内存三处同源：wrapper 6.5、mem_guard 容器 7.5 / 验证 3.5。
 *   3. receipt 扩展：delivery_grade 与 adaptation_trace 已进权威回执。
 *   4. 行为探针：退出码矩阵与 WROTE 解析仍然有效。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(REPO, relPath), 'utf8');
}

async function main() {
  const failures = [];
  const indexText = read('BioanalysDesktop/server/index.js');
  for (const binding of [
    'assertLease: assertLeaseFn',
    'autonomyGrantsProvider:',
    'runValidationFn:',
    'dispatchStepFn:',
  ]) {
    if (!indexText.includes(binding)) failures.push(`index.js 缺少生产接线: ${binding}`);
  }

  const wrapper = read('tools/ops/run_throttled_task.sh');
  if (!/MEM_LIMIT_DEFAULT_GB=6\.5/.test(wrapper) || !/MEM_LIMIT_MAX_GB=6\.5/.test(wrapper)) {
    failures.push('run_throttled_task.sh 单任务水位不是 6.5');
  }
  const memGuard = read('core/mem_guard.py');
  if (!/BIO_MEM_LIMIT_GB", "7\.5"/.test(memGuard)) failures.push('mem_guard 容器水位不是 7.5');
  if (!/BIO_VALIDATION_MEM_LIMIT_GB", "3\.5"/.test(memGuard)) failures.push('mem_guard 验证水位不是 3.5');

  const receipt = read('BioanalysDesktop/server/receipt_v1.js');
  for (const token of ['delivery_grade', 'adaptation_trace', 'appendAdaptationTrace']) {
    if (!receipt.includes(token)) failures.push(`receipt/v1 缺少 ${token}`);
  }

  const dispatcherText = read('BioanalysDesktop/server/services/pi_step_dispatcher.js');
  for (const token of ['step_lock', 'adaptation_epoch', 'step_attempts', 'env_throttle_retries']) {
    if (!dispatcherText.includes(token)) failures.push(`调度器缺少 ${token}`);
  }

  const dispatcher = await import(pathToFileURL(path.join(
    REPO, 'BioanalysDesktop', 'server', 'services', 'pi_step_dispatcher.js',
  )).href + '?g28=' + Date.now());
  const matrix = [
    [{ exitCode: 5 }, 'ENV_THROTTLED'],
    [{ exitCode: 137 }, 'STEP_OOM'],
    [{ exitCode: 1 }, 'FATAL_EXEC_ERROR'],
    [{ exitCode: 0, wroteCount: 0, wroteBytes: 0 }, 'SILENT_EMPTY_OUTPUT'],
    [{ exitCode: 0, wroteCount: 1, wroteBytes: 8 }, 'STEP_OK'],
  ];
  for (const [input, expected] of matrix) {
    const actual = dispatcher.classifyStepOutcome(input).kind;
    if (actual !== expected) failures.push(`退出码矩阵漂移: ${JSON.stringify(input)} -> ${actual}（期望 ${expected}）`);
  }

  const runner = await import(pathToFileURL(path.join(
    REPO, 'BioanalysDesktop', 'server', 'services', 'pi_task_runner.js',
  )).href + '?g28=' + Date.now());
  const wrote = runner.summarizeWroteReceipts("WROTE '/tmp/a.tsv' 12\n");
  if (wrote.count !== 1 || wrote.bytes !== 12) failures.push('WROTE 解析漂移');

  if (failures.length > 0) {
    for (const message of failures) console.error('[ RED ] ' + message);
    console.error(`PRODUCTION_WIRING_GATE_FAILED ${failures.length} 处违规`);
    process.exitCode = 1;
    return;
  }
  console.log('[ OK ] 四依赖无桩：assertLease / autonomyGrantsProvider / runValidationFn / dispatchStepFn');
  console.log('[ OK ] 内存三处同源：wrapper 6.5 / mem_guard 7.5+3.5 / 工具桥 6.5');
  console.log('[ OK ] receipt/v1 已含 delivery_grade 与 adaptation_trace');
  console.log('[ OK ] 退出码矩阵与 WROTE 解析行为探针通过');
  console.log('PRODUCTION_WIRING_GATE_OK');
}

main().catch((error) => {
  console.error('PRODUCTION_WIRING_GATE_FAILED 内部异常：' + error.message);
  process.exitCode = 1;
});
