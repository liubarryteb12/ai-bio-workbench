import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeA2ATask,
  normalizeA2ATaskState,
  isTerminalA2ATaskState,
} from '../server/a2a_state.js';

test('A2A 状态归一化兼容 Pi 的 TASK_STATE_ 前缀', () => {
  assert.equal(normalizeA2ATaskState('TASK_STATE_COMPLETED'), 'completed');
  assert.equal(normalizeA2ATaskState('TASK_STATE_FAILED'), 'failed');
  assert.equal(normalizeA2ATaskState('TASK_STATE_CANCELED'), 'canceled');
  assert.equal(normalizeA2ATaskState('working'), 'working');
});

test('A2A 终态判断只接受归一化后的完成态', () => {
  for (const state of ['TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_REJECTED']) {
    assert.equal(isTerminalA2ATaskState(state), true, state);
  }
  assert.equal(isTerminalA2ATaskState('TASK_STATE_WORKING'), false);
  assert.equal(isTerminalA2ATaskState(''), false);
});

test('任务对象归一化保留原始远端状态并更新展示状态', () => {
  const task = normalizeA2ATask({
    id: 'task-123',
    status: { state: 'TASK_STATE_COMPLETED', message: 'done' },
  });
  assert.deepEqual(task, {
    id: 'task-123',
    status: {
      state: 'completed',
      remote_state: 'TASK_STATE_COMPLETED',
      message: 'done',
    },
  });
});
