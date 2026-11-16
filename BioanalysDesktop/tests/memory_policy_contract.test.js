/**
 * memory_policy/v1 契约测试（Gemini Argon 判决 G1）。
 *
 * 判据：
 *   1. 三级水位固定为 12 / 7.5 / 6.5，严格递减。
 *   2. 单任务超过 6.5GB 即拒（废除旧的 8.0GB 单任务上限）。
 *   3. 并行 worker 不得超过 2。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEVICE_MEMORY_GB,
  CONTAINER_MEMORY_GB,
  TASK_MEMORY_GB,
  MAX_PARALLEL_WORKERS,
  validateMemoryBudget,
} from '../../shared/memory_policy_v1.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('三级内存水位固定为 12 / 7.5 / 6.5', () => {
  assert.equal(DEVICE_MEMORY_GB, 12);
  assert.equal(CONTAINER_MEMORY_GB, 7.5);
  assert.equal(TASK_MEMORY_GB, 6.5);
  assert.equal(MAX_PARALLEL_WORKERS, 2);
});

test('合法预算通过', () => {
  const result = validateMemoryBudget({
    deviceGb: 12, containerGb: 7.5, taskGb: 6.5, workers: 2,
  });
  assert.equal(result.ok, true, result.errors.join(' | '));
});

test('旧的单任务 8.0GB 配置被拒', () => {
  const result = validateMemoryBudget({
    deviceGb: 12, containerGb: 7.5, taskGb: 8.0, workers: 2,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((line) => line.includes('taskGb')));
});

test('worker 超过 2 被拒', () => {
  const result = validateMemoryBudget({
    deviceGb: 12, containerGb: 7.5, taskGb: 6.5, workers: 4,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((line) => line.includes('workers')));
});

test('执行包装器与工具桥的默认单任务上限都是 6.5GB', () => {
  const wrapper = fs.readFileSync(path.join(REPO, 'tools', 'ops', 'run_throttled_task.sh'), 'utf8');
  assert.match(wrapper, /MEM_LIMIT_DEFAULT_GB=6\.5/);
  assert.match(wrapper, /MEM_LIMIT_MAX_GB=6\.5/);
  const bridge = fs.readFileSync(
    path.join(REPO, 'BioanalysDesktop', 'server', 'services', 'pi_tools_bridge.js'), 'utf8',
  );
  assert.match(bridge, /memory_limit_gb:\s*Number\(receipt\?\.summary\?\.memory_limit_gb \?\? 6\.5\)/);
});
